import type { StorageAreaLike } from "./storage-area";

const LEGACY_LOCAL_KEYS = ["jobs", "activeJobId", "providerSettings"] as const;
const LEGACY_LOCAL_MIGRATION_MARKER = "chrome-storage-local-v1";

export interface AtomicMigrationStorageArea extends StorageAreaLike {
  migrateLegacyValues(items: Record<string, unknown>, markerKey: string): Promise<void>;
}

/** Moves pre-IndexedDB releases out of chrome.storage.local without logging values. */
export class MigratingPersistentStorageArea implements StorageAreaLike {
  private migration?: Promise<void>;

  constructor(
    private readonly persistent: AtomicMigrationStorageArea,
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
    this.migration ??= this.migrateLegacyLocalState().catch((error: unknown) => {
      this.migration = undefined;
      throw error;
    });
    return this.migration;
  }

  private async migrateLegacyLocalState(): Promise<void> {
    const legacyValues = await this.legacyLocal.get([...LEGACY_LOCAL_KEYS]);
    const valuesToMigrate = Object.fromEntries(LEGACY_LOCAL_KEYS.flatMap((key) =>
      legacyValues[key] !== undefined
        ? [[key, legacyValues[key]]]
        : []
    ));

    await this.persistent.migrateLegacyValues(
      valuesToMigrate,
      LEGACY_LOCAL_MIGRATION_MARKER
    );
    await this.legacyLocal.remove([...LEGACY_LOCAL_KEYS]);
  }
}
