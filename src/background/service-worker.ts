import { createBackgroundController } from "./controller";
import { runtimeRequestSchema } from "../shared/contracts/messages";
import { ChromeProviderSettingsRepository } from "../repositories/chrome-provider-settings";
import { DeepSeekProvider } from "../providers/deepseek/deepseek-provider";
import { ModelProviderRegistry } from "../providers/model-provider";

const unknownRequestResponse = {
  ok: false as const,
  error: { code: "UNKNOWN" as const, message: "无法识别的插件请求。" }
};

const providerSettings = new ChromeProviderSettingsRepository(
  chrome.storage.local,
  chrome.storage.session
);
const providers = new ModelProviderRegistry([new DeepSeekProvider()]);

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
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
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

function broadcastPageContextChanged(): void {
  void chrome.runtime.sendMessage({ type: "PAGE_CONTEXT_CHANGED" });
}

chrome.tabs.onActivated.addListener(() => {
  broadcastPageContextChanged();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.active) {
    broadcastPageContextChanged();
  }
});
