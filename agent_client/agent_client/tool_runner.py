"""工具执行器：将 Agent 配置的工具转换为 LLM 可调用的 schema，并执行工具调用。

支持三种工具实现类型：
- Built-in：内置 Python 工具（如获取当前时间）
- Python Function：读取 Tool Definition 的 python_function 代码，exec 定义函数后调用
- HTTP Endpoint：对 http_endpoint 发起 HTTP 请求
"""

from __future__ import annotations

import json
import time

import frappe
import requests

from frappe import _


# ----------------------------------------------------------------------
# 内置工具
# ----------------------------------------------------------------------
def _builtin_get_current_time(**kwargs) -> dict:
    """返回当前日期时间。"""
    return {"result": frappe.utils.now()}


def _builtin_get_date(**kwargs) -> dict:
    """返回当前日期。"""
    return {"result": frappe.utils.today()}


# 内置工具注册表：name -> (函数, 描述, 参数 schema)
BUILTIN_TOOLS = {
    "get_current_time": {
        "func": _builtin_get_current_time,
        "description": "获取当前日期和时间字符串",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
    "get_date": {
        "func": _builtin_get_date,
        "description": "获取当前日期（YYYY-MM-DD）",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


def _load_tool_definitions(agent_name: str) -> list[dict]:
    """获取 Agent 启用的工具定义列表。"""
    agent = frappe.get_doc("Agent", agent_name)
    defs = []
    for t in agent.tools:
        if not t.enabled or not t.tool:
            continue
        doc = frappe.get_doc("Tool Definition", t.tool)
        params = doc.parameters_schema or {}
        if isinstance(params, str):
            try:
                params = json.loads(params)
            except ValueError:
                params = {}
        defs.append({
            "name": doc.tool_name,
            "description": doc.description or "",
            "tool_type": doc.tool_type,
            "implementation_type": doc.implementation_type,
            "parameters_schema": params,
            "python_function": doc.python_function,
            "http_endpoint": doc.http_endpoint,
            "http_method": doc.http_method,
            "doc_name": doc.name,
        })
    return defs


def get_tools_schema(agent_name: str) -> list[dict]:
    """将 Agent 启用的工具转换为 LLM 的 tools schema。

    总是包含内置工具（get_current_time / get_date），
    再叠加 Agent 通过 Tool Definition 启用的工具。
    """
    schema = []
    # 内置工具始终可用
    for name, spec in BUILTIN_TOOLS.items():
        schema.append({
            "type": "function",
            "function": {
                "name": name,
                "description": spec["description"],
                "parameters": spec["parameters"] or {"type": "object", "properties": {}},
            },
        })
    # Agent 启用的 Tool Definition 工具
    for t in _load_tool_definitions(agent_name):
        schema.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters_schema"] or {"type": "object", "properties": {}},
            },
        })
    return schema


def execute_tool(tool_name: str, arguments: dict) -> str:
    """执行一个工具，返回结果字符串（供 LLM 读取）。"""
    # 1. 内置工具
    if tool_name in BUILTIN_TOOLS:
        try:
            result = BUILTIN_TOOLS[tool_name]["func"](**arguments)
            return json.dumps(result, ensure_ascii=False)
        except Exception as e:
            return json.dumps({"error": str(e)}, ensure_ascii=False)

    # 2. 查找 Tool Definition
    if not frappe.db.exists("Tool Definition", {"tool_name": tool_name}):
        return json.dumps({"error": _("工具 {0} 不存在").format(tool_name)}, ensure_ascii=False)
    doc = frappe.get_doc("Tool Definition", {"tool_name": tool_name})

    try:
        if doc.implementation_type == "Python Function":
            result = _exec_python_function(doc, arguments)
        elif doc.implementation_type == "HTTP Endpoint":
            result = _exec_http_endpoint(doc, arguments)
        else:
            result = {"error": _("不支持的实现类型: {0}").format(doc.implementation_type)}
    except Exception as e:
        result = {"error": str(e)}

    # 记录调用统计
    _record_usage(doc, ok="error" not in result)
    return json.dumps(result, ensure_ascii=False)


def _exec_python_function(doc, arguments: dict) -> dict:
    """执行 Tool Definition 中定义的 Python 函数。"""
    code = doc.python_function or ""
    if not code.strip():
        return {"error": _("工具未配置 Python 函数")}

    # 在受限命名空间执行函数定义
    namespace: dict = {}
    exec(code, namespace)  # noqa: S102 - 本地系统，工具由管理员配置

    # 找到可调用函数（字段中定义的函数名优先）
    func = namespace.get(doc.function_name) if doc.function_name else None
    if func is None:
        func = next((v for v in namespace.values() if callable(v) and not isinstance(v, type)), None)
    if func is None:
        return {"error": _("未找到可调用的函数")}

    result = func(**arguments)
    return {"result": result}


def _exec_http_endpoint(doc, arguments: dict) -> dict:
    """对 HTTP Endpoint 发起请求。"""
    endpoint = doc.http_endpoint or ""
    if not endpoint:
        return {"error": _("工具未配置 HTTP Endpoint")}
    method = (doc.http_method or "GET").upper()
    try:
        if method == "GET":
            resp = requests.get(endpoint, params=arguments, timeout=20)
        else:
            resp = requests.request(method, endpoint, json=arguments, timeout=20)
        if resp.status_code >= 400:
            return {"error": _("HTTP {0}: {1}").format(resp.status_code, resp.text[:200])}
        try:
            return {"result": resp.json()}
        except ValueError:
            return {"result": resp.text[:500]}
    except requests.RequestException as e:
        return {"error": str(e)}


def _record_usage(doc, ok: bool):
    """更新工具调用统计。"""
    try:
        doc.usage_count = (doc.usage_count or 0) + 1
        # 简化成功率：最近一次成功即 100%
        doc.success_rate = 100 if ok else 0
        doc.save(ignore_permissions=True)
    except Exception:
        pass