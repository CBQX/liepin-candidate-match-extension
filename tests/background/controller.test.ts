import { describe, expect, it, vi } from "vitest";
import { createBackgroundController } from "../../src/background/controller";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { ModelProvider } from "../../src/providers/model-provider";
import { NormalizedProviderError } from "../../src/providers/model-provider";
import type { ModelMatchResult } from "../../src/shared/contracts/matching";

const candidateDraft: CandidateDraft = {
  basics: { text: "候选人甲", status: "complete" },
  workExperience: { text: "五年产品经验", status: "complete" },
  projects: { text: "", status: "missing" },
  education: { text: "本科", status: "complete" },
  skills: { text: "产品设计", status: "complete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "high"
};

const settings = { providerId: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-test" };

function dependencies(overrides: Partial<Parameters<typeof createBackgroundController>[0]> = {}) {
  return {
    getActiveTab: async () => undefined,
    sendToTab: vi.fn(),
    loadProviderSettings: async () => settings,
    resolveProvider: () => undefined,
    ...overrides
  };
}

describe("background controller", () => {
  it("rejects a non-Liepin active tab before messaging content", async () => {
    // Break caught: removing the active-tab host guard would send extraction requests to other sites.
    const sendToTab = vi.fn();
    const controller = createBackgroundController(dependencies({
      getActiveTab: async () => ({ id: 7, url: "https://example.com" }),
      sendToTab
    }));

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PAGE" } });
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it.each([
    "https://www.liepin.com/",
    "https://www.liepin.com/zhaopin/",
    "https://www.liepin.com/company/123",
    "https://www.liepin.com/job/456",
    "https://www.liepin.com/candidate/",
    "https://www.liepin.com/candidate/search",
    "https://www.liepin.com/candidate/list",
    "https://www.liepin.com/candidate/fixture"
  ])("rejects non-detail Liepin page %s before messaging content", async (url) => {
    // Break caught: a host-only guard could scrape search, company, job, home,
    // or candidate-list content through the visible-body fallback.
    const sendToTab = vi.fn();
    const controller = createBackgroundController(dependencies({
      getActiveTab: async () => ({ id: 8, url }),
      sendToTab
    }));

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PAGE" } });
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("relays extraction only to the current Liepin tab", async () => {
    // Break caught: routing the request to a stale or arbitrary tab would expose the wrong candidate.
    const sendToTab = vi.fn().mockResolvedValue({ ok: true, data: candidateDraft });
    const controller = createBackgroundController(dependencies({
      getActiveTab: async () => ({ id: 9, url: "https://www.liepin.com/candidate/123456789" }),
      sendToTab
    }));

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toEqual({ ok: true, data: candidateDraft });
    expect(sendToTab).toHaveBeenCalledWith(9, { type: "EXTRACT_CURRENT_CANDIDATE" });
  });

  it.each([
    "https://www.liepin.com/candidate/123456789",
    "https://www.liepin.com/candidate/cv_8F4p0Lm2Q7x9/?from=reviewed-test"
  ])("relays extraction for reviewed candidate-detail route %s", async (url) => {
    // Break caught: an over-tight page guard could reject the reviewed detail
    // route when it carries a trailing slash or harmless query parameters.
    const sendToTab = vi.fn().mockResolvedValue({ ok: true, data: candidateDraft });
    const controller = createBackgroundController(dependencies({
      getActiveTab: async () => ({ id: 10, url }),
      sendToTab
    }));

    await expect(controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" }))
      .resolves.toEqual({ ok: true, data: candidateDraft });
    expect(sendToTab).toHaveBeenCalledWith(10, { type: "EXTRACT_CURRENT_CANDIDATE" });
  });

  it("treats an active tab without an accessible URL as unsupported", async () => {
    // Break caught: accepting an unknown tab URL could message an unsupported or privileged page.
    const sendToTab = vi.fn();
    const controller = createBackgroundController(dependencies({
      getActiveTab: async () => ({ id: 4 }),
      sendToTab
    }));

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PAGE" } });
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("validates the configured provider without returning key material", async () => {
    // Break caught: bypassing stored settings or echoing them would either validate the wrong key or expose it to the UI.
    const validateCredentials = vi.fn().mockResolvedValue(undefined);
    const provider: ModelProvider = {
      id: "deepseek",
      models: [
        { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }
      ],
      validateCredentials,
      analyze: vi.fn()
    };
    const controller = createBackgroundController(dependencies({
      loadProviderSettings: async () => settings,
      resolveProvider: (providerId) => providerId === "deepseek" ? provider : undefined
    }));

    const result = await controller.handle({ type: "VALIDATE_PROVIDER" });

    expect(validateCredentials).toHaveBeenCalledWith(settings);
    expect(result).toEqual({ ok: true, data: { valid: true } });
    expect(JSON.stringify(result)).not.toContain("sk-test");
  });

  it("maps provider validation failures to the standard runtime error", async () => {
    // Break caught: leaking a thrown provider error would violate the runtime response envelope.
    const provider: ModelProvider = {
      id: "deepseek",
      models: [
        { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
        { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }
      ],
      validateCredentials: vi.fn().mockRejectedValue(Object.assign(new Error("bad key"), {
        code: "INVALID_API_KEY"
      })),
      analyze: vi.fn()
    };
    const controller = createBackgroundController(dependencies({
      resolveProvider: () => provider
    }));

    const result = await controller.handle({ type: "VALIDATE_PROVIDER" });

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_API_KEY" } });
  });

  it("returns MISSING_API_KEY when no provider settings are stored", async () => {
    // Break caught: attempting provider resolution without settings would turn setup state into an UNKNOWN error.
    const resolveProvider = vi.fn();
    const controller = createBackgroundController(dependencies({
      loadProviderSettings: async () => undefined,
      resolveProvider
    }));

    const result = await controller.handle({ type: "VALIDATE_PROVIDER" });

    expect(result).toMatchObject({ ok: false, error: { code: "MISSING_API_KEY" } });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("maps a retired stored provider id to reconfiguration instead of an endless retry", async () => {
    // Break caught: stale provider settings could be labeled UNKNOWN even though retrying cannot change provider resolution.
    const controller = createBackgroundController(dependencies({
      loadProviderSettings: async () => ({
        ...settings,
        providerId: "retired-provider"
      }),
      resolveProvider: () => undefined
    }));

    const result = await controller.handle({ type: "VALIDATE_PROVIDER" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROVIDER_SETTINGS" }
    });
  });

  it("maps provider-settings load failures to STORAGE_FAILED during validation", async () => {
    // Break caught: a repository read failure could be mislabeled as a provider/network error and send the user down the wrong recovery path.
    const resolveProvider = vi.fn();
    const controller = createBackgroundController(dependencies({
      loadProviderSettings: async () => {
        throw new Error("storage unavailable");
      },
      resolveProvider
    }));

    const result = await controller.handle({ type: "VALIDATE_PROVIDER" });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORAGE_FAILED" }
    });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("orchestrates a provider-neutral second adapter without DeepSeek-specific error mapping", async () => {
    // Break caught: central orchestration must not require a DeepSeek import when another registered provider is selected.
    const fakeProvider: ModelProvider = {
      id: "internal-test-provider",
      models: [{ id: "balanced", label: "Balanced" }],
      validateCredentials: vi.fn().mockRejectedValue(new NormalizedProviderError("RATE_LIMITED")),
      analyze: vi.fn()
    };
    const controller = createBackgroundController(dependencies({
      loadProviderSettings: async () => ({
        providerId: "internal-test-provider",
        model: "balanced",
        apiKey: "test-key"
      }),
      resolveProvider: (providerId) => providerId === fakeProvider.id ? fakeProvider : undefined
    }));

    expect(await controller.handle({ type: "VALIDATE_PROVIDER" })).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" }
    });
  });

  it("aborts an in-flight analysis by request id", async () => {
    // Break caught: CANCEL_ANALYSIS must reach the provider's real AbortSignal rather than only changing UI state.
    let receivedSignal: AbortSignal | undefined;
    const provider: ModelProvider = {
      id: "internal-test-provider",
      models: [{ id: "balanced", label: "Balanced" }],
      validateCredentials: vi.fn(),
      analyze: vi.fn<ModelProvider["analyze"]>((_input, _settings, signal) => {
        receivedSignal = signal;
        return new Promise<ModelMatchResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(
            new NormalizedProviderError("ANALYSIS_CANCELLED")
          ));
        });
      })
    };
    const controller = createBackgroundController(dependencies({
      loadProviderSettings: async () => ({
        providerId: provider.id,
        model: "balanced",
        apiKey: "test-key"
      }),
      resolveProvider: () => provider
    }));
    const analysis = controller.handle({
      type: "ANALYZE_CANDIDATE",
      requestId: "analysis-123",
      job: {
        id: "job-1",
        company: "甲公司",
        jd: "必须本科",
        customRequirements: "企业软件经验",
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z"
      },
      candidateDraft,
      redactionContext: { identityTokens: [], identityDetection: "undetected" }
    });
    await vi.waitFor(() => expect(receivedSignal).toBeInstanceOf(AbortSignal));

    await expect(controller.handle({ type: "CANCEL_ANALYSIS", requestId: "analysis-123" }))
      .resolves.toEqual({ ok: true, data: { cancelled: true } });
    expect(receivedSignal?.aborted).toBe(true);
    await expect(analysis).resolves.toMatchObject({
      ok: false,
      error: { code: "ANALYSIS_CANCELLED" }
    });
  });

  it("cancels a request while provider settings are still loading", async () => {
    // Break caught: registering cancellation only after storage reads lets a cancelled request start the provider later.
    let releaseSettings!: () => void;
    const settingsPending = new Promise<typeof settings>((resolve) => {
      releaseSettings = () => resolve(settings);
    });
    const analyze = vi.fn<ModelProvider["analyze"]>();
    const provider: ModelProvider = {
      id: "deepseek",
      models: [{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }],
      validateCredentials: vi.fn(),
      analyze
    };
    const controller = createBackgroundController(dependencies({
      loadProviderSettings: () => settingsPending,
      resolveProvider: () => provider
    }));
    const analysis = controller.handle({
      type: "ANALYZE_CANDIDATE",
      requestId: "analysis-before-settings",
      job: {
        id: "job-1",
        company: "甲公司",
        jd: "必须本科",
        customRequirements: "企业软件经验",
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z"
      },
      candidateDraft,
      redactionContext: { identityTokens: [], identityDetection: "undetected" }
    });

    await expect(controller.handle({
      type: "CANCEL_ANALYSIS",
      requestId: "analysis-before-settings"
    })).resolves.toEqual({ ok: true, data: { cancelled: true } });
    releaseSettings();

    await expect(analysis).resolves.toMatchObject({
      ok: false,
      error: { code: "ANALYSIS_CANCELLED" }
    });
    expect(analyze).not.toHaveBeenCalled();
  });
});
