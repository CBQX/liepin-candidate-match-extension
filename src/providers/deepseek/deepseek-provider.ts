import type { AppErrorCode } from "../../shared/errors";
import type { ZodType } from "zod";
import {
  modelMatchResultSchema,
  type ModelMatchResult
} from "../../shared/contracts/matching";
import {
  modelRecruitmentProfileSchema,
  type ModelRecruitmentProfile
} from "../../shared/contracts/recruitment-profile";
import type { ProviderSettings } from "../../repositories/chrome-provider-settings";
import {
  mapModelProviderError,
  NormalizedProviderError,
  type CandidateMatchInput,
  type JobProfileInput,
  type ModelProvider
} from "../model-provider";
import { buildJobProfilePrompt } from "./job-profile-prompt";
import { buildAnalysisPrompt, type AnalysisPrompt } from "./prompt";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const API_BASE = "https://api.deepseek.com";
const HEADER_TIMEOUT_MS = 25_000;
const BODY_TIMEOUT_MS = 25_000;
const CANDIDATE_MODEL = "deepseek-v4-flash";
const REPAIR_INSTRUCTION = "上一次输出为空、被截断或不符合约定协议。请修复错误，并仅返回一个字段完整、可解析且符合协议的完整 JSON 对象。";

export { mapModelProviderError as mapProviderError };

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
  if (
    details.includes("model")
    && /not[_ ]found|unavailable|does not exist|不可用/u.test(details)
  ) {
    return "MODEL_UNAVAILABLE";
  }
  if (status >= 500) return "PROVIDER_SERVICE_UNAVAILABLE";
  if (status >= 400) return "INVALID_PROVIDER_REQUEST";
  return "UNKNOWN";
}

function modelIdsFromResponse(payload: unknown): string[] | undefined {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) {
    return undefined;
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;

  const ids = data.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const id = (entry as { id?: unknown }).id;
    return typeof id === "string" && id.trim() !== "" ? [id] : [];
  });
  return ids.length === data.length ? ids : undefined;
}

async function providerErrorFromResponse(response: Response): Promise<NormalizedProviderError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return new NormalizedProviderError(errorCodeFromResponse(response.status, payload));
}

function parseCompletion<T>(payload: unknown, schema: ZodType<T>): T {
  const choice = typeof payload === "object" && payload !== null && "choices" in payload
    ? (payload as { choices?: unknown }).choices
    : undefined;
  const firstChoice = Array.isArray(choice) ? choice[0] : undefined;

  if (typeof firstChoice !== "object" || firstChoice === null) {
    throw new NormalizedProviderError("INVALID_MODEL_OUTPUT");
  }
  if ((firstChoice as { finish_reason?: unknown }).finish_reason === "length") {
    throw new NormalizedProviderError("INVALID_MODEL_OUTPUT");
  }

  const message = (firstChoice as { message?: unknown }).message;
  const content = typeof message === "object" && message !== null
    ? (message as { content?: unknown }).content
    : undefined;
  if (typeof content !== "string" || content.trim() === "") {
    throw new NormalizedProviderError("INVALID_MODEL_OUTPUT");
  }

  try {
    return schema.parse(JSON.parse(content));
  } catch {
    throw new NormalizedProviderError("INVALID_MODEL_OUTPUT");
  }
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = "deepseek" as const;
  readonly models = [
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }
  ] as const;

  constructor(
    private readonly fetcher: Fetcher = (input, init) => globalThis.fetch(input, init)
  ) {}

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

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new NormalizedProviderError("PROVIDER_SERVICE_UNAVAILABLE");
      }
      const modelIds = modelIdsFromResponse(payload);
      if (!modelIds) {
        throw new NormalizedProviderError("PROVIDER_SERVICE_UNAVAILABLE");
      }
      if (!modelIds.includes(settings.model)) {
        throw new NormalizedProviderError("MODEL_UNAVAILABLE");
      }
    });
  }

  async generateRecruitmentProfile(
    input: JobProfileInput,
    settings: ProviderSettings,
    signal?: AbortSignal
  ): Promise<ModelRecruitmentProfile> {
    return this.requestStructured(
      buildJobProfilePrompt(input),
      modelRecruitmentProfileSchema,
      settings,
      signal,
      4096,
      settings.model
    );
  }

  async analyzeCandidate(
    input: CandidateMatchInput,
    settings: ProviderSettings,
    signal?: AbortSignal
  ): Promise<ModelMatchResult> {
    return this.requestStructured(
      buildAnalysisPrompt(input),
      modelMatchResultSchema,
      settings,
      signal,
      8192,
      CANDIDATE_MODEL
    );
  }

  private async requestStructured<T>(
    prompt: AnalysisPrompt,
    schema: ZodType<T>,
    settings: ProviderSettings,
    signal: AbortSignal | undefined,
    maxTokens: number,
    requestModel: string
  ): Promise<T> {
    this.requireApiKey(settings);
    this.requireSupportedModel(settings);

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
            model: requestModel,
            messages,
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
            max_tokens: maxTokens
          })
        }, async (response) => {
          if (!response.ok) {
            throw await providerErrorFromResponse(response);
          }

          try {
            return await response.json();
          } catch {
            throw new NormalizedProviderError("INVALID_MODEL_OUTPUT");
          }
        }, signal);
        return parseCompletion(payload, schema);
      } catch (error) {
        if (
          !(error instanceof NormalizedProviderError)
          || error.code !== "INVALID_MODEL_OUTPUT"
          || attempt === 1
        ) {
          throw error;
        }
      }
    }

    throw new NormalizedProviderError("INVALID_MODEL_OUTPUT");
  }

  private requireApiKey(settings: ProviderSettings): void {
    if (settings.apiKey.trim() === "") {
      throw new NormalizedProviderError("MISSING_API_KEY");
    }
  }

  private requireSupportedModel(settings: ProviderSettings): void {
    if (!this.models.some((model) => model.id === settings.model)) {
      throw new NormalizedProviderError("INVALID_PROVIDER_SETTINGS");
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
    consume: (response: Response) => Promise<T>,
    externalSignal?: AbortSignal
  ): Promise<T> {
    const controller = new AbortController();
    let abortReason: "timeout" | "cancelled" | undefined;
    const abortForCancellation = () => {
      abortReason = "cancelled";
      controller.abort();
    };
    if (externalSignal?.aborted) abortForCancellation();
    else externalSignal?.addEventListener("abort", abortForCancellation, { once: true });

    if (controller.signal.aborted) {
      externalSignal?.removeEventListener("abort", abortForCancellation);
      throw new NormalizedProviderError("ANALYSIS_CANCELLED");
    }

    const startTimeout = (milliseconds: number) => setTimeout(() => {
      abortReason ??= "timeout";
      controller.abort();
    }, milliseconds);
    let timeout = startTimeout(HEADER_TIMEOUT_MS);

    try {
      const response = await this.fetcher(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      timeout = startTimeout(BODY_TIMEOUT_MS);
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new NormalizedProviderError(
          abortReason === "cancelled" ? "ANALYSIS_CANCELLED" : "MODEL_TIMEOUT"
        );
      }
      if (error instanceof TypeError) {
        throw new NormalizedProviderError("NETWORK_FAILED");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortForCancellation);
    }
  }
}
