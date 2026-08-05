#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Batch B: organization orchestration helpers (task state machine + LLM decompose/final review).

遵循设计文档 4.2/4.3/05：Task 状态机 pending→claimed→reviewing→approved/rejected(回退 pending)。
LLM 调用复用 agent_client.llm_client.LLMClient。
"""
from __future__ import annotations

import json
import logging
import re

import frappe
from frappe import _

from agent_client.agent_client.llm_client import LLMClient, LLMClientError

logger = logging.getLogger("agent_client.orchestration")

# 注意：_persona_text 由 api 模块提供，为避免循环依赖，在 _agent_system_messages 内惰性导入。

# 批次C：内置编排角色模板（总经理 / 质检 / 成员）
ROLE_TEMPLATES = [
    {
        "key": "general_manager",
        "label": "总经理",
        "description": "统筹全局：拆解诉求、分派任务、终审判定。",
        "yuan": "ming",
        "role": "general_manager",
        "name": "总办",
        "avatar": "💼",
        "tags": ["统筹", "决策", "严谨"],
        "identity": (
            "我是本协作编排的总经理，负责把整体诉求拆解为清晰、可独立执行、且彼此不重叠的"
            "子任务，分派给对应成员，并在所有人交付后做最终审视。"
        ),
        "ishiki": (
            "冷静、结构化、结果导向。先拆解再行动，不偏袒任何一方，以整条任务的完成质量为目标。"
            "语言简洁有力，多用编号与结论。"
        ),
        "publicIshiki": "对外专业、克制，聚焦任务本身，不做情绪化表达。",
        "summary": "统筹全局的总经理，负责拆解、分派与终审。",
        "system_prompt": "你是编排的总经理，负责将诉求拆解为子任务并做终审判定。",
        "tools": [],
    },
    {
        "key": "reviewer",
        "label": "质检",
        "description": "统一把关：判定成员交付是否合规，不合规回退并附说明。",
        "yuan": "ming",
        "role": "reviewer",
        "name": "质检组",
        "avatar": "🛡️",
        "tags": ["质检", "严谨", "标准"],
        "identity": (
            "我是统一质检员，负责按既定标准判定成员交付是否合规；不合规则回退并附具体说明，"
            "帮助成员改进后重新提交。"
        ),
        "ishiki": (
            "客观、严谨、以标准为准绳。先核对结果是否覆盖任务要求，再判断质量是否达标。"
            "回退意见必须具体、可执行。"
        ),
        "publicIshiki": "只围绕交付质量沟通，给出明确通过与驳回结论。",
        "summary": "统一质检员，按标准把关成员交付。",
        "system_prompt": "你是编排的统一质检员，负责判定成员交付是否合规。",
        "tools": [],
    },
    {
        "key": "member",
        "label": "成员",
        "description": "执行者：领取任务并高质量交付结果。",
        "yuan": "hanako",
        "role": "member",
        "name": "执行组",
        "avatar": "🧑‍🔧",
        "tags": ["执行", "高效", "协作"],
        "identity": (
            "我是执行成员，负责领取任务并高质量交付结果，主动汇报进展，虚心接受质检反馈并改进。"
        ),
        "ishiki": (
            "主动、靠谱、结果导向。接到任务先想清楚交付标准再动手，交付时附上必要的过程与结论。"
            "协作优先，遇到阻塞及时说明。"
        ),
        "publicIshiki": "友善、透明，进度与结果如实汇报。",
        "summary": "执行成员，领取任务并高质量交付。",
        "system_prompt": "你是编排的执行成员，负责领取任务并交付结果。",
        "tools": [],
    },
]

# 批次C：日志脱敏
_SENSITIVE_RE = [
    re.compile(r"(api[_-]?key|token|secret|authorization|bearer)\s*[:=]\s*[\"\']?[^\s\"\',}\]]+", re.I),
    re.compile(r"sk-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"Bearer\s+[\w.\-]{8,}", re.I),
    re.compile(r"data:image/[a-z]+;base64,[A-Za-z0-9+/=]{40,}"),
]


def _mask_log(text):
    """对日志文本做脱敏：擦掉常见敏感 token（API key / token / Bearer / 长 base64）。"""
    if not text:
        return text
    out = str(text)
    out = _SENSITIVE_RE[0].sub(r"\1***", out)
    out = _SENSITIVE_RE[1].sub("***", out)
    out = _SENSITIVE_RE[2].sub("***", out)
    out = _SENSITIVE_RE[3].sub("***", out)
    return out


def list_role_templates():
    return {"ok": True, "templates": ROLE_TEMPLATES}

# 合法状态
STATUS_PENDING = "pending"
STATUS_CLAIMED = "claimed"
STATUS_EXECUTING = "executing"
STATUS_REVIEWING = "reviewing"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"

VALID_STATUSES = {
    STATUS_PENDING, STATUS_CLAIMED, STATUS_EXECUTING,
    STATUS_REVIEWING, STATUS_APPROVED, STATUS_REJECTED,
}


def _get_channel(channel: str):
    if not frappe.db.exists("Orchestration Channel", channel):
        frappe.throw(_("编排 {0} 不存在").format(channel))
    return frappe.get_doc("Orchestration Channel", channel)


def _get_task(task: str):
    if not frappe.db.exists("Orchestration Task", task):
        frappe.throw(_("任务 {0} 不存在").format(task))
    return frappe.get_doc("Orchestration Task", task)


def check_tables():
    """校验编排所需 DocType 表是否已创建。"""
    need = ["Orchestration Channel", "Orchestration Task", "Channel Member"]
    out = {}
    for dt in need:
        out[dt] = frappe.db.table_exists(dt)
    return out


def _agent_system_messages(agent_doc, extra=None):
    """基于 Agent 人设 + yuan + role 组装 system message（复用批次 A 的 _persona_text）。"""
    from agent_client.agent_client.api import _persona_text  # 惰性导入避免循环依赖
    parts = []
    persona_text = _persona_text(agent_doc.persona)
    if persona_text:
        parts.append(f"【人设】\n{persona_text}")
    if agent_doc.system_prompt:
        parts.append(f"【系统指令】\n{agent_doc.system_prompt}")
    if extra:
        parts.append(extra)
    if not parts:
        parts.append("你是一个乐于助人的智能助手。")
    return [{"role": "system", "content": "\n\n".join(parts)}]


def _llm_chat(agent_doc, messages, **kw):
    return LLMClient(agent_doc.llm_provider).chat(
        messages,
        model=agent_doc.model,
        temperature=getattr(agent_doc, "temperature", None) or kw.get("temperature"),
        max_tokens=getattr(agent_doc, "max_tokens", None) or kw.get("max_tokens"),
    )


def _extract_json_list(content: str):
    """从 LLM 输出中提取 JSON 数组（容忍 ```json 包裹 / 前缀文字）。"""
    text = (content or "").strip()
    # 去掉 markdown 代码块
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    # 定位第一个 [ 到最后一个 ]
    s, e = text.find("["), text.rfind("]")
    if s == -1 or e == -1 or e <= s:
        raise ValueError(_("未能在 LLM 输出中找到任务数组"))
    try:
        data = json.loads(text[s:e + 1])
    except (ValueError, TypeError) as ex:
        raise ValueError(_("任务数组 JSON 解析失败: {0}").format(ex))
    if not isinstance(data, list):
        raise ValueError(_("任务数组格式不正确"))
    return data


def decompose_with_llm(channel_doc, request: str):
    """主 Agent（总经理）拆解诉求 → 生成任务清单（pending）。返回任务 title 列表。"""
    gm = frappe.get_doc("Agent", channel_doc.general_manager)
    sys_msg = _agent_system_messages(
        gm,
        "你是一位总经理，负责把整体诉求拆解为清晰、可独立执行、且彼此不重叠的子任务。"
        "请严格输出一个 JSON 数组，每个元素为 {\"title\": \"任务标题\", \"description\": \"任务说明\"}。"
        "只输出 JSON，不要任何多余文字。",
    )
    user_msg = {"role": "user", "content": f"请将以下诉求拆解为子任务：\n{request}"}
    result = _llm_chat(gm, sys_msg + [user_msg])

    try:
        items = _extract_json_list(result["content"])
    except ValueError as e:
        frappe.throw(_("拆解失败: {0}。原始输出: {1}").format(e, result["content"][:500]))

    created = []
    for it in items:
        if not isinstance(it, dict) or not it.get("title"):
            continue
        t = frappe.new_doc("Orchestration Task")
        t.channel = channel_doc.name
        t.title = str(it["title"])[:200]
        t.description = str(it.get("description") or "")[:2000]
        t.status = STATUS_PENDING
        t.insert(ignore_permissions=True)
        created.append({"name": t.name, "title": t.title, "status": t.status})

    return {
        "ok": True,
        "channel": channel_doc.name,
        "tasks": created,
        "tokens": result.get("tokens"),
        "latency_ms": result.get("latency_ms"),
        "raw": result["content"],
    }


def final_review_with_llm(channel_doc):
    """主 Agent（总经理）对全部 approved 任务做终审。通过则 channel done，驳回则回退。"""
    gm = frappe.get_doc("Agent", channel_doc.general_manager)
    tasks = frappe.get_all(
        "Orchestration Task",
        filters={"channel": channel_doc.name},
        fields=["name", "title", "description", "status", "assigned_to", "result", "review_note"],
        order_by="modified asc",
    )
    if not tasks:
        frappe.throw(_("编排 {0} 暂无任务，无法终审").format(channel_doc.name))
    # 状态机约束：仅当全部任务 approved 才可终审
    unapproved = [t for t in tasks if t["status"] != STATUS_APPROVED]
    if unapproved:
        names = "、".join(t["title"] for t in unapproved[:5])
        frappe.throw(_("存在 {0} 个未通过质检的任务，无法终审：{1}").format(
            len(unapproved), names))

    summary_lines = []
    for i, t in enumerate(tasks, 1):
        summary_lines.append(
            f"{i}. 【{t['title']}】\n"
            f"   承接人: {t.get('assigned_to') or '未分配'}\n"
            f"   质检说明: {t.get('review_note') or '无'}\n"
            f"   交付结果: {t.get('result') or '无'}"
        )
    sys_msg = _agent_system_messages(
        gm,
        "你是总经理，负责对汇总结果做最终审视。请判断整体交付是否达标。"
        "严格按以下 JSON 输出：{\"pass\": true/false, \"note\": \"终审结论\"}。只输出 JSON。",
    )
    user_msg = {"role": "user", "content": "以下是汇总的子任务交付：\n\n" + "\n\n".join(summary_lines)}
    result = _llm_chat(gm, sys_msg + [user_msg])

    note = result["content"]
    try:
        parsed = json.loads(note)
        if isinstance(parsed, dict):
            passed = bool(parsed.get("pass"))
            note = str(parsed.get("note") or "")
    except (ValueError, TypeError):
        passed = "true" in note.lower() or "通过" in note.lower() or "达标" in note.lower()

    # 记录终审结论到每个任务
    for t in tasks:
        doc = frappe.get_doc("Orchestration Task", t["name"]) if "name" in t else None
        if doc:
            doc.final_note = note
            doc.save(ignore_permissions=True)

    if passed:
        channel_doc.status = "done"
        channel_doc.save(ignore_permissions=True)
        return {"ok": True, "passed": True, "channel": channel_doc.name, "note": note}
    else:
        # 驳回：所有非 approved 的下游任务回退？这里按设计：终审不通过则整条回退为 pending
        for t in tasks:
            doc = frappe.get_doc("Orchestration Task", t["name"]) if "name" in t else None
            if doc and doc.status == STATUS_APPROVED:
                doc.status = STATUS_PENDING
                doc.final_note = note
                doc.save(ignore_permissions=True)
        return {"ok": True, "passed": False, "channel": channel_doc.name, "note": note}

# 批次C：并发领取 —— 行锁 + 状态复核，确保同一任务只能被一个成员领取
def claim_task_atomic(task: str, agent: str):
    """原子化领取：通过 SELECT ... FOR UPDATE 锁住该行，重新判断 pending 后才更新。
    返回 (doc, conflict)：conflict=True 表示已被他人领取。
    """
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))
    if not frappe.db.exists("Orchestration Task", task):
        frappe.throw(_("任务 {0} 不存在").format(task))

    # 行锁：在事务内 SELECT ... FOR UPDATE 锁住该任务行
    frappe.db.begin()
    try:
        locked = frappe.db.sql(
            "SELECT status FROM `tabOrchestration Task` WHERE name = %s FOR UPDATE",
            task,
            as_dict=True,
        )
        if not locked:
            frappe.db.rollback()
            frappe.throw(_("任务 {0} 不存在").format(task))
        status = locked[0]["status"]
        if status != STATUS_PENDING:
            frappe.db.rollback()
            return None, True
        frappe.db.sql(
            "UPDATE `tabOrchestration Task` SET status = %s, assigned_to = %s WHERE name = %s",
            (STATUS_CLAIMED, agent, task),
        )
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        raise

    doc = frappe.get_doc("Orchestration Task", task)
    return doc, False
