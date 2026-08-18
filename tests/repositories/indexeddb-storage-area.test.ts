import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  IndexedDbStorageArea,
  StorageAccessError
} from "../../src/repositories/indexeddb-storage-area";
import { MigratingPersistentStorageArea } from "../../src/repositories/migrating-persistent-storage";
import type { StorageAreaLike } from "../../src/repositories/storage-area";

class MemoryStorageArea implements StorageAreaLike {
  constructor(protected readonly values: Record<string, unknown> = {}) {}

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

class AtomicMemoryStorageArea extends MemoryStorageArea {
  failNextMigration = false;
  migrationCalls = 0;

  async migrateLegacyValues(
    items: Record<string, unknown>,
    markerKey: string
  ): Promise<void> {
    this.migrationCalls += 1;
    if (this.failNextMigration) {
      this.failNextMigration = false;
      throw new Error("migration unavailable");
    }
    if (this.values[markerKey] === true) return;

    for (const [key, value] of Object.entries(items)) {
      if (this.values[key] === undefined) this.values[key] = value;
    }
    this.values[markerKey] = true;
  }
}

class GatedLegacyStorageArea extends MemoryStorageArea {
  private reads = 0;
  private releaseReads!: () => void;
  private readonly readsReleased = new Promise<void>((resolve) => {
    this.releaseReads = resolve;
  });
  private reachedTarget!: () => void;
  private readonly targetReached = new Promise<void>((resolve) => {
    this.reachedTarget = resolve;
  });

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    const snapshot = await super.get(keys);
    this.reads += 1;
    if (this.reads === 2) this.reachedTarget();
    await this.readsReleased;
    return snapshot;
  }

  waitForTwoReads(): Promise<void> {
    return this.targetReached;
  }

  release(): void {
    this.releaseReads();
  }
}

class FailsFirstCleanupStorageArea extends MemoryStorageArea {
  removeCalls = 0;

  async remove(keys: string | string[]): Promise<void> {
    this.removeCalls += 1;
    if (this.removeCalls === 1) throw new Error("legacy cleanup unavailable");
    await super.remove(keys);
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

  it("applies legacy values and its marker atomically across IndexedDB instances", async () => {
    // Break caught: an adapter that implements migration as ordinary set calls can
    // overwrite newer state or resurrect a removed credential after cleanup recovery.
    const databaseFactory = new IDBFactory();
    const databaseName = `migration-${crypto.randomUUID()}`;
    const first = new IndexedDbStorageArea(databaseFactory, databaseName);
    const second = new IndexedDbStorageArea(databaseFactory, databaseName);
    await first.set({ activeJobId: "new-job" });

    await Promise.all([
      first.migrateLegacyValues({
        jobs: [{ id: "old-job" }],
        activeJobId: "old-job",
        providerSettings: { apiKey: "legacy-secret" }
      }, "legacy-v1"),
      second.migrateLegacyValues({
        jobs: [{ id: "old-job" }],
        activeJobId: "old-job",
        providerSettings: { apiKey: "legacy-secret" }
      }, "legacy-v1")
    ]);

    expect(await first.get(["jobs", "activeJobId", "providerSettings"])).toEqual({
      jobs: [{ id: "old-job" }],
      activeJobId: "new-job",
      providerSettings: { apiKey: "legacy-secret" }
    });

    await first.remove("providerSettings");
    await second.migrateLegacyValues({
      providerSettings: { apiKey: "legacy-secret" }
    }, "legacy-v1");
    expect(await first.get("providerSettings")).toEqual({});
  });

  it("migrates legacy local keys once, preserves newer IndexedDB values, and clears legacy copies", async () => {
    // Break caught: upgrades could leave API keys readable from content scripts or overwrite already-migrated state.
    const persistent = new AtomicMemoryStorageArea({ activeJobId: "new-job" });
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

  it("atomically prevents two migrators with stale legacy reads from overwriting a newer value", async () => {
    // Break caught: side-panel and service-worker migrators could both read an absent key,
    // then overwrite a newer IndexedDB write with the same stale chrome.storage.local value.
    const persistent = new AtomicMemoryStorageArea();
    const legacy = new GatedLegacyStorageArea({
      jobs: [{ id: "old-job" }],
      activeJobId: "old-job",
      unrelated: "keep"
    });
    const first = new MigratingPersistentStorageArea(persistent, legacy);
    const second = new MigratingPersistentStorageArea(persistent, legacy);

    const firstRead = first.get(["jobs", "activeJobId"]);
    const secondRead = second.get(["jobs", "activeJobId"]);
    await legacy.waitForTwoReads();
    await persistent.set({ activeJobId: "new-job" });
    legacy.release();

    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      { jobs: [{ id: "old-job" }], activeJobId: "new-job" },
      { jobs: [{ id: "old-job" }], activeJobId: "new-job" }
    ]);
    expect(await persistent.get(["jobs", "activeJobId"])).toEqual({
      jobs: [{ id: "old-job" }],
      activeJobId: "new-job"
    });
    expect(await legacy.get(null)).toEqual({ unrelated: "keep" });
  });

  it("retries legacy cleanup without replaying values after cleanup fails", async () => {
    // Break caught: a cached rejected migration or missing idempotent marker could either
    // permanently block storage or resurrect a stale API key on the next cleanup attempt.
    const persistent = new AtomicMemoryStorageArea();
    const legacy = new FailsFirstCleanupStorageArea({
      activeJobId: "old-job",
      providerSettings: {
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        apiKey: "secret-that-must-not-appear-in-errors"
      }
    });
    const storage = new MigratingPersistentStorageArea(persistent, legacy);

    await expect(storage.get("activeJobId")).rejects.toThrow("legacy cleanup unavailable");
    await persistent.set({ activeJobId: "new-job" });

    await expect(storage.get("activeJobId")).resolves.toEqual({ activeJobId: "new-job" });
    expect(await legacy.get(null)).toEqual({});
    expect(persistent.migrationCalls).toBe(2);
  });

  it("leaves legacy values intact and retries after an atomic migration error", async () => {
    // Break caught: clearing chrome.storage.local after a failed transaction would lose settings,
    // while caching the failure would make the extension unable to recover on its next read.
    const persistent = new AtomicMemoryStorageArea();
    persistent.failNextMigration = true;
    const legacy = new MemoryStorageArea({ jobs: [{ id: "old-job" }] });
    const storage = new MigratingPersistentStorageArea(persistent, legacy);

    await expect(storage.get("jobs")).rejects.toThrow("migration unavailable");
    expect(await legacy.get("jobs")).toEqual({ jobs: [{ id: "old-job" }] });

    await expect(storage.get("jobs")).resolves.toEqual({ jobs: [{ id: "old-job" }] });
    expect(await legacy.get("jobs")).toEqual({});
  });

  it("normalizes IndexedDB request failures without including stored values in the error", async () => {
    // Break caught: persistence errors must be actionable without leaking secrets into logs or UI messages.
    const error = new StorageAccessError(new Error("secret-value"));

    expect(error).toMatchObject({ code: "STORAGE_FAILED", message: "扩展本地存储操作失败。" });
    expect(error.message).not.toContain("secret-value");
  });
});
