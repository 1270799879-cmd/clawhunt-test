#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Batch B: organization orchestration helpers (task state machine + LLM decompose/final review).

遵循设计文档 4.2/4.3/05：Task 状态机 pending→claimed→reviewing→approved/rejected(回退 pending)。
LLM 调用复用 agent_client.llm_client.LLMClient。
"""
from __future__ import annotations

import json

import frappe
from frappe import _

from agent_client.agent_client.llm_client import LLMClient, LLMClientError

# 注意：_persona_text 由 api 模块提供，为避免循环依赖，在 _agent_system_messages 内惰性导入。

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