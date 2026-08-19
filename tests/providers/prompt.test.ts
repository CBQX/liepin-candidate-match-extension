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
  }
};

describe("buildAnalysisPrompt", () => {
  it("requires the complete lightweight JSON result contract", () => {
    // Break caught: restoring six dimensions or unbounded sections recreates slow, verbose candidate output.
    const { system } = buildAnalysisPrompt(input);

    for (const field of [
      "overallScore", "recommendation", "contact", "verify_before_contact", "deprioritize",
      "matches", "concerns",
      "claim", "jobEvidence", "candidateEvidence",
      "verificationQuestions", "recruiterConclusion"
    ]) {
      expect(system).toContain(field);
    }
    expect(system).toContain("仅返回一个合法的 JSON 对象");
    expect(system).toMatch(/matches.*2.*5/s);
    expect(system).toMatch(/concerns.*最多.*3/s);
    expect(system).toMatch(/verificationQuestions.*最多.*3/s);
    expect(system).toMatch(/jobEvidence.*candidateEvidence.*最多.*2/s);
    expect(system).toMatch(/理由.*证据.*问题.*300.*结论.*600/s);
    expect(system).not.toContain("dimensionScores");
  });

  it("forbids protected-trait scoring and unsupported factual inference", () => {
    // Break caught: removing either safety rule could turn irrelevant traits or guesses into hiring scores.
    const { system } = buildAnalysisPrompt(input);

    expect(system).toMatch(/年龄.*性别.*民族.*婚育.*不得.*评分/s);
    expect(system).toMatch(/不得.*推测.*候选人事实/s);
  });

  it("requires dual evidence and prevents missing information from deducting score", () => {
    // Break caught: a one-sided or certainty-biased prompt could invent mismatches from missing profile sections.
    const { system } = buildAnalysisPrompt(input);

    expect(system).toMatch(/岗位侧证据.*候选人侧证据/s);
    expect(system).toMatch(/信息缺失.*不得.*扣分/s);
    expect(system).toMatch(/hard.*preferred.*standard.*权重.*一票否决/s);
  });

  it("supplies only the confirmed profile and candidate as compact JSON", () => {
    // Break caught: adding duplicate criteria or pretty-printing increases every candidate request.
    const { user } = buildAnalysisPrompt(input);
    const separator = user.indexOf("\n");
    const payload = JSON.parse(user.slice(separator + 1)) as Record<string, unknown>;

    expect(Object.keys(payload)).toEqual(["recruitmentProfile", "candidateDraft"]);
    expect(user).toContain("企业软件产品经理");
    expect(user).toContain("四年企业软件产品经验");
    expect(user).toContain("五年产品经验");
    expect(user).not.toContain('"criteria"');
    expect(user).not.toContain('"ruleEvaluations"');
    expect(user.split("\n")).toHaveLength(2);
  });

  it("does not contain raw job fields that are outside the confirmed profile", () => {
    const { user } = buildAnalysisPrompt(input);

    expect(user).not.toContain("原始超长 JD 唯一标记");
    expect(user).not.toContain("原始个性化要求唯一标记");
    expect(user).not.toContain('"jd"');
    expect(user).not.toContain('"customRequirements"');
  });
});
