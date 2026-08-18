import { describe, expect, it } from "vitest";
import { ChromeJobRepository } from "../../src/repositories/chrome-job-repository";
import type { StorageAreaLike } from "../../src/repositories/storage-area";
import type { Job } from "../../src/shared/contracts/job";

class MemoryStorageArea implements StorageAreaLike {
  private readonly values: Record<string, unknown> = {};

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === undefined || keys === null) return { ...this.values };

    const requestedKeys = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(
      requestedKeys.flatMap((key) => key in this.values ? [[key, this.values[key]]] : [])
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) delete this.values[key];
  }
}

const jobA: Job = {
  id: "job-a",
  company: "甲公司",
  jd: "负责企业招聘",
  customRequirements: "有 SaaS 经验",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const jobB: Job = {
  ...jobA,
  id: "job-b",
  company: "乙公司"
};

describe("ChromeJobRepository", () => {
  it("stores multiple jobs and activates only the newest saved job", async () => {
    const repository = new ChromeJobRepository(new MemoryStorageArea());

    await repository.saveAndActivate(jobA);
    await repository.saveAndActivate(jobB);

    expect(await repository.list()).toEqual([jobA, jobB]);
    expect((await repository.getActive())?.id).toBe(jobB.id);
  });

  it("activates an existing saved job without changing the job list", async () => {
    const repository = new ChromeJobRepository(new MemoryStorageArea());
    await repository.saveAndActivate(jobA);
    await repository.saveAndActivate(jobB);

    await repository.activate(jobA.id);

    expect(await repository.list()).toEqual([jobA, jobB]);
    expect((await repository.getActive())?.id).toBe(jobA.id);
  });
});
