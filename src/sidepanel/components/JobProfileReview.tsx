import { useState, type FormEvent } from "react";
import {
  modelRecruitmentProfileSchema,
  type ModelRecruitmentProfile,
  type RecruitmentRequirement
} from "../../shared/contracts/recruitment-profile";
import { dimensionIds } from "../../shared/contracts/matching";

interface JobProfileReviewProps {
  profile: ModelRecruitmentProfile;
  onConfirm(profile: ModelRecruitmentProfile): Promise<string | undefined>;
  onRegenerate(): void;
}

type ProfileErrors = {
  roleTitle?: string;
  roleObjective?: string;
  requirements?: string;
  requirementText?: Record<number, string>;
};

const priorityLabels: Record<RecruitmentRequirement["priority"], string> = {
  hard: "硬性",
  preferred: "优先",
  standard: "普通"
};

const dimensionLabels: Record<typeof dimensionIds[number], string> = {
  hard_requirements: "基础条件",
  functional_expertise: "职能经验与专业能力",
  industry_business: "行业与业务匹配",
  seniority_impact: "职级、管理跨度与成果",
  trajectory_stability: "职业轨迹与稳定性",
  recruiter_feasibility: "猎头推进可行性"
};

const defaultWeight = (requirements: readonly RecruitmentRequirement[]): number => {
  if (requirements.length === 0) return 1;
  const sorted = requirements.map(({ weight }) => weight).sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
};

export function JobProfileReview({ profile, onConfirm, onRegenerate }: JobProfileReviewProps) {
  const [draft, setDraft] = useState<ModelRecruitmentProfile>(profile);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateRequirement(index: number, patch: Partial<RecruitmentRequirement>) {
    setDraft((current) => ({
      ...current,
      requirements: current.requirements.map((requirement, requirementIndex) =>
        requirementIndex === index ? { ...requirement, ...patch } : requirement
      )
    }));
  }

  function addRequirement() {
    setDraft((current) => ({
      ...current,
      requirements: [
        ...current.requirements,
        {
          id: crypto.randomUUID(),
          text: "",
          priority: "standard",
          dimensionId: "functional_expertise",
          weight: defaultWeight(current.requirements),
          jobEvidence: ["猎头手动补充要求：待填写"]
        }
      ]
    }));
  }

  function removeRequirement(index: number) {
    setDraft((current) => ({
      ...current,
      requirements: current.requirements.filter((_, requirementIndex) => requirementIndex !== index)
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = {
      ...draft,
      requirements: draft.requirements.map((requirement) => ({
        ...requirement,
        jobEvidence: requirement.jobEvidence[0]?.startsWith("猎头手动补充要求：")
          ? [`猎头手动补充要求：${requirement.text.trim()}`]
          : requirement.jobEvidence
      }))
    };
    const parsed = modelRecruitmentProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      const nextErrors: ProfileErrors = { requirementText: {} };
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "roleTitle") {
          nextErrors.roleTitle = issue.message.includes("受保护")
            ? issue.message
            : "请输入岗位名称";
        }
        if (issue.path[0] === "roleObjective") {
          nextErrors.roleObjective = issue.message.includes("受保护")
            ? issue.message
            : "请输入岗位目标";
        }
        if (issue.path[0] === "requirements" && typeof issue.path[1] !== "number") {
          nextErrors.requirements = "请至少保留一条招聘要求";
        }
        if (issue.path[0] === "requirements" && typeof issue.path[1] === "number") {
          nextErrors.requirementText![issue.path[1]] = issue.message.includes("受保护")
            ? "招聘要求不得包含受保护的个人特征"
            : "请输入招聘要求";
        }
      }
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitError("");
    setSubmitting(true);
    try {
      const error = await onConfirm(parsed.data);
      if (error) setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-card profile-review" aria-labelledby="profile-review-title">
      <p className="eyebrow">AI 岗位分析完成</p>
      <h2 id="profile-review-title">确认招聘关键要求</h2>
      <p className="muted">可逐条修改、增加或删除。确认一次后，同一岗位的后续候选人会复用这份标准。</p>

      <form className="form-stack" noValidate onSubmit={handleSubmit}>
        <label>
          岗位名称
          <input
            value={draft.roleTitle}
            aria-invalid={Boolean(errors.roleTitle)}
            onChange={(event) => setDraft((current) => ({
              ...current,
              roleTitle: event.target.value
            }))}
          />
        </label>
        {errors.roleTitle && <p className="field-error">{errors.roleTitle}</p>}

        <label>
          岗位目标
          <textarea
            rows={3}
            value={draft.roleObjective}
            aria-invalid={Boolean(errors.roleObjective)}
            onChange={(event) => setDraft((current) => ({
              ...current,
              roleObjective: event.target.value
            }))}
          />
        </label>
        {errors.roleObjective && <p className="field-error">{errors.roleObjective}</p>}

        <div className="profile-requirements" aria-label="招聘关键要求">
          {draft.requirements.map((requirement, index) => (
            <fieldset className="profile-requirement" key={requirement.id}>
              <legend>要求 {index + 1}</legend>
              <label>
                要求 {index + 1} 内容
                <textarea
                  rows={3}
                  value={requirement.text}
                  aria-invalid={Boolean(errors.requirementText?.[index])}
                  onChange={(event) => updateRequirement(index, { text: event.target.value })}
                />
              </label>
              {errors.requirementText?.[index] && (
                <p className="field-error">{errors.requirementText[index]}</p>
              )}
              <div className="profile-requirement-controls">
                <label>
                  要求 {index + 1} 优先级
                  <select
                    value={requirement.priority}
                    onChange={(event) => updateRequirement(index, {
                      priority: event.target.value as RecruitmentRequirement["priority"]
                    })}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  要求 {index + 1} 匹配维度
                  <select
                    value={requirement.dimensionId}
                    onChange={(event) => updateRequirement(index, {
                      dimensionId: event.target.value as RecruitmentRequirement["dimensionId"]
                    })}
                  >
                    {dimensionIds.map((dimensionId) => (
                      <option key={dimensionId} value={dimensionId}>{dimensionLabels[dimensionId]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="field-hint">AI 建议权重：{requirement.weight}</p>
              <button
                className="danger-text-button"
                type="button"
                aria-label={`删除要求 ${index + 1}`}
                onClick={() => removeRequirement(index)}
              >
                删除此要求
              </button>
            </fieldset>
          ))}
        </div>
        {errors.requirements && <p className="field-error">{errors.requirements}</p>}

        <button className="secondary-button" type="button" onClick={addRequirement}>
          增加招聘要求
        </button>
        {submitError && <p className="form-error" role="alert">{submitError}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "正在确认…" : "确认岗位画像"}
        </button>
        <button className="text-button" type="button" disabled={submitting} onClick={onRegenerate}>
          重新分析岗位
        </button>
      </form>
    </section>
  );
}
