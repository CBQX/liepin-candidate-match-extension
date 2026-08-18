import type { CandidateDraft } from "../shared/contracts/candidate";
import type { Job } from "../shared/contracts/job";
import type {
  JobCriterion,
  ModelMatchResult,
  RuleEvaluation
} from "../shared/contracts/matching";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";

export interface MatchInput {
  job: Job;
  candidateDraft: CandidateDraft;
  criteria: readonly JobCriterion[];
  ruleEvaluations: readonly RuleEvaluation[];
}

export interface ModelProvider {
  id: "deepseek";
  models: readonly ["deepseek-v4-flash", "deepseek-v4-pro"];
  validateCredentials(settings: ProviderSettings): Promise<void>;
  analyze(input: MatchInput, settings: ProviderSettings): Promise<ModelMatchResult>;
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
