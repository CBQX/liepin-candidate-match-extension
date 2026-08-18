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
