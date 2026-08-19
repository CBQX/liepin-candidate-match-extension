import { useEffect, useReducer, useRef, useState } from "react";
import { JobService, type CreateJobInput } from "../domain/jobs/job-service";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import { candidateDraftSchema } from "../shared/contracts/candidate";
import type { Job } from "../shared/contracts/job";
import { matchAnalysisSchema } from "../shared/contracts/matching";
import {
  modelRecruitmentProfileSchema,
  type ModelRecruitmentProfile
} from "../shared/contracts/recruitment-profile";
import type { AppError } from "../shared/errors";
import { prepareCandidateDraftForPreview } from "../shared/privacy";
import {
  analysisSessionInitialState,
  analysisSessionReducer
} from "./analysis-session";
import type { SidePanelDependencies } from "./app-dependencies";
import { CandidatePreview } from "./components/CandidatePreview";
import { ErrorState } from "./components/ErrorState";
import { AnalysisProgress } from "./components/AnalysisProgress";
import { AnalysisResult } from "./components/AnalysisResult";
import { JobForm } from "./components/JobForm";
import { JobSelector } from "./components/JobSelector";
import { JobProfileNeeded } from "./components/JobProfileNeeded";
import { JobProfileProgress } from "./components/JobProfileProgress";
import { JobProfileReview } from "./components/JobProfileReview";
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
  const [analysisError, setAnalysisError] = useState<AppError>();
  const [analyzing, setAnalyzing] = useState(false);
  const [profileAnalyzing, setProfileAnalyzing] = useState(false);
  const [profileDraft, setProfileDraft] = useState<ModelRecruitmentProfile>();
  const [profileError, setProfileError] = useState<AppError>();
  const [analysisSession, dispatchAnalysisSession] = useReducer(
    analysisSessionReducer,
    analysisSessionInitialState
  );
  const extractionGeneration = useRef(0);
  const activeAnalysisRequestId = useRef<string | undefined>(undefined);
  const profileGeneration = useRef(0);
  const activeProfileRequestId = useRef<string | undefined>(undefined);

  function sendCancellationForActiveRequest() {
    const requestId = activeAnalysisRequestId.current;
    if (!requestId) return;
    activeAnalysisRequestId.current = undefined;
    void deps.cancelAnalysis(requestId).catch(() => undefined);
  }

  function sendCancellationForActiveProfileRequest() {
    const requestId = activeProfileRequestId.current;
    if (!requestId) return;
    activeProfileRequestId.current = undefined;
    void deps.cancelJobProfile(requestId).catch(() => undefined);
  }

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
      sendCancellationForActiveRequest();
      extractionGeneration.current += 1;
      setExtractionError(undefined);
      setAnalysisError(undefined);
      setAnalyzing(false);
      dispatchAnalysisSession({ type: "PAGE_CHANGED" });
    };
    const endSession = () => {
      sendCancellationForActiveRequest();
      extractionGeneration.current += 1;
      setExtractionError(undefined);
      setAnalysisError(undefined);
      setAnalyzing(false);
      dispatchAnalysisSession({ type: "SESSION_ENDED" });
    };
    const unsubscribe = deps.subscribeToPageContextChanges(clearForPageChange);
    window.addEventListener("beforeunload", endSession);

    return () => {
      sendCancellationForActiveRequest();
      sendCancellationForActiveProfileRequest();
      extractionGeneration.current += 1;
      profileGeneration.current += 1;
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
      sendCancellationForActiveRequest();
      sendCancellationForActiveProfileRequest();
      extractionGeneration.current += 1;
      profileGeneration.current += 1;
      dispatchAnalysisSession({ type: "JOB_CHANGED" });
      setExtractionError(undefined);
      setAnalysisError(undefined);
      setAnalyzing(false);
      setProfileDraft(undefined);
      setProfileError(undefined);
      setProfileAnalyzing(false);
      const savedJob = await new JobService(deps.jobs).createAndActivate(input);
      setJobs(await deps.jobs.list());
      setActiveJob(savedJob);
      setAddingJob(false);
      setSetupState("ready");
      await startJobProfileGeneration(savedJob);
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
    sendCancellationForActiveRequest();
    sendCancellationForActiveProfileRequest();
    profileGeneration.current += 1;
    dispatchAnalysisSession({ type: "JOB_CHANGED" });
    setExtractionError(undefined);
    setAnalysisError(undefined);
    setAnalyzing(false);
    setProfileAnalyzing(false);
    setProfileDraft(undefined);
    setProfileError(undefined);
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

  async function startJobProfileGeneration(job: Job) {
    sendCancellationForActiveProfileRequest();
    const requestGeneration = profileGeneration.current + 1;
    profileGeneration.current = requestGeneration;
    const requestId = crypto.randomUUID();
    activeProfileRequestId.current = requestId;
    setProfileDraft(undefined);
    setProfileError(undefined);
    setProfileAnalyzing(true);

    try {
      const response = await deps.generateJobProfile(job, requestId);
      if (requestGeneration !== profileGeneration.current) return;
      if (!response.ok) {
        setProfileError(response.error);
        return;
      }
      const parsed = modelRecruitmentProfileSchema.safeParse(response.data);
      if (!parsed.success) {
        setProfileError({
          code: "INVALID_MODEL_OUTPUT",
          message: "岗位画像内容无法验证，请重试。"
        });
        return;
      }
      setProfileDraft(parsed.data);
    } catch {
      if (requestGeneration !== profileGeneration.current) return;
      setProfileError({
        code: "UNKNOWN",
        message: "岗位画像分析失败，请检查网络后重试。"
      });
    } finally {
      if (activeProfileRequestId.current === requestId) {
        activeProfileRequestId.current = undefined;
      }
      if (requestGeneration === profileGeneration.current) {
        setProfileAnalyzing(false);
      }
    }
  }

  function cancelJobProfileGeneration() {
    sendCancellationForActiveProfileRequest();
    profileGeneration.current += 1;
    setProfileAnalyzing(false);
    setProfileError(undefined);
    setProfileDraft(undefined);
  }

  async function confirmJobProfile(profile: ModelRecruitmentProfile) {
    if (!activeJob) return "未找到当前岗位，请重试。";
    try {
      const response = await deps.confirmJobProfile(activeJob.id, profile);
      if (!response.ok) return response.error.message;
      const updatedJobs = await deps.jobs.list();
      setJobs(updatedJobs);
      setActiveJob(response.data);
      setProfileDraft(undefined);
      setProfileError(undefined);
      dispatchAnalysisSession({ type: "JOB_CHANGED" });
      return undefined;
    } catch {
      return "岗位画像保存失败，请重试。";
    }
  }

  async function matchAnalysis() {
    const requestGeneration = extractionGeneration.current + 1;
    extractionGeneration.current = requestGeneration;
    setExtractionError(undefined);
    setAnalysisError(undefined);
    setAnalyzing(false);
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

      const prepared = prepareCandidateDraftForPreview(parsedDraft.data);
      dispatchAnalysisSession({ type: "DRAFT_LOADED", ...prepared });
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

  async function analyzeCurrentCandidate() {
    const draft = analysisSession.draft;
    if (!activeJob || !draft) return undefined;
    const redactionContext = analysisSession.redactionContext ?? {
      identityTokens: [],
      identityDetection: "undetected" as const
    };

    const requestGeneration = extractionGeneration.current + 1;
    extractionGeneration.current = requestGeneration;
    const requestId = crypto.randomUUID();
    activeAnalysisRequestId.current = requestId;
    setAnalysisError(undefined);
    setAnalyzing(true);

    try {
      const response = await deps.analyzeCandidate(activeJob, draft, redactionContext, requestId);
      if (requestGeneration !== extractionGeneration.current) return undefined;
      if (!response.ok) {
        setAnalysisError(response.error);
        return undefined;
      }

      const parsedAnalysis = matchAnalysisSchema.safeParse(response.data);
      if (!parsedAnalysis.success) {
        setAnalysisError({
          code: "INVALID_MODEL_OUTPUT",
          message: "模型返回内容无法验证，请重试。"
        });
        return undefined;
      }

      dispatchAnalysisSession({ type: "RESULT_LOADED", result: parsedAnalysis.data });
      return undefined;
    } catch {
      if (requestGeneration !== extractionGeneration.current) return undefined;
      setAnalysisError({
        code: "UNKNOWN",
        message: "匹配分析失败，请检查网络后重试。"
      });
      return undefined;
    } finally {
      if (activeAnalysisRequestId.current === requestId) {
        activeAnalysisRequestId.current = undefined;
      }
      if (requestGeneration === extractionGeneration.current) {
        setAnalyzing(false);
      }
    }
  }

  function cancelCurrentAnalysis() {
    sendCancellationForActiveRequest();
    extractionGeneration.current += 1;
    setAnalysisError(undefined);
    setAnalyzing(false);
    dispatchAnalysisSession({ type: "ANALYSIS_CANCELLED" });
  }

  function beginAddingJob() {
    sendCancellationForActiveRequest();
    sendCancellationForActiveProfileRequest();
    extractionGeneration.current += 1;
    profileGeneration.current += 1;
    dispatchAnalysisSession({ type: "JOB_CHANGED" });
    setExtractionError(undefined);
    setAnalysisError(undefined);
    setAnalyzing(false);
    setProfileAnalyzing(false);
    setProfileDraft(undefined);
    setProfileError(undefined);
    setSwitchError("");
    setAddingJob(true);
  }

  const reconfigurationError = analysisError?.code === "MISSING_API_KEY"
    || analysisError?.code === "INVALID_API_KEY"
    || analysisError?.code === "INVALID_PROVIDER_SETTINGS";
  const profileReconfigurationError = profileError?.code === "MISSING_API_KEY"
    || profileError?.code === "INVALID_API_KEY"
    || profileError?.code === "INVALID_PROVIDER_SETTINGS";

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
          onAdd={beginAddingJob}
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
        profileAnalyzing ? (
          <JobProfileProgress onCancel={cancelJobProfileGeneration} />
        ) : profileDraft ? (
          <JobProfileReview
            profile={profileDraft}
            onConfirm={confirmJobProfile}
            onRegenerate={() => void startJobProfileGeneration(activeJob)}
          />
        ) : profileError ? (
          <section className="panel-card error-card" aria-labelledby="profile-failure-title" role="alert">
            <p className="eyebrow">岗位分析未完成</p>
            <h2 id="profile-failure-title">
              {profileReconfigurationError ? "需要重新配置模型" : "本次岗位分析未完成"}
            </h2>
            <p className="muted">{profileError.message}</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                if (profileReconfigurationError) {
                  setSetupState("needs_model");
                } else {
                  void startJobProfileGeneration(activeJob);
                }
              }}
            >
              {profileReconfigurationError ? "重新配置模型" : "重试岗位分析"}
            </button>
            {activeJob.recruitmentProfile && (
              <button className="text-button" type="button" onClick={() => setProfileError(undefined)}>
                继续使用当前画像
              </button>
            )}
          </section>
        ) : !activeJob.recruitmentProfile ? (
          <JobProfileNeeded job={activeJob} onAnalyze={() => void startJobProfileGeneration(activeJob)} />
        ) : analysisSession.result ? (
          <AnalysisResult analysis={analysisSession.result} job={activeJob} />
        ) : analyzing ? (
          <AnalysisProgress onCancel={cancelCurrentAnalysis} />
        ) : analysisError ? (
          <section className="panel-card error-card" aria-labelledby="analysis-failure-title" role="alert">
            <p className="eyebrow">分析未完成</p>
            <h2 id="analysis-failure-title">
              {reconfigurationError ? "需要重新配置模型" : "本次匹配分析未完成"}
            </h2>
            <p className="muted">{analysisError.message}</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                if (reconfigurationError) {
                  setAnalysisError(undefined);
                  setSetupState("needs_model");
                } else {
                  void analyzeCurrentCandidate();
                }
              }}
            >
              {reconfigurationError ? "重新配置模型" : "重试分析"}
            </button>
          </section>
        ) : analysisSession.draft ? (
          <CandidatePreview
            draft={analysisSession.draft}
            identityDetection={analysisSession.redactionContext?.identityDetection}
            onChange={(section, text) => dispatchAnalysisSession({
              type: "DRAFT_EDITED",
              section,
              text
            })}
            onConfirm={() => void analyzeCurrentCandidate()}
          />
        ) : extractionError ? (
          <ErrorState error={extractionError} onRetry={() => void matchAnalysis()} />
        ) : (
          <ReadyState
            activeJob={activeJob}
            onMatchAnalysis={matchAnalysis}
            onRegenerateProfile={() => void startJobProfileGeneration(activeJob)}
          />
        )
      )}
    </main>
  );
}
