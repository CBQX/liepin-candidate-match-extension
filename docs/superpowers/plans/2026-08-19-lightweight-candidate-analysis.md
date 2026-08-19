# Lightweight Candidate Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace six-dimension candidate analysis with a compact evidence-backed 0–100 assessment and force DeepSeek candidate calls to V4 Flash.

**Architecture:** Keep the confirmed job-profile stage unchanged, but narrow `CandidateMatchInput` to the confirmed profile and redacted candidate. Make the provider return the final lightweight score and contact recommendation directly, validate bounded evidence arrays with Zod, and render the same compact contract in the side panel without local dimension composition or hard-rule gates.

**Tech Stack:** TypeScript, React 19, Zod 4, Chrome Manifest V3, Vitest 4, Testing Library, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-19-lightweight-candidate-analysis-design.md`

## Global Constraints

- Candidate analysis uses `deepseek-v4-flash`; job-profile generation continues to use `ProviderSettings.model`.
- Candidate requests use `max_tokens: 8192`, JSON mode, disabled thinking, separate 25-second header/body timeouts, real cancellation, and exactly one invalid-output repair attempt.
- The model directly supplies a 0–100 integer score and one of `contact`, `verify_before_contact`, or `deprioritize`; none is an elimination state.
- Matches contain 2–5 evidence-backed items, concerns contain 0–3, verification questions contain 0–3, and the result contains one concise recruiter conclusion.
- Requirement priority and weight influence the AI score but never create a knockout or local recommendation cap; missing information alone must not deduct score.
- Candidate provider input contains only the confirmed profile and redacted draft; it excludes duplicate criteria, local rule evaluations, raw JD, custom requirements, URLs, platform IDs, names, and contact details.
- Candidate inputs/results remain memory-only. Existing job/profile persistence and migration behavior must not change.
- All fixtures are synthetic, and every behavior change follows RED → GREEN → refactor.

---

### Task 1: Lightweight Runtime Contract

**Files:**
- Modify: `src/shared/contracts/matching.ts`
- Modify: `tests/contracts/contracts.test.ts`
- Delete after replacement: `src/domain/matching/compose-analysis.ts`
- Delete after replacement: `tests/matching/compose-analysis.test.ts`

**Interfaces:**
- Produces `contactRecommendations`, `qualitativeEvidenceSchema`, `modelMatchResultSchema`, `matchAnalysisSchema`, `ModelMatchResult`, and `MatchAnalysis` for the lightweight result.
- `ModelMatchResult` and `MatchAnalysis` share `{ overallScore, recommendation, matches, concerns, verificationQuestions, recruiterConclusion }`.

- [ ] **Step 1: Write failing contract tests**

Add a literal valid result with score `82`, recommendation `contact`, two matches, one concern, two questions, and a conclusion. Assert acceptance, then assert rejection for score `101`, one or six matches, four concerns, four questions, and any evidence item with an empty job or candidate evidence array.

- [ ] **Step 2: Run the contract test and observe RED**

Run: `npm test -- tests/contracts/contracts.test.ts`

Expected: FAIL because the current schema requires six dimension scores and does not expose `concerns` or the three new recommendation values.

- [ ] **Step 3: Implement the minimal bounded schema**

Use Zod integer bounds for `overallScore`, enum validation for the three recommendations, `.min(2).max(5)` for matches, `.max(3)` for concerns and verification questions, and non-empty job/candidate evidence arrays. Alias `matchAnalysisSchema` to the same object schema because no local score composition remains.

- [ ] **Step 4: Run the contract test and typecheck**

Run: `npm test -- tests/contracts/contracts.test.ts && npm run typecheck`

Expected: the contract test passes; typecheck identifies all remaining legacy call sites to update in later tasks.

### Task 2: Compact Prompt and Flash Provider Strategy

**Files:**
- Modify: `src/providers/model-provider.ts`
- Modify: `src/providers/deepseek/prompt.ts`
- Modify: `src/providers/deepseek/deepseek-provider.ts`
- Modify: `tests/providers/prompt.test.ts`
- Modify: `tests/providers/deepseek-provider.test.ts`

**Interfaces:**
- `CandidateMatchInput` becomes `{ recruitmentProfile: ConfirmedRecruitmentProfile; candidateDraft: CandidateDraft }`.
- `buildAnalysisPrompt(input)` emits the lightweight JSON instructions and a compact `JSON.stringify` payload.
- `DeepSeekProvider.analyzeCandidate` calls `requestStructured` with model override `deepseek-v4-flash` and `maxTokens` `8192`.

- [ ] **Step 1: Write failing prompt tests**

Assert that the system protocol contains the direct score, three recommendations, 2–5 matches, at most three concerns/questions, dual evidence, no knockout, missing-data neutrality, and protected-trait rules. Parse the user payload after its first newline and assert its only top-level keys are `recruitmentProfile` and `candidateDraft`, with no pretty-print whitespace block or duplicate criteria/rules.

- [ ] **Step 2: Run prompt tests and observe RED**

Run: `npm test -- tests/providers/prompt.test.ts`

Expected: FAIL because the prompt still requests six dimensions and serializes four input sections with indentation.

- [ ] **Step 3: Implement the compact prompt and input interface**

Replace the six-dimension protocol with the approved lightweight object. Serialize `{ recruitmentProfile, candidateDraft }` without indentation and retain evidence, privacy, unknown-information, and no-inference constraints.

- [ ] **Step 4: Write failing provider tests**

With stored settings set to `deepseek-v4-pro`, assert candidate request bodies use `deepseek-v4-flash`, `max_tokens: 8192`, JSON mode, and disabled thinking, while job-profile request bodies continue using `deepseek-v4-pro` and `max_tokens: 4096`. Assert malformed lightweight output causes exactly one second Flash request and then succeeds or returns `INVALID_MODEL_OUTPUT`.

- [ ] **Step 5: Run provider tests and observe RED**

Run: `npm test -- tests/providers/deepseek-provider.test.ts`

Expected: FAIL because candidate calls currently use `settings.model` and the legacy result schema.

- [ ] **Step 6: Implement model override without mutating settings**

Add a provider-local `CANDIDATE_MODEL = "deepseek-v4-flash"`. Pass an explicit request model into `requestStructured`, validate the saved model for profile operations as before, and use the explicit model in both initial and repair candidate request bodies. Extend provider error normalization so an explicit unavailable-model response maps to `MODEL_UNAVAILABLE`.

- [ ] **Step 7: Run provider-focused tests**

Run: `npm test -- tests/providers/prompt.test.ts tests/providers/deepseek-provider.test.ts`

Expected: PASS.

### Task 3: Lightweight Candidate Pipeline and Privacy Boundary

**Files:**
- Modify: `src/background/analyze-candidate.ts`
- Modify: `tests/background/analyze-candidate.test.ts`
- Modify: `tests/sidepanel/analysis-result.test.tsx` integration section
- Delete: `src/domain/matching/compose-analysis.ts`
- Delete: `tests/matching/compose-analysis.test.ts`

**Interfaces:**
- `analyzeCandidate(request, deps)` redacts once, calls the provider with only profile and redacted draft, validates `modelMatchResultSchema`, and returns `matchAnalysisSchema.parse(modelResult)`.

- [ ] **Step 1: Write failing pipeline tests**

Assert the provider receives exactly the confirmed profile and redacted candidate, not `criteria` or `ruleEvaluations`; assert detected names, formatted phones, Liepin URLs, and candidate/resume/profile IDs are absent. Assert the model's score and recommendation pass through unchanged, including a high score paired with `verify_before_contact`, proving there is no local hard gate or score remapping.

- [ ] **Step 2: Run pipeline tests and observe RED**

Run: `npm test -- tests/background/analyze-candidate.test.ts tests/sidepanel/analysis-result.test.tsx`

Expected: FAIL because the current pipeline evaluates rules, sends duplicate sections, and composes dimensions locally.

- [ ] **Step 3: Implement the minimal pipeline**

Remove objective-fact/rule/composition imports and calls. Keep missing settings/profile checks, the existing redactor, provider cancellation signal, Zod validation, and normalized `INVALID_MODEL_OUTPUT` mapping.

- [ ] **Step 4: Remove the obsolete composition module and tests**

Delete `src/domain/matching/compose-analysis.ts` and `tests/matching/compose-analysis.test.ts` only after all production imports are gone. Keep general rule/fact modules because they remain independently tested utilities and may support future provider adapters, but do not send their output in candidate requests.

- [ ] **Step 5: Run pipeline/privacy tests and typecheck**

Run: `npm test -- tests/background/analyze-candidate.test.ts tests/privacy/redaction.test.ts && npm run typecheck`

Expected: pipeline and privacy tests pass; remaining type errors are legacy UI fixtures addressed in Task 4.

### Task 4: Lightweight Result UI and Full Workflow

**Files:**
- Modify: `src/sidepanel/components/AnalysisResult.tsx`
- Modify: `src/sidepanel/components/ModelSettingsForm.tsx`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/analysis-result.test.tsx`
- Modify: `tests/sidepanel/analysis-session.test.ts`
- Modify: `tests/sidepanel/analysis-workflow.test.tsx`
- Modify: `tests/sidepanel/full-workflow.test.tsx`
- Modify: `tests/sidepanel/settings-and-jobs.test.tsx`

**Interfaces:**
- `AnalysisResult` renders score, three recommendation labels, evidence-backed `matches`, evidence-backed `concerns`, up to three verification questions, and recruiter conclusion.
- `ModelSettingsForm` states that the selected model is used for job-profile analysis and candidate analysis is fixed to DeepSeek V4 Flash.

- [ ] **Step 1: Write failing component tests**

Render a literal lightweight result and assert visible score, recommendation, both evidence columns, concern, questions, and conclusion. Assert the document does not contain “六维评分”, “硬性条件核对”, “一票否决”, or legacy confidence text. In settings tests, assert the Flash candidate-analysis disclosure is visible.

- [ ] **Step 2: Run side-panel tests and observe RED**

Run: `npm test -- tests/sidepanel/analysis-result.test.tsx tests/sidepanel/settings-and-jobs.test.tsx`

Expected: FAIL because the component requires legacy fields and the settings form lacks the disclosure.

- [ ] **Step 3: Implement the compact result component and disclosure**

Remove dimension-weight, criterion, confidence, and hard-rule rendering. Reuse the dual-evidence section for “主要匹配理由” and “主要顾虑或信息缺口”; map the recommendation enum to the three approved Chinese labels. Remove only CSS selectors that have no remaining use.

- [ ] **Step 4: Update synthetic workflow/session fixtures**

Replace legacy result objects in session, analysis workflow, and full workflow tests with valid lightweight objects. Preserve all existing assertions for profile reuse, candidate preview, cancellation, retry, reconfiguration, transient storage, and job switching.

- [ ] **Step 5: Run the side-panel suite**

Run: `npm test -- tests/sidepanel`

Expected: PASS.

### Task 5: Documentation, Verification, and ZIP Delivery

**Files:**
- Modify: `README.md`
- Modify: `docs/qa/mvp-smoke-test.md`
- Modify: `docs/superpowers/specs/2026-08-18-two-stage-job-profile-design.md`
- Create: `outputs/liepin-matcher-stage-c-lightweight-flash.zip` outside the worktree after a clean build

**Interfaces:**
- Human-facing documentation describes the lightweight contract, fixed candidate Flash model, 8192-token cap, and manual real-environment acceptance boundary.

- [ ] **Step 1: Update documentation**

Mark the six-dimension candidate sections in the older design as superseded by `docs/superpowers/specs/2026-08-19-lightweight-candidate-analysis-design.md`. Update README usage and smoke checks to expect the three recommendation labels and compact evidence sections.

- [ ] **Step 2: Run focused regression tests**

Run: `npm test -- tests/contracts/contracts.test.ts tests/providers/prompt.test.ts tests/providers/deepseek-provider.test.ts tests/background/analyze-candidate.test.ts tests/sidepanel/analysis-result.test.tsx tests/sidepanel/full-workflow.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `npm run verify`

Expected: typecheck, all Vitest files, and production build pass without warnings or failures.

- [ ] **Step 4: Audit the production artifact**

Inspect `dist/manifest.json`; confirm Manifest V3 permissions/host permissions are unchanged. Search `dist` for real candidate content, names, contact numbers, Liepin URLs/IDs, legacy six-dimension UI copy, and candidate-result persistence calls. Confirm none are present except expected host permission strings in the manifest.

- [ ] **Step 5: Package the verified build**

Create `outputs/liepin-matcher-stage-c-lightweight-flash.zip` from the contents of `dist` so `manifest.json` is at the ZIP root. List the archive, compute SHA-256, and report that real Chrome/DeepSeek/Liepin validation remains the user's manual step.
