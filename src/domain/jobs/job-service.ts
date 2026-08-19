import { jobSchema, type Job } from "../../shared/contracts/job";
import type { ModelRecruitmentProfile } from "../../shared/contracts/recruitment-profile";
import type { JobRepository } from "./job-repository";
import { confirmRecruitmentProfile } from "./recruitment-profile";

export interface CreateJobInput {
  company: string;
  jd: string;
  customRequirements: string;
}

export class JobService {
  constructor(
    private readonly repository: JobRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async createAndActivate(input: CreateJobInput): Promise<Job> {
    const timestamp = this.now();
    const job = jobSchema.parse({
      id: crypto.randomUUID(),
      company: input.company.trim(),
      jd: input.jd.trim(),
      customRequirements: input.customRequirements.trim(),
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await this.repository.saveAndActivate(job);
    return job;
  }

  async confirmAndActivateProfile(
    jobId: string,
    profile: ModelRecruitmentProfile
  ): Promise<Job> {
    const job = (await this.repository.list()).find(({ id }) => id === jobId);
    if (!job) throw new Error("岗位不存在");

    const timestamp = this.now();
    const updatedJob = jobSchema.parse({
      ...job,
      recruitmentProfile: confirmRecruitmentProfile(profile, timestamp),
      updatedAt: timestamp
    });
    await this.repository.saveAndActivate(updatedJob);
    return updatedJob;
  }
}
