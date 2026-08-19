import { describe, expect, it } from "vitest";
import {
  confirmRecruitmentProfile,
  normalizeRecruitmentProfileWeights
} from "../../src/domain/jobs/recruitment-profile";
import {
  confirmedRecruitmentProfileSchema,
  modelRecruitmentProfileSchema,
  type ModelRecruitmentProfile
} from "../../src/shared/contracts/recruitment-profile";

const profile: ModelRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件的产品规划与交付",
  requirements: [
    {
      id: "requirement-1",
      text: "具备企业软件产品经验",
      priority: "hard",
      dimensionId: "functional_expertise",
      weight: 3,
      jobEvidence: ["负责企业软件产品"]
    },
    {
      id: "requirement-2",
      text: "理解订阅业务",
      priority: "preferred",
      dimensionId: "industry_business",
      weight: 1,
      jobEvidence: ["订阅业务经验优先"]
    }
  ],
  acceptableAlternatives: ["复杂 B2B 平台经验"],
  ambiguities: ["团队规模未说明"],
  verificationQuestions: ["请确认团队规模"]
};

describe("recruitment profile contracts", () => {
  it("normalizes requirement weights to an exact integer total of 100", () => {
    const normalized = normalizeRecruitmentProfileWeights(profile);

    expect(normalized.requirements.map(({ weight }) => weight)).toEqual([75, 25]);
    expect(normalized.requirements.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
    expect(profile.requirements.map(({ weight }) => weight)).toEqual([3, 1]);
  });

  it("uses a stable largest-remainder allocation for fractional ties", () => {
    const normalized = normalizeRecruitmentProfileWeights({
      ...profile,
      requirements: profile.requirements.concat({
        ...profile.requirements[1],
        id: "requirement-3",
        weight: 1
      })
    });

    expect(normalized.requirements.map(({ weight }) => weight)).toEqual([60, 20, 20]);
  });

  it("rejects an all-zero weight vector", () => {
    expect(() => normalizeRecruitmentProfileWeights({
      ...profile,
      requirements: profile.requirements.map((requirement) => ({ ...requirement, weight: 0 }))
    })).toThrow("岗位画像权重总和必须大于 0");
  });

  it.each(["只招男性", "年龄不超过 35 岁", "已婚已育优先", "限汉族"])(
    "rejects protected recruitment criterion %s",
    (text) => {
      expect(modelRecruitmentProfileSchema.safeParse({
        ...profile,
        requirements: [{ ...profile.requirements[0], text }]
      }).success).toBe(false);
    }
  );

  it("confirms a normalized profile with a trusted timestamp", () => {
    const confirmed = confirmRecruitmentProfile(profile, "2026-08-19T01:00:00.000Z");

    expect(confirmed.confirmedAt).toBe("2026-08-19T01:00:00.000Z");
    expect(confirmed.requirements.map(({ weight }) => weight)).toEqual([75, 25]);
    expect(confirmedRecruitmentProfileSchema.parse(confirmed)).toEqual(confirmed);
  });
});
