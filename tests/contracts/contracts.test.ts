import { describe, expect, it } from "vitest";
import { jobSchema } from "../../src/shared/contracts/job";
import { matchAnalysisSchema } from "../../src/shared/contracts/matching";

describe("runtime contracts", () => {
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
});
