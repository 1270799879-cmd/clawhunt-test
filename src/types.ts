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

// 角色卡 / 人设卡（批次B + 批次A）：persona 的结构化 JSON 形态
// 批A新增：identity / ishiki / publicIshiki 三段式 + yuan 底座 + role 编排角色
export interface PersonaCard {
  avatar: string;
  name: string;
  tags: string[];
  summary: string;
  tone_example: string;
  system_prompt: string;
  identity: string;
  ishiki: string;
  publicIshiki: string;
  yuan: string;
  role: string;
}

// 三段式 persona 的空值（批次A）
export const EMPTY_THREE_LAYER = { identity: "", ishiki: "", publicIshiki: "", yuan: "", role: "" };

// yuan 底座可选值（批次A）
export const YUAN_OPTIONS = ["hanako", "butter", "ming", "kong"] as const;
// 编排角色可选值（批次A）
export const ROLE_OPTIONS = ["general_manager", "reviewer", "member"] as const;

// 首次使用引导状态（批次B）
export interface OnboardingState {
  ok: boolean;
  user: string;
  onboarded: boolean;
}

// 解析 persona：兼容 JSON 结构化、三段式 JSON 与旧版纯文本三种形态
export function parsePersona(persona?: string | null): PersonaCard | null {
  if (!persona) return null;
  const t = persona.trim();
  if (!(t.startsWith("{") && t.endsWith("}"))) return null;
  try {
    const d = JSON.parse(t);
    if (d && typeof d === "object" && !Array.isArray(d)) {
      return {
        avatar: String(d.avatar ?? ""),
        name: String(d.name ?? ""),
        tags: Array.isArray(d.tags) ? d.tags.map((x: unknown) => String(x)) : [],
        summary: String(d.summary ?? ""),
        tone_example: String(d.tone_example ?? ""),
        system_prompt: String(d.system_prompt ?? ""),
        identity: String(d.identity ?? ""),
        ishiki: String(d.ishiki ?? ""),
        publicIshiki: String(d.publicIshiki ?? ""),
        yuan: String(d.yuan ?? ""),
        role: String(d.role ?? ""),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// 将 PersonaCard 序列化为后端存储的 JSON 字符串
export function serializePersona(card: PersonaCard): string {
  return JSON.stringify(card);
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

// ============================================================
// 组织式编排（Batch B · Task 状态机 + 编排闭环）
// ============================================================

// 编排角色模板（Batch C）：内置总经理 / 质检 / 成员
export interface RoleTemplate {
  key: string;
  label: string;
  description: string;
  yuan: string;
  role: string;
  name: string;
  avatar: string;
  tags: string[];
  identity: string;
  ishiki: string;
  publicIshiki: string;
  summary: string;
  system_prompt: string;
  tools: string[];
}

export type OrchestrationTaskStatus =
  | "pending"
  | "claimed"
  | "executing"
  | "reviewing"
  | "approved"
  | "rejected";

export interface OrchestrationChannel {
  name: string;
  channel_name: string;
  general_manager: string;
  reviewer: string;
  status: string;
  description: string;
  task_count: number;
}

export interface OrchestrationTask {
  name: string;
  title: string;
  description: string;
  status: OrchestrationTaskStatus;
  assigned_to: string | null;
  result: string | null;
  review_note: string | null;
  final_note: string | null;
}

export interface OrchestrationChannelDetail {
  channel: {
    name: string;
    channel_name: string;
    general_manager: string;
    reviewer: string;
    status: string;
    description: string;
  };
  tasks: OrchestrationTask[];
}

export interface DecomposeResult {
  ok: boolean;
  channel: string;
  tasks: { name: string; title: string; status: string }[];
  tokens?: number;
  latency_ms?: number;
  raw?: string;
}

export interface ReviewResult {
  ok: boolean;
  name: string;
  status: string;
  review_note: string;
  approved: boolean;
}

export interface FinalReviewResult {
  ok: boolean;
  passed: boolean;
  channel: string;
  note: string;
}