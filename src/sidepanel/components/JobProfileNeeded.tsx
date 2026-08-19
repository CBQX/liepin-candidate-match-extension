import type { Job } from "../../shared/contracts/job";

interface JobProfileNeededProps {
  job: Job;
  onAnalyze(): void;
}

export function JobProfileNeeded({ job, onAnalyze }: JobProfileNeededProps) {
  return (
    <section className="panel-card ready-card" aria-labelledby="profile-needed-title">
      <p className="eyebrow">当前岗位 · {job.company}</p>
      <h2 id="profile-needed-title">需要生成岗位画像</h2>
      <p className="muted">AI 会先提炼招聘关键要求，待你编辑并确认后再开始候选人评分。</p>
      <button className="primary-button" type="button" onClick={onAnalyze}>分析岗位要求</button>
    </section>
  );
}
