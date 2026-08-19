import { describe, expect, it } from "vitest";
import { composeAnalysis as composeAnalysisDomain } from "../../src/domain/matching/compose-analysis";
import { evaluateObjectiveRules } from "../../src/domain/matching/rules";
import type { ModelMatchResult, RuleEvaluation } from "../../src/shared/contracts/matching";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { ConfirmedRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

const dimensionIds = [
  "hard_requirements",
  "functional_expertise",
  "industry_business",
  "seniority_impact",
  "trajectory_stability",
  "recruiter_feasibility"
] as const;

const modelResultWithScores = (scores: readonly number[]): ModelMatchResult => ({
  dimensionScores: dimensionIds.map((dimensionId, index) => ({
    dimensionId,
    score: scores[index]!,
    evidence: [`${dimensionId} evidence`]
  })),
  matches: [],
  mismatches: [],
  risks: [],
  missingInformation: [],
  verificationQuestions: [],
  outreachAdvice: [],
  recruiterConclusion: "推进"
});

const modelResultWithAllDimensionsAt = (score: number) =>
  modelResultWithScores([score, score, score, score, score, score]);

const completeDraft: CandidateDraft = {
  basics: { text: "候选人，上海", status: "complete" },
  workExperience: { text: "明确工作经历", status: "complete" },
  projects: { text: "项目经历", status: "complete" },
  education: { text: "本科", status: "complete" },
  skills: { text: "产品规划", status: "complete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "high"
};

const defaultProfile: ConfirmedRecruitmentProfile = {
  version: 1,
  roleTitle: "虚构产品经理",
  roleObjective: "负责虚构产品",
  requirements: dimensionIds.map((dimensionId, index) => ({
    id: `requirement-${index + 1}`,
    text: `${dimensionId} 招聘要求`,
    priority: index === 0 ? "hard" as const : "standard" as const,
    dimensionId,
    weight: [25, 25, 15, 15, 10, 10][index]!,
    jobEvidence: [`${dimensionId} 岗位依据`]
  })),
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: [],
  confirmedAt: "2026-08-19T00:00:00.000Z"
};

const composeAnalysis = (
  modelResult: ModelMatchResult,
  ruleResults: readonly RuleEvaluation[],
  candidate: CandidateDraft | CandidateDraft["extractionConfidence"],
  profile = defaultProfile
) => composeAnalysisDomain(modelResult, ruleResults, candidate, profile);

describe("composeAnalysis", () => {
  it("computes the weighted score without downgrading contact advice on a hard failure", () => {
    const analysis = composeAnalysis(modelResultWithAllDimensionsAt(90), [
      { criterionId: "c1", status: "not_met", evidence: ["候选人明确为大专"] }
    ], "high");

    expect(analysis.overallScore).toBe(90);
    expect(analysis.recommendation).toBe("strong_recommend");
  });

  it("uses the confirmed profile dimension weights and rounds only the total", () => {
    const analysis = composeAnalysis(modelResultWithScores([83, 71, 64, 92, 55, 78]), [], "high");

    expect(analysis.overallScore).toBe(75);
    expect(analysis.recommendation).toBe("recommend");
  });

  it("derives a job-specific score from requirement weights", () => {
    const functionalOnly: ConfirmedRecruitmentProfile = {
      ...defaultProfile,
      requirements: [{
        id: "functional-only",
        text: "核心职能经验",
        priority: "hard",
        dimensionId: "functional_expertise",
        weight: 100,
        jobEvidence: ["岗位只强调核心职能经验"]
      }]
    };

    const analysis = composeAnalysis(
      modelResultWithScores([10, 92, 10, 10, 10, 10]),
      [],
      "high",
      functionalOnly
    );

    expect(analysis.overallScore).toBe(92);
    expect(analysis.recommendation).toBe("strong_recommend");
  });

  it.each([
    [85, "strong_recommend"],
    [84, "recommend"],
    [70, "recommend"],
    [69, "cautious"],
    [55, "cautious"],
    [54, "not_recommend"]
  ] as const)("maps a score of %i to %s", (score, recommendation) => {
    expect(composeAnalysis(modelResultWithAllDimensionsAt(score), [], "high").recommendation)
      .toBe(recommendation);
  });

  it("does not turn multiple hard failures into an elimination result", () => {
    const analysis = composeAnalysis(modelResultWithAllDimensionsAt(95), [
      { criterionId: "c1", status: "not_met", evidence: ["证据一"] },
      { criterionId: "c2", status: "not_met", evidence: ["证据二"] }
    ], "high");

    expect(analysis.overallScore).toBe(95);
    expect(analysis.recommendation).toBe("strong_recommend");
  });

  it("lowers confidence for unknown hard requirements without deducting score", () => {
    const analysis = composeAnalysis(modelResultWithAllDimensionsAt(80), [
      { criterionId: "c1", status: "unknown", evidence: [] }
    ], "medium");

    expect(analysis.overallScore).toBe(80);
    expect(analysis.confidence).toBe("medium");
  });

  it("caps confidence at medium for one unknown hard criterion and low for several", () => {
    const oneUnknown = composeAnalysis(modelResultWithAllDimensionsAt(80), [
      { criterionId: "c1", status: "unknown", evidence: [] }
    ], "high");
    const severalUnknown = composeAnalysis(modelResultWithAllDimensionsAt(80), [
      { criterionId: "c1", status: "unknown", evidence: [] },
      { criterionId: "c2", status: "unknown", evidence: [] }
    ], "high");

    expect(oneUnknown.confidence).toBe("medium");
    expect(severalUnknown.confidence).toBe("low");
  });

  it("never lets candidate-source evidence on unknown breaker rules change score or recommendation", () => {
    const withoutEvidence = composeAnalysis(modelResultWithAllDimensionsAt(90), [
      { criterionId: "location", status: "unknown", evidence: [] },
      { criterionId: "years", status: "unknown", evidence: [] },
      { criterionId: "certificate", status: "unknown", evidence: [] }
    ], "high");
    const withContradictoryEvidence = composeAnalysis(modelResultWithAllDimensionsAt(90), [
      { criterionId: "location", status: "unknown", evidence: ["基本信息：现居地：北京"] },
      { criterionId: "years", status: "unknown", evidence: ["工作经历：不足 5 年工作经验"] },
      { criterionId: "certificate", status: "unknown", evidence: ["技能：未通过 PMP"] }
    ], "high");

    expect({
      overallScore: withContradictoryEvidence.overallScore,
      recommendation: withContradictoryEvidence.recommendation,
      confidence: withContradictoryEvidence.confidence
    }).toEqual({
      overallScore: withoutEvidence.overallScore,
      recommendation: withoutEvidence.recommendation,
      confidence: withoutEvidence.confidence
    });
    expect(withContradictoryEvidence).toMatchObject({
      overallScore: 90,
      recommendation: "cautious",
      confidence: "low"
    });
  });

  it("sets low confidence when a core candidate section is missing despite a high extraction flag", () => {
    // Break caught: trusting extractionConfidence alone can label an analysis high-confidence with no work history.
    const analysis = composeAnalysis(modelResultWithAllDimensionsAt(80), [], {
      ...completeDraft,
      workExperience: { text: "", status: "missing" }
    });

    expect(analysis.confidence).toBe("low");
  });

  it("lowers confidence for critical model gaps even when extracted sections are complete", () => {
    // Break caught: a model-reported gap about core experience must affect the displayed confidence.
    const modelResult: ModelMatchResult = {
      ...modelResultWithAllDimensionsAt(80),
      missingInformation: [{
        claim: "关键工作年限与任职范围无法确认",
        jobEvidence: ["岗位要求核心工作年限"],
        candidateEvidence: ["候选人材料未提供可核实时间范围"]
      }]
    };

    expect(composeAnalysis(modelResult, [], completeDraft).confidence).toBe("low");
  });

  it("caps confidence at medium when non-core section gaps or model gaps remain", () => {
    // Break caught: several otherwise-complete sections should not hide a meaningful but non-critical information gap.
    const modelResult: ModelMatchResult = {
      ...modelResultWithAllDimensionsAt(80),
      missingInformation: [{
        claim: "需要补充团队规模",
        jobEvidence: ["岗位关注管理跨度"],
        candidateEvidence: ["候选人材料未说明团队人数"]
      }]
    };

    expect(composeAnalysis(modelResult, [], completeDraft).confidence).toBe("medium");
  });

  it("does not apply hard gates to preferred objective criteria", () => {
    const preferredRuleResults = evaluateObjectiveRules([{
      id: "c1",
      text: "PMP 优先",
      priority: "preferred",
      source: "jd"
    }], { tokens: new Set() });

    const analysis = composeAnalysis(
      modelResultWithAllDimensionsAt(90),
      preferredRuleResults,
      "high"
    );

    expect(analysis.recommendation).toBe("strong_recommend");
    expect(analysis.confidence).toBe("high");
    expect(analysis.hardRequirements).toEqual([]);
  });

  it("preserves all model analysis fields and attaches hard requirements", () => {
    const modelResult = modelResultWithAllDimensionsAt(80);
    const hardRequirements = [{ criterionId: "c1", status: "met" as const, evidence: ["本科"] }];
    const analysis = composeAnalysis(modelResult, hardRequirements, "high");

    expect(analysis.dimensionScores).toEqual(modelResult.dimensionScores);
    expect(analysis.recruiterConclusion).toBe("推进");
    expect(analysis.hardRequirements).toEqual(hardRequirements);
  });

  it.each([
    { label: "missing", modelResult: {
      ...modelResultWithAllDimensionsAt(80),
      dimensionScores: modelResultWithAllDimensionsAt(80).dimensionScores.slice(0, 5)
    } },
    { label: "duplicate", modelResult: {
      ...modelResultWithAllDimensionsAt(80),
      dimensionScores: [
        ...modelResultWithAllDimensionsAt(80).dimensionScores.slice(0, 5),
        modelResultWithAllDimensionsAt(80).dimensionScores[0]!
      ]
    } }
  ])("rejects $label dimension coverage", ({ modelResult }) => {
    expect(() => composeAnalysis(modelResult as ModelMatchResult, [], "high")).toThrow(/dimension/i);
  });
});
