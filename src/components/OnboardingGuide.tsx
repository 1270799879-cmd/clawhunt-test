import { useState } from "react";
import { completeOnboarding } from "../api/client";

interface Props {
  onClose: (neverAgain: boolean) => void;
}

// 首次使用引导：3 步走完核心路径，进度写入后端 User Profile（批次 B）
export default function OnboardingGuide({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);

  const steps = [
    {
      icon: "🤖",
      title: "选择智能体",
      desc: "在左侧「智能体」列表中选择一个已配置的智能体。每个智能体绑定独立的模型、记忆与工具。",
    },
    {
      icon: "💬",
      title: "新建会话",
      desc: "选中智能体后，点击「会话 → ＋ 新建」开始一段新对话。同一智能体可创建多个会话。",
    },
    {
      icon: "🚀",
      title: "发送消息",
      desc: "在底部输入框输入内容并回车，智能体将通过绑定的大模型回复您。可在底部切换模型。",
    },
  ];

  const s = steps[step];

  const finish = async () => {
    setClosing(true);
    try {
      await completeOnboarding();
    } catch (e) {
      console.error("标记引导完成失败", e);
    }
    onClose(true);
  };

  const skip = () => onClose(false);

  return (
    <div className="onboard-overlay">
      <div className="onboard-card">
        <div className="onboard-icon">{s.icon}</div>
        <div className="onboard-step">第 {step + 1} / {steps.length} 步</div>
        <div className="onboard-title">{s.title}</div>
        <div className="onboard-desc">{s.desc}</div>

        <div className="onboard-dots">
          {steps.map((_, i) => (
            <span key={i} className={`onboard-dot ${i === step ? "active" : ""}`} />
          ))}
        </div>

        <div className="onboard-actions">
          {step === 0 ? (
            <>
              <button className="btn btn-ghost" onClick={skip}>跳过</button>
              <div className="cdate-spacer" />
              <button className="btn btn-primary" onClick={() => setStep(1)}>下一步</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>上一步</button>
              <div className="cdate-spacer" />
              {step === steps.length - 1 ? (
                <button className="btn btn-primary" onClick={finish} disabled={closing}>
                  {closing ? <span className="spinner" /> : "开始使用"}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => setStep(step + 1)}>下一步</button>
              )}
            </>
          )}
        </div>

        <div className="onboard-neveragain" onClick={skip}>不再提示</div>
      </div>
    </div>
  );
}