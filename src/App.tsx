import { useState, useEffect } from "react";
import type { Agent, Conversation, LLMProvider } from "./types";
import { listProviders, getOnboardingState } from "./api/client";
import Login from "./components/Login";
import IconRail, { type ViewKey, type ManagementKey } from "./components/IconRail";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import RightPanel from "./components/RightPanel";
import ProviderDialog from "./components/ProviderDialog";
import AgentDialog from "./components/AgentDialog";
import ConfigDialog from "./components/ConfigDialog";
import SettingsDialog from "./components/SettingsDialog";
import MCPDialog from "./components/MCPDialog";
import OnboardingGuide from "./components/OnboardingGuide";
import OrchestrationDialog from "./components/OrchestrationDialog";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  // 三栏布局：底部图标导航控制右侧面板视图
  const [rightView, setRightView] = useState<ViewKey>("memory");
  // 管理弹窗
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [mcpDialogOpen, setMCPDialogOpen] = useState(false);
  const [orchDialogOpen, setOrchDialogOpen] = useState(false);
  // 首次引导（批次B）
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 加载 Provider 列表供模型切换下拉使用
  useEffect(() => {
    if (loggedIn) {
      listProviders()
        .then(res => setProviders(res.providers))
        .catch(err => console.error("加载模型提供商失败", err));
      // 拉取首次引导状态：未完成则展示引导浮层（进度存后端，不依赖本地存储）
      getOnboardingState()
        .then((res) => {
          if (!res.onboarded) setShowOnboarding(true);
        })
        .catch((err) => console.error("获取引导状态失败", err));
    }
  }, [loggedIn]);

  // 供应商 / Agent 变更后刷新 Provider 列表
  const refreshProviders = () => {
    listProviders()
      .then(res => setProviders(res.providers))
      .catch(err => console.error("刷新模型提供商失败", err));
  };

  const handleOpenManagement = (k: ManagementKey) => {
    if (k === "providers") setProviderDialogOpen(true);
    else if (k === "agents") setAgentDialogOpen(true);
    else if (k === "settings") setSettingsDialogOpen(true);
    else if (k === "mcp") setMCPDialogOpen(true);
    else if (k === "orchestration") setOrchDialogOpen(true);
  };

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div className="app-shell">
      <div className="app-bg" />
      <IconRail
        activeView={rightView}
        onSelectView={setRightView}
        onOpenManagement={handleOpenManagement}
      />
      <Sidebar
        selectedAgent={selectedAgent}
        onSelectAgent={(a) => {
          setSelectedAgent(a);
          // 切换智能体时清空当前会话，避免残留旧智能体的会话
          setSelectedConversation(null);
        }}
        selectedConversation={selectedConversation}
        onSelectConversation={setSelectedConversation}
      />
      <ChatArea
        agent={selectedAgent}
        conversation={selectedConversation}
        providers={providers}
      />
      <RightPanel
        agent={selectedAgent}
        conversation={selectedConversation}
        view={rightView}
        onViewChange={setRightView}
      />
      <ProviderDialog
        open={providerDialogOpen}
        onClose={() => setProviderDialogOpen(false)}
        onChanged={refreshProviders}
      />
      <AgentDialog
        open={agentDialogOpen}
        onClose={() => setAgentDialogOpen(false)}
        onChanged={refreshProviders}
      />
      <SettingsDialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} />
      <MCPDialog open={mcpDialogOpen} onClose={() => setMCPDialogOpen(false)} />
      <OrchestrationDialog open={orchDialogOpen} onClose={() => setOrchDialogOpen(false)} />
      <ConfigDialog />
      {showOnboarding && (
        <OnboardingGuide onClose={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}