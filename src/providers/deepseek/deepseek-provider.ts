import { appErrorCodeSchema, type AppError, type AppErrorCode } from "../../shared/errors";
import {
  modelMatchResultSchema,
  type ModelMatchResult
} from "../../shared/contracts/matching";
import type { ProviderSettings } from "../../repositories/chrome-provider-settings";
import type { MatchInput, ModelProvider } from "../model-provider";
import { buildAnalysisPrompt } from "./prompt";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const API_BASE = "https://api.deepseek.com";
const TIMEOUT_MS = 60_000;
const REPAIR_INSTRUCTION = "上一次输出为空、被截断或不符合约定协议。请修复错误，并仅返回一个字段完整、可解析且符合协议的完整 JSON 对象。";

const errorMessages: Record<AppErrorCode, string> = {
  UNSUPPORTED_PAGE: "当前页面不受支持。",
  EXTRACTION_FAILED: "候选人信息提取失败。",
  MISSING_API_KEY: "请先配置 DeepSeek API Key。",
  INVALID_API_KEY: "DeepSeek API Key 无效，请检查后重试。",
  INVALID_PROVIDER_SETTINGS: "模型供应商或模型配置已失效，请重新配置。",
  RATE_LIMITED: "DeepSeek 请求过于频繁，请稍后重试。",
  INSUFFICIENT_BALANCE: "DeepSeek 账户余额不足，请充值后重试。",
  MODEL_TIMEOUT: "DeepSeek 响应超时，请重试。",
  INVALID_MODEL_OUTPUT: "模型返回内容无法验证，请重试。",
  STORAGE_FAILED: "模型设置读取失败。",
  UNKNOWN: "模型服务暂时不可用，请稍后重试。"
};

export class ProviderError extends Error {
  constructor(readonly code: AppErrorCode, message = errorMessages[code]) {
    super(message);
    this.name = "ProviderError";
  }
}

export function mapProviderError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "code" in error) {
    const parsedCode = appErrorCodeSchema.safeParse((error as { code?: unknown }).code);
    if (parsedCode.success) {
      return { code: parsedCode.data, message: errorMessages[parsedCode.data] };
    }
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "MODEL_TIMEOUT", message: errorMessages.MODEL_TIMEOUT };
  }

  return { code: "UNKNOWN", message: errorMessages.UNKNOWN };
}

function errorCodeFromResponse(status: number, payload: unknown): AppErrorCode {
  if (status === 401 || status === 403) return "INVALID_API_KEY";
  if (status === 429) return "RATE_LIMITED";
  if (status === 402) return "INSUFFICIENT_BALANCE";

  const error = typeof payload === "object" && payload !== null && "error" in payload
    ? (payload as { error?: unknown }).error
    : undefined;
  const details = typeof error === "object" && error !== null
    ? `${String((error as { code?: unknown }).code ?? "")} ${String((error as { message?: unknown }).message ?? "")}`.toLowerCase()
    : "";

  if (details.includes("insufficient_balance") || details.includes("insufficient balance") || details.includes("余额不足")) {
    return "INSUFFICIENT_BALANCE";
  }
  return "UNKNOWN";
}

async function providerErrorFromResponse(response: Response): Promise<ProviderError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return new ProviderError(errorCodeFromResponse(response.status, payload));
}

function parseCompletion(payload: unknown): ModelMatchResult {
  const choice = typeof payload === "object" && payload !== null && "choices" in payload
    ? (payload as { choices?: unknown }).choices
    : undefined;
  const firstChoice = Array.isArray(choice) ? choice[0] : undefined;

  if (typeof firstChoice !== "object" || firstChoice === null) {
    throw new ProviderError("INVALID_MODEL_OUTPUT");
  }
  if ((firstChoice as { finish_reason?: unknown }).finish_reason === "length") {
    throw new ProviderError("INVALID_MODEL_OUTPUT");
  }

  const message = (firstChoice as { message?: unknown }).message;
  const content = typeof message === "object" && message !== null
    ? (message as { content?: unknown }).content
    : undefined;
  if (typeof content !== "string" || content.trim() === "") {
    throw new ProviderError("INVALID_MODEL_OUTPUT");
  }

  try {
    return modelMatchResultSchema.parse(JSON.parse(content));
  } catch {
    throw new ProviderError("INVALID_MODEL_OUTPUT");
  }
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = "deepseek" as const;
  readonly models = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;

  constructor(private readonly fetcher: Fetcher = fetch) {}

  async validateCredentials(settings: ProviderSettings): Promise<void> {
    this.requireApiKey(settings);
    this.requireSupportedModel(settings);
    await this.fetchWithTimeout(`${API_BASE}/models`, {
      method: "GET",
      headers: this.headers(settings)
    }, async (response) => {
      if (!response.ok) {
        throw await providerErrorFromResponse(response);
      }
    });
  }

  async analyze(input: MatchInput, settings: ProviderSettings): Promise<ModelMatchResult> {
    this.requireApiKey(settings);
    this.requireSupportedModel(settings);
    const prompt = buildAnalysisPrompt(input);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const messages = [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ];
      if (attempt === 1) {
        messages.push({ role: "user", content: REPAIR_INSTRUCTION });
      }

      try {
        const payload = await this.fetchWithTimeout(`${API_BASE}/chat/completions`, {
          method: "POST",
          headers: this.headers(settings),
          body: JSON.stringify({
            model: settings.model,
            messages,
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
            max_tokens: 8192
          })
        }, async (response) => {
          if (!response.ok) {
            throw await providerErrorFromResponse(response);
          }

          try {
            return await response.json();
          } catch {
            throw new ProviderError("INVALID_MODEL_OUTPUT");
          }
        });
        return parseCompletion(payload);
      } catch (error) {
        if (!(error instanceof ProviderError) || error.code !== "INVALID_MODEL_OUTPUT" || attempt === 1) {
          throw error;
        }
      }
    }

    throw new ProviderError("INVALID_MODEL_OUTPUT");
  }

  private requireApiKey(settings: ProviderSettings): void {
    if (settings.apiKey.trim() === "") {
      throw new ProviderError("MISSING_API_KEY");
    }
  }

  private requireSupportedModel(settings: ProviderSettings): void {
    if (!this.models.some((model) => model === settings.model)) {
      throw new ProviderError("INVALID_PROVIDER_SETTINGS");
    }
  }

  private headers(settings: ProviderSettings): Record<string, string> {
    return {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    };
  }

  private async fetchWithTimeout<T>(
    url: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderError("MODEL_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
