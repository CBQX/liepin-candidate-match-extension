import { describe, expect, it } from "vitest";
import { buildAnalysisPrompt } from "../../src/providers/deepseek/prompt";
import type { CandidateMatchInput } from "../../src/providers/model-provider";
import type { ConfirmedRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

const recruitmentProfile: ConfirmedRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责企业软件产品交付",
  requirements: [{
    id: "criterion-1",
    text: "五年产品经验",
    priority: "hard",
    dimensionId: "functional_expertise",
    weight: 100,
    jobEvidence: ["岗位要求五年产品经验"]
  }],
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: [],
  confirmedAt: "2026-08-19T00:00:00.000Z"
};

const input: CandidateMatchInput = {
  recruitmentProfile,
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
    source: "profile"
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

  it("supplies the confirmed profile, candidate, criteria, and rule evidence to the model", () => {
    // Break caught: dropping an input section makes evidence-grounded comparison impossible.
    const { user } = buildAnalysisPrompt(input);

    expect(user).toContain("企业软件产品经理");
    expect(user).toContain("四年企业软件产品经验");
    expect(user).toContain("五年产品经验");
    expect(user).toContain("候选人仅明确提供四年经验");
  });

  it("does not contain raw job fields that are outside the confirmed profile", () => {
    const { user } = buildAnalysisPrompt(input);

    expect(user).not.toContain("原始超长 JD 唯一标记");
    expect(user).not.toContain("原始个性化要求唯一标记");
    expect(user).not.toContain('"jd"');
    expect(user).not.toContain('"customRequirements"');
  });
});
