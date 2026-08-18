import type { Job } from "../../shared/contracts/job";

interface JobSelectorProps {
  jobs: readonly Job[];
  activeJobId?: string;
  disabled?: boolean;
  onChange(id: string): void;
  onAdd(): void;
}

export function JobSelector({ jobs, activeJobId, disabled, onChange, onAdd }: JobSelectorProps) {
  return (
    <section className="job-toolbar" aria-label="岗位选择">
      <label>
        当前岗位
        <select
          value={activeJobId ?? ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {!activeJobId && <option value="" disabled>请选择岗位</option>}
          {jobs.map((job) => <option key={job.id} value={job.id}>{job.company}</option>)}
        </select>
      </label>
      <button className="secondary-button" type="button" onClick={onAdd}>添加新岗位</button>
    </section>
  );
}
