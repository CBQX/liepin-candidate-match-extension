import type { CandidateDraft } from "../../src/shared/contracts/candidate";
import type { JobProfileInput } from "../../src/providers/model-provider";

export interface SyntheticRecruitmentScenario {
  job: JobProfileInput;
  candidates: {
    completeMatch: CandidateDraft;
    partialMatch: CandidateDraft;
    informationGap: CandidateDraft;
    contradictory: CandidateDraft;
  };
}

const candidate = (
  workExperience: string,
  projects: string,
  skills: string,
  other: string,
  otherStatus: CandidateDraft["other"]["status"] = "complete"
): CandidateDraft => ({
  basics: { text: "虚构候选人，求职状态已确认", status: "complete" },
  workExperience: { text: workExperience, status: "complete" },
  projects: { text: projects, status: projects ? "complete" : "missing" },
  education: { text: "本科，虚构院校", status: "complete" },
  skills: { text: skills, status: skills ? "complete" : "missing" },
  other: { text: other, status: otherStatus },
  extractionConfidence: otherStatus === "complete" ? "high" : "medium"
});

export const syntheticRecruitmentScenarios: Record<
  "enterpriseSoftware" | "overseasProduct" | "dataPlatform",
  SyntheticRecruitmentScenario
> = {
  enterpriseSoftware: {
    job: {
      company: "虚构甲公司",
      jd: "负责企业软件产品规划、复杂流程设计和跨职能交付。",
      customRequirements: "重视订阅业务理解、客户访谈与产品落地能力。"
    },
    candidates: {
      completeMatch: candidate(
        "连续负责企业软件产品规划与交付",
        "主导虚构订阅产品从调研到上线",
        "客户访谈、流程设计、产品规划",
        "跨职能合作信息完整"
      ),
      partialMatch: candidate(
        "负责消费产品规划，参与部分企业客户项目",
        "交付过一项后台工具改版",
        "产品规划、用户研究",
        "订阅业务经验较少"
      ),
      informationGap: candidate(
        "负责企业软件需求分析",
        "",
        "",
        "项目影响与合作范围未说明",
        "possibly_incomplete"
      ),
      contradictory: candidate(
        "材料一处写负责企业软件，另一处写仅参与需求记录",
        "项目职责描述前后不一致",
        "产品规划",
        "需要核实实际职责",
        "possibly_incomplete"
      )
    }
  },
  overseasProduct: {
    job: {
      company: "虚构乙公司",
      jd: "负责海外产品策略、本地化研究和跨区域协作。",
      customRequirements: "重视英文业务沟通、市场验证与多团队协同。"
    },
    candidates: {
      completeMatch: candidate(
        "负责多个虚构区域的产品策略",
        "完成本地化调研与市场验证",
        "英文业务沟通、跨区域协作",
        "协作边界清晰"
      ),
      partialMatch: candidate(
        "负责单一区域产品运营",
        "参与一项本地化测试",
        "市场研究",
        "跨区域决策经验有限"
      ),
      informationGap: candidate(
        "材料仅说明海外业务参与经历",
        "",
        "英文沟通",
        "职责深度未说明",
        "possibly_incomplete"
      ),
      contradictory: candidate(
        "材料同时出现主导海外策略与仅提供执行支持",
        "市场验证职责描述矛盾",
        "跨区域协作",
        "需要核实决策权限",
        "possibly_incomplete"
      )
    }
  },
  dataPlatform: {
    job: {
      company: "虚构丙公司",
      jd: "负责数据平台产品规划、数据治理场景和平台能力建设。",
      customRequirements: "重视技术协作、平台指标和复杂项目推进。"
    },
    candidates: {
      completeMatch: candidate(
        "负责虚构数据平台产品规划",
        "推动数据治理能力与平台指标体系落地",
        "数据治理、平台产品、技术协作",
        "复杂项目推进信息完整"
      ),
      partialMatch: candidate(
        "负责分析工具产品",
        "参与数据目录功能建设",
        "数据分析、产品设计",
        "平台治理经验有限"
      ),
      informationGap: candidate(
        "材料仅写参与数据平台工作",
        "",
        "数据分析",
        "平台职责与成果未说明",
        "possibly_incomplete"
      ),
      contradictory: candidate(
        "材料同时写主导平台规划与未参与路线制定",
        "项目成果口径不一致",
        "数据治理",
        "需要核实实际影响",
        "possibly_incomplete"
      )
    }
  }
};
