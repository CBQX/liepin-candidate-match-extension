import type { AppError } from "../../shared/errors";

interface ErrorStateProps {
  error: AppError;
  onRetry(): void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const unsupported = error.code === "UNSUPPORTED_PAGE";

  return (
    <section className="panel-card error-card" aria-labelledby="analysis-error-title">
      <p className="eyebrow">需要处理</p>
      <h2 id="analysis-error-title">
        {unsupported ? "当前页面无法分析" : "候选人信息读取失败"}
      </h2>
      <p className="muted">{error.message}</p>
      <button className="primary-button" type="button" onClick={onRetry}>匹配分析</button>
    </section>
  );
}
