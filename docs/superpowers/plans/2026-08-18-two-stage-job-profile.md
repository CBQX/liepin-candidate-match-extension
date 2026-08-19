# Two-Stage Recruitment Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, recruiter-confirmed AI job profile that is generated once per job and reused for faster, more consistent 0–100 candidate matching.

**Architecture:** Extend `Job` with an optional confirmed recruitment profile, introduce a separate provider operation and runtime request for profile generation, and gate candidate analysis on profile confirmation. Candidate analysis receives only the confirmed profile plus the redacted candidate; local composition derives dimension weights from the confirmed requirement weights and never applies a knockout downgrade.

**Tech Stack:** TypeScript 5, React 19, Zod 4, Chrome Manifest V3, IndexedDB repository adapter, Vitest 4, Testing Library, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-18-two-stage-job-profile-design.md`

## Global Constraints

- Chrome 116+ on Windows and macOS; do not add a dependency that raises this browser floor.
- Company, JD, and custom requirements remain mandatory.
- A confirmed recruitment profile persists with its job in extension-origin IndexedDB; candidate drafts, redaction context, prompts, and results remain memory-only.
- Candidate provider requests must not contain raw `jd`, `customRequirements`, candidate URL, Liepin ID, detected name, or contact details.
- No elimination, knockout, auto-rejection, or hard-requirement recommendation cap; every candidate receives a 0–100 score and contact recommendation.
- Unknown candidate information does not deduct score; it reduces confidence and creates verification questions.
- Location, years of experience, and certificate local rules remain `unknown`; recruiter-only source evidence remains isolated from providers.
- Profile and candidate requests use distinct request IDs, real `AbortSignal` cancellation, 25-second header/body timeouts, one invalid-output repair attempt, and late-result suppression.
- DeepSeek remains the first adapter, while provider contracts must be implementable by a second fake provider without DeepSeek fields.
- All automated fixtures are synthetic. Never add screenshot data, a real candidate identifier, or real candidate content to source, tests, docs, logs, or the ZIP.
- Use TDD for every behavior change and commit after every independently green task.

---

### Task 1: Recruitment Profile Contracts and Weight Domain

**Files:**
- Create: `src/shared/contracts/recruitment-profile.ts`
- Create: `src/domain/jobs/recruitment-profile.ts`
- Create: `tests/contracts/recruitment-profile.test.ts`
- Modify: `src/shared/contracts/job.ts`
- Modify: `src/shared/contracts/matching.ts`
- Modify: `tests/contracts/contracts.test.ts`

**Interfaces:**
- Consumes: existing `dimensionIds` and Zod conventions.
- Produces: `modelRecruitmentProfileSchema`, `confirmedRecruitmentProfileSchema`, `ModelRecruitmentProfile`, `ConfirmedRecruitmentProfile`, `normalizeRecruitmentProfileWeights(profile)`, `confirmRecruitmentProfile(profile, confirmedAt)`, and optional `Job.recruitmentProfile`.

- [ ] **Step 1: Write failing contract and normalization tests**

```ts
const profile = {
  version: 1 as const,
  roleTitle: "企业软件产品经理",
  roleObjective: "负责虚构企业软件的产品规划与交付",
  requirements: [
    { id: "r1", text: "具备企业软件产品经验", priority: "hard", dimensionId: "functional_expertise", weight: 3, jobEvidence: ["负责企业软件产品"] },
    { id: "r2", text: "理解订阅业务", priority: "preferred", dimensionId: "industry_business", weight: 1, jobEvidence: ["订阅业务经验优先"] }
  ],
  acceptableAlternatives: ["复杂 B2B 平台经验"],
  ambiguities: ["团队规模未说明"],
  verificationQuestions: ["请确认团队规模"]
};

it("normalizes requirement weights to an exact integer total of 100", () => {
  const normalized = normalizeRecruitmentProfileWeights(profile);
  expect(normalized.requirements.map(({ weight }) => weight)).toEqual([75, 25]);
  expect(normalized.requirements.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
});

it("rejects a protected characteristic in a generated requirement", () => {
  expect(modelRecruitmentProfileSchema.safeParse({
    ...profile,
    requirements: [{ ...profile.requirements[0], text: "只招男性" }]
  }).success).toBe(false);
});

it("accepts an old job without a recruitment profile", () => {
  expect(jobSchema.parse(oldJob).recruitmentProfile).toBeUndefined();
});
```

- [ ] **Step 2: Run tests and observe RED**

Run: `npm test -- tests/contracts/recruitment-profile.test.ts tests/contracts/contracts.test.ts`

Expected: FAIL because the profile schemas and normalization module do not exist.

- [ ] **Step 3: Implement schemas and exact largest-remainder normalization**

```ts
export const recruitmentRequirementSchema = z.object({
  id: requiredText,
  text: requiredText,
  priority: z.enum(["hard", "preferred", "standard"]),
  dimensionId: z.enum(dimensionIds),
  weight: z.number().finite().nonnegative(),
  jobEvidence: z.array(requiredText).min(1)
});

export const modelRecruitmentProfileSchema = z.object({
  version: z.literal(1),
  roleTitle: requiredText,
  roleObjective: requiredText,
  requirements: z.array(recruitmentRequirementSchema).min(1).max(20),
  acceptableAlternatives: z.array(requiredText),
  ambiguities: z.array(requiredText),
  verificationQuestions: z.array(requiredText)
}).superRefine(rejectProtectedRecruitmentCriteria);

export const confirmedRecruitmentProfileSchema = modelRecruitmentProfileSchema.extend({
  confirmedAt: requiredText
});
```

Implement normalization by rejecting an all-zero vector, scaling raw weights to 100, flooring each value, and allocating remaining points by descending fractional remainder with original index as the stable tie-break. `confirmRecruitmentProfile` parses, normalizes, adds `confirmedAt`, and parses the confirmed schema again.

- [ ] **Step 4: Add the optional profile to `Job` and profile source to criteria**

```ts
export const jobSchema = z.object({
  id: requiredText,
  company: requiredText,
  jd: requiredText,
  customRequirements: requiredText,
  recruitmentProfile: confirmedRecruitmentProfileSchema.optional(),
  createdAt: requiredText,
  updatedAt: requiredText
});
```

Extend `jobCriterionSchema.source` with `"profile"` so local rules can reference confirmed requirements without pretending they came directly from one raw field.

- [ ] **Step 5: Run focused and type tests**

Run: `npm test -- tests/contracts/recruitment-profile.test.ts tests/contracts/contracts.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/contracts/recruitment-profile.ts src/domain/jobs/recruitment-profile.ts src/shared/contracts/job.ts src/shared/contracts/matching.ts tests/contracts/recruitment-profile.test.ts tests/contracts/contracts.test.ts
git commit -m "feat: add recruitment profile contracts"
```

### Task 2: Persisted Confirmation and Legacy Job Compatibility

**Files:**
- Modify: `src/domain/jobs/job-service.ts`
- Modify: `src/domain/jobs/job-repository.ts`
- Modify: `src/repositories/chrome-job-repository.ts`
- Modify: `tests/domain/job-service.test.ts`
- Modify: `tests/repositories/chrome-job-repository.test.ts`

**Interfaces:**
- Consumes: `ModelRecruitmentProfile`, `ConfirmedRecruitmentProfile`, and `confirmRecruitmentProfile` from Task 1.
- Produces: `JobService.confirmAndActivateProfile(jobId, profile): Promise<Job>` and atomic replacement through existing `saveAndActivate(job)`.

- [ ] **Step 1: Write failing service tests**

```ts
it("confirms and atomically replaces a profile on an existing job", async () => {
  const service = new JobService(repository, () => "2026-08-18T10:00:00.000Z");
  const confirmed = await service.confirmAndActivateProfile("job-1", modelProfile);
  expect(confirmed.recruitmentProfile?.confirmedAt).toBe("2026-08-18T10:00:00.000Z");
  expect(confirmed.recruitmentProfile?.requirements.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  expect(repository.saveAndActivate).toHaveBeenCalledWith(confirmed);
});

it("does not overwrite an old profile when confirmation validation fails", async () => {
  await expect(service.confirmAndActivateProfile("job-1", invalidProfile)).rejects.toThrow();
  expect(repository.saveAndActivate).not.toHaveBeenCalled();
});
```

Add repository tests proving a stored legacy `Job` without a profile still loads and a confirmed profile round-trips through a new repository instance.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm test -- tests/domain/job-service.test.ts tests/repositories/chrome-job-repository.test.ts`

Expected: FAIL because `confirmAndActivateProfile` is absent.

- [ ] **Step 3: Implement confirmation without a destructive migration**

Inject `now: () => string = () => new Date().toISOString()` into `JobService`. Locate the job using `repository.list()`, throw for an unknown ID, create the confirmed profile, update `updatedAt`, parse the whole `Job`, then make one `saveAndActivate(updatedJob)` call. Do not add a database migration: the optional schema field is the compatibility boundary.

- [ ] **Step 4: Run repository and service tests**

Run: `npm test -- tests/domain/job-service.test.ts tests/repositories/chrome-job-repository.test.ts tests/repositories/indexeddb-storage-area.test.ts && npm run typecheck`

Expected: PASS, including legacy migration tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/jobs/job-service.ts src/domain/jobs/job-repository.ts src/repositories/chrome-job-repository.ts tests/domain/job-service.test.ts tests/repositories/chrome-job-repository.test.ts
git commit -m "feat: persist confirmed recruitment profiles"
```

### Task 3: Provider-Neutral Profile Generation and DeepSeek Adapter

**Files:**
- Create: `src/providers/deepseek/job-profile-prompt.ts`
- Create: `tests/providers/job-profile-prompt.test.ts`
- Modify: `src/providers/model-provider.ts`
- Modify: `src/providers/deepseek/deepseek-provider.ts`
- Modify: `src/providers/deepseek/prompt.ts`
- Modify: `tests/providers/deepseek-provider.test.ts`
- Modify: `tests/providers/prompt.test.ts`

**Interfaces:**
- Consumes: `ModelRecruitmentProfile`, `ConfirmedRecruitmentProfile`, `ModelMatchResult`, candidate contracts, and provider settings.
- Produces: `JobProfileInput`, `CandidateMatchInput`, `ModelProvider.generateRecruitmentProfile(...)`, `ModelProvider.analyzeCandidate(...)`, `buildJobProfilePrompt(input)`, and candidate prompts that contain no raw job fields.

- [ ] **Step 1: Write failing provider contract and privacy tests**

```ts
it("generates and validates a recruitment profile with one bounded repair", async () => {
  const fetcher = vi.fn<Fetcher>()
    .mockResolvedValueOnce(completion("{}"))
    .mockResolvedValueOnce(completion(JSON.stringify(modelProfile)));
  await expect(new DeepSeekProvider(fetcher).generateRecruitmentProfile(jobProfileInput, settings))
    .resolves.toEqual(modelProfile);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("candidate prompt contains the confirmed profile but not raw job text", () => {
  const prompt = buildAnalysisPrompt(candidateMatchInput);
  expect(prompt.user).toContain("企业软件产品经验");
  expect(prompt.user).not.toContain("原始超长 JD 唯一标记");
  expect(prompt.user).not.toContain("原始个性化要求唯一标记");
});

it("supports a second provider through the same two-operation contract", async () => {
  const fake: ModelProvider = {
    id: "fake", models: [{ id: "fake-1", label: "Fake" }],
    validateCredentials: vi.fn(),
    generateRecruitmentProfile: vi.fn(async () => modelProfile),
    analyzeCandidate: vi.fn(async () => modelResult)
  };
  expect(await fake.generateRecruitmentProfile(jobProfileInput, settings)).toEqual(modelProfile);
});
```

- [ ] **Step 2: Run provider tests and observe RED**

Run: `npm test -- tests/providers/job-profile-prompt.test.ts tests/providers/prompt.test.ts tests/providers/deepseek-provider.test.ts`

Expected: FAIL on missing provider methods and prompt module.

- [ ] **Step 3: Split provider inputs and methods**

```ts
export type JobProfileInput = Pick<Job, "company" | "jd" | "customRequirements">;

export interface CandidateMatchInput {
  recruitmentProfile: ConfirmedRecruitmentProfile;
  candidateDraft: CandidateDraft;
  criteria: readonly JobCriterion[];
  ruleEvaluations: readonly RuleEvaluation[];
}

export interface ModelProvider {
  id: string;
  models: readonly ProviderModelMetadata[];
  validateCredentials(settings: ProviderSettings): Promise<void>;
  generateRecruitmentProfile(input: JobProfileInput, settings: ProviderSettings, signal?: AbortSignal): Promise<ModelRecruitmentProfile>;
  analyzeCandidate(input: CandidateMatchInput, settings: ProviderSettings, signal?: AbortSignal): Promise<ModelMatchResult>;
}
```

- [ ] **Step 4: Implement strict job-profile prompt and shared JSON request path**

The system prompt must enumerate the exact profile JSON, limit requirements to 1–20, require an evidence quote for every item, require all six allowed `dimensionId` values, forbid protected criteria and hidden requirements, and return JSON only. Refactor DeepSeek's two-attempt request loop into a private generic `requestStructured<T>(prompt, schema, settings, signal, maxTokens)` used by both operations. Keep `response_format`, disabled thinking, exact model allowlist, real browser-fetch receiver, timeout phases, cancellation, and error mappings unchanged.

- [ ] **Step 5: Rename candidate operation and remove raw job from its prompt**

Rename `analyze` to `analyzeCandidate`. `buildAnalysisPrompt` serializes only `recruitmentProfile`, `candidateDraft`, `criteria`, and provider-visible rule evaluations.

- [ ] **Step 6: Run provider, privacy, and type tests**

Run: `npm test -- tests/providers/job-profile-prompt.test.ts tests/providers/prompt.test.ts tests/providers/deepseek-provider.test.ts tests/privacy/redaction.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/providers/model-provider.ts src/providers/deepseek/deepseek-provider.ts src/providers/deepseek/job-profile-prompt.ts src/providers/deepseek/prompt.ts tests/providers/job-profile-prompt.test.ts tests/providers/deepseek-provider.test.ts tests/providers/prompt.test.ts
git commit -m "feat: add provider-neutral job profile generation"
```

### Task 4: Runtime Profile Requests, Cancellation, and Confirmation

**Files:**
- Create: `src/background/generate-job-profile.ts`
- Create: `tests/background/generate-job-profile.test.ts`
- Modify: `src/shared/contracts/messages.ts`
- Modify: `src/shared/errors.ts`
- Modify: `src/background/controller.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `tests/background/controller.test.ts`
- Modify: `tests/build/manifest.test.ts`

**Interfaces:**
- Consumes: `JobService`, `ModelProvider.generateRecruitmentProfile`, provider settings, profile schemas.
- Produces: runtime messages `GENERATE_JOB_PROFILE`, `CANCEL_JOB_PROFILE`, `CONFIRM_JOB_PROFILE`, `JOB_PROFILE_REQUIRED`, and separate active-request maps.

- [ ] **Step 1: Write failing runtime schema and controller tests**

```ts
const generateRequest = {
  type: "GENERATE_JOB_PROFILE" as const,
  requestId: "profile-request-1",
  job: legacyJob
};

it("generates a profile without requiring a Liepin tab", async () => {
  await expect(controller.handle(generateRequest)).resolves.toEqual({ ok: true, data: modelProfile });
  expect(provider.generateRecruitmentProfile).toHaveBeenCalledWith(
    expect.objectContaining({ company: legacyJob.company }), settings, expect.any(AbortSignal)
  );
});

it("cancels only the matching profile request", async () => {
  const pending = controller.handle(generateRequest);
  await controller.handle({ type: "CANCEL_JOB_PROFILE", requestId: "profile-request-1" });
  await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "ANALYSIS_CANCELLED" } });
});

it("confirms an edited profile through the job service", async () => {
  const result = await controller.handle({ type: "CONFIRM_JOB_PROFILE", jobId: legacyJob.id, profile: editedProfile });
  expect(result).toEqual({ ok: true, data: confirmedJob });
});
```

Add a concurrency regression: cancelling a candidate request must not cancel a profile request, and vice versa. Add a pre-cancelled-signal test proving no fetch occurs.

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm test -- tests/background/generate-job-profile.test.ts tests/background/controller.test.ts tests/contracts/contracts.test.ts`

Expected: FAIL because runtime variants and controller branches are absent.

- [ ] **Step 3: Implement the generation pipeline and runtime schemas**

`generateJobProfile` checks settings and invokes `provider.generateRecruitmentProfile` with only the three raw job inputs. Add the three discriminated-union variants. `CONFIRM_JOB_PROFILE.profile` uses `modelRecruitmentProfileSchema`; the response remains the common runtime response.

- [ ] **Step 4: Add separate lifecycle maps in the controller**

Keep `activeAnalyses` for candidate requests and add `activeJobProfiles`. Duplicate request IDs replace only their own operation. Both branches check cancellation after settings load, clean up only their own controller in `finally`, and map errors through `mapModelProviderError`.

- [ ] **Step 5: Wire trusted confirmation in the service worker**

Instantiate one `ChromeJobRepository(persistentStorage)` and `JobService` in the service worker, expose a `confirmJobProfile(jobId, profile)` dependency to the controller, and keep all persistence in the trusted extension origin.

- [ ] **Step 6: Run background, manifest, and type tests**

Run: `npm test -- tests/background/generate-job-profile.test.ts tests/background/controller.test.ts tests/build/manifest.test.ts && npm run typecheck`

Expected: PASS, with no new permissions.

- [ ] **Step 7: Commit**

```bash
git add src/background/generate-job-profile.ts src/background/controller.ts src/background/service-worker.ts src/shared/contracts/messages.ts src/shared/errors.ts tests/background/generate-job-profile.test.ts tests/background/controller.test.ts tests/build/manifest.test.ts
git commit -m "feat: add job profile runtime workflow"
```

### Task 5: Profile-Based Candidate Scoring Without Knockout

**Files:**
- Modify: `src/background/analyze-candidate.ts`
- Modify: `src/domain/matching/requirements.ts`
- Modify: `src/domain/matching/compose-analysis.ts`
- Modify: `src/domain/matching/weights.ts`
- Modify: `tests/background/analyze-candidate.test.ts`
- Modify: `tests/matching/requirements.test.ts`
- Modify: `tests/matching/compose-analysis.test.ts`

**Interfaces:**
- Consumes: confirmed profile requirements and six provider dimension scores.
- Produces: `criteriaFromRecruitmentProfile(profile)`, `dimensionWeightsFromProfile(profile)`, profile-gated `analyzeCandidate`, exact 0–100 composition, and no hard-failure downgrade.

- [ ] **Step 1: Write failing scoring and privacy tests**

```ts
it("derives dimension weights from confirmed requirements", () => {
  expect(dimensionWeightsFromProfile(confirmedProfile)).toEqual({
    hard_requirements: 0,
    functional_expertise: 0.75,
    industry_business: 0.25,
    seniority_impact: 0,
    trajectory_stability: 0,
    recruiter_feasibility: 0
  });
});

it("does not downgrade contact advice for a deterministic hard failure", () => {
  const result = composeAnalysis(modelResultAt(90), [notMetDegreeRule], candidate, confirmedProfile);
  expect(result.overallScore).toBe(90);
  expect(result.recommendation).toBe("strong_recommend");
});

it("refuses candidate analysis without a confirmed profile", async () => {
  await expect(analyzeCandidate({ job: legacyJob, candidateDraft, redactionContext }, deps))
    .rejects.toMatchObject({ code: "JOB_PROFILE_REQUIRED" });
  expect(provider.analyzeCandidate).not.toHaveBeenCalled();
});

it("never sends raw JD or custom requirements to the candidate provider", async () => {
  await analyzeCandidate({ job: confirmedJob, candidateDraft, redactionContext }, deps);
  const sent = JSON.stringify(provider.analyzeCandidate.mock.calls[0]?.[0]);
  expect(sent).not.toContain(confirmedJob.jd);
  expect(sent).not.toContain(confirmedJob.customRequirements);
});
```

- [ ] **Step 2: Run focused tests and observe RED**

Run: `npm test -- tests/matching/requirements.test.ts tests/matching/compose-analysis.test.ts tests/background/analyze-candidate.test.ts`

Expected: FAIL on missing profile functions and current hard-failure downgrade.

- [ ] **Step 3: Derive criteria and weights from the confirmed profile**

```ts
export const criteriaFromRecruitmentProfile = (profile: ConfirmedRecruitmentProfile): JobCriterion[] =>
  profile.requirements.map(({ id, text, priority }) => ({ id, text, priority, source: "profile" }));

export function dimensionWeightsFromProfile(profile: ConfirmedRecruitmentProfile) {
  const totalByDimension = Object.fromEntries(dimensionIds.map((id) => [id, 0]));
  for (const requirement of profile.requirements) {
    totalByDimension[requirement.dimensionId] += requirement.weight / 100;
  }
  return totalByDimension;
}
```

- [ ] **Step 4: Gate and minimize candidate provider input**

Throw `AnalysisPipelineError("JOB_PROFILE_REQUIRED")` before redaction if `job.recruitmentProfile` is absent. Derive criteria from the profile, keep existing conservative facts/rules and unknown-evidence stripping, then call `provider.analyzeCandidate({ recruitmentProfile, candidateDraft: cleanCandidate, criteria, ruleEvaluations })`.

- [ ] **Step 5: Replace fixed weights and remove knockout downgrade**

Pass the profile to `composeAnalysis`, calculate the weighted sum from derived dimension weights, and set recommendation only from score bands. If the computed confidence is `low` and the score is at least 70, use internal `cautious` so the UI displays “建议核实后联系”; never change the numeric score. Delete the fixed `DIMENSION_WEIGHTS` export after all imports move to `dimensionWeightsFromProfile`.

- [ ] **Step 6: Run matching, pipeline, privacy, and type tests**

Run: `npm test -- tests/matching tests/background/analyze-candidate.test.ts tests/privacy && npm run typecheck`

Expected: PASS, including years/location/certificate conservative breakers and recruiter-only evidence isolation.

- [ ] **Step 7: Commit**

```bash
git add src/background/analyze-candidate.ts src/domain/matching/requirements.ts src/domain/matching/compose-analysis.ts src/domain/matching/weights.ts tests/background/analyze-candidate.test.ts tests/matching/requirements.test.ts tests/matching/compose-analysis.test.ts
git commit -m "feat: score candidates from confirmed profiles"
```

### Task 6: Editable Job Profile Review UI

**Files:**
- Create: `src/sidepanel/components/JobProfileReview.tsx`
- Create: `src/sidepanel/components/JobProfileProgress.tsx`
- Create: `src/sidepanel/components/JobProfileNeeded.tsx`
- Create: `tests/sidepanel/job-profile-review.test.tsx`
- Modify: `src/sidepanel/app-dependencies.ts`
- Modify: `src/sidepanel/components/JobForm.tsx`
- Modify: `src/sidepanel/components/ReadyState.tsx`
- Modify: `src/sidepanel/components/AnalysisResult.tsx`
- Modify: `src/sidepanel/styles.css`
- Modify: `src/sidepanel/App.tsx`
- Modify: `tests/sidepanel/settings-and-jobs.test.tsx`
- Modify: `tests/sidepanel/analysis-result.test.tsx`

**Interfaces:**
- Consumes: profile runtime requests and schemas from Tasks 1 and 4.
- Produces: `generateJobProfile`, `cancelJobProfile`, `confirmJobProfile` side-panel dependencies and the `job_profile_analyzing`, `job_profile_review`, `job_profile_error`, `needs_profile`, and `job_ready` experiences.

- [ ] **Step 1: Write failing component tests for all recruiter edits**

```tsx
it("edits, adds, deletes, reprioritizes, recategorizes, and confirms once", async () => {
  render(<JobProfileReview profile={modelProfile} onConfirm={onConfirm} onCancel={onCancel} />);
  await user.clear(screen.getByLabelText("岗位名称"));
  await user.type(screen.getByLabelText("岗位名称"), "海外产品经理");
  await user.selectOptions(screen.getByLabelText("要求 1 优先级"), "preferred");
  await user.click(screen.getByRole("button", { name: "删除要求 2" }));
  await user.click(screen.getByRole("button", { name: "增加招聘要求" }));
  await user.type(screen.getByLabelText("要求 2 内容"), "具备跨区域协作经验");
  await user.selectOptions(screen.getByLabelText("要求 2 匹配维度"), "recruiter_feasibility");
  await user.click(screen.getByRole("button", { name: "确认岗位画像" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onConfirm.mock.calls[0]?.[0].requirements).toHaveLength(2);
});
```

Add validation tests for blank role title, blank requirement, no requirements, protected criteria, and confirmation repository failure retaining the edited form.

- [ ] **Step 2: Run component tests and observe RED**

Run: `npm test -- tests/sidepanel/job-profile-review.test.tsx tests/sidepanel/settings-and-jobs.test.tsx`

Expected: FAIL because profile components and dependencies do not exist.

- [ ] **Step 3: Add side-panel runtime dependencies**

```ts
generateJobProfile(job, requestId) {
  return chrome.runtime.sendMessage({ type: "GENERATE_JOB_PROFILE", job, requestId });
},
cancelJobProfile(requestId) {
  return chrome.runtime.sendMessage({ type: "CANCEL_JOB_PROFILE", requestId });
},
confirmJobProfile(jobId, profile) {
  return chrome.runtime.sendMessage({ type: "CONFIRM_JOB_PROFILE", jobId, profile });
}
```

- [ ] **Step 4: Implement the review editor with immutable local state**

Use native inputs, textareas, selects, and buttons. New requirements use `crypto.randomUUID()`, `jobEvidence: [\`猎头手动补充要求：${text}\`]`, a same-priority median/default raw weight, and selected dimension. Before confirmation, rebuild manual evidence from final text, parse with `modelRecruitmentProfileSchema`, and show adjacent Chinese field errors without discarding edits.

- [ ] **Step 5: Integrate profile state into `App`**

After `JobService.createAndActivate`, set the saved raw job active and call `generateJobProfile` with a new request ID. Store only the generated review draft in component state. On confirm, call the trusted runtime operation, reload `jobs`, and set the returned job ready. Existing jobs without profiles render `JobProfileNeeded`; confirmed jobs render normal candidate flow. Profile cancellation has its own ref and does not call candidate cancellation. Switching jobs cancels both operation types and discards only unconfirmed profile UI state.

- [ ] **Step 6: Update contact recommendation copy**

Map internal recommendations to “建议优先联系 / 建议联系 / 建议核实后联系 / 暂不优先联系”. Remove user-visible “淘汰”, “一票否决”, “强推荐”, “谨慎推进”, and “暂不推荐” candidate-action language while retaining evidence and confidence.

- [ ] **Step 7: Run UI and type tests**

Run: `npm test -- tests/sidepanel/job-profile-review.test.tsx tests/sidepanel/settings-and-jobs.test.tsx tests/sidepanel/analysis-result.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sidepanel/App.tsx src/sidepanel/app-dependencies.ts src/sidepanel/components/JobForm.tsx src/sidepanel/components/JobProfileReview.tsx src/sidepanel/components/JobProfileProgress.tsx src/sidepanel/components/JobProfileNeeded.tsx src/sidepanel/components/ReadyState.tsx src/sidepanel/components/AnalysisResult.tsx src/sidepanel/styles.css tests/sidepanel/job-profile-review.test.tsx tests/sidepanel/settings-and-jobs.test.tsx tests/sidepanel/analysis-result.test.tsx
git commit -m "feat: add editable job profile confirmation UI"
```

### Task 7: Synthetic End-to-End Reuse, Recovery, and Regression

**Files:**
- Create: `tests/fixtures/synthetic-recruitment.ts`
- Modify: `tests/sidepanel/full-workflow.test.tsx`
- Modify: `tests/sidepanel/analysis-workflow.test.tsx`
- Modify: `tests/sidepanel/analysis-session.test.ts`
- Modify: `tests/background/controller.test.ts`
- Modify: `tests/build/manifest.test.ts`

**Interfaces:**
- Consumes: complete runtime/UI/provider workflow from Tasks 1–6.
- Produces: synthetic three-job data and full-flow regression proof that one confirmed profile serves multiple candidates.

- [ ] **Step 1: Add synthetic fixtures with explicit mismatch shapes**

Create three fictional jobs: enterprise-software product, overseas product, and data-platform product. For each, provide synthetic complete-match, partial-match, information-gap, and contradictory candidate drafts. Use names such as “虚构甲公司” and IDs such as `synthetic-job-enterprise`; include no real employer, person, URL, phone, email, or Liepin identifier.

- [ ] **Step 2: Write failing full-workflow reuse test**

```tsx
it("generates and confirms once, then reuses the profile for two candidates", async () => {
  await saveRawJob(user, syntheticEnterpriseJob);
  expect(deps.generateJobProfile).toHaveBeenCalledTimes(1);
  await user.click(await screen.findByRole("button", { name: "确认岗位画像" }));
  await analyzeVisibleCandidate(user);
  await simulatePageChangeAndAnalyzeSecondCandidate(user);
  expect(deps.generateJobProfile).toHaveBeenCalledTimes(1);
  expect(deps.analyzeCandidate).toHaveBeenCalledTimes(2);
});
```

Add cases for old-job `needs_profile`, generation retry after network error, invalid-Key reconfiguration retaining raw input, cancel ignoring a late profile result, failed reanalysis preserving the old profile, job switch isolation, and no extraction before an explicit candidate action.

- [ ] **Step 3: Run workflow tests and observe RED**

Run: `npm test -- tests/sidepanel/full-workflow.test.tsx tests/sidepanel/analysis-workflow.test.tsx tests/sidepanel/analysis-session.test.ts tests/background/controller.test.ts`

Expected: FAIL for at least the new reuse and recovery assertions.

- [ ] **Step 4: Make the smallest integration corrections**

Fix only behavior exposed by the failing end-to-end tests: request-generation guards, state clearing, retry target, active-job refresh, or late-result checks. Do not add persistence for candidate data or broaden browser permissions.

- [ ] **Step 5: Run all focused regressions**

Run: `npm test -- tests/sidepanel tests/background tests/providers tests/matching tests/privacy tests/repositories tests/build && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/synthetic-recruitment.ts tests/sidepanel/full-workflow.test.tsx tests/sidepanel/analysis-workflow.test.tsx tests/sidepanel/analysis-session.test.ts tests/background/controller.test.ts tests/build/manifest.test.ts src
git commit -m "test: prove two-stage profile reuse and recovery"
```

### Task 8: Documentation, Full Verification, and Installable ZIP

**Files:**
- Modify: `README.md`
- Modify: `docs/qa/mvp-smoke-test.md`
- Modify: `docs/superpowers/specs/2026-08-18-liepin-candidate-match-extension-design.md`
- Modify: `docs/superpowers/plans/2026-08-18-liepin-candidate-match-extension.md`
- Create: `outputs/liepin-matcher-stage-c-two-stage-job-profile.zip` outside the worktree at `/Users/christine/Documents/Codex/2026-08-18/bang/outputs/`

**Interfaces:**
- Consumes: completed product flow and synthetic verification suite.
- Produces: current user instructions, supersession notes in historical design/plan, clean production build, and validated ZIP.

- [ ] **Step 1: Update user and QA documentation**

Document the exact flow: configure model → enter three required fields → analyze job → edit/confirm profile once → browse candidate → edit candidate preview → receive 0–100 contact advice. Mark old saved jobs as needing one profile-generation step. Update the 3 × 10 manual acceptance table with job-profile generation success, first-candidate time, subsequent-candidate time, candidate-analysis success, standard consistency, and contact-advice usefulness. State that automated fixtures are synthetic and real DeepSeek/Liepin acceptance belongs to the user.

- [ ] **Step 2: Add supersession notes to original design and plan**

At the top of both historical files, link the new spec and state that its job creation, provider interface, weighting, recommendation, migration, and test decisions take precedence. Preserve the historical record instead of rewriting approved history.

- [ ] **Step 3: Run fresh full verification**

Run: `npm run verify`

Expected: every test file passes, TypeScript emits no error, and Vite plus extension build complete.

- [ ] **Step 4: Run static privacy and artifact checks**

Run these as separate commands:

```bash
rg -n "showresumedetail|res_id_encode" dist/background.js dist/content.js
rg -n "candidateDraft|redactionContext|MatchAnalysis" src/repositories src/shared -g '*.ts'
rg -n "tabs|history|cookies|webRequest|unlimitedStorage|<all_urls>" dist/manifest.json
git diff --check
git status --short
```

Expected: supported-route code exists; no candidate repository or broad permission is introduced; diff check is empty; only intended documentation changes remain before the final commit.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/qa/mvp-smoke-test.md docs/superpowers/specs/2026-08-18-liepin-candidate-match-extension-design.md docs/superpowers/plans/2026-08-18-liepin-candidate-match-extension.md
git commit -m "docs: explain two-stage recruitment workflow"
```

- [ ] **Step 6: Run post-commit verification and package**

Run: `npm run verify`, then create the ZIP from `dist`, `README.md`, and `docs/qa/mvp-smoke-test.md`. Use the new filename exactly so the user cannot confuse it with earlier builds.

- [ ] **Step 7: Validate ZIP content and cleanliness**

Run:

```bash
unzip -t /Users/christine/Documents/Codex/2026-08-18/bang/outputs/liepin-matcher-stage-c-two-stage-job-profile.zip
unzip -p /Users/christine/Documents/Codex/2026-08-18/bang/outputs/liepin-matcher-stage-c-two-stage-job-profile.zip dist/background.js | rg "GENERATE_JOB_PROFILE|CONFIRM_JOB_PROFILE"
shasum -a 256 /Users/christine/Documents/Codex/2026-08-18/bang/outputs/liepin-matcher-stage-c-two-stage-job-profile.zip
git status --short
```

Expected: ZIP integrity reports no errors, runtime profile strings exist in the packaged background, a SHA-256 is printed, and the worktree is clean.
