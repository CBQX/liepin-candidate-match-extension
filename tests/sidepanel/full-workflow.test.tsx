import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/sidepanel/App";
import type { SidePanelDependencies } from "../../src/sidepanel/app-dependencies";
import type { ProviderSettings } from "../../src/repositories/chrome-provider-settings";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { Job } from "../../src/shared/contracts/job";
import type { MatchAnalysis } from "../../src/shared/contracts/matching";
import type { ModelRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const extractedCandidate: CandidateDraft = {
  basics: { text: "姓名：测试候选人，上海，8 年经验", status: "complete" },
  workExperience: { text: "某企业软件公司高级产品经理", status: "complete" },
  projects: { text: "负责招聘 SaaS 从 0 到 1 上线", status: "complete" },
  education: { text: "本科", status: "complete" },
  skills: { text: "SaaS、产品规划", status: "complete" },
  other: { text: "到岗时间待确认", status: "possibly_incomplete" },
  extractionConfidence: "medium"
};

const analysis: MatchAnalysis = {
  overallScore: 86,
  recommendation: "strong_recommend",
  confidence: "medium",
  dimensionScores: [
    { dimensionId: "hard_requirements", score: 90, evidence: ["候选人材料明确为本科"] },
    { dimensionId: "functional_expertise", score: 88, evidence: ["具备招聘 SaaS 产品经验"] },
    { dimensionId: "industry_business", score: 85, evidence: ["来自企业软件行业"] },
    { dimensionId: "seniority_impact", score: 84, evidence: ["承担从 0 到 1 产品职责"] },
    { dimensionId: "trajectory_stability", score: 80, evidence: ["履历连续"] },
    { dimensionId: "recruiter_feasibility", score: 86, evidence: ["有清晰沟通卖点"] }
  ],
  hardRequirements: [{
    criterionId: "custom-1",
    status: "met",
    evidence: ["岗位要求本科；候选人教育经历为本科"]
  }],
  matches: [{
    claim: "招聘 SaaS 经历匹配",
    jobEvidence: ["负责招聘 SaaS 产品"],
    candidateEvidence: ["负责招聘 SaaS 从 0 到 1 上线"]
  }],
  mismatches: [],
  risks: [{
    claim: "到岗时间未知",
    jobEvidence: ["岗位希望尽快到岗"],
    candidateEvidence: ["到岗时间待确认"]
  }],
  missingInformation: [{
    claim: "团队规模未提供",
    jobEvidence: ["岗位包含团队管理职责"],
    candidateEvidence: ["候选人材料未说明团队规模"]
  }],
  verificationQuestions: ["最快到岗时间是什么时候？"],
  outreachAdvice: ["从招聘 SaaS 业务影响力切入"],
  recruiterConclusion: "建议优先沟通并核实到岗时间。"
};

const generatedProfile: ModelRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品",
  requirements: [{
    id: "profile-requirement",
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

function createWorkflowDependencies() {
  let savedSettings: ProviderSettings | undefined;
  let jobs: Job[] = [];
  let activeJobId: string | undefined;

  const dependencies = {
    providerSettings: {
      load: vi.fn(async () => savedSettings),
      save: vi.fn(async (settings: ProviderSettings) => {
        savedSettings = settings;
      }),
      clear: vi.fn(async () => {
        savedSettings = undefined;
      })
    },
    jobs: {
      list: vi.fn(async () => [...jobs]),
      getActive: vi.fn(async () => jobs.find((job) => job.id === activeJobId)),
      saveAndActivate: vi.fn(async (job: Job) => {
        jobs = [...jobs.filter((savedJob) => savedJob.id !== job.id), job];
        activeJobId = job.id;
      }),
      activate: vi.fn(async (id: string) => {
        if (jobs.some((job) => job.id === id)) activeJobId = id;
      })
    },
    validateProvider: vi.fn(async () => ({
      ok: true as const,
      data: { valid: true as const }
    })),
    extractCurrentCandidate: vi.fn(async () => ({
      ok: true as const,
      data: extractedCandidate
    })),
    generateJobProfile: vi.fn(async () => ({ ok: true as const, data: generatedProfile })),
    cancelJobProfile: vi.fn(async () => ({ ok: true as const, data: { cancelled: true } })),
    confirmJobProfile: vi.fn(async (jobId: string, profile: ModelRecruitmentProfile) => {
      const existing = jobs.find((job) => job.id === jobId)!;
      const updated: Job = {
        ...existing,
        recruitmentProfile: { ...profile, confirmedAt: "2026-08-19T00:00:00.000Z" }
      };
      jobs = [...jobs.filter((job) => job.id !== jobId), updated];
      activeJobId = jobId;
      return { ok: true as const, data: updated };
    }),
    analyzeCandidate: vi.fn<SidePanelDependencies["analyzeCandidate"]>(
      async () => ({ ok: true as const, data: analysis })
    ),
    cancelAnalysis: vi.fn(async () => ({ ok: true as const, data: { cancelled: true } })),
    subscribeToPageContextChanges: vi.fn(() => () => undefined)
  } satisfies SidePanelDependencies;

  return dependencies;
}

async function saveJob(
  user: ReturnType<typeof userEvent.setup>,
  company: string,
  jd: string,
  customRequirements: string
) {
  await user.type(screen.getByLabelText("公司名称"), company);
  await user.type(screen.getByLabelText("职位 JD"), jd);
  await user.type(screen.getByLabelText("个性化要求"), customRequirements);
  await user.click(screen.getByRole("button", { name: "分析岗位要求" }));
  await user.click(await screen.findByRole("button", { name: "确认岗位画像" }));
}

describe("complete recruiter workflow", () => {
  it("configures, analyzes an edited candidate against the active job, and clears transient data on switch", async () => {
    // Break caught: final wiring could analyze before consent, use the wrong active
    // job, lose recruiter edits, or retain a previous candidate/result after a switch.
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce("job-one")
        .mockReturnValueOnce("profile-one")
        .mockReturnValueOnce("job-two")
        .mockReturnValueOnce("profile-two")
        .mockReturnValueOnce("analysis-one")
    });
    const deps = createWorkflowDependencies();
    const user = userEvent.setup();
    render(<App deps={deps} />);

    await user.type(await screen.findByLabelText("DeepSeek API Key"), "sk-synthetic-test");
    await user.click(screen.getByRole("button", { name: "验证并保存" }));
    await waitFor(() => expect(deps.validateProvider).toHaveBeenCalledTimes(1));

    await saveJob(
      user,
      "甲公司",
      "负责招聘 SaaS 产品；岗位包含团队管理职责",
      "必须本科；希望尽快到岗"
    );
    expect(await screen.findByText("岗位画像已确认，可以开始浏览候选人")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "添加新岗位" }));
    await saveJob(user, "乙公司", "负责数据平台产品", "必须有 AI 项目经验");

    const jobSelector = await screen.findByRole("combobox", { name: "当前岗位" }) as HTMLSelectElement;
    expect([...jobSelector.options].map((option) => option.text)).toEqual(["甲公司", "乙公司"]);
    expect(jobSelector.value).toBe("job-two");

    await user.selectOptions(jobSelector, "job-one");
    await waitFor(() => expect(jobSelector.value).toBe("job-one"));
    await user.click(screen.getByRole("button", { name: "匹配分析" }));

    const skills = await screen.findByLabelText("技能") as HTMLTextAreaElement;
    expect(deps.analyzeCandidate).not.toHaveBeenCalled();
    fireEvent.change(skills, { target: { value: "SaaS、产品规划、AI 工作流" } });
    await user.click(screen.getByRole("checkbox", {
      name: /我已检查.*姓名.*联系方式.*猎聘 ID/u
    }));
    await user.click(screen.getByRole("button", { name: "确认并分析" }));

    expect(await screen.findByRole("heading", { name: "甲公司 · 人选匹配报告" })).toBeTruthy();
    expect(screen.getByText("86")).toBeTruthy();
    expect(screen.getByText("建议优先联系")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "匹配项" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "不匹配项" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "风险提示" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "缺失信息" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "核实问题" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "沟通建议" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "猎头结论" })).toBeTruthy();

    expect(deps.extractCurrentCandidate).toHaveBeenCalledTimes(1);
    expect(deps.analyzeCandidate).toHaveBeenCalledTimes(1);
    expect(deps.analyzeCandidate.mock.calls[0]?.[0].company).toBe("甲公司");
    expect(deps.analyzeCandidate.mock.calls[0]?.[1].skills.text)
      .toBe("SaaS、产品规划、AI 工作流");

    await user.selectOptions(jobSelector, "job-two");

    await waitFor(() => expect(jobSelector.value).toBe("job-two"));
    expect(screen.queryByRole("heading", { name: "甲公司 · 人选匹配报告" })).toBeNull();
    expect(screen.queryByDisplayValue("SaaS、产品规划、AI 工作流")).toBeNull();
    expect(screen.getByRole("button", { name: "匹配分析" })).toBeTruthy();
    expect(screen.getByText("当前岗位 · 乙公司")).toBeTruthy();
  });
});
