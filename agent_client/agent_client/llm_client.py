"""LLM 客户端：统一封装对 OpenAI / Anthropic / Gemini / Ollama 等提供商的调用。

所有提供商都通过 HTTP 请求调用，避免引入额外的 SDK 依赖，
这样在 Frappe 的受限环境中也能稳定工作。
"""

from __future__ import annotations

import json
import time

import frappe
import requests

from frappe import _


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
        # OpenAI / Anthropic / Custom 默认走 OpenAI 兼容 /chat/completions
        return f"{self.api_base_url}/chat/completions"

    def build_payload(self, messages: list[dict], model: str, temperature: float | None,
                      max_tokens: int | None, tools: list | None = None) -> dict:
        self.model = model
        temperature = temperature if temperature is not None else self.provider.default_temperature or 0.7
        max_tokens = max_tokens if max_tokens is not None else self.provider.default_max_tokens or 2048

        if self.provider_type == "Ollama":
            payload = {
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": max_tokens},
            }
            if tools:
                payload["tools"] = tools
            return payload
        if self.provider_type == "Gemini":
            return {
                "contents": [
                    {"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]}
                    for m in messages
                    if m.get("content")
                ],
                "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
            }
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools:
            payload["tools"] = tools
        return payload

    def _headers(self) -> dict:
        if self.provider_type == "Ollama":
            return {"Content-Type": "application/json"}
        if self.provider_type == "Gemini":
            return {"Content-Type": "application/json"}
        if self.provider_type == "Anthropic":
            return {
                "Content-Type": "application/json",
                "x-api-key": self.api_key or "",
                "anthropic-version": "2023-06-01",
            }
        return {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key or ''}"}

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