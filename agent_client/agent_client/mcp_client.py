# -*- coding: utf-8 -*-
"""MCP 客户端模块：连接 MCP 服务器，发现工具，调用工具。

支持三种传输方式：
- stdio：通过命令启动本地 MCP 服务器
- HTTP：MCP Streamable HTTP 传输
- SSE：MCP Server-Sent Events 传输

依赖官方 mcp 库（mcp==2.0.0）。所有函数均为同步封装，内部使用 asyncio。
"""

from __future__ import annotations

import asyncio
import json
import shlex
from typing import Any

import frappe


def _run_async(coro):
    """在 frappe 请求上下文内运行异步协程。"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop:
        # 已在事件循环中（如 bench 控制台），创建新 loop
        return asyncio.run(coro)
    return asyncio.run(coro)


async def _connect_stdio(command: str, args: str):
    from mcp import ClientSession
    from mcp.client.stdio import stdio_client, StdioServerParameters

    params = StdioServerParameters(command=command, args=shlex.split(args or ""))
    return stdio_client(params), ClientSession


async def _connect_http(url: str):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    return streamable_http_client(url), ClientSession


async def _connect_sse(url: str):
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    return sse_client(url=url), ClientSession


async def _discover_tools_inner(server: dict) -> dict:
    """连接 MCP 服务器并发现工具。返回 {ok, tools, error, name}。"""
    transport = server.get("transport", "stdio")
    out = {"ok": False, "tools": [], "error": "", "name": server.get("server_name", "")}
    try:
        if transport == "stdio":
            read, write, session = None, None, None
            if not server.get("command"):
                return {**out, "error": "stdio 传输需配置启动命令"}
            ctx, session_cls = await _connect_stdio(server["command"], server.get("args", ""))
            async with ctx as (read, write):
                async with session_cls(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    out["tools"] = _normalize_tools(tools.tools)
                    out["ok"] = True
        elif transport == "HTTP":
            if not server.get("url"):
                return {**out, "error": "HTTP 传输需配置服务器 URL"}
            ctx, session_cls = await _connect_http(server["url"])
            async with ctx as (read, write):
                async with session_cls(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    out["tools"] = _normalize_tools(tools.tools)
                    out["ok"] = True
        elif transport == "SSE":
            if not server.get("url"):
                return {**out, "error": "SSE 传输需配置服务器 URL"}
            ctx, session_cls = await _connect_sse(server["url"])
            async with ctx as (read, write):
                async with session_cls(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    out["tools"] = _normalize_tools(tools.tools)
                    out["ok"] = True
        else:
            return {**out, "error": f"不支持的传输方式: {transport}"}
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:300]
    return out


def _normalize_tools(tools) -> list[dict]:
    """将 MCP 返回的工具对象规范化为前端可展示的字典。"""
    result = []
    for t in tools:
        result.append({
            "name": getattr(t, "name", ""),
            "description": getattr(t, "description", "") or "",
            "inputSchema": getattr(t, "inputSchema", None) or {},
        })
    return result


def discover_tools(server: dict) -> dict:
    """同步发现 MCP 服务器工具。"""
    return _run_async(_discover_tools_inner(server))


async def _call_tool_inner(server: dict, tool_name: str, arguments: dict) -> dict:
    """连接 MCP 服务器并调用指定工具。"""
    transport = server.get("transport", "stdio")
    out = {"ok": False, "result": "", "error": ""}
    try:
        if transport == "stdio":
            if not server.get("command"):
                return {**out, "error": "stdio 传输需配置启动命令"}
            ctx, session_cls = await _connect_stdio(server["command"], server.get("args", ""))
            async with ctx as (read, write):
                async with session_cls(read, write) as session:
                    await session.initialize()
                    res = await session.call_tool(tool_name, arguments)
                    out["result"] = _format_result(res)
                    out["ok"] = True
        elif transport == "HTTP":
            if not server.get("url"):
                return {**out, "error": "HTTP 传输需配置服务器 URL"}
            ctx, session_cls = await _connect_http(server["url"])
            async with ctx as (read, write):
                async with session_cls(read, write) as session:
                    await session.initialize()
                    res = await session.call_tool(tool_name, arguments)
                    out["result"] = _format_result(res)
                    out["ok"] = True
        elif transport == "SSE":
            if not server.get("url"):
                return {**out, "error": "SSE 传输需配置服务器 URL"}
            ctx, session_cls = await _connect_sse(server["url"])
            async with ctx as (read, write):
                async with session_cls(read, write) as session:
                    await session.initialize()
                    res = await session.call_tool(tool_name, arguments)
                    out["result"] = _format_result(res)
                    out["ok"] = True
        else:
            return {**out, "error": f"不支持的传输方式: {transport}"}
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:300]
    return out


def _format_result(res) -> str:
    """将 MCP 调用结果格式化为文本。"""
    if res is None:
        return json.dumps({"result": "OK"}, ensure_ascii=False)
    # MCP 2.0 的 CallToolResult
    content = getattr(res, "content", None)
    if content is not None:
        parts = []
        for c in content:
            if getattr(c, "type", None) == "text":
                parts.append(getattr(c, "text", ""))
            elif getattr(c, "type", None) == "image":
                parts.append("[图片]")
            else:
                parts.append(json.dumps(c, ensure_ascii=False, default=str))
        return "\n".join(parts) if parts else "OK"
    if isinstance(res, dict):
        return json.dumps(res, ensure_ascii=False, default=str)
    return str(res)


def call_tool(server: dict, tool_name: str, arguments: dict) -> dict:
    """同步调用 MCP 服务器工具。"""
    return _run_async(_call_tool_inner(server, tool_name, arguments))