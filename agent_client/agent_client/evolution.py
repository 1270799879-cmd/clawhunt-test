"""进化引擎：实现 Agent 的自主优化迭代进化。

核心思想：
1. 每次对话后，根据用户反馈（好评/差评）和自评，评估表现
2. 当表现低于阈值时，触发进化：
   - Prompt Tuning：基于自省结果优化 system prompt
   - Memory Update：将重要对话沉淀为长期记忆
   - Parameter Optimization：调整 temperature / max_tokens
   - Behavior Adjustment：生成行为调整建议
3. 记录进化前后的评分，形成 Evolution Record
4. 汇总指标到 Evolution Metric，用于趋势分析
"""

from __future__ import annotations

import json

import frappe
from frappe import _

from agent_client.agent_client.llm_client import LLMClient, LLMClientError


# 指标默认权重
METRIC_WEIGHTS = {
    "avg_response_time": 1000,   # 越低越好，转成反向分
    "avg_tokens": 1000,
    "success_rate": 1,
    "user_satisfaction": 1,
    "self_improvement_rate": 1,
    "conversation_depth": 1,
    "memory_retention": 1,
}


def _record_metric(agent, metric_key, value, period=None):
    """记录一条进化指标。"""
    doc = frappe.new_doc("Evolution Metric")
    doc.agent = agent
    doc.metric_key = metric_key
    doc.metric_value = value
    doc.period = period or frappe.utils.today()
    doc.recorded_at = frappe.utils.now()
    doc.insert(ignore_permissions=True)
    return doc.name


def _create_evolution_record(agent, evolution_type, trigger, score_before, score_after, description, changes=None):
    """创建一条进化记录。"""
    doc = frappe.new_doc("Evolution Record")
    doc.agent = agent
    doc.evolution_type = evolution_type
    doc.status = "Applied"
    doc.trigger = trigger
    doc.score_before = score_before
    doc.score_after = score_after
    doc.description = description
    doc.changes = json.dumps(changes or {}, ensure_ascii=False)
    doc.applied_at = frappe.utils.now()
    doc.insert(ignore_permissions=True)
    return doc.name


def _ask_llm(agent, prompt):
    """统一的 LLM 调用封装。"""
    provider = agent.llm_provider
    model = agent.model
    try:
        result = LLMClient(provider).chat(
            [{"role": "user", "content": prompt}],
            model=model, temperature=0.3, max_tokens=500,
        )
        return result["content"]
    except LLMClientError:
        return ""


def _score_for_agent(agent):
    """计算 Agent 当前的综合评分（0-100）。"""
    metrics = frappe.get_all(
        "Evolution Metric",
        filters={"agent": agent.name},
        fields=["metric_key", "metric_value"],
        order_by="creation desc",
    )
    if not metrics:
        return 50.0

    latest = {}
    for m in metrics:
        if m["metric_key"] not in latest:
            latest[m["metric_key"]] = m["metric_value"]

    score = 50.0
    for key, val in latest.items():
        if key in ("avg_response_time", "avg_tokens"):
            score += max(0, 50 - val / METRIC_WEIGHTS.get(key, 1000) * 50)
        elif key == "success_rate":
            score += val * 50
        elif key == "user_satisfaction":
            score += val * 50
        elif key == "memory_retention":
            score += val * 30
    return round(min(100, max(0, score)), 1)


@frappe.whitelist()
def record_feedback(conversation: str, rating: int, comment: str = ""):
    """记录用户对一次对话的反馈。rating: 1-5 分。

    当评分 <= 3 时自动触发进化反思。
    """
    if not frappe.db.exists("Conversation", conversation):
        frappe.throw(_("会话 {0} 不存在").format(conversation))

    rating = int(rating)
    conv = frappe.get_doc("Conversation", conversation)
    agent = frappe.get_doc("Agent", conv.agent)

    # 记录满意度指标
    satisfaction = rating / 5.0
    _record_metric(agent.name, "user_satisfaction", satisfaction)

    # 若有差评，触发进化
    if rating <= 3:
        return _evolve(agent, conversation, rating, comment)

    return {"ok": True, "evolved": False, "message": "反馈已记录"}


def _evolve(agent, conversation, rating, comment):
    """根据负面反馈触发进化。"""
    score_before = _score_for_agent(agent)

    # 收集最近对话上下文
    recent = frappe.get_all(
        "Conversation Message",
        filters={"conversation": conversation},
        fields=["role", "content"],
        order_by="creation desc",
        limit_page_length=6,
    )
    recent.reverse()
    transcript = "\n".join(f"{m['role']}: {m['content'][:200]}" for m in recent)

    # 1. 自省反思
    reflection_prompt = agent.self_reflection_prompt or (
        "你是智能体 {name} 的自我反思引擎。用户对本次对话给出了 {rating}/5 的评分，"
        "并评价：{comment}\n\n对话记录：\n{transcript}\n\n"
        "请分析可能导致评分低的原因，并给出具体改进建议。"
        "要求返回 JSON：{{\"reason\": \"原因\", \"improve\": \"改进建议\", "
        "\"prompt_fix\": \"对系统提示词的修正建议(若无则留空)\", "
        "\"memory\": \"值得记住的用户偏好或事实(若无则留空)\"}}"
    ).format(name=agent.agent_name, rating=rating, comment=comment or "无", transcript=transcript)

    reflection = _ask_llm(agent, reflection_prompt)
    parsed = _parse_json_response(reflection)

    changes = []
    evolution_type = "Behavior Adjustment"

    # 2. 记忆沉淀
    if parsed.get("memory"):
        try:
            frappe.get_doc({
                "doctype": "Memory Entry",
                "agent": agent.name,
                "content": parsed["memory"],
                "category": "Preference",
                "importance": 8,
                "source": "Evolution",
            }).insert(ignore_permissions=True)
            changes.append({"type": "memory", "detail": parsed["memory"]})
        except Exception:
            pass

    # 3. 提示词优化（若给出修正）
    if parsed.get("prompt_fix"):
        try:
            # 追加为行为调整规则，避免覆盖原始 prompt
            new_rule = f"\n[进化规则] {parsed['prompt_fix']}"
            frappe.db.set_value("Agent", agent.name, "system_prompt",
                                (agent.system_prompt or "") + new_rule, update_modified=True)
            changes.append({"type": "prompt", "detail": parsed["prompt_fix"]})
            evolution_type = "Prompt Tuning"
        except Exception:
            pass

    # 4. 记录进化
    score_after = _score_for_agent(agent)
    reason = parsed.get("reason") or "用户反馈低于阈值"
    improve = parsed.get("improve") or "持续收集反馈优化"
    _create_evolution_record(
        agent.name, evolution_type, "Feedback",
        score_before, score_after,
        f"{reason}。建议：{improve}",
        {"changes": changes, "rating": rating, "comment": comment},
    )
    _record_metric(agent.name, "self_improvement_rate", 1.0)

    return {
        "ok": True, "evolved": True,
        "evolution_type": evolution_type,
        "reason": reason,
        "improve": improve,
        "score_before": score_before,
        "score_after": score_after,
    }


def _parse_json_response(text: str) -> dict:
    """从 LLM 返回文本中提取 JSON。"""
    if not text:
        return {}
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass
    # 尝试提取 ```json ... ``` 块
    import re
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        try:
            return json.loads(m.group(1))
        except (ValueError, TypeError):
            pass
    return {}


@frappe.whitelist()
def run_self_evolution(agent: str):
    """手动触发一次自省进化。"""
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))
    agent_doc = frappe.get_doc("Agent", agent)

    score_before = _score_for_agent(agent_doc)
    # 简单的自省：基于最近指标生成改进建议
    prompt = (
        "你是智能体 {name} 的自省引擎。请审视当前系统提示词：\n{prompt}\n\n"
        "请给出改进建议，返回 JSON：{{\"analysis\": \"当前表现分析\", "
        "\"improve\": \"改进建议\", \"prompt_fix\": \"提示词修正(或留空)\"}}"
    ).format(name=agent_doc.agent_name, prompt=(agent_doc.system_prompt or "无")[:800])

    reflection = _ask_llm(agent_doc, prompt)
    parsed = _parse_json_response(reflection)

    changes = []
    if parsed.get("prompt_fix"):
        frappe.db.set_value("Agent", agent.name, "system_prompt",
                            (agent_doc.system_prompt or "") + f"\n[进化规则] {parsed['prompt_fix']}",
                            update_modified=True)
        changes.append({"type": "prompt", "detail": parsed["prompt_fix"]})

    score_after = _score_for_agent(agent_doc)
    _create_evolution_record(
        agent.name, "Self Reflection", "Self Reflection",
        score_before, score_after,
        parsed.get("analysis") or "自省进化完成",
        {"changes": changes},
    )
    return {"ok": True, "analysis": parsed.get("analysis"), "improve": parsed.get("improve"),
            "score_before": score_before, "score_after": score_after}


@frappe.whitelist()
def record_usage_metrics(agent: str, latency_ms: int | None = None, tokens: int | None = None):
    """记录一次对话的性能指标。"""
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))
    if latency_ms is not None:
        _record_metric(agent, "avg_response_time", latency_ms)
    if tokens is not None:
        _record_metric(agent, "avg_tokens", tokens)
    return {"ok": True}