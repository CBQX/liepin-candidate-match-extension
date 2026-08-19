import { useState } from "react";
import type { Job } from "../../shared/contracts/job";

interface ReadyStateProps {
  activeJob: Job;
  onMatchAnalysis(): Promise<string | undefined>;
  onRegenerateProfile(): void;
}

export function ReadyState({ activeJob, onMatchAnalysis, onRegenerateProfile }: ReadyStateProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleMatchAnalysis() {
    setSubmitting(true);
    setError("");
    try {
      const nextError = await onMatchAnalysis();
      if (nextError) setError(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-card ready-card" aria-labelledby="ready-title">
      <div className="ready-mark" aria-hidden="true">✓</div>
      <p className="eyebrow">当前岗位</p>
      <p className="ready-job-role">{activeJob.recruitmentProfile?.roleTitle ?? "待确认岗位"}</p>
      <p className="ready-job-company">{activeJob.company}</p>
      <h2 id="ready-title">岗位画像已确认，可以开始浏览候选人</h2>
      <p className="muted">在猎聘打开候选人详情页后，再由你手动开始匹配。</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        className="primary-button"
        type="button"
        disabled={submitting}
        onClick={handleMatchAnalysis}
      >
        {submitting ? "正在读取…" : "匹配分析"}
      </button>
      <button className="text-button" type="button" onClick={onRegenerateProfile}>
        重新分析岗位
      </button>
    </section>
  );
}
