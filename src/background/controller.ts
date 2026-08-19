import type { RuntimeRequest, RuntimeResponse } from "../shared/contracts/messages";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import {
  mapModelProviderError,
  NormalizedProviderError,
  type ModelProvider
} from "../providers/model-provider";
import { redactCandidateDraft } from "../shared/privacy";
import { isSupportedLiepinCandidateDetailPage } from "../shared/liepin-page";
import { analyzeCandidate } from "./analyze-candidate";
import { generateJobProfile } from "./generate-job-profile";
import type { Job } from "../shared/contracts/job";
import type { ModelRecruitmentProfile } from "../shared/contracts/recruitment-profile";

type ActiveTab = Pick<chrome.tabs.Tab, "id" | "url"> | undefined;

export interface BackgroundControllerDependencies {
  getActiveTab(): Promise<ActiveTab>;
  sendToTab(tabId: number, request: Extract<RuntimeRequest, { type: "EXTRACT_CURRENT_CANDIDATE" }>): Promise<RuntimeResponse>;
  loadProviderSettings(): Promise<ProviderSettings | undefined>;
  resolveProvider(providerId: string): ModelProvider | undefined;
  confirmJobProfile?(jobId: string, profile: ModelRecruitmentProfile): Promise<Job>;
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

async function loadSettings(
  dependencies: BackgroundControllerDependencies
): Promise<RuntimeResponse<ProviderSettings | undefined>> {
  try {
    return { ok: true, data: await dependencies.loadProviderSettings() };
  } catch {
    return {
      ok: false,
      error: mapModelProviderError({ code: "STORAGE_FAILED" })
    };
  }
}

export function createBackgroundController(
  dependencies: BackgroundControllerDependencies
): BackgroundController {
  const activeAnalyses = new Map<string, AbortController>();
  const activeJobProfiles = new Map<string, AbortController>();

  return {
    async handle(request) {
      if (request.type === "CANCEL_ANALYSIS") {
        const activeAnalysis = activeAnalyses.get(request.requestId);
        activeAnalysis?.abort();
        activeAnalyses.delete(request.requestId);
        return { ok: true, data: { cancelled: Boolean(activeAnalysis) } };
      }

      if (request.type === "CANCEL_JOB_PROFILE") {
        const activeProfile = activeJobProfiles.get(request.requestId);
        activeProfile?.abort();
        activeJobProfiles.delete(request.requestId);
        return { ok: true, data: { cancelled: Boolean(activeProfile) } };
      }

      if (request.type === "CONFIRM_JOB_PROFILE") {
        try {
          if (!dependencies.confirmJobProfile) {
            throw new NormalizedProviderError("STORAGE_FAILED");
          }
          return {
            ok: true,
            data: await dependencies.confirmJobProfile(request.jobId, request.profile)
          };
        } catch (error) {
          return {
            ok: false,
            error: mapModelProviderError(
              error instanceof NormalizedProviderError
                ? error
                : { code: "STORAGE_FAILED" }
            )
          };
        }
      }

      if (request.type === "VALIDATE_PROVIDER") {
        const loadedSettings = await loadSettings(dependencies);
        if (!loadedSettings.ok) return loadedSettings;

        try {
          const settings = loadedSettings.data;
          if (!settings || settings.apiKey.trim() === "") {
            return {
              ok: false,
              error: mapModelProviderError({ code: "MISSING_API_KEY" })
            };
          }

          const provider = dependencies.resolveProvider(settings.providerId);
          if (!provider) {
            return {
              ok: false,
              error: mapModelProviderError({ code: "INVALID_PROVIDER_SETTINGS" })
            };
          }

          await provider.validateCredentials(settings);
          return { ok: true, data: { valid: true } };
        } catch (error) {
          return { ok: false, error: mapModelProviderError(error) };
        }
      }

      if (request.type === "ANALYZE_CANDIDATE") {
        activeAnalyses.get(request.requestId)?.abort();
        const abortController = new AbortController();
        activeAnalyses.set(request.requestId, abortController);

        try {
          const loadedSettings = await loadSettings(dependencies);
          if (abortController.signal.aborted) {
            throw new NormalizedProviderError("ANALYSIS_CANCELLED");
          }
          if (!loadedSettings.ok) return loadedSettings;

          const settings = loadedSettings.data;
          if (!settings || settings.apiKey.trim() === "") {
            return {
              ok: false,
              error: mapModelProviderError({ code: "MISSING_API_KEY" })
            };
          }

          const provider = dependencies.resolveProvider(settings.providerId);
          if (!provider) {
            return {
              ok: false,
              error: mapModelProviderError({ code: "INVALID_PROVIDER_SETTINGS" })
            };
          }

          const analysis = await analyzeCandidate(request, {
            provider,
            settings,
            redact: redactCandidateDraft,
            signal: abortController.signal
          });
          return { ok: true, data: analysis };
        } catch (error) {
          return { ok: false, error: mapModelProviderError(error) };
        } finally {
          if (activeAnalyses.get(request.requestId) === abortController) {
            activeAnalyses.delete(request.requestId);
          }
        }
      }

      if (request.type === "GENERATE_JOB_PROFILE") {
        activeJobProfiles.get(request.requestId)?.abort();
        const abortController = new AbortController();
        activeJobProfiles.set(request.requestId, abortController);

        try {
          const loadedSettings = await loadSettings(dependencies);
          if (abortController.signal.aborted) {
            throw new NormalizedProviderError("ANALYSIS_CANCELLED");
          }
          if (!loadedSettings.ok) return loadedSettings;

          const settings = loadedSettings.data;
          if (!settings || settings.apiKey.trim() === "") {
            return {
              ok: false,
              error: mapModelProviderError({ code: "MISSING_API_KEY" })
            };
          }
          const provider = dependencies.resolveProvider(settings.providerId);
          if (!provider || !provider.generateRecruitmentProfile) {
            return {
              ok: false,
              error: mapModelProviderError({ code: "INVALID_PROVIDER_SETTINGS" })
            };
          }

          return {
            ok: true,
            data: await generateJobProfile(request, {
              provider,
              settings,
              signal: abortController.signal
            })
          };
        } catch (error) {
          return { ok: false, error: mapModelProviderError(error) };
        } finally {
          if (activeJobProfiles.get(request.requestId) === abortController) {
            activeJobProfiles.delete(request.requestId);
          }
        }
      }

      if (request.type !== "EXTRACT_CURRENT_CANDIDATE") {
        return unknownRequest();
      }

      const activeTab = await dependencies.getActiveTab();
      if (
        typeof activeTab?.id !== "number"
        || !activeTab.url
        || !isSupportedLiepinCandidateDetailPage(activeTab.url)
      ) {
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
