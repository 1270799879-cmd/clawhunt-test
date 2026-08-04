import { useState } from "react";
import { doLogin } from "../api/client";

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState("Administrator");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await doLogin(username, password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="app-bg" />
      <div className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div className="brand-logo" style={{ width: 46, height: 46, fontSize: 20 }}>
            ◆
          </div>
          <div>
            <div className="brand-name" style={{ fontSize: 20 }}>
              Agent Client
            </div>
            <div className="brand-sub">超智能体交互客户端</div>
          </div>
        </div>

        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">用户名</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label className="form-label">密码</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入访问密码"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          <button className="btn btn-primary" style={{ width: "100%", padding: "11px" }} disabled={loading}>
            {loading ? <span className="spinner" /> : "进入系统"}
          </button>
        </form>
      </div>
    </div>
  );
}