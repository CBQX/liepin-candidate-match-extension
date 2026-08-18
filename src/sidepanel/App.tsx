import { useEffect, useState } from "react";
import { JobService, type CreateJobInput } from "../domain/jobs/job-service";
import type { ProviderSettings } from "../repositories/chrome-provider-settings";
import type { Job } from "../shared/contracts/job";
import type { SidePanelDependencies } from "./app-dependencies";
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
  const [loadError, setLoadError] = useState("");

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
    setSwitchingJob(true);
    try {
      await deps.jobs.activate(id);
      setActiveJob(selectedJob);
      setAddingJob(false);
      setSetupState("ready");
    } finally {
      setSwitchingJob(false);
    }
  }

  async function matchAnalysis() {
    const response = await deps.extractCurrentCandidate();
    return response.ok ? undefined : response.error.message;
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
          onAdd={() => setAddingJob(true)}
        />
      )}

      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {!loadError && setupState === "loading" && <p className="loading-state">正在读取设置…</p>}
      {!loadError && setupState === "needs_model" && (
        <ModelSettingsForm onSave={saveModelSettings} />
      )}
      {!loadError && setupState !== "needs_model" && (setupState === "needs_job" || addingJob) && (
        <JobForm onSave={saveJob} />
      )}
      {!loadError && setupState === "ready" && !addingJob && activeJob && (
        <ReadyState activeJob={activeJob} onMatchAnalysis={matchAnalysis} />
      )}
    </main>
  );
}
