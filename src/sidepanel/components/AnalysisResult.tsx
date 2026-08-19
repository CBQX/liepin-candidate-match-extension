import {
  criteriaFromRecruitmentProfile,
  parseJobCriteria
} from "../../domain/matching/requirements";
import { dimensionWeightsFromProfile } from "../../domain/matching/weights";
import type { Job } from "../../shared/contracts/job";
import {
  dimensionIds,
  type MatchAnalysis,
  type QualitativeEvidence
} from "../../shared/contracts/matching";

const recommendationLabels: Record<MatchAnalysis["recommendation"], string> = {
  strong_recommend: "建议优先联系",
  recommend: "建议联系",
  cautious: "建议核实后联系",
  not_recommend: "暂不优先联系"
};

const confidenceLabels: Record<MatchAnalysis["confidence"], string> = {
  high: "高可信",
  medium: "中可信",
  low: "低可信"
};

const dimensionLabels: Record<typeof dimensionIds[number], string> = {
  hard_requirements: "硬性条件",
  functional_expertise: "职能经验与专业能力",
  industry_business: "行业与业务匹配",
  seniority_impact: "职级、管理跨度与成果",
  trajectory_stability: "职业轨迹与稳定性",
  recruiter_feasibility: "猎头推进可行性"
};

const statusLabels: Record<MatchAnalysis["hardRequirements"][number]["status"], string> = {
  met: "满足",
  not_met: "不满足",
  unknown: "未知"
};

interface EvidenceSectionProps {
  title: string;
  items: readonly QualitativeEvidence[];
  emptyText: string;
}

function EvidenceSection({ title, items, emptyText }: EvidenceSectionProps) {
  return (
    <section className="result-section">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="muted result-empty">{emptyText}</p> : (
        <ul className="evidence-items">
          {items.map((item, index) => (
            <li key={`${item.claim}-${index}`}>
              <h4>{item.claim}</h4>
              <div className="evidence-columns">
                <div>
                  <strong>岗位依据</strong>
                  <ul>{item.jobEvidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
                </div>
                <div>
                  <strong>候选人依据</strong>
                  <ul>{item.candidateEvidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface AnalysisResultProps {
  analysis: MatchAnalysis;
  job: Job;
}

export function AnalysisResult({ analysis, job }: AnalysisResultProps) {
  const criteria = job.recruitmentProfile
    ? criteriaFromRecruitmentProfile(job.recruitmentProfile)
    : parseJobCriteria(job);
  const dimensionWeights = job.recruitmentProfile
    ? dimensionWeightsFromProfile(job.recruitmentProfile)
    : Object.fromEntries(dimensionIds.map((dimensionId) => [dimensionId, 0]));
  const criteriaById = new Map(criteria.map((criterion) => [criterion.id, criterion.text]));
  const dimensionsById = new Map(analysis.dimensionScores.map((dimension) => [
    dimension.dimensionId,
    dimension
  ]));

  return (
    <section className="panel-card analysis-result" aria-labelledby="analysis-result-title">
      <p className="eyebrow">匹配分析完成</p>
      <h2 id="analysis-result-title">{job.company} · 人选匹配报告</h2>

      <div className="result-summary">
        <div className="score-block">
          <span className="score-value">{analysis.overallScore}</span>
          <span>总分 / 100</span>
        </div>
        <div className="summary-badges">
          <strong>{recommendationLabels[analysis.recommendation]}</strong>
          <span>{confidenceLabels[analysis.confidence]}</span>
        </div>
      </div>

      <section className="result-section">
        <h3>六维评分</h3>
        <ul className="dimension-list">
          {dimensionIds.map((dimensionId) => {
            const dimension = dimensionsById.get(dimensionId);
            if (!dimension) return null;
            return (
              <li key={dimensionId}>
                <div className="dimension-heading">
                  <strong>{dimensionLabels[dimensionId]}</strong>
                  <span>{dimension.score} 分 · 权重 {Math.round(dimensionWeights[dimensionId] * 100)}%</span>
                </div>
                <ul>{dimension.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="result-section">
        <h3>硬性条件核对</h3>
        <div className="hard-requirement-safety-note">
          <p className="muted">
            阶段 C 中，地点、工作年限和证书仅供模型分析与猎头核实；这三类在确定性硬条件核对中始终显示“未知”。
          </p>
          <p className="muted">
            自然语言履历可能包含范围、否定、计划或有效期语义，因此不用于自动满足或影响联系建议。
          </p>
        </div>
        {analysis.hardRequirements.length === 0 ? (
          <p className="muted result-empty">岗位材料中未识别到明确硬性条件。</p>
        ) : (
          <ul className="hard-requirement-list">
            {analysis.hardRequirements.map((requirement) => (
              <li key={requirement.criterionId}>
                <div className="requirement-heading">
                  <strong>{criteriaById.get(requirement.criterionId) ?? requirement.criterionId}</strong>
                  <span className={`requirement-status requirement-status-${requirement.status}`}>
                    {statusLabels[requirement.status]}
                  </span>
                </div>
                {requirement.evidence.length > 0 ? (
                  <>
                    {requirement.status === "unknown" ? (
                      <p className="muted"><strong>候选人来源证据（需猎头核实）</strong></p>
                    ) : null}
                    <ul>{requirement.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
                  </>
                ) : <p className="muted result-empty">暂无可核验证据，建议人工确认。</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <EvidenceSection title="匹配项" items={analysis.matches} emptyText="暂无明确匹配项。" />
      <EvidenceSection title="不匹配项" items={analysis.mismatches} emptyText="暂无明确不匹配项。" />
      <EvidenceSection title="风险提示" items={analysis.risks} emptyText="暂无明确风险。" />
      <EvidenceSection title="缺失信息" items={analysis.missingInformation} emptyText="暂无关键缺失信息。" />

      <section className="result-section">
        <h3>核实问题</h3>
        <ul>{analysis.verificationQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
      </section>
      <section className="result-section">
        <h3>沟通建议</h3>
        <ul>{analysis.outreachAdvice.map((advice) => <li key={advice}>{advice}</li>)}</ul>
      </section>
      <section className="result-section recruiter-conclusion">
        <h3>猎头结论</h3>
        <p>{analysis.recruiterConclusion}</p>
      </section>
    </section>
  );
}
