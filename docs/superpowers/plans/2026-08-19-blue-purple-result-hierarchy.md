# Blue-Purple Result Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show job title above company in a custom accessible job switcher, move the recruiter conclusion to the top with AI-selected bold highlights, and apply a cohesive blue-purple-and-white visual system to the side panel.

**Architecture:** Extend the lightweight match contract with bounded structured highlights, then keep those highlights as plain text through the DeepSeek prompt, validation, background pipeline, and result component. Replace the native single-line job select with a focused listbox component that derives display text from the confirmed profile, and drive the visual refresh through CSS custom properties so every existing screen shares one theme without new UI dependencies.

**Tech Stack:** TypeScript 7, React 19, Zod 4, Chrome Manifest V3, Vitest 4, Testing Library, Vite 8, CSS.

**Spec:** `docs/superpowers/specs/2026-08-19-blue-purple-result-hierarchy-design.md`

## Global Constraints

- The collapsed and expanded job selector show role title first and company second; legacy jobs without a confirmed profile show `待确认岗位` as the role label.
- The selector is keyboard operable and exposes listbox semantics without adding a component library.
- The recruiter conclusion is the first result section after the report title; score/recommendation and all remaining sections preserve their relative order.
- `conclusionHighlights` contains 1–3 non-empty plain-text items of at most 120 characters; the UI renders them with semantic `<strong>` and never parses provider Markdown or HTML.
- Candidate analysis remains fixed to `deepseek-v4-flash`, `max_tokens: 8192`, JSON mode, disabled thinking, and one format-repair retry.
- Names, phone numbers, Liepin URLs and IDs remain redacted before the provider call and absent from results.
- Styling uses CSS and existing assets only; errors stay red, warnings stay amber, and focus indicators remain visible.
- Every behavior change follows RED → GREEN → refactor and uses synthetic data.

---

### Task 1: Structured Recruiter Conclusion Highlights

**Files:**
- Modify: `src/shared/contracts/matching.ts`
- Modify: `src/providers/deepseek/prompt.ts`
- Modify: `tests/contracts/contracts.test.ts`
- Modify: `tests/providers/prompt.test.ts`
- Modify: lightweight result fixtures in `tests/background/analyze-candidate.test.ts`, `tests/providers/deepseek-provider.test.ts`, `tests/sidepanel/analysis-session.test.ts`, `tests/sidepanel/analysis-workflow.test.tsx`, `tests/sidepanel/analysis-result.test.tsx`, and `tests/sidepanel/full-workflow.test.tsx`

**Interfaces:**
- Produces `MatchAnalysis.conclusionHighlights: string[]` and `ModelMatchResult.conclusionHighlights: string[]`.
- Each highlight is trimmed, non-empty, at most 120 characters; the array contains 1–3 items.

- [ ] **Step 1: Write the failing contract tests**

Add `conclusionHighlights: ["海外产品经验是主要优势", "联系前核实团队规模"]` to the literal valid result. Assert that missing highlights, an empty array, four items, and a 121-character item are rejected by `modelMatchResultSchema`.

- [ ] **Step 2: Run the contract test and observe RED**

Run: `npm test -- tests/contracts/contracts.test.ts`

Expected: FAIL because the current Zod object strips or rejects no required `conclusionHighlights` field and the parsed literal differs.

- [ ] **Step 3: Implement the bounded contract**

In `matching.ts`, define `const conclusionHighlight = requiredText.max(120)` and add `conclusionHighlights: z.array(conclusionHighlight).min(1).max(3)` immediately before `recruiterConclusion` in `modelAnalysisSchema`.

- [ ] **Step 4: Update synthetic fixtures and run the focused contract tests**

Add literal, privacy-safe highlight arrays to every typed lightweight result fixture. Run: `npm test -- tests/contracts/contracts.test.ts tests/background/analyze-candidate.test.ts tests/providers/deepseek-provider.test.ts`

Expected: PASS for the updated runtime contract and pipeline/provider fixtures.

- [ ] **Step 5: Write the failing prompt test**

Assert the system message includes `conclusionHighlights`, requires 1–3 items and 120 characters, and instructs the model to return plain text rather than Markdown or HTML.

- [ ] **Step 6: Run the prompt test and observe RED**

Run: `npm test -- tests/providers/prompt.test.ts`

Expected: FAIL because the current JSON protocol does not mention the new field.

- [ ] **Step 7: Implement and verify the prompt**

Add `"conclusionHighlights": ["需要加粗展示的结论重点"]` to the JSON protocol and explicit bounds/plain-text instructions. Run: `npm test -- tests/providers/prompt.test.ts tests/providers/deepseek-provider.test.ts`

Expected: PASS, including the existing one-repair-attempt tests.

### Task 2: Accessible Two-Line Job Switcher

**Files:**
- Modify: `src/sidepanel/components/JobSelector.tsx`
- Modify: `src/sidepanel/components/ReadyState.tsx`
- Modify: `tests/sidepanel/settings-and-jobs.test.tsx`
- Modify: `tests/sidepanel/full-workflow.test.tsx`

**Interfaces:**
- `JobSelector` props remain unchanged.
- Display helper returns `{ roleTitle: job.recruitmentProfile?.roleTitle ?? "待确认岗位", company: job.company }`.
- Trigger has accessible name `当前岗位`, while options expose combined accessible names such as `企业软件产品经理，甲公司`.

- [ ] **Step 1: Write failing selector behavior tests**

Render two confirmed jobs and assert the trigger exposes role title before company in DOM order. Open it, assert two `option` elements, use ArrowUp/ArrowDown plus Enter to change the active job, and assert Escape closes without changing. Add a legacy job assertion for `待确认岗位`.

- [ ] **Step 2: Run the side-panel job tests and observe RED**

Run: `npm test -- tests/sidepanel/settings-and-jobs.test.tsx`

Expected: FAIL because the current native select renders only company names and has no custom listbox.

- [ ] **Step 3: Implement the minimal listbox**

Use React state for `open` and `focusedIndex`, a trigger `<button>`, a conditional `<ul role="listbox">`, and `<button role="option">` entries. Handle Enter, Space, ArrowUp, ArrowDown, Home, End, Escape, click selection, and blur-to-close. Call the existing `onChange(id)` exactly once per confirmed selection.

- [ ] **Step 4: Update workflow tests from native select helpers to user-visible listbox actions**

Replace `selectOptions` and `.options/.value` assertions with `click(trigger)`, `click(option)`, `aria-expanded`, `aria-selected`, active option text, and repository activation assertions. Keep all existing checks that switching clears transient candidate/result state and cancels pending profile work.

- [ ] **Step 5: Update the ready card context and verify**

Render `activeJob.recruitmentProfile?.roleTitle ?? "待确认岗位"` as the primary current-job line and `activeJob.company` as the secondary line. Run: `npm test -- tests/sidepanel/settings-and-jobs.test.tsx tests/sidepanel/full-workflow.test.tsx`

Expected: PASS.

### Task 3: Recruiter Conclusion First With Bold Highlights

**Files:**
- Modify: `src/sidepanel/components/AnalysisResult.tsx`
- Modify: `tests/sidepanel/analysis-result.test.tsx`
- Modify: `tests/sidepanel/full-workflow.test.tsx`

**Interfaces:**
- `AnalysisResult` renders `recruiterConclusion` and every `conclusionHighlights` item inside the first `.result-section` after the report heading.
- Highlight text is a `<strong>` descendant and is not injected as HTML.

- [ ] **Step 1: Write the failing result-order and semantics tests**

Query the report card and compare document positions so `猎头结论` precedes `综合匹配分 / 100`, while `主要匹配理由`, `主要顾虑或信息缺口`, and `建议核实问题` retain their current relative order. Assert each highlight is rendered as a `<strong>` element and a literal `<script>`-shaped highlight remains text.

- [ ] **Step 2: Run the component test and observe RED**

Run: `npm test -- tests/sidepanel/analysis-result.test.tsx`

Expected: FAIL because the conclusion is currently last and no highlight field is rendered.

- [ ] **Step 3: Move and extend the conclusion component**

Place the recruiter conclusion section immediately after the report heading, render the paragraph, and render a semantic list whose items contain `<strong>{highlight}</strong>`. Leave the score summary and other three sections in their existing relative order.

- [ ] **Step 4: Run focused result/workflow tests**

Run: `npm test -- tests/sidepanel/analysis-result.test.tsx tests/sidepanel/full-workflow.test.tsx`

Expected: PASS.

### Task 4: Blue-Purple-and-White Theme

**Files:**
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/sidepanel/analysis-result.test.tsx`
- Modify: `tests/sidepanel/settings-and-jobs.test.tsx`

**Interfaces:**
- CSS custom properties define the theme tokens; component class names expose `job-select-trigger`, `job-select-menu`, `job-select-option`, `job-role-title`, `job-company`, and `conclusion-highlights`.

- [ ] **Step 1: Add behavior-focused visual semantics assertions**

Assert the active option is communicated by `aria-selected="true"`, the job trigger has an expanded state, the conclusion region is labelled by its heading, and primary actions remain buttons with visible text. These assertions catch lost states and hierarchy without testing literal CSS source.

- [ ] **Step 2: Run the focused UI tests and observe RED where new semantics are absent**

Run: `npm test -- tests/sidepanel/settings-and-jobs.test.tsx tests/sidepanel/analysis-result.test.tsx`

Expected: FAIL until the required listbox and conclusion semantics exist.

- [ ] **Step 3: Apply the theme through CSS variables and component classes**

Define background, surface, text, muted, border, primary blue, primary purple, focus, danger, and warning variables. Use a `linear-gradient(135deg, #4f46e5, #7c3aed)` for primary buttons and score emphasis; white cards with purple-tinted borders/shadows; cool white radial page glows; blue-purple focus rings; and dedicated selector menu/option/conclusion card styles. Preserve red error and amber warning styling.

- [ ] **Step 4: Run all side-panel tests and typecheck**

Run: `npm test -- tests/sidepanel && npm run typecheck`

Expected: PASS with no React accessibility warnings or type errors.

### Task 5: Documentation, Verification, Review, and ZIP

**Files:**
- Modify: `README.md`
- Modify: `docs/qa/mvp-smoke-test.md`
- Create: a versioned ZIP under `/Users/christine/Documents/Codex/2026-08-18/bang/outputs/`

**Interfaces:**
- Human documentation describes the role/company order, conclusion-first result, bold AI highlights, and blue-purple theme.

- [ ] **Step 1: Update documentation and manual checks**

Document the new selector and result order. Add manual Chrome checks for keyboard selection, long role/company wrapping, conclusion highlight display, focus visibility, and Windows/macOS side-panel rendering.

- [ ] **Step 2: Run focused regressions**

Run: `npm test -- tests/contracts/contracts.test.ts tests/providers/prompt.test.ts tests/providers/deepseek-provider.test.ts tests/background/analyze-candidate.test.ts tests/sidepanel/analysis-result.test.tsx tests/sidepanel/settings-and-jobs.test.tsx tests/sidepanel/full-workflow.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run: `npm run verify`

Expected: typecheck, every Vitest file, and production build pass with zero failures.

- [ ] **Step 4: Review the full change**

Compare the implementation to this plan and spec; inspect the diff for inaccessible interactions, unescaped provider text, privacy regressions, stale green selectors, and unrelated changes. Resolve all Critical or Important findings and rerun `npm run verify` after fixes.

- [ ] **Step 5: Package and audit the build**

Zip the contents of `dist` with `manifest.json` at archive root, list the archive, compute SHA-256, and inspect the archive for expected side-panel assets. Keep Chrome/DeepSeek/Liepin real-environment validation as the user's manual acceptance step.
