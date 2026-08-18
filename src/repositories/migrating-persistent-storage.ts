import type { StorageAreaLike } from "./storage-area";

const LEGACY_LOCAL_KEYS = ["jobs", "activeJobId", "providerSettings"] as const;

/** Moves pre-IndexedDB releases out of chrome.storage.local without logging values. */
export class MigratingPersistentStorageArea implements StorageAreaLike {
  private migration?: Promise<void>;

  constructor(
    private readonly persistent: StorageAreaLike,
    private readonly legacyLocal: StorageAreaLike
  ) {}

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    await this.ensureMigrated();
    return this.persistent.get(keys);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.ensureMigrated();
    await this.persistent.set(items);
  }

  async remove(keys: string | string[]): Promise<void> {
    await this.ensureMigrated();
    await this.persistent.remove(keys);
  }

  private ensureMigrated(): Promise<void> {
    this.migration ??= this.migrateLegacyLocalState();
    return this.migration;
  }

  private async migrateLegacyLocalState(): Promise<void> {
    const [legacyValues, persistentValues] = await Promise.all([
      this.legacyLocal.get([...LEGACY_LOCAL_KEYS]),
      this.persistent.get([...LEGACY_LOCAL_KEYS])
    ]);
    const valuesToMigrate = Object.fromEntries(LEGACY_LOCAL_KEYS.flatMap((key) =>
      persistentValues[key] === undefined && legacyValues[key] !== undefined
        ? [[key, legacyValues[key]]]
        : []
    ));

    if (Object.keys(valuesToMigrate).length > 0) {
      await this.persistent.set(valuesToMigrate);
    }
    await this.legacyLocal.remove([...LEGACY_LOCAL_KEYS]);
  }
}
