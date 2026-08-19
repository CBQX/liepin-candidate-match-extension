import { describe, expect, it, vi } from "vitest";
import { generateJobProfile } from "../../src/background/generate-job-profile";
import { NormalizedProviderError, type ModelProvider } from "../../src/providers/model-provider";
import type { Job } from "../../src/shared/contracts/job";
import type { ModelRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

const job: Job = {
  id: "synthetic-job-1",
  company: "虚构甲公司",
  jd: "负责虚构企业软件产品",
  customRequirements: "企业软件经验优先",
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z"
};

const profile: ModelRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品",
  requirements: [{
    id: "requirement-1",
    text: "具备企业软件产品经验",
    priority: "hard",
    dimensionId: "functional_expertise",
    weight: 1,
    jobEvidence: ["负责虚构企业软件产品"]
  }],
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: []
};

const settings = { providerId: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-test" };

function provider(generateRecruitmentProfile: NonNullable<ModelProvider["generateRecruitmentProfile"]>): ModelProvider {
  return {
    id: "deepseek",
    models: [{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }],
    validateCredentials: vi.fn(),
    generateRecruitmentProfile,
    analyze: vi.fn()
  };
}

describe("generateJobProfile", () => {
  it("sends only the three raw job inputs and validates the profile", async () => {
    const generate = vi.fn().mockResolvedValue(profile);

    await expect(generateJobProfile({ job }, {
      provider: provider(generate),
      settings
    })).resolves.toEqual(profile);

    expect(generate).toHaveBeenCalledWith({
      company: job.company,
      jd: job.jd,
      customRequirements: job.customRequirements
    }, settings, undefined);
  });

  it("rejects before contacting the provider when the signal is already cancelled", async () => {
    const generate = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(generateJobProfile({ job }, {
      provider: provider(generate),
      settings,
      signal: controller.signal
    })).rejects.toEqual(new NormalizedProviderError("ANALYSIS_CANCELLED"));

    expect(generate).not.toHaveBeenCalled();
  });

  it("maps a schema-invalid provider result to INVALID_MODEL_OUTPUT", async () => {
    await expect(generateJobProfile({ job }, {
      provider: provider(vi.fn().mockResolvedValue({ roleTitle: "不完整" })),
      settings
    })).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
  });
});
