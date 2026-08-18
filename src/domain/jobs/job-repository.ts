import type { Job } from "../../shared/contracts/job";

export interface JobRepository {
  list(): Promise<Job[]>;
  getActive(): Promise<Job | undefined>;
  saveAndActivate(job: Job): Promise<void>;
  activate(id: string): Promise<void>;
}
