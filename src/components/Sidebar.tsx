import { useEffect, useState } from "react";
import type { Agent, Conversation } from "../types";
import { listAgents, listConversations, newConversation } from "../api/client";

interface Props {
  selectedAgent: Agent | null;
  onSelectAgent: (a: Agent) => void;
  selectedConversation: Conversation | null;
  onSelectConversation: (c: Conversation) => void;
}

export default function Sidebar({
  selectedAgent,
  onSelectAgent,
  selectedConversation,
  onSelectConversation,
}: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadAgents = async () => {
    try {
      const res = await listAgents();
      setAgents(res.agents);
    } catch (e) {
      console.error(e);
    }
  };

  const loadConversations = async (agent?: string) => {
    try {
      const res = await listConversations(agent);
      setConversations(res.conversations);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadAgents().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      loadConversations(selectedAgent.name);
    } else {
      loadConversations();
    }
  }, [selectedAgent]);

  const createConversation = async () => {
    if (!selectedAgent) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await newConversation("新对话", selectedAgent.name);
      await loadConversations(selectedAgent.name);
      onSelectConversation({ name: res.name, title: res.title, agent: selectedAgent.name, status: "Active", total_messages: 0, creation: "", modified: "" });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "新建会话失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="sidebar">
      <div className="brand">
        <div className="brand-logo">◆</div>
        <div>
          <div className="brand-name">Agent Client</div>
          <div className="brand-sub">超智能体交互客户端</div>
        </div>
      </div>

      <div className="section-label">
        <span>智能体</span>
        <span style={{ color: "var(--text-2)", cursor: "pointer" }} onClick={loadAgents}>↻</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
        {loading ? (
          <div className="empty">
            <span className="spinner" />
          </div>
        ) : agents.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🤖</div>
            <div>暂无智能体</div>
          </div>
        ) : (
          agents.map((a) => (
            <div
              key={a.name}
              className={`list-item ${selectedAgent?.name === a.name ? "active" : ""}`}
              onClick={() => onSelectAgent(a)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectAgent(a);
                }
              }}
            >
              <div className="list-item-title">
                <span>🤖</span>
                <span>{a.agent_name}</span>
              </div>
              <div className="list-item-sub">
                {a.model || "未配置模型"} · {a.total_conversations} 次对话
              </div>
            </div>
          ))
        )}
      </div>

      <div className="section-label">
        <span>会话</span>
        <button
          className="btn btn-ghost"
          style={{ padding: "2px 8px", fontSize: 12 }}
          onClick={createConversation}
          disabled={!selectedAgent || creating}
        >
          {creating ? <span className="spinner" /> : "＋ 新建"}
        </button>
      </div>
      {createError && (
        <div style={{ padding: "0 12px 8px", fontSize: 12, color: "var(--danger)" }}>⚠️ {createError}</div>
      )}
      <div style={{ flex: 1.2, overflowY: "auto", padding: "0 8px 12px" }}>
        {conversations.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">💬</div>
            <div>选择一个智能体开始对话</div>
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.name}
              className={`list-item ${selectedConversation?.name === c.name ? "active" : ""}`}
              onClick={() => onSelectConversation(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectConversation(c);
                }
              }}
            >
              <div className="list-item-title">
                <span className="badge-dot" style={{ background: "var(--accent)", width: 7, height: 7 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.title}
                </span>
              </div>
              <div className="list-item-sub">
                {c.total_messages} 条消息
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}