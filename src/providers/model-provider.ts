import type { CandidateDraft } from "../shared/contracts/candidate";
import type { Job } from "../shared/contracts/job";
import type {
  JobCriterion,
  ModelMatchResult,
  RuleEvaluation
} from "../shared/contracts/matching";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import { appErrorCodeSchema, type AppError, type AppErrorCode } from "../shared/errors";

export interface MatchInput {
  job: Job;
  candidateDraft: CandidateDraft;
  criteria: readonly JobCriterion[];
  ruleEvaluations: readonly RuleEvaluation[];
}

export interface ProviderModelMetadata {
  id: string;
  label: string;
}

export interface ModelProvider {
  id: string;
  models: readonly ProviderModelMetadata[];
  validateCredentials(settings: ProviderSettings): Promise<void>;
  analyze(
    input: MatchInput,
    settings: ProviderSettings,
    signal?: AbortSignal
  ): Promise<ModelMatchResult>;
}

const errorMessages: Record<AppErrorCode, string> = {
  UNSUPPORTED_PAGE: "当前页面不受支持。",
  EXTRACTION_FAILED: "候选人信息提取失败。",
  MISSING_API_KEY: "请先配置模型 API Key。",
  INVALID_API_KEY: "模型 API Key 无效，请检查后重试。",
  INVALID_PROVIDER_SETTINGS: "模型供应商或模型配置已失效，请重新配置。",
  RATE_LIMITED: "模型请求过于频繁，请稍后重试。",
  INSUFFICIENT_BALANCE: "模型账户余额不足，请充值后重试。",
  MODEL_TIMEOUT: "模型响应超时，请重试。",
  ANALYSIS_CANCELLED: "本次分析已取消。",
  INVALID_MODEL_OUTPUT: "模型返回内容无法验证，请重试。",
  STORAGE_FAILED: "扩展设置读取失败。",
  UNKNOWN: "模型服务暂时不可用，请稍后重试。"
};

export class NormalizedProviderError extends Error {
  constructor(readonly code: AppErrorCode, message = errorMessages[code]) {
    super(message);
    this.name = "NormalizedProviderError";
  }
}

export function mapModelProviderError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "code" in error) {
    const parsedCode = appErrorCodeSchema.safeParse((error as { code?: unknown }).code);
    if (parsedCode.success) {
      return { code: parsedCode.data, message: errorMessages[parsedCode.data] };
    }
  }

  return { code: "UNKNOWN", message: errorMessages.UNKNOWN };
}

export class ModelProviderRegistry {
  private readonly providers: ReadonlyMap<string, ModelProvider>;

  constructor(providers: readonly ModelProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  get(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }
}
