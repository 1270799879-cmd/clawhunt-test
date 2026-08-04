# MCP 修复同步说明

本分支用于同步 Agent Client 项目的 MCP 服务器管理修复代码（本地两个仓库尚无远程，经 GitHub 连接器按文件内容推送）。

## 修复内容
- 后端 `save_mcp_server`：新增 `tools_json` 透传（传入 tools 时序列化写入，未传则保留已有工具数据）；未显式传 status 时保留原值，仅新建记录默认 Untested
- 前端 `MCPDialog.tsx`：编辑保存时透传当前已发现工具列表，避免保存后工具列表被清空

## 对应本地提交
- 后端仓库 agent_client：`b11c4b9 fix(mcp): 保存时保留原 status 并支持工具列表透传`
- 前端仓库 agent-client-web：`adbba62 fix(mcp): 编辑保存时透传已发现工具列表`

## 文件路径映射
- `backend/agent_client/agent_client/api.py` ← 后端仓库 `agent_client/agent_client/api.py`
- `frontend/src/components/MCPDialog.tsx` ← 前端仓库 `src/components/MCPDialog.tsx`
