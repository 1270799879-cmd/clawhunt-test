// ============================================================
// 供应商管理弹窗（阶段 4 · 4.2 供应商 CRUD 表单化）
// 借鉴 ClawX 的「统一供应商配置面板」：新增 / 编辑 / 删除 / 测试连接
// Key 输入脱敏展示 + 后端加密存储；删除后模型下拉即时更新。
// ============================================================
import { useEffect, useState } from "react";
import type { LLMProvider, ProviderModel } from "../types";
import {
  deleteProvider,
  getProvider,
  listProviders,
  saveProvider,
  testProvider,
} from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

interface ProviderForm {
  name: string;
  provider_name: string;
  provider_type: string;
  api_base_url: string;
  api_key: string;
  default_model: string;
  default_temperature: number;
  default_max_tokens: number;
  timeout_seconds: number;
  enabled: boolean;
  models: ProviderModel[];
}

const EMPTY_FORM: ProviderForm = {
  name: "",
  provider_name: "",
  provider_type: "OpenAI",
  api_base_url: "",
  api_key: "",
  default_model: "",
  default_temperature: 0.7,
  default_max_tokens: 2048,
  timeout_seconds: 60,
  enabled: true,
  models: [],
};

export default function ProviderDialog({ open, onClose, onChanged }: Props) {
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"list" | "form">("list");
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [testingName, setTestingName] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await listProviders();
      setProviders(res.providers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载供应商失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setMode("list");
      setError("");
      void load();
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setError("");
    setMode("form");
  };

  const startEdit = async (p: LLMProvider) => {
    setError("");
    try {
      const res = await getProvider(p.name);
      const d = res.provider;
      setForm({
        name: d.name,
        provider_name: d.provider_name,
        provider_type: d.provider_type,
        api_base_url: d.api_base_url || "",
        api_key: "",
        default_model: d.default_model || "",
        default_temperature: d.default_temperature ?? 0.7,
        default_max_tokens: d.default_max_tokens ?? 2048,
        timeout_seconds: d.timeout_seconds ?? 60,
        enabled: true,
        models: d.models || [],
      });
      setMode("form");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载供应商详情失败");
    }
  };

  const handleDelete = async (p: LLMProvider) => {
    if (!window.confirm(`确定删除供应商「${p.provider_name}」？此操作不可恢复。`)) return;
    try {
      await deleteProvider(p.name);
      showToast("已删除");
      onChanged();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleTest = async (p: LLMProvider) => {
    setTestingName(p.name);
    try {
      const res = await testProvider(p.name);
      showToast(res.ok ? `连接正常 (${res.latency_ms}ms)` : "连接失败");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "测试失败");
    } finally {
      setTestingName("");
    }
  };

  const handleSave = async () => {
    if (!form.provider_name.trim()) {
      setError("请填写供应商名称");
      return;
    }
    if (!form.api_base_url.trim()) {
      setError("请填写 API Base URL");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name: form.name || undefined,
        provider_name: form.provider_name.trim(),
        provider_type: form.provider_type,
        api_base_url: form.api_base_url.trim(),
        default_model: form.default_model.trim(),
        default_temperature: form.default_temperature,
        default_max_tokens: form.default_max_tokens,
        timeout_seconds: form.timeout_seconds,
        enabled: form.enabled ? 1 : 0,
        models: form.models.map((m) => ({
          model_name: m.model_name,
          is_default: m.is_default ? 1 : 0,
        })),
      };
      if (form.api_key.trim()) payload.api_key = form.api_key.trim();
      await saveProvider(payload);
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

  const updateModel = (i: number, patch: Partial<ProviderModel>) => {
    setForm((f) => {
      const models = f.models.map((m, idx) =>
        idx === i ? { ...m, ...patch } : m
      );
      return { ...f, models };
    });
  };

  const addModel = () => {
    setForm((f) => ({ ...f, models: [...f.models, { model_name: "", is_default: false }] }));
  };

  const removeModel = (i: number) => {
    setForm((f) => ({ ...f, models: f.models.filter((_, idx) => idx !== i) }));
  };

  if (!open) return null;

  return (
    <div className="cdate-overlay" onClick={onClose}>
      <div className="cdate-panel mgmt-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cdate-head">
          <div>
            <div className="cdate-title">LLM 供应商管理</div>
            <div className="cdate-sub">
              {mode === "list"
                ? "新增、编辑、删除与测试连接（Key 加密存储）"
                : form.name
                ? "编辑供应商"
                : "新增供应商"}
            </div>
          </div>
          <button className="btn btn-ghost cdate-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="form-error">{error}</div>}

        {mode === "list" ? (
          <div className="mgmt-list">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={startCreate}>＋ 新增供应商</button>
            </div>
            {loading ? (
              <div className="empty"><span className="spinner" /></div>
            ) : providers.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">🔌</div>
                <div>暂无模型供应商</div>
                <div style={{ fontSize: 12 }}>点击右上角「新增供应商」开始配置</div>
              </div>
            ) : (
              providers.map((p) => (
                <div key={p.name} className="mgmt-row">
                  <div className="mgmt-row-main">
                    <div className="list-item-title">
                      <span>{p.provider_type === "Ollama" ? "🦙" : "☁️"}</span>
                      <span style={{ flex: 1 }}>{p.provider_name}</span>
                      <span className={`badge ${p.status === "Active" ? "badge-active" : "badge-warning"}`}>
                        <span className="badge-dot" />{p.status}
                      </span>
                    </div>
                    <div className="list-item-sub">
                      {p.api_base_url} · {p.default_model || "未设默认模型"}
                    </div>
                  </div>
                  <div className="mgmt-row-actions">
                    <button className="btn" onClick={() => handleTest(p)} disabled={testingName === p.name}>
                      {testingName === p.name ? <span className="spinner" /> : "⚡ 测试"}
                    </button>
                    <button className="btn" onClick={() => startEdit(p)}>编辑</button>
                    <button className="btn btn-danger" onClick={() => handleDelete(p)}>删除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mgmt-form">
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">供应商名称 *</label>
                <input
                  className="input"
                  value={form.provider_name}
                  onChange={(e) => setForm({ ...form, provider_name: e.target.value })}
                  placeholder="如 OpenAI / DeepSeek"
                />
              </div>
              <div className="form-group">
                <label className="form-label">类型</label>
                <select
                  className="input"
                  value={form.provider_type}
                  onChange={(e) => setForm({ ...form, provider_type: e.target.value })}
                >
                  <option value="OpenAI">OpenAI</option>
                  <option value="Ollama">Ollama</option>
                  <option value="Anthropic">Anthropic</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">API Base URL *</label>
              <input
                className="input"
                value={form.api_base_url}
                onChange={(e) => setForm({ ...form, api_base_url: e.target.value })}
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                API Key {form.name ? "(留空则保持不变)" : ""}
              </label>
              <input
                className="input"
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={form.name ? "••••••••（已保存，输入以覆盖）" : "sk-..."}
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">默认模型</label>
                <input
                  className="input"
                  value={form.default_model}
                  onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                  placeholder="gpt-4o"
                />
              </div>
              <div className="form-group">
                <label className="form-label">温度</label>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={form.default_temperature}
                  onChange={(e) => setForm({ ...form, default_temperature: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">最大 Tokens</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="1"
                  value={form.default_max_tokens}
                  onChange={(e) => setForm({ ...form, default_max_tokens: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">超时（秒）</label>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="1"
                  value={form.timeout_seconds}
                  onChange={(e) => setForm({ ...form, timeout_seconds: Number(e.target.value) })}
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
            </div>

            <div className="form-group">
              <div className="form-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>可用模型</span>
                <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={addModel}>
                  ＋ 添加模型
                </button>
              </div>
              {form.models.length === 0 ? (
                <div className="empty" style={{ padding: 16 }}>
                  <div style={{ fontSize: 12 }}>尚未配置模型，点击「添加模型」</div>
                </div>
              ) : (
                <div className="model-list">
                  {form.models.map((m, i) => (
                    <div key={i} className="model-row">
                      <input
                        className="input"
                        value={m.model_name}
                        onChange={(e) => updateModel(i, { model_name: e.target.value })}
                        placeholder="模型名，如 gpt-4o"
                      />
                      <label className="switch-label model-default">
                        <input
                          type="checkbox"
                          checked={m.is_default}
                          onChange={(e) => updateModel(i, { is_default: e.target.checked })}
                        />
                        <span className="switch-ui" />
                        默认
                      </label>
                      <button className="btn btn-ghost" onClick={() => removeModel(i)}>✕</button>
                    </div>
                  ))}
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