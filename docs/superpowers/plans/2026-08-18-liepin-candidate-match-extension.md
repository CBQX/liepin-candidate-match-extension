# Liepin Candidate Match Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable Chrome 116+ Manifest V3 MVP that lets a recruiter configure jobs, extract and edit the current Liepin candidate profile, and receive a structured DeepSeek-backed match analysis without persisting candidate data.

**Architecture:** The extension separates the Liepin content script, Chrome service worker, React side panel, pure matching domain, model-provider adapters, and storage repositories. The MVP uses extension-origin IndexedDB for persistent settings, `chrome.storage.session` for session-only provider settings, and a direct DeepSeek adapter behind interfaces that can later be replaced by company backends without changing extraction, scoring, or UI contracts.

**Tech Stack:** TypeScript, React, Vite, esbuild, Chrome Manifest V3 APIs, Zod, Vitest, Testing Library, jsdom, npm.

**Spec:** `docs/superpowers/specs/2026-08-18-liepin-candidate-match-extension-design.md`

> **Superseding two-stage workflow note (2026-08-19):**
> `docs/superpowers/plans/2026-08-18-two-stage-job-profile.md` implements the approved
> two-stage recruitment-profile workflow. Its job creation, provider interface,
> confirmed-profile persistence, weighting, contact recommendations, legacy-job
> compatibility, and synthetic test decisions supersede the corresponding tasks below.
> The original plan remains as historical implementation context.

> **Superseding implementation note (2026-08-18):** The original plan used
> `chrome.storage.local` for persistent jobs and remembered provider settings. Final
> security review replaced that medium with extension-origin IndexedDB. The original
> task history remains recognizable below, but every active storage instruction is
> superseded as follows: jobs, `activeJobId`, and remembered provider settings use
> IndexedDB; session-only settings use `chrome.storage.session`; `chrome.storage.local`
> is read only for atomic, idempotent legacy migration and then cleaned.

> **Superseding hard-rule safety ruling (2026-08-18):** The original matching task
> planned deterministic evaluation of recognized experience years, locations, and
> certificates. In Stage C, `years_experience`, `location`, and `certificate` must
> always evaluate to `unknown`, even for apparently exact positive or negative text.
> Candidate/JD text remains available to the provider, while extracted support facts
> and their sanitized candidate-source evidence remain extension-local. The provider-
> facing view removes evidence from every `unknown` rule result; after the provider
> returns, composition uses the full local rule results so recruiters still see that
> evidence labeled for verification even when the provider omits it. Evidence presence
> or content cannot change status, score, confidence,
> recommendation, elimination, or hard-failure downgrade. These dimensions cannot
> satisfy, fail, eliminate, or downgrade deterministically.
> Natural-language bounds, negation, plans, credential validity, and location versus
> availability are too ambiguous without maintained structured records. Safely
> structured criteria such as explicit education retain their existing behavior.

## Global Constraints

- Target Chrome Manifest V3 with `minimum_chrome_version` set to `116`; one build must run on Windows and macOS Chrome.
- Company, job description, and custom requirements are required for every job.
- Multiple jobs may be stored, but exactly zero or one job is active at a time.
- Only a user-opened single Liepin candidate detail page is analyzed; no batch processing, auto-navigation, hidden-content clicks, or background monitoring.
- The MVP has one built-in provider, DeepSeek, behind a provider registry; expose DeepSeek V4 Flash and V4 Pro model choices and default to `deepseek-v4-pro` for analysis quality.
- API keys default to `chrome.storage.session`; an explicit “remember this device” choice stores provider settings in extension-origin IndexedDB.
- Candidate drafts and analysis results never enter persistent storage, sync storage, IndexedDB, logs, telemetry, or analytics.
- Remove direct contact identifiers and replace the candidate name before model submission; never send the Liepin URL or candidate ID.
- Unknown candidate information is not a mismatch. Every match or mismatch must carry job-side and candidate-side evidence.
- Stage C deterministic hard-rule evaluation always returns `unknown` for location, experience years, and certificates; preserve sanitized source evidence in the final local rule result independently of provider output, label it for recruiter verification, and leave safely structured criteria such as explicit education unchanged.
- Protected or irrelevant traits such as sex, ethnicity, marital status, or fertility must never affect scoring.
- Request only `sidePanel`, `storage`, Liepin host access, and DeepSeek host access in the MVP manifest.
- Use Test-Driven Development for every domain, adapter, and UI behavior; each task ends with a focused test run and commit.
- Use Node.js 20 or newer and npm; commit `package-lock.json` for reproducible installs.

---

## File Structure

```text
.
├── package.json                         npm scripts and dependency manifest
├── package-lock.json                    reproducible dependency lock
├── tsconfig.json                        strict TypeScript configuration
├── vite.config.ts                       React side-panel build
├── vitest.config.ts                     unit and component test configuration
├── sidepanel.html                       Vite HTML entry
├── public/
│   └── manifest.json                    Chrome MV3 manifest
├── scripts/
│   └── build-extension.mjs              bundles content/background entries into dist
├── src/
│   ├── background/
│   │   ├── service-worker.ts            Chrome event registration and storage isolation
│   │   ├── controller.ts                testable runtime-message orchestration
│   │   └── analyze-candidate.ts         provider/rules/composer analysis pipeline
│   ├── content/
│   │   ├── index.ts                     content-script message listener
│   │   ├── extract-candidate.ts         semantic section extraction
│   │   ├── extract-visible-text.ts      visibility and text normalization helpers
│   │   └── section-aliases.ts           Chinese section-heading dictionary
│   ├── domain/
│   │   ├── jobs/
│   │   │   ├── job-service.ts           job validation and activation operations
│   │   │   └── job-repository.ts        repository interface
│   │   └── matching/
│   │       ├── requirements.ts           criterion classification
│   │       ├── facts.ts                  deterministic candidate fact extraction
│   │       ├── rules.ts                  objective rule evaluation
│   │       ├── weights.ts                fixed score dimensions and weights
│   │       └── compose-analysis.ts       score, confidence, and recommendation assembly
│   ├── providers/
│   │   ├── model-provider.ts             replaceable provider interface and registry
│   │   └── deepseek/
│   │       ├── deepseek-provider.ts      credential validation, request, retry, errors
│   │       └── prompt.ts                 evidence-bound Chinese analysis prompt
│   ├── repositories/
│   │   ├── chrome-job-repository.ts      local job persistence
│   │   ├── chrome-provider-settings.ts   session/IndexedDB API-key persistence
│   │   ├── indexeddb-storage-area.ts     extension-origin persistent storage
│   │   ├── migrating-persistent-storage.ts atomic legacy-local migration
│   │   └── storage-area.ts               Chrome storage test seam
│   ├── shared/
│   │   ├── contracts/
│   │   │   ├── job.ts                    Job schema and type
│   │   │   ├── candidate.ts              transient candidate draft schema
│   │   │   ├── matching.ts               criteria/model/final result schemas
│   │   │   └── messages.ts               runtime message schemas
│   │   ├── errors.ts                     typed user-facing error codes
│   │   └── privacy.ts                    identifier redaction
│   └── sidepanel/
│       ├── main.tsx                      React mount point
│       ├── App.tsx                       top-level screen state machine
│       ├── app-dependencies.ts           Chrome runtime/repository dependency wiring
│       ├── analysis-session.ts           transient reducer and clearing rules
│       ├── components/
│       │   ├── ModelSettingsForm.tsx      provider, model, key, remember-device UI
│       │   ├── JobForm.tsx                three required job fields
│       │   ├── JobSelector.tsx            active-job selection and add action
│       │   ├── ReadyState.tsx             ready prompt and extraction trigger
│       │   ├── CandidatePreview.tsx       editable extraction preview
│       │   ├── AnalysisProgress.tsx       in-flight state
│       │   ├── AnalysisResult.tsx         structured recruiter report
│       │   └── ErrorState.tsx             actionable retry/reconfigure states
│       └── styles.css                     scoped side-panel styles
├── tests/
│   ├── build/                             manifest/build assertions
│   ├── contracts/                         schema tests
│   ├── repositories/                      storage tests with fakes
│   ├── matching/                          requirements/rules/composer tests
│   ├── content/fixtures/                  synthetic anonymized profile HTML
│   ├── content/                           extractor tests
│   ├── background/                        controller/pipeline tests
│   ├── providers/                         mocked DeepSeek transport tests
│   ├── privacy/                           redaction tests
│   └── sidepanel/                         component and workflow tests
├── docs/qa/mvp-smoke-test.md              manual Windows/macOS acceptance script
└── README.md                              install, configure, build, and privacy notes
```

---

### Task 1: Buildable Chrome Extension Shell

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `sidepanel.html`
- Create: `public/manifest.json`
- Create: `scripts/build-extension.mjs`
- Create: `src/sidepanel/main.tsx`
- Create: `src/sidepanel/App.tsx`
- Create: `src/sidepanel/styles.css`
- Create: `src/background/service-worker.ts`
- Create: `src/content/index.ts`
- Test: `tests/build/manifest.test.ts`

**Interfaces:**
- Consumes: none.
- Produces: `npm run build`, `npm run typecheck`, `npm test`, and a loadable `dist/` directory containing `manifest.json`, `sidepanel.html`, `background.js`, and `content.js`.

- [ ] **Step 1: Create the npm/test scaffolding and a failing build contract**

Create `package.json` with these scripts and install the named dependencies:

```json
{
  "name": "liepin-candidate-match-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build && node scripts/build-extension.mjs",
    "dev": "vite build --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "verify": "npm run typecheck && npm test && npm run build"
  }
}
```

Run:

```bash
npm install react react-dom zod
npm install --save-dev typescript vite @vitejs/plugin-react esbuild vitest jsdom @testing-library/react @testing-library/user-event @types/chrome @types/react @types/react-dom
```

Create `tests/build/manifest.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("targets Chrome 116 MV3 with only MVP permissions", async () => {
    const raw = await readFile("public/manifest.json", "utf8");
    const manifest = JSON.parse(raw);
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.permissions.sort()).toEqual(["sidePanel", "storage"]);
    expect(manifest.host_permissions.sort()).toEqual([
      "https://*.liepin.com/*",
      "https://api.deepseek.com/*"
    ]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/build/manifest.test.ts`

Expected: FAIL because `public/manifest.json` does not exist.

- [ ] **Step 3: Add the minimal manifest, Vite page, and script bundler**

Create `public/manifest.json` with the exact MV3 keys:

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "116",
  "name": "猎头匹配助手",
  "description": "在猎聘候选人详情页中进行岗位匹配分析。",
  "version": "0.1.0",
  "permissions": ["sidePanel", "storage"],
  "host_permissions": [
    "https://*.liepin.com/*",
    "https://api.deepseek.com/*"
  ],
  "action": { "default_title": "打开猎头匹配助手" },
  "side_panel": { "default_path": "sidepanel.html" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["https://*.liepin.com/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }]
}
```

Create `vite.config.ts` so the public manifest and side-panel entry land in `dist/`:

```ts
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { sidepanel: resolve(process.cwd(), "sidepanel.html") } }
  }
});
```

Use strict TypeScript with `target: "ES2022"`, `moduleResolution: "Bundler"`, `jsx: "react-jsx"`, `types: ["chrome", "vitest/globals"]`, and `noEmit: true`. Configure Vitest with `environment: "jsdom"` and test globs under `tests/**/*.test.{ts,tsx}`.

Create `sidepanel.html` with `<div id="root"></div>` and `<script type="module" src="/src/sidepanel/main.tsx"></script>`. Mount this minimal component in Task 1:

```tsx
export function App() {
  return <main><h1>猎头匹配助手</h1></main>;
}
```

Create `scripts/build-extension.mjs`:

```js
import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["src/background/service-worker.ts"],
    outfile: "dist/background.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116"
  }),
  build({
    entryPoints: ["src/content/index.ts"],
    outfile: "dist/content.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116"
  })
]);
```

Keep `App.tsx` to a single rendered heading, and keep the two script entry files side-effect free except for a temporary `console.info` that is removed in Task 6.

- [ ] **Step 4: Run shell verification**

Run:

```bash
npm test -- tests/build/manifest.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0; `dist/manifest.json`, `dist/sidepanel.html`, `dist/background.js`, and `dist/content.js` exist.

- [ ] **Step 5: Commit the extension shell**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts sidepanel.html public scripts src tests/build
git commit -m "build: scaffold Chrome extension shell"
```

---

### Task 2: Shared Runtime Contracts

**Files:**
- Create: `src/shared/contracts/job.ts`
- Create: `src/shared/contracts/candidate.ts`
- Create: `src/shared/contracts/matching.ts`
- Create: `src/shared/contracts/messages.ts`
- Create: `src/shared/errors.ts`
- Test: `tests/contracts/contracts.test.ts`

**Interfaces:**
- Consumes: Zod from Task 1.
- Produces: `Job`, `CandidateDraft`, `JobCriterion`, `RuleEvaluation`, `ModelMatchResult`, `MatchAnalysis`, `RuntimeRequest`, `RuntimeResponse`, and `AppErrorCode`.

- [ ] **Step 1: Write failing schema tests**

Create `tests/contracts/contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { jobSchema } from "../../src/shared/contracts/job";
import { matchAnalysisSchema } from "../../src/shared/contracts/matching";

describe("runtime contracts", () => {
  it("rejects a job with any blank required field", () => {
    expect(jobSchema.safeParse({
      id: "job-1",
      company: "甲公司",
      jd: "   ",
      customRequirements: "需要 B2B 经验",
      createdAt: "2026-08-18T00:00:00.000Z",
      updatedAt: "2026-08-18T00:00:00.000Z"
    }).success).toBe(false);
  });

  it("rejects out-of-range analysis scores", () => {
    expect(matchAnalysisSchema.safeParse({
      overallScore: 101,
      recommendation: "strong_recommend",
      confidence: "high",
      dimensionScores: [],
      hardRequirements: [],
      matches: [], mismatches: [], risks: [], missingInformation: [],
      verificationQuestions: [], outreachAdvice: [], recruiterConclusion: "推进"
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify module failures**

Run: `npm test -- tests/contracts/contracts.test.ts`

Expected: FAIL because the contract modules do not exist.

- [ ] **Step 3: Implement exact schemas and inferred types**

Define `jobSchema` with trimmed non-empty `company`, `jd`, and `customRequirements`. Define candidate sections with status values `complete`, `possibly_incomplete`, and `missing`. Define these matching identifiers:

```ts
export const dimensionIds = [
  "hard_requirements",
  "functional_expertise",
  "industry_business",
  "seniority_impact",
  "trajectory_stability",
  "recruiter_feasibility"
] as const;

export const requirementStatuses = ["met", "not_met", "unknown"] as const;
export const recommendations = [
  "strong_recommend", "recommend", "cautious", "not_recommend"
] as const;
```

Use separate `modelMatchResultSchema` and `matchAnalysisSchema`: the model result contains dimension scores and qualitative evidence, while the final analysis additionally contains the locally computed `overallScore`, `recommendation`, and `confidence`.

Define request types `EXTRACT_CURRENT_CANDIDATE`, `VALIDATE_PROVIDER`, and `ANALYZE_CANDIDATE`, plus the service-worker event `PAGE_CONTEXT_CHANGED`. Every request response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

Define `AppErrorCode` values: `UNSUPPORTED_PAGE`, `EXTRACTION_FAILED`, `MISSING_API_KEY`, `INVALID_API_KEY`, `RATE_LIMITED`, `INSUFFICIENT_BALANCE`, `MODEL_TIMEOUT`, `INVALID_MODEL_OUTPUT`, `STORAGE_FAILED`, and `UNKNOWN`.

- [ ] **Step 4: Run contracts and type checking**

Run:

```bash
npm test -- tests/contracts/contracts.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit runtime contracts**

```bash
git add src/shared tests/contracts
git commit -m "feat: define extension runtime contracts"
```

---

### Task 3: Job and Provider Settings Persistence

> **Superseded storage detail:** this task originally treated the first repository
> argument as `chrome.storage.local`. The implemented repository seam is unchanged,
> but that argument is now extension-origin IndexedDB; only the second, session
> argument is a Chrome Storage area.

**Files:**
- Create: `src/domain/jobs/job-repository.ts`
- Create: `src/domain/jobs/job-service.ts`
- Create: `src/repositories/storage-area.ts`
- Create: `src/repositories/chrome-job-repository.ts`
- Create: `src/repositories/chrome-provider-settings.ts`
- Test: `tests/repositories/chrome-job-repository.test.ts`
- Test: `tests/repositories/chrome-provider-settings.test.ts`
- Test: `tests/domain/job-service.test.ts`

**Interfaces:**
- Consumes: `Job` and `jobSchema` from Task 2.
- Produces: `JobRepository`, `JobService`, `ChromeJobRepository`, `ChromeProviderSettingsRepository`, and `ProviderSettings`.

- [ ] **Step 1: Write failing repository and service tests**

Use an in-memory `StorageAreaLike` fake. The job test must prove save-and-activate preserves prior jobs:

```ts
it("stores multiple jobs and activates only the newest saved job", async () => {
  const repository = new ChromeJobRepository(new MemoryStorageArea());
  await repository.saveAndActivate(jobA);
  await repository.saveAndActivate(jobB);

  expect(await repository.list()).toEqual([jobA, jobB]);
  expect((await repository.getActive())?.id).toBe(jobB.id);
});
```

The settings test must prove default session storage and explicit persistent storage:

```ts
it("keeps the key in session unless rememberDevice is true", async () => {
  const repo = new ChromeProviderSettingsRepository(persistent, session);
  await repo.save(settings, false);
  expect((await session.get("providerSettings")).providerSettings.apiKey).toBe("sk-test");
  expect((await persistent.get("providerSettings")).providerSettings).toBeUndefined();
});
```

- [ ] **Step 2: Run tests and verify missing modules**

Run: `npm test -- tests/repositories tests/domain/job-service.test.ts`

Expected: FAIL because repositories and services do not exist.

- [ ] **Step 3: Implement storage seams and job operations**

Use this storage seam so tests never depend on global Chrome objects:

```ts
export interface StorageAreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}
```

`JobRepository` exposes `list()`, `getActive()`, `saveAndActivate(job)`, and `activate(id)`. `JobService.createAndActivate(input)` trims fields, rejects blanks through `jobSchema`, creates an ID with `crypto.randomUUID()`, writes ISO timestamps, and delegates to the repository.

`ChromeProviderSettingsRepository.save(settings, rememberDevice)` removes the stale copy from the other storage area. `load()` checks session first and extension-origin IndexedDB second. `clear()` removes both copies. `MigratingPersistentStorageArea` may read the three legacy keys from `chrome.storage.local`, but its IndexedDB adapter must atomically write only absent values and an idempotent migration marker before legacy cleanup; independent side-panel/service-worker migrators must never overwrite a newer value.

- [ ] **Step 4: Run persistence tests**

Run:

```bash
npm test -- tests/repositories tests/domain/job-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit persistence**

```bash
git add src/domain/jobs src/repositories tests/repositories tests/domain
git commit -m "feat: persist jobs and provider settings"
```

---

### Task 4: Deterministic Requirements, Rules, and Score Composer

**Files:**
- Create: `src/domain/matching/requirements.ts`
- Create: `src/domain/matching/facts.ts`
- Create: `src/domain/matching/rules.ts`
- Create: `src/domain/matching/weights.ts`
- Create: `src/domain/matching/compose-analysis.ts`
- Test: `tests/matching/requirements.test.ts`
- Test: `tests/matching/rules.test.ts`
- Test: `tests/matching/compose-analysis.test.ts`

**Interfaces:**
- Consumes: `Job`, `CandidateDraft`, `JobCriterion`, `RuleEvaluation`, and `ModelMatchResult` from Task 2.
- Produces: `parseJobCriteria(job)`, `extractObjectiveFacts(draft)`, `evaluateObjectiveRules(criteria, facts)`, and `composeAnalysis(modelResult, ruleResults, extractionConfidence)`.

- [ ] **Step 1: Write failing requirement and rule tests**

Create tests for priority, source, and unknown handling:

```ts
it("treats explicit custom must-have language as hard and higher priority", () => {
  const criteria = parseJobCriteria({
    ...job,
    jd: "本科优先\n有企业软件经验",
    customRequirements: "必须有 5 年以上 B2B 产品经验"
  });
  expect(criteria[0]).toMatchObject({
    priority: "hard",
    source: "custom",
    text: "必须有 5 年以上 B2B 产品经验"
  });
});

it("returns unknown instead of mismatch when education is absent", () => {
  const result = evaluateObjectiveRules(
    [{ id: "c1", text: "必须本科", priority: "hard", source: "custom" }],
    { tokens: new Set(), educationLevel: undefined }
  );
  expect(result[0].status).toBe("unknown");
});
```

- [ ] **Step 2: Write failing score-composer tests**

```ts
it("computes the weighted score and prevents strong recommendation on a hard failure", () => {
  const analysis = composeAnalysis(modelResultWithAllDimensionsAt(90), [
    { criterionId: "c1", status: "not_met", evidence: ["候选人明确为大专"] }
  ], "high");
  expect(analysis.overallScore).toBe(90);
  expect(analysis.recommendation).toBe("recommend");
});

it("lowers confidence for unknown hard requirements without deducting score", () => {
  const analysis = composeAnalysis(modelResultWithAllDimensionsAt(80), [
    { criterionId: "c1", status: "unknown", evidence: [] }
  ], "medium");
  expect(analysis.overallScore).toBe(80);
  expect(analysis.confidence).toBe("medium");
});
```

- [ ] **Step 3: Run matching tests and verify failures**

Run: `npm test -- tests/matching`

Expected: FAIL because matching modules do not exist.

- [ ] **Step 4: Implement the pure matching domain**

Use these exact fixed weights:

```ts
export const DIMENSION_WEIGHTS = {
  hard_requirements: 0.25,
  functional_expertise: 0.25,
  industry_business: 0.15,
  seniority_impact: 0.15,
  trajectory_stability: 0.10,
  recruiter_feasibility: 0.10
} as const;
```

`parseJobCriteria` splits non-empty lines and Chinese sentence delimiters, processes custom requirements before JD, classifies `必须|硬性|不接受|不可` as hard and `优先|加分|最好|优选` as preferred, and otherwise uses standard priority.

`extractObjectiveFacts` recognizes only explicit evidence: education levels, text such as `N 年经验`, visible location labels, language certificates, and professional certificate tokens. It must not infer age, sex, salary, motivation, or availability. From the already-redacted candidate draft it also records typed source-evidence channels for experience clauses, credential mentions, and labeled locations; these remain extension-local support data for recruiter evidence, not deterministic hard gates, and must contain no identity, contact, URL, or platform identifier.

`evaluateObjectiveRules` may evaluate only safely structured recognized patterns such as explicit education. It must return `unknown` for every `years_experience`, `location`, and `certificate` hard criterion regardless of extracted fact or wording; unsupported criteria also return `unknown`. For the three breaker families it attaches any relevant sanitized candidate-source evidence without changing status. Before the provider call, `analyzeCandidate` creates a provider-facing copy that strips evidence from every `unknown` rule result while retaining allowed deterministic evidence (for example, explicit education); after the call, `composeAnalysis` receives the full local rule results. Tests must cover exact positive and negative/qualified probes, adversarial provider branching, provider omission, final UI preservation, and prove these three families never produce `met` or `not_met`, while education behavior remains unchanged. `composeAnalysis` validates every dimension exists once, computes the rounded weighted score, applies the four score bands, downgrades one level for one supported deterministic hard failure, sets `not_recommend` for two or more such failures, and derives confidence from unknown hard criteria and extraction confidence; evidence presence must not affect any of those calculations.

- [ ] **Step 5: Run all matching tests**

Run:

```bash
npm test -- tests/matching
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the matching domain**

```bash
git add src/domain/matching tests/matching
git commit -m "feat: add explainable matching domain"
```

---

### Task 5: Liepin Candidate Extraction and Manual-Fallback Draft

**Files:**
- Create: `src/content/section-aliases.ts`
- Create: `src/content/extract-visible-text.ts`
- Create: `src/content/extract-candidate.ts`
- Modify: `src/content/index.ts`
- Create: `tests/content/fixtures/complete-profile.html`
- Create: `tests/content/fixtures/missing-education.html`
- Create: `tests/content/fixtures/unstructured-profile.html`
- Test: `tests/content/extract-candidate.test.ts`

**Interfaces:**
- Consumes: `CandidateDraft` and `RuntimeRequest` from Task 2.
- Produces: `extractCandidate(document, location): CandidateDraft` and a content-script responder for `EXTRACT_CURRENT_CANDIDATE`.

- [ ] **Step 1: Create synthetic anonymized fixtures and failing extractor tests**

Fixtures contain realistic Chinese headings but no real candidate names, contacts, IDs, or company-confidential text. Test semantic extraction and fallback:

```ts
it("extracts visible work and education sections by semantic headings", () => {
  document.body.innerHTML = completeFixture;
  const draft = extractCandidate(document, new URL("https://www.liepin.com/candidate/fixture"));
  expect(draft.workExperience.status).toBe("complete");
  expect(draft.workExperience.text).toContain("企业软件产品经理");
  expect(draft.education.status).toBe("complete");
});

it("marks missing education as missing instead of mismatch", () => {
  document.body.innerHTML = missingEducationFixture;
  expect(extractCandidate(document, liepinUrl).education.status).toBe("missing");
});

it("returns visible body text as an editable low-confidence fallback", () => {
  document.body.innerHTML = unstructuredFixture;
  const draft = extractCandidate(document, liepinUrl);
  expect(draft.other.status).toBe("possibly_incomplete");
  expect(draft.extractionConfidence).toBe("low");
});
```

- [ ] **Step 2: Run extractor tests and verify failures**

Run: `npm test -- tests/content/extract-candidate.test.ts`

Expected: FAIL because `extractCandidate` does not exist.

- [ ] **Step 3: Implement visible semantic extraction**

Define aliases for basics, work experience, projects, education, skills, and other information. `extractVisibleText` must ignore elements hidden by `display:none`, `visibility:hidden`, the `hidden` attribute, and `aria-hidden="true"`; collapse repeated whitespace.

`extractCandidate` must:

1. Reject non-`liepin.com` hosts.
2. Find heading elements and exact-text heading candidates.
3. Collect visible sibling text until the next recognized heading.
4. Set section status according to extracted length and structure.
5. Use visible `document.body` text as `other` when fewer than two semantic sections are found.
6. Never click, scroll, expand, fetch, or mutate the page.

In `src/content/index.ts`, register one listener that accepts only `EXTRACT_CURRENT_CANDIDATE`, calls the extractor, returns the standard runtime response, and returns `true` while replying asynchronously.

- [ ] **Step 4: Run extraction and build checks**

Run:

```bash
npm test -- tests/content/extract-candidate.test.ts
npm run typecheck
npm run build
```

Expected: PASS and no new manifest permissions.

- [ ] **Step 5: Commit extraction**

```bash
git add src/content tests/content
git commit -m "feat: extract editable Liepin candidate drafts"
```

---

### Task 6: Testable Background Message Controller

**Files:**
- Create: `src/background/controller.ts`
- Modify: `src/background/service-worker.ts`
- Test: `tests/background/controller.test.ts`

**Interfaces:**
- Consumes: runtime contracts from Task 2 and the content responder from Task 5.
- Produces: `createBackgroundController(deps)` and Chrome registrations for side-panel opening, extension-origin persistence, trusted session storage, extraction relay, and page-context change events.

- [ ] **Step 1: Write failing controller tests**

Inject tab and messaging functions instead of mocking the whole Chrome namespace:

```ts
it("rejects a non-Liepin active tab before messaging content", async () => {
  const sendToTab = vi.fn();
  const controller = createBackgroundController({
    getActiveTab: async () => ({ id: 7, url: "https://example.com" }),
    sendToTab
  });
  const result = await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });
  expect(result).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_PAGE" } });
  expect(sendToTab).not.toHaveBeenCalled();
});

it("relays extraction only to the current Liepin tab", async () => {
  const sendToTab = vi.fn().mockResolvedValue({ ok: true, data: candidateDraft });
  const controller = createBackgroundController({
    getActiveTab: async () => ({ id: 9, url: "https://www.liepin.com/candidate/x" }),
    sendToTab
  });
  await controller.handle({ type: "EXTRACT_CURRENT_CANDIDATE" });
  expect(sendToTab).toHaveBeenCalledWith(9, { type: "EXTRACT_CURRENT_CANDIDATE" });
});
```

- [ ] **Step 2: Run the controller test and verify failure**

Run: `npm test -- tests/background/controller.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement controller and Chrome registration**

`service-worker.ts` must:

```ts
const persistentStorage = new MigratingPersistentStorageArea(
  new IndexedDbStorageArea(globalThis.indexedDB),
  chrome.storage.local // legacy migration source only
);

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await persistentStorage.get([]); // idempotent legacy cleanup
});
```

Register `chrome.runtime.onMessage` with `sendResponse` and `return true`, parse every request through the runtime request schema, and pass it to `controller.handle`. Remove the Task 1 temporary logging. Unknown or invalid messages return `{ ok: false, error: { code: "UNKNOWN", message: "无法识别的插件请求。" } }`.

Register `chrome.tabs.onActivated` and `chrome.tabs.onUpdated`. When the active tab changes or begins loading, broadcast `{ type: "PAGE_CONTEXT_CHANGED" }` to extension pages; the side panel will use this event in Task 9 to clear transient candidate and result state. This uses the existing Liepin host permission and must not add the broad `tabs` permission.

- [ ] **Step 4: Run background tests and build**

Run:

```bash
npm test -- tests/background/controller.test.ts
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit background orchestration**

```bash
git add src/background tests/background
git commit -m "feat: orchestrate extension messages safely"
```

---

### Task 7: DeepSeek Provider, Evidence Prompt, and Retry Policy

**Files:**
- Create: `src/providers/model-provider.ts`
- Create: `src/providers/deepseek/prompt.ts`
- Create: `src/providers/deepseek/deepseek-provider.ts`
- Modify: `src/background/controller.ts`
- Modify: `src/background/service-worker.ts`
- Test: `tests/providers/deepseek-provider.test.ts`
- Test: `tests/providers/prompt.test.ts`

**Interfaces:**
- Consumes: `ProviderSettings`, `Job`, `CandidateDraft`, `JobCriterion`, `RuleEvaluation`, and `ModelMatchResult`.
- Produces: `ModelProvider`, `ModelProviderRegistry`, `DeepSeekProvider`, `buildAnalysisPrompt(input)`, and `mapProviderError(error)`.

- [ ] **Step 1: Write failing credential and request tests with a fake transport**

```ts
it("validates a key with GET /models", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    object: "list", data: [{ id: "deepseek-v4-pro" }]
  }), { status: 200 }));
  await new DeepSeekProvider(fetcher).validateCredentials(settings);
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.deepseek.com/models",
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer sk-test" }) })
  );
});

it("requests strict JSON analysis with the selected model", async () => {
  const fetcher = successfulChatCompletion(modelResult);
  await new DeepSeekProvider(fetcher).analyze(input, {
    ...settings, model: "deepseek-v4-pro"
  });
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.model).toBe("deepseek-v4-pro");
  expect(body.thinking).toEqual({ type: "disabled" });
});
```

- [ ] **Step 2: Write failing retry and error tests**

Cover empty content followed by valid content, invalid output twice, HTTP 401, 429, timeout via `AbortController`, and insufficient balance. Assert that exactly one retry occurs for empty/invalid output and no retry occurs for authentication errors.

- [ ] **Step 3: Run provider tests and verify failures**

Run: `npm test -- tests/providers`

Expected: FAIL because provider modules do not exist.

- [ ] **Step 4: Implement provider registry, prompt, and DeepSeek adapter**

`ModelProvider` exposes:

```ts
export interface ModelProvider {
  id: "deepseek";
  models: readonly ["deepseek-v4-flash", "deepseek-v4-pro"];
  validateCredentials(settings: ProviderSettings): Promise<void>;
  analyze(input: MatchInput, settings: ProviderSettings): Promise<ModelMatchResult>;
}
```

The Chinese system prompt must require JSON, repeat all output field names, forbid protected-trait scoring, forbid unsupported factual inference, require job-side and candidate-side evidence, and say that missing information must be returned as unknown or a verification question.

Call `https://api.deepseek.com/chat/completions` with `response_format: { type: "json_object" }`, the selected V4 model, `thinking: { type: "disabled" }`, and an `AbortController` timeout of 60 seconds. Parse with `modelMatchResultSchema`. Retry once for empty, truncated, or invalid content using a repair instruction; then throw `INVALID_MODEL_OUTPUT`.

Extend the background controller with `VALIDATE_PROVIDER`. The service worker loads settings supplied by the UI, resolves `deepseek` from the provider registry, calls `validateCredentials`, maps provider errors to the standard runtime error, and returns no key material in the response.

- [ ] **Step 5: Run provider tests and type checking**

Run:

```bash
npm test -- tests/providers
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit model-provider support**

```bash
git add src/providers tests/providers
git commit -m "feat: add validated DeepSeek analysis provider"
```

---

### Task 8: Model Settings and Multi-Job Side-Panel UI

**Files:**
- Create: `src/sidepanel/app-dependencies.ts`
- Create: `src/sidepanel/components/ModelSettingsForm.tsx`
- Create: `src/sidepanel/components/JobForm.tsx`
- Create: `src/sidepanel/components/JobSelector.tsx`
- Create: `src/sidepanel/components/ReadyState.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/styles.css`
- Test: `tests/sidepanel/settings-and-jobs.test.tsx`

**Interfaces:**
- Consumes: job/settings repositories from Task 3 and the `VALIDATE_PROVIDER` runtime request from Task 2.
- Produces: the side-panel states `needs_model`, `needs_job`, and `ready`, plus `SidePanelDependencies` for test injection.

- [ ] **Step 1: Write failing model-settings UI tests**

```tsx
it("requires a key and saves session storage by default", async () => {
  const deps = createFakeDependencies();
  render(<App deps={deps} />);
  await user.type(screen.getByLabelText("DeepSeek API Key"), "sk-test");
  await user.click(screen.getByRole("button", { name: "验证并保存" }));
  expect(deps.validateProvider).toHaveBeenCalled();
  expect(deps.providerSettings.save).toHaveBeenCalledWith(
    expect.objectContaining({ providerId: "deepseek", apiKey: "sk-test" }), false
  );
});
```

Also assert that the model selector contains V4 Pro and V4 Flash, the API key input is password-masked, and the remember-device checkbox defaults to unchecked.

- [ ] **Step 2: Write failing job UI tests**

Assert all three fields are required, successful save activates the new job, two jobs remain selectable, direct switching changes the active job, and the ready state says the user can browse candidates.

- [ ] **Step 3: Run UI tests and verify failures**

Run: `npm test -- tests/sidepanel/settings-and-jobs.test.tsx`

Expected: FAIL because components and app dependencies do not exist.

- [ ] **Step 4: Implement settings, job, and ready screens**

`SidePanelDependencies` must expose repository methods and runtime calls, so component tests do not use global Chrome APIs. `app-dependencies.ts` is the only side-panel file that directly calls `chrome.runtime.sendMessage` or constructs Chrome repositories.

Use native labels, inputs, textarea, select, checkbox, and buttons. Show Chinese field-level validation. Keep the active job selector visible at the top after at least one job exists. “添加新岗位” opens a blank form without overwriting existing jobs.

- [ ] **Step 5: Run side-panel foundation tests**

Run:

```bash
npm test -- tests/sidepanel/settings-and-jobs.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit settings and jobs UI**

```bash
git add src/sidepanel tests/sidepanel/settings-and-jobs.test.tsx
git commit -m "feat: add model and job setup workflow"
```

---

### Task 9: Editable Candidate Preview and Privacy Lifecycle

**Files:**
- Create: `src/shared/privacy.ts`
- Create: `src/sidepanel/analysis-session.ts`
- Create: `src/sidepanel/components/CandidatePreview.tsx`
- Create: `src/sidepanel/components/ErrorState.tsx`
- Modify: `src/sidepanel/App.tsx`
- Test: `tests/privacy/redaction.test.ts`
- Test: `tests/sidepanel/candidate-preview.test.tsx`
- Test: `tests/sidepanel/analysis-session.test.ts`

**Interfaces:**
- Consumes: `CandidateDraft`, `EXTRACT_CURRENT_CANDIDATE`, and the ready UI from Task 8.
- Produces: `redactCandidateDraft(draft)`, `analysisSessionReducer`, editable preview UI, unsupported-page UI, and extraction retry.

- [ ] **Step 1: Write failing privacy tests**

```ts
it("removes direct identifiers without removing employment evidence", () => {
  const redacted = redactCandidateDraft(candidateDraftWith(
    "张三，手机 13812345678，邮箱 zhangsan@example.com，微信 zhangsan88，曾任甲公司产品经理"
  ));
  const text = [redacted.basics, redacted.workExperience, redacted.projects,
    redacted.education, redacted.skills, redacted.other]
    .map((section) => section.text).join(" ");
  expect(text).not.toContain("13812345678");
  expect(text).not.toContain("zhangsan@example.com");
  expect(text).not.toContain("zhangsan88");
  expect(text).not.toContain("张三");
  expect(text).toContain("甲公司产品经理");
});
```

- [ ] **Step 2: Write failing preview and clearing tests**

Assert extraction statuses are visible, all section textareas are editable, `missing` is not displayed as mismatch, and `JOB_CHANGED`, `PAGE_CHANGED`, and `SESSION_ENDED` actions clear both draft and result.

- [ ] **Step 3: Run focused tests and verify failures**

Run:

```bash
npm test -- tests/privacy tests/sidepanel/candidate-preview.test.tsx tests/sidepanel/analysis-session.test.ts
```

Expected: FAIL because privacy and preview modules do not exist.

- [ ] **Step 4: Implement redaction, preview, consent, and transient reducer**

Redact mainland mobile numbers, email addresses, labeled WeChat/QQ/contact values, and the name extracted from the basics section. Replace names with `候选人`; replace other identifiers with `[已移除]`. Do not redact employer names, titles, dates, education, skills, or achievements.

The preview must show the disclosure “确认后，以下脱敏内容将发送至 DeepSeek 进行本次分析” immediately above the confirm button. The reducer owns all candidate and result data; no repository receives either value. Register `beforeunload` to dispatch `SESSION_ENDED`, dispatch `JOB_CHANGED` before activating another job, and listen for `PAGE_CONTEXT_CHANGED` runtime events to dispatch `PAGE_CHANGED`.

- [ ] **Step 5: Run privacy and preview tests**

Run:

```bash
npm test -- tests/privacy tests/sidepanel/candidate-preview.test.tsx tests/sidepanel/analysis-session.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit candidate preview and privacy lifecycle**

```bash
git add src/shared/privacy.ts src/sidepanel tests/privacy tests/sidepanel
git commit -m "feat: add private editable candidate preview"
```

---

### Task 10: End-to-End Analysis Pipeline and Recruiter Result UI

**Files:**
- Create: `src/background/analyze-candidate.ts`
- Modify: `src/background/controller.ts`
- Modify: `src/background/service-worker.ts`
- Create: `src/sidepanel/components/AnalysisProgress.tsx`
- Create: `src/sidepanel/components/AnalysisResult.tsx`
- Modify: `src/sidepanel/App.tsx`
- Test: `tests/background/analyze-candidate.test.ts`
- Test: `tests/sidepanel/analysis-workflow.test.tsx`
- Test: `tests/sidepanel/analysis-result.test.tsx`

**Interfaces:**
- Consumes: all Task 2 contracts, repositories from Task 3, matching functions from Task 4, provider from Task 7, and preview/session state from Task 9.
- Produces: `analyzeCandidate(request, deps): Promise<MatchAnalysis>` and the final side-panel states `analyzing`, `result`, and recoverable `error`.

- [ ] **Step 1: Write failing background-pipeline tests**

```ts
it("redacts, evaluates rules, calls the provider, and composes a final analysis", async () => {
  const provider = { analyze: vi.fn().mockResolvedValue(modelResult) };
  const analysis = await analyzeCandidate({ job, candidateDraft }, {
    provider,
    settings: providerSettings,
    redact: redactCandidateDraft
  });
  expect(provider.analyze).toHaveBeenCalledWith(
    expect.objectContaining({
      candidateDraft: expect.not.objectContaining({ pageUrl: expect.anything() }),
      criteria: expect.any(Array),
      ruleEvaluations: expect.any(Array)
    }),
    providerSettings
  );
  expect(analysis.overallScore).toBeGreaterThanOrEqual(0);
  expect(analysis.overallScore).toBeLessThanOrEqual(100);
});
```

Add a test proving `MISSING_API_KEY` is returned before provider invocation and a test proving provider errors map to standard runtime error responses.

- [ ] **Step 2: Write failing result-view tests**

Assert the result renders total score, Chinese recommendation, confidence, six dimensions, hard-condition statuses, matches, mismatches, risks, missing information, verification questions, outreach advice, and recruiter conclusion. Assert every evidence item is visible under its claim.

- [ ] **Step 3: Write a failing workflow retry test**

Render `App` with fake dependencies. Drive ready → extract → edit → confirm → timeout → retry → result. Assert the edited preview value remains after the timeout and the second call reuses it.

- [ ] **Step 4: Run analysis tests and verify failures**

Run:

```bash
npm test -- tests/background/analyze-candidate.test.ts tests/sidepanel/analysis-workflow.test.tsx tests/sidepanel/analysis-result.test.tsx
```

Expected: FAIL because the pipeline and result components do not exist.

- [ ] **Step 5: Implement the analysis pipeline**

The background pipeline must perform this exact sequence:

```ts
const cleanCandidate = deps.redact(request.candidateDraft);
const criteria = parseJobCriteria(request.job);
const facts = extractObjectiveFacts(cleanCandidate);
const ruleEvaluations = evaluateObjectiveRules(criteria, facts);
const modelResult = await deps.provider.analyze(
  { job: request.job, candidateDraft: cleanCandidate, criteria, ruleEvaluations },
  deps.settings
);
return composeAnalysis(modelResult, ruleEvaluations, cleanCandidate.extractionConfidence);
```

Add `ANALYZE_CANDIDATE` handling to the controller. The service worker loads provider settings, resolves the provider through the registry, and never logs the request body, API key, candidate, or result.

- [ ] **Step 6: Implement progress, result, and recoverable errors**

Show a progress state only after user confirmation. On timeout, rate limit, insufficient balance, or invalid output, return to the preview-preserving error state with one primary retry action. On invalid/missing API key, provide a reconfigure action. Never display a partial model score before schema validation and composition complete.

- [ ] **Step 7: Run the complete automated suite**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit the complete analysis workflow**

```bash
git add src/background src/sidepanel tests/background tests/sidepanel
git commit -m "feat: deliver candidate match analysis workflow"
```

---

### Task 11: Packaging, Manual QA, and Data-Safety Verification

**Files:**
- Create: `README.md`
- Create: `docs/qa/mvp-smoke-test.md`
- Modify: `tests/build/manifest.test.ts`
- Test: `tests/sidepanel/full-workflow.test.tsx`

**Interfaces:**
- Consumes: the complete extension from Tasks 1–10.
- Produces: a verified `dist/` unpacked extension, setup documentation, a repeatable Windows/macOS smoke script, and final automated workflow coverage.

- [ ] **Step 1: Write the final failing workflow and permission assertions**

The workflow test must cover configuration → two jobs → active switch → extraction → edit → analysis → result → switch job → transient data cleared. Extend the manifest test to assert there is no `tabs`, `history`, `cookies`, `webRequest`, `unlimitedStorage`, or wildcard-all-host permission.

- [ ] **Step 2: Run the new tests and verify at least one failure**

Run:

```bash
npm test -- tests/sidepanel/full-workflow.test.tsx tests/build/manifest.test.ts
```

Expected: FAIL until the final wiring and assertions are complete.

- [ ] **Step 3: Complete final wiring and write operator documentation**

`README.md` must include Node 20+, `npm ci`, `npm run verify`, loading `dist/` from `chrome://extensions`, DeepSeek key configuration, supported page scope, local-key warning, and the fact that candidate data is not saved.

`docs/qa/mvp-smoke-test.md` must provide checkbox steps for both Windows and macOS:

1. Build and load the unpacked extension.
2. Confirm toolbar action opens the side panel.
3. Confirm blank company/JD/custom requirements are rejected.
4. Save two jobs and switch active job.
5. Open a single Liepin candidate detail page.
6. Extract, edit, and confirm candidate information.
7. Verify every result section and evidence display.
8. Simulate invalid key and retry from preserved preview.
9. Switch jobs and confirm the prior candidate/result disappear.
10. Inspect key names only: extension-origin IndexedDB contains jobs/current-job and optional remembered provider settings; `chrome.storage.local` contains none of the three migrated legacy keys.
11. Restart Chrome and confirm a session-only key is gone.
12. Opt into remember-device, restart, and confirm only the provider setting persists.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run verify
git status --short
```

Expected: typecheck, all tests, and build pass; only the intended Task 11 files are uncommitted.

- [ ] **Step 5: Perform manual macOS smoke verification**

Load `dist/` into macOS Chrome 116+ and execute every applicable checkbox in `docs/qa/mvp-smoke-test.md`. Record browser version, date, and pass/fail beside the macOS heading. Do not use real candidate data during this engineering smoke test; use a synthetic fixture page or a fully anonymized internal sample.

- [ ] **Step 6: Commit the verified MVP**

```bash
git add README.md docs/qa tests/build tests/sidepanel/full-workflow.test.tsx
git commit -m "docs: add MVP install and verification guide"
```

- [ ] **Step 7: Hand off Windows and pilot validation**

Provide the user with the verified `dist/` directory and the smoke-test checklist. Windows Chrome verification and the 3-job/30-sample/80%-useful pilot require the user's internal Windows machine, authorized Liepin session, and anonymized pilot samples; record those results in the same checklist without committing candidate content.

---

## Plan Completion Criteria

Implementation is complete only when all eleven task commits exist, `npm run verify` exits 0, the macOS smoke script passes, the unpacked `dist/` loads in Chrome 116+, no candidate content appears in persistent storage or logs, and the user has a documented path to perform Windows and internal pilot validation.

The MVP may be handed to internal users before the 30-sample pilot finishes, but it must be labeled “阶段 C 可行性验证版” until the product-level acceptance thresholds in the approved specification are recorded.
