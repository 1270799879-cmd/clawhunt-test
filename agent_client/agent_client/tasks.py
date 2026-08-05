"""后台任务：自动任务执行与定时调度。

由于我们构建的是"对话+自动化"混合系统，这里提供：
- run_agent_task：执行一个 Agent 任务（可被按钮或定时触发）
- 定时调度：定期对启用了进化的 Agent 执行自省进化
"""

from __future__ import annotations

import frappe
from frappe import _

from agent_client.agent_client.llm_client import LLMClient, LLMClientError
from agent_client.agent_client.api import _persona_text


@frappe.whitelist()
def run_agent_task(agent: str, task: str, context: str | None = None):
    """执行一个 Agent 任务。

    Args:
        agent: Agent 名称
        task: 任务描述
        context: 可选的任务上下文
    """
    if not frappe.db.exists("Agent", agent):
        frappe.throw(_("Agent {0} 不存在").format(agent))

    agent_doc = frappe.get_doc("Agent", agent)

    # 构造系统提示词
    system_parts = []
    persona_text = _persona_text(agent_doc.persona)
    if persona_text:
        system_parts.append(f"【人设】\n{persona_text}")
    if agent_doc.system_prompt:
        system_parts.append(f"【系统指令】\n{agent_doc.system_prompt}")
    system_parts.append(f"【任务】\n{task}")
    if context:
        system_parts.append(f"【上下文】\n{context}")
    system_parts.append("请直接输出任务结果，不要多余的对话。")

    messages = [{"role": "system", "content": "\n\n".join(system_parts)}]

    # 记录 Agent Task
    task_doc = frappe.new_doc("Agent Task")
    task_doc.agent = agent
    task_doc.task = task
    task_doc.status = "Running"
    task_doc.input_data = context or ""
    task_doc.insert(ignore_permissions=True)
    frappe.db.commit()

    try:
        result = LLMClient(agent_doc.llm_provider).chat(
            messages, model=agent_doc.model,
            temperature=agent_doc.temperature, max_tokens=agent_doc.max_tokens,
        )
    except LLMClientError as e:
        task_doc.status = "Failed"
        task_doc.error = str(e)
        task_doc.save(ignore_permissions=True)
        frappe.db.commit()
        return {"ok": False, "error": str(e)}

    # 更新任务记录
    task_doc.status = "Completed"
    task_doc.output_data = result["content"]
    task_doc.tokens_used = result["tokens"]
    task_doc.latency_ms = result["latency_ms"]
    task_doc.save(ignore_permissions=True)

    # 更新 Agent 统计
    agent_doc.total_tasks = (agent_doc.total_tasks or 0) + 1
    agent_doc.last_active_at = frappe.utils.now()
    agent_doc.save(ignore_permissions=True)

    return {"ok": True, "task_name": task_doc.name, "output": result["content"],
            "tokens": result["tokens"], "latency_ms": result["latency_ms"]}


@frappe.whitelist()
def list_tasks(agent: str | None = None, status: str | None = None):
    """列出 Agent 任务。"""
    filters = {}
    if agent:
        filters["agent"] = agent
    if status:
        filters["status"] = status
    tasks = frappe.get_all(
        "Agent Task",
        filters=filters,
        fields=["name", "agent", "task", "status", "tokens_used", "latency_ms", "creation"],
        order_by="creation desc",
        limit_page_length=50,
    )
    return {"tasks": tasks}


def scheduled_evolution():
    """定时任务：对启用进化的 Agent 执行周期性自省进化。"""
    from agent_client.agent_client.evolution import run_self_evolution

    agents = frappe.get_all("Agent", filters={"evolution_enabled": 1, "status": "Active"}, pluck="name")
    for agent in agents:
        try:
            run_self_evolution(agent)
        except Exception as e:
            frappe.log_error(f"定时进化失败 {agent}: {e}", "agent_client.scheduled_evolution")