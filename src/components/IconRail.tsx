// ============================================================
// 图标导航栏（阶段 4 · 4.1 三栏布局 + 图标导航分组）
// 借鉴 Cherry Studio 的三栏骨架：左侧图标导航分组
//   - 视图组：记忆 / 进化 / 模型 / 工具 / 观测（控制右侧面板）
//   - 管理组：供应商 / 智能体 / 设置（打开管理弹窗）
// ============================================================

export type ViewKey = "memory" | "evolution" | "providers" | "tools" | "conversation";

export type ManagementKey = "providers" | "agents" | "settings" | "mcp";

interface NavItem {
  key: string;
  label: string;
  icon: string;
}

const VIEW_ITEMS: NavItem[] = [
  { key: "memory", label: "记忆", icon: "🧠" },
  { key: "evolution", label: "进化", icon: "🌱" },
  { key: "providers", label: "模型", icon: "🔌" },
  { key: "tools", label: "工具", icon: "🛠️" },
  { key: "conversation", label: "观测", icon: "📊" },
];

const MANAGE_ITEMS: NavItem[] = [
  { key: "providers", label: "供应商", icon: "⚙️" },
  { key: "agents", label: "智能体", icon: "🤖" },
  { key: "mcp", label: "MCP", icon: "🔌" },
  { key: "settings", label: "设置", icon: "🛡️" },
];

interface Props {
  activeView: ViewKey;
  onSelectView: (v: ViewKey) => void;
  onOpenManagement: (k: ManagementKey) => void;
}

export default function IconRail({ activeView, onSelectView, onOpenManagement }: Props) {
  return (
    <div className="icon-rail">
      <div className="icon-rail-brand" title="Agent Client">
        ◆
      </div>

      <div className="icon-rail-group">
        <div className="icon-rail-group-label">视图</div>
        {VIEW_ITEMS.map((item) => (
          <button
            key={item.key}
            className={`icon-rail-item ${activeView === item.key ? "active" : ""}`}
            onClick={() => onSelectView(item.key as ViewKey)}
            title={item.label}
          >
            <span className="icon-rail-icon">{item.icon}</span>
            <span className="icon-rail-text">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="icon-rail-divider" />

      <div className="icon-rail-group">
        <div className="icon-rail-group-label">管理</div>
        {MANAGE_ITEMS.map((item) => (
          <button
            key={`m-${item.key}`}
            className="icon-rail-item"
            onClick={() => onOpenManagement(item.key as ManagementKey)}
            title={item.label}
          >
            <span className="icon-rail-icon">{item.icon}</span>
            <span className="icon-rail-text">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}