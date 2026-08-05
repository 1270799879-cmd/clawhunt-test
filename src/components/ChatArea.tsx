import { useEffect, useRef, useState } from "react";
import type { Agent, ChatMessage, Conversation, LLMProvider } from "../types";
import { listMessages, sendMessage, recordFeedback } from "../api/client";

interface Props {
  agent: Agent | null;
  conversation: Conversation | null;
  providers: LLMProvider[];
}

export default function ChatArea({ agent, conversation, providers }: Props) {
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [imageData, setImageData] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const [ratingError, setRatingError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 选择图片：读为 base64 data URL，供多模态发送
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setRatingError("请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageData(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // 输入框自适应高度
  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const loadMessages = async (conv: Conversation) => {
    setLoading(true);
    try {
      const res = await listMessages(conv.name);
      setMessages(res.messages);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (conversation) {
      loadMessages(conversation);
      setRating(0);
      setRated(false);
      setRatingError("");
    } else {
      setMessages([]);
    }
  }, [conversation]);

  // 选中会话时，默认选中该会话关联智能体的模型；未关联则用默认值
  useEffect(() => {
    if (conversation) {
      const agentModel = agent?.model || "";
      if (agentModel && providers.some((p) => p.default_model === agentModel)) {
        setSelectedProvider(agentModel);
      } else if (providers.length > 0) {
        setSelectedProvider(providers[0].default_model);
      } else {
        setSelectedProvider("");
      }
    }
  }, [conversation, agent, providers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // 消息到达系统通知：仅在桌面端（window.agentClientDesktop）可用时调用，
  // 主进程会自行判断窗口是否聚焦（聚焦则不打扰）。
  const notifyAssistantReply = (reply: string) => {
    const api = window.agentClientDesktop;
    if (!api?.notifyMessage) return;
    const preview = reply.length > 120 ? `${reply.slice(0, 120)}…` : reply;
    void api
      .notifyMessage({
        title: agent?.name ? `${agent.name} 回复了你` : "Agent Client",
        body: preview,
      })
      .then((r) => {
        if (r && r.shown) console.log("[ChatArea] 已触发系统通知");
        else console.log("[ChatArea] 系统通知未弹出:", r?.reason);
      })
      .catch((e) => console.warn("[ChatArea] 触发系统通知失败:", e));
  };

  const send = async () => {
    const content = input.trim();
    if ((!content && !imageData) || !conversation || sending) return;
    setInput("");
    setImageData("");
    // 重置输入框高度，避免发送后仍保持多行高度
    if (inputRef.current) inputRef.current.style.height = "auto";
    setSending(true);
    // 乐观追加用户消息
    const userMsg: ChatMessage = {
      name: `tmp-${Date.now()}`,
      role: "User",
      content: imageData ? `${content}\n[附图片]` : content,
      agent: agent?.name || "",
      tokens: 0,
      latency_ms: 0,
      creation: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    try {
      const modelToUse = selectedProvider || undefined;
      const res = await sendMessage(conversation.name, content, modelToUse, imageData || undefined);
      if (res.ok) {
        const asstMsg: ChatMessage = {
          name: `tmp-${Date.now()}`,
          role: "Assistant",
          content: res.reply,
          agent: agent?.name || "",
          tokens: res.tokens,
          latency_ms: res.latency_ms,
          creation: new Date().toISOString(),
          tools_used: res.tools_used,
        };
        setMessages((m) => [...m, asstMsg]);
        notifyAssistantReply(res.reply);
      } else {
        // 出错情况，追加错误消息
        const errMsg: ChatMessage = {
          name: `tmp-${Date.now()}`,
          role: "System",
          content: `⚠️ ${res.error || "请求失败"}`,
          agent: agent?.name || "",
          tokens: 0,
          latency_ms: 0,
          creation: new Date().toISOString(),
        };
        setMessages((m) => [...m, errMsg]);
      }
    } catch (e) {
      const errMsg: ChatMessage = {
        name: `tmp-${Date.now()}`,
        role: "System",
        content: `⚠️ ${e instanceof Error ? e.message : "请求失败"}`,
        agent: agent?.name || "",
        tokens: 0,
        latency_ms: 0,
        creation: new Date().toISOString(),
      };
      setMessages((m) => [...m, errMsg]);
    } finally {
      setSending(false);
    }
  };

  const submitRating = async (score: number) => {
    if (!conversation || rated) return;
    setRating(score);
    setRatingError("");
    try {
      await recordFeedback(conversation.name, score, "");
      setRated(true);
    } catch (e) {
      // 提交失败时回退评分状态，让用户可重试，并提示错误
      setRating(0);
      setRatingError(e instanceof Error ? e.message : "评分提交失败，请重试");
    }
  };

  if (!conversation) {
    return (
      <div className="chat-area">
        <div className="empty" style={{ flex: 1 }}>
          <div className="empty-icon" style={{ fontSize: 48 }}>🤖</div>
          <div style={{ fontSize: 18, color: "var(--text-0)", fontWeight: 500 }}>
            选择或创建一个会话开始
          </div>
          <div style={{ fontSize: 13 }}>这是你的超智能体交互客户端</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-area">
      <div className="topbar">
        <div>
          <div className="topbar-title">{conversation.title}</div>
          <div className="topbar-sub">
            {agent ? `${agent.agent_name} · ${agent.model || "未知模型"}` : "未关联智能体"}
          </div>
        </div>
        {!rated && messages.some((m) => m.role === "Assistant") && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-2)", marginRight: 4 }}>
              评价本次回答
            </span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={`rating-btn ${rating >= n ? "lit" : ""}`}
                onClick={() => submitRating(n)}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        {rated && (
          <span style={{ fontSize: 12, color: "var(--success)" }}>✓ 已反馈，感谢！</span>
        )}
        {ratingError && (
          <span style={{ fontSize: 12, color: "var(--danger)", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            ⚠️ {ratingError}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div className="empty">
            <span className="spinner" />
          </div>
        ) : messages.length === 0 ? (
          <div className="empty" style={{ flex: 1, minHeight: "60%" }}>
            <div className="empty-icon" style={{ fontSize: 40 }}>💬</div>
            <div style={{ fontSize: 15, color: "var(--text-0)" }}>开始对话</div>
            <div style={{ fontSize: 13 }}>发送第一条消息，体验智能体能力</div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="msg-row">
              <div
                className={`msg-avatar ${m.role === "User" ? "msg-user" : m.role === "Assistant" ? "msg-assistant" : ""}`}
              >
                {m.role === "User" ? "我" : m.role === "Assistant" ? "AI" : "!"}
              </div>
              <div className="msg-body">
                <div className="msg-content">{m.content}</div>
                {(m.tokens > 0 || m.latency_ms > 0 || (m.tools_used && m.tools_used.length > 0)) && (
                  <div className="msg-meta">
                    {m.tools_used && m.tools_used.length > 0 && (
                      <span className="badge badge-active" style={{ textTransform: "none" }}>
                        <span className="badge-dot" />
                        调用了 {m.tools_used.map((t) => t.name).join(", ")}
                      </span>
                    )}
                    {m.tokens > 0 && <span>🔢 {m.tokens} tokens</span>}
                    {m.latency_ms > 0 && <span>⚡ {m.latency_ms}ms</span>}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="msg-row">
            <div className="msg-avatar msg-assistant">AI</div>
            <div className="msg-body">
              <div className="msg-meta" style={{ gap: 6 }}>
                <span className="spinner" style={{ width: 14, height: 14 }} />
                <span>正在思考...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 模型切换下拉（P0 优化：一级入口） */}
      {conversation && providers.length > 0 && (
        <div className="model-selector">
          <span className="model-label">模型：</span>
          <select
            className="model-select"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
          >
            <option value="">默认（使用智能体配置）</option>
            {providers.map((provider) =>
              provider.default_model ? (
                <option key={provider.default_model} value={provider.default_model}>
                  {provider.provider_name} - {provider.default_model}
                </option>
              ) : null
            )}
          </select>
        </div>
      )}

      <div className="composer">
        {imageData && (
          <div className="composer-img-preview">
            <img src={imageData} alt="待发送图片" />
            <button
              type="button"
              className="composer-img-remove"
              onClick={() => setImageData("")}
              aria-label="移除图片"
            >
              ✕
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <div className="composer-left">
          <button
            type="button"
            className="btn btn-ghost composer-img-btn"
            onClick={() => fileInputRef.current?.click()}
            title="上传图片（多模态）"
          >
            🖼️
          </button>
          <textarea
            ref={inputRef}
            className="textarea"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              // 中文输入法组合输入时（isComposing）按下 Enter 不应发送
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          />
        </div>
        <button className="btn btn-primary" onClick={send} disabled={sending || (!input.trim() && !imageData)}>
          {sending ? <span className="spinner" /> : "发送"}
        </button>
      </div>
    </div>
  );
}