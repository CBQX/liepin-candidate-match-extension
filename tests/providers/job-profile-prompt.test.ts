import { describe, expect, it } from "vitest";
import { buildJobProfilePrompt } from "../../src/providers/deepseek/job-profile-prompt";

const input = {
  company: "虚构甲公司",
  jd: "负责虚构企业软件产品规划与交付，企业软件经验优先",
  customRequirements: "需要能够与跨职能团队协作"
};

describe("buildJobProfilePrompt", () => {
  it("requires the complete bounded JSON profile contract", () => {
    const { system, user } = buildJobProfilePrompt(input);

    for (const field of [
      "version", "roleTitle", "roleObjective", "requirements", "id", "text",
      "priority", "dimensionId", "weight", "jobEvidence", "acceptableAlternatives",
      "ambiguities", "verificationQuestions"
    ]) {
      expect(system).toContain(field);
    }
    expect(system).toMatch(/1.*20.*招聘要求/s);
    expect(system).toMatch(/年龄.*性别.*民族.*婚育.*不得/s);
    expect(system).toContain("不得创造输入中没有依据的隐藏要求");
    expect(user).toContain(input.company);
    expect(user).toContain(input.jd);
    expect(user).toContain(input.customRequirements);
  });
});
