import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/sidepanel/App";
import type { SidePanelDependencies } from "../../src/sidepanel/app-dependencies";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { Job } from "../../src/shared/contracts/job";
import type { MatchAnalysis } from "../../src/shared/contracts/matching";
import type { AppError } from "../../src/shared/errors";

afterEach(() => cleanup());

const job: Job = {
  id: "job-a",
  company: "甲公司",
  jd: "负责企业招聘",
  customRequirements: "必须本科",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const candidateDraft: CandidateDraft = {
  basics: { text: "姓名：张三，上海", status: "complete" },
  workExperience: { text: "甲公司产品经理", status: "complete" },
  projects: { text: "招聘系统", status: "possibly_incomplete" },
  education: { text: "本科", status: "complete" },
  skills: { text: "SaaS", status: "complete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "medium"
};

const result: MatchAnalysis = {
  overallScore: 80,
  recommendation: "recommend",
  confidence: "medium",
  dimensionScores: [
    { dimensionId: "hard_requirements", score: 80, evidence: ["本科"] },
    { dimensionId: "functional_expertise", score: 80, evidence: ["产品经验"] },
    { dimensionId: "industry_business", score: 80, evidence: ["企业背景"] },
    { dimensionId: "seniority_impact", score: 80, evidence: ["项目影响"] },
    { dimensionId: "trajectory_stability", score: 80, evidence: ["经历连续"] },
    { dimensionId: "recruiter_feasibility", score: 80, evidence: ["可推进"] }
  ],
  hardRequirements: [{ criterionId: "custom-1", status: "met", evidence: ["本科"] }],
  matches: [],
  mismatches: [],
  risks: [],
  missingInformation: [],
  verificationQuestions: ["核实求职意愿"],
  outreachAdvice: ["从产品经验切入"],
  recruiterConclusion: "建议推进"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

type Analyze = SidePanelDependencies["analyzeCandidate"];

function createDependencies(analyzeCandidate: Analyze) {
  let pageContextListener: (() => void) | undefined;
  const dependencies = {
    providerSettings: {
      load: vi.fn(async () => ({
        providerId: "deepseek",
        model: "deepseek-v4-pro",
        apiKey: "sk-test"
      })),
      save: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined)
    },
    jobs: {
      list: vi.fn(async () => [job]),
      getActive: vi.fn(async () => job),
      saveAndActivate: vi.fn(async () => undefined),
      activate: vi.fn(async () => undefined)
    },
    validateProvider: vi.fn(async () => ({ ok: true as const, data: { valid: true as const } })),
    extractCurrentCandidate: vi.fn(async () => ({ ok: true as const, data: candidateDraft })),
    analyzeCandidate: vi.fn<Analyze>(analyzeCandidate),
    subscribeToPageContextChanges: vi.fn((listener: () => void) => {
      pageContextListener = listener;
      return () => {
        pageContextListener = undefined;
      };
    })
  } satisfies SidePanelDependencies;
  return {
    ...dependencies,
    emitPageContextChanged() {
      pageContextListener?.();
    }
  };
}

describe("analysis workflow", () => {
  it("starts only after confirmation and retries a timeout with the same edited preview", async () => {
    // Break caught: analysis could run before consent, discard recruiter edits after a recoverable error, or retry stale extraction data.
    const first = deferred<Awaited<ReturnType<Analyze>>>();
    const second = deferred<Awaited<ReturnType<Analyze>>>();
    const deps = createDependencies(vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise));
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));
    const skills = await screen.findByLabelText("技能");
    fireEvent.change(skills, { target: { value: "已编辑：SaaS 与 AI" } });

    expect(deps.analyzeCandidate).not.toHaveBeenCalled();
    expect(screen.queryByText("正在生成匹配分析…")).toBeNull();

    await user.click(screen.getByRole("button", { name: "确认并分析" }));
    expect(await screen.findByText("正在生成匹配分析…")).toBeTruthy();
    expect(deps.analyzeCandidate).toHaveBeenCalledTimes(1);
    expect(deps.analyzeCandidate.mock.calls[0]?.[0]).toEqual(job);
    expect(deps.analyzeCandidate.mock.calls[0]?.[1].skills.text).toBe("已编辑：SaaS 与 AI");

    await act(async () => {
      first.resolve({
        ok: false,
        error: { code: "MODEL_TIMEOUT", message: "DeepSeek 响应超时，请重试。" }
      });
      await first.promise;
    });

    expect(await screen.findByText("DeepSeek 响应超时，请重试。")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重试分析" }));
    expect(deps.analyzeCandidate).toHaveBeenCalledTimes(2);
    expect(deps.analyzeCandidate.mock.calls[1]?.[1].skills.text).toBe("已编辑：SaaS 与 AI");

    await act(async () => {
      second.resolve({ ok: true, data: result });
      await second.promise;
    });

    expect(await screen.findByText("猎头结论")).toBeTruthy();
    expect(screen.getAllByText("建议推进").length).toBeGreaterThan(0);
  });

  it.each([
    ["RATE_LIMITED", "请求过于频繁"],
    ["INSUFFICIENT_BALANCE", "账户余额不足"],
    ["INVALID_MODEL_OUTPUT", "模型返回内容无法验证"]
  ])("offers one retry action for recoverable %s failures", async (code, message) => {
    // Break caught: a recoverable provider failure could discard the draft or present no clear retry path.
    const deps = createDependencies(async () => ({
      ok: false,
      error: { code: code as AppError["code"], message }
    }));
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));
    await user.click(await screen.findByRole("button", { name: "确认并分析" }));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "重试分析" })).toHaveLength(1);
  });

  it.each([
    ["MISSING_API_KEY", "请先配置 DeepSeek API Key。"],
    ["INVALID_API_KEY", "DeepSeek API Key 无效，请检查后重试。"],
    ["INVALID_PROVIDER_SETTINGS", "模型供应商或模型配置已失效，请重新配置。"]
  ] as const)(
    "offers model reconfiguration for %s without retrying automatically",
    async (code, message) => {
      // Break caught: credential failures could loop the same bad request instead of returning the recruiter to model setup.
      const deps = createDependencies(async () => ({
        ok: false,
        error: { code: code as AppError["code"], message }
      }));
      const user = userEvent.setup();
      render(<App deps={deps} />);

      await user.click(await screen.findByRole("button", { name: "匹配分析" }));
      await user.click(await screen.findByRole("button", { name: "确认并分析" }));
      await user.click(await screen.findByRole("button", { name: "重新配置模型" }));

      expect(await screen.findByLabelText("DeepSeek API Key")).toBeTruthy();
      await waitFor(() => expect(deps.analyzeCandidate).toHaveBeenCalledTimes(1));
    }
  );

  it("discards a deferred analysis result after a page-context change", async () => {
    // Break caught: a late model response could repopulate a candidate/result after URL navigation cleared the session.
    const pending = deferred<Awaited<ReturnType<Analyze>>>();
    const deps = createDependencies(() => pending.promise);
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));
    await user.click(await screen.findByRole("button", { name: "确认并分析" }));
    expect(await screen.findByText("正在生成匹配分析…")).toBeTruthy();

    act(() => deps.emitPageContextChanged());
    expect(await screen.findByRole("button", { name: "匹配分析" })).toBeTruthy();

    await act(async () => {
      pending.resolve({ ok: true, data: result });
      await pending.promise;
    });

    expect(screen.queryByText("猎头结论")).toBeNull();
    expect(screen.getByRole("button", { name: "匹配分析" })).toBeTruthy();
  });

  it("cancels a running analysis, returns to the edited preview, and ignores the late result", async () => {
    // Break caught: cancellation could discard recruiter edits or allow a late provider response to overwrite the restored preview.
    const pending = deferred<Awaited<ReturnType<Analyze>>>();
    const deps = createDependencies(() => pending.promise);
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.click(await screen.findByRole("button", { name: "匹配分析" }));
    fireEvent.change(await screen.findByLabelText("技能"), {
      target: { value: "取消前已编辑：SaaS 与 AI" }
    });
    await user.click(screen.getByRole("button", { name: "确认并分析" }));
    expect(await screen.findByText("正在生成匹配分析…")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "取消分析" }));
    expect(await screen.findByRole("button", { name: "确认并分析" })).toBeTruthy();
    expect((screen.getByLabelText("技能") as HTMLTextAreaElement).value)
      .toBe("取消前已编辑：SaaS 与 AI");

    await act(async () => {
      pending.resolve({ ok: true, data: result });
      await pending.promise;
    });

    expect(screen.queryByText("猎头结论")).toBeNull();
    expect((screen.getByLabelText("技能") as HTMLTextAreaElement).value)
      .toBe("取消前已编辑：SaaS 与 AI");
  });
});
