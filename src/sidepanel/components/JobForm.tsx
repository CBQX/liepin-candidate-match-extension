import { useState, type FormEvent } from "react";
import type { CreateJobInput } from "../../domain/jobs/job-service";

interface JobFormProps {
  onSave(input: CreateJobInput): Promise<string | undefined>;
}

type FieldErrors = Partial<Record<keyof CreateJobInput, string>>;

export function JobForm({ onSave }: JobFormProps) {
  const [company, setCompany] = useState("");
  const [jd, setJd] = useState("");
  const [customRequirements, setCustomRequirements] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: FieldErrors = {};
    if (!company.trim()) nextErrors.company = "请输入公司名称";
    if (!jd.trim()) nextErrors.jd = "请输入职位 JD";
    if (!customRequirements.trim()) nextErrors.customRequirements = "请输入个性化要求";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitError("");
    setSubmitting(true);
    try {
      const error = await onSave({ company, jd, customRequirements });
      if (error) setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-card" aria-labelledby="job-form-title">
      <p className="eyebrow">岗位设置</p>
      <h2 id="job-form-title">添加新岗位</h2>
      <p className="muted">这三项会作为每次候选人匹配的判断依据。</p>

      <form className="form-stack" noValidate onSubmit={handleSubmit}>
        <label>
          公司名称
          <input
            value={company}
            required
            aria-invalid={Boolean(errors.company)}
            aria-describedby={errors.company ? "company-error" : undefined}
            onChange={(event) => setCompany(event.target.value)}
          />
        </label>
        {errors.company && <p className="field-error" id="company-error">{errors.company}</p>}

        <label>
          职位 JD
          <textarea
            rows={7}
            value={jd}
            required
            aria-invalid={Boolean(errors.jd)}
            aria-describedby={errors.jd ? "jd-error" : undefined}
            onChange={(event) => setJd(event.target.value)}
          />
        </label>
        {errors.jd && <p className="field-error" id="jd-error">{errors.jd}</p>}

        <label>
          个性化要求
          <textarea
            rows={4}
            value={customRequirements}
            required
            aria-invalid={Boolean(errors.customRequirements)}
            aria-describedby={errors.customRequirements ? "requirements-error" : undefined}
            onChange={(event) => setCustomRequirements(event.target.value)}
          />
        </label>
        {errors.customRequirements && (
          <p className="field-error" id="requirements-error">{errors.customRequirements}</p>
        )}

        {submitError && <p className="form-error" role="alert">{submitError}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "正在保存…" : "保存岗位"}
        </button>
      </form>
    </section>
  );
}
