import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/sidepanel/App";
import type { SidePanelDependencies } from "../../src/sidepanel/app-dependencies";
import { CandidatePreview } from "../../src/sidepanel/components/CandidatePreview";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { Job } from "../../src/shared/contracts/job";

afterEach(() => cleanup());

const jobA: Job = {
  id: "job-a",
  company: "甲公司",
  jd: "负责企业招聘",
  customRequirements: "有 SaaS 经验",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const jobB: Job = { ...jobA, id: "job-b", company: "乙公司" };

const extractedDraft: CandidateDraft = {
  basics: { text: "张三，手机 13812345678，上海", status: "complete" },
  workExperience: { text: "甲公司产品经理", status: "complete" },
  projects: { text: "招聘系统", status: "possibly_incomplete" },
  education: { text: "本科", status: "complete" },
  skills: { text: "SaaS", status: "possibly_incomplete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "medium"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createDependencies() {
  let activeJob = jobA;
  let pageContextListener: (() => void) | undefined;
  const extractCurrentCandidate = vi.fn<SidePanelDependencies["extractCurrentCandidate"]>(
    async () => ({ ok: true as const, data: extractedDraft })
  );

  return {
    providerSettings: {
      load: vi.fn(async () => ({
        providerId: "deepseek" as const,
        model: "deepseek-v4-pro" as const,
        apiKey: "sk-test"
      })),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    },
    jobs: {
      list: vi.fn(async () => [jobA, jobB]),
      getActive: vi.fn(async () => activeJob),
      saveAndActivate: vi.fn(async (job: Job) => {
        activeJob = job;
      }),
      activate: vi.fn(async (id: string) => {
        activeJob = id === jobB.id ? jobB : jobA;
      })
    },
    validateProvider: vi.fn(async () => ({ ok: true as const, data: { valid: true as const } })),
    extractCurrentCandidate,
    analyzeCandidate: vi.fn(async () => ({
      ok: false as const,
      error: { code: "UNKNOWN" as const, message: "测试中未配置分析结果。" }
    })),
    subscribeToPageContextChanges: vi.fn((listener: () => void) => {
      pageContextListener = listener;
      return () => {
        pageContextListener = undefined;
      };
    }),
    emitPageContextChanged() {
      pageContextListener?.();
    }
  } satisfies SidePanelDependencies & { emitPageContextChanged(): void };
}

describe("candidate preview", () => {
  it("shows extraction statuses, keeps missing neutral, and makes every section editable", async () => {
    // Break caught: incomplete extraction could be hidden, treated as a mismatch, or made impossible for the recruiter to correct.
    const onChange = vi.fn();
    render(<CandidatePreview draft={extractedDraft} onChange={onChange} onConfirm={vi.fn()} />);

    expect(screen.getAllByText("已提取").length).toBe(3);
    expect(screen.getAllByText("可能不完整").length).toBe(2);
    expect(screen.getByText("未找到，可手动补充")).toBeTruthy();
    expect(screen.queryByText(/不匹配/)).toBeNull();

    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(textareas).toHaveLength(6);
    expect(textareas.every((textarea) => !textarea.disabled && !textarea.readOnly)).toBe(true);

    fireEvent.change(screen.getByLabelText("技能"), { target: { value: "AI 产品" } });
    expect(onChange).toHaveBeenLastCalledWith("skills", "AI 产品");
  });

  it("places the DeepSeek disclosure immediately above confirmation", () => {
    // Break caught: candidate data could be submitted without the required adjacent third-party disclosure.
    render(<CandidatePreview draft={extractedDraft} onChange={vi.fn()} onConfirm={vi.fn()} />);

    const confirm = screen.getByRole("button", { name: "确认并分析" });
    expect(confirm.previousElementSibling?.textContent).toBe(
      "确认后，以下脱敏内容将发送至 DeepSeek 进行本次分析"
    );
  });

  it("redacts extraction before preview and clears it on job, page, and session boundaries", async () => {
    // Break caught: raw identifiers or stale profiles could remain visible after moving to a different context.
    const deps = createDependencies();
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));
    expect(await screen.findByRole("button", { name: "确认并分析" })).toBeTruthy();
    expect((screen.getByLabelText("基本信息") as HTMLTextAreaElement).value).not.toContain("张三");
    expect((screen.getByLabelText("基本信息") as HTMLTextAreaElement).value).not.toContain("13812345678");

    await user.selectOptions(screen.getByRole("combobox", { name: "当前岗位" }), jobB.id);
    await waitFor(() => expect(deps.jobs.activate).toHaveBeenCalledWith(jobB.id));
    expect(screen.queryByRole("button", { name: "确认并分析" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "匹配分析" }));
    expect(await screen.findByRole("button", { name: "确认并分析" })).toBeTruthy();
    deps.emitPageContextChanged();
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认并分析" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "匹配分析" }));
    expect(await screen.findByRole("button", { name: "确认并分析" })).toBeTruthy();
    fireEvent(window, new Event("beforeunload"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "确认并分析" })).toBeNull());
  });

  it("shows an unsupported-page action and retries extraction only when clicked", async () => {
    // Break caught: an unsupported page could silently fail or retry extraction without another explicit user action.
    const deps = createDependencies();
    deps.extractCurrentCandidate
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: "UNSUPPORTED_PAGE" as const, message: "请打开单个猎聘候选人详情页。" }
      })
      .mockResolvedValueOnce({ ok: true as const, data: extractedDraft });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));
    expect(await screen.findByText("当前页面无法分析")).toBeTruthy();
    expect(screen.getByText("请打开单个猎聘候选人详情页。")).toBeTruthy();
    expect(deps.extractCurrentCandidate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "匹配分析" }));
    expect(await screen.findByRole("button", { name: "确认并分析" })).toBeTruthy();
    expect(deps.extractCurrentCandidate).toHaveBeenCalledTimes(2);
  });

  it.each(["job", "page", "session"] as const)(
    "ignores an old extraction response after a %s boundary",
    async (boundary) => {
      // Break caught: a delayed content-script response could repopulate private state after its job/page/session was abandoned.
      const deps = createDependencies();
      const pending = deferred<Awaited<ReturnType<SidePanelDependencies["extractCurrentCandidate"]>>>();
      deps.extractCurrentCandidate.mockImplementationOnce(() => pending.promise);
      const user = userEvent.setup();
      render(<App deps={deps} />);

      await user.click(await screen.findByRole("button", { name: "匹配分析" }));
      await waitFor(() => expect(deps.extractCurrentCandidate).toHaveBeenCalledTimes(1));

      if (boundary === "job") {
        await user.selectOptions(screen.getByRole("combobox", { name: "当前岗位" }), jobB.id);
        await waitFor(() => expect(deps.jobs.activate).toHaveBeenCalledWith(jobB.id));
      } else if (boundary === "page") {
        deps.emitPageContextChanged();
      } else {
        fireEvent(window, new Event("beforeunload"));
      }

      await act(async () => {
        pending.resolve({ ok: true, data: extractedDraft });
        await pending.promise;
      });

      expect(screen.queryByRole("button", { name: "确认并分析" })).toBeNull();
    }
  );

  it("keeps the newest extraction when concurrent retry responses finish out of order", async () => {
    // Break caught: a slower prior request could overwrite the candidate selected by a newer explicit retry.
    const deps = createDependencies();
    const older = deferred<Awaited<ReturnType<SidePanelDependencies["extractCurrentCandidate"]>>>();
    const newer = deferred<Awaited<ReturnType<SidePanelDependencies["extractCurrentCandidate"]>>>();
    const newerDraft: CandidateDraft = {
      ...extractedDraft,
      workExperience: { text: "乙公司数据平台主管", status: "complete" }
    };
    deps.extractCurrentCandidate
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "UNSUPPORTED_PAGE", message: "请打开单个猎聘候选人详情页。" }
      })
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));
    const retry = await screen.findByRole("button", { name: "匹配分析" });
    await act(async () => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(deps.extractCurrentCandidate).toHaveBeenCalledTimes(3);

    await act(async () => {
      newer.resolve({ ok: true, data: newerDraft });
      await newer.promise;
    });
    expect((await screen.findByLabelText("工作经历") as HTMLTextAreaElement).value)
      .toContain("乙公司数据平台主管");

    await act(async () => {
      older.resolve({ ok: true, data: extractedDraft });
      await older.promise;
    });
    expect((screen.getByLabelText("工作经历") as HTMLTextAreaElement).value)
      .toContain("乙公司数据平台主管");
  });
});
