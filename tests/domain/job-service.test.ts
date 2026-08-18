import { describe, expect, it, vi } from "vitest";
import { JobService } from "../../src/domain/jobs/job-service";
import type { JobRepository } from "../../src/domain/jobs/job-repository";
import type { Job } from "../../src/shared/contracts/job";

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
});
