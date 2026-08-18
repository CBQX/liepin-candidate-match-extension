import type { JobRepository } from "../domain/jobs/job-repository";
import { ChromeJobRepository } from "../repositories/chrome-job-repository";
import {
  ChromeProviderSettingsRepository,
  type ProviderSettings
} from "../repositories/chrome-provider-settings";
import type { RuntimeResponse } from "../shared/contracts/messages";

export interface ProviderSettingsRepository {
  load(): Promise<ProviderSettings | undefined>;
  save(settings: ProviderSettings, rememberDevice: boolean): Promise<void>;
  clear(): Promise<void>;
}

export interface SidePanelDependencies {
  providerSettings: ProviderSettingsRepository;
  jobs: JobRepository;
  validateProvider(): Promise<RuntimeResponse<{ valid: true }>>;
  extractCurrentCandidate(): Promise<RuntimeResponse>;
}

const providerSettings = new ChromeProviderSettingsRepository(
  chrome.storage.local,
  chrome.storage.session
);

export const appDependencies: SidePanelDependencies = {
  providerSettings,
  jobs: new ChromeJobRepository(chrome.storage.local),
  validateProvider() {
    return chrome.runtime.sendMessage({ type: "VALIDATE_PROVIDER" });
  },
  extractCurrentCandidate() {
    return chrome.runtime.sendMessage({ type: "EXTRACT_CURRENT_CANDIDATE" });
  }
};
