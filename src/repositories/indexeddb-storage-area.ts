import type { StorageAreaLike } from "./storage-area";

const DEFAULT_DATABASE_NAME = "liepin-candidate-match-extension";
const STORE_NAME = "persistentSettings";
const MIGRATION_STORE_NAME = "migrationMetadata";
const DATABASE_VERSION = 2;

export class StorageAccessError extends Error {
  readonly code = "STORAGE_FAILED" as const;

  constructor(_cause?: unknown) {
    super("扩展本地存储操作失败。");
    this.name = "StorageAccessError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(new StorageAccessError()), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(new StorageAccessError()), { once: true });
    transaction.addEventListener("error", () => reject(new StorageAccessError()), { once: true });
  });
}

/**
 * Extension-page/service-worker persistence. Content scripts use the visited
 * page's origin for IndexedDB and therefore cannot open this extension-origin
 * database on Chrome 116.
 */
export class IndexedDbStorageArea implements StorageAreaLike {
  constructor(
    private readonly databaseFactory: IDBFactory | undefined = globalThis.indexedDB,
    private readonly databaseName = DEFAULT_DATABASE_NAME
  ) {}

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    return this.withDatabase(async (database) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const requestedKeys = typeof keys === "string" ? [keys] : keys;

      if (requestedKeys === undefined || requestedKeys === null) {
        const [storedKeys, values] = await Promise.all([
          requestResult(store.getAllKeys()),
          requestResult(store.getAll())
        ]);
        await transactionComplete(transaction);
        return Object.fromEntries(storedKeys.map((key, index) => [String(key), values[index]]));
      }

      const values = await Promise.all(requestedKeys.map(async (key) => [
        key,
        await requestResult(store.get(key))
      ] as const));
      await transactionComplete(transaction);
      return Object.fromEntries(values.filter(([, value]) => value !== undefined));
    });
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.withDatabase(async (database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const [key, value] of Object.entries(items)) store.put(value, key);
      await transactionComplete(transaction);
    });
  }

  async remove(keys: string | string[]): Promise<void> {
    await this.withDatabase(async (database) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const key of typeof keys === "string" ? [keys] : keys) store.delete(key);
      await transactionComplete(transaction);
    });
  }

  async migrateLegacyValues(
    items: Record<string, unknown>,
    markerKey: string
  ): Promise<void> {
    await this.withDatabase(async (database) => {
      const transaction = database.transaction(
        [STORE_NAME, MIGRATION_STORE_NAME],
        "readwrite"
      );
      const persistentStore = transaction.objectStore(STORE_NAME);
      const migrationStore = transaction.objectStore(MIGRATION_STORE_NAME);
      const entries = Object.entries(items);
      const [migrationComplete, ...existingValues] = await Promise.all([
        requestResult(migrationStore.get(markerKey)),
        ...entries.map(([key]) => requestResult(persistentStore.get(key)))
      ]);

      if (migrationComplete !== true) {
        entries.forEach(([key, value], index) => {
          if (existingValues[index] === undefined) persistentStore.put(value, key);
        });
        migrationStore.put(true, markerKey);
      }
      await transactionComplete(transaction);
    });
  }

  private async withDatabase<T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T> {
    if (!this.databaseFactory) throw new StorageAccessError();

    let database: IDBDatabase | undefined;
    try {
      database = await this.openDatabase();
      return await operation(database);
    } catch (error) {
      if (error instanceof StorageAccessError) throw error;
      throw new StorageAccessError(error);
    } finally {
      database?.close();
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.databaseFactory) return Promise.reject(new StorageAccessError());

    return new Promise((resolve, reject) => {
      const request = this.databaseFactory!.open(this.databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
        if (!request.result.objectStoreNames.contains(MIGRATION_STORE_NAME)) {
          request.result.createObjectStore(MIGRATION_STORE_NAME);
        }
      }, { once: true });
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(new StorageAccessError()), { once: true });
      request.addEventListener("blocked", () => reject(new StorageAccessError()), { once: true });
    });
  }
}
