import { createBackgroundController } from "./controller";
import { runtimeRequestSchema } from "../shared/contracts/messages";
import { ChromeProviderSettingsRepository } from "../repositories/chrome-provider-settings";
import { DeepSeekProvider } from "../providers/deepseek/deepseek-provider";
import { ModelProviderRegistry } from "../providers/model-provider";
import { registerPageContextBroadcasts } from "./page-context";
import { IndexedDbStorageArea } from "../repositories/indexeddb-storage-area";
import { MigratingPersistentStorageArea } from "../repositories/migrating-persistent-storage";
import { ChromeJobRepository } from "../repositories/chrome-job-repository";
import { JobService } from "../domain/jobs/job-service";

const unknownRequestResponse = {
  ok: false as const,
  error: { code: "UNKNOWN" as const, message: "无法识别的插件请求。" }
};

const persistentStorage = new MigratingPersistentStorageArea(
  new IndexedDbStorageArea(globalThis.indexedDB),
  chrome.storage.local
);
const providerSettings = new ChromeProviderSettingsRepository(persistentStorage, chrome.storage.session);
const jobs = new JobService(new ChromeJobRepository(persistentStorage));
const providers = new ModelProviderRegistry([new DeepSeekProvider()]);

// Trigger legacy-key cleanup as soon as the trusted service worker starts.
void persistentStorage.get([]).catch(() => undefined);

const controller = createBackgroundController({
  async getActiveTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return activeTab;
  },
  sendToTab(tabId, request) {
    return chrome.tabs.sendMessage(tabId, request);
  },
  loadProviderSettings() {
    return providerSettings.load();
  },
  resolveProvider(providerId) {
    return providers.get(providerId);
  },
  confirmJobProfile(jobId, profile) {
    return jobs.confirmAndActivateProfile(jobId, profile);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await persistentStorage.get([]).catch(() => undefined);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
});

chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
  const parsedRequest = runtimeRequestSchema.safeParse(request);
  const response = parsedRequest.success
    ? controller.handle(parsedRequest.data)
    : Promise.resolve(unknownRequestResponse);

  response.catch(() => unknownRequestResponse).then(sendResponse);
  return true;
});

registerPageContextBroadcasts(chrome.tabs, () => {
  void chrome.runtime.sendMessage({ type: "PAGE_CONTEXT_CHANGED" });
});
