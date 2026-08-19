# 轻量候选人分析设计

**日期：** 2026-08-19  
**状态：** 用户已批准实施  
**适用范围：** 阶段 C 内部验证；岗位画像流程保持不变

## 1. 决策摘要

候选人分析不再要求模型生成六维分数，也不再由本地代码按维度合成总分。模型直接依据猎头已经确认的岗位画像、要求优先级和权重，返回一个 0–100 综合匹配分、三档联系建议、证据化匹配理由、少量顾虑或信息缺口、核实问题和猎头结论。

候选人分析固定使用 `deepseek-v4-flash`；岗位画像生成继续使用设置页中用户选择的模型。候选人请求只携带已确认岗位画像和脱敏候选人草稿，使用紧凑 JSON，不再重复发送 `criteria` 或本地规则预判。输出上限保持 `8192` tokens，并保留一次格式修复重试。

## 2. 用户可见结果

```ts
type ContactRecommendation =
  | "contact"
  | "verify_before_contact"
  | "deprioritize";

interface EvidenceReason {
  claim: string;
  jobEvidence: string[];
  candidateEvidence: string[];
}

interface LightweightMatchAnalysis {
  overallScore: number; // 0–100 整数，由模型直接给出
  recommendation: ContactRecommendation;
  matches: EvidenceReason[]; // 2–5 条
  concerns: EvidenceReason[]; // 0–3 条，包含顾虑与信息缺口
  verificationQuestions: string[]; // 0–3 条
  recruiterConclusion: string; // 一段简明结论
}
```

展示文案：

- `contact`：建议联系
- `verify_before_contact`：联系前先核实
- `deprioritize`：暂不优先联系

三档只表达猎头联系优先级，不表示淘汰、拒绝或自动筛除。结果页不再展示六维评分、可信度、确定性硬条件核对、不匹配/风险/缺失信息的四个重复分区或单独的沟通建议分区。

## 3. 评分与证据规则

- 模型必须读取已确认画像内每条要求的 `priority` 与 `weight`；`hard`、`preferred`、`standard` 只影响评分重要性，不触发一票否决或推荐上限。
- 未提供的信息进入 `concerns` 或 `verificationQuestions`，不得仅因缺失直接扣分。
- 每条匹配理由和顾虑必须同时提供岗位侧依据与候选人侧依据；缺失信息的候选人依据应明确写出哪个候选人材料区段未提供。
- 年龄、性别、民族、婚育等受保护特征不得参与评分或联系建议。
- 不得把推测写成事实；证据只能来自已确认岗位画像和脱敏候选人草稿。
- 每个 `jobEvidence` / `candidateEvidence` 最多 2 条；理由、证据和核实问题每条最多 300 字符，猎头结论最多 600 字符。协议用这些边界约束冗长输出，但不降低 `max_tokens: 8192` 的请求上限。

## 4. 模型与供应商边界

- `ModelProvider` 仍保留岗位画像生成与候选人分析两个供应商中立操作。
- `CandidateMatchInput` 只包含 `recruitmentProfile` 和 `candidateDraft`。
- DeepSeek 适配器在 `analyzeCandidate` 内选择 `deepseek-v4-flash`，不改变保存的设置，也不影响 `generateRecruitmentProfile` 使用用户所选模型。
- Flash 选择属于 DeepSeek 适配器策略；未来供应商可在自己的适配器内映射到等价快速模型，核心管线不出现 DeepSeek 模型名。
- 空输出、截断或协议不合法时以同一 Flash 模型修复一次；第二次失败返回统一 `INVALID_MODEL_OUTPUT`。

## 5. 隐私与状态

- 候选人草稿在调用供应商前继续执行姓名、电话、邮箱、猎聘 URL 和候选人/简历/档案 ID 脱敏。
- 原始 JD、个性化要求、候选人 URL 与本地规则证据均不进入候选人请求。
- 候选人请求、结果和取消状态仍只存在内存，不进入 IndexedDB、`chrome.storage`、日志或遥测。
- 岗位画像确认、岗位切换、请求 ID、真实 `AbortSignal` 取消、25 秒首包/正文超时与晚到结果忽略机制保持不变。

## 6. 错误与兼容性

- 模型返回超过条数上限、缺少证据、分数越界或推荐枚举不合法时触发一次修复请求。
- Flash 不可用时显示模型不可用错误；不静默回退到 Pro，以免速度策略失效。
- 分析结果是会话瞬态数据，不需要迁移旧结果。已保存岗位与画像结构保持兼容。
- 设置页明确说明：所选模型用于岗位画像，候选人分析固定使用 DeepSeek V4 Flash。

## 7. 验证标准

- 合成候选人请求的 `model` 必须为 `deepseek-v4-flash`，岗位画像请求仍使用设置值。
- 候选人请求 `max_tokens` 必须为 `8192`，`thinking` 继续关闭，JSON 模式和一次修复重试继续生效。
- 候选人提示词不包含 `criteria`、`ruleEvaluations`、原始 JD、个性化要求、姓名、联系方式、猎聘 URL 或 ID。
- 模型协议严格接受 2–5 条匹配、0–3 条顾虑和 0–3 个问题，拒绝越界、无双侧证据或越界分数。
- UI 只展示轻量结果字段与三档联系文案，不出现六维评分或一票否决表达。
- 全量类型检查、测试、生产构建、ZIP 内容与静态隐私检查通过；真实 DeepSeek 和猎聘页面仍由用户手动验收。
