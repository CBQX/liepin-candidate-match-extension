import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCandidate } from "../../src/background/analyze-candidate";
import { AnalysisResult } from "../../src/sidepanel/components/AnalysisResult";
import { detectCandidateRedactionContext, redactCandidateDraft } from "../../src/shared/privacy";
import type { ModelProvider } from "../../src/providers/model-provider";
import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { Job } from "../../src/shared/contracts/job";
import type { MatchAnalysis } from "../../src/shared/contracts/matching";

afterEach(() => cleanup());

const job: Job = {
  id: "job-1",
  company: "甲公司",
  jd: "负责企业软件产品",
  customRequirements: "企业软件经验优先",
  recruitmentProfile: {
    version: 1,
    roleTitle: "企业软件产品经理",
    roleObjective: "负责虚构企业软件产品",
    requirements: [{
      id: "profile-1",
      text: "具备企业软件产品经验",
      priority: "hard",
      dimensionId: "functional_expertise",
      weight: 100,
      jobEvidence: ["岗位要求企业软件产品经验"]
    }],
    acceptableAlternatives: [],
    ambiguities: [],
    verificationQuestions: [],
    confirmedAt: "2026-08-19T00:00:00.000Z"
  },
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const analysis: MatchAnalysis = {
  overallScore: 78,
  recommendation: "verify_before_contact",
  matches: [{
    claim: "企业软件经验匹配",
    jobEvidence: ["岗位要求企业软件产品经验"],
    candidateEvidence: ["候选人负责过 SaaS 产品"]
  }, {
    claim: "项目交付经验匹配",
    jobEvidence: ["岗位要求推动复杂项目交付"],
    candidateEvidence: ["候选人材料列出跨团队上线经历"]
  }],
  concerns: [{
    claim: "管理跨度需要核实",
    jobEvidence: ["岗位包含团队管理职责"],
    candidateEvidence: ["候选人材料未提供团队人数"]
  }],
  verificationQuestions: ["请核实团队规模"],
  conclusionHighlights: [
    "企业软件经验是主要优势",
    "联系前核实团队规模",
    "<script>不是可执行标签</script>"
  ],
  recruiterConclusion: "建议联系前核实团队规模与职责边界。"
};

describe("AnalysisResult", () => {
  it("renders only the lightweight recruiter result with evidence attached to each reason", () => {
    // Break caught: restoring legacy dimensions or detaching evidence would make the fast report noisy or unauditable.
    render(<AnalysisResult analysis={analysis} job={job} />);

    expect(screen.getByText("78")).toBeTruthy();
    expect(screen.getByText("联系前先核实")).toBeTruthy();

    for (const [claim, jobEvidence, candidateEvidence] of [
      ["企业软件经验匹配", "岗位要求企业软件产品经验", "候选人负责过 SaaS 产品"],
      ["项目交付经验匹配", "岗位要求推动复杂项目交付", "候选人材料列出跨团队上线经历"],
      ["管理跨度需要核实", "岗位包含团队管理职责", "候选人材料未提供团队人数"]
    ] as const) {
      const item = screen.getByText(claim).closest("li")!;
      expect(within(item).getByText(jobEvidence)).toBeTruthy();
      expect(within(item).getByText(candidateEvidence)).toBeTruthy();
    }

    expect(screen.getByText("主要匹配理由")).toBeTruthy();
    expect(screen.getByText("主要顾虑或信息缺口")).toBeTruthy();
    expect(screen.getByText("建议核实问题")).toBeTruthy();
    expect(screen.getByText("猎头结论")).toBeTruthy();
    expect(screen.getByText("请核实团队规模")).toBeTruthy();
    expect(screen.getByText("建议联系前核实团队规模与职责边界。")).toBeTruthy();

    expect(screen.queryByText("六维评分")).toBeNull();
    expect(screen.queryByText("硬性条件核对")).toBeNull();
    expect(screen.queryByText(/可信/)).toBeNull();
    expect(screen.queryByText("沟通建议")).toBeNull();
  });

  it("puts the recruiter conclusion first and renders AI highlights as safe bold text", () => {
    // Break caught: moving the conclusion back below detail sections or interpreting provider markup would weaken hierarchy or enable injection.
    render(<AnalysisResult analysis={analysis} job={job} />);

    const report = screen.getByRole("heading", { name: "甲公司 · 人选匹配报告" }).closest("section")!;
    const conclusion = within(report).getByRole("region", { name: "猎头结论" });
    const scoreLabel = within(report).getByText("综合匹配分 / 100");
    expect(conclusion.compareDocumentPosition(scoreLabel) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();

    const matches = within(report).getByRole("heading", { name: "主要匹配理由" });
    const concerns = within(report).getByRole("heading", { name: "主要顾虑或信息缺口" });
    const questions = within(report).getByRole("heading", { name: "建议核实问题" });
    expect(matches.compareDocumentPosition(concerns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(concerns.compareDocumentPosition(questions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const highlight of analysis.conclusionHighlights) {
      expect(within(conclusion).getByText(highlight).tagName).toBe("STRONG");
    }
    expect(conclusion.querySelector("script")).toBeNull();
  });

  it("keeps sensitive candidate identifiers out of the lightweight provider call and result", async () => {
    const sensitiveDraft: CandidateDraft = {
      basics: {
        text: "姓名：张三，手机 13812345678，现居地：北京",
        status: "complete"
      },
      workExperience: {
        text: "负责企业软件产品，简历ID：123456",
        status: "complete"
      },
      projects: { text: "搭建招聘系统", status: "complete" },
      education: { text: "本科学历", status: "complete" },
      skills: {
        text: "需求分析，https://www.liepin.com/candidate/secret",
        status: "complete"
      },
      other: { text: "候选人ID：lp-888", status: "complete" },
      extractionConfidence: "high"
    };
    const providerAnalyze = vi.fn<ModelProvider["analyzeCandidate"]>()
      .mockResolvedValue(analysis);
    const provider: ModelProvider = {
      id: "deepseek",
      models: [],
      validateCredentials: async () => undefined,
      generateRecruitmentProfile: vi.fn(),
      analyzeCandidate: providerAnalyze
    };

    const result = await analyzeCandidate({
      job,
      candidateDraft: sensitiveDraft,
      redactionContext: detectCandidateRedactionContext(sensitiveDraft.basics.text)
    }, {
      provider,
      settings: { providerId: "deepseek", model: "deepseek-v4-pro", apiKey: "sk-test" },
      redact: redactCandidateDraft
    });

    const providerInput = providerAnalyze.mock.calls[0]?.[0];
    expect(Object.keys(providerInput ?? {})).toEqual(["recruitmentProfile", "candidateDraft"]);
    expect(JSON.stringify(providerInput)).not.toMatch(
      /张三|13812345678|123456|lp-888|liepin\.com|candidate\/secret/u
    );
    expect(JSON.stringify(result)).not.toMatch(
      /张三|13812345678|123456|lp-888|liepin\.com|candidate\/secret/u
    );
    expect(result).toEqual(analysis);
  });
});
