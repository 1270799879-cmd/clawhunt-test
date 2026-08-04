// ============================================================
// MCP 服务器管理弹窗（阶段 4 · P1）
// 列表 / 新增 / 编辑 / 测试连接（发现工具）/ 删除
// 支持三种传输方式：stdio / HTTP / SSE
// ============================================================
import { useEffect, useState } from "react";
import type { MCPServer, MCPTool } from "../types";
import {
  deleteMCPServer,
  getMCPServer,
  listMCPServers,
  saveMCPServer,
  testMCPServer,
} from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface MCPForm {
  name: string;
  server_name: string;
  server_type: string;
  transport: string;
  command: string;
  args: string;
  url: string;
  enabled: boolean;
  description: string;
}

const EMPTY_FORM: MCPForm = {
  name: "",
  server_name: "",
  server_type: "自定义",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  enabled: true,
  description: "",
};

export default function MCPDialog({ open, onClose }: Props) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [form, setForm] = useState<MCPForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [testingName, setTestingName] = useState("");
  const [detailTools, setDetailTools] = useState<MCPTool[]>([]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await listMCPServers();
      setServers(res.servers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载 MCP 服务器失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setMode("list");
      setError("");
      setDetailTools([]);
      void load();
    } else {
      setForm(EMPTY_FORM);
      setDetailTools([]);
    }
  }, [open]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setError("");
    setDetailTools([]);
    setMode("form");
  };

  const startEdit = async (s: MCPServer) => {
    setError("");
    setDetailTools([]);
    try {
      const res = await getMCPServer(s.name);
      const d = res.server;
      setForm({
        name: d.name,
        server_name: d.server_name,
        server_type: d.server_type || "自定义",
        transport: d.transport || "stdio",
        command: d.command || "",
        args: d.args || "",
        url: d.url || "",
        enabled: d.enabled,
        description: d.description || "",
      });
      setDetailTools(d.tools || []);
      setMode("form");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载 MCP 服务器详情失败");
    }
  };

  const handleDelete = async (s: MCPServer) => {
    if (!window.confirm(`确定删除 MCP 服务器「${s.server_name}」？此操作不可恢复。`)) return;
    try {
      await deleteMCPServer(s.name);
      showToast("已删除");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleTest = async (s: MCPServer) => {
    setTestingName(s.name);
    setError("");
    try {
      const res = await testMCPServer(s.name);
      if (res.ok) {
        showToast(`测试成功，发现 ${res.tools.length} 个工具`);
      } else {
        showToast(`测试失败：${res.error || "未知错误"}`);
      }
      await load();
      // 若正在编辑该服务器，刷新已发现工具
      if (mode === "form" && form.name === s.name) {
        const detail = await getMCPServer(s.name);
        setDetailTools(detail.server.tools || []);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "测试失败");
    } finally {
      setTestingName("");
    }
  };

  const handleSave = async () => {
    if (!form.server_name.trim()) {
      setError("请填写服务器名称");
      return;
    }
    if (form.transport !== "stdio" && !form.url.trim()) {
      setError("HTTP/SSE 传输需填写服务器 URL");
      return;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      setError("stdio 传输需填写启动命令");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: form.name || undefined,
        server_name: form.server_name.trim(),
        server_type: form.server_type,
        transport: form.transport,
        command: form.command.trim() || null,
        args: form.args.trim() || null,
        url: form.url.trim() || null,
        enabled: form.enabled ? 1 : 0,
        description: form.description.trim(),
        // 编辑保存时透传当前已发现工具（后端：传了才写，未传保留）
        tools: detailTools.length > 0 ? detailTools : undefined,
      };
      await saveMCPServer(payload);
      showToast(form.name ? "已更新" : "已创建");
      setMode("list");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const transportIsRemote = form.transport !== "stdio";

  return (
    <div className="cdate-overlay" onClick={onClose}>
      <div className="cdate-panel mgmt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cdate-head">
          <div>
            <div className="cdate-title">MCP 服务器管理</div>
            <div className="cdate-sub">
              {mode === "list"
                ? "管理外部 MCP 服务器，发现并编排其工具"
                : form.name
                ? "编辑 MCP 服务器"
                : "新增 MCP 服务器"}
            </div>
          </div>
          <button className="btn btn-ghost cdate-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {mode === "list" ? (
          <div className="mgmt-list">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={startCreate}>＋ 新增服务器</button>
            </div>
            {loading ? (
              <div className="empty"><span className="spinner" /></div>
            ) : servers.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🔌</div>
                <div>暂无 MCP 服务器</div>
                <div style={{ fontSize: 12 }}>点击右上角「新增服务器」接入外部工具</div>
              </div>
            ) : (
              servers.map((s) => (
                <div key={s.name} className="mgmt-row">
                  <div className="mgmt-row-main">
                    <div className="list-item-title">
                      <span>{s.transport === "stdio" ? "🚀" : "🌐"}</span>
                      <span style={{ flex: 1 }}>{s.server_name}</span>
                      <span
                        className={`badge ${
                          s.status === "OK" ? "badge-active" : s.status === "Error" ? "badge-danger" : "badge-warning"
                        }`}
                      >
                        <span className="badge-dot" />{s.status}
                      </span>
                    </div>
                    <div className="list-item-sub">
                      {s.transport === "stdio"
                        ? `${s.command || ""} ${s.args || ""}`.trim()
                        : s.url || ""}
                      {s.enabled ? "" : " · 已停用"}
                    </div>
                  </div>
                  <div className="mgmt-row-actions">
                    <button
                      className="btn"
                      onClick={() => handleTest(s)}
                      disabled={testingName === s.name}
                    >
                      {testingName === s.name ? <span className="spinner" /> : "⚡ 测试"}
                    </button>
                    <button className="btn" onClick={() => startEdit(s)}>编辑</button>
                    <button className="btn btn-danger" onClick={() => handleDelete(s)}>删除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mgmt-form">
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">服务器名称 *</label>
                <input
                  className="input"
                  value={form.server_name}
                  onChange={(e) => setForm({ ...form, server_name: e.target.value })}
                  placeholder="如 filesystem-mcp"
                />
              </div>
              <div className="form-group">
                <label className="form-label">传输方式</label>
                <select
                  className="input"
                  value={form.transport}
                  onChange={(e) => setForm({ ...form, transport: e.target.value })}
                >
                  <option value="stdio">stdio（本地命令）</option>
                  <option value="HTTP">HTTP（Streamable）</option>
                  <option value="SSE">SSE</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">服务器类型</label>
              <select
                className="input"
                value={form.server_type}
                onChange={(e) => setForm({ ...form, server_type: e.target.value })}
              >
                <option value="自定义">自定义</option>
                <option value="官方">官方</option>
              </select>
            </div>

            {!transportIsRemote ? (
              <>
                <div className="form-group">
                  <label className="form-label">启动命令 (stdio) *</label>
                  <input
                    className="input"
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="如 npx"
                    spellCheck={false}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">命令参数</label>
                  <input
                    className="input"
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                    placeholder="如 -y @modelcontextprotocol/server-filesystem /path"
                    spellCheck={false}
                  />
                </div>
              </>
            ) : (
              <div className="form-group">
                <label className="form-label">服务器 URL ({form.transport}) *</label>
                <input
                  className="input"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://mcp.example.com/mcp"
                  spellCheck={false}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">描述</label>
              <textarea
                className="textarea"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="该服务器提供哪些工具/能力"
              />
            </div>

            <div className="form-group">
              <label className="form-label">启用</label>
              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                <span className="switch-ui" />
                {form.enabled ? "已启用" : "已停用"}
              </label>
            </div>

            {detailTools.length > 0 ? (
              <div className="form-group">
                <div className="form-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>已发现工具（{detailTools.length}）</span>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => form.name && handleTest({ name: form.name, server_name: form.server_name } as MCPServer)}
                    disabled={testingName === form.name}
                  >
                    {testingName === form.name ? <span className="spinner" /> : "重新测试"}
                  </button>
                </div>
                <div className="mcp-tools">
                  {detailTools.map((t) => (
                    <div key={t.name} className="mcp-tool">
                      <div className="mcp-tool-name">{t.name}</div>
                      <div className="mcp-tool-desc">{t.description || "（无描述）"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
