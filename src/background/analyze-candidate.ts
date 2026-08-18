import { composeAnalysis } from "../domain/matching/compose-analysis";
import { extractObjectiveFacts } from "../domain/matching/facts";
import { parseJobCriteria } from "../domain/matching/requirements";
import { evaluateObjectiveRules } from "../domain/matching/rules";
import type { ModelProvider } from "../providers/model-provider";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import type { CandidateDraft } from "../shared/contracts/candidate";
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
}

export interface AnalyzeCandidateDependencies {
  provider: ModelProvider;
  settings: ProviderSettings | undefined;
  redact(draft: CandidateDraft): CandidateDraft;
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

  const cleanCandidate = deps.redact(request.candidateDraft);
  const criteria = parseJobCriteria(request.job);
  const facts = extractObjectiveFacts(cleanCandidate);
  const ruleEvaluations = evaluateObjectiveRules(criteria, facts);
  const modelResult = await deps.provider.analyze(
    { job: request.job, candidateDraft: cleanCandidate, criteria, ruleEvaluations },
    deps.settings
  );
  try {
    const validatedModelResult = modelMatchResultSchema.parse(modelResult);
    return matchAnalysisSchema.parse(composeAnalysis(
      validatedModelResult,
      ruleEvaluations,
      cleanCandidate.extractionConfidence
    ));
  } catch {
    throw new AnalysisPipelineError("INVALID_MODEL_OUTPUT");
  }
}
