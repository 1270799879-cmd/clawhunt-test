// ============================================================
// 类型定义
// ============================================================

export interface LLMProvider {
  name: string;
  provider_name: string;
  provider_type: string;
  api_base_url: string;
  default_model: string;
  status: string;
}

export interface ProviderModel {
  model_name: string;
  is_default: boolean;
}

export interface ProviderDetail extends LLMProvider {
  default_temperature: number;
  default_max_tokens: number;
  timeout_seconds: number;
  models: ProviderModel[];
}

export interface Agent {
  name: string;
  agent_name: string;
  description: string;
  llm_provider: string;
  model: string;
  status: string;
  total_conversations: number;
  total_tasks: number;
  last_active_at: string | null;
}

export interface AgentDetail extends Agent {
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  persona: string;
  memory_enabled: boolean;
  memory_limit: number;
  conversation_limit: number;
  evolution_enabled: boolean;
  tools: AgentTool[];
}

export interface AgentTool {
  tool: string;
  tool_name: string;
  enabled: boolean;
}

export interface Conversation {
  name: string;
  title: string;
  agent: string;
  status: string;
  total_messages: number;
  creation: string;
  modified: string;
}

export interface ChatMessage {
  name: string;
  role: string;
  content: string;
  agent: string;
  tokens: number;
  latency_ms: number;
  creation: string;
  tools_used?: { name: string; arguments: Record<string, unknown> }[];
}

export interface MemoryEntry {
  name: string;
  content: string;
  category: string;
  importance: number;
  source: string;
  access_count: number;
  creation: string;
}

export interface EvolutionRecord {
  name: string;
  evolution_type: string;
  status: string;
  trigger: string;
  score_before: number;
  score_after: number;
  description: string;
  applied_at: string;
  creation: string;
}

export interface EvolutionMetric {
  name: string;
  metric_key: string;
  metric_value: number;
  period: string;
  recorded_at: string;
  creation: string;
}

// 运行指标趋势数据（P1 增强：运行指标可视化）
export interface RuntimeDailyMetric {
  date: string;
  messages: number;
  tokens: number;
  avg_latency_ms: number;
  tool_calls: number;
}

export interface RuntimeSatisfactionTrend {
  date: string;
  value: number;
}

export interface RuntimeSummary {
  total_messages: number;
  total_tokens: number;
  avg_latency_ms: number;
  avg_satisfaction: number;
  total_tool_calls: number;
  conversation_count: number;
}

export interface RuntimeMetrics {
  daily: RuntimeDailyMetric[];
  satisfaction: RuntimeSatisfactionTrend[];
  summary: RuntimeSummary;
}

export interface ToolDefinition {
  name: string;
  tool_name: string;
  description: string;
  tool_type: string;
  category: string;
  implementation_type: string;
  usage_count: number;
  success_rate: number;
  example_input?: string;
  example_output?: string;
}

// ---------- MCP 服务器管理（阶段 4 · P1） ----------
export interface MCPServer {
  name: string;
  server_name: string;
  server_type: string;
  transport: string;
  command: string | null;
  args: string | null;
  url: string | null;
  enabled: boolean;
  status: string;
  description: string;
  last_checked_at: string | null;
  last_error: string | null;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPServerDetail extends MCPServer {
  tools: MCPTool[];
}