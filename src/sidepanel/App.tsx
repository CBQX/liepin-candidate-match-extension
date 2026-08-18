import { useEffect, useReducer, useRef, useState } from "react";
import { JobService, type CreateJobInput } from "../domain/jobs/job-service";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import { candidateDraftSchema } from "../shared/contracts/candidate";
import type { Job } from "../shared/contracts/job";
import type { AppError } from "../shared/errors";
import { redactCandidateDraft } from "../shared/privacy";
import {
  analysisSessionInitialState,
  analysisSessionReducer
} from "./analysis-session";
import type { SidePanelDependencies } from "./app-dependencies";
import { CandidatePreview } from "./components/CandidatePreview";
import { ErrorState } from "./components/ErrorState";
import { JobForm } from "./components/JobForm";
import { JobSelector } from "./components/JobSelector";
import { ModelSettingsForm } from "./components/ModelSettingsForm";
import { ReadyState } from "./components/ReadyState";

type SetupState = "loading" | "needs_model" | "needs_job" | "ready";

export interface AppProps {
  deps: SidePanelDependencies;
}

export function App({ deps }: AppProps) {
  const [setupState, setSetupState] = useState<SetupState>("loading");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<Job>();
  const [addingJob, setAddingJob] = useState(false);
  const [switchingJob, setSwitchingJob] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [extractionError, setExtractionError] = useState<AppError>();
  const [analysisSession, dispatchAnalysisSession] = useReducer(
    analysisSessionReducer,
    analysisSessionInitialState
  );
  const extractionGeneration = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [savedSettings, savedJobs, savedActiveJob] = await Promise.all([
          deps.providerSettings.load(),
          deps.jobs.list(),
          deps.jobs.getActive()
        ]);
        if (cancelled) return;
        setJobs(savedJobs);
        setActiveJob(savedActiveJob);
        setSetupState(!savedSettings ? "needs_model" : savedActiveJob ? "ready" : "needs_job");
      } catch {
        if (!cancelled) setLoadError("无法读取插件设置，请重试。");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [deps]);

  useEffect(() => {
    const clearForPageChange = () => {
      extractionGeneration.current += 1;
      setExtractionError(undefined);
      dispatchAnalysisSession({ type: "PAGE_CHANGED" });
    };
    const endSession = () => {
      extractionGeneration.current += 1;
      setExtractionError(undefined);
      dispatchAnalysisSession({ type: "SESSION_ENDED" });
    };
    const unsubscribe = deps.subscribeToPageContextChanges(clearForPageChange);
    window.addEventListener("beforeunload", endSession);

    return () => {
      extractionGeneration.current += 1;
      unsubscribe();
      window.removeEventListener("beforeunload", endSession);
    };
  }, [deps]);

  async function saveModelSettings(settings: ProviderSettings, rememberDevice: boolean) {
    try {
      // Validation runs in the service worker, which intentionally reads the stored settings.
      await deps.providerSettings.save(settings, rememberDevice);
      const response = await deps.validateProvider();
      if (!response.ok) {
        await deps.providerSettings.clear();
        return response.error.message;
      }
      setSetupState(activeJob ? "ready" : "needs_job");
      return undefined;
    } catch {
      await deps.providerSettings.clear().catch(() => undefined);
      return "模型验证失败，请检查网络后重试。";
    }
  }

  async function saveJob(input: CreateJobInput) {
    try {
      extractionGeneration.current += 1;
      dispatchAnalysisSession({ type: "JOB_CHANGED" });
      setExtractionError(undefined);
      const savedJob = await new JobService(deps.jobs).createAndActivate(input);
      setJobs(await deps.jobs.list());
      setActiveJob(savedJob);
      setAddingJob(false);
      setSetupState("ready");
      return undefined;
    } catch {
      return "岗位保存失败，请重试。";
    }
  }

  async function switchJob(id: string) {
    const selectedJob = jobs.find((job) => job.id === id);
    if (!selectedJob) return;
    setSwitchError("");
    setSwitchingJob(true);
    extractionGeneration.current += 1;
    dispatchAnalysisSession({ type: "JOB_CHANGED" });
    setExtractionError(undefined);
    try {
      await deps.jobs.activate(id);
      setActiveJob(selectedJob);
      setAddingJob(false);
      setSetupState("ready");
    } catch {
      setSwitchError("岗位切换失败，请重试。");
    } finally {
      setSwitchingJob(false);
    }
  }

  async function matchAnalysis() {
    const requestGeneration = extractionGeneration.current + 1;
    extractionGeneration.current = requestGeneration;
    setExtractionError(undefined);
    try {
      const response = await deps.extractCurrentCandidate();
      if (requestGeneration !== extractionGeneration.current) return undefined;
      if (!response.ok) {
        setExtractionError(response.error);
        return undefined;
      }

      const parsedDraft = candidateDraftSchema.safeParse(response.data);
      if (!parsedDraft.success) {
        setExtractionError({
          code: "EXTRACTION_FAILED",
          message: "候选人信息格式无效，请重试。"
        });
        return undefined;
      }

      dispatchAnalysisSession({
        type: "DRAFT_LOADED",
        draft: redactCandidateDraft(parsedDraft.data)
      });
      return undefined;
    } catch {
      if (requestGeneration !== extractionGeneration.current) return undefined;
      setExtractionError({
        code: "EXTRACTION_FAILED",
        message: "候选人信息读取失败，请重试。"
      });
      return undefined;
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="brand-kicker">LIEPIN · MATCH</p>
        <h1>猎头匹配助手</h1>
      </header>

      {jobs.length > 0 && (
        <JobSelector
          jobs={jobs}
          activeJobId={activeJob?.id}
          disabled={switchingJob}
          onChange={(id) => void switchJob(id)}
          onAdd={() => {
            setSwitchError("");
            setAddingJob(true);
          }}
        />
      )}
      {switchError && <p className="form-error" role="alert">{switchError}</p>}

      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {!loadError && setupState === "loading" && <p className="loading-state">正在读取设置…</p>}
      {!loadError && setupState === "needs_model" && (
        <ModelSettingsForm onSave={saveModelSettings} />
      )}
      {!loadError && setupState !== "needs_model" && (setupState === "needs_job" || addingJob) && (
        <JobForm onSave={saveJob} />
      )}
      {!loadError && setupState === "ready" && !addingJob && activeJob && (
        analysisSession.draft ? (
          <CandidatePreview
            draft={analysisSession.draft}
            onChange={(section, text) => dispatchAnalysisSession({
              type: "DRAFT_EDITED",
              section,
              text
            })}
            onConfirm={() => undefined}
          />
        ) : extractionError ? (
          <ErrorState error={extractionError} onRetry={() => void matchAnalysis()} />
        ) : (
          <ReadyState activeJob={activeJob} onMatchAnalysis={matchAnalysis} />
        )
      )}
    </main>
  );
}
