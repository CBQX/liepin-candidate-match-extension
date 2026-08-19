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
import type { ConfirmedRecruitmentProfile } from "../../src/shared/contracts/recruitment-profile";

const recruitmentProfile: ConfirmedRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品",
  requirements: [{
    id: "profile-location",
    text: "必须工作地点：上海",
    priority: "hard",
    dimensionId: "hard_requirements",
    weight: 34,
    jobEvidence: ["工作地点：上海"]
  }, {
    id: "profile-degree",
    text: "必须本科",
    priority: "hard",
    dimensionId: "hard_requirements",
    weight: 33,
    jobEvidence: ["必须本科"]
  }, {
    id: "profile-years",
    text: "必须有 5 年以上经验",
    priority: "hard",
    dimensionId: "functional_expertise",
    weight: 33,
    jobEvidence: ["必须有 5 年以上经验"]
  }],
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: [],
  confirmedAt: "2026-08-19T00:00:00.000Z"
};

const job: Job = {
  id: "job-1",
  company: "甲公司",
  jd: "必须有 5 年以上经验；原始 JD 唯一标记不得进入候选人调用",
  customRequirements: "必须工作地点：上海\n必须本科\n原始个性化要求唯一标记不得进入候选人调用",
  recruitmentProfile,
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
  overallScore: 80,
  recommendation: "verify_before_contact",
  matches: [{
    claim: "经验匹配",
    jobEvidence: ["岗位要求 5 年以上经验"],
    candidateEvidence: ["候选人明确有 8 年工作经验"]
  }, {
    claim: "学历匹配",
    jobEvidence: ["岗位要求本科学历"],
    candidateEvidence: ["候选人材料明确为本科"]
  }],
  concerns: [{
    claim: "工作地点意愿未知",
    jobEvidence: ["岗位工作地点为上海"],
    candidateEvidence: ["材料仅显示现居地，不能证明到岗意愿"]
  }],
  verificationQuestions: ["请核实上海到岗意愿"],
  conclusionHighlights: ["经验和学历匹配", "核实上海到岗意愿"],
  recruiterConclusion: "建议推进并核实地点意愿"
};

const settings = {
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-test"
};

function providerWithAnalyze(
  analyzeCandidate: NonNullable<ModelProvider["analyzeCandidate"]>
): ModelProvider {
  return {
    id: "deepseek",
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }
    ],
    validateCredentials: vi.fn(),
    generateRecruitmentProfile: vi.fn(),
    analyzeCandidate
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
  it("redacts and sends only the confirmed profile plus candidate while preserving the AI decision", async () => {
    // Break caught: duplicate local criteria/rules or local score remapping would make the lightweight call slower or override the AI result.
    const analyze = vi.fn<NonNullable<ModelProvider["analyzeCandidate"]>>()
      .mockResolvedValue(modelResult);

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
    expect(Object.keys(input)).toEqual(["recruitmentProfile", "candidateDraft"]);
    expect(input.recruitmentProfile).toEqual(recruitmentProfile);
    expect(input).not.toHaveProperty("job");
    expect(JSON.stringify(input)).not.toContain(job.jd);
    expect(JSON.stringify(input)).not.toContain(job.customRequirements);
    expect(input.candidateDraft.basics.text).not.toContain("张三");
    expect(input.candidateDraft.basics.text).not.toContain("13812345678");
    expect(input).not.toHaveProperty("criteria");
    expect(input).not.toHaveProperty("ruleEvaluations");
    expect(analysis).toEqual(modelResult);
  });

  it("re-redacts a recognized name added after preview and never forwards redaction metadata", async () => {
    // Break caught: the background trust boundary must sanitize recruiter edits without exposing identity metadata to a provider.
    const analyze = vi.fn<NonNullable<ModelProvider["analyzeCandidate"]>>() .mockResolvedValue(modelResult);
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
    const analyze = vi.fn<NonNullable<ModelProvider["analyzeCandidate"]>>() .mockResolvedValue(modelResult);

    await expect(analyzeCandidate({ job, candidateDraft, redactionContext }, {
      provider: providerWithAnalyze(analyze),
      settings: { ...settings, apiKey: "  " },
      redact: redactCandidateDraft
    })).rejects.toMatchObject({ code: "MISSING_API_KEY" });

    expect(analyze).not.toHaveBeenCalled();
  });

  it("rejects a job without a confirmed profile before invoking the provider", async () => {
    const analyze = vi.fn<NonNullable<ModelProvider["analyzeCandidate"]>>()
      .mockResolvedValue(modelResult);

    await expect(analyzeCandidate({
      job: { ...job, recruitmentProfile: undefined },
      candidateDraft,
      redactionContext
    }, {
      provider: providerWithAnalyze(analyze),
      settings,
      redact: redactCandidateDraft
    })).rejects.toMatchObject({ code: "JOB_PROFILE_REQUIRED" });

    expect(analyze).not.toHaveBeenCalled();
  });

  it("strips Liepin URLs, platform paths, and labeled profile identifiers at the background boundary", async () => {
    // Break caught: recruiter edits or extractor fallback text could reintroduce platform URLs/IDs after the preview redaction pass.
    const analyze = vi.fn<NonNullable<ModelProvider["analyzeCandidate"]>>() .mockResolvedValue(modelResult);
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

  it("maps too few matching reasons to INVALID_MODEL_OUTPUT without returning a partial score", async () => {
    // Break caught: defensive validation must enforce the lightweight minimum even for alternate providers.
    const incompleteResult = {
      ...modelResult,
      matches: modelResult.matches.slice(0, 1)
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

  it("maps an out-of-range direct score to INVALID_MODEL_OUTPUT without returning a partial result", async () => {
    // Break caught: a future provider adapter could skip schema validation and pass an unsupported direct score.
    const evidenceFreeResult = {
      ...modelResult,
      overallScore: 101
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
      matches: modelResult.matches.map((match, index) => index === 0
        ? { ...match, candidateEvidence: [] }
        : match)
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
