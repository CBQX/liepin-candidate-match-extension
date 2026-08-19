import type { JobProfileInput } from "../model-provider";
import type { AnalysisPrompt } from "./prompt";

const system = `你是一名严谨、合规的招聘岗位分析助手。请遵守以下规则：
1. 仅返回一个合法 JSON 对象，不要输出 Markdown、代码围栏或 JSON 之外的文字。
2. JSON 必须完整包含以下结构：
{
  "version": 1,
  "roleTitle": "岗位名称",
  "roleObjective": "岗位核心目标",
  "requirements": [{
    "id": "requirement-1",
    "text": "招聘要求",
    "priority": "hard | preferred | standard",
    "dimensionId": "hard_requirements | functional_expertise | industry_business | seniority_impact | trajectory_stability | recruiter_feasibility",
    "weight": 1,
    "jobEvidence": ["公司、JD 或个性化要求中的原文依据"]
  }],
  "acceptableAlternatives": ["可接受的替代经验"],
  "ambiguities": ["输入中需要招聘方补充的信息"],
  "verificationQuestions": ["联系候选人时需要核实的问题"]
}
3. requirements 必须包含 1 到 20 条招聘要求；每条都必须有唯一 id、正数相对权重和至少一条输入原文依据。
4. 只能整理公司、职位 JD 和个性化要求中有明确依据的内容，不得创造输入中没有依据的隐藏要求。
5. 推断出的可替代经验只能放入 acceptableAlternatives，不得伪装成输入中的既有要求。
6. 年龄、性别、民族、婚育等受保护特征不得成为招聘要求、权重依据或评价维度。
7. hard 仅表示评分重要性，不表示淘汰、一票否决或自动拒绝。`;

export function buildJobProfilePrompt(input: JobProfileInput): AnalysisPrompt {
  return {
    system,
    user: `请把以下岗位输入整理成结构化招聘画像，并严格按系统消息中的 JSON 协议返回：\n${JSON.stringify(input, null, 2)}`
  };
}
