import { describe, expect, it } from "vitest";
import { jobSchema } from "../../src/shared/contracts/job";
import {
  dimensionIds,
  matchAnalysisSchema,
  modelMatchResultSchema,
  ruleEvaluationSchema
} from "../../src/shared/contracts/matching";

const evidenceBackedModelResult = {
  dimensionScores: dimensionIds.map((dimensionId) => ({
    dimensionId,
    score: 80,
    evidence: ["岗位与候选人材料中的明确依据"]
  })),
  matches: [],
  mismatches: [],
  risks: [],
  missingInformation: [],
  verificationQuestions: [],
  outreachAdvice: [],
  recruiterConclusion: "建议推进"
};

describe("runtime contracts", () => {
  it("accepts a legacy job without a recruitment profile", () => {
    const parsed = jobSchema.parse({
      id: "legacy-job",
      company: "虚构甲公司",
      jd: "负责虚构企业软件产品",
      customRequirements: "企业软件经验优先",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z"
    });

    expect(parsed.recruitmentProfile).toBeUndefined();
  });

  it("rejects a job with any blank required field", () => {
    expect(jobSchema.safeParse({
      id: "job-1",
      company: "甲公司",
      jd: "   ",
      customRequirements: "需要 B2B 经验",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z"
    }).success).toBe(false);
  });

  it("rejects out-of-range analysis scores", () => {
    expect(matchAnalysisSchema.safeParse({
      overallScore: 101,
      recommendation: "strong_recommend",
      confidence: "high",
      dimensionScores: [],
      hardRequirements: [],
      matches: [], mismatches: [], risks: [], missingInformation: [],
      verificationQuestions: [], outreachAdvice: [], recruiterConclusion: "推进"
    }).success).toBe(false);
  });

  it("rejects a dimension score without supporting evidence", () => {
    // Break caught: an evidence-free score could pass runtime validation and appear authoritative in the UI.
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      dimensionScores: [{
        ...evidenceBackedModelResult.dimensionScores[0],
        evidence: []
      }]
    }).success).toBe(false);
  });

  it("requires every matching dimension exactly once in model output", () => {
    // Break caught: incomplete or duplicate dimensions must trigger the provider repair request, not reach composition.
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      dimensionScores: evidenceBackedModelResult.dimensionScores.slice(0, 5)
    }).success).toBe(false);
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      dimensionScores: [
        ...evidenceBackedModelResult.dimensionScores.slice(0, 5),
        evidenceBackedModelResult.dimensionScores[0]
      ]
    }).success).toBe(false);
  });

  it.each(["matches", "mismatches", "risks", "missingInformation"] as const)(
    "rejects an evidence-free conclusion in %s",
    (section) => {
      // Break caught: a qualitative claim could omit either job-side or candidate-side proof promised by the protocol.
      const conclusion = {
        claim: "缺少依据的结论",
        jobEvidence: ["岗位依据"],
        candidateEvidence: []
      };

      expect(modelMatchResultSchema.safeParse({
        ...evidenceBackedModelResult,
        [section]: [conclusion]
      }).success).toBe(false);
      expect(modelMatchResultSchema.safeParse({
        ...evidenceBackedModelResult,
        [section]: [{ ...conclusion, jobEvidence: [], candidateEvidence: ["候选人依据"] }]
      }).success).toBe(false);
    }
  );

  it("requires evidence for met or not-met hard requirements while allowing unknown to stay empty", () => {
    // Break caught: a deterministic hard-condition status could be accepted with no auditable rule evidence.
    expect(ruleEvaluationSchema.safeParse({
      criterionId: "c1",
      status: "met",
      evidence: []
    }).success).toBe(false);
    expect(ruleEvaluationSchema.safeParse({
      criterionId: "c1",
      status: "unknown",
      evidence: []
    }).success).toBe(true);
  });
});
