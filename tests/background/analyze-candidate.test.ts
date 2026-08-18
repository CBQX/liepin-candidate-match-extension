import { describe, expect, it, vi } from "vitest";
import { analyzeCandidate } from "../../src/background/analyze-candidate";
import { createBackgroundController } from "../../src/background/controller";
import type { ModelProvider } from "../../src/providers/model-provider";
import {
  detectCandidateRedactionContext,
  prepareCandidateDraftForPreview,
  redactCandidateDraft
} from "../../src/shared/privacy";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { Job } from "../../src/shared/contracts/job";
import type { ModelMatchResult } from "../../src/shared/contracts/matching";

const job: Job = {
  id: "job-1",
  company: "甲公司",
  jd: "必须有 5 年以上经验",
  customRequirements: "必须工作地点：上海\n必须本科",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const candidateDraft: CandidateDraft = {
  basics: { text: "姓名：张三，手机 13812345678，现居地：上海", status: "complete" },
  workExperience: { text: "明确 8 年工作经验", status: "complete" },
  projects: { text: "负责企业软件项目", status: "complete" },
  education: { text: "本科学历", status: "complete" },
  skills: { text: "需求分析", status: "complete" },
  other: { text: "", status: "missing" },
  extractionConfidence: "high"
};

const modelResult: ModelMatchResult = {
  dimensionScores: [
    { dimensionId: "hard_requirements", score: 80, evidence: ["学历和经验有明确证据"] },
    { dimensionId: "functional_expertise", score: 80, evidence: ["具备产品工作经验"] },
    { dimensionId: "industry_business", score: 80, evidence: ["有企业软件项目经历"] },
    { dimensionId: "seniority_impact", score: 80, evidence: ["项目职责明确"] },
    { dimensionId: "trajectory_stability", score: 80, evidence: ["材料未显示明显断层"] },
    { dimensionId: "recruiter_feasibility", score: 80, evidence: ["具备可沟通的相关卖点"] }
  ],
  matches: [{
    claim: "经验匹配",
    jobEvidence: ["岗位要求 5 年以上经验"],
    candidateEvidence: ["候选人明确有 8 年工作经验"]
  }],
  mismatches: [],
  risks: [],
  missingInformation: [{
    claim: "工作地点意愿未知",
    jobEvidence: ["岗位工作地点为上海"],
    candidateEvidence: ["材料仅显示现居地，不能证明到岗意愿"]
  }],
  verificationQuestions: ["请核实上海到岗意愿"],
  outreachAdvice: ["从企业软件项目切入"],
  recruiterConclusion: "建议推进并核实地点意愿"
};

const settings = {
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-test"
};

function providerWithAnalyze(analyze: ModelProvider["analyze"]): ModelProvider {
  return {
    id: "deepseek",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }
    ],
    validateCredentials: vi.fn(),
    analyze
  };
}

const redactionContext = detectCandidateRedactionContext(candidateDraft.basics.text);

function analysisRuntimeRequest(requestId = "analysis-test") {
  return {
    type: "ANALYZE_CANDIDATE" as const,
    requestId,
    job,
    candidateDraft,
    redactionContext
  };
}

describe("analyzeCandidate", () => {
  it("redacts, evaluates rules conservatively, calls the provider, and composes only the final analysis", async () => {
    // Break caught: bypassing any pipeline stage could leak identifiers, omit rules, revive deterministic location matching, or return an uncomposed score.
    const analyze = vi.fn<ModelProvider["analyze"]>().mockResolvedValue(modelResult);

    const analysis = await analyzeCandidate({
      job,
      candidateDraft,
      redactionContext: detectCandidateRedactionContext(candidateDraft.basics.text)
    }, {
      provider: providerWithAnalyze(analyze),
      settings,
      redact: redactCandidateDraft
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    const [input, receivedSettings] = analyze.mock.calls[0]!;
    expect(receivedSettings).toEqual(settings);
    expect(input.job).toEqual(job);
    expect(input.candidateDraft.basics.text).not.toContain("张三");
    expect(input.candidateDraft.basics.text).not.toContain("13812345678");
    expect(input.criteria.map(({ text }) => text)).toEqual([
      "必须工作地点：上海",
      "必须本科",
      "必须有 5 年以上经验"
    ]);
    expect(input.ruleEvaluations).toEqual([
      {
        criterionId: "custom-1",
        status: "unknown",
        evidence: ["基本信息：现居地：上海"]
      },
      { criterionId: "custom-2", status: "met", evidence: ["明确学历：本科"] },
      {
        criterionId: "jd-1",
        status: "unknown",
        evidence: ["工作经历：明确 8 年工作经验"]
      }
    ]);
    expect(analysis.hardRequirements).toEqual(input.ruleEvaluations);
    expect(analysis).toMatchObject({
      overallScore: 80,
      recommendation: "recommend",
      confidence: "low",
      recruiterConclusion: "建议推进并核实地点意愿"
    });
  });

  it("re-redacts a recognized name added after preview and never forwards redaction metadata", async () => {
    // Break caught: the background trust boundary must sanitize recruiter edits without exposing identity metadata to a provider.
    const analyze = vi.fn<ModelProvider["analyze"]>().mockResolvedValue(modelResult);
    const prepared = prepareCandidateDraftForPreview(candidateDraft);
    const edited = structuredClone(prepared.draft);
    edited.projects.text = "张三负责新增项目";

    await analyzeCandidate({
      job,
      candidateDraft: edited,
      redactionContext: prepared.redactionContext
    }, {
      provider: providerWithAnalyze(analyze),
      settings,
      redact: redactCandidateDraft
    });

    const providerInput = analyze.mock.calls[0]?.[0];
    expect(JSON.stringify(providerInput)).not.toContain("张三");
    expect(providerInput).not.toHaveProperty("redactionContext");
  });

  it("rejects a missing API key before invoking the provider", async () => {
    // Break caught: forwarding an empty credential would make an avoidable external request and obscure the setup action.
    const analyze = vi.fn<ModelProvider["analyze"]>().mockResolvedValue(modelResult);

    await expect(analyzeCandidate({ job, candidateDraft, redactionContext }, {
      provider: providerWithAnalyze(analyze),
      settings: { ...settings, apiKey: "  " },
      redact: redactCandidateDraft
    })).rejects.toMatchObject({ code: "MISSING_API_KEY" });

    expect(analyze).not.toHaveBeenCalled();
  });

  it("strips Liepin URLs, platform paths, and labeled profile identifiers at the background boundary", async () => {
    // Break caught: recruiter edits or extractor fallback text could reintroduce platform URLs/IDs after the preview redaction pass.
    const analyze = vi.fn<ModelProvider["analyze"]>().mockResolvedValue(modelResult);
    const draftWithPlatformIdentifiers: CandidateDraft = {
      ...candidateDraft,
      basics: {
        text: "姓名：张三，简历ID：123456，https://www.liepin.com/candidate/secret?resumeId=789",
        status: "complete"
      },
      workExperience: {
        text: "乙公司高级产品经理，负责猎聘招聘系统，业绩提升 30%；/resume/showresumedetail/?res_id=999",
        status: "complete"
      },
      projects: {
        text: "候选人ID: lp-888；搭建 ATS 项目",
        status: "complete"
      },
      other: {
        text: "Profile ID：profile_001 https://c.liepin.com/profile/private",
        status: "complete"
      }
    };

    await analyzeCandidate({
      job,
      candidateDraft: draftWithPlatformIdentifiers,
      redactionContext: detectCandidateRedactionContext(draftWithPlatformIdentifiers.basics.text)
    }, {
      provider: providerWithAnalyze(analyze),
      settings,
      redact: redactCandidateDraft
    });

    const providerDraft = analyze.mock.calls[0]?.[0].candidateDraft;
    const serializedDraft = JSON.stringify(providerDraft);
    expect(serializedDraft).not.toMatch(/liepin\.com|\/resume\/|123456|lp-888|profile_001/iu);
    expect(serializedDraft).toContain("乙公司高级产品经理");
    expect(serializedDraft).toContain("负责猎聘招聘系统");
    expect(serializedDraft).toContain("业绩提升 30%");
    expect(serializedDraft).toContain("搭建 ATS 项目");
  });
});

describe("ANALYZE_CANDIDATE controller response", () => {
  it("maps provider failures to the standard runtime error envelope", async () => {
    // Break caught: a thrown adapter error could escape the service worker instead of reaching the recoverable side-panel state.
    const provider = providerWithAnalyze(vi.fn().mockRejectedValue(Object.assign(
      new Error("rate limited"),
      { code: "RATE_LIMITED" }
    )));
    const controller = createBackgroundController({
      getActiveTab: async () => undefined,
      sendToTab: vi.fn(),
      loadProviderSettings: async () => settings,
      resolveProvider: () => provider
    });

    const response = await controller.handle(analysisRuntimeRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED", message: expect.any(String) }
    });
  });

  it("maps incomplete dimension coverage to INVALID_MODEL_OUTPUT without returning a partial score", async () => {
    // Break caught: composition validation failures could be mislabeled UNKNOWN or leak an incomplete score to the UI.
    const incompleteResult = {
      ...modelResult,
      dimensionScores: modelResult.dimensionScores.slice(0, 5)
    } as ModelMatchResult;
    const provider = providerWithAnalyze(vi.fn().mockResolvedValue(incompleteResult));
    const controller = createBackgroundController({
      getActiveTab: async () => undefined,
      sendToTab: vi.fn(),
      loadProviderSettings: async () => settings,
      resolveProvider: () => provider
    });

    const response = await controller.handle(analysisRuntimeRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_MODEL_OUTPUT" }
    });
    expect(response).not.toHaveProperty("data.overallScore");
  });

  it("maps evidence-free provider output to INVALID_MODEL_OUTPUT without returning a partial result", async () => {
    // Break caught: a future provider adapter could skip schema validation and pass an unsupported score without evidence.
    const evidenceFreeResult = {
      ...modelResult,
      dimensionScores: modelResult.dimensionScores.map((dimension, index) => index === 0
        ? { ...dimension, evidence: [] }
        : dimension)
    } as ModelMatchResult;
    const provider = providerWithAnalyze(vi.fn().mockResolvedValue(evidenceFreeResult));
    const controller = createBackgroundController({
      getActiveTab: async () => undefined,
      sendToTab: vi.fn(),
      loadProviderSettings: async () => settings,
      resolveProvider: () => provider
    });

    const response = await controller.handle(analysisRuntimeRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_MODEL_OUTPUT" }
    });
    expect(response).not.toHaveProperty("data");
  });

  it("maps a qualitative conclusion missing candidate evidence to INVALID_MODEL_OUTPUT", async () => {
    // Break caught: defensive validation must cover claims as well as numeric scores for future provider adapters.
    const evidenceFreeResult = {
      ...modelResult,
      matches: [{
        claim: "经验匹配",
        jobEvidence: ["岗位要求 5 年以上经验"],
        candidateEvidence: []
      }]
    } as ModelMatchResult;
    const controller = createBackgroundController({
      getActiveTab: async () => undefined,
      sendToTab: vi.fn(),
      loadProviderSettings: async () => settings,
      resolveProvider: () => providerWithAnalyze(vi.fn().mockResolvedValue(evidenceFreeResult))
    });

    const response = await controller.handle(analysisRuntimeRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_MODEL_OUTPUT" }
    });
    expect(response).not.toHaveProperty("data");
  });

  it("returns MISSING_API_KEY without resolving or invoking a provider", async () => {
    // Break caught: provider selection or invocation could run before the controller verifies stored credentials.
    const resolveProvider = vi.fn();
    const controller = createBackgroundController({
      getActiveTab: async () => undefined,
      sendToTab: vi.fn(),
      loadProviderSettings: async () => undefined,
      resolveProvider
    });

    const response = await controller.handle(analysisRuntimeRequest());

    expect(response).toMatchObject({ ok: false, error: { code: "MISSING_API_KEY" } });
    expect(resolveProvider).not.toHaveBeenCalled();
  });

  it("maps a retired provider setting to reconfiguration before analysis", async () => {
    // Break caught: retrying analysis with an adapter id no longer registered can never succeed without user reconfiguration.
    const controller = createBackgroundController({
      getActiveTab: async () => undefined,
      sendToTab: vi.fn(),
      loadProviderSettings: async () => ({ ...settings, providerId: "retired-provider" }),
      resolveProvider: () => undefined
    });

    const response = await controller.handle(analysisRuntimeRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_PROVIDER_SETTINGS" }
    });
  });

  it("maps provider-settings load failures to STORAGE_FAILED before analysis", async () => {
    // Break caught: a failed credential read could be reported as an unknown model error and accidentally enter a provider retry loop.
    const resolveProvider = vi.fn();
    const controller = createBackgroundController({
      getActiveTab: async () => undefined,
      sendToTab: vi.fn(),
      loadProviderSettings: async () => {
        throw new Error("storage unavailable");
      },
      resolveProvider
    });

    const response = await controller.handle(analysisRuntimeRequest());

    expect(response).toMatchObject({
      ok: false,
      error: { code: "STORAGE_FAILED" }
    });
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
