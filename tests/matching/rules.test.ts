import { describe, expect, it } from "vitest";
import { evaluateObjectiveRules } from "../../src/domain/matching/rules";
import type { JobCriterion } from "../../src/shared/contracts/matching";

const criterion = (text: string): JobCriterion => ({
  id: "c1",
  text,
  priority: "hard",
  source: "custom"
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
      { tokens: new Set(), yearsExperience: 8 }
    );
    const [unknown] = evaluateObjectiveRules(
      [criterion("必须有 5 年以上经验")],
      { tokens: new Set() }
    );

    expect(met).toEqual({ criterionId: "c1", status: "met", evidence: ["明确工作经验：8 年"] });
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

  it("matches explicit location and certificate tokens", () => {
    const results = evaluateObjectiveRules(
      [criterion("工作地点：上海"), { ...criterion("必须持有 PMP"), id: "c2" }],
      { tokens: new Set(["pmp"]), locations: new Set(["上海"]) }
    );

    expect(results).toEqual([
      { criterionId: "c1", status: "met", evidence: ["明确地点：上海"] },
      { criterionId: "c2", status: "met", evidence: ["明确证书：PMP"] }
    ]);
  });

  it.each(["和田", "共和"])("matches an explicit %s location without treating its characters as conjunctions", (location) => {
    const [result] = evaluateObjectiveRules(
      [criterion(`工作地点：${location}`)],
      { tokens: new Set(), locations: new Set([location]) }
    );

    expect(result).toEqual({
      criterionId: "c1",
      status: "met",
      evidence: [`明确地点：${location}`]
    });
  });

  it.each([
    "天津市和平区",
    "新疆且末县",
    "新疆维吾尔自治区和田地区"
  ])("matches an explicit %s administrative location without treating name characters as conjunctions", (location) => {
    const [result] = evaluateObjectiveRules(
      [criterion(`工作地点：${location}`)],
      { tokens: new Set(), locations: new Set([location]) }
    );

    expect(result).toEqual({
      criterionId: "c1",
      status: "met",
      evidence: [`明确地点：${location}`]
    });
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
