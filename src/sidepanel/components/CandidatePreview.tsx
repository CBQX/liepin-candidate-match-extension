import { useState } from "react";
import type {
  CandidateDraft,
  CandidateRedactionContext
} from "../../shared/contracts/candidate";

type CandidateSectionKey = Exclude<keyof CandidateDraft, "extractionConfidence">;

const sections: ReadonlyArray<{ key: CandidateSectionKey; label: string }> = [
  { key: "basics", label: "基本信息" },
  { key: "workExperience", label: "工作经历" },
  { key: "projects", label: "项目经历" },
  { key: "education", label: "教育经历" },
  { key: "skills", label: "技能" },
  { key: "other", label: "其他内容" }
];

const statusLabels = {
  complete: "已提取",
  possibly_incomplete: "可能不完整",
  missing: "未找到，可手动补充"
} as const;

interface CandidatePreviewProps {
  draft: CandidateDraft;
  identityDetection?: CandidateRedactionContext["identityDetection"];
  onChange(section: CandidateSectionKey, text: string): void;
  onConfirm(): void;
}

export function CandidatePreview({
  draft,
  identityDetection = "undetected",
  onChange,
  onConfirm
}: CandidatePreviewProps) {
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);

  return (
    <section className="panel-card candidate-preview" aria-labelledby="candidate-preview-title">
      <p className="eyebrow">本次分析 · 临时内容</p>
      <h2 id="candidate-preview-title">校对候选人信息</h2>
      <p className="muted">请补充缺失内容并修正提取结果，未找到的信息不会被视为不满足。</p>
      <div className="candidate-sections">
        {sections.map(({ key, label }) => (
          <label className="candidate-section" key={key}>
            <span className="candidate-section-heading">
              <span>{label}</span>
              <span className={`extraction-status extraction-status-${draft[key].status}`}>
                {statusLabels[draft[key].status]}
              </span>
            </span>
            <textarea
              aria-label={label}
              value={draft[key].text}
              onChange={(event) => {
                setPrivacyConfirmed(false);
                onChange(key, event.target.value);
              }}
            />
          </label>
        ))}
      </div>
      <p className="consent-disclosure">确认后，以下脱敏内容将发送至 DeepSeek 进行本次分析</p>
      {identityDetection !== "confirmed" && (
        <p className="privacy-warning" role="note">
          未能可靠识别候选人姓名，请特别检查预览中是否仍有姓名或其他直接标识。
        </p>
      )}
      <label className="checkbox-row privacy-confirmation">
        <input
          type="checkbox"
          checked={privacyConfirmed}
          onChange={(event) => setPrivacyConfirmed(event.target.checked)}
        />
        我已检查并确认内容中不含候选人姓名、联系方式或猎聘 ID
      </label>
      <button
        className="primary-button"
        type="button"
        disabled={!privacyConfirmed}
        onClick={onConfirm}
      >
        确认并分析
      </button>
    </section>
  );
}
