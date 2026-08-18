import type { StorageAreaLike } from "./storage-area";

const PROVIDER_SETTINGS_KEY = "providerSettings";

export interface ProviderSettings {
  providerId: string;
  model: string;
  apiKey: string;
}

export class ChromeProviderSettingsRepository {
  constructor(
    private readonly local: StorageAreaLike,
    private readonly session: StorageAreaLike
  ) {}

  async save(settings: ProviderSettings, rememberDevice: boolean): Promise<void> {
    const destination = rememberDevice ? this.local : this.session;
    const staleStorage = rememberDevice ? this.session : this.local;
    await destination.set({ [PROVIDER_SETTINGS_KEY]: settings });
    await staleStorage.remove(PROVIDER_SETTINGS_KEY);
  }

  async load(): Promise<ProviderSettings | undefined> {
    const sessionSettings = (await this.session.get(PROVIDER_SETTINGS_KEY))[PROVIDER_SETTINGS_KEY];
    if (isProviderSettings(sessionSettings)) return sessionSettings;

    const localSettings = (await this.local.get(PROVIDER_SETTINGS_KEY))[PROVIDER_SETTINGS_KEY];
    return isProviderSettings(localSettings) ? localSettings : undefined;
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.local.remove(PROVIDER_SETTINGS_KEY),
      this.session.remove(PROVIDER_SETTINGS_KEY)
    ]);
  }
}

function isProviderSettings(value: unknown): value is ProviderSettings {
  if (typeof value !== "object" || value === null) return false;

  const settings = value as Record<string, unknown>;
  return typeof settings.providerId === "string"
    && typeof settings.model === "string"
    && typeof settings.apiKey === "string";
}
