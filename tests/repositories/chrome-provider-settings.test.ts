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

  it("moves settings to local storage when remembering this device", async () => {
    const local = new MemoryStorageArea();
    const session = new MemoryStorageArea();
    const repo = new ChromeProviderSettingsRepository(local, session);
    await repo.save(settings, false);

    await repo.save(settings, true);

    expect((await local.get("providerSettings")).providerSettings).toEqual(settings);
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
});
