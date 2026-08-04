import { useEffect, useRef, useState } from "react";

interface Config {
  backendUrl: string;
  hostHeader: string;
}

const LOG = {
  open: "[ConfigDialog] 事件触发 open",
  openAgain: "[ConfigDialog] 弹窗已打开，忽略重复 open",
  close: "[ConfigDialog] 事件触发 close",
  closeClick: "[ConfigDialog] 用户点击关闭按钮",
  esc: "[ConfigDialog] 用户按 Esc 关闭",
  overlay: "[ConfigDialog] 用户点击遮罩关闭",
  getStart: "[ConfigDialog] 请求读取配置 (config:get)",
  getOk: "[ConfigDialog] 配置读取成功",
  getErr: "[ConfigDialog] 配置读取失败",
  setStart: "[ConfigDialog] 请求保存配置 (config:set)",
  setOk: "[ConfigDialog] 配置保存成功",
  setErr: "[ConfigDialog] 配置保存失败",
  pingStart: "[ConfigDialog] 请求连通性测试 (config:ping)",
  pingOk: "[ConfigDialog] 连通性测试通过",
  pingErr: "[ConfigDialog] 连通性测试失败",
};

export default function ConfigDialog() {
  const [open, setOpen] = useState(false);
  const [backendUrl, setBackendUrl] = useState("");
  const [hostHeader, setHostHeader] = useState("");
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const openRef = useRef(false);

  // 注册 IPC 事件（弹窗打开/关闭），并加详细日志
  useEffect(() => {
    const api = window.agentClientDesktop;
    if (!api || typeof api.onOpenConfig !== "function") {
      console.warn("[ConfigDialog] 未检测到桌面端 API（window.agentClientDesktop）。请确认运行在 Electron 桌面端。");
      return;
    }

    console.log("[ConfigDialog] 已注册 onOpenConfig 监听，等待主进程事件...");

    const unsubscribe = api.onOpenConfig(() => {
      if (openRef.current) {
        console.log(LOG.openAgain);
        return;
      }
      console.log(LOG.open);
      openRef.current = true;
      setOpen(true);
      // 打开时读取最新配置
      void loadConfig();
    });

    return () => {
      console.log("[ConfigDialog] 卸载 onOpenConfig 监听");
      unsubscribe();
    };
  }, []);

  // 读取配置
  const loadConfig = async () => {
    const api = window.agentClientDesktop;
    if (!api?.getConfig) return;
    console.log(LOG.getStart);
    try {
      const cfg: Config = await api.getConfig();
      console.log(LOG.getOk, cfg);
      setBackendUrl(cfg.backendUrl);
      setHostHeader(cfg.hostHeader);
    } catch (e) {
      console.error(LOG.getErr, e);
    }
  };

  // 关闭弹窗
  const close = (reason: string) => {
    console.log(LOG.close, reason);
    openRef.current = false;
    setOpen(false);
    setPingResult(null);
    setSaved(false);
  };

  // 保存配置
  const save = async () => {
    const api = window.agentClientDesktop;
    if (!api?.setConfig) return;
    console.log(LOG.setStart, { backendUrl, hostHeader });
    setSaving(true);
    try {
      const res = await api.setConfig({ backendUrl, hostHeader });
      console.log(LOG.setOk, res);
      setSaved(true);
    } catch (e) {
      console.error(LOG.setErr, e);
    } finally {
      setSaving(false);
    }
  };

  // 连通性测试
  const ping = async () => {
    const api = window.agentClientDesktop;
    if (!api?.pingBackend) return;
    console.log(LOG.pingStart);
    setPinging(true);
    setPingResult(null);
    try {
      const res = await api.pingBackend();
      console.log(LOG.pingOk, res);
      setPingResult(res.ok ? `连接正常 (HTTP ${res.status})` : `连接失败 (HTTP ${res.status})`);
    } catch (e) {
      console.error(LOG.pingErr, e);
      setPingResult("测试异常，请查看控制台");
    } finally {
      setPinging(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="cdate-overlay"
      onClick={() => close(LOG.overlay)}
      onKeyDown={(e) => {
        if (e.key === "Escape") close(LOG.esc);
      }}
    >
      <div className="cdate-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cdate-head">
          <div>
            <div className="cdate-title">后端地址配置</div>
            <div className="cdate-sub">配置桌面端连接到的 Frappe 后端服务</div>
          </div>
          <button className="btn btn-ghost cdate-close" onClick={() => close(LOG.closeClick)}>
            ✕
          </button>
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
          <div className={`cdate-ping ${pingResult.startsWith("连接正常") ? "ok" : "err"}`}>{pingResult}</div>
        )}
        {saved && <div className="cdate-ping ok">已保存</div>}

        <div className="cdate-actions">
          <button className="btn" onClick={ping} disabled={pinging}>
            {pinging ? "测试中..." : "测试连接"}
          </button>
          <div className="cdate-spacer" />
          <button className="btn btn-ghost" onClick={() => close(LOG.closeClick)}>
            取消
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 声明桌面端 API 类型（由 preload.js 注入）
declare global {
  interface Window {
    agentClientDesktop?: {
      getConfig: () => Promise<Config>;
      setConfig: (cfg: Config) => Promise<{ ok: boolean; backendUrl: string; hostHeader: string }>;
      pingBackend: () => Promise<{ ok: boolean; status: number; error?: string }>;
      onOpenConfig: (cb: () => void) => () => void;
      apiCall: (
        method: string,
        path: string,
        params?: Record<string, unknown>
      ) => Promise<{ ok: boolean; status: number; data?: any; error?: string | null }>;
      notifyMessage: (payload: { title?: string; body?: string }) => Promise<{ shown: boolean; reason?: string }>;
    };
  }
}