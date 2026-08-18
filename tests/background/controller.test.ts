import { describe, expect, it, vi } from "vitest";
import { createBackgroundController } from "../../src/background/controller";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { ModelProvider } from "../../src/providers/model-provider";

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

  it("relays extraction only to the current Liepin tab", async () => {
    // Break caught: routing the request to a stale or arbitrary tab would expose the wrong candidate.
    const sendToTab = vi.fn().mockResolvedValue({ ok: true, data: candidateDraft });
    const controller = createBackgroundController(dependencies({
      getActiveTab: async () => ({ id: 9, url: "https://www.liepin.com/candidate/x" }),
      sendToTab
    }));

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toEqual({ ok: true, data: candidateDraft });
    expect(sendToTab).toHaveBeenCalledWith(9, { type: "EXTRACT_CURRENT_CANDIDATE" });
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
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
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
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
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
});
