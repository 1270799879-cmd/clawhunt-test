import { useEffect, useState } from "react";
import type { Agent, ChatMessage, Conversation, EvolutionMetric, EvolutionRecord, LLMProvider, MemoryEntry, RuntimeMetrics, ToolDefinition } from "../types";
import {
  addMemory,
  autoExtractMemories,
  getRuntimeMetrics,
  listEvolutionMetrics,
  listEvolutionRecords,
  listMemories,
  listProviders,
  listMessages,
  listTools,
  testProvider,
} from "../api/client";
import type { ViewKey } from "./IconRail";

interface Props {
  agent: Agent | null;
  conversation: Conversation | null;
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
}

export default function RightPanel({ agent, conversation, view: tab }: Props) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [records, setRecords] = useState<EvolutionRecord[]>([]);
  const [metrics, setMetrics] = useState<EvolutionMetric[]>([]);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [newMemory, setNewMemory] = useState("");
  const [toast, setToast] = useState("");
  const [convMessages, setConvMessages] = useState<ChatMessage[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [runtimeMetrics, setRuntimeMetrics] = useState<RuntimeMetrics | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [toolCategories, setToolCategories] = useState<Record<string, ToolDefinition[]>>({});
  const [toolKeyword, setToolKeyword] = useState("");
  const [toolCategory, setToolCategory] = useState("全部");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const loadMemories = async () => {
    if (!agent) return;
    try {
      const res = await listMemories(agent.name);
      setMemories(res.memories);
    } catch (e) {
      console.error(e);
    }
  };

  const loadEvolution = async () => {
    if (!agent) return;
    try {
      const [r, m] = await Promise.all([listEvolutionRecords(agent.name), listEvolutionMetrics(agent.name)]);
      setRecords(r.records);
      setMetrics(m.metrics);
    } catch (e) {
      console.error(e);
    }
  };

  const loadProviders = async () => {
    try {
      const res = await listProviders();
      setProviders(res.providers);
    } catch (e) {
      console.error(e);
    }
  };

  const loadConversation = async (conv: Conversation) => {
    setConvLoading(true);
    try {
      const res = await listMessages(conv.name);
      setConvMessages(res.messages);
    } catch (e) {
      console.error(e);
    } finally {
      setConvLoading(false);
    }
  };

  const loadRuntimeMetrics = async () => {
    if (!agent) return;
    setRuntimeLoading(true);
    try {
      const res = await getRuntimeMetrics(agent.name);
      setRuntimeMetrics(res.metrics);
    } catch (e) {
      console.error(e);
    } finally {
      setRuntimeLoading(false);
    }
  };

  const loadTools = async () => {
    try {
      const res = await listTools();
      setTools(res.tools);
      setToolCategories(res.categories);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // 切换智能体时清空上个智能体的数据，避免残留
    setMemories([]);
    setRecords([]);
    setMetrics([]);
    setNewMemory("");
    setConvMessages([]);
    setRuntimeMetrics(null);
    setToolKeyword("");
    setToolCategory("全部");
    if (tab === "memory") loadMemories();
    if (tab === "evolution") loadEvolution();
    if (tab === "providers") loadProviders();
    if (tab === "tools") loadTools();
    if (tab === "conversation") {
      loadRuntimeMetrics();
      if (conversation) loadConversation(conversation);
    }
  }, [tab, agent, conversation]);

  const handleAddMemory = async () => {
    const content = newMemory.trim();
    if (!content || !agent) return;
    try {
      await addMemory(agent.name, content, "Fact", 5);
      setNewMemory("");
      await loadMemories();
      showToast("记忆已添加");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "添加失败");
    }
  };

  const handleAutoExtract = async () => {
    if (!agent || !conversation) {
      showToast("请先选择会话后再自动抽取");
      return;
    }
    setExtracting(true);
    try {
      const res = await autoExtractMemories(conversation.name);
      if (res.ok) {
        showToast(`抽取完成：新增 ${res.created} 条，跳过 ${res.skipped} 条`);
        await loadMemories();
      } else {
        showToast(res.error || "自动抽取失败");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "自动抽取失败");
    } finally {
      setExtracting(false);
    }
  };

  const handleTestProvider = async (name: string) => {
    try {
      const res = await testProvider(name);
      showToast(res.ok ? `连接正常 (${res.latency_ms}ms)` : "连接失败");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "测试失败");
    }
  };

  const VIEW_TITLES: Record<ViewKey, string> = {
    memory: "记忆",
    evolution: "进化",
    providers: "模型",
    tools: "工具",
    conversation: "观测",
  };

  return (
    <div className="right-panel">
      <div className="right-panel-head">
        <span className="right-panel-title">{VIEW_TITLES[tab]}</span>
        <span className="right-panel-sub">由底部图标导航切换</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
        {!agent ? (
          <div className="empty">
            <div className="empty-icon">🧠</div>
            <div>请先选择一个智能体</div>
          </div>
        ) : tab === "memory" ? (
          <div>
            <div style={{ padding: "0 12px 12px" }}>
              <button
                className="btn btn-primary"
                style={{ width: "100%", marginBottom: 8 }}
                onClick={handleAutoExtract}
                disabled={extracting}
              >
                {extracting ? "⏳ 抽取中..." : "✨ 自动抽取记忆"}
              </button>
              <div className="list-item-sub" style={{ padding: "0 2px" }}>
                基于当前会话内容，用 LLM 自动抽取长期记忆（去重保存）
              </div>
            </div>
            <div style={{ padding: "0 12px 12px", display: "flex", gap: 8 }}>
              <input
                className="input"
                placeholder="添加一条长期记忆..."
                value={newMemory}
                onChange={(e) => setNewMemory(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddMemory()}
              />
              <button className="btn" onClick={handleAddMemory}>添加</button>
            </div>
            {memories.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🗂️</div>
                <div>暂无记忆</div>
              </div>
            ) : (
              memories.map((m) => (
                <div key={m.name} className="list-item" style={{ cursor: "default" }}>
                  <div className="list-item-title">
                    <span>{m.category === "Preference" ? "❤️" : m.category === "Fact" ? "📌" : "🔍"}</span>
                    <span style={{ flex: 1 }}>{m.content}</span>
                  </div>
                  <div className="list-item-sub">
                    重要度 {m.importance}/10 · {m.source}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : tab === "evolution" ? (
          <div>
            {metrics.length > 0 && (
              <div style={{ display: "flex", gap: 8, padding: "0 12px 10px", flexWrap: "wrap" }}>
                {metrics.slice(0, 4).map((m) => (
                  <div key={m.name} className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
                    <div className="metric-value">{m.metric_value.toFixed(2)}</div>
                    <div className="metric-label">{m.metric_key}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="section-label">进化记录</div>
            {records.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🌱</div>
                <div>暂无进化记录</div>
                <div style={{ fontSize: 12 }}>差评反馈或定时任务将触发进化</div>
              </div>
            ) : (
              <div className="timeline" style={{ padding: "0 12px 12px 30px" }}>
                {records.map((r) => (
                  <div key={r.name} className="tl-item">
                    <div className="tl-title">
                      {r.evolution_type} · {r.trigger}
                    </div>
                    <div className="tl-meta">
                      评分 {r.score_before} → {r.score_after}
                    </div>
                    <div className="tl-desc">{r.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === "providers" ? (
          <div>
            {providers.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🔌</div>
                <div>暂无模型提供商</div>
              </div>
            ) : (
              providers.map((p) => (
                <div key={p.name} className="list-item" style={{ cursor: "default" }}>
                  <div className="list-item-title">
                    <span>{p.provider_type === "Ollama" ? "🦙" : "☁️"}</span>
                    <span style={{ flex: 1 }}>{p.provider_name}</span>
                    <span className={`badge ${p.status === "Active" ? "badge-active" : "badge-warning"}`}>
                      <span className="badge-dot" />
                      {p.status}
                    </span>
                  </div>
                  <div className="list-item-sub">
                    {p.api_base_url} · {p.default_model}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <button className="btn" onClick={() => handleTestProvider(p.name)}>
                      ⚡ 测试连接
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : tab === "tools" ? (
          <ToolMarket
            tools={tools}
            categories={toolCategories}
            keyword={toolKeyword}
            setKeyword={setToolKeyword}
            category={toolCategory}
            setCategory={setToolCategory}
          />
        ) : (
          <div>
            <RuntimeMetricsPanel metrics={runtimeMetrics} loading={runtimeLoading} />
            <ConversationObserver
              conversation={conversation}
              messages={convMessages}
              loading={convLoading}
            />
          </div>
        )}
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

// 对话级可观测性面板（P0 优化）：基于 list_messages 数据做会话级聚合统计
function ConversationObserver({
  conversation,
  messages,
  loading,
}: {
  conversation: Conversation | null;
  messages: ChatMessage[];
  loading: boolean;
}) {
  if (!conversation) {
    return (
      <div className="empty">
        <div className="empty-icon">📊</div>
        <div>请先选择一个会话</div>
      </div>
    );
  }

  if (loading && messages.length === 0) {
    return (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }

  // 聚合统计（纯展示层计算，数据来自后端 list_messages）
  const assistantMsgs = messages.filter((m) => m.role === "Assistant");
  const totalTokens = messages.reduce((acc, m) => acc + (m.tokens || 0), 0);
  const totalLatencyMs = assistantMsgs.reduce((acc, m) => acc + (m.latency_ms || 0), 0);
  const avgLatency = assistantMsgs.length > 0 ? Math.round(totalLatencyMs / assistantMsgs.length) : 0;
  const toolCalls: { name: string; count: number }[] = [];
  messages.forEach((m) => {
    (m.tools_used || []).forEach((t) => {
      const found = toolCalls.find((tc) => tc.name === t.name);
      if (found) found.count += 1;
      else toolCalls.push({ name: t.name, count: 1 });
    });
  });
  const totalToolCalls = toolCalls.reduce((acc, t) => acc + t.count, 0);

  return (
    <div>
      {/* P0 优化：会话溯源信息面板 - 展示基础元信息 */}
      <div style={{ padding: "12px 12px" }}>
        <div className="conv-trace-card">
          <div className="list-item-title">
            <span>📄</span>
            <span style={{ flex: 1 }}>{conversation.title}</span>
            <span className={`badge ${conversation.status === "Active" ? "badge-active" : "badge-warning"}`}>
              <span className="badge-dot" />
              {conversation.status}
            </span>
          </div>
          <div className="list-item-sub">
            智能体：{conversation.agent} · {conversation.total_messages} 条消息
          </div>
          {conversation.creation && (
            <div className="list-item-sub">
              创建：{new Date(conversation.creation).toLocaleString("zh-CN")}
            </div>
          )}
          {conversation.modified && conversation.modified !== conversation.creation && (
            <div className="list-item-sub">
              修改：{new Date(conversation.modified).toLocaleString("zh-CN")}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "0 12px 10px", flexWrap: "wrap" }}>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{messages.length}</div>
          <div className="metric-label">消息数</div>
        </div>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{totalTokens}</div>
          <div className="metric-label">总 Tokens</div>
        </div>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{avgLatency}ms</div>
          <div className="metric-label">平均延迟</div>
        </div>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{totalToolCalls}</div>
          <div className="metric-label">工具调用</div>
        </div>
      </div>

      <div className="section-label">工具调用统计</div>
      {toolCalls.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🛠️</div>
          <div>本次会话未调用工具</div>
        </div>
      ) : (
        <div style={{ padding: "0 12px 12px" }}>
          {toolCalls.map((t) => (
            <div key={t.name} className="list-item" style={{ cursor: "default" }}>
              <div className="list-item-title">
                <span>🛠️</span>
                <span style={{ flex: 1 }}>{t.name}</span>
                <span className="badge badge-active">{t.count} 次</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-label">会话运行日志</div>
      {messages.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📭</div>
          <div>暂无消息</div>
        </div>
      ) : (
        <div className="timeline" style={{ padding: "0 12px 12px 30px" }}>
          {messages.map((m, i) => (
            <div key={i} className="tl-item">
              <div className="tl-title">
                {m.role === "User" ? "用户" : m.role === "Assistant" ? "助手" : "系统"} ·{" "}
                {m.tokens || 0} tokens{m.latency_ms ? ` · ${m.latency_ms}ms` : ""}
              </div>
              <div className="tl-desc">
                {m.content.length > 80 ? `${m.content.slice(0, 80)}…` : m.content}
                {m.tools_used && m.tools_used.length > 0 && (
                  <span> · 调用 {m.tools_used.map((t) => t.name).join(", ")}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Agent 级运行指标趋势看板（P1 增强：运行指标可视化）
function RuntimeMetricsPanel({
  metrics,
  loading,
}: {
  metrics: RuntimeMetrics | null;
  loading: boolean;
}) {
  if (loading && !metrics) {
    return (
      <div className="empty">
        <span className="spinner" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="empty">
        <div className="empty-icon">📈</div>
        <div>暂无运行指标数据</div>
      </div>
    );
  }

  const s = metrics.summary;
  const daily = metrics.daily;
  const satisfaction = metrics.satisfaction;

  return (
    <div>
      <div className="section-label">运行指标总览</div>
      <div style={{ display: "flex", gap: 8, padding: "0 12px 10px", flexWrap: "wrap" }}>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{s.total_messages}</div>
          <div className="metric-label">消息数</div>
        </div>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{s.total_tokens}</div>
          <div className="metric-label">总 Tokens</div>
        </div>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{s.avg_latency_ms}ms</div>
          <div className="metric-label">平均延迟</div>
        </div>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{s.total_tool_calls}</div>
          <div className="metric-label">工具调用</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, padding: "0 12px 10px", flexWrap: "wrap" }}>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">
            {s.avg_satisfaction > 0 ? `${Math.round(s.avg_satisfaction * 100)}%` : "—"}
          </div>
          <div className="metric-label">平均满意度</div>
        </div>
        <div className="metric-card" style={{ margin: 0, flex: 1, minWidth: 90 }}>
          <div className="metric-value">{s.conversation_count}</div>
          <div className="metric-label">会话数</div>
        </div>
      </div>

      {/* Token 消耗趋势 */}
      <div className="section-label">Token 消耗趋势</div>
      <div style={{ padding: "0 12px 12px" }}>
        <TrendChart data={daily.map((d) => ({ label: d.date.slice(5), value: d.tokens }))} suffix="" />
      </div>

      {/* 延迟趋势 */}
      <div className="section-label">平均延迟趋势 (ms)</div>
      <div style={{ padding: "0 12px 12px" }}>
        <TrendChart data={daily.map((d) => ({ label: d.date.slice(5), value: d.avg_latency_ms }))} suffix="ms" />
      </div>

      {/* 满意度趋势 */}
      {satisfaction.length > 0 && (
        <>
          <div className="section-label">满意度趋势</div>
          <div style={{ padding: "0 12px 12px" }}>
            <TrendChart
              data={satisfaction.map((x) => ({ label: x.date.slice(5), value: Math.round(x.value * 100) }))}
              suffix="%"
            />
          </div>
        </>
      )}
    </div>
  );
}

// 轻量 SVG 折线趋势图（无第三方依赖）
function TrendChart({
  data,
  suffix,
  height = 90,
}: {
  data: { label: string; value: number }[];
  suffix: string;
  height?: number;
}) {
  if (data.length === 0) {
    return (
      <div className="empty" style={{ padding: "12px" }}>
        <div className="empty-icon">📉</div>
        <div>暂无数据</div>
      </div>
    );
  }

  const width = 260;
  const pad = 8;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const minVal = Math.min(...data.map((d) => d.value), 0);
  const range = maxVal - minVal || 1;
  const stepX = (width - pad * 2) / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (d.value - minVal) / range);
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - pad} L${points[0].x.toFixed(1)},${height - pad} Z`;

  return (
    <div className="conv-trace-card" style={{ margin: 0 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#trend-fill)" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--bg-2)" stroke="var(--accent)" strokeWidth="1.5" />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--text-2)" }}>
        <span>{data[0].label}</span>
        <span style={{ color: "var(--accent)" }}>
          {data[data.length - 1].value}{suffix}
        </span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

// 工具市场（P1 增强）：分类筛选 + 搜索 + 使用统计
function ToolMarket({
  tools,
  categories,
  keyword,
  setKeyword,
  category,
  setCategory,
}: {
  tools: ToolDefinition[];
  categories: Record<string, ToolDefinition[]>;
  keyword: string;
  setKeyword: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
}) {
  const catNames = ["全部", ...Object.keys(categories)];

  const filtered = tools.filter((t) => {
    const matchCat = category === "全部" || t.category === category;
    const kw = keyword.trim().toLowerCase();
    const matchKw =
      !kw ||
      t.tool_name.toLowerCase().includes(kw) ||
      (t.description || "").toLowerCase().includes(kw);
    return matchCat && matchKw;
  });

  const implLabel = (impl: string) =>
    impl === "Python Function" ? "🐍 Python" : impl === "HTTP Endpoint" ? "🌐 HTTP" : "⚙️ 内置";

  return (
    <div>
      <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          className="input"
          placeholder="搜索工具..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {catNames.map((c) => (
            <button
              key={c}
              className={`btn ${category === c ? "btn-primary" : ""}`}
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={() => setCategory(c)}
            >
              {c}
              {c !== "全部" && <span style={{ opacity: 0.6 }}> ({categories[c]?.length ?? 0})</span>}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🧰</div>
          <div>暂无匹配的工具</div>
        </div>
      ) : (
        <div style={{ padding: "0 12px 12px" }}>
          {filtered.map((t) => (
            <div key={t.name} className="list-item" style={{ cursor: "default", marginBottom: 8 }}>
              <div className="list-item-title">
                <span>🛠️</span>
                <span style={{ flex: 1 }}>{t.tool_name}</span>
                <span className="badge badge-active">{implLabel(t.implementation_type)}</span>
              </div>
              <div className="list-item-sub">{t.description}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 11, color: "var(--text-2)" }}>
                <span>分类：{t.category}</span>
                <span>使用 {t.usage_count || 0} 次</span>
                <span>成功率 {(t.success_rate ?? 0).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}