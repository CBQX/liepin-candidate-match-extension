import { describe, expect, it } from "vitest";
import { composeAnalysis } from "../../src/domain/matching/compose-analysis";
import { evaluateObjectiveRules } from "../../src/domain/matching/rules";
import type { ModelMatchResult } from "../../src/shared/contracts/matching";

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

describe("composeAnalysis", () => {
  it("computes the weighted score and prevents strong recommendation on a hard failure", () => {
    const analysis = composeAnalysis(modelResultWithAllDimensionsAt(90), [
      { criterionId: "c1", status: "not_met", evidence: ["候选人明确为大专"] }
    ], "high");

    expect(analysis.overallScore).toBe(90);
    expect(analysis.recommendation).toBe("recommend");
  });

  it("uses the fixed dimension weights and rounds only the total", () => {
    const analysis = composeAnalysis(modelResultWithScores([83, 71, 64, 92, 55, 78]), [], "high");

    expect(analysis.overallScore).toBe(75);
    expect(analysis.recommendation).toBe("recommend");
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

  it("sets not_recommend for two or more hard failures", () => {
    const analysis = composeAnalysis(modelResultWithAllDimensionsAt(95), [
      { criterionId: "c1", status: "not_met", evidence: ["证据一"] },
      { criterionId: "c2", status: "not_met", evidence: ["证据二"] }
    ], "high");

    expect(analysis.overallScore).toBe(95);
    expect(analysis.recommendation).toBe("not_recommend");
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
