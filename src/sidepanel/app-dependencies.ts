import type { JobRepository } from "../domain/jobs/job-repository";
import { ChromeJobRepository } from "../repositories/chrome-job-repository";
import {
  ChromeProviderSettingsRepository,
  type ProviderSettings
} from "../repositories/chrome-provider-settings";
import { IndexedDbStorageArea } from "../repositories/indexeddb-storage-area";
import { MigratingPersistentStorageArea } from "../repositories/migrating-persistent-storage";
import type {
  CandidateDraft,
  CandidateRedactionContext
} from "../shared/contracts/candidate";
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
  analyzeCandidate(
    job: Job,
    candidateDraft: CandidateDraft,
    redactionContext: CandidateRedactionContext,
    requestId: string
  ): Promise<RuntimeResponse<MatchAnalysis>>;
  cancelAnalysis(requestId: string): Promise<RuntimeResponse<{ cancelled: boolean }>>;
  subscribeToPageContextChanges(listener: () => void): () => void;
}

const persistentStorage = new MigratingPersistentStorageArea(
  new IndexedDbStorageArea(globalThis.indexedDB),
  chrome.storage.local
);
const providerSettings = new ChromeProviderSettingsRepository(persistentStorage, chrome.storage.session);

export const appDependencies: SidePanelDependencies = {
  providerSettings,
  jobs: new ChromeJobRepository(persistentStorage),
  validateProvider() {
    return chrome.runtime.sendMessage({ type: "VALIDATE_PROVIDER" });
  },
  extractCurrentCandidate() {
    return chrome.runtime.sendMessage({ type: "EXTRACT_CURRENT_CANDIDATE" });
  },
  analyzeCandidate(job, candidateDraft, redactionContext, requestId) {
    return chrome.runtime.sendMessage({
      type: "ANALYZE_CANDIDATE",
      requestId,
      job,
      candidateDraft,
      redactionContext
    });
  },
  cancelAnalysis(requestId) {
    return chrome.runtime.sendMessage({ type: "CANCEL_ANALYSIS", requestId });
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
