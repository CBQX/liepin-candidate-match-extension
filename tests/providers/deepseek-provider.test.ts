import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeepSeekProvider,
  mapProviderError
} from "../../src/providers/deepseek/deepseek-provider";
import {
  ModelProviderRegistry,
  type MatchInput
} from "../../src/providers/model-provider";
import type { ModelMatchResult } from "../../src/shared/contracts/matching";

const settings = {
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-test"
};

const input: MatchInput = {
  job: {
    id: "job-1",
    company: "甲公司",
    jd: "五年产品经验",
    customRequirements: "企业软件经验优先",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z"
  },
  candidateDraft: {
    basics: { text: "候选人，上海", status: "complete" },
    workExperience: { text: "五年企业软件产品经验", status: "complete" },
    projects: { text: "负责产品上线", status: "complete" },
    education: { text: "本科", status: "complete" },
    skills: { text: "需求分析", status: "complete" },
    other: { text: "", status: "missing" },
    extractionConfidence: "high"
  },
  criteria: [{ id: "c-1", text: "五年产品经验", priority: "hard", source: "jd" }],
  ruleEvaluations: [{ criterionId: "c-1", status: "met", evidence: ["五年企业软件产品经验"] }]
};

const modelResult: ModelMatchResult = {
  dimensionScores: [{
    dimensionId: "hard_requirements",
    score: 90,
    evidence: ["候选人明确具备五年产品经验"]
  }],
  matches: [{
    claim: "产品经验匹配",
    jobEvidence: ["岗位要求五年产品经验"],
    candidateEvidence: ["候选人有五年企业软件产品经验"]
  }],
  mismatches: [],
  risks: [],
  missingInformation: [],
  verificationQuestions: ["请核实团队协作范围"],
  outreachAdvice: ["从企业软件经验切入"],
  recruiterConclusion: "建议推进"
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function completion(content: unknown, finishReason = "stop"): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1_776_643_200,
    model: "deepseek-v4-pro",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: finishReason
    }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 }
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({
    error: { message, type: "invalid_request_error", param: null, code }
  }), { status, headers: { "Content-Type": "application/json" } });
}

async function caught(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    throw new Error("Expected operation to reject");
  } catch (error) {
    return error;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DeepSeekProvider", () => {
  it("resolves the registered DeepSeek adapter by provider id", () => {
    // Break caught: a registry keyed incorrectly would make stored provider settings impossible to validate.
    const provider = new DeepSeekProvider(vi.fn<Fetcher>());
    const registry = new ModelProviderRegistry([provider]);

    expect(registry.get("deepseek")).toBe(provider);
    expect(registry.get("unregistered")).toBeUndefined();
  });

  it("validates a key with GET /models", async () => {
    // Break caught: using the chat endpoint or omitting bearer auth would make credential checks unreliable.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify({
      object: "list",
      data: [{ id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" }]
    }), { status: 200 }));

    await new DeepSeekProvider(fetcher).validateCredentials(settings);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" })
      })
    );
  });

  it("requests strict JSON analysis with the selected V4 model", async () => {
    // Break caught: losing any DeepSeek JSON-mode parameter could return prose or use the wrong cost/quality model.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(completion(JSON.stringify(modelResult)));

    const result = await new DeepSeekProvider(fetcher).analyze(input, settings);
    const init = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));

    expect(result).toEqual(modelResult);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("deepseek-v4-pro");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test" });
  });

  it("rejects an unsupported model before contacting DeepSeek", async () => {
    // Break caught: forwarding an arbitrary stored model id would bypass the adapter's exact V4 allowlist.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(completion(JSON.stringify(modelResult)));

    await expect(new DeepSeekProvider(fetcher).analyze(input, {
      ...settings,
      model: "deepseek-v3"
    })).rejects.toMatchObject({ code: "INVALID_PROVIDER_SETTINGS" });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries empty content exactly once with a repair instruction", async () => {
    // Break caught: accepting empty JSON-mode output or retrying without a strict bound can hide failures or loop.
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(""))
      .mockResolvedValueOnce(completion(JSON.stringify(modelResult)));

    await expect(new DeepSeekProvider(fetcher).analyze(input, settings)).resolves.toEqual(modelResult);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(retryBody.messages.at(-1).content).toMatch(/上一次.*修复.*完整 JSON/s);
  });

  it("retries truncated content exactly once", async () => {
    // Break caught: schema-valid partial-looking output with finish_reason=length must not be accepted.
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(JSON.stringify(modelResult), "length"))
      .mockResolvedValueOnce(completion(JSON.stringify(modelResult)));

    await expect(new DeepSeekProvider(fetcher).analyze(input, settings)).resolves.toEqual(modelResult);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a malformed successful response envelope exactly once", async () => {
    // Break caught: a Response.json SyntaxError must enter the bounded repair path instead of escaping as UNKNOWN.
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(completion(JSON.stringify(modelResult)));

    await expect(new DeepSeekProvider(fetcher).analyze(input, settings)).resolves.toEqual(modelResult);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(retryBody.messages.at(-1).content).toMatch(/上一次.*修复.*完整 JSON/s);
  });

  it("returns INVALID_MODEL_OUTPUT after two invalid responses", async () => {
    // Break caught: returning malformed or schema-invalid content would expose partial model scores downstream.
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion("not json"))
      .mockResolvedValueOnce(completion(JSON.stringify({ recruiterConclusion: "不完整" })));

    const error = await caught(new DeepSeekProvider(fetcher).analyze(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries and rejects dimension scores without evidence", async () => {
    // Break caught: structurally present but evidence-free scores could bypass the provider repair path.
    const evidenceFreeResult = {
      ...modelResult,
      dimensionScores: modelResult.dimensionScores.map((dimension) => ({
        ...dimension,
        evidence: []
      }))
    };
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(JSON.stringify(evidenceFreeResult)))
      .mockResolvedValueOnce(completion(JSON.stringify(evidenceFreeResult)));

    const error = await caught(new DeepSeekProvider(fetcher).analyze(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("maps HTTP 401 to INVALID_API_KEY without retrying", async () => {
    // Break caught: retrying a rejected credential wastes calls and obscures the required reconfiguration action.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(401, "invalid_api_key", "Authentication Fails")
    );

    const error = await caught(new DeepSeekProvider(fetcher).analyze(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INVALID_API_KEY" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 429 to RATE_LIMITED without output retrying", async () => {
    // Break caught: treating a rate limit as invalid model output would issue an immediate second throttled request.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(429, "rate_limit_exceeded", "Rate limit reached")
    );

    const error = await caught(new DeepSeekProvider(fetcher).analyze(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "RATE_LIMITED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps insufficient balance responses to INSUFFICIENT_BALANCE", async () => {
    // Break caught: a billing failure mapped to UNKNOWN would send recruiters down the wrong recovery path.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(402, "insufficient_balance", "Insufficient Balance")
    );

    const error = await caught(new DeepSeekProvider(fetcher).analyze(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("aborts analysis after 60 seconds and maps the timeout", async () => {
    // Break caught: omitting the abort timer can leave the MV3 request and UI progress state hanging indefinitely.
    vi.useFakeTimers();
    const fetcher = vi.fn<Fetcher>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    }));
    const errorPromise = caught(new DeepSeekProvider(fetcher).analyze(input, settings));

    await vi.advanceTimersByTimeAsync(60_000);
    const error = await errorPromise;

    expect(mapProviderError(error)).toMatchObject({ code: "MODEL_TIMEOUT" });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("keeps the 60-second timeout active while reading the response body", async () => {
    // Break caught: clearing the timer after headers arrive leaves response.json able to hang forever.
    vi.useFakeTimers();
    const fetcher = vi.fn<Fetcher>().mockImplementation((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("The operation was aborted", "AbortError"));
          });
        }
      });
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    });
    let settled = false;
    const errorPromise = caught(new DeepSeekProvider(fetcher).analyze(input, settings))
      .then((error) => {
        settled = true;
        return error;
      });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(settled).toBe(true);
    expect(mapProviderError(await errorPromise)).toMatchObject({ code: "MODEL_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("rejects a blank key before contacting DeepSeek", async () => {
    // Break caught: sending an empty bearer token leaks an avoidable request and produces a misleading auth response.
    const fetcher = vi.fn<Fetcher>();

    const error = await caught(new DeepSeekProvider(fetcher).validateCredentials({
      ...settings,
      apiKey: "  "
    }));

    expect(mapProviderError(error)).toMatchObject({ code: "MISSING_API_KEY" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
