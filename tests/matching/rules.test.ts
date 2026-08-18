import { describe, expect, it } from "vitest";
import { evaluateObjectiveRules } from "../../src/domain/matching/rules";
import { extractObjectiveFacts, type ObjectiveFacts } from "../../src/domain/matching/facts";
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

  it("keeps explicit years of experience unknown even when a sufficient fact was extracted", () => {
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
    const [belowThreshold] = evaluateObjectiveRules(
      [criterion("必须有 5 年以上经验")],
      {
        tokens: new Set(),
        yearsExperience: 3,
        yearsExperienceEvidence: "工作经历：工作经验：3 年"
      }
    );

    expect(met).toEqual({
      criterionId: "c1",
      status: "unknown",
      evidence: ["工作经历：工作经验：8 年"]
    });
    expect(belowThreshold).toEqual({
      criterionId: "c1",
      status: "unknown",
      evidence: ["工作经历：工作经验：3 年"]
    });
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

  it("keeps an explicit certificate unknown even when a possession fact was extracted", () => {
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
      status: "unknown",
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

  it("retains labeled candidate years and possession facts without using them as deterministic gates", () => {
    // Break caught: the Stage C safety breaker must preserve model/recruiter evidence while
    // preventing ambiguous years and credentials from satisfying hard rules locally.
    const facts = extractObjectiveFacts(draftWith({
      workExperience: "工作经验：8 年；负责企业软件产品",
      skills: "证书：PMP；持有法律职业资格"
    }));

    expect(facts.yearsExperienceEvidence).toBe("工作经历：工作经验：8 年");
    expect(facts.tokenEvidence?.get("pmp")).toEqual(["技能：证书：PMP"]);
    expect(evaluateObjectiveRules([
      criterion("必须有 5 年以上经验"),
      { ...criterion("必须持有 PMP"), id: "c2" }
    ], facts)).toEqual([
      { criterionId: "c1", status: "unknown", evidence: ["工作经历：工作经验：8 年"] },
      { criterionId: "c2", status: "unknown", evidence: ["技能：证书：PMP"] }
    ]);
  });

  it.each([
    "不到 5 年工作经验",
    "不足 5 年工作经验",
    "不满 5 年工作经验",
    "拥有 3–5 年工作经验",
    "工作经验：3 至 5 年",
    "最多 5 年工作经验",
    "最多有 5 年工作经验",
    "最多拥有 5 年工作经验",
    "至多具备 5 年工作经验",
    "不超过累计 5 年工作经验",
    "少于拥有 5 年工作经验",
    "低于具备 5 年工作经验",
    "未满累计 5 年工作经验",
    "5 年以下工作经验"
  ])("keeps non-lower-bound experience evidence unknown: %s", (source) => {
    // Break caught: extracting the largest number from a negated, upper-bound, or ranged
    // statement could incorrectly satisfy an at-least-five-years hard requirement.
    const facts = extractObjectiveFacts(draftWith({ workExperience: source }));
    const [result] = evaluateObjectiveRules(
      [criterion("必须有 5 年以上经验")],
      facts
    );

    expect(facts.yearsExperience).toBeUndefined();
    expect(facts.yearsExperienceEvidence).toBeUndefined();
    expect(facts.sourceEvidence?.yearsExperience).toEqual([`工作经历：${source}`]);
    expect(result).toEqual({
      criterionId: "c1",
      status: "unknown",
      evidence: [`工作经历：${source}`]
    });
  });

  it("keeps a clear exact candidate-owned experience fact and its complete clause", () => {
    // Break caught: classifying qualified bounds conservatively must not discard an
    // unqualified exact amount that is sufficient for the hard requirement.
    const facts = extractObjectiveFacts(draftWith({
      workExperience: "拥有 5 年工作经验"
    }));
    const [result] = evaluateObjectiveRules(
      [criterion("必须有 5 年以上经验")],
      facts
    );

    expect(facts.yearsExperience).toBe(5);
    expect(facts.yearsExperienceEvidence).toBe("工作经历：拥有 5 年工作经验");
    expect(result).toEqual({
      criterionId: "c1",
      status: "unknown",
      evidence: ["工作经历：拥有 5 年工作经验"]
    });
  });

  it.each([
    "未通过 PMP",
    "不具备 PMP 证书",
    "PMP 尚未通过",
    "未持有 PMP",
    "没有 PMP 证书",
    "未取得 PMP",
    "计划考取 PMP",
    "准备考 PMP",
    "打算考取 PMP",
    "拟考取 PMP",
    "待通过 PMP",
    "已过期 PMP",
    "PMP 已过期",
    "PMP 认证已经失效",
    "PMP 证书已经作废"
  ])("keeps negated, planned, or expired credential evidence unknown: %s", (source) => {
    // Break caught: a token mention in the skills section must not become proof of
    // current candidate-owned possession when the same clause denies or defers it.
    const facts = extractObjectiveFacts(draftWith({ skills: source }));
    const [result] = evaluateObjectiveRules([criterion("必须持有 PMP")], facts);

    expect(facts.tokens.has("pmp")).toBe(false);
    expect(facts.tokenEvidence?.get("pmp")).toBeUndefined();
    expect(facts.sourceEvidence?.certificates.get("pmp")).toEqual([`技能：${source}`]);
    expect(result).toEqual({
      criterionId: "c1",
      status: "unknown",
      evidence: [`技能：${source}`]
    });
  });

  it.each([
    "已持有 PMP",
    "已通过 PMP"
  ])("retains a clear current credential fact but keeps the hard rule unknown: %s", (source) => {
    // Break caught: explicit possession remains provider/recruiter evidence, but credentials
    // cannot satisfy a deterministic hard rule in Stage C.
    const facts = extractObjectiveFacts(draftWith({ skills: source }));
    const [result] = evaluateObjectiveRules([criterion("必须持有 PMP")], facts);

    expect(facts.tokens.has("pmp")).toBe(true);
    expect(facts.tokenEvidence?.get("pmp")).toEqual([`技能：${source}`]);
    expect(result).toEqual({
      criterionId: "c1",
      status: "unknown",
      evidence: [`技能：${source}`]
    });
  });

  it("retains the complete source fragment for clear positive experience and credential evidence", () => {
    // Break caught: truncating evidence to the matched number/token removes surrounding
    // ownership and validity wording recruiters need to audit a deterministic decision.
    const facts = extractObjectiveFacts(draftWith({
      workExperience: "本人拥有 8 年以上工作经验，专注企业软件产品",
      skills: "本人已通过 PMP 认证，证书当前有效"
    }));

    expect(facts.yearsExperience).toBe(8);
    expect(facts.yearsExperienceEvidence).toBe("工作经历：本人拥有 8 年以上工作经验，专注企业软件产品");
    expect(facts.tokens.has("pmp")).toBe(true);
    expect(facts.tokenEvidence?.get("pmp")).toEqual(["技能：本人已通过 PMP 认证，证书当前有效"]);
    expect(evaluateObjectiveRules([
      criterion("必须有 5 年以上经验"),
      { ...criterion("必须持有 PMP"), id: "c2" }
    ], facts)).toEqual([
      {
        criterionId: "c1",
        status: "unknown",
        evidence: ["工作经历：本人拥有 8 年以上工作经验，专注企业软件产品"]
      },
      {
        criterionId: "c2",
        status: "unknown",
        evidence: ["技能：本人已通过 PMP 认证，证书当前有效"]
      }
    ]);
  });

  it.each([
    "拥有 5 年工作经验",
    "明确 8 年工作经验",
    "不到 5 年工作经验",
    "不足 5 年工作经验",
    "不满 5 年工作经验",
    "拥有 3–5 年工作经验",
    "工作经验：3 至 5 年",
    "最多 5 年工作经验",
    "最多有 5 年工作经验",
    "最多拥有 5 年工作经验",
    "至多具备 5 年工作经验",
    "不超过累计 5 年工作经验",
    "少于拥有 5 年工作经验",
    "低于具备 5 年工作经验",
    "未满累计 5 年工作经验",
    "5 年以下工作经验"
  ])("always keeps years_experience hard-rule evaluation unknown: %s", (source) => {
    const facts = extractObjectiveFacts(draftWith({ workExperience: source }));

    expect(evaluateObjectiveRules(
      [criterion("必须有 5 年以上经验")],
      facts
    )).toEqual([{
      criterionId: "c1",
      status: "unknown",
      evidence: [`工作经历：${source}`]
    }]);
  });

  it.each([
    "已持有 PMP",
    "已通过 PMP",
    "未通过 PMP",
    "不具备 PMP 证书",
    "PMP 尚未通过",
    "未持有 PMP",
    "没有 PMP 证书",
    "未取得 PMP",
    "计划考取 PMP",
    "准备考 PMP",
    "打算考取 PMP",
    "拟考取 PMP",
    "待通过 PMP",
    "已过期 PMP",
    "PMP 已过期",
    "PMP 认证已经失效",
    "PMP 证书已经作废"
  ])("always keeps certificate hard-rule evaluation unknown: %s", (source) => {
    const facts = extractObjectiveFacts(draftWith({ skills: source }));

    expect(evaluateObjectiveRules(
      [criterion("必须持有 PMP")],
      facts
    )).toEqual([{
      criterionId: "c1",
      status: "unknown",
      evidence: [`技能：${source}`]
    }]);
  });

  it("keeps contradictory location source evidence visible without inferring availability", () => {
    const facts = extractObjectiveFacts(draftWith({ basics: "现居地：北京" }));
    const [result] = evaluateObjectiveRules([criterion("工作地点：上海")], facts);

    expect(facts.sourceEvidence.locations).toEqual(["基本信息：现居地：北京"]);
    expect(result).toEqual({
      criterionId: "c1",
      status: "unknown",
      evidence: ["基本信息：现居地：北京"]
    });
  });

  it.each([
    {
      label: "years fact above threshold",
      text: "必须有 5 年以上经验",
      facts: {
        tokens: new Set<string>(),
        yearsExperience: 8,
        sourceEvidence: {
          yearsExperience: ["工作经历：工作年限待猎头核实"],
          certificates: new Map<string, string[]>(),
          locations: []
        }
      }
    },
    {
      label: "years fact below threshold",
      text: "必须有 5 年以上经验",
      facts: {
        tokens: new Set<string>(),
        yearsExperience: 3,
        sourceEvidence: {
          yearsExperience: ["工作经历：工作年限待猎头核实"],
          certificates: new Map<string, string[]>(),
          locations: []
        }
      }
    },
    {
      label: "certificate token present",
      text: "必须持有 PMP",
      facts: {
        tokens: new Set(["pmp"]),
        sourceEvidence: {
          yearsExperience: [],
          certificates: new Map([["pmp", ["技能：PMP 状态待猎头核实"]]]),
          locations: []
        }
      }
    },
    {
      label: "certificate token absent",
      text: "必须持有 PMP",
      facts: {
        tokens: new Set<string>(),
        sourceEvidence: {
          yearsExperience: [],
          certificates: new Map([["pmp", ["技能：PMP 状态待猎头核实"]]]),
          locations: []
        }
      }
    },
    {
      label: "location fact matches",
      text: "工作地点：上海",
      facts: {
        tokens: new Set<string>(),
        locations: new Set(["上海"]),
        sourceEvidence: {
          yearsExperience: [],
          certificates: new Map<string, string[]>(),
          locations: ["基本信息：现居地待猎头核实"]
        }
      }
    },
    {
      label: "location fact contradicts",
      text: "工作地点：上海",
      facts: {
        tokens: new Set<string>(),
        locations: new Set(["北京"]),
        sourceEvidence: {
          yearsExperience: [],
          certificates: new Map<string, string[]>(),
          locations: ["基本信息：现居地待猎头核实"]
        }
      }
    }
  ] satisfies ReadonlyArray<{ label: string; text: string; facts: ObjectiveFacts }>)(
    "keeps $label unknown with the same recruiter evidence",
    ({ text, facts }) => {
      const [result] = evaluateObjectiveRules([criterion(text)], facts);
      const expectedEvidence = text.includes("PMP")
        ? facts.sourceEvidence?.certificates.get("pmp")
        : text.includes("地点")
          ? facts.sourceEvidence?.locations
          : facts.sourceEvidence?.yearsExperience;

      expect(result?.status).toBe("unknown");
      expect(result?.evidence).toEqual(expectedEvidence);
    }
  );

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
