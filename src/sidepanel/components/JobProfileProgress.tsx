interface JobProfileProgressProps {
  onCancel(): void;
}

export function JobProfileProgress({ onCancel }: JobProfileProgressProps) {
  return (
    <section className="panel-card analysis-progress" aria-labelledby="profile-progress-title">
      <span className="progress-spinner" aria-hidden="true" />
      <p className="eyebrow">AI 岗位分析</p>
      <h2 id="profile-progress-title">正在提炼招聘关键要求…</h2>
      <p className="muted">通常只需生成一次，确认后同一岗位的候选人将复用这份画像。</p>
      <button className="secondary-button" type="button" onClick={onCancel}>取消岗位分析</button>
    </section>
  );
}
