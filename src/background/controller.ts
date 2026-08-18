import type { RuntimeRequest, RuntimeResponse } from "../shared/contracts/messages";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import type { ModelProvider } from "../providers/model-provider";
import { mapProviderError } from "../providers/deepseek/deepseek-provider";
import { redactCandidateDraft } from "../shared/privacy";
import { analyzeCandidate } from "./analyze-candidate";

type ActiveTab = Pick<chrome.tabs.Tab, "id" | "url"> | undefined;

export interface BackgroundControllerDependencies {
  getActiveTab(): Promise<ActiveTab>;
  sendToTab(tabId: number, request: Extract<RuntimeRequest, { type: "EXTRACT_CURRENT_CANDIDATE" }>): Promise<RuntimeResponse>;
  loadProviderSettings(): Promise<ProviderSettings | undefined>;
  resolveProvider(providerId: string): ModelProvider | undefined;
}

export interface BackgroundController {
  handle(request: RuntimeRequest): Promise<RuntimeResponse>;
}

const unknownRequest = (): RuntimeResponse => ({
  ok: false,
  error: { code: "UNKNOWN", message: "无法识别的插件请求。" }
});

const unsupportedPage = (): RuntimeResponse => ({
  ok: false,
  error: { code: "UNSUPPORTED_PAGE", message: "请在猎聘候选人详情页中使用此功能。" }
});

function isLiepinPage(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const pageUrl = new URL(url);
    return pageUrl.protocol === "https:" && (
      pageUrl.hostname === "liepin.com" || pageUrl.hostname.endsWith(".liepin.com")
    );
  } catch {
    return false;
  }
}

async function loadSettings(
  dependencies: BackgroundControllerDependencies
): Promise<RuntimeResponse<ProviderSettings | undefined>> {
  try {
    return { ok: true, data: await dependencies.loadProviderSettings() };
  } catch {
    return {
      ok: false,
      error: mapProviderError({ code: "STORAGE_FAILED" })
    };
  }
}

export function createBackgroundController(
  dependencies: BackgroundControllerDependencies
): BackgroundController {
  return {
    async handle(request) {
      if (request.type === "VALIDATE_PROVIDER") {
        const loadedSettings = await loadSettings(dependencies);
        if (!loadedSettings.ok) return loadedSettings;

        try {
          const settings = loadedSettings.data;
          if (!settings || settings.apiKey.trim() === "") {
            return {
              ok: false,
              error: mapProviderError({ code: "MISSING_API_KEY" })
            };
          }

          const provider = dependencies.resolveProvider(settings.providerId);
          if (!provider) {
            return {
              ok: false,
              error: mapProviderError({ code: "INVALID_PROVIDER_SETTINGS" })
            };
          }

          await provider.validateCredentials(settings);
          return { ok: true, data: { valid: true } };
        } catch (error) {
          return { ok: false, error: mapProviderError(error) };
        }
      }

      if (request.type === "ANALYZE_CANDIDATE") {
        const loadedSettings = await loadSettings(dependencies);
        if (!loadedSettings.ok) return loadedSettings;

        try {
          const settings = loadedSettings.data;
          if (!settings || settings.apiKey.trim() === "") {
            return {
              ok: false,
              error: mapProviderError({ code: "MISSING_API_KEY" })
            };
          }

          const provider = dependencies.resolveProvider(settings.providerId);
          if (!provider) {
            return {
              ok: false,
              error: mapProviderError({ code: "INVALID_PROVIDER_SETTINGS" })
            };
          }

          const analysis = await analyzeCandidate(request, {
            provider,
            settings,
            redact: redactCandidateDraft
          });
          return { ok: true, data: analysis };
        } catch (error) {
          return { ok: false, error: mapProviderError(error) };
        }
      }

      if (request.type !== "EXTRACT_CURRENT_CANDIDATE") {
        return unknownRequest();
      }

      const activeTab = await dependencies.getActiveTab();
      if (typeof activeTab?.id !== "number" || !isLiepinPage(activeTab.url)) {
        return unsupportedPage();
      }

      try {
        return await dependencies.sendToTab(activeTab.id, request);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "EXTRACTION_FAILED",
            message: error instanceof Error ? error.message : "候选人信息提取失败"
          }
        };
      }
    }
  };
}
