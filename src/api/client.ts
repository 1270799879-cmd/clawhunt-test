// ============================================================
// 后端 API 客户端封装
// 通过 Frappe /api/method 端点调用，带 Host: agent.localhost
// ============================================================

import type {
  Agent,
  AgentDetail,
  ChatMessage,
  Conversation,
  EvolutionMetric,
  EvolutionRecord,
  LLMProvider,
  MCPServer,
  MCPServerDetail,
  MCPTool,
  MemoryEntry,
  ProviderDetail,
  RuntimeMetrics,
  ToolDefinition,
} from "../types";

const API_BASE = "/api/method/agent_client.agent_client.api";
// 模块相对路径（IPC 通道由主进程拼接 /api/method/ 前缀）
const API_MODULE = "agent_client.agent_client.api";

async function request<T>(
  method: string,
  path: string,
  params?: Record<string, unknown>,
  isForm = false,
  base: string = API_BASE
): Promise<T> {
  const headers: Record<string, string> = {
    Host: "agent.localhost",
  };
  let body: string | URLSearchParams | undefined;
  let url = `${base}.${path}`;

  if (method === "GET") {
    if (params) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      });
      url += `?${qs.toString()}`;
    }
  } else {
    if (isForm) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) (body as URLSearchParams).set(k, String(v));
      });
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(params || {});
    }
  }

  const resp = await fetch(url, { method, headers, body, credentials: "include" });
  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg = data?.exception || data?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data?.message ?? data;
}

// ---------- 登录 ----------
export async function doLogin(username: string, password: string): Promise<void> {
  const resp = await fetch("/api/method/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "agent.localhost",
    },
    body: JSON.stringify({ usr: username, pwd: password }),
    credentials: "include",
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.message || `登录失败 (HTTP ${resp.status})`);
  }
}

// ---------- Provider ----------
export const listProviders = () =>
  request<{ providers: LLMProvider[] }>("GET", "list_providers");
export const getProvider = (name: string) =>
  request<{ provider: ProviderDetail }>("GET", "get_provider", { provider_name: name });
export const saveProvider = (data: Record<string, unknown>) =>
  request<{ name: string; ok: boolean }>("POST", "save_provider", { provider_data: JSON.stringify(data) });
export const deleteProvider = (name: string) =>
  request<{ ok: boolean }>("POST", "delete_provider", { provider_name: name });
export const testProvider = (name: string) =>
  request<{ ok: boolean; reply: string; latency_ms: number }>("GET", "test_provider", { provider_name: name });

// ---------- Agent ----------
// 桌面端优先走 IPC 通道（统一数据获取方式），失败回退 HTTP
export const listAgents = async (): Promise<{ agents: Agent[] }> => {
  const api = window.agentClientDesktop;
  if (api?.apiCall) {
    try {
      const res = await api.apiCall("GET", `${API_MODULE}.list_agents`);
      if (res.ok) return (res.data?.message ?? res.data) as { agents: Agent[] };
      throw new Error(res.error || `HTTP ${res.status}`);
    } catch (e) {
      console.error("[client] IPC listAgents 失败，回退 HTTP:", e);
    }
  }
  return request<{ agents: Agent[] }>("GET", "list_agents");
};
export const getAgent = (name: string) =>
  request<{ agent: AgentDetail }>("GET", "get_agent", { agent: name });
export const saveAgent = (data: Record<string, unknown>) =>
  request<{ name: string; ok: boolean }>("POST", "save_agent", { agent_data: JSON.stringify(data) });
export const deleteAgent = (name: string) =>
  request<{ ok: boolean }>("POST", "delete_agent", { agent: name });

// ---------- Conversation ----------
export const newConversation = (title: string, agent: string, user?: string) =>
  request<{ name: string; title: string }>("POST", "new_conversation", { title, agent, user }, true);
export const listConversations = async (agent?: string): Promise<{ conversations: Conversation[] }> => {
  const api = window.agentClientDesktop;
  if (api?.apiCall) {
    try {
      const res = await api.apiCall("GET", `${API_MODULE}.list_conversations`, { agent });
      if (res.ok) return (res.data?.message ?? res.data) as { conversations: Conversation[] };
      throw new Error(res.error || `HTTP ${res.status}`);
    } catch (e) {
      console.error("[client] IPC list_conversations 失败，回退 HTTP:", e);
    }
  }
  return request<{ conversations: Conversation[] }>("GET", "list_conversations", { agent });
};
export const listMessages = (conversation: string) =>
  request<{ messages: ChatMessage[] }>("GET", "list_messages", { conversation });
export const sendMessage = (conversation: string, content: string, model?: string) =>
  request<{
    ok: boolean;
    reply: string;
    tokens: number;
    latency_ms: number;
    error?: string;
    tools_used?: { name: string; arguments: Record<string, unknown> }[];
  }>(
    "POST",
    "send_message",
    model ? { conversation, content, model } : { conversation, content },
    true
  );

// ---------- Memory ----------
export const listMemories = (agent: string) =>
  request<{ memories: MemoryEntry[] }>("GET", "list_memories", { agent });
export const addMemory = (agent: string, content: string, category: string, importance: number) =>
  request<{ name: string; ok: boolean }>("POST", "add_memory", { agent, content, category, importance }, true);
export const updateMemory = (memory: string, importance?: number) =>
  request<{ ok: boolean; name: string }>("POST", "update_memory", { memory, importance }, true);
export const autoExtractMemories = (conversation: string) =>
  request<{
    ok: boolean;
    total_extracted: number;
    created: number;
    skipped: number;
    error?: string;
    memories: { name: string; content: string; category: string; importance: number }[];
  }>("POST", "auto_extract_memories", { conversation }, true);

// ---------- Evolution ----------
export const listEvolutionRecords = (agent: string) =>
  request<{ records: EvolutionRecord[] }>("GET", "list_evolution_records", { agent });
export const listEvolutionMetrics = (agent: string) =>
  request<{ metrics: EvolutionMetric[] }>("GET", "list_evolution_metrics", { agent });
export const getRuntimeMetrics = (agent: string) =>
  request<{ ok: boolean; metrics: RuntimeMetrics }>("GET", "get_runtime_metrics", { agent });

// ---------- Tools ----------
export const listTools = async (): Promise<{ tools: ToolDefinition[]; categories: Record<string, ToolDefinition[]> }> => {
  const api = window.agentClientDesktop;
  if (api?.apiCall) {
    try {
      const res = await api.apiCall("GET", `${API_MODULE}.list_tools`);
      if (res.ok) return (res.data?.message ?? res.data) as { tools: ToolDefinition[]; categories: Record<string, ToolDefinition[]> };
      throw new Error(res.error || `HTTP ${res.status}`);
    } catch (e) {
      console.error("[client] IPC list_tools 失败，回退 HTTP:", e);
    }
  }
  return request<{ tools: ToolDefinition[]; categories: Record<string, ToolDefinition[]> }>("GET", "list_tools");
};

// ---------- 反馈（record_feedback 定义在 evolution.py，需调用 evolution 模块路径） ----------
export const recordFeedback = (conversation: string, rating: number, comment: string) =>
  request<{ ok: boolean; evolved: boolean; message?: string }>(
    "POST",
    "record_feedback",
    { conversation, rating, comment },
    true,
    "/api/method/agent_client.agent_client.evolution"
  );

// ---------- MCP 服务器管理（阶段 4 · P1） ----------
export const listMCPServers = () =>
  request<{ servers: MCPServer[] }>("GET", "list_mcp_servers");
export const getMCPServer = (serverName: string) =>
  request<{ server: MCPServerDetail }>("GET", "get_mcp_server", { server_name: serverName });
export const saveMCPServer = (data: Record<string, unknown>) =>
  request<{ name: string; ok: boolean }>("POST", "save_mcp_server", { server_data: JSON.stringify(data) });
export const deleteMCPServer = (serverName: string) =>
  request<{ ok: boolean }>("POST", "delete_mcp_server", { server_name: serverName });
export const testMCPServer = (serverName: string) =>
  request<{ ok: boolean; tools: MCPTool[]; error: string; name: string }>(
    "POST",
    "test_mcp_server",
    { server_name: serverName }
  );