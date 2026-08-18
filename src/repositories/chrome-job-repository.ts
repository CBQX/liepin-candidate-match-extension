import type { JobRepository } from "../domain/jobs/job-repository";
import { jobSchema, type Job } from "../shared/contracts/job";
import type { StorageAreaLike } from "./storage-area";

const JOBS_KEY = "jobs";
const ACTIVE_JOB_ID_KEY = "activeJobId";

export class ChromeJobRepository implements JobRepository {
  constructor(private readonly storage: StorageAreaLike) {}

  async list(): Promise<Job[]> {
    const { [JOBS_KEY]: storedJobs } = await this.storage.get(JOBS_KEY);
    if (!Array.isArray(storedJobs)) return [];

    return storedJobs.flatMap((job) => {
      const parsed = jobSchema.safeParse(job);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async getActive(): Promise<Job | undefined> {
    const { [ACTIVE_JOB_ID_KEY]: activeJobId } = await this.storage.get(ACTIVE_JOB_ID_KEY);
    if (typeof activeJobId !== "string") return undefined;

    return (await this.list()).find((job) => job.id === activeJobId);
  }

  async saveAndActivate(job: Job): Promise<void> {
    const jobs = await this.list();
    const updatedJobs = [...jobs.filter((savedJob) => savedJob.id !== job.id), job];
    await this.storage.set({ [JOBS_KEY]: updatedJobs, [ACTIVE_JOB_ID_KEY]: job.id });
  }

  async activate(id: string): Promise<void> {
    if ((await this.list()).some((job) => job.id === id)) {
      await this.storage.set({ [ACTIVE_JOB_ID_KEY]: id });
    }
  }
}
