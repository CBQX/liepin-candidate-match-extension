import { useState, type FormEvent } from "react";
import type { ProviderSettings } from "../../repositories/chrome-provider-settings";

interface ModelSettingsFormProps {
  onSave(settings: ProviderSettings, rememberDevice: boolean): Promise<string | undefined>;
}

export function ModelSettingsForm({ onSave }: ModelSettingsFormProps) {
  const [model, setModel] = useState("deepseek-v4-pro");
  const [apiKey, setApiKey] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setApiKeyError("请输入 DeepSeek API Key");
      return;
    }

    setApiKeyError("");
    setSubmitError("");
    setSubmitting(true);
    try {
      const error = await onSave({
        providerId: "deepseek",
        model,
        apiKey: trimmedKey
      }, rememberDevice);
      if (error) setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel-card" aria-labelledby="model-settings-title">
      <p className="eyebrow">首次设置</p>
      <h2 id="model-settings-title">连接分析模型</h2>
      <p className="muted">配置 DeepSeek 后，再添加需要匹配的招聘岗位。</p>

      <form className="form-stack" noValidate onSubmit={handleSubmit}>
        <label>
          模型供应商
          <select value="deepseek" disabled>
            <option value="deepseek">DeepSeek</option>
          </select>
        </label>

        <label>
          模型
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
            <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
          </select>
        </label>

        <label>
          DeepSeek API Key
          <input
            type="password"
            value={apiKey}
            required
            autoComplete="off"
            aria-invalid={Boolean(apiKeyError)}
            aria-describedby={apiKeyError ? "api-key-error" : undefined}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {apiKeyError && <p className="field-error" id="api-key-error">{apiKeyError}</p>}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(event) => setRememberDevice(event.target.checked)}
          />
          记住此设备
        </label>
        {rememberDevice && (
          <p className="privacy-warning" role="note">
            API Key 的本地保存未加密；共享设备请勿使用“记住此设备”。
          </p>
        )}
        <p className="field-hint">默认仅保存到当前 Chrome 会话。</p>

        {submitError && <p className="form-error" role="alert">{submitError}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "正在验证…" : "验证并保存"}
        </button>
      </form>
    </section>
  );
}
