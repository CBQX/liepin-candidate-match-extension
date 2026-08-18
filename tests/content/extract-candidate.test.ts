import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractCandidate } from "../../src/content/extract-candidate";
import { extractVisibleText } from "../../src/content/extract-visible-text";

const fixture = (name: string) =>
  readFile(resolve(process.cwd(), "tests/content/fixtures", name), "utf8");

const liepinUrl = new URL("https://www.liepin.com/candidate/fixture");

describe("Liepin candidate extraction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("extracts visible work and education sections by semantic headings", async () => {
    document.body.innerHTML = await fixture("complete-profile.html");

    const draft = extractCandidate(document, liepinUrl);

    expect(draft.workExperience).toEqual({
      status: "complete",
      text: "2021 年至今，担任企业软件产品经理，负责需求分析与产品交付。"
    });
    expect(draft.education.status).toBe("complete");
    expect(draft.skills.text).toContain("需求分析");
    expect(draft.workExperience.text).not.toContain("隐藏");
    expect(draft.workExperience.text).not.toContain("项目经历");
    expect(draft.extractionConfidence).toBe("high");
  });

  it("marks missing education as missing instead of inventing a mismatch", async () => {
    document.body.innerHTML = await fixture("missing-education.html");

    const draft = extractCandidate(document, liepinUrl);

    expect(draft.education).toEqual({ text: "", status: "missing" });
    expect(draft.extractionConfidence).toBe("high");
  });

  it("returns visible body text as an editable low-confidence fallback", async () => {
    document.body.innerHTML = await fixture("unstructured-profile.html");

    const draft = extractCandidate(document, liepinUrl);

    expect(draft.other.status).toBe("possibly_incomplete");
    expect(draft.other.text).toContain("没有标准标题");
    expect(draft.other.text).not.toContain("不可见的备注");
    expect(draft.extractionConfidence).toBe("low");
  });

  it("rejects hosts that merely end with the Liepin brand text", () => {
    document.body.innerHTML = "<h2>工作经历</h2><p>虚构内容</p>";

    expect(() =>
      extractCandidate(document, new URL("https://notliepin.com/candidate/fixture"))
    ).toThrow("仅支持猎聘候选人页面");
  });

  it.each([
    "https://www.liepin.com/",
    "https://www.liepin.com/zhaopin/",
    "https://www.liepin.com/company/123",
    "https://www.liepin.com/job/456",
    "https://www.liepin.com/candidate/"
  ])("rejects non-detail Liepin page %s without visible-body fallback", (url) => {
    // Break caught: accepting any Liepin host would turn search/list/home/company
    // or job-page body text into a candidate draft.
    document.body.innerHTML = "<main>非候选人页面的可见列表内容</main>";

    expect(() => extractCandidate(document, new URL(url)))
      .toThrow("仅支持猎聘候选人页面");
  });

  it.each([
    "https://www.liepin.com/candidate/fixture",
    "https://www.liepin.com/candidate/fixture/?from=reviewed-test"
  ])("supports reviewed candidate-detail route %s", async (url) => {
    // Break caught: the shared eligibility predicate could reject the already
    // reviewed fixture route after centralization.
    document.body.innerHTML = await fixture("unstructured-profile.html");

    expect(extractCandidate(document, new URL(url)).other.text)
      .toContain("没有标准标题");
  });
});

describe("visible text extraction", () => {
  it("omits hidden descendants and collapses repeated whitespace", () => {
    document.body.innerHTML = `
      <div>
        可见  内容
        <span hidden>属性隐藏</span>
        <span aria-hidden="true">辅助隐藏</span>
        <span style="visibility: hidden">样式隐藏</span>
        <span style="display: none">布局隐藏</span>
        <span>仍然可见</span>
      </div>`;

    expect(extractVisibleText(document.body)).toBe("可见 内容 仍然可见");
  });
});

describe("content-script responder", () => {
  it("ignores unrelated messages and asynchronously returns the standard response", async () => {
    document.body.innerHTML = "<h2>工作经历</h2><p>2024 年至今，负责虚构产品的需求分析与交付。</p>";
    type ContentListener = (
      request: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean | undefined;
    const listeners: ContentListener[] = [];
    const addListener = vi.fn((listener: ContentListener) => listeners.push(listener));
    vi.stubGlobal("chrome", { runtime: { onMessage: { addListener } } });
    vi.stubGlobal("location", new URL("https://www.liepin.com/candidate/fixture"));
    vi.resetModules();

    await import("../../src/content/index");

    expect(addListener).toHaveBeenCalledOnce();
    const listener = listeners[0]!;
    const sender = {} as chrome.runtime.MessageSender;
    expect(listener({ type: "VALIDATE_PROVIDER" }, sender, vi.fn())).toBeUndefined();

    const response = new Promise<unknown>((resolve) => {
      expect(listener(
        { type: "EXTRACT_CURRENT_CANDIDATE" },
        sender,
        (value) => resolve(value)
      )).toBe(true);
    });
    await expect(response).resolves.toMatchObject({
      ok: true,
      data: { workExperience: { status: "complete" } }
    });

    vi.unstubAllGlobals();
  });
});
