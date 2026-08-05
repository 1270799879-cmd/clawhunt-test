// ============================================================
// 智能体管理弹窗（阶段 4 · 4.3 Agent 创建/编辑向导 + 工具绑定可视化）
// 借鉴 LobeHub Agent Builder 的引导式创建：
//   系统提示词 / 人设 / 模型 / 记忆开关 / 进化开关 / 并发限制
//   工具绑定用勾选列表并标注来源（内置 / 函数 / HTTP / MCP）
// ============================================================
import { useEffect, useState } from "react";
import type { Agent, AgentDetail, AgentTool, LLMProvider, ToolDefinition, PersonaCard } from "../types";
import { parsePersona, serializePersona, YUAN_OPTIONS, ROLE_OPTIONS } from "../types";
import {
  deleteAgent,
  getAgent,
  listAgents,
  listProviders,
  listTools,
  saveAgent,
  savePersonaCard,
} from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

interface AgentForm {
  name: string;
  agent_name: string;
  description: string;
  llm_provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  persona: string;
  memory_enabled: boolean;
  memory_limit: number;
  conversation_limit: number;
  evolution_enabled: boolean;
  status: string;
  tools: AgentTool[];
}

const EMPTY_FORM: AgentForm = {
  name: "",
  agent_name: "",
  description: "",
  llm_provider: "",
  model: "",
  temperature: 0.7,
  max_tokens: 2048,
  system_prompt: "",
  persona: "",
  memory_enabled: true,
  memory_limit: 50,
  conversation_limit: 10,
  evolution_enabled: true,
  status: "Active",
  tools: [],
};

// 角色卡：头像 emoji 预设（批次B）
const AVATAR_PRESETS = ["🤖", "💼", "🧠", "🛠️", "🎨", "📊", "🧑‍⚕️", "👩‍🏫", "🐱", "🦉", "⚡", "🌟"];

// 角色标签预设（批次B）
const TAG_PRESETS = ["专业", "耐心", "幽默", "严谨", "友好", "高效", "创意", "简洁"];

const EMPTY_CARD: PersonaCard = {
  avatar: "",
  name: "",
  tags: [],
  summary: "",
  tone_example: "",
  system_prompt: "",
  identity: "",
  ishiki: "",
  publicIshiki: "",
  yuan: "",
  role: "",
};

const implLabel = (impl: string) =>
  impl === "Python Function" ? "🐍 函数" : impl === "HTTP Endpoint" ? "🌐 HTTP" : "⚙️ 内置";

export default function AgentDialog({ open, onClose, onChanged }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [availableTools, setAvailableTools] = useState<ToolDefinition[]>([]);
  const [toolCategories, setToolCategories] = useState<Record<string, ToolDefinition[]>>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  // 角色卡编辑态（批次B）：persona 的 JSON 解析结果
  const [personaCard, setPersonaCard] = useState<PersonaCard>(EMPTY_CARD);
  // 旧版纯文本人设（当 persona 不是 JSON 时，作为兼容展示+可切换）
  const [legacyPersona, setLegacyPersona] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([listAgents(), listProviders()]);
      setAgents(a.agents);
      setProviders(p.providers);
      if (p.providers.length > 0) {
        setForm((f) => (f.llm_provider ? f : { ...f, llm_provider: p.providers[0].name }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载智能体失败");
    } finally {
      setLoading(false);
    }
  };

  const loadTools = async () => {
    try {
      const res = await listTools();
      setAvailableTools(res.tools);
      setToolCategories(res.categories);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (open) {
      setMode("list");
      setError("");
      void load();
      void loadTools();
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open]);

  const startCreate = () => {
    setForm({
      ...EMPTY_FORM,
      llm_provider: providers[0]?.name || "",
      model: providers[0]?.default_model || "",
    });
    setError("");
    setMode("form");
  };

  const startEdit = async (a: Agent) => {
    setError("");
    try {
      const res = await getAgent(a.name);
      const d: AgentDetail = res.agent;
      // 解析 persona：结构化 JSON 进卡片，否则存为旧版纯文本兼容
      const card = parsePersona(d.persona);
      setPersonaCard(card ?? EMPTY_CARD);
      setLegacyPersona(card ? "" : (d.persona || ""));
      setForm({
        name: d.name,
        agent_name: d.agent_name,
        description: d.description || "",
        llm_provider: d.llm_provider || "",
        model: d.model || "",
        temperature: d.temperature ?? 0.7,
        max_tokens: d.max_tokens ?? 2048,
        system_prompt: d.system_prompt || "",
        persona: d.persona || "",
        memory_enabled: !!d.memory_enabled,
        memory_limit: d.memory_limit ?? 50,
        conversation_limit: d.conversation_limit ?? 10,
        evolution_enabled: !!d.evolution_enabled,
        status: d.status || "Active",
        tools: d.tools || [],
      });
      setMode("form");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载智能体详情失败");
    }
  };

  const handleDelete = async (a: Agent) => {
    if (!window.confirm(`确定删除智能体「${a.agent_name}」？关联会话与记忆将一并删除。`)) return;
    try {
      await deleteAgent(a.name);
      showToast("已删除");
      onChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleSave = async () => {
    if (!form.agent_name.trim()) {
      setError("请填写智能体名称");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // persona：若卡片有内容则保存为结构化 JSON，否则回退纯文本
      const cardHasContent =
        personaCard.avatar || personaCard.name || personaCard.summary ||
        personaCard.tone_example || personaCard.tags.length > 0;
      const personaValue = cardHasContent
        ? serializePersona(personaCard)
        : legacyPersona;
      const payload: Record<string, unknown> = {
        name: form.name || undefined,
        agent_name: form.agent_name.trim(),
        description: form.description.trim(),
        llm_provider: form.llm_provider,
        model: form.model.trim(),
        temperature: form.temperature,
        max_tokens: form.max_tokens,
        system_prompt: form.system_prompt,
        persona: personaValue,
        memory_enabled: form.memory_enabled ? 1 : 0,
        memory_limit: form.memory_limit,
        conversation_limit: form.conversation_limit,
        evolution_enabled: form.evolution_enabled ? 1 : 0,
        status: form.status,
        tools: form.tools
          .filter((t) => t.enabled)
          .map((t) => ({ tool: t.tool, tool_name: t.tool_name, enabled: 1 })),
      };
      await saveAgent(payload);
      // 若人设卡片非空，也调用 save_persona_card 确保结构化字段精确落库
      if (cardHasContent) {
        try {
          await savePersonaCard(form.name || payload.agent_name as string, { ...personaCard });
        } catch (e) {
          console.error("save_persona_card 失败（不影响主保存）", e);
        }
      }
      showToast(form.name ? "已更新" : "已创建");
      onChanged();
      setMode("list");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleTool = (t: ToolDefinition, enabled: boolean) => {
    setForm((f) => {
      const existing = f.tools.filter((x) => x.tool !== t.name);
      const next = enabled
        ? [...existing, { tool: t.name, tool_name: t.tool_name, enabled: true }]
        : existing;
      return { ...f, tools: next };
    });
  };

  // 批量绑定/解绑某分类下的全部工具（技能管理面板·上下文管理）
  const toggleCategory = (tools: ToolDefinition[], on: boolean) => {
    setForm((f) => {
      const keep = f.tools.filter((x) => !tools.some((t) => t.name === x.tool));
      if (!on) return { ...f, tools: keep };
      const add = tools.map((t) => ({ tool: t.name, tool_name: t.tool_name, enabled: true }));
      return { ...f, tools: [...keep, ...add] };
    });
  };

  const isToolBound = (t: ToolDefinition) =>
    form.tools.some((x) => x.tool === t.name);

  if (!open) return null;

  return (
    <div className="cdate-overlay" onClick={onClose}>
      <div className="cdate-panel mgmt-panel mgmt-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="cdate-head">
          <div>
            <div className="cdate-title">智能体管理</div>
            <div className="cdate-sub">
              {mode === "list" ? "创建 / 编辑 / 删除智能体，配置人设、系统提示词与工具绑定" : form.name ? "编辑智能体" : "创建智能体"}
            </div>
          </div>
          <button className="btn btn-ghost cdate-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {mode === "list" ? (
          <div className="mgmt-list">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={startCreate}>＋ 创建智能体</button>
            </div>
            {loading ? (
              <div className="empty"><span className="spinner" /></div>
            ) : agents.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🤖</div>
                <div>暂无智能体</div>
                <div style={{ fontSize: 12 }}>点击右上角「创建智能体」开始</div>
              </div>
            ) : (
              agents.map((a) => (
                <div key={a.name} className="mgmt-row">
                  <div className="mgmt-row-main">
                    <div className="list-item-title">
                      <span>🤖</span>
                      <span style={{ flex: 1 }}>{a.agent_name}</span>
                      <span className={`badge ${a.status === "Active" ? "badge-active" : "badge-inactive"}`}>
                        <span className="badge-dot" />{a.status}
                      </span>
                    </div>
                    <div className="list-item-sub">
                      {a.model || "未配置模型"} · {a.total_conversations} 次对话
                    </div>
                    {a.description && (
                      <div className="list-item-sub" style={{ marginTop: 2 }}>
                        {a.description}
                      </div>
                    )}
                  </div>
                  <div className="mgmt-row-actions">
                    <button className="btn" onClick={() => startEdit(a)}>编辑</button>
                    <button className="btn btn-danger" onClick={() => handleDelete(a)}>删除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mgmt-form">
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">智能体名称 *</label>
                <input
                  className="input"
                  value={form.agent_name}
                  onChange={(e) => setForm({ ...form, agent_name: e.target.value })}
                  placeholder="如 客服助手 / 数据分析师"
                />
              </div>
              <div className="form-group">
                <label className="form-label">状态</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Draft">Draft</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">描述</label>
              <input
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="一句话说明这个智能体的用途"
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">LLM 供应商</label>
                <select
                  className="input"
                  value={form.llm_provider}
                  onChange={(e) => {
                    const p = providers.find((x) => x.name === e.target.value);
                    setForm({
                      ...form,
                      llm_provider: e.target.value,
                      model: p?.default_model || form.model,
                    });
                  }}
                >
                  <option value="">未选择</option>
                  {providers.map((p) => (
                    <option key={p.name} value={p.name}>{p.provider_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">模型</label>
                <input
                  className="input"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="gpt-4o"
                />
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">温度</label>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">最大 Tokens</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="1"
                  value={form.max_tokens}
                  onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">会话上限</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  value={form.conversation_limit}
                  onChange={(e) => setForm({ ...form, conversation_limit: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-group">
              <div className="form-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>角色卡 / 人设（Persona）</span>
                <span className="list-item-sub" style={{ fontSize: 11 }}>结构化编辑，可保存并在对话中生效</span>
              </div>

              {/* 旧版纯文本人设兼容编辑 */}
              <div className="persona-legacy">
                <label className="switch-label" style={{ marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={legacyPersona !== ""}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setLegacyPersona(personaCard.summary || personaCard.name || "");
                        setPersonaCard(EMPTY_CARD);
                      } else {
                        setLegacyPersona("");
                      }
                    }}
                  />
                  <span className="switch-ui" />
                  使用纯文本人设（旧版）
                </label>
                {legacyPersona !== "" && (
                  <textarea
                    className="input textarea"
                    rows={2}
                    value={legacyPersona}
                    onChange={(e) => setLegacyPersona(e.target.value)}
                    placeholder="如：你是一位资深的、乐于助人的数据分析师，擅长用通俗的语言解释复杂数据。"
                  />
                )}
              </div>

              {/* 结构化角色卡片编辑 */}
              {legacyPersona === "" && (
                <div className="persona-card-edit">
                  <div className="form-group">
                    <label className="form-label">头像（Avatar）</label>
                    <div className="avatar-picker">
                      {AVATAR_PRESETS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          className={`avatar-opt ${personaCard.avatar === e ? "active" : ""}`}
                          onClick={() => setPersonaCard((c) => ({ ...c, avatar: e }))}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label">角色名称</label>
                      <input
                        className="input"
                        value={personaCard.name}
                        onChange={(e) => setPersonaCard((c) => ({ ...c, name: e.target.value }))}
                        placeholder="如 数据分析师 / 客服助手"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">性格标签</label>
                      <div className="tag-picker">
                        {TAG_PRESETS.map((t) => {
                          const on = personaCard.tags.includes(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              className={`tag-opt ${on ? "active" : ""}`}
                              onClick={() =>
                                setPersonaCard((c) =>
                                  on
                                    ? { ...c, tags: c.tags.filter((x) => x !== t) }
                                    : { ...c, tags: [...c.tags, t] }
                                )
                              }
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">性格摘要</label>
                    <textarea
                      className="input textarea"
                      rows={2}
                      value={personaCard.summary}
                      onChange={(e) => setPersonaCard((c) => ({ ...c, summary: e.target.value }))}
                      placeholder="一句话概括这个角色的性格与专长"
                    />
                  </div>

                  <div className="form-grid-2">
                    <div className="form-group">
                      <label className="form-label">yuan 底座（表达机制）</label>
                      <select
                        className="input"
                        value={personaCard.yuan}
                        onChange={(e) => setPersonaCard((c) => ({ ...c, yuan: e.target.value }))}
                      >
                        <option value="">未选择</option>
                        {YUAN_OPTIONS.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <div className="field-hint">hanako·MOOD / butter·PULSE / ming·沉思 / kong·无独白</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">编排角色（role）</label>
                      <select
                        className="input"
                        value={personaCard.role}
                        onChange={(e) => setPersonaCard((c) => ({ ...c, role: e.target.value }))}
                      >
                        <option value="">普通成员</option>
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <div className="field-hint">general_manager·总经理 / reviewer·质检 / member·成员</div>
                    </div>
                  </div>

                  <div className="persona-three-layer">
                    <div className="form-group">
                      <label className="form-label">身份（identity · 他是谁）</label>
                      <textarea
                        className="input textarea"
                        rows={2}
                        value={personaCard.identity}
                        onChange={(e) => setPersonaCard((c) => ({ ...c, identity: e.target.value }))}
                        placeholder="几行身份速写。性格、台词、原则不写在这里。"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">人格主文件（ishiki · 怎样想/怎样说）</label>
                      <textarea
                        className="input textarea"
                        rows={3}
                        value={personaCard.ishiki}
                        onChange={(e) => setPersonaCard((c) => ({ ...c, ishiki: e.target.value }))}
                        placeholder="性格三层、语言指纹、原则、表达约束——人格的核心。"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">对外人格（public-ishiki · 可选）</label>
                      <textarea
                        className="input textarea"
                        rows={2}
                        value={personaCard.publicIshiki}
                        onChange={(e) => setPersonaCard((c) => ({ ...c, publicIshiki: e.target.value }))}
                        placeholder="接待外部访客时的人格与边界（可选但推荐）。"
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">语气示例（Tone Example）</label>
                    <textarea
                      className="input textarea"
                      rows={2}
                      value={personaCard.tone_example}
                      onChange={(e) => setPersonaCard((c) => ({ ...c, tone_example: e.target.value }))}
                      placeholder="例如：回答尽量言简意赅，多用数据说话。"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">系统提示词（System Prompt）</label>
              <textarea
                className="input textarea"
                rows={3}
                value={form.system_prompt}
                onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
                placeholder="定义智能体的行为规则、输出格式与边界。"
              />
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">记忆能力</label>
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={form.memory_enabled}
                    onChange={(e) => setForm({ ...form, memory_enabled: e.target.checked })}
                  />
                  <span className="switch-ui" />
                  {form.memory_enabled ? "已启用" : "已停用"}
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">记忆上限（条）</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="1"
                  value={form.memory_limit}
                  onChange={(e) => setForm({ ...form, memory_limit: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">进化机制</label>
              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={form.evolution_enabled}
                  onChange={(e) => setForm({ ...form, evolution_enabled: e.target.checked })}
                />
                <span className="switch-ui" />
                {form.evolution_enabled ? "已启用（差评反馈 / 定时任务自动进化）" : "已停用"}
              </label>
            </div>

            <div className="form-group">
              <div className="form-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>绑定工具（{form.tools.filter((t) => t.enabled).length} 个已启用）</span>
                <span className="list-item-sub">可多选，来源标注在右侧</span>
              </div>
              {availableTools.length === 0 ? (
                <div className="empty" style={{ padding: 16 }}>
                  <div style={{ fontSize: 12 }}>暂无可用工具</div>
                </div>
              ) : (
                <div className="tool-bind-list">
                  {Object.entries(toolCategories).map(([cat, tools]) => {
                    const boundCount = tools.filter((t) => isToolBound(t)).length;
                    const allBound = boundCount === tools.length;
                    return (
                      <div key={cat} className="tool-bind-group">
                        <div className="tool-bind-cat">
                          <span>{cat}</span>
                          <span className="tool-bind-cat-actions">
                            <button
                              type="button"
                              className="tool-bind-batch"
                              disabled={allBound}
                              onClick={() => toggleCategory(tools, true)}
                            >
                              全选
                            </button>
                            <button
                              type="button"
                              className="tool-bind-batch"
                              disabled={boundCount === 0}
                              onClick={() => toggleCategory(tools, false)}
                            >
                              清空
                            </button>
                          </span>
                        </div>
                        {tools.map((t) => (
                          <label key={t.name} className={`tool-bind-row ${isToolBound(t) ? "bound" : ""}`}>
                            <input
                              type="checkbox"
                              checked={isToolBound(t)}
                              onChange={(e) => toggleTool(t, e.target.checked)}
                            />
                            <span className="tool-bind-name" title={t.description}>
                              🛠️ {t.tool_name}
                            </span>
                            <span className="tool-bind-meta" title={t.description}>
                              {typeof t.usage_count === "number" && t.usage_count > 0
                                ? `${t.usage_count} 次使用`
                                : "未使用"}
                              {typeof t.success_rate === "number" && t.success_rate > 0
                                ? ` · ${t.success_rate}% 成功`
                                : ""}
                            </span>
                            <span className="tool-bind-impl">{implLabel(t.implementation_type)}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="cdate-actions">
              <button className="btn btn-ghost" onClick={() => setMode("list")}>返回</button>
              <div className="cdate-spacer" />
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <span className="spinner" /> : "保存"}
              </button>
            </div>
          </div>
        )}

        <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
      </div>
    </div>
  );
}