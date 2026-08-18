import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnalysisResult } from "../../src/sidepanel/components/AnalysisResult";
import type { Job } from "../../src/shared/contracts/job";
import type { MatchAnalysis } from "../../src/shared/contracts/matching";

afterEach(() => cleanup());

const job: Job = {
  id: "job-1",
  company: "甲公司",
  jd: "负责企业软件产品",
  customRequirements: "必须本科\n必须工作地点：上海",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z"
};

const analysis: MatchAnalysis = {
  overallScore: 78,
  recommendation: "recommend",
  confidence: "medium",
  dimensionScores: [
    { dimensionId: "hard_requirements", score: 85, evidence: ["学历证据充分"] },
    { dimensionId: "functional_expertise", score: 82, evidence: ["产品能力证据"] },
    { dimensionId: "industry_business", score: 76, evidence: ["企业软件背景证据"] },
    { dimensionId: "seniority_impact", score: 72, evidence: ["影响力证据"] },
    { dimensionId: "trajectory_stability", score: 68, evidence: ["任职时间证据"] },
    { dimensionId: "recruiter_feasibility", score: 80, evidence: ["推进卖点证据"] }
  ],
  hardRequirements: [
    { criterionId: "custom-1", status: "met", evidence: ["候选人明确为本科"] },
    { criterionId: "custom-2", status: "unknown", evidence: [] }
  ],
  matches: [{
    claim: "企业软件经验匹配",
    jobEvidence: ["岗位要求企业软件产品经验"],
    candidateEvidence: ["候选人负责过 SaaS 产品"]
  }],
  mismatches: [{
    claim: "管理跨度尚未达到岗位预期",
    jobEvidence: ["岗位希望管理 10 人团队"],
    candidateEvidence: ["候选人材料仅明确管理 4 人"]
  }],
  risks: [{
    claim: "近期任职时间偏短",
    jobEvidence: ["岗位重视稳定性"],
    candidateEvidence: ["最近一段经历为 10 个月"]
  }],
  missingInformation: [{
    claim: "到岗意愿未知",
    jobEvidence: ["岗位工作地点为上海"],
    candidateEvidence: ["材料只显示现居地，未说明到岗意愿"]
  }],
  verificationQuestions: ["请核实上海到岗意愿"],
  outreachAdvice: ["从 SaaS 产品经历切入"],
  recruiterConclusion: "建议推进，电话中优先核实地点意愿与团队规模。"
};

describe("AnalysisResult", () => {
  it("renders the complete recruiter result and keeps every evidence item under its claim", () => {
    // Break caught: omitting a result section or detaching evidence from its claim would make the recommendation impossible to audit.
    render(<AnalysisResult analysis={analysis} job={job} />);

    expect(screen.getByText("78")).toBeTruthy();
    expect(screen.getByText("建议推进")).toBeTruthy();
    expect(screen.getByText("中可信")).toBeTruthy();

    for (const label of [
      "硬性条件",
      "职能经验与专业能力",
      "行业与业务匹配",
      "职级、管理跨度与成果",
      "职业轨迹与稳定性",
      "猎头推进可行性"
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const evidence of [
      "学历证据充分",
      "产品能力证据",
      "企业软件背景证据",
      "影响力证据",
      "任职时间证据",
      "推进卖点证据"
    ]) {
      expect(screen.getByText(evidence)).toBeTruthy();
    }

    const educationRequirement = screen.getByText("必须本科").closest("li")!;
    expect(within(educationRequirement).getByText("满足")).toBeTruthy();
    expect(within(educationRequirement).getByText("候选人明确为本科")).toBeTruthy();
    const locationRequirement = screen.getByText("必须工作地点：上海").closest("li")!;
    expect(within(locationRequirement).getByText("未知")).toBeTruthy();
    expect(screen.getByText(
      "阶段 C 中，地点、工作年限和证书仅供模型分析与猎头核实；这三类在确定性硬条件核对中始终显示“未知”。"
    )).toBeTruthy();
    expect(screen.getByText(
      "自然语言履历可能包含范围、否定、计划或有效期语义，因此不用于自动满足、淘汰或降级。"
    )).toBeTruthy();

    const claimEvidence = [
      ["企业软件经验匹配", "岗位要求企业软件产品经验", "候选人负责过 SaaS 产品"],
      ["管理跨度尚未达到岗位预期", "岗位希望管理 10 人团队", "候选人材料仅明确管理 4 人"],
      ["近期任职时间偏短", "岗位重视稳定性", "最近一段经历为 10 个月"],
      ["到岗意愿未知", "岗位工作地点为上海", "材料只显示现居地，未说明到岗意愿"]
    ];
    for (const [claim, jobEvidence, candidateEvidence] of claimEvidence) {
      const item = screen.getByText(claim).closest("li")!;
      expect(within(item).getByText(jobEvidence)).toBeTruthy();
      expect(within(item).getByText(candidateEvidence)).toBeTruthy();
    }

    expect(screen.getByText("匹配项")).toBeTruthy();
    expect(screen.getByText("不匹配项")).toBeTruthy();
    expect(screen.getByText("风险提示")).toBeTruthy();
    expect(screen.getByText("缺失信息")).toBeTruthy();
    expect(screen.getByText("核实问题")).toBeTruthy();
    expect(screen.getByText("沟通建议")).toBeTruthy();
    expect(screen.getByText("猎头结论")).toBeTruthy();
    expect(screen.getByText("请核实上海到岗意愿")).toBeTruthy();
    expect(screen.getByText("从 SaaS 产品经历切入")).toBeTruthy();
    expect(screen.getByText("建议推进，电话中优先核实地点意愿与团队规模。")).toBeTruthy();
  });
});
