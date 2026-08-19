import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/sidepanel/App";
import { JobSelector } from "../../src/sidepanel/components/JobSelector";
import type { SidePanelDependencies } from "../../src/sidepanel/app-dependencies";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { Job } from "../../src/shared/contracts/job";
import type { ProviderSettings } from "../../src/repositories/chrome-provider-settings";
import type {
  ModelRecruitmentProfile,
  ConfirmedRecruitmentProfile
} from "../../src/shared/contracts/recruitment-profile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings: ProviderSettings = {
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-saved"
};

const modelProfile: ModelRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品规划",
  requirements: [{
    id: "profile-requirement-1",
    text: "具备企业软件产品经验",
    priority: "hard",
    dimensionId: "functional_expertise",
    weight: 100,
    jobEvidence: ["岗位要求企业软件产品经验"]
  }],
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: []
};

const confirmedProfile: ConfirmedRecruitmentProfile = {
  ...modelProfile,
  confirmedAt: "2026-08-19T00:00:00.000Z"
};

const jobA: Job = {
  id: "job-a",
  company: "甲公司",
  jd: "负责企业招聘",
  customRequirements: "有 SaaS 经验",
  recruitmentProfile: confirmedProfile,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const jobB: Job = {
  ...jobA,
  id: "job-b",
  company: "乙公司",
  recruitmentProfile: {
    ...confirmedProfile,
    roleTitle: "数据平台产品经理"
  }
};

const candidateDraft: CandidateDraft = {
  basics: { text: "候选人", status: "complete" },
  workExperience: { text: "甲公司产品经理", status: "complete" },
  projects: { text: "", status: "missing" },
  education: { text: "本科", status: "complete" },
  skills: { text: "SaaS", status: "complete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "medium"
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
  const extractCurrentCandidate = vi.fn<SidePanelDependencies["extractCurrentCandidate"]>(
    async () => ({ ok: true as const, data: candidateDraft })
  );
  const generateJobProfile = vi.fn<SidePanelDependencies["generateJobProfile"]>(
    async () => ({ ok: true as const, data: modelProfile })
  );
  const confirmJobProfile = vi.fn<SidePanelDependencies["confirmJobProfile"]>(
    async (jobId, profile) => {
      const existing = jobs.find((job) => job.id === jobId)!;
      const updated: Job = {
        ...existing,
        recruitmentProfile: {
          ...profile,
          confirmedAt: "2026-08-19T00:00:00.000Z"
        },
        updatedAt: "2026-08-19T00:00:00.000Z"
      };
      jobs = [...jobs.filter((job) => job.id !== jobId), updated];
      activeJobId = jobId;
      return { ok: true as const, data: updated };
    }
  );

  return {
    providerSettings,
    jobs: jobRepository,
    validateProvider,
    extractCurrentCandidate,
    generateJobProfile,
    cancelJobProfile: vi.fn(async () => ({ ok: true as const, data: { cancelled: true } })),
    confirmJobProfile,
    analyzeCandidate: vi.fn(async () => ({
      ok: false as const,
      error: { code: "UNKNOWN" as const, message: "测试中未配置分析结果。" }
    })),
    cancelAnalysis: vi.fn(async () => ({ ok: true as const, data: { cancelled: true } })),
    subscribeToPageContextChanges: vi.fn(() => () => undefined)
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
    expect(screen.getByText(
      "所选模型用于岗位画像；候选人匹配固定使用 DeepSeek V4 Flash。"
    )).toBeTruthy();
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

  it("shows an adjacent unencrypted-storage warning only when remember-device is selected", async () => {
    // Break caught: users could persist a BYOK secret on a shared device without seeing the state-dependent risk.
    const deps = createFakeDependencies();
    const user = userEvent.setup();
    render(<App deps={deps} />);

    const rememberDevice = await screen.findByRole("checkbox", { name: "记住此设备" });
    expect(screen.queryByText(/本地保存未加密.*共享设备请勿使用/u)).toBeNull();

    await user.click(rememberDevice);

    const warning = screen.getByText(/本地保存未加密.*共享设备请勿使用/u);
    expect(warning.previousElementSibling?.textContent).toContain("记住此设备");
  });
});

describe("two-line job selector", () => {
  it("shows role before company and switches jobs with listbox keyboard controls", async () => {
    // Break caught: falling back to a native single-line company select would hide the role context.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <JobSelector
        jobs={[jobA, jobB]}
        activeJobId={jobA.id}
        onChange={onChange}
        onAdd={vi.fn()}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "当前岗位" });
    const roleTitle = within(trigger).getByText("企业软件产品经理");
    const company = within(trigger).getByText("甲公司");
    expect(roleTitle.compareDocumentPosition(company) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("option", { name: /企业软件产品经理.*甲公司/u })
      .getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: /数据平台产品经理.*乙公司/u })
      .getAttribute("aria-selected")).toBe("false");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(jobB.id);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes with Escape without switching and labels a legacy job conservatively", async () => {
    // Break caught: Escape must not activate a highlighted job, and missing profiles must not invent a title from JD text.
    const legacyJob: Job = { ...jobA, recruitmentProfile: undefined };
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <JobSelector
        jobs={[legacyJob, jobB]}
        activeJobId={legacyJob.id}
        onChange={onChange}
        onAdd={vi.fn()}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "当前岗位" });
    expect(within(trigger).getByText("待确认岗位")).toBeTruthy();
    expect(within(trigger).getByText("甲公司")).toBeTruthy();

    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes without switching when keyboard focus leaves the selector", async () => {
    // Break caught: tabbing onward must not leave a stale listbox covering the next side-panel control.
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <JobSelector
        jobs={[jobA, jobB]}
        activeJobId={jobA.id}
        onChange={onChange}
        onAdd={vi.fn()}
      />
    );

    const trigger = screen.getByRole("combobox", { name: "当前岗位" });
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();

    await user.tab();

    expect(screen.getByRole("button", { name: "添加新岗位" })).toBe(document.activeElement);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the keyboard-highlighted option visible in a long job list", async () => {
    // Break caught: aria-activedescendant can move beyond the scroll window while Enter still selects the hidden option.
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });

    try {
      const jobs = Array.from({ length: 6 }, (_, index): Job => ({
        ...jobA,
        id: `job-long-${index + 1}`,
        company: `公司 ${index + 1}`,
        recruitmentProfile: {
          ...confirmedProfile,
          roleTitle: `岗位 ${index + 1}`
        }
      }));
      const user = userEvent.setup();
      render(
        <JobSelector
          jobs={jobs}
          activeJobId={jobs[0].id}
          onChange={vi.fn()}
          onAdd={vi.fn()}
        />
      );

      const trigger = screen.getByRole("combobox", { name: "当前岗位" });
      await user.click(trigger);
      await user.keyboard("{End}");

      const lastOption = screen.getByRole("option", { name: /岗位 6.*公司 6/u });
      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
        expect(scrollIntoView.mock.instances.at(-1)).toBe(lastOption);
      });
      expect(trigger.getAttribute("aria-activedescendant")).toBe(lastOption.id);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });
});

describe("side-panel jobs", () => {
  it("requires company, JD, and custom requirements", async () => {
    // Break caught: accepting any blank field would create a job that cannot drive a complete analysis.
    const deps = createFakeDependencies({ settings });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "分析岗位要求" }));

    expect(screen.getByText("请输入公司名称")).toBeTruthy();
    expect(screen.getByText("请输入职位 JD")).toBeTruthy();
    expect(screen.getByText("请输入个性化要求")).toBeTruthy();
    expect(deps.jobs.saveAndActivate).not.toHaveBeenCalled();
  });

  it("keeps two saved jobs selectable and switches the active job directly", async () => {
    // Break caught: replacing the job list or failing to activate a selection would analyze against stale context.
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("job-created-a")
      .mockReturnValueOnce("profile-created-a")
      .mockReturnValueOnce("job-created-b")
      .mockReturnValueOnce("profile-created-b") });
    const deps = createFakeDependencies({ settings });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.type(await screen.findByLabelText("公司名称"), "甲公司");
    await user.type(screen.getByLabelText("职位 JD"), "负责招聘系统");
    await user.type(screen.getByLabelText("个性化要求"), "熟悉 SaaS");
    await user.click(screen.getByRole("button", { name: "分析岗位要求" }));

    expect(await screen.findByRole("heading", { name: "确认招聘关键要求" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));
    expect(await screen.findByText("岗位画像已确认，可以开始浏览候选人")).toBeTruthy();
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "添加新岗位" }));
    expect((screen.getByLabelText("公司名称") as HTMLInputElement).value).toBe("");

    await user.type(screen.getByLabelText("公司名称"), "乙公司");
    await user.type(screen.getByLabelText("职位 JD"), "负责数据平台");
    await user.type(screen.getByLabelText("个性化要求"), "熟悉 AI");
    await user.click(screen.getByRole("button", { name: "分析岗位要求" }));
    await user.click(await screen.findByRole("button", { name: "确认岗位画像" }));

    const selector = await screen.findByRole("combobox", { name: "当前岗位" });
    expect(within(selector).getByText("乙公司")).toBeTruthy();
    await user.click(selector);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "企业软件产品经理甲公司",
      "企业软件产品经理乙公司✓"
    ]);
    expect(screen.getByRole("option", { name: /乙公司/u }).getAttribute("aria-selected")).toBe("true");
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("option", { name: /甲公司/u }));

    await waitFor(() => {
      expect(deps.jobs.activate).toHaveBeenCalledWith("job-created-a");
      expect(within(selector).getByText("甲公司")).toBeTruthy();
    });
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();
  });

  it("generates a review draft after saving and persists only after one confirmation", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn()
      .mockReturnValueOnce("new-job")
      .mockReturnValueOnce("profile-request") });
    const deps = createFakeDependencies({ settings });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.type(await screen.findByLabelText("公司名称"), "虚构甲公司");
    await user.type(screen.getByLabelText("职位 JD"), "负责虚构企业软件产品");
    await user.type(screen.getByLabelText("个性化要求"), "重视复杂业务理解");
    await user.click(screen.getByRole("button", { name: "分析岗位要求" }));

    expect(await screen.findByRole("heading", { name: "确认招聘关键要求" })).toBeTruthy();
    expect(deps.generateJobProfile).toHaveBeenCalledTimes(1);
    expect(deps.confirmJobProfile).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认岗位画像" }));

    await waitFor(() => expect(deps.confirmJobProfile).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("岗位画像已确认，可以开始浏览候选人")).toBeTruthy();
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();
  });

  it("requires profile generation for a legacy saved job before candidate analysis", async () => {
    const legacyJob: Job = { ...jobA, recruitmentProfile: undefined };
    const deps = createFakeDependencies({
      settings,
      jobs: [legacyJob],
      activeJobId: legacyJob.id
    });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    expect(await screen.findByRole("heading", { name: "需要生成岗位画像" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "匹配分析" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "分析岗位要求" }));
    expect(deps.generateJobProfile).toHaveBeenCalledTimes(1);
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();
  });

  it("keeps the confirmed profile usable when an explicit reanalysis fails", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "replacement-profile-request") });
    const deps = createFakeDependencies({
      settings,
      jobs: [jobA],
      activeJobId: jobA.id
    });
    deps.generateJobProfile.mockResolvedValueOnce({
      ok: false,
      error: { code: "NETWORK_FAILED", message: "无法连接模型服务，请重试。" }
    });
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "重新分析岗位" }));

    expect(await screen.findByRole("heading", { name: "本次岗位分析未完成" })).toBeTruthy();
    expect(deps.confirmJobProfile).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "继续使用当前画像" }));
    expect(await screen.findByText("岗位画像已确认，可以开始浏览候选人")).toBeTruthy();
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

    await user.click(selector);
    await user.click(screen.getByRole("option", { name: /数据平台产品经理.*乙公司/u }));
    await waitFor(() => expect(deps.jobs.activate).toHaveBeenCalledWith(jobB.id));
    expect(deps.extractCurrentCandidate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "匹配分析" }));
    expect(deps.extractCurrentCandidate).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous job and shows a Chinese error when switching rejects", async () => {
    // Break caught: an unhandled repository rejection could leave the selector misleading or crash the UI flow.
    const deps = createFakeDependencies({
      settings,
      jobs: [jobA, jobB],
      activeJobId: jobA.id
    });
    deps.jobs.activate.mockRejectedValueOnce(new Error("storage unavailable"));
    const user = userEvent.setup();
    render(<App deps={deps} />);

    const selector = await screen.findByRole("combobox", { name: "当前岗位" });
    await user.click(selector);
    await user.click(screen.getByRole("option", { name: /数据平台产品经理.*乙公司/u }));

    expect(await screen.findByText("岗位切换失败，请重试。")).toBeTruthy();
    expect(within(selector).getByText("甲公司")).toBeTruthy();
    const readyCard = screen.getByRole("heading", {
      name: "岗位画像已确认，可以开始浏览候选人"
    }).closest("section")!;
    expect(within(readyCard).getByText("企业软件产品经理")).toBeTruthy();
    expect(within(readyCard).getByText("甲公司")).toBeTruthy();
  });

  it("shows a Chinese retry message when candidate extraction rejects", async () => {
    // Break caught: a rejected runtime message must become actionable UI feedback, not an unhandled promise.
    const deps = createFakeDependencies({
      settings,
      jobs: [jobA],
      activeJobId: jobA.id
    });
    deps.extractCurrentCandidate.mockRejectedValueOnce(new Error("service worker unavailable"));
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));

    expect(await screen.findByText("候选人信息读取失败，请重试。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "匹配分析" })).toBeTruthy();
  });
});
