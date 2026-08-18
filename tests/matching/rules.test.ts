import { describe, expect, it } from "vitest";
import { evaluateObjectiveRules } from "../../src/domain/matching/rules";
import { extractObjectiveFacts } from "../../src/domain/matching/facts";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { JobCriterion } from "../../src/shared/contracts/matching";

const criterion = (text: string): JobCriterion => ({
  id: "c1",
  text,
  priority: "hard",
  source: "custom"
});

const draftWith = (overrides: Partial<Record<keyof Omit<CandidateDraft, "extractionConfidence">, string>>): CandidateDraft => ({
  basics: { text: overrides.basics ?? "候选人，上海", status: "complete" },
  workExperience: { text: overrides.workExperience ?? "", status: overrides.workExperience ? "complete" : "missing" },
  projects: { text: overrides.projects ?? "", status: overrides.projects ? "complete" : "missing" },
  education: { text: overrides.education ?? "", status: overrides.education ? "complete" : "missing" },
  skills: { text: overrides.skills ?? "", status: overrides.skills ? "complete" : "missing" },
  other: { text: overrides.other ?? "", status: overrides.other ? "complete" : "missing" },
  extractionConfidence: "high"
});

describe("evaluateObjectiveRules", () => {
  it("returns unknown instead of mismatch when education is absent", () => {
    const result = evaluateObjectiveRules(
      [criterion("必须本科")],
      { tokens: new Set(), educationLevel: undefined }
    );

    expect(result[0]?.status).toBe("unknown");
  });

  it("compares explicit education evidence by level", () => {
    const [met] = evaluateObjectiveRules(
      [criterion("本科及以上")],
      { tokens: new Set(), educationLevel: "master" }
    );
    const [notMet] = evaluateObjectiveRules(
      [criterion("必须本科")],
      { tokens: new Set(), educationLevel: "associate" }
    );

    expect(met).toEqual({ criterionId: "c1", status: "met", evidence: ["明确学历：硕士"] });
    expect(notMet).toEqual({ criterionId: "c1", status: "not_met", evidence: ["明确学历：大专"] });
  });

  it("compares explicit years of experience without treating absence as failure", () => {
    const [met] = evaluateObjectiveRules(
      [criterion("必须有 5 年以上经验")],
      {
        tokens: new Set(),
        yearsExperience: 8,
        yearsExperienceEvidence: "工作经历：工作经验：8 年"
      }
    );
    const [unknown] = evaluateObjectiveRules(
      [criterion("必须有 5 年以上经验")],
      { tokens: new Set() }
    );

    expect(met).toEqual({ criterionId: "c1", status: "met", evidence: ["工作经历：工作经验：8 年"] });
    expect(unknown?.status).toBe("unknown");
  });

  it("does not treat generic experience years as B2B product experience", () => {
    const [result] = evaluateObjectiveRules(
      [criterion("必须有 5 年以上 B2B 产品经验")],
      { tokens: new Set(), yearsExperience: 8 }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it("does not satisfy a compound criterion when one clause is unsupported", () => {
    const [result] = evaluateObjectiveRules(
      [criterion("必须本科且有海外经验")],
      { tokens: new Set(), educationLevel: "bachelor" }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it("keeps an explicit location unknown even when the visible location matches exactly", () => {
    // Break caught: fragile location grammar could turn a visible current location into a deterministic job-location match.
    const [result] = evaluateObjectiveRules(
      [criterion("工作地点：上海")],
      { tokens: new Set(), locations: new Set(["上海"]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it("matches an explicit certificate token", () => {
    const [result] = evaluateObjectiveRules(
      [criterion("必须持有 PMP")],
      {
        tokens: new Set(["pmp"]),
        tokenEvidence: new Map([["pmp", ["技能：持有 PMP 证书"]]]),
        locations: new Set(["上海"])
      }
    );

    expect(result).toEqual({
      criterionId: "c1",
      status: "met",
      evidence: ["技能：持有 PMP 证书"]
    });
  });

  it("does not treat customer years or a training-project certificate mention as candidate possession", () => {
    // Break caught: aggregating every resume token can turn customer tenure and training topics into candidate credentials.
    const facts = extractObjectiveFacts(draftWith({
      workExperience: "服务某客户，累计 8 年工作经验，持续提供招聘支持",
      projects: "为客户开展 PMP 认证培训项目，项目周期 5 年"
    }));

    expect(evaluateObjectiveRules([
      criterion("必须有 5 年以上经验"),
      { ...criterion("必须持有 PMP"), id: "c2" }
    ], facts)).toEqual([
      { criterionId: "c1", status: "unknown", evidence: [] },
      { criterionId: "c2", status: "unknown", evidence: [] }
    ]);
  });

  it("uses labeled candidate years and possession language as auditable evidence", () => {
    // Break caught: making rules conservative must not discard explicit candidate-owned facts.
    const facts = extractObjectiveFacts(draftWith({
      workExperience: "工作经验：8 年；负责企业软件产品",
      skills: "证书：PMP；持有法律职业资格"
    }));

    expect(evaluateObjectiveRules([
      criterion("必须有 5 年以上经验"),
      { ...criterion("必须持有 PMP"), id: "c2" }
    ], facts)).toEqual([
      { criterionId: "c1", status: "met", evidence: ["工作经历：工作经验：8 年"] },
      { criterionId: "c2", status: "met", evidence: ["技能：证书：PMP"] }
    ]);
  });

  it.each(["和田", "共和"])("keeps the explicit %s location unknown without misparsing its characters", (location) => {
    const [result] = evaluateObjectiveRules(
      [criterion(`工作地点：${location}`)],
      { tokens: new Set(), locations: new Set([location]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it.each([
    "天津市和平区",
    "新疆且末县",
    "新疆维吾尔自治区和田地区",
    "内蒙古自治区呼和浩特市"
  ])("keeps the explicit %s administrative location unknown", (location) => {
    const [result] = evaluateObjectiveRules(
      [criterion(`工作地点：${location}`)],
      { tokens: new Set(), locations: new Set([location]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it.each([
    "Singapore",
    "HongKong"
  ])("keeps an explicit Latin location atom unknown: %s", (location) => {
    const [result] = evaluateObjectiveRules(
      [criterion(`Location: ${location}`)],
      { tokens: new Set(), locations: new Set([location]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it("keeps compound location and availability wording unknown", () => {
    const [result] = evaluateObjectiveRules(
      [criterion("工作地点：上海且接受出差")],
      { tokens: new Set(), locations: new Set(["上海且接受出差"]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it.each([
    "工作地点：上海且能接受出差",
    "工作地点：上海并接受出差",
    "工作地点：上海且须接受出差",
    "工作地点：上海和北京",
    "工作地点：上海、北京",
    "工作地点：上海及北京"
  ])("keeps additional location or mobility clause unknown: %s", (text) => {
    const locationValue = text.slice("工作地点：".length);
    const [result] = evaluateObjectiveRules(
      [criterion(text)],
      { tokens: new Set(), locations: new Set([locationValue]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it.each([
    "Location: Singapore and HongKong",
    "Location: Singapore/HongKong",
    "Location: Singapore, HongKong"
  ])("keeps compound Latin locations unknown: %s", (text) => {
    const locationValue = text.slice("Location: ".length);
    const [result] = evaluateObjectiveRules(
      [criterion(text)],
      { tokens: new Set(), locations: new Set([locationValue]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it("does not infer availability from a different visible current location", () => {
    const [result] = evaluateObjectiveRules(
      [criterion("工作地点：上海")],
      { tokens: new Set(), locations: new Set(["北京"]) }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });

  it("returns unknown for unsupported subjective criteria", () => {
    const [result] = evaluateObjectiveRules(
      [criterion("沟通能力强且有创业精神")],
      {
        tokens: new Set(["沟通能力强"]),
        educationLevel: "doctorate",
        yearsExperience: 12,
        locations: new Set(["上海"])
      }
    );

    expect(result).toEqual({ criterionId: "c1", status: "unknown", evidence: [] });
  });
});
