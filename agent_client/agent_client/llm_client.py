"""LLM 客户端：统一封装对 OpenAI / Anthropic / Gemini / Ollama 等提供商的调用。

所有提供商都通过 HTTP 请求调用，避免引入额外的 SDK 依赖，
这样在 Frappe 的受限环境中也能稳定工作。

批次C：支持多模态（图片）消息。content 可为字符串或 OpenAI 风格 content block
列表，_render_message 负责按供应商转换为对应格式。
"""

from __future__ import annotations

import json
import re
import time

import frappe
import requests

from frappe import _


def _image_meta(image_data):
    """提取图片 data URL 的脱敏元数据，避免完整 base64 落日志。

    仅对 data URL 或 http(s) URL 返回元数据；其余（空、普通文本）返回 None。
    """
    if not image_data or not isinstance(image_data, str):
        return None
    if image_data.startswith("data:"):
        meta = {"length": len(image_data), "kind": "data-url"}
        try:
            header = image_data.partition(",")[0]
            meta["header"] = header
            meta["mime"] = header[5:header.find(";")] if ";" in header else "unknown"
            meta["is_b64"] = ";base64," in image_data[: image_data.find(",") + 1] or "base64" in header
        except Exception:
            pass
        return meta
    if image_data.startswith(("http://", "https://")):
        return {"length": len(image_data), "kind": "url"}
    return None


_image_logger = None


def _get_image_logger():
    """获取并初始化图片调试 logger（INFO 级别，Frappe 默认是 ERROR 会过滤）。"""
    global _image_logger
    if _image_logger is None:
        _image_logger = frappe.logger("agent_client")
        _image_logger.setLevel(logging.INFO)
        for h in _image_logger.handlers:
            try:
                h.setLevel(logging.INFO)
            except Exception:
                pass
    return _image_logger


def _log_image_debug(tag, **kw):
    """统一图片调试日志入口（脱敏，不落 base64 内容）。

    用文件 logger 写入 logs/agent_client.log，避免在 LLM 异常、事务回滚时
    日志随之丢失（frappe.log_error 依赖数据库事务，失败会回滚）。
    """
    try:
        _get_image_logger().info("image-debug tag=%s payload=%s", tag, kw)
    except Exception:
        try:
            frappe.log_error({"tag": tag, **kw}, "image-debug")
        except Exception:
            pass


def _count_image_parts(content):
    """统计 OpenAI 风格 content block 中图片块数量。"""
    if not isinstance(content, list):
        return 0
    return sum(1 for b in content if isinstance(b, dict) and b.get("type") == "image_url")


def _payload_stats(payload):
    """统计最终请求 payload 中的图片信息（脱敏，不落 base64 内容）。

    兼容各 provider 的图片承载形态：
      - OpenAI/Gemini/Anthropic inline data：字符串以 "data:image" 开头
      - Ollama images 数组：列表元素为 base64 字符串
      - 纯 base64（无 mime 前缀）：记录数量与总长度
    """
    total_b64 = 0
    image_count = 0
    bare_b64_count = 0
    bare_b64_total = 0

    def walk(o):
        nonlocal total_b64, image_count, bare_b64_count, bare_b64_total
        if isinstance(o, dict):
            for v in o.values():
                if isinstance(v, str) and v.startswith("data:image"):
                    image_count += 1
                    total_b64 += len(v)
                elif isinstance(v, list):
                    for x in v:
                        if isinstance(x, str) and x and len(x) > 40 \
                                and re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", x):
                            bare_b64_count += 1
                            bare_b64_total += len(x)
                        else:
                            walk(x)
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(payload)
    return {
        "image_count": image_count,
        "total_b64_chars": total_b64,
        "bare_b64_count": bare_b64_count,
        "bare_b64_total_chars": bare_b64_total,
        "top_keys": list(payload.keys()),
    }


class LLMClientError(Exception):
    """LLM 调用异常"""


class LLMClient:
    """封装单个 LLM Provider 的调用。"""

    def __init__(self, provider_name: str):
        self.provider = self._get_provider(provider_name)
        self.provider_type = self.provider.provider_type
        self.api_base_url = (self.provider.api_base_url or "").rstrip("/")
        self.api_key = self.provider.get_password("api_key") if self.provider.api_key else None
        self.timeout = self.provider.timeout_seconds or 60

    @staticmethod
    def _get_provider(provider_name: str):
        if not frappe.db.exists("LLM Provider", provider_name):
            raise LLMClientError(_("LLM Provider {0} 不存在").format(provider_name))
        return frappe.get_doc("LLM Provider", provider_name)

    # ------------------------------------------------------------------
    # 各提供商请求构造
    # ------------------------------------------------------------------
    def _chat_url(self) -> str:
        if self.provider_type == "Ollama":
            return f"{self.api_base_url}/api/chat"
        if self.provider_type == "Gemini":
            url = f"{self.api_base_url or 'https://generativelanguage.googleapis.com/v1beta'}"
            return f"{url}/models/{self.model}:generateContent"
        return f"{self.api_base_url}/chat/completions"

    def _headers(self) -> dict:
        """构造各提供商的请求头。

          - OpenAI / Custom : Authorization: Bearer <key>
          - Anthropic       : x-api-key + anthropic-version
          - Gemini          : 密钥走查询参数 (?key=)，此处仅声明 JSON
          - Ollama          : 本地服务，通常无需认证
        """
        base = {"Content-Type": "application/json"}
        if self.provider_type == "Anthropic":
            return {
                "content-type": "application/json",
                "x-api-key": self.api_key or "",
                "anthropic-version": "2023-06-01",
            }
        if self.provider_type == "Gemini":
            return base
        if self.provider_type == "Ollama":
            return base
        # OpenAI / Custom
        if self.api_key:
            base["Authorization"] = f"Bearer {self.api_key}"
        return base

    def build_payload(self, messages: list[dict], model: str, temperature: float | None,
                      max_tokens: int | None, tools: list | None = None) -> dict:
        self.model = model
        temperature = temperature if temperature is not None else self.provider.default_temperature or 0.7
        max_tokens = max_tokens if max_tokens is not None else self.provider.default_max_tokens or 2048

        if self.provider_type == "Ollama":
            payload = {
                "model": model,
                "messages": [self._render_message(m) for m in messages],
                "stream": False,
                "options": {"temperature": temperature, "num_predict": max_tokens},
            }
            if tools:
                payload["tools"] = tools
            return payload
        if self.provider_type == "Gemini":
            return {
                "contents": [self._render_message(m) for m in messages if m.get("content")],
                "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
            }
        payload = {
            "model": model,
            "messages": [self._render_message(m) for m in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools
        return payload

    def _render_message(self, m: dict) -> dict:
        """将统一消息格式渲染为各提供商的请求消息。

        content 支持两种形态：
          - 字符串：普通文本
          - 列表（content block，OpenAI 风格）：
              [{"type":"text","text":"..."},
               {"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}]
        按 provider 转换为各自多模态格式（Gemini inlineData / Anthropic image / Ollama image）。
        """
        role = m.get("role", "user")
        content = m.get("content")

        _log_image_debug("render.start",
                         provider=self.provider_type,
                         role=role,
                         content_kind=("list" if isinstance(content, list)
                                       else ("str" if isinstance(content, str) else type(content).__name__)),
                         image_parts=_count_image_parts(content))

        if self.provider_type == "Gemini":
            parts = []
            if isinstance(content, str):
                if content:
                    parts.append({"text": content})
            elif isinstance(content, list):
                for b in content:
                    if b.get("type") == "text" and b.get("text"):
                        parts.append({"text": b["text"]})
                    elif b.get("type") == "image_url":
                        url = b.get("image_url", {}).get("url", "")
                        if url.startswith("data:"):
                            mime = url[5:url.find(";base64,")]
                            b64 = url[url.find(";base64,") + len(";base64,"):]
                            parts.append({"inlineData": {"mimeType": mime, "data": b64}})
                        elif url:
                            parts.append({"fileData": {"fileUri": url}})
            return {"role": "model" if role == "assistant" else "user", "parts": parts}

        if self.provider_type == "Anthropic":
            if isinstance(content, str):
                out = content
            else:
                out = []
                for b in content:
                    if b.get("type") == "text":
                        out.append({"type": "text", "text": b["text"]})
                    elif b.get("type") == "image_url":
                        url = b.get("image_url", {}).get("url", "")
                        if url.startswith("data:"):
                            mime = url[5:url.find(";base64,")]
                            b64 = url[url.find(";base64,") + len(";base64,"):]
                            out.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}})
                if not out:
                    out = ""
            return {"role": role, "content": out}

        if self.provider_type == "Ollama":
            # /api/chat 期望 content 为纯字符串，图片放在独立 images 数组中
            if isinstance(content, str):
                return {"role": role, "content": content}
            text_parts = []
            images = []
            for b in content:
                if b.get("type") == "text":
                    text_parts.append(b.get("text", ""))
                elif b.get("type") == "image_url":
                    url = b.get("image_url", {}).get("url", "")
                    if url.startswith("data:"):
                        b64 = url[url.find(";base64,") + len(";base64,"):]
                        images.append(b64)
                    elif url:
                        images.append(url)
            return {"role": role, "content": "".join(text_parts), "images": images}

        # OpenAI / Custom：透传（image_url 原生支持）
        return {"role": role, "content": content}

    # ------------------------------------------------------------------
    # 响应解析
    # ------------------------------------------------------------------
    def _parse_response(self, resp: requests.Response) -> dict:
        """解析响应，返回 {content, tool_calls}。"""
        try:
            data = resp.json()
        except ValueError:
            raise LLMClientError(_("LLM 返回了非 JSON 内容: {0}").format(resp.text[:300]))

        if self.provider_type == "Ollama":
            msg = data.get("message") or {}
            content = msg.get("content", "")
            tool_calls = []
            for tc in msg.get("tool_calls") or []:
                fn = tc.get("function") or {}
                args = fn.get("arguments", "")
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                tool_calls.append({"name": fn.get("name", ""), "arguments": args})
            return {"content": content, "tool_calls": tool_calls}
        if self.provider_type == "Gemini":
            candidates = data.get("candidates") or []
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                return {"content": "".join(p.get("text", "") for p in parts), "tool_calls": []}
            return {"content": "", "tool_calls": []}
        if self.provider_type == "Anthropic":
            content = data.get("content") or []
            text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
            tool_calls = []
            for b in content:
                if b.get("type") == "tool_use":
                    tool_calls.append({"name": b.get("name", ""), "arguments": b.get("input", {})})
            return {"content": text, "tool_calls": tool_calls}
        # OpenAI 兼容
        choices = data.get("choices") or []
        if choices:
            msg = choices[0].get("message") or {}
            content = msg.get("content", "")
            tool_calls = []
            for tc in msg.get("tool_calls") or []:
                fn = tc.get("function") or {}
                args = fn.get("arguments", "")
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                tool_calls.append({"name": fn.get("name", ""), "arguments": args})
            return {"content": content, "tool_calls": tool_calls}
        return {"content": "", "tool_calls": []}

    # ------------------------------------------------------------------
    # 对外调用
    # ------------------------------------------------------------------
    def chat(self, messages: list[dict], model: str | None = None,
             temperature: float | None = None, max_tokens: int | None = None,
             tools: list | None = None) -> dict:
        """执行一次对话补全，返回 {content, tokens, latency_ms, tool_calls}。"""
        model = model or self.provider.default_model or "gpt-4o-mini"
        payload = self.build_payload(messages, model, temperature, max_tokens, tools)
        url = self._chat_url()
        _log_image_debug("chat.payload",
                         provider=self.provider_type,
                         model=self.model,
                         url=url,
                         stats=_payload_stats(payload))

        started = time.time()
        try:
            resp = requests.post(url, json=payload, headers=self._headers(), timeout=self.timeout)
        except requests.RequestException as e:
            self._mark_status(False)
            raise LLMClientError(_("LLM 请求失败: {0}").format(e))
        latency = int((time.time() - started) * 1000)

        if resp.status_code >= 400:
            self._mark_status(False)
            raise LLMClientError(_("LLM 返回错误 {0}: {1}").format(resp.status_code, resp.text[:300]))

        parsed = self._parse_response(resp)
        self._mark_status(True)
        content = parsed["content"]
        tool_calls = parsed["tool_calls"]
        # 简单估算 token 数（中英文混合）
        tokens = max(1, (len(content) + sum(len(t.get("name", "")) for t in tool_calls)) // 2)
        return {"content": content, "tokens": tokens, "latency_ms": latency, "tool_calls": tool_calls}

    def _mark_status(self, ok: bool):
        try:
            self.provider.db_set("status", "OK" if ok else "Failed", update_modified=False)
            self.provider.db_set("last_checked_at", frappe.utils.now(), update_modified=False)
        except Exception:
            # 状态记录失败不影响主流程
            pass

    def test(self) -> dict:
        """测试连接"""
        try:
            result = self.chat([{"role": "user", "content": "ping"}], max_tokens=5)
            return {"ok": True, "reply": result["content"], "latency_ms": result["latency_ms"]}
        except Exception as e:
            return {"ok": False, "error": str(e)}


def call_llm(provider_name: str, messages: list[dict], model: str | None = None,
             temperature: float | None = None, max_tokens: int | None = None) -> dict:
    """便捷入口：创建客户端并调用。"""
    client = LLMClient(provider_name)
    return client.chat(messages, model=model, temperature=temperature, max_tokens=max_tokens)