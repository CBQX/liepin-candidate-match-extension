import type { JobRepository } from "../domain/jobs/job-repository";
import { ChromeJobRepository } from "../repositories/chrome-job-repository";
import {
  ChromeProviderSettingsRepository,
  type ProviderSettings
} from "../repositories/chrome-provider-settings";
import type { CandidateDraft } from "../shared/contracts/candidate";
import type { Job } from "../shared/contracts/job";
import type { MatchAnalysis } from "../shared/contracts/matching";
import {
  pageContextChangedEventSchema,
  type RuntimeResponse
} from "../shared/contracts/messages";

export interface ProviderSettingsRepository {
  load(): Promise<ProviderSettings | undefined>;
  save(settings: ProviderSettings, rememberDevice: boolean): Promise<void>;
  clear(): Promise<void>;
}

export interface SidePanelDependencies {
  providerSettings: ProviderSettingsRepository;
  jobs: JobRepository;
  validateProvider(): Promise<RuntimeResponse<{ valid: true }>>;
  extractCurrentCandidate(): Promise<RuntimeResponse<CandidateDraft>>;
  analyzeCandidate(job: Job, candidateDraft: CandidateDraft): Promise<RuntimeResponse<MatchAnalysis>>;
  subscribeToPageContextChanges(listener: () => void): () => void;
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
  },
  analyzeCandidate(job, candidateDraft) {
    return chrome.runtime.sendMessage({ type: "ANALYZE_CANDIDATE", job, candidateDraft });
  },
  subscribeToPageContextChanges(listener) {
    const runtimeListener = (message: unknown) => {
      if (pageContextChangedEventSchema.safeParse(message).success) listener();
      return undefined;
    };
    chrome.runtime.onMessage.addListener(runtimeListener);
    return () => chrome.runtime.onMessage.removeListener(runtimeListener);
  }
};
