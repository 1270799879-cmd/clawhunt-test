// ============================================================
// 设置中心（阶段 4 · 4.5 P1）
// 选项卡式设置界面：左侧导航 + 内容区
//   - 后端连接：配置桌面端连接到的 Frappe 后端（通过 IPC config:get/set/ping）
//   - 系统信息：后端连接状态、应用/后端版本信息
// 架构约束：前端为纯展示层，配置持久化由桌面端主进程（config.js）负责。
// ============================================================

import { useEffect, useState } from "react";

interface Config {
  backendUrl: string;
  hostHeader: string;
}

type SectionKey = "backend" | "system";

const SECTIONS: { key: SectionKey; label: string; icon: string; desc: string }[] = [
  { key: "backend", label: "后端连接", icon: "🔗", desc: "配置桌面端连接到的 Frappe 后端服务" },
  { key: "system", label: "系统信息", icon: "🖥️", desc: "查看连接状态与版本信息" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: Props) {
  const [section, setSection] = useState<SectionKey>("backend");

  // 后端连接表单
  const [backendUrl, setBackendUrl] = useState("");
  const [hostHeader, setHostHeader] = useState("");
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // 系统信息
  const [sysStatus, setSysStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const [sysStatusText, setSysStatusText] = useState("未检测");
  const [sysVersion, setSysVersion] = useState("—");

  const api = window.agentClientDesktop;

  // 打开时加载配置
  useEffect(() => {
    if (!open) return;
    setPingResult(null);
    setSaved(false);
    void loadConfig();
    void checkSystem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadConfig = async () => {
    if (!api?.getConfig) return;
    try {
      const cfg: Config = await api.getConfig();
      setBackendUrl(cfg.backendUrl);
      setHostHeader(cfg.hostHeader);
    } catch (e) {
      console.error("[SettingsDialog] 读取配置失败:", e);
    }
  };

  // 系统信息检测：后端连通性 + 版本
  const checkSystem = async () => {
    setSysStatus("unknown");
    setSysStatusText("检测中...");
    if (!api?.pingBackend) {
      setSysStatus("offline");
      setSysStatusText("未运行在桌面端，无法检测");
      return;
    }
    try {
      const res = await api.pingBackend();
      if (res.ok) {
        setSysStatus("online");
        setSysStatusText(`后端连接正常 (HTTP ${res.status})`);
        setSysVersion("Agent Client Backend");
        void fetchBackendVersion();
      } else {
        setSysStatus("offline");
        setSysStatusText(`后端连接失败 (HTTP ${res.status})`);
      }
    } catch (e) {
      setSysStatus("offline");
      setSysStatusText("检测异常，请查看控制台");
    }
  };

  // 通过后端扩展接口获取版本信息（若存在则展示，否则保持默认）
  const fetchBackendVersion = async () => {
    if (!api?.apiCall) return;
    try {
      const res = await api.apiCall("GET", "agent_client.agent_client.api.get_system_info");
      if (res.ok) {
        const info = (res.data?.message ?? res.data) as { version?: string; site?: string } | undefined;
        if (info?.version) setSysVersion(info.version);
      }
    } catch (e) {
      console.warn("[SettingsDialog] 获取后端版本失败:", e);
    }
  };

  const close = () => {
    onClose();
    setPingResult(null);
    setSaved(false);
  };

  const save = async () => {
    if (!api?.setConfig) return;
    console.log("[SettingsDialog] 保存后端配置", { backendUrl, hostHeader });
    setSaving(true);
    try {
      const res = await api.setConfig({ backendUrl, hostHeader });
      if (res.ok) setSaved(true);
    } catch (e) {
      console.error("[SettingsDialog] 保存配置失败:", e);
    } finally {
      setSaving(false);
    }
  };

  const ping = async () => {
    if (!api?.pingBackend) return;
    setPinging(true);
    setPingResult(null);
    try {
      const res = await api.pingBackend();
      setPingResult(res.ok ? `连接正常 (HTTP ${res.status})` : `连接失败 (HTTP ${res.status})`);
    } catch (e) {
      setPingResult("测试异常，请查看控制台");
    } finally {
      setPinging(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="cdate-overlay"
      onClick={() => close()}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <div>
            <div className="cdate-title">设置中心</div>
            <div className="cdate-sub">管理客户端连接与系统信息</div>
          </div>
          <button className="btn btn-ghost cdate-close" onClick={close}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          {/* 左侧导航 */}
          <div className="settings-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                className={`settings-nav-item ${section === s.key ? "active" : ""}`}
                onClick={() => setSection(s.key)}
              >
                <span className="settings-nav-icon">{s.icon}</span>
                <span className="settings-nav-text">
                  <span className="settings-nav-label">{s.label}</span>
                  <span className="settings-nav-desc">{s.desc}</span>
                </span>
              </button>
            ))}
          </div>

          {/* 内容区 */}
          <div className="settings-content">
            {section === "backend" && (
              <div className="settings-section">
                <div className="settings-section-title">后端连接</div>
                <div className="settings-section-desc">
                  配置桌面端连接到的 Frappe 后端服务。修改后点击保存，更改会持久化到本地。
                </div>

                <div className="cdate-field">
                  <label className="cdate-label">后端地址 (Backend URL)</label>
                  <input
                    className="input"
                    value={backendUrl}
                    onChange={(e) => setBackendUrl(e.target.value)}
                    placeholder="http://127.0.0.1:8000"
                    spellCheck={false}
                  />
                </div>

                <div className="cdate-field">
                  <label className="cdate-label">Host 头 (Host Header)</label>
                  <input
                    className="input"
                    value={hostHeader}
                    onChange={(e) => setHostHeader(e.target.value)}
                    placeholder="agent.localhost"
                    spellCheck={false}
                  />
                </div>

                {pingResult && (
                  <div className={`cdate-ping ${pingResult.startsWith("连接正常") ? "ok" : "err"}`}>
                    {pingResult}
                  </div>
                )}
                {saved && <div className="cdate-ping ok">已保存，改动将在下次请求后生效</div>}

                <div className="cdate-actions">
                  <button className="btn" onClick={ping} disabled={pinging}>
                    {pinging ? "测试中..." : "测试连接"}
                  </button>
                  <div className="cdate-spacer" />
                  <button className="btn btn-ghost" onClick={close}>
                    取消
                  </button>
                  <button className="btn btn-primary" onClick={save} disabled={saving}>
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              </div>
            )}

            {section === "system" && (
              <div className="settings-section">
                <div className="settings-section-title">系统信息</div>
                <div className="settings-section-desc">查看当前客户端与后端服务的运行状态。</div>

                <div className="settings-info-list">
                  <div className="settings-info-row">
                    <span className="settings-info-label">后端连接状态</span>
                    <span className={`settings-info-value status-${sysStatus}`}>
                      <span className="badge-dot" />
                      {sysStatusText}
                    </span>
                  </div>
                  <div className="settings-info-row">
                    <span className="settings-info-label">后端版本</span>
                    <span className="settings-info-value">{sysVersion}</span>
                  </div>
                  <div className="settings-info-row">
                    <span className="settings-info-label">运行时</span>
                    <span className="settings-info-value" style={{ fontFamily: "var(--font-mono)" }}>
                      {api ? "Electron 桌面端" : "浏览器（Web）"}
                    </span>
                  </div>
                </div>

                <div className="cdate-actions" style={{ marginTop: 20 }}>
                  <button className="btn" onClick={checkSystem}>
                    重新检测
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}