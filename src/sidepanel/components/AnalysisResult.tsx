import type { Job } from "../../shared/contracts/job";
import type {
  MatchAnalysis,
  QualitativeEvidence
} from "../../shared/contracts/matching";

const recommendationLabels: Record<MatchAnalysis["recommendation"], string> = {
  contact: "建议联系",
  verify_before_contact: "联系前先核实",
  deprioritize: "暂不优先联系"
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
  return (
    <section className="panel-card analysis-result" aria-labelledby="analysis-result-title">
      <p className="eyebrow">匹配分析完成</p>
      <h2 id="analysis-result-title">{job.company} · 人选匹配报告</h2>

      <section
        className="result-section recruiter-conclusion"
        aria-labelledby="recruiter-conclusion-title"
      >
        <h3 id="recruiter-conclusion-title">猎头结论</h3>
        <p>{analysis.recruiterConclusion}</p>
        <ul className="conclusion-highlights">
          {analysis.conclusionHighlights.map((highlight) => (
            <li key={highlight}><strong>{highlight}</strong></li>
          ))}
        </ul>
      </section>

      <div className="result-summary">
        <div className="score-block">
          <span className="score-value">{analysis.overallScore}</span>
          <span>综合匹配分 / 100</span>
        </div>
        <div className="summary-badges">
          <strong>{recommendationLabels[analysis.recommendation]}</strong>
        </div>
      </div>

      <EvidenceSection
        title="主要匹配理由"
        items={analysis.matches}
        emptyText="暂无明确匹配理由。"
      />
      <EvidenceSection
        title="主要顾虑或信息缺口"
        items={analysis.concerns}
        emptyText="暂无明显顾虑或关键缺失信息。"
      />

      <section className="result-section">
        <h3>建议核实问题</h3>
        {analysis.verificationQuestions.length === 0
          ? <p className="muted result-empty">暂无需要优先核实的问题。</p>
          : <ul>{analysis.verificationQuestions.map((question) => <li key={question}>{question}</li>)}</ul>}
      </section>
    </section>
  );
}
