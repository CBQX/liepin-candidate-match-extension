import { jobSchema, type Job } from "../../shared/contracts/job";
import type { JobRepository } from "./job-repository";

export interface CreateJobInput {
  company: string;
  jd: string;
  customRequirements: string;
}

export class JobService {
  constructor(private readonly repository: JobRepository) {}

  async createAndActivate(input: CreateJobInput): Promise<Job> {
    const timestamp = new Date().toISOString();
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
}
