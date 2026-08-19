import { describe, expect, it } from "vitest";
import { jobSchema } from "../../src/shared/contracts/job";
import {
  matchAnalysisSchema,
  modelMatchResultSchema,
  ruleEvaluationSchema
} from "../../src/shared/contracts/matching";
import { runtimeRequestSchema } from "../../src/shared/contracts/messages";

const evidenceBackedModelResult = {
  overallScore: 82,
  recommendation: "contact",
  matches: [{
    claim: "核心产品经验匹配",
    jobEvidence: ["岗位要求负责企业软件产品"],
    candidateEvidence: ["候选人曾负责企业软件产品"]
  }, {
    claim: "项目交付经验匹配",
    jobEvidence: ["岗位要求推动复杂项目交付"],
    candidateEvidence: ["候选人材料明确列出跨团队交付经历"]
  }],
  concerns: [{
    claim: "团队规模尚需核实",
    jobEvidence: ["岗位要求管理跨职能团队"],
    candidateEvidence: ["候选人材料未提供团队人数"]
  }],
  verificationQuestions: ["请核实直接管理人数", "请核实海外业务占比"],
  conclusionHighlights: ["企业软件经验是主要优势", "联系前核实团队规模"],
  recruiterConclusion: "匹配度较高，建议联系并核实团队规模。"
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

  it("accepts bounded job-profile runtime requests and rejects invalid confirmation data", () => {
    const job = {
      id: "synthetic-job",
      company: "虚构甲公司",
      jd: "负责虚构企业软件产品",
      customRequirements: "企业软件经验优先",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z"
    };
    expect(runtimeRequestSchema.safeParse({
      type: "GENERATE_JOB_PROFILE",
      requestId: "profile-request-1",
      job
    }).success).toBe(true);
    expect(runtimeRequestSchema.safeParse({
      type: "CANCEL_JOB_PROFILE",
      requestId: "profile-request-1"
    }).success).toBe(true);
    expect(runtimeRequestSchema.safeParse({
      type: "CONFIRM_JOB_PROFILE",
      jobId: job.id,
      profile: { version: 1, roleTitle: "不完整" }
    }).success).toBe(false);
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

  it("accepts the lightweight evidence-backed result contract", () => {
    expect(modelMatchResultSchema.parse(evidenceBackedModelResult)).toEqual(evidenceBackedModelResult);
    expect(matchAnalysisSchema.parse(evidenceBackedModelResult)).toEqual(evidenceBackedModelResult);
  });

  it("rejects out-of-range analysis scores and unknown contact recommendations", () => {
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      overallScore: 101
    }).success).toBe(false);
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      recommendation: "reject"
    }).success).toBe(false);
  });

  it.each([
    ["one match", { matches: evidenceBackedModelResult.matches.slice(0, 1) }],
    ["six matches", { matches: Array.from({ length: 6 }, () => evidenceBackedModelResult.matches[0]) }],
    ["four concerns", { concerns: Array.from({ length: 4 }, () => evidenceBackedModelResult.concerns[0]) }],
    ["four questions", { verificationQuestions: ["一", "二", "三", "四"] }]
  ])("rejects a lightweight result with %s", (_label, override) => {
    // Break caught: unbounded or underspecified results recreate the slow, verbose candidate response.
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      ...override
    }).success).toBe(false);
  });

  it("rejects an unbounded conclusion or evidence paragraph", () => {
    // Break caught: a single oversized string could consume the 8192-token allowance despite bounded item counts.
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      recruiterConclusion: "结".repeat(601)
    }).success).toBe(false);
    expect(modelMatchResultSchema.safeParse({
      ...evidenceBackedModelResult,
      matches: evidenceBackedModelResult.matches.map((match, index) => index === 0
        ? { ...match, candidateEvidence: ["证".repeat(301)] }
        : match)
    }).success).toBe(false);
  });

  it("requires one to three concise recruiter conclusion highlights", () => {
    // Break caught: missing or unbounded emphasis would make the conclusion hierarchy unreliable or verbose.
    const { conclusionHighlights: _highlights, ...withoutHighlights } = evidenceBackedModelResult;

    for (const invalid of [
      withoutHighlights,
      { ...evidenceBackedModelResult, conclusionHighlights: [] },
      { ...evidenceBackedModelResult, conclusionHighlights: ["一", "二", "三", "四"] },
      { ...evidenceBackedModelResult, conclusionHighlights: ["重".repeat(121)] }
    ]) {
      expect(modelMatchResultSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it.each(["matches", "concerns"] as const)(
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
