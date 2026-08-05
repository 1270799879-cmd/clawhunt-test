// ============================================================
// 组织式编排看板（Batch B · Task 状态机 + 编排闭环）
// 频道列表 → 任务看板（按状态分组）→ 拆解/领取/提交/质检/终审
// ============================================================
import { useEffect, useState } from "react";
import type {
  Agent,
  OrchestrationChannel,
  OrchestrationChannelDetail,
  OrchestrationTask,
} from "../types";
import {
  claimTask,
  createChannel,
  decomposeTask,
  finalReview,
  getChannel,
  listAgents,
  listChannels,
  reviewTask,
  submitTask,
} from "../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

interface CreateForm {
  channel_name: string;
  general_manager: string;
  reviewer: string;
  description: string;
  members: string[];
}

const EMPTY_FORM: CreateForm = {
  channel_name: "",
  general_manager: "",
  reviewer: "",
  description: "",
  members: [],
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待领取",
  claimed: "已领取",
  executing: "执行中",
  reviewing: "待质检",
  approved: "已通过",
  rejected: "已驳回",
};

const STATUS_ORDER = ["pending", "claimed", "reviewing", "approved", "rejected"];

export default function OrchestrationDialog({ open, onClose }: Props) {
  const [channels, setChannels] = useState<OrchestrationChannel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  // 当前查看的频道详情
  const [detail, setDetail] = useState<OrchestrationChannelDetail | null>(null);
  const [decomposeReq, setDecomposeReq] = useState("");
  const [decomposing, setDecomposing] = useState(false);
  // 任务操作弹层
  const [actionTask, setActionTask] = useState<OrchestrationTask | null>(null);
  const [actionText, setActionText] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [actionType, setActionType] = useState<"claim" | "submit" | "review" | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const loadAll = async () => {
    setLoading(true);
    setError("");
    try {
      const [chRes, agRes] = await Promise.all([listChannels(), listAgents()]);
      setChannels(chRes.channels);
      setAgents(agRes.agents);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载编排数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadAll();
      setDetail(null);
      setShowCreate(false);
    }
  }, [open]);

  const openDetail = async (name: string) => {
    setBusy(true);
    setError("");
    try {
      const d = await getChannel(name);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载频道详情失败");
    } finally {
      setBusy(false);
    }
  };

  const refreshDetail = async (name: string) => {
    try {
      const d = await getChannel(name);
      setDetail(d);
    } catch {
      /* 忽略刷新错误 */
    }
  };

  const handleCreate = async () => {
    if (!form.channel_name || !form.general_manager || !form.reviewer) {
      setError("请填写频道名、总经理与质检");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createChannel(
        form.channel_name,
        form.general_manager,
        form.reviewer,
        form.description,
        form.members
      );
      showToast("频道创建成功");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建频道失败");
    } finally {
      setBusy(false);
    }
  };

  const handleDecompose = async () => {
    if (!detail || !decomposeReq.trim()) return;
    setDecomposing(true);
    setError("");
    try {
      const res = await decomposeTask(detail.channel.channel_name, decomposeReq.trim());
      showToast(`拆解完成，生成 ${res.tasks.length} 个子任务`);
      setDecomposeReq("");
      await refreshDetail(detail.channel.channel_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "拆解失败");
    } finally {
      setDecomposing(false);
    }
  };

  const openAction = (type: "claim" | "submit" | "review", task: OrchestrationTask) => {
    setActionType(type);
    setActionTask(task);
    setActionText("");
    setActionNote("");
  };

  const runAction = async () => {
    if (!actionTask || !actionType || !detail) return;
    setBusy(true);
    setError("");
    try {
      const chName = detail.channel.channel_name;
      if (actionType === "claim") {
        await claimTask(actionTask.name, actionText);
        showToast("已领取任务");
      } else if (actionType === "submit") {
        if (!actionText.trim()) {
          setError("请填写交付结果");
          return;
        }
        await submitTask(actionTask.name, actionText);
        showToast("已提交，待质检");
      } else if (actionType === "review") {
        if (!actionText && actionNote.trim() !== "") {
          // 允许只填结论不填说明
        }
        await reviewTask(actionTask.name, actionText === "approve", actionNote);
        showToast(actionText === "approve" ? "质检通过" : "已驳回，任务回退");
      }
      setActionTask(null);
      setActionType(null);
      await refreshDetail(chName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const handleFinalReview = async () => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      const res = await finalReview(detail.channel.channel_name);
      showToast(res.passed ? "终审通过，编排完成" : "终审未通过");
      await refreshDetail(detail.channel.channel_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "终审失败");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="cdate-overlay" onClick={onClose}>
      <div className="cdate-panel mgmt-panel mgmt-panel-wide" onClick={(e) => e.stopPropagation()}>
        <div className="cdate-head">
          <div>
            <div className="cdate-title">组织式编排</div>
            <div className="cdate-sub">总经理拆解 → 成员执行 → 质检 → 终审闭环</div>
          </div>
          <button className="btn btn-ghost cdate-close" onClick={onClose}>✕</button>
        </div>

        {toast && <div className="toast show">{toast}</div>}
        {error && <div className="form-error">{error}</div>}

        <div className="orch-body">
          {/* ===== 左侧：频道列表 ===== */}
          <div className="orch-side">
            <div className="orch-side-head">
              <span>编排频道</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(v => !v)}>
                {showCreate ? "收起" : "＋ 新建"}
              </button>
            </div>

            {showCreate && (
              <div className="orch-create">
                <input
                  className="input"
                  placeholder="频道名称"
                  value={form.channel_name}
                  onChange={(e) => setForm({ ...form, channel_name: e.target.value })}
                />
                <select
                  className="input"
                  value={form.general_manager}
                  onChange={(e) => setForm({ ...form, general_manager: e.target.value })}
                >
                  <option value="">总经理</option>
                  {agents.map((a) => (
                    <option key={a.name} value={a.name}>{a.agent_name}</option>
                  ))}
                </select>
                <select
                  className="input"
                  value={form.reviewer}
                  onChange={(e) => setForm({ ...form, reviewer: e.target.value })}
                >
                  <option value="">质检</option>
                  {agents.map((a) => (
                    <option key={a.name} value={a.name}>{a.agent_name}</option>
                  ))}
                </select>
                <select
                  className="input"
                  multiple
                  value={form.members}
                  onChange={(e) => {
                    const vals = Array.from(e.target.selectedOptions, (o) => o.value);
                    setForm({ ...form, members: vals });
                  }}
                >
                  {agents.map((a) => (
                    <option key={a.name} value={a.name}>{a.agent_name}</option>
                  ))}
                </select>
                <textarea
                  className="input"
                  placeholder="描述（可选）"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
                <button className="btn btn-primary btn-block" disabled={busy} onClick={handleCreate}>
                  创建频道
                </button>
              </div>
            )}

            <div className="orch-channel-list">
              {loading && <div className="orch-empty">加载中…</div>}
              {!loading && channels.length === 0 && (
                <div className="orch-empty">暂无频道，点击上方新建</div>
              )}
              {channels.map((c) => (
                <div
                  key={c.name}
                  className={`orch-channel-item ${detail?.channel.channel_name === c.channel_name ? "active" : ""}`}
                  onClick={() => openDetail(c.channel_name)}
                >
                  <div className="orch-channel-name">{c.channel_name}</div>
                  <div className="orch-channel-meta">
                    <span className={`tag tag-${c.status === "done" ? "green" : "blue"}`}>{c.status === "done" ? "已完成" : "进行中"}</span>
                    <span>{c.task_count} 任务</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== 右侧：任务看板 ===== */}
          <div className="orch-board">
            {!detail ? (
              <div className="orch-empty-lrg">选择左侧频道查看任务看板</div>
            ) : (
              <>
                <div className="orch-board-head">
                  <div>
                    <div className="orch-board-title">{detail.channel.channel_name}</div>
                    <div className="orch-board-meta">
                      总经理：{detail.channel.general_manager} · 质检：{detail.channel.reviewer}
                    </div>
                  </div>
                  <div className="orch-board-actions">
                    <button
                      className="btn"
                      disabled={decomposing || busy}
                      onClick={handleDecompose}
                    >
                      {decomposing ? "拆解中…" : "⇩ 拆解诉求"}
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={handleFinalReview}
                    >
                      终审
                    </button>
                  </div>
                </div>

                <div className="orch-decompose">
                  <input
                    className="input"
                    placeholder="输入整体诉求，总经理将拆解为子任务…"
                    value={decomposeReq}
                    onChange={(e) => setDecomposeReq(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleDecompose()}
                  />
                </div>

                <div className="orch-columns">
                  {STATUS_ORDER.map((st) => {
                    const col = detail.tasks.filter((t) => t.status === st);
                    return (
                      <div className="orch-col" key={st}>
                        <div className="orch-col-head">
                          <span>{STATUS_LABEL[st]}</span>
                          <span className="orch-col-count">{col.length}</span>
                        </div>
                        <div className="orch-col-body">
                          {col.length === 0 && <div className="orch-col-empty">—</div>}
                          {col.map((t) => (
                            <div className="orch-task" key={t.name}>
                              <div className="orch-task-title">{t.title}</div>
                              {t.assigned_to && (
                                <div className="orch-task-assign">承接：{t.assigned_to}</div>
                              )}
                              {t.review_note && (
                                <div className="orch-task-note">质检：{t.review_note}</div>
                              )}
                              {t.final_note && (
                                <div className="orch-task-note">终审：{t.final_note}</div>
                              )}
                              <div className="orch-task-actions">
                                {st === "pending" && (
                                  <button className="btn btn-sm" onClick={() => openAction("claim", t)}>
                                    领取
                                  </button>
                                )}
                                {(st === "claimed" || st === "executing") && (
                                  <button className="btn btn-sm" onClick={() => openAction("submit", t)}>
                                    提交
                                  </button>
                                )}
                                {st === "reviewing" && (
                                  <>
                                    <button className="btn btn-sm" onClick={() => { setActionType("review"); setActionTask(t); setActionText("approve"); setActionNote(""); }}>
                                      通过
                                    </button>
                                    <button className="btn btn-sm btn-danger" onClick={() => { setActionType("review"); setActionTask(t); setActionText("reject"); setActionNote(""); }}>
                                      驳回
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ===== 任务操作弹层 ===== */}
        {actionTask && actionType && (
          <div className="cdate-overlay" onClick={() => setActionTask(null)}>
            <div className="cdate-panel" onClick={(e) => e.stopPropagation()}>
              <div className="cdate-head">
                <div className="cdate-title">
                  {actionType === "claim" && "领取任务"}
                  {actionType === "submit" && "提交交付结果"}
                  {actionType === "review" && "质检"}
                </div>
                <button className="btn btn-ghost cdate-close" onClick={() => setActionTask(null)}>✕</button>
              </div>
              <div className="cdate-body">
                <div className="form-label">{actionTask.title}</div>
                {actionType === "claim" && (
                  <>
                    <div className="form-label">承接人</div>
                    <select
                      className="input"
                      value={actionText}
                      onChange={(e) => setActionText(e.target.value)}
                    >
                      <option value="">选择成员</option>
                      {agents.map((a) => (
                        <option key={a.name} value={a.name}>{a.agent_name}</option>
                      ))}
                    </select>
                  </>
                )}
                {actionType === "submit" && (
                  <>
                    <div className="form-label">交付结果</div>
                    <textarea
                      className="input"
                      rows={4}
                      placeholder="填写任务完成结果…"
                      value={actionText}
                      onChange={(e) => setActionText(e.target.value)}
                    />
                  </>
                )}
                {actionType === "review" && (
                  <div className="review-vote">
                    <div className="review-vote-result">
                      判定：{actionText === "approve" ? "通过" : "驳回"}
                    </div>
                    <div className="form-label">质检说明（可选）</div>
                    <textarea
                      className="input"
                      rows={3}
                      placeholder="填写质检意见…"
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                    />
                  </div>
                )}
                <div className="cdate-actions">
                  <button className="btn" onClick={() => setActionTask(null)}>取消</button>
                  <button className="btn btn-primary" disabled={busy} onClick={runAction}>
                    确认
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}