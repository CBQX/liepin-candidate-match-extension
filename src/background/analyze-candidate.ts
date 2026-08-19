import type { ModelProvider } from "../providers/model-provider";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import type { CandidateDraft } from "../shared/contracts/candidate";
import type { CandidateRedactionContext } from "../shared/contracts/candidate";
import type { Job } from "../shared/contracts/job";
import {
  matchAnalysisSchema,
  modelMatchResultSchema,
  type MatchAnalysis
} from "../shared/contracts/matching";
import type { AppErrorCode } from "../shared/errors";

export interface AnalyzeCandidateRequest {
  job: Job;
  candidateDraft: CandidateDraft;
  redactionContext: CandidateRedactionContext;
}

export interface AnalyzeCandidateDependencies {
  provider: ModelProvider;
  settings: ProviderSettings | undefined;
  redact(draft: CandidateDraft, context: CandidateRedactionContext): CandidateDraft;
  signal?: AbortSignal;
}

class AnalysisPipelineError extends Error {
  constructor(readonly code: AppErrorCode) {
    super(code);
    this.name = "AnalysisPipelineError";
  }
}

export async function analyzeCandidate(
  request: AnalyzeCandidateRequest,
  deps: AnalyzeCandidateDependencies
): Promise<MatchAnalysis> {
  if (!deps.settings || deps.settings.apiKey.trim() === "") {
    throw new AnalysisPipelineError("MISSING_API_KEY");
  }
  const recruitmentProfile = request.job.recruitmentProfile;
  if (!recruitmentProfile) {
    throw new AnalysisPipelineError("JOB_PROFILE_REQUIRED");
  }
  if (!deps.provider.analyzeCandidate) {
    throw new AnalysisPipelineError("INVALID_PROVIDER_SETTINGS");
  }

  const cleanCandidate = deps.redact(request.candidateDraft, request.redactionContext);
  const modelResult = await deps.provider.analyzeCandidate(
    {
      recruitmentProfile,
      candidateDraft: cleanCandidate
    },
    deps.settings,
    deps.signal
  );
  try {
    const validatedModelResult = modelMatchResultSchema.parse(modelResult);
    return matchAnalysisSchema.parse(validatedModelResult);
  } catch {
    throw new AnalysisPipelineError("INVALID_MODEL_OUTPUT");
  }
}
