import type { StorageAreaLike } from "./storage-area";
import { z } from "zod";

const PROVIDER_SETTINGS_KEY = "providerSettings";

const providerIdentifier = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

export const providerSettingsSchema = z.object({
  providerId: providerIdentifier,
  model: providerIdentifier,
  apiKey: z.string().trim().min(1).max(4096)
});

export type ProviderSettings = z.infer<typeof providerSettingsSchema>;

export class ChromeProviderSettingsRepository {
  constructor(
    private readonly local: StorageAreaLike,
    private readonly session: StorageAreaLike
  ) {}

  async save(settings: ProviderSettings, rememberDevice: boolean): Promise<void> {
    const destination = rememberDevice ? this.local : this.session;
    const staleStorage = rememberDevice ? this.session : this.local;
    const parsedSettings = providerSettingsSchema.parse(settings);
    await destination.set({ [PROVIDER_SETTINGS_KEY]: parsedSettings });
    await staleStorage.remove(PROVIDER_SETTINGS_KEY);
  }

  async load(): Promise<ProviderSettings | undefined> {
    const sessionSettings = (await this.session.get(PROVIDER_SETTINGS_KEY))[PROVIDER_SETTINGS_KEY];
    const parsedSessionSettings = parseProviderSettings(sessionSettings);
    if (parsedSessionSettings) return parsedSessionSettings;

    const localSettings = (await this.local.get(PROVIDER_SETTINGS_KEY))[PROVIDER_SETTINGS_KEY];
    return parseProviderSettings(localSettings);
  }

  async clear(): Promise<void> {
    await Promise.all([
      this.local.remove(PROVIDER_SETTINGS_KEY),
      this.session.remove(PROVIDER_SETTINGS_KEY)
    ]);
  }
}

function parseProviderSettings(value: unknown): ProviderSettings | undefined {
  const parsed = providerSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
