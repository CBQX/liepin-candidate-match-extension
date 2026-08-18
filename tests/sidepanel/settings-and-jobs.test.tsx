import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/sidepanel/App";
import type { SidePanelDependencies } from "../../src/sidepanel/app-dependencies";
import type { Job } from "../../src/shared/contracts/job";
import type { ProviderSettings } from "../../src/repositories/chrome-provider-settings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings: ProviderSettings = {
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-saved"
};

const jobA: Job = {
  id: "job-a",
  company: "甲公司",
  jd: "负责企业招聘",
  customRequirements: "有 SaaS 经验",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const jobB: Job = {
  ...jobA,
  id: "job-b",
  company: "乙公司"
};

function createFakeDependencies(initial: {
  settings?: ProviderSettings;
  jobs?: Job[];
  activeJobId?: string;
} = {}) {
  let savedSettings = initial.settings;
  let jobs = [...(initial.jobs ?? [])];
  let activeJobId = initial.activeJobId;

  const providerSettings = {
    load: vi.fn(async () => savedSettings),
    save: vi.fn(async (next: ProviderSettings, _rememberDevice: boolean) => {
      savedSettings = next;
    }),
    clear: vi.fn(async () => {
      savedSettings = undefined;
    })
  };
  const jobRepository = {
    list: vi.fn(async () => [...jobs]),
    getActive: vi.fn(async () => jobs.find((job) => job.id === activeJobId)),
    saveAndActivate: vi.fn(async (job: Job) => {
      jobs = [...jobs.filter((savedJob) => savedJob.id !== job.id), job];
      activeJobId = job.id;
    }),
    activate: vi.fn(async (id: string) => {
      if (jobs.some((job) => job.id === id)) activeJobId = id;
    })
  };
  const validateProvider = vi.fn(async () => ({
    ok: true as const,
    data: { valid: true as const }
  }));
  const extractCurrentCandidate = vi.fn(async () => ({
    ok: true as const,
    data: {}
  }));

  return {
    providerSettings,
    jobs: jobRepository,
    validateProvider,
    extractCurrentCandidate
  } satisfies SidePanelDependencies;
}

describe("side-panel model settings", () => {
  it("shows supported models, masks the key, and remembers only when selected", async () => {
    // Break caught: a wrong default or control type could expose the key or persist it beyond the session.
    const deps = createFakeDependencies();
    const user = userEvent.setup();
    render(<App deps={deps} />);

    const keyInput = await screen.findByLabelText("DeepSeek API Key");
    const modelSelect = screen.getByLabelText("模型") as HTMLSelectElement;
    const rememberDevice = screen.getByRole("checkbox", { name: "记住此设备" }) as HTMLInputElement;

    expect((keyInput as HTMLInputElement).type).toBe("password");
    expect([...modelSelect.options].map((option) => option.text)).toEqual([
      "DeepSeek V4 Pro",
      "DeepSeek V4 Flash"
    ]);
    expect(rememberDevice.checked).toBe(false);

    await user.type(keyInput, "sk-test");
    await user.click(screen.getByRole("button", { name: "验证并保存" }));

    await waitFor(() => {
      expect(deps.validateProvider).toHaveBeenCalledTimes(1);
      expect(deps.providerSettings.save).toHaveBeenCalledWith({
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        apiKey: "sk-test"
      }, false);
    });
  });

  it("shows a Chinese field error and does not validate a blank key", async () => {
    // Break caught: removing client-side key validation would send an unusable provider configuration.
    const deps = createFakeDependencies();
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "验证并保存" }));

    expect(screen.getByText("请输入 DeepSeek API Key")).toBeTruthy();
    expect(deps.providerSettings.save).not.toHaveBeenCalled();
    expect(deps.validateProvider).not.toHaveBeenCalled();
  });
});

describe("side-panel jobs", () => {
  it("requires company, JD, and custom requirements", async () => {
    // Break caught: accepting any blank field would create a job that cannot drive a complete analysis.
    const deps = createFakeDependencies({ settings });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "保存岗位" }));

    expect(screen.getByText("请输入公司名称")).toBeTruthy();
    expect(screen.getByText("请输入职位 JD")).toBeTruthy();
    expect(screen.getByText("请输入个性化要求")).toBeTruthy();
    expect(deps.jobs.saveAndActivate).not.toHaveBeenCalled();
  });

  it("keeps two saved jobs selectable and switches the active job directly", async () => {
    // Break caught: replacing the job list or failing to activate a selection would analyze against stale context.
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("job-created-a")
      .mockReturnValueOnce("job-created-b") });
    const deps = createFakeDependencies({ settings });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.type(await screen.findByLabelText("公司名称"), "甲公司");
    await user.type(screen.getByLabelText("职位 JD"), "负责招聘系统");
    await user.type(screen.getByLabelText("个性化要求"), "熟悉 SaaS");
    await user.click(screen.getByRole("button", { name: "保存岗位" }));

    expect(await screen.findByText("岗位已就绪，可以开始浏览候选人")).toBeTruthy();
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "添加新岗位" }));
    expect((screen.getByLabelText("公司名称") as HTMLInputElement).value).toBe("");

    await user.type(screen.getByLabelText("公司名称"), "乙公司");
    await user.type(screen.getByLabelText("职位 JD"), "负责数据平台");
    await user.type(screen.getByLabelText("个性化要求"), "熟悉 AI");
    await user.click(screen.getByRole("button", { name: "保存岗位" }));

    const selector = await screen.findByRole("combobox", { name: "当前岗位" }) as HTMLSelectElement;
    expect([...selector.options].map((option) => option.text)).toEqual(["甲公司", "乙公司"]);
    expect(selector.value).toBe("job-created-b");
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();

    await user.selectOptions(selector, "job-created-a");

    await waitFor(() => {
      expect(deps.jobs.activate).toHaveBeenCalledWith("job-created-a");
      expect(selector.value).toBe("job-created-a");
    });
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();
  });

  it("extracts only after the explicit match-analysis action", async () => {
    // Break caught: wiring extraction to mount, job load, or switching would scrape without user intent.
    const deps = createFakeDependencies({
      settings,
      jobs: [jobA, jobB],
      activeJobId: jobA.id
    });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    const selector = await screen.findByRole("combobox", { name: "当前岗位" });
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();

    await user.selectOptions(selector, jobB.id);
    await waitFor(() => expect(deps.jobs.activate).toHaveBeenCalledWith(jobB.id));
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "匹配分析" }));
    expect(deps.extractCurrentCandidate).toHaveBeenCalledTimes(1);
  });
});
