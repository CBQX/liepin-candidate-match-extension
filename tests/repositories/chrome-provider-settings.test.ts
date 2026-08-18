import { describe, expect, it } from "vitest";
import { ChromeProviderSettingsRepository } from "../../src/repositories/chrome-provider-settings";
import type { StorageAreaLike } from "../../src/repositories/storage-area";

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

const settings = { providerId: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-test" };

describe("ChromeProviderSettingsRepository", () => {
  it("keeps the key in session unless rememberDevice is true", async () => {
    const local = new MemoryStorageArea();
    const session = new MemoryStorageArea();
    const repo = new ChromeProviderSettingsRepository(local, session);

    await repo.save(settings, false);

    expect((await session.get("providerSettings")).providerSettings).toEqual(settings);
    expect((await local.get("providerSettings")).providerSettings).toBeUndefined();
  });

  it("moves settings to extension-origin persistent storage when remembering this device", async () => {
    const persistent = new MemoryStorageArea();
    const session = new MemoryStorageArea();
    const repo = new ChromeProviderSettingsRepository(persistent, session);
    await repo.save(settings, false);

    await repo.save(settings, true);

    expect((await persistent.get("providerSettings")).providerSettings).toEqual(settings);
    expect((await session.get("providerSettings")).providerSettings).toBeUndefined();
  });

  it("loads session settings before a stale persistent copy", async () => {
    const local = new MemoryStorageArea();
    const session = new MemoryStorageArea();
    await local.set({ providerSettings: { ...settings, apiKey: "local-key" } });
    await session.set({ providerSettings: { ...settings, apiKey: "session-key" } });

    expect(await new ChromeProviderSettingsRepository(local, session).load()).toEqual({
      ...settings,
      apiKey: "session-key"
    });
  });

  it("clears provider settings from both storage areas", async () => {
    const local = new MemoryStorageArea();
    const session = new MemoryStorageArea();
    await local.set({ providerSettings: settings });
    await session.set({ providerSettings: settings });

    await new ChromeProviderSettingsRepository(local, session).clear();

    expect(await local.get("providerSettings")).toEqual({});
    expect(await session.get("providerSettings")).toEqual({});
  });

  it("rejects malformed stored provider settings at the repository boundary", async () => {
    // Break caught: arbitrary or blank provider/model identifiers from legacy storage must not reach the registry.
    const persistent = new MemoryStorageArea();
    const session = new MemoryStorageArea();
    await persistent.set({
      providerSettings: { providerId: "", model: "deepseek-v4-pro", apiKey: "secret" }
    });

    expect(await new ChromeProviderSettingsRepository(persistent, session).load()).toBeUndefined();
  });

  it("returns the schema-normalized settings and drops unknown legacy fields", async () => {
    // Break caught: using safeParse only as a boolean guard would return the untrusted object unchanged.
    const persistent = new MemoryStorageArea();
    const session = new MemoryStorageArea();
    await session.set({
      providerSettings: {
        providerId: " deepseek ",
        model: " deepseek-v4-pro ",
        apiKey: " sk-test ",
        unexpected: "must-not-cross-boundary"
      }
    });

    expect(await new ChromeProviderSettingsRepository(persistent, session).load()).toEqual(settings);
  });
});
