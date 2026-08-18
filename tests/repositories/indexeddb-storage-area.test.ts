import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  IndexedDbStorageArea,
  StorageAccessError
} from "../../src/repositories/indexeddb-storage-area";
import { MigratingPersistentStorageArea } from "../../src/repositories/migrating-persistent-storage";
import type { StorageAreaLike } from "../../src/repositories/storage-area";

class MemoryStorageArea implements StorageAreaLike {
  constructor(private readonly values: Record<string, unknown> = {}) {}

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === undefined || keys === null) return { ...this.values };
    const requested = typeof keys === "string" ? [keys] : keys;
    return Object.fromEntries(requested.flatMap((key) => key in this.values
      ? [[key, this.values[key]]]
      : []));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) delete this.values[key];
  }
}

describe("extension-origin IndexedDB storage", () => {
  it("round-trips and removes persistent values through the injected IndexedDB factory", async () => {
    // Break caught: falling back to chrome.storage.local would expose persistent state to Chrome 116 content scripts.
    const storage = new IndexedDbStorageArea(new IDBFactory(), `test-${crypto.randomUUID()}`);

    await storage.set({ jobs: [{ id: "job-1" }], activeJobId: "job-1" });
    expect(await storage.get(["jobs", "activeJobId"])).toEqual({
      jobs: [{ id: "job-1" }],
      activeJobId: "job-1"
    });

    await storage.remove("activeJobId");
    expect(await storage.get(null)).toEqual({ jobs: [{ id: "job-1" }] });
  });

  it("reports unavailable IndexedDB as STORAGE_FAILED", async () => {
    // Break caught: an unavailable extension database must not silently downgrade to local storage.
    const storage = new IndexedDbStorageArea(undefined, "unavailable-db");

    await expect(storage.get("jobs")).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });

  it("migrates legacy local keys once, preserves newer IndexedDB values, and clears legacy copies", async () => {
    // Break caught: upgrades could leave API keys readable from content scripts or overwrite already-migrated state.
    const persistent = new MemoryStorageArea({ activeJobId: "new-job" });
    const legacy = new MemoryStorageArea({
      jobs: [{ id: "old-job" }],
      activeJobId: "old-job",
      providerSettings: { providerId: "deepseek", model: "deepseek-v4-pro", apiKey: "secret" },
      unrelated: "keep"
    });
    const storage = new MigratingPersistentStorageArea(persistent, legacy);

    expect(await storage.get(["jobs", "activeJobId", "providerSettings"])).toEqual({
      jobs: [{ id: "old-job" }],
      activeJobId: "new-job",
      providerSettings: { providerId: "deepseek", model: "deepseek-v4-pro", apiKey: "secret" }
    });
    expect(await legacy.get(null)).toEqual({ unrelated: "keep" });
  });

  it("normalizes IndexedDB request failures without including stored values in the error", async () => {
    // Break caught: persistence errors must be actionable without leaking secrets into logs or UI messages.
    const error = new StorageAccessError(new Error("secret-value"));

    expect(error).toMatchObject({ code: "STORAGE_FAILED", message: "扩展本地存储操作失败。" });
    expect(error.message).not.toContain("secret-value");
  });
});
