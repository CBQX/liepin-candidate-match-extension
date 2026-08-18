import { describe, expect, it, vi } from "vitest";
import { analyzeCandidate } from "../../src/background/analyze-candidate";
import { createBackgroundController } from "../../src/background/controller";
import type { ModelProvider } from "../../src/providers/model-provider";
import { redactCandidateDraft } from "../../src/shared/privacy";
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
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    validateCredentials: vi.fn(),
    analyze
  };
}

describe("analyzeCandidate", () => {
  it("redacts, evaluates rules conservatively, calls the provider, and composes only the final analysis", async () => {
    // Break caught: bypassing any pipeline stage could leak identifiers, omit rules, revive deterministic location matching, or return an uncomposed score.
    const analyze = vi.fn<ModelProvider["analyze"]>().mockResolvedValue(modelResult);

    const analysis = await analyzeCandidate({ job, candidateDraft }, {
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
      { criterionId: "custom-1", status: "unknown", evidence: [] },
      { criterionId: "custom-2", status: "met", evidence: ["明确学历：本科"] },
      { criterionId: "jd-1", status: "met", evidence: ["明确工作经验：8 年"] }
    ]);
    expect(analysis).toMatchObject({
      overallScore: 80,
      recommendation: "recommend",
      confidence: "medium",
      recruiterConclusion: "建议推进并核实地点意愿"
    });
  });

  it("rejects a missing API key before invoking the provider", async () => {
    // Break caught: forwarding an empty credential would make an avoidable external request and obscure the setup action.
    const analyze = vi.fn<ModelProvider["analyze"]>().mockResolvedValue(modelResult);

    await expect(analyzeCandidate({ job, candidateDraft }, {
      provider: providerWithAnalyze(analyze),
      settings: { ...settings, apiKey: "  " },
      redact: redactCandidateDraft
    })).rejects.toMatchObject({ code: "MISSING_API_KEY" });

    expect(analyze).not.toHaveBeenCalled();
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

    const response = await controller.handle({
      type: "ANALYZE_CANDIDATE",
      job,
      candidateDraft
    });

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

    const response = await controller.handle({
      type: "ANALYZE_CANDIDATE",
      job,
      candidateDraft
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: "INVALID_MODEL_OUTPUT" }
    });
    expect(response).not.toHaveProperty("data.overallScore");
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

    const response = await controller.handle({
      type: "ANALYZE_CANDIDATE",
      job,
      candidateDraft
    });

    expect(response).toMatchObject({ ok: false, error: { code: "MISSING_API_KEY" } });
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
