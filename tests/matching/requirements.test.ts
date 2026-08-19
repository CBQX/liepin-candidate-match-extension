import { describe, expect, it } from "vitest";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { Job } from "../../src/shared/contracts/job";
import { extractObjectiveFacts } from "../../src/domain/matching/facts";
import {
  criteriaFromRecruitmentProfile,
  parseJobCriteria
} from "../../src/domain/matching/requirements";
import type { ConfirmedRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

const job: Job = {
  id: "job-1",
  company: "甲公司",
  jd: "有企业软件经验",
  customRequirements: "必须有 5 年以上 B2B 产品经验",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const section = (text: string, status: "complete" | "possibly_incomplete" | "missing" = "complete") => ({
  text,
  status
});

const draft = (overrides: Partial<CandidateDraft> = {}): CandidateDraft => ({
  basics: section(""),
  workExperience: section(""),
  projects: section(""),
  education: section(""),
  skills: section(""),
  other: section(""),
  extractionConfidence: "high",
  ...overrides
});

describe("parseJobCriteria", () => {
  it("uses confirmed profile requirement ids and priorities as the scoring criteria", () => {
    const profile: ConfirmedRecruitmentProfile = {
      version: 1,
      roleTitle: "虚构产品经理",
      roleObjective: "负责虚构企业软件",
      requirements: [{
        id: "confirmed-requirement",
        text: "具备企业软件经验",
        priority: "hard",
        dimensionId: "functional_expertise",
        weight: 100,
        jobEvidence: ["岗位要求企业软件经验"]
      }],
      acceptableAlternatives: [],
      ambiguities: [],
      verificationQuestions: [],
      confirmedAt: "2026-08-19T00:00:00.000Z"
    };

    expect(criteriaFromRecruitmentProfile(profile)).toEqual([{
      id: "confirmed-requirement",
      text: "具备企业软件经验",
      priority: "hard",
      source: "profile"
    }]);
  });

  it("treats explicit custom must-have language as hard and higher priority", () => {
    const criteria = parseJobCriteria({
      ...job,
      jd: "本科优先\n有企业软件经验",
      customRequirements: "必须有 5 年以上 B2B 产品经验"
    });

    expect(criteria[0]).toMatchObject({
      priority: "hard",
      source: "custom",
      text: "必须有 5 年以上 B2B 产品经验"
    });
  });

  it("splits non-empty lines and Chinese sentence delimiters in source order", () => {
    const criteria = parseJobCriteria({
      ...job,
      customRequirements: "  PMP 优选；\n不可接受异地办公。  ",
      jd: "本科优先！\n\n企业软件经验"
    });

    expect(criteria).toEqual([
      { id: "custom-1", text: "PMP 优选", priority: "preferred", source: "custom" },
      { id: "custom-2", text: "不可接受异地办公", priority: "hard", source: "custom" },
      { id: "jd-1", text: "本科优先", priority: "preferred", source: "jd" },
      { id: "jd-2", text: "企业软件经验", priority: "standard", source: "jd" }
    ]);
  });
});

describe("extractObjectiveFacts", () => {
  it("extracts only explicit education, experience, location, and certificate evidence", () => {
    const facts = extractObjectiveFacts(draft({
      basics: section("现居地：上海\n年龄：32\n期望薪资：50k"),
      workExperience: section("8 年工作经验"),
      education: section("复旦大学 本科"),
      skills: section("CET-6、PMP")
    }));

    expect(facts.educationLevel).toBe("bachelor");
    expect(facts.yearsExperience).toBe(8);
    expect([...facts.locations]).toEqual(["上海"]);
    expect([...facts.tokens]).toEqual(expect.arrayContaining(["cet-6", "pmp"]));
    expect([...facts.tokens]).not.toEqual(expect.arrayContaining(["32", "50k"]));
  });

  it("does not invent objective facts from protected or speculative profile text", () => {
    const facts = extractObjectiveFacts(draft({
      basics: section("女性，32岁"),
      other: section("薪资可谈，可能随时到岗，应该愿意去上海")
    }));

    expect(facts).toMatchObject({
      educationLevel: undefined,
      yearsExperience: undefined
    });
    expect([...facts.locations]).toEqual([]);
    expect([...facts.tokens]).toEqual([]);
  });

  it("does not mistake education words in work duties for the candidate's degree", () => {
    const facts = extractObjectiveFacts(draft({
      workExperience: section("负责本科生与研究生校园招聘"),
      education: section("", "missing")
    }));

    expect(facts.educationLevel).toBeUndefined();
  });
});
