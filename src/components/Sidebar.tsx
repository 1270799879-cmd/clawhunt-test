import { useEffect, useState } from "react";
import type { Agent, Conversation } from "../types";
import {
  listAgents,
  listConversations,
  newConversation,
  renameConversation,
  archiveConversation,
  deleteConversation,
} from "../api/client";

interface Props {
  selectedAgent: Agent | null;
  onSelectAgent: (a: Agent) => void;
  selectedConversation: Conversation | null;
  onSelectConversation: (c: Conversation | null) => void;
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
  // 会话管理（批次 A）
  const [showArchived, setShowArchived] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const loadAgents = async () => {
    try {
      const res = await listAgents();
      setAgents(res.agents);
    } catch (e) {
      console.error(e);
    }
  };

  const loadConversations = async (agent?: string, archived?: boolean) => {
    try {
      const res = await listConversations(agent, archived ? 1 : 0);
      setConversations(res.conversations);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadAgents().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadConversations(selectedAgent?.name, showArchived);
  }, [selectedAgent, showArchived]);

  const createConversation = async () => {
    if (!selectedAgent) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await newConversation("新对话", selectedAgent.name);
      await loadConversations(selectedAgent.name, false);
      onSelectConversation({ name: res.name, title: res.title, agent: selectedAgent.name, status: "Active", total_messages: 0, creation: "", modified: "" });
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "新建会话失败");
    } finally {
      setCreating(false);
    }
  };

  // 重命名提交
  const commitRename = async (c: Conversation) => {
    const title = editValue.trim();
    setEditingName(null);
    if (!title || title === c.title) return;
    try {
      await renameConversation(c.name, title);
      onSelectConversation({ ...c, title });
      await loadConversations(selectedAgent?.name, showArchived);
    } catch (e) {
      console.error(e);
    }
  };

  // 归档 / 恢复
  const toggleArchive = async (c: Conversation, archived: boolean) => {
    const action = archived ? "归档" : "恢复";
    if (!window.confirm(`确定要${action}会话「${c.title}」吗？`)) return;
    try {
      await archiveConversation(c.name, archived);
      if (selectedConversation?.name === c.name) {
        // 归档当前会话时清空选中；恢复时保留
        onSelectConversation(archived ? null : { ...c, status: "Active" });
      }
      await loadConversations(selectedAgent?.name, showArchived);
    } catch (e) {
      console.error(e);
    }
  };

  // 删除
  const handleDelete = async (c: Conversation) => {
    if (!window.confirm(`确定要删除会话「${c.title}」吗？该操作不可撤销。`)) return;
    try {
      await deleteConversation(c.name);
      if (selectedConversation?.name === c.name) {
        onSelectConversation(null);
      }
      await loadConversations(selectedAgent?.name, showArchived);
    } catch (e) {
      console.error(e);
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
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button
            className="btn btn-ghost"
            style={{ padding: "2px 8px", fontSize: 12 }}
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? "返回未归档会话" : "查看已归档会话"}
          >
            {showArchived ? "📁 未归档" : "🗂 归档"}
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: "2px 8px", fontSize: 12 }}
            onClick={createConversation}
            disabled={!selectedAgent || creating}
          >
            {creating ? <span className="spinner" /> : "＋ 新建"}
          </button>
        </div>
      </div>
      {createError && (
        <div style={{ padding: "0 12px 8px", fontSize: 12, color: "var(--danger)" }}>⚠️ {createError}</div>
      )}
      <div style={{ flex: 1.2, overflowY: "auto", padding: "0 8px 12px" }}>
        {conversations.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">💬</div>
            <div>{showArchived ? "暂无已归档会话" : "选择一个智能体开始对话"}</div>
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.name}
              className={`list-item ${selectedConversation?.name === c.name ? "active" : ""}`}
              onClick={() => !editingName && onSelectConversation(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectConversation(c);
                }
              }}
            >
              {editingName === c.name ? (
                <input
                  className="input"
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitRename(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(c);
                    else if (e.key === "Escape") setEditingName(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <div className="list-item-title">
                    <span className="badge-dot" style={{ background: "var(--accent)", width: 7, height: 7 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title}
                    </span>
                  </div>
                  <div className="list-item-sub">
                    {c.total_messages} 条消息
                  </div>
                  <div className="conv-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-ghost"
                      title={showArchived ? "恢复" : "重命名"}
                      onClick={() => {
                        if (showArchived) toggleArchive(c, false);
                        else { setEditingName(c.name); setEditValue(c.title); }
                      }}
                    >
                      {showArchived ? "↩︎" : "✎"}
                    </button>
                    {!showArchived && (
                      <button className="btn-ghost" title="归档" onClick={() => toggleArchive(c, true)}>
                        🗂
                      </button>
                    )}
                    <button className="btn-ghost" title="删除" onClick={() => handleDelete(c)}>
                      🗑
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}