import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeepSeekProvider,
  mapProviderError
} from "../../src/providers/deepseek/deepseek-provider";
import {
  ModelProviderRegistry,
  type CandidateMatchInput,
  type JobProfileInput,
  type ModelProvider
} from "../../src/providers/model-provider";
import {
  type ModelMatchResult
} from "../../src/shared/contracts/matching";
import type {
  ModelRecruitmentProfile,
  ConfirmedRecruitmentProfile
} from "../../src/shared/contracts/recruitment-profile";

const settings = {
  providerId: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-test"
};

const confirmedProfile: ConfirmedRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品",
  requirements: [{
    id: "c-1",
    text: "五年产品经验",
    priority: "hard",
    dimensionId: "functional_expertise",
    weight: 100,
    jobEvidence: ["岗位要求五年产品经验"]
  }],
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: [],
  confirmedAt: "2026-08-19T00:00:00.000Z"
};

const input: CandidateMatchInput = {
  recruitmentProfile: confirmedProfile,
  candidateDraft: {
    basics: { text: "候选人，上海", status: "complete" },
    workExperience: { text: "五年企业软件产品经验", status: "complete" },
    projects: { text: "负责产品上线", status: "complete" },
    education: { text: "本科", status: "complete" },
    skills: { text: "需求分析", status: "complete" },
    other: { text: "", status: "missing" },
    extractionConfidence: "high"
  }
};

const jobProfileInput: JobProfileInput = {
  company: "虚构甲公司",
  jd: "负责虚构企业软件产品，要求五年产品经验",
  customRequirements: "企业软件经验优先"
};

const modelProfile: ModelRecruitmentProfile = {
  version: 1,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件产品",
  requirements: [{
    id: "requirement-1",
    text: "五年产品经验",
    priority: "hard",
    dimensionId: "functional_expertise",
    weight: 100,
    jobEvidence: ["要求五年产品经验"]
  }],
  acceptableAlternatives: [],
  ambiguities: [],
  verificationQuestions: []
};

const modelResult: ModelMatchResult = {
  overallScore: 90,
  recommendation: "contact",
  matches: [{
    claim: "产品经验匹配",
    jobEvidence: ["岗位要求五年产品经验"],
    candidateEvidence: ["候选人有五年企业软件产品经验"]
  }, {
    claim: "交付经验匹配",
    jobEvidence: ["岗位要求负责企业软件产品交付"],
    candidateEvidence: ["候选人负责过产品上线"]
  }],
  concerns: [],
  verificationQuestions: ["请核实团队协作范围"],
  recruiterConclusion: "建议联系并核实团队协作范围"
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
  vi.unstubAllGlobals();
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

  it("invokes the default browser fetch with the global receiver", async () => {
    // Break caught: storing global fetch as a class field and calling this.fetcher causes Chrome Illegal invocation.
    const receiverSensitiveFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Promise.resolve(new Response(JSON.stringify({
        object: "list",
        data: [{ id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" }]
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", receiverSensitiveFetch);

    await expect(new DeepSeekProvider().validateCredentials(settings)).resolves.toBeUndefined();
  });

  it("rejects validation when the selected model is absent from the provider model list", async () => {
    // Break caught: treating any successful /models response as valid could save a model the account cannot use.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify({
      object: "list",
      data: [{ id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const error = await caught(new DeepSeekProvider(fetcher).validateCredentials(settings));

    expect(mapProviderError(error)).toMatchObject({
      code: "MODEL_UNAVAILABLE",
      message: expect.stringMatching(/所选模型.*不可用/u)
    });
  });

  it.each([400, 404, 422])("maps HTTP %s to an actionable invalid-request error", async (status) => {
    // Break caught: a rejected request mapped to UNKNOWN would hide a configuration or compatibility problem.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(status, "invalid_request", "Request rejected")
    );

    const error = await caught(new DeepSeekProvider(fetcher).validateCredentials(settings));

    expect(mapProviderError(error)).toMatchObject({
      code: "INVALID_PROVIDER_REQUEST",
      message: expect.stringMatching(/拒绝.*请求/u)
    });
  });

  it.each([500, 503])("maps HTTP %s to an actionable provider-service error", async (status) => {
    // Break caught: a provider outage mapped to UNKNOWN gives no useful distinction from a local network failure.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(status, "service_unavailable", "Provider unavailable")
    );

    const error = await caught(new DeepSeekProvider(fetcher).validateCredentials(settings));

    expect(mapProviderError(error)).toMatchObject({
      code: "PROVIDER_SERVICE_UNAVAILABLE",
      message: expect.stringMatching(/故障或繁忙/u)
    });
  });

  it("maps a failed fetch to an actionable network error", async () => {
    // Break caught: DNS, proxy, firewall, and browser fetch failures must not collapse into an opaque UNKNOWN error.
    const fetcher = vi.fn<Fetcher>().mockRejectedValue(new TypeError("Failed to fetch"));

    const error = await caught(new DeepSeekProvider(fetcher).validateCredentials(settings));

    expect(mapProviderError(error)).toMatchObject({
      code: "NETWORK_FAILED",
      message: expect.stringMatching(/网络、代理或防火墙/u)
    });
  });

  it("generates and validates a recruitment profile with one bounded repair", async () => {
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(JSON.stringify({ recruiterConclusion: "wrong contract" })))
      .mockResolvedValueOnce(completion(JSON.stringify(modelProfile)));

    const result = await new DeepSeekProvider(fetcher)
      .generateRecruitmentProfile(jobProfileInput, settings);

    expect(result).toEqual(modelProfile);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const retryBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(firstBody.messages[1].content).toContain(jobProfileInput.jd);
    expect(firstBody.model).toBe("deepseek-v4-pro");
    expect(firstBody.max_tokens).toBe(4096);
    expect(firstBody.response_format).toEqual({ type: "json_object" });
    expect(retryBody.messages.at(-1).content).toMatch(/上一次.*修复.*完整 JSON/s);
  });

  it("supports a second provider through the same two-operation contract", async () => {
    const fake: ModelProvider = {
      id: "fake-provider",
      models: [{ id: "fake-model", label: "Fake Model" }],
      validateCredentials: vi.fn(async () => undefined),
      generateRecruitmentProfile: vi.fn(async () => modelProfile),
      analyzeCandidate: vi.fn(async () => modelResult)
    };

    expect(await fake.generateRecruitmentProfile!(jobProfileInput, settings)).toEqual(modelProfile);
    expect(await fake.analyzeCandidate!(input, settings)).toEqual(modelResult);
  });

  it("forces candidate analysis to V4 Flash with the approved 8192-token cap", async () => {
    // Break caught: reusing the profile model here would lose the candidate-speed strategy.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(completion(JSON.stringify(modelResult)));

    const result = await new DeepSeekProvider(fetcher).analyzeCandidate(input, settings);
    const init = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));

    expect(result).toEqual(modelResult);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.max_tokens).toBe(8192);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-test" });
  });

  it("rejects an unsupported model before contacting DeepSeek", async () => {
    // Break caught: forwarding an arbitrary stored model id would bypass the adapter's exact V4 allowlist.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(completion(JSON.stringify(modelResult)));

    await expect(new DeepSeekProvider(fetcher).analyzeCandidate(input, {
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

    await expect(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings)).resolves.toEqual(modelResult);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(retryBody.model).toBe("deepseek-v4-flash");
    expect(retryBody.max_tokens).toBe(8192);
    expect(retryBody.messages.at(-1).content).toMatch(/上一次.*修复.*完整 JSON/s);
  });

  it("retries truncated content exactly once", async () => {
    // Break caught: schema-valid partial-looking output with finish_reason=length must not be accepted.
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(JSON.stringify(modelResult), "length"))
      .mockResolvedValueOnce(completion(JSON.stringify(modelResult)));

    await expect(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings)).resolves.toEqual(modelResult);
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

    await expect(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings)).resolves.toEqual(modelResult);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(retryBody.messages.at(-1).content).toMatch(/上一次.*修复.*完整 JSON/s);
  });

  it("returns INVALID_MODEL_OUTPUT after two invalid responses", async () => {
    // Break caught: returning malformed or schema-invalid content would expose partial model scores downstream.
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion("not json"))
      .mockResolvedValueOnce(completion(JSON.stringify({ recruiterConclusion: "不完整" })));

    const error = await caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries and rejects lightweight matches without candidate evidence", async () => {
    // Break caught: a fast response must not trade away auditable two-sided evidence.
    const evidenceFreeResult = {
      ...modelResult,
      matches: modelResult.matches.map((match) => ({ ...match, candidateEvidence: [] }))
    };
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(JSON.stringify(evidenceFreeResult)))
      .mockResolvedValueOnce(completion(JSON.stringify(evidenceFreeResult)));

    const error = await caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("repairs a response with too few matching reasons before accepting the bounded result", async () => {
    // Break caught: accepting one generic reason would violate the lightweight result's minimum usefulness.
    const incomplete = {
      ...modelResult,
      matches: modelResult.matches.slice(0, 1)
    };
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(JSON.stringify(incomplete)))
      .mockResolvedValueOnce(completion(JSON.stringify(modelResult)));

    await expect(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings)).resolves.toEqual(modelResult);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("maps an unavailable Flash candidate model to MODEL_UNAVAILABLE", async () => {
    // Break caught: a forced model that is unavailable must not look like a generic invalid request.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(400, "model_not_found", "deepseek-v4-flash model is unavailable")
    );

    const error = await caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 401 to INVALID_API_KEY without retrying", async () => {
    // Break caught: retrying a rejected credential wastes calls and obscures the required reconfiguration action.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(401, "invalid_api_key", "Authentication Fails")
    );

    const error = await caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INVALID_API_KEY" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP 429 to RATE_LIMITED without output retrying", async () => {
    // Break caught: treating a rate limit as invalid model output would issue an immediate second throttled request.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(429, "rate_limit_exceeded", "Rate limit reached")
    );

    const error = await caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "RATE_LIMITED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("maps insufficient balance responses to INSUFFICIENT_BALANCE", async () => {
    // Break caught: a billing failure mapped to UNKNOWN would send recruiters down the wrong recovery path.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(402, "insufficient_balance", "Insufficient Balance")
    );

    const error = await caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recognizes an insufficient-balance payload even when the provider uses HTTP 400", async () => {
    // Break caught: checking generic 4xx before the provider error payload could mislabel a billing recovery action.
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      apiError(400, "insufficient_balance", "Insufficient Balance")
    );

    const error = await caught(new DeepSeekProvider(fetcher).validateCredentials(settings));

    expect(mapProviderError(error)).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("aborts before 30 seconds when response headers do not arrive", async () => {
    // Break caught: a 60-second first-response timer can outlive the MV3 service worker event budget.
    vi.useFakeTimers();
    const fetcher = vi.fn<Fetcher>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    }));
    const errorPromise = caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings));

    await vi.advanceTimersByTimeAsync(25_000);
    const error = await errorPromise;

    expect(mapProviderError(error)).toMatchObject({ code: "MODEL_TIMEOUT" });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("uses a separate bounded timer while reading the response body", async () => {
    // Break caught: clearing the header timer without a body timer leaves response.json able to hang forever.
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
    const errorPromise = caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings))
      .then((error) => {
        settled = true;
        return error;
      });

    await vi.advanceTimersByTimeAsync(25_000);

    expect(settled).toBe(true);
    expect(mapProviderError(await errorPromise)).toMatchObject({ code: "MODEL_TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("honors caller cancellation during the initial request", async () => {
    // Break caught: hiding AbortController inside the adapter makes the UI cancel button cosmetic.
    const external = new AbortController();
    const fetcher = vi.fn<Fetcher>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
    }));
    const errorPromise = caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings, external.signal));

    external.abort();

    expect(mapProviderError(await errorPromise)).toMatchObject({ code: "ANALYSIS_CANCELLED" });
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("does not start a request when the caller signal is already cancelled", async () => {
    // Break caught: a boundary cancellation racing just before fetch must not issue a provider request.
    const external = new AbortController();
    external.abort();
    const fetcher = vi.fn<Fetcher>();

    const error = await caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings, external.signal));

    expect(mapProviderError(error)).toMatchObject({ code: "ANALYSIS_CANCELLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("honors caller cancellation during the repair request", async () => {
    // Break caught: cancellation forwarded only to the first fetch can still send or hang the automatic repair call.
    const external = new AbortController();
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(completion(""))
      .mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
      }));
    const errorPromise = caught(new DeepSeekProvider(fetcher).analyzeCandidate(input, settings, external.signal));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    external.abort();

    expect(mapProviderError(await errorPromise)).toMatchObject({ code: "ANALYSIS_CANCELLED" });
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
