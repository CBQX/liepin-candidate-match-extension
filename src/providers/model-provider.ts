import type { CandidateDraft } from "../shared/contracts/candidate";
import type { Job } from "../shared/contracts/job";
import type {
  ConfirmedRecruitmentProfile,
  ModelRecruitmentProfile
} from "../shared/contracts/recruitment-profile";
import type {
  ModelMatchResult
} from "../shared/contracts/matching";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import { appErrorCodeSchema, type AppError, type AppErrorCode } from "../shared/errors";

export type JobProfileInput = Pick<Job, "company" | "jd" | "customRequirements">;

export interface CandidateMatchInput {
  recruitmentProfile: ConfirmedRecruitmentProfile;
  candidateDraft: CandidateDraft;
}

export interface ProviderModelMetadata {
  id: string;
  label: string;
}

export interface ModelProvider {
  id: string;
  models: readonly ProviderModelMetadata[];
  validateCredentials(settings: ProviderSettings): Promise<void>;
  generateRecruitmentProfile(
    input: JobProfileInput,
    settings: ProviderSettings,
    signal?: AbortSignal
  ): Promise<ModelRecruitmentProfile>;
  analyzeCandidate(
    input: CandidateMatchInput,
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
  INVALID_PROVIDER_REQUEST: "模型服务拒绝了当前请求，请更新插件或重新配置模型。",
  MODEL_UNAVAILABLE: "所选模型当前不可用，请切换模型后重试。",
  NETWORK_FAILED: "无法连接模型服务，请检查网络、代理或防火墙后重试。",
  PROVIDER_SERVICE_UNAVAILABLE: "模型服务正在故障或繁忙，请稍后重试。",
  RATE_LIMITED: "模型请求过于频繁，请稍后重试。",
  INSUFFICIENT_BALANCE: "模型账户余额不足，请充值后重试。",
  MODEL_TIMEOUT: "模型响应超时，请重试。",
  ANALYSIS_CANCELLED: "本次分析已取消。",
  INVALID_MODEL_OUTPUT: "模型返回内容无法验证，请重试。",
  JOB_PROFILE_REQUIRED: "请先生成并确认岗位画像。",
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
