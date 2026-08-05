"""Agent Client 后端 API 入口。

所有方法通过 Frappe 的 /api/method/agent_client.api.* 暴露给前端。
"""

from __future__ import annotations

import json

import frappe
import requests
from frappe import _

from agent_client.agent_client.llm_client import LLMClient, LLMClientError
from agent_client.agent_client.tool_runner import execute_tool, get_tools_schema


# ======================================================================
# LLM Provider 管理
# ======================================================================
@frappe.whitelist()
def list_providers():
    """列出所有启用的 LLM Provider。"""
    providers = frappe.get_all(
        "LLM Provider",
        filters={"enabled": 1},
        fields=["name", "provider_name", "provider_type", "api_base_url", "default_model", "status"],
        order_by="provider_name",
    )
    return {"providers": providers}


@frappe.whitelist()
def get_provider(provider_name: str):
    """获取单个 LLM Provider 详情（含模型列表，不含密钥）。"""
    doc = frappe.get_doc("LLM Provider", provider_name)
    models = [{"model_name": m.model_name, "is_default": m.is_default} for m in doc.available_models]
    return {
        "provider": {
            "name": doc.name,
            "provider_name": doc.provider_name,
            "provider_type": doc.provider_type,
            "api_base_url": doc.api_base_url,
            "default_model": doc.default_model,
            "default_temperature": doc.default_temperature,
            "default_max_tokens": doc.default_max_tokens,
            "timeout_seconds": doc.timeout_seconds,
            "status": doc.status,
            "models": models,
        }
    }


@frappe.whitelist()
def save_provider(provider_data: str):
    """新建或更新 LLM Provider。provider_data 为 JSON 字符串。"""
    data = json.loads(provider_data)
    name = data.get("name")
    key = data.get("api_key")

    if name and frappe.db.exists("LLM Provider", name):
        doc = frappe.get_doc("LLM Provider", name)
    else:
        doc = frappe.new_doc("LLM Provider")
        doc.provider_name = data.get("provider_name")
        doc.provider_type = data.get("provider_type", "OpenAI")

    doc.api_base_url = data.get("api_base_url")
    doc.default_model = data.get("default_model")
    doc.default_temperature = data.get("default_temperature")
    doc.default_max_tokens = data.get("default_max_tokens")
    doc.timeout_seconds = data.get("timeout_seconds")
    doc.enabled = data.get("enabled", 1)
    if key:
        doc.api_key = key

    # 同步模型子表（available_models）
    models = data.get("models") or []
    doc.available_models = []
    for m in models:
        doc.append("available_models", {
            "model_name": m.get("model_name"),
            "is_default": m.get("is_default", 0),
        })

    doc.save(ignore_permissions=True)
    return {"name": doc.name, "ok": True}


@frappe.whitelist()
def delete_provider(provider_name: str):
    """删除 LLM Provider。"""
    if not frappe.db.exists("LLM Provider", provider_name):
        frappe.throw(_("Provider {0} 不存在").format(provider_name))
    frappe.delete_doc("LLM Provider", provider_name, ignore_permissions=True)
    return {"ok": True}


@frappe.whitelist()
def test_provider(provider_name: str):
    """测试 LLM Provider 连接。"""
    client = LLMClient(provider_name)
    return client.test()


@frappe.whitelist()
def fetch_models(provider_name: str):
    """从 LLM Provider 拉取可用模型列表（按 provider_type 调用对应 /models 端点）。

    参考 HanaAgent 的「连接模型提供商 → 自动拉取模型」体验：
      - OpenAI / Custom            : GET {base_url}/models   (Bearer)
      - Anthropic                  : GET {base_url}/v1/models (x-api-key)
      - Gemini                     : GET {base_url}/models?key=...
      - Ollama                     : GET {base_url}/api/tags
    返回 {ok, models: [{model_name, ...}], error?}
    """
    client = LLMClient(provider_name)
    base_url = client.api_base_url
    ptype = client.provider_type
    timeout = client.timeout
    headers = client._headers()

    try:
        if ptype == "Ollama":
            url = f"{base_url}/api/tags"
            resp = requests.get(url, headers=headers, timeout=timeout)
            if resp.status_code >= 400:
                return _model_error(ptype, resp)
            data = resp.json()
            raw = data.get("models") or []
            models = [{"model_name": m.get("name") or m.get("model")} for m in raw if m.get("name") or m.get("model")]
        elif ptype == "Gemini":
            url = f"{base_url}/models"
            params = {"key": client.api_key or ""} if client.api_key else None
            resp = requests.get(url, params=params, headers=headers, timeout=timeout)
            if resp.status_code >= 400:
                return _model_error(ptype, resp)
            raw = resp.json().get("models") or []
            models = []
            for m in raw:
                name = m.get("name") or ""
                if name.startswith("models/"):
                    name = name[len("models/"):]
                if name:
                    models.append({"model_name": name})
        else:
            # OpenAI / Anthropic / Custom：GET {base}/models 或 {base}/v1/models
            candidates = [f"{base_url}/models"]
            if ptype == "Anthropic":
                candidates = [f"{base_url}/v1/models", f"{base_url}/models"]
            resp = None
            for url in candidates:
                resp = requests.get(url, headers=headers, timeout=timeout)
                if resp.status_code < 400:
                    break
            if resp is None or resp.status_code >= 400:
                return _model_error(ptype, resp)
            data = resp.json()
            raw = data.get("data") or []
            models = [{"model_name": m.get("id") or m.get("model_name")} for m in raw if m.get("id") or m.get("model_name")]
    except requests.RequestException as e:
        return {"ok": False, "models": [], "error": _("拉取模型失败: {0}").format(e)}
    except ValueError:
        return {"ok": False, "models": [], "error": _("供应商返回了非 JSON 内容")}

    if not models:
        return {"ok": False, "models": [], "error": _("供应商未返回任何模型")}
    return {"ok": True, "models": models}


def _model_error(ptype, resp):
    """构造拉取模型错误返回。"""
    status = resp.status_code if resp is not None else "unknown"
    detail = resp.text[:200] if resp is not None else ""
    return {"ok": False, "models": [], "error": _("拉取模型失败 (HTTP {0}): {1}").format(status, detail)}


# ======================================================================
# Agent 管理
# ======================================================================
@frappe.whitelist()
def list_agents():
    """列出所有 Agent（含对话统计）。"""
    agents = frappe.get_all(
        "Agent",
        fields=["name", "agent_name", "description", "llm_provider", "model", "status",
                "total_conversations", "total_tasks", "last_active_at"],
        order_by="agent_name",
    )
    return {"agents": agents}


@frappe.whitelist()
def get_agent(agent: str):
    """获取 Agent 详情。"""
    doc = frappe.get_doc("Agent", agent)
    tools = [{"tool": t.tool, "tool_name": t.tool_name, "enabled": t.enabled} for t in doc.tools]
    return {
        "agent": {
            "name": doc.name,
            "agent_name": doc.agent_name,
            "description": doc.description,
            "llm_provider": doc.llm_provider,
            "model": doc.model,
            "temperature": doc.temperature,
            "max_tokens": doc.max_tokens,
            "system_prompt": doc.system_prompt,
            "persona": doc.persona,
            "memory_enabled": doc.memory_enabled,
            "memory_limit": doc.memory_limit,
            "conversation_limit": doc.conversation_limit,
            "evolution_enabled": doc.evolution_enabled,
            "status": doc.status,
            "total_conversations": doc.total_conversations,
            "total_tasks": doc.total_tasks,
            "tools": tools,
        }
    }


@frappe.whitelist()
def save_agent(agent_data: str):
    """新建或更新 Agent。agent_data 为 JSON 字符串。"""
    data = json.loads(agent_data)
    name = data.get("name")

    if name and frappe.db.exists("Agent", name):
        doc = frappe.get_doc("Agent", name)
    else:
        doc = frappe.new_doc("Agent")
        doc.agent_name = data.get("agent_name")

    doc.description = data.get("description")
    doc.llm_provider = data.get("llm_provider")
    doc.model = data.get("model")
    doc.temperature = data.get("temperature")
    doc.max_tokens = data.get("max_tokens")
    doc.system_prompt = data.get("system_prompt")
    doc.persona = data.get("persona")
    doc.memory_enabled = data.get("memory_enabled", 1)
    doc.memory_limit = data.get("memory_limit")
    doc.conversation_limit = data.get("conversation_limit")
    doc.evolution_enabled = data.get("evolution_enabled", 1)
    doc.status = data.get("status", "Active")

    # 同步工具表
    tools = data.get("tools") or []
    doc.tools = []
    for t in tools:
        doc.append("tools", {"tool": t.get("tool"), "tool_name": t.get("tool_name"), "enabled": t.get("enabled", 1)})

    doc.save(ignore_permissions=True)
    return {"name": doc.name, "ok": True}


@frappe.whitelist()
def delete_agent(agent: str):
    """删除 Agent。"""
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))
    frappe.delete_doc("Agent", agent, ignore_permissions=True)
    return {"ok": True}


# ======================================================================
# 对话
# ======================================================================
def _persona_text(persona):
    """把 persona 转成可读文本。兼容两种形态：
    1. 旧版纯文本字符串
    2. 新版结构化 JSON（avatar/name/tags/summary/tone_example/system_prompt）
    """
    if not persona:
        return ""
    text = persona.strip()
    if not (text.startswith("{") and text.endswith("}")):
        return text
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return text
    if not isinstance(data, dict):
        return text
    parts = []
    if data.get("name"):
        parts.append(f"角色：{data['name']}")
    if data.get("summary"):
        parts.append(data["summary"])
    if data.get("tags"):
        parts.append(f"标签：{'、'.join(data['tags'])}")
    if data.get("tone_example"):
        parts.append(f"语气示例：{data['tone_example']}")
    if data.get("system_prompt"):
        parts.append(f"行为准则：{data['system_prompt']}")
    return "\n".join(parts)


def _build_system_messages(agent):
    """根据 Agent 配置构造 system prompt。"""
    system_parts = []
    persona_text = _persona_text(getattr(agent, "persona", None))
    if persona_text:
        system_parts.append(f"【人设】\n{persona_text}")
    if agent.system_prompt:
        system_parts.append(f"【系统指令】\n{agent.system_prompt}")
    if not system_parts:
        system_parts.append("你是一个乐于助人的智能助手。")
    return [{"role": "system", "content": "\n\n".join(system_parts)}]


def _load_memory_context(agent, limit=20):
    """加载 Agent 的长期记忆作为上下文。"""
    if not agent.memory_enabled:
        return ""
    memories = frappe.get_all(
        "Memory Entry",
        filters={"agent": agent.name},
        fields=["content", "category", "importance"],
        order_by="importance desc, creation desc",
        limit_page_length=limit,
    )
    if not memories:
        return ""
    lines = [f"- [{m['category']}] {m['content']}" for m in memories]
    return "以下是关于用户的长期记忆，可据此调整回答：\n" + "\n".join(lines)


def _get_recent_history(conversation, agent, limit=10):
    """获取最近对话历史。"""
    msgs = frappe.get_all(
        "Conversation Message",
        filters={"conversation": conversation.name},
        fields=["role", "content"],
        order_by="creation desc",
        limit_page_length=limit,
    )
    msgs.reverse()
    return [{"role": m["role"].lower(), "content": m["content"]} for m in msgs]


@frappe.whitelist()
def new_conversation(title: str, agent: str, user: str | None = None):
    """创建新会话。"""
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))
    agent_doc = frappe.get_doc("Agent", agent)

    doc = frappe.new_doc("Conversation")
    doc.title = title or f"对话 {agent_doc.agent_name}"
    doc.agent = agent
    doc.status = "Active"
    if user:
        doc.user = user
    doc.llm_provider = agent_doc.llm_provider
    doc.model = agent_doc.model
    doc.total_messages = 0
    doc.insert(ignore_permissions=True)

    # 更新 Agent 统计
    agent_doc.total_conversations = (agent_doc.total_conversations or 0) + 1
    agent_doc.last_active_at = frappe.utils.now()
    agent_doc.save(ignore_permissions=True)

    return {"name": doc.name, "title": doc.title}


@frappe.whitelist()
def list_conversations(agent: str | None = None, archived: int | str | None = 0):
    """列出会话。

    archived: 0=仅未归档（默认），1=仅已归档（status=Archived）。
    注意 URL 查询参数经 Frappe 传入为字符串，需严格解析为整数，
    否则字符串 "0" 会被当作 truthy 误走归档分支。
    """
    try:
        archived = int(archived)
    except (TypeError, ValueError):
        archived = 0
    filters = {}
    if agent:
        filters["agent"] = agent
    if archived:
        filters["status"] = "Archived"
    else:
        filters["status"] = ["!=", "Archived"]
    conversations = frappe.get_all(
        "Conversation",
        filters=filters,
        fields=["name", "title", "agent", "status", "total_messages", "creation", "modified"],
        order_by="creation desc",
    )
    return {"conversations": conversations}


@frappe.whitelist()
def rename_conversation(conversation: str, title: str):
    """重命名会话。"""
    if not title or not title.strip():
        frappe.throw(_("标题不能为空"))
    if not frappe.db.exists("Conversation", conversation):
        frappe.throw(_("会话 {0} 不存在").format(conversation))
    doc = frappe.get_doc("Conversation", conversation)
    doc.title = title.strip()
    doc.save(ignore_permissions=True)
    return {"ok": True, "name": doc.name, "title": doc.title}


@frappe.whitelist()
def archive_conversation(conversation: str, archived: int | str | None = 1):
    """归档 / 恢复会话（复用 status 字段的 Archived 状态）。

    注意表单参数经 Frappe 传入为字符串，需严格解析为整数，
    否则字符串 "0" 会被当作 truthy 误判为归档。
    """
    try:
        archived = int(archived)
    except (TypeError, ValueError):
        archived = 1
    if not frappe.db.exists("Conversation", conversation):
        frappe.throw(_("会话 {0} 不存在").format(conversation))
    doc = frappe.get_doc("Conversation", conversation)
    doc.status = "Archived" if archived else "Active"
    doc.save(ignore_permissions=True)
    return {"ok": True, "name": doc.name, "status": doc.status}


@frappe.whitelist()
def delete_conversation(conversation: str):
    """删除会话并级联删除其消息。"""
    if not frappe.db.exists("Conversation", conversation):
        frappe.throw(_("会话 {0} 不存在").format(conversation))
    conv = frappe.get_doc("Conversation", conversation)
    agent_name = conv.agent

    # 级联删除消息
    frappe.db.delete("Conversation Message", {"conversation": conversation})

    # 删除会话
    frappe.delete_doc("Conversation", conversation, ignore_permissions=True)

    # 回扣 Agent 会话统计
    if agent_name and frappe.db.exists("Agent", agent_name):
        agent_doc = frappe.get_doc("Agent", agent_name)
        agent_doc.total_conversations = max((agent_doc.total_conversations or 1) - 1, 0)
        agent_doc.save(ignore_permissions=True)

    return {"ok": True, "name": conversation}


def _append_message(conversation, role, content, tokens=None, latency_ms=None, agent=None, tools_used=None):
    frappe.get_doc(
        {"doctype": "Conversation Message",
         "conversation": conversation,
         "role": role.capitalize(),
         "content": content,
         "agent": agent,
         "tokens": tokens,
         "latency_ms": latency_ms,
         "tools_used": tools_used,
         }
    ).insert(ignore_permissions=True)
    frappe.db.set_value("Conversation", conversation, "total_messages",
                        frappe.db.count("Conversation Message", {"conversation": conversation}))


@frappe.whitelist()
def list_messages(conversation: str):
    """列出会话的全部消息。"""
    msgs = frappe.get_all(
        "Conversation Message",
        filters={"conversation": conversation},
        fields=["name", "role", "content", "agent", "tokens", "latency_ms", "tools_used", "creation"],
        order_by="creation asc",
    )
    # JSON 字段在 get_all 中返回字符串，需解析为数组供前端直接使用
    for m in msgs:
        if m.get("tools_used"):
            try:
                m["tools_used"] = json.loads(m["tools_used"])
            except (ValueError, TypeError):
                m["tools_used"] = None
    return {"messages": msgs}


@frappe.whitelist()
def send_message(conversation: str, content: str, image_data: str | None = None, model: str | None = None):
    """发送用户消息并获取 Agent 回复（支持工具调用）。"""
    if not frappe.db.exists("Conversation", conversation):
        frappe.throw(_("会话 {0} 不存在").format(conversation))

    conv = frappe.get_doc("Conversation", conversation)
    agent = frappe.get_doc("Agent", conv.agent)

    # 1. 保存用户消息（带图时以文本标记占位入库，避免 base64 落库）
    display_content = content + ("\n[附图片]" if image_data else "")
    _append_message(conversation, "user", display_content, agent=agent.name)

    # 2. 构造完整消息列表
    messages = _build_system_messages(agent)
    memory_ctx = _load_memory_context(agent)
    if memory_ctx:
        messages.append({"role": "system", "content": memory_ctx})
    history = _get_recent_history(conv, agent)
    # 若本条用户消息带图，将历史中当前消息替换为含图片的 content block
    if image_data and history:
        history[-1] = {
            "role": "user",
            "content": [
                {"type": "text", "text": content},
                {"type": "image_url", "image_url": {"url": image_data}},
            ],
        }
    messages.extend(history)

    # 3. 加载 Agent 启用的工具
    tools = get_tools_schema(agent.name)

    # 4. 调用 LLM（支持工具调用循环）
    provider = conv.llm_provider or agent.llm_provider
    model = model or conv.model or agent.model
    client = LLMClient(provider)
    tool_used = []
    max_rounds = 5
    try:
        for _round in range(max_rounds):
            result = client.chat(
                messages, model=model, temperature=agent.temperature,
                max_tokens=agent.max_tokens, tools=tools or None,
            )
            tool_calls = result.get("tool_calls") or []
            if not tool_calls:
                break
            # 执行工具，并把结果作为 tool 消息追加
            for tc in tool_calls:
                name, args = tc.get("name", ""), tc.get("arguments") or {}
                tool_used.append({"name": name, "arguments": args})
                out = execute_tool(name, args)
                messages.append({"role": "assistant", "content": "", "tool_calls": [tc]})
                messages.append({"role": "tool", "content": out, "tool_name": name})
        else:
            result = {"content": _("工具调用次数过多，已停止。"), "tokens": 0, "latency_ms": 0}
    except LLMClientError as e:
        return {"ok": False, "error": str(e)}

    # 5. 保存 Agent 回复
    _append_message(conversation, "assistant", result["content"], agent=agent.name,
                    tokens=result["tokens"], latency_ms=result["latency_ms"],
                    tools_used=json.dumps(tool_used, ensure_ascii=False) if tool_used else None)

    # 6. 更新 Agent 活跃时间
    frappe.db.set_value("Agent", agent.name, "last_active_at", frappe.utils.now(), update_modified=False)

    return {"ok": True, "reply": result["content"], "tokens": result["tokens"],
            "latency_ms": result["latency_ms"], "tools_used": tool_used}


# ======================================================================
# 记忆管理
# ======================================================================
@frappe.whitelist()
def list_memories(agent: str):
    """列出 Agent 的记忆。"""
    memories = frappe.get_all(
        "Memory Entry",
        filters={"agent": agent},
        fields=["name", "content", "category", "importance", "source", "access_count", "creation"],
        order_by="importance desc, creation desc",
    )
    return {"memories": memories}


@frappe.whitelist()
def add_memory(agent: str, content: str, category: str = "Fact", importance: int = 5):
    """手动添加一条记忆。"""
    doc = frappe.new_doc("Memory Entry")
    doc.agent = agent
    doc.content = content
    doc.category = category
    doc.importance = importance
    doc.source = "User Feedback"
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "ok": True}


@frappe.whitelist()
def update_memory(memory: str, importance: int | None = None):
    """更新记忆重要程度。"""
    doc = frappe.get_doc("Memory Entry", memory)
    if importance is not None:
        doc.importance = importance
    doc.save(ignore_permissions=True)
    return {"ok": True, "name": doc.name}


@frappe.whitelist()
def auto_extract_memories(conversation: str):
    """从对话历史自动抽取记忆（LLM 驱动）。

    工作流程：
    1. 获取对话的完整消息历史
    2. 让 LLM 分析对话，抽取出值得长期记忆的事实、偏好、技能等
    3. 批量创建 Memory Entry，去重已存在的相似记忆
    4. 返回抽取结果
    """
    if not frappe.db.exists("Conversation", conversation):
        frappe.throw(_("会话 {0} 不存在").format(conversation))

    conv = frappe.get_doc("Conversation", conversation)
    agent = frappe.get_doc("Agent", conv.agent)

    # 1. 获取完整对话历史
    messages = frappe.get_all(
        "Conversation Message",
        filters={"conversation": conversation},
        fields=["role", "content", "creation"],
        order_by="creation asc",
    )
    conversation_text = "\n\n".join([f"{m['role'].upper()}: {m['content']}" for m in messages])

    # 2. 获取现有记忆，用于去重
    existing_memories = frappe.get_all(
        "Memory Entry",
        filters={"agent": agent.name},
        fields=["content"],
    )
    existing_contents = [m["content"].strip().lower() for m in existing_memories]

    # 3. 调用 LLM 抽取记忆
    provider = conv.llm_provider or agent.llm_provider
    if not provider:
        return {"ok": False, "error": "未配置 LLM Provider，无法进行自动抽取"}

    # 构造抽取 prompt
    system_prompt = """你是一个记忆抽取专家。请分析下面的对话，抽取出值得长期保存的记忆。

记忆分类：
- Fact: 用户的基本信息、事实性陈述（如姓名、职业、项目信息等）
- Preference: 用户的偏好、习惯、喜好（如喜欢简洁设计、讨厌冗长说明等）
- Skill: 用户分享的技能、方法、经验教训
- Experience: 从对话中获得的经验总结
- Goal: 用户的目标、计划、待办事项
- Learned Behavior: 用户期望 AI 如何表现（总是用中文回复、每次回答分点等）

输出格式要求：
请以 JSON 数组格式输出，每个记忆包含：
- content: 记忆内容（简洁、明确，不超过 100 字）
- category: 记忆分类（必须是上述六种之一）
- importance: 重要程度（1-10，1最低，10最高，核心记忆给 8-10）

示例输出：
[
  {"content": "用户叫张三，是一名后端开发工程师", "category": "Fact", "importance": 8},
  {"content": "用户偏好简洁的界面设计，不喜欢多余的装饰", "category": "Preference", "importance": 7}
]

只输出 JSON，不要其他说明文字。如果没有值得长期保存的记忆，输出空数组 []。"""

    from agent_client.agent_client.llm_client import call_llm
    result = call_llm(
        provider,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"请分析以下对话，抽取长期记忆：\n\n{conversation_text}"},
        ],
        model=conv.model or agent.model,
        temperature=0.3,
        max_tokens=1024,
    )

    # 4. 解析 LLM 输出
    content = result["content"].strip()
    # 尝试提取 JSON（处理可能包含 markdown 包裹的情况）
    if content.startswith("```json"):
        content = content.split("\n", 1)[1].rsplit("\n", 1)[0]
    if content.startswith("```"):
        content = content.split("\n", 1)[1].rsplit("\n", 1)[0]

    try:
        extracted = json.loads(content)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"LLM 输出解析失败: {str(e)}, 输出: {content[:200]}"}

    if not isinstance(extracted, list):
        return {"ok": False, "error": f"LLM 输出不是数组: {content[:200]}"}

    # 5. 批量创建记忆（跳过重复）
    created = []
    skipped = 0
    valid_categories = {"Preference", "Fact", "Skill", "Experience", "Goal", "Learned Behavior"}

    for item in extracted:
        content = item.get("content", "").strip()
        category = item.get("category", "Fact")
        importance = int(item.get("importance", 5))

        if not content or len(content) < 5:
            skipped += 1
            continue

        if category not in valid_categories:
            category = "Fact"

        # 简单去重：内容已存在则跳过
        if content.strip().lower() in existing_contents:
            skipped += 1
            continue

        # 创建记忆
        doc = frappe.new_doc("Memory Entry")
        doc.agent = agent.name
        doc.content = content
        doc.category = category
        doc.importance = max(1, min(10, importance))
        doc.source = "Conversation"
        doc.metadata = json.dumps({"source_conversation": conversation}, ensure_ascii=False)
        doc.insert(ignore_permissions=True)
        created.append({"name": doc.name, "content": content, "category": category, "importance": importance})
        existing_contents.append(content.lower())

    return {
        "ok": True,
        "total_extracted": len(extracted),
        "created": len(created),
        "skipped": skipped,
        "memories": created,
    }


@frappe.whitelist()
def get_runtime_metrics(agent: str):
    """获取 Agent 的运行指标趋势（P1 增强：运行指标可视化）。

    聚合维度：
    - 按日期聚合消息数 / token 消耗 / 平均延迟 / 工具调用次数
    - 满意度趋势（来自 user_satisfaction 进化指标）
    - 汇总统计（总消息、总 token、平均延迟、平均满意度、总工具调用）
    """
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))

    # 1. 按日期聚合消息
    messages = frappe.get_all(
        "Conversation Message",
        filters={"agent": agent},
        fields=["name", "tokens", "latency_ms", "tools_used", "creation"],
        order_by="creation asc",
    )
    daily_map: dict[str, dict] = {}
    total_tokens = 0
    total_latency_sum = 0
    total_latency_count = 0
    total_tool_calls = 0

    for m in messages:
        date = str(m["creation"] or "")[:10]
        if not date:
            continue
        bucket = daily_map.setdefault(date, {
            "date": date, "messages": 0, "tokens": 0,
            "latency_sum": 0, "latency_count": 0, "tool_calls": 0,
        })
        bucket["messages"] += 1

        tokens = int(m.get("tokens") or 0)
        bucket["tokens"] += tokens
        total_tokens += tokens

        if m.get("latency_ms"):
            lat = int(m["latency_ms"])
            bucket["latency_sum"] += lat
            bucket["latency_count"] += 1
            total_latency_sum += lat
            total_latency_count += 1

        if m.get("tools_used"):
            try:
                tools = json.loads(m["tools_used"])
                bucket["tool_calls"] += len(tools)
                total_tool_calls += len(tools)
            except (ValueError, TypeError):
                pass

    daily = [
        {
            "date": b["date"],
            "messages": b["messages"],
            "tokens": b["tokens"],
            "avg_latency_ms": round(b["latency_sum"] / b["latency_count"]) if b["latency_count"] else 0,
            "tool_calls": b["tool_calls"],
        }
        for b in daily_map.values()
    ]
    daily.sort(key=lambda x: x["date"])

    # 2. 满意度趋势
    satisfaction = frappe.get_all(
        "Evolution Metric",
        filters={"agent": agent, "metric_key": "user_satisfaction"},
        fields=["metric_value", "recorded_at", "creation"],
        order_by="creation asc",
    )
    satisfaction_trend = []
    for s in satisfaction:
        date = str(s["recorded_at"] or s["creation"] or "")[:10]
        satisfaction_trend.append({"date": date or "unknown", "value": round(float(s["metric_value"]), 2)})

    # 3. 会话统计
    conversations = frappe.get_all(
        "Conversation",
        filters={"agent": agent},
        fields=["name"],
    )

    avg_latency = round(total_latency_sum / total_latency_count) if total_latency_count else 0
    avg_satisfaction = (
        round(sum(x["value"] for x in satisfaction_trend) / len(satisfaction_trend), 2)
        if satisfaction_trend else 0
    )

    return {
        "ok": True,
        "metrics": {
            "daily": daily,
            "satisfaction": satisfaction_trend,
            "summary": {
                "total_messages": len(messages),
                "total_tokens": total_tokens,
                "avg_latency_ms": avg_latency,
                "avg_satisfaction": avg_satisfaction,
                "total_tool_calls": total_tool_calls,
                "conversation_count": len(conversations),
            },
        },
    }


# ======================================================================
# 进化记录
# ======================================================================
@frappe.whitelist()
def list_evolution_records(agent: str):
    """列出 Agent 的进化记录。"""
    records = frappe.get_all(
        "Evolution Record",
        filters={"agent": agent},
        fields=["name", "evolution_type", "status", "trigger", "score_before", "score_after",
                "description", "applied_at", "creation"],
        order_by="creation desc",
    )
    return {"records": records}


@frappe.whitelist()
def list_evolution_metrics(agent: str):
    """列出 Agent 的进化指标。"""
    metrics = frappe.get_all(
        "Evolution Metric",
        filters={"agent": agent},
        fields=["name", "metric_key", "metric_value", "period", "recorded_at", "creation"],
        order_by="creation desc",
    )
    return {"metrics": metrics}


# ======================================================================
# 工具管理
# ======================================================================
@frappe.whitelist()
def list_tools():
    """列出所有工具定义（含分类聚合）。"""
    tools = frappe.get_all(
        "Tool Definition",
        filters={"enabled": 1},
        fields=["name", "tool_name", "description", "tool_type", "category", "implementation_type",
                "usage_count", "success_rate", "example_input", "example_output"],
        order_by="tool_name",
    )
    # 按分类聚合
    categories: dict[str, list] = {}
    for t in tools:
        cat = t.get("category") or "General"
        categories.setdefault(cat, []).append(t)
    return {"tools": tools, "categories": categories}

# ======================================================================
# 系统信息
# ======================================================================
@frappe.whitelist()
def get_system_info():
    """返回后端系统信息（客户端设置中心·系统信息使用）。"""
    return {
        "ok": True,
        "version": frappe.__version__,
        "site": frappe.local.site,
        "app": "agent_client",
    }


# ======================================================================
# MCP 服务器管理
# ======================================================================
@frappe.whitelist()
def list_mcp_servers():
    """列出所有 MCP 服务器。"""
    servers = frappe.get_all(
        "MCP Server",
        fields=["name", "server_name", "server_type", "transport", "command", "args",
                "url", "enabled", "status", "description", "last_checked_at", "last_error"],
        order_by="server_name",
    )
    return {"servers": servers}


@frappe.whitelist()
def get_mcp_server(server_name: str):
    """获取单个 MCP 服务器详情（含发现工具）。"""
    doc = frappe.get_doc("MCP Server", server_name)
    tools = []
    if doc.tools_json:
        try:
            tools = json.loads(doc.tools_json)
        except ValueError:
            tools = []
    # DEBUG 日志：记录返回给前端的工具数据，便于排查问题
    frappe.log_error(
        "get_mcp_server DEBUG server_name={} status={} tools_count={}\ntools_json_len={}\ntools_head={}".format(
            server_name,
            doc.status,
            len(tools),
            len(doc.tools_json or ""),
            json.dumps(tools[:3], ensure_ascii=False)[:500],
        ),
        "MCP get_mcp_server",
    )
    return {
        "server": {
            "name": doc.name,
            "server_name": doc.server_name,
            "server_type": doc.server_type,
            "transport": doc.transport,
            "command": doc.command,
            "args": doc.args,
            "url": doc.url,
            "enabled": doc.enabled,
            "status": doc.status,
            "description": doc.description,
            "last_checked_at": doc.last_checked_at,
            "last_error": doc.last_error,
            "tools": tools,
        }
    }


@frappe.whitelist()
def save_mcp_server(server_data: str):
    """新建或更新 MCP 服务器。server_data 为 JSON 字符串。"""
    data = json.loads(server_data)
    name = data.get("name")

    if name and frappe.db.exists("MCP Server", name):
        doc = frappe.get_doc("MCP Server", name)
    else:
        doc = frappe.new_doc("MCP Server")
        doc.server_name = data.get("server_name")

    doc.server_type = data.get("server_type", "自定义")
    doc.transport = data.get("transport", "stdio")
    doc.command = data.get("command")
    doc.args = data.get("args")
    doc.url = data.get("url")
    doc.enabled = data.get("enabled", 1)
    doc.description = data.get("description")

    # 修复：未显式传 status 时保留原值，仅新建记录默认 Untested
    incoming_status = data.get("status")
    if incoming_status:
        doc.status = incoming_status
    elif doc.is_new():
        doc.status = "Untested"

    # 修复：tools_json 透传——传入 tools 时序列化写入，未传则保留已有工具数据
    incoming_tools = data.get("tools")
    if incoming_tools is not None:
        if isinstance(incoming_tools, str):
            try:
                incoming_tools = json.loads(incoming_tools) if incoming_tools else []
            except ValueError:
                incoming_tools = []
        doc.tools_json = json.dumps(incoming_tools, ensure_ascii=False)

    doc.save(ignore_permissions=True)
    return {"name": doc.name, "ok": True}


@frappe.whitelist()
def delete_mcp_server(server_name: str):
    """删除 MCP 服务器。"""
    if not frappe.db.exists("MCP Server", server_name):
        frappe.throw(_("MCP 服务器 {0} 不存在").format(server_name))
    frappe.delete_doc("MCP Server", server_name, ignore_permissions=True)
    return {"ok": True}


@frappe.whitelist()
def test_mcp_server(server_name: str):
    """测试 MCP 服务器连接，发现其工具并保存。"""
    from agent_client.agent_client.mcp_client import discover_tools

    if not frappe.db.exists("MCP Server", server_name):
        frappe.throw(_("MCP 服务器 {0} 不存在").format(server_name))
    doc = frappe.get_doc("MCP Server", server_name)

    server_dict = {
        "server_name": doc.server_name,
        "transport": doc.transport,
        "command": doc.command,
        "args": doc.args,
        "url": doc.url,
    }
    result = discover_tools(server_dict)

    if result.get("ok"):
        doc.status = "OK"
        doc.tools_json = json.dumps(result.get("tools", []), ensure_ascii=False)
        doc.last_error = None
    else:
        doc.status = "Error"
        doc.last_error = result.get("error")

    doc.last_checked_at = frappe.utils.now()
    doc.save(ignore_permissions=True)

    return {
        "ok": result.get("ok"),
        "tools": result.get("tools", []),
        "error": result.get("error"),
        "name": doc.name,
    }


# ======================================================================
# 首次使用引导（批次B）
# ======================================================================
def _get_current_user():
    """返回当前登录用户（Frappe 会话自带的 user）。"""
    user = frappe.session.user or "Administrator"
    if user == "Guest":
        user = "Administrator"
    return user


def _get_user_profile(user):
    """获取用户画像记录，不存在则创建。"""
    if frappe.db.exists("User Profile", user):
        return frappe.get_doc("User Profile", user)
    doc = frappe.new_doc("User Profile")
    doc.user = user
    doc.onboarded = 0
    doc.insert(ignore_permissions=True)
    return doc


@frappe.whitelist()
def get_onboarding_state():
    """返回当前用户是否已完成首次引导。"""
    user = _get_current_user()
    profile = _get_user_profile(user)
    return {"ok": True, "user": user, "onboarded": bool(profile.onboarded)}


@frappe.whitelist()
def complete_onboarding():
    """标记当前用户已完成首次引导。"""
    user = _get_current_user()
    profile = _get_user_profile(user)
    profile.onboarded = 1
    profile.save(ignore_permissions=True)
    return {"ok": True, "user": user, "onboarded": True}


# ======================================================================
# 角色卡 / 人设卡（批次B）
# ======================================================================
@frappe.whitelist()
def save_persona_card(agent: str, persona_data: str):
    """保存结构化的角色卡 / 人设卡 JSON 到 Agent 的 persona 字段。

    persona_data 为 JSON 字符串，形如：
      {"avatar":"🤖","name":"数据分析师","tags":["专业","耐心"],
       "summary":"...","tone_example":"...","system_prompt":"..."}
    """
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))
    try:
        data = json.loads(persona_data)
        if not isinstance(data, dict):
            raise ValueError("persona_data must be object")
    except (ValueError, TypeError) as e:
        frappe.throw(_("人设卡片数据格式有误: {0}").format(e))

    # 仅保存我们关心的字段，避免脏数据
    clean = {
        "avatar": str(data.get("avatar") or ""),
        "name": str(data.get("name") or ""),
        "tags": [str(t) for t in (data.get("tags") or [])][:10],
        "summary": str(data.get("summary") or ""),
        "tone_example": str(data.get("tone_example") or ""),
        "system_prompt": str(data.get("system_prompt") or ""),
    }
    doc = frappe.get_doc("Agent", agent)
    doc.persona = json.dumps(clean, ensure_ascii=False)
    doc.save(ignore_permissions=True)
    return {"ok": True, "name": doc.name, "persona": doc.persona}
