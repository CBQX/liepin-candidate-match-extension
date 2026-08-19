import type { ModelProvider } from "../providers/model-provider";
import { NormalizedProviderError } from "../providers/model-provider";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import type { Job } from "../shared/contracts/job";
import {
  modelRecruitmentProfileSchema,
  type ModelRecruitmentProfile
} from "../shared/contracts/recruitment-profile";

export interface GenerateJobProfileRequest {
  job: Job;
}

export interface GenerateJobProfileDependencies {
  provider: ModelProvider;
  settings: ProviderSettings | undefined;
  signal?: AbortSignal;
}

export async function generateJobProfile(
  request: GenerateJobProfileRequest,
  dependencies: GenerateJobProfileDependencies
): Promise<ModelRecruitmentProfile> {
  if (!dependencies.settings || dependencies.settings.apiKey.trim() === "") {
    throw new NormalizedProviderError("MISSING_API_KEY");
  }
  if (dependencies.signal?.aborted) {
    throw new NormalizedProviderError("ANALYSIS_CANCELLED");
  }
  if (!dependencies.provider.generateRecruitmentProfile) {
    throw new NormalizedProviderError("INVALID_PROVIDER_SETTINGS");
  }

  const result = await dependencies.provider.generateRecruitmentProfile({
    company: request.job.company,
    jd: request.job.jd,
    customRequirements: request.job.customRequirements
  }, dependencies.settings, dependencies.signal);
  const parsed = modelRecruitmentProfileSchema.safeParse(result);
  if (!parsed.success) {
    throw new NormalizedProviderError("INVALID_MODEL_OUTPUT");
  }
  return parsed.data;
}
