interface AnalysisProgressProps {
  onCancel(): void;
}

export function AnalysisProgress({ onCancel }: AnalysisProgressProps) {
  return (
    <section className="panel-card analysis-progress" aria-live="polite" aria-busy="true">
      <span className="progress-spinner" aria-hidden="true" />
      <p className="eyebrow">正在分析</p>
      <h2>正在生成匹配分析…</h2>
      <p className="muted">正在核对硬性条件、岗位证据和候选人经历，请稍候。</p>
      <button className="secondary-button" type="button" onClick={onCancel}>取消分析</button>
    </section>
  );
}
