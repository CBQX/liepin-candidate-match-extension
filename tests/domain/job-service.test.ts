import { describe, expect, it, vi } from "vitest";
import { JobService } from "../../src/domain/jobs/job-service";
import type { JobRepository } from "../../src/domain/jobs/job-repository";
import type { Job } from "../../src/shared/contracts/job";
import type { ModelRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

const modelProfile: ModelRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品",
  requirements: [{
    id: "requirement-1",
    text: "具备企业软件产品经验",
    priority: "hard",
    dimensionId: "functional_expertise",
    weight: 3,
    jobEvidence: ["负责企业软件产品"]
  }, {
    id: "requirement-2",
    text: "理解订阅业务",
    priority: "preferred",
    dimensionId: "industry_business",
    weight: 1,
    jobEvidence: ["订阅业务经验优先"]
  }],
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: []
};

const existingJob: Job = {
  id: "job-1",
  company: "虚构甲公司",
  jd: "负责企业软件产品",
  customRequirements: "订阅业务经验优先",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

describe("JobService", () => {
  it("trims job fields, adds metadata, and saves the created job as active", async () => {
    const savedJobs: Job[] = [];
    const repository: JobRepository = {
      list: async () => [],
      getActive: async () => undefined,
      saveAndActivate: async (job) => { savedJobs.push(job); },
      activate: async () => undefined
    };
    vi.stubGlobal("crypto", { randomUUID: () => "generated-job-id" });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-18T09:00:00.000Z"));

    try {
      const job = await new JobService(repository).createAndActivate({
        company: "  甲公司  ",
        jd: "  负责企业招聘  ",
        customRequirements: "  有 SaaS 经验  "
      });

      expect(job).toEqual({
        id: "generated-job-id",
        company: "甲公司",
        jd: "负责企业招聘",
        customRequirements: "有 SaaS 经验",
        createdAt: "2026-08-18T09:00:00.000Z",
        updatedAt: "2026-08-18T09:00:00.000Z"
      });
      expect(savedJobs).toEqual([job]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("rejects blank job fields before saving", async () => {
    const repository: JobRepository = {
      list: async () => [],
      getActive: async () => undefined,
      saveAndActivate: async () => { throw new Error("should not save"); },
      activate: async () => undefined
    };

    await expect(new JobService(repository).createAndActivate({
      company: "甲公司",
      jd: " ",
      customRequirements: "有 SaaS 经验"
    })).rejects.toThrow();
  });

  it("confirms and atomically replaces a profile on an existing job", async () => {
    const saveAndActivate = vi.fn<JobRepository["saveAndActivate"]>();
    const repository: JobRepository = {
      list: async () => [existingJob],
      getActive: async () => existingJob,
      saveAndActivate,
      activate: async () => undefined
    };
    const service = new JobService(repository, () => "2026-08-19T01:00:00.000Z");

    const confirmed = await service.confirmAndActivateProfile(existingJob.id, modelProfile);

    expect(confirmed.updatedAt).toBe("2026-08-19T01:00:00.000Z");
    expect(confirmed.recruitmentProfile?.confirmedAt).toBe("2026-08-19T01:00:00.000Z");
    expect(confirmed.recruitmentProfile?.requirements.map(({ weight }) => weight))
      .toEqual([75, 25]);
    expect(saveAndActivate).toHaveBeenCalledOnce();
    expect(saveAndActivate).toHaveBeenCalledWith(confirmed);
  });

  it("does not overwrite a job when confirmation validation fails", async () => {
    const saveAndActivate = vi.fn<JobRepository["saveAndActivate"]>();
    const repository: JobRepository = {
      list: async () => [existingJob],
      getActive: async () => existingJob,
      saveAndActivate,
      activate: async () => undefined
    };

    await expect(new JobService(repository).confirmAndActivateProfile(existingJob.id, {
      ...modelProfile,
      requirements: modelProfile.requirements.map((requirement) => ({
        ...requirement,
        weight: 0
      }))
    })).rejects.toThrow("岗位画像权重总和必须大于 0");

    expect(saveAndActivate).not.toHaveBeenCalled();
  });

  it("rejects confirmation for an unknown job id without saving", async () => {
    const saveAndActivate = vi.fn<JobRepository["saveAndActivate"]>();
    const repository: JobRepository = {
      list: async () => [existingJob],
      getActive: async () => existingJob,
      saveAndActivate,
      activate: async () => undefined
    };

    await expect(new JobService(repository).confirmAndActivateProfile("missing-job", modelProfile))
      .rejects.toThrow("岗位不存在");
    expect(saveAndActivate).not.toHaveBeenCalled();
  });
});
