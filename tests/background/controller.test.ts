import { describe, expect, it, vi } from "vitest";
import { createBackgroundController } from "../../src/background/controller";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";

const candidateDraft: CandidateDraft = {
  basics: { text: "候选人甲", status: "complete" },
  workExperience: { text: "五年产品经验", status: "complete" },
  projects: { text: "", status: "missing" },
  education: { text: "本科", status: "complete" },
  skills: { text: "产品设计", status: "complete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "high"
};

describe("background controller", () => {
  it("rejects a non-Liepin active tab before messaging content", async () => {
    // Break caught: removing the active-tab host guard would send extraction requests to other sites.
    const sendToTab = vi.fn();
    const controller = createBackgroundController({
      getActiveTab: async () => ({ id: 7, url: "https://example.com" }),
      sendToTab
    });

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PAGE" } });
    expect(sendToTab).not.toHaveBeenCalled();
  });

  it("relays extraction only to the current Liepin tab", async () => {
    // Break caught: routing the request to a stale or arbitrary tab would expose the wrong candidate.
    const sendToTab = vi.fn().mockResolvedValue({ ok: true, data: candidateDraft });
    const controller = createBackgroundController({
      getActiveTab: async () => ({ id: 9, url: "https://www.liepin.com/candidate/x" }),
      sendToTab
    });

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toEqual({ ok: true, data: candidateDraft });
    expect(sendToTab).toHaveBeenCalledWith(9, { type: "EXTRACT_CURRENT_CANDIDATE" });
  });

  it("treats an active tab without an accessible URL as unsupported", async () => {
    // Break caught: accepting an unknown tab URL could message an unsupported or privileged page.
    const sendToTab = vi.fn();
    const controller = createBackgroundController({
      getActiveTab: async () => ({ id: 4 }),
      sendToTab
    });

    const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });

    expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PAGE" } });
    expect(sendToTab).not.toHaveBeenCalled();
  });
});
