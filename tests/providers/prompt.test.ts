import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt } from "../../src/providers/deepseek/prompt";
import type { MatchInput } from "../../src/providers/model-provider";

const input: MatchInput = {
  job: {
    id: "job-1",
    company: "甲公司",
    jd: "负责企业软件产品，要求五年产品经验",
    customRequirements: "需要带领跨职能团队",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z"
  },
  candidateDraft: {
    basics: { text: "候选人，上海", status: "complete" },
    workExperience: { text: "四年企业软件产品经验", status: "complete" },
    projects: { text: "未提供", status: "missing" },
    education: { text: "本科", status: "complete" },
    skills: { text: "需求分析", status: "complete" },
    other: { text: "", status: "missing" },
    extractionConfidence: "medium"
  },
  criteria: [{
    id: "criterion-1",
    text: "五年产品经验",
    priority: "hard",
    source: "jd"
  }],
  ruleEvaluations: [{
    criterionId: "criterion-1",
    status: "unknown",
    evidence: ["候选人仅明确提供四年经验"]
  }]
};

describe("buildAnalysisPrompt", () => {
  it("requires the complete JSON result contract", () => {
    // Break caught: omitting a result field lets the model return an incomplete object that local validation rejects.
    const { system } = buildAnalysisPrompt(input);

    for (const field of [
      "dimensionScores", "dimensionId", "score", "evidence",
      "matches", "mismatches", "risks", "missingInformation",
      "claim", "jobEvidence", "candidateEvidence",
      "verificationQuestions", "outreachAdvice", "recruiterConclusion"
    ]) {
      expect(system).toContain(field);
    }
    expect(system).toContain("仅返回一个合法的 JSON 对象");
  });

  it("forbids protected-trait scoring and unsupported factual inference", () => {
    // Break caught: removing either safety rule could turn irrelevant traits or guesses into hiring scores.
    const { system } = buildAnalysisPrompt(input);

    expect(system).toMatch(/年龄.*性别.*民族.*婚育.*不得.*评分/s);
    expect(system).toMatch(/不得.*推测.*候选人事实/s);
  });

  it("requires evidence from both sides and treats absent facts as unknown questions", () => {
    // Break caught: a one-sided or certainty-biased prompt could invent mismatches from missing profile sections.
    const { system } = buildAnalysisPrompt(input);

    expect(system).toMatch(/岗位侧证据.*候选人侧证据/s);
    expect(system).toMatch(/信息缺失.*unknown.*核实问题/s);
    expect(system).toContain("不得把未知信息判定为不满足");
  });

  it("supplies the job, candidate, criteria, and rule evidence to the model", () => {
    // Break caught: dropping an input section makes evidence-grounded comparison impossible.
    const { user } = buildAnalysisPrompt(input);

    expect(user).toContain("甲公司");
    expect(user).toContain("四年企业软件产品经验");
    expect(user).toContain("五年产品经验");
    expect(user).toContain("候选人仅明确提供四年经验");
  });
});
