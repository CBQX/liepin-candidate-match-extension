import type { RuntimeRequest, RuntimeResponse } from "../shared/contracts/messages";

type ActiveTab = Pick<chrome.tabs.Tab, "id" | "url"> | undefined;

export interface BackgroundControllerDependencies {
  getActiveTab(): Promise<ActiveTab>;
  sendToTab(tabId: number, request: Extract<RuntimeRequest, { type: "EXTRACT_CURRENT_CANDIDATE" }>): Promise<RuntimeResponse>;
}

export interface BackgroundController {
  handle(request: RuntimeRequest): Promise<RuntimeResponse>;
}

const unknownRequest = (): RuntimeResponse => ({
  ok: false,
  error: { code: "UNKNOWN", message: "无法识别的插件请求。" }
});

const unsupportedPage = (): RuntimeResponse => ({
  ok: false,
  error: { code: "UNSUPPORTED_PAGE", message: "请在猎聘候选人详情页中使用此功能。" }
});

function isLiepinPage(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const pageUrl = new URL(url);
    return pageUrl.protocol === "https:" && (
      pageUrl.hostname === "liepin.com" || pageUrl.hostname.endsWith(".liepin.com")
    );
  } catch {
    return false;
  }
}

export function createBackgroundController(
  dependencies: BackgroundControllerDependencies
): BackgroundController {
  return {
    async handle(request) {
      if (request.type !== "EXTRACT_CURRENT_CANDIDATE") {
        return unknownRequest();
      }

      const activeTab = await dependencies.getActiveTab();
      if (typeof activeTab?.id !== "number" || !isLiepinPage(activeTab.url)) {
        return unsupportedPage();
      }

      try {
        return await dependencies.sendToTab(activeTab.id, request);
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "EXTRACTION_FAILED",
            message: error instanceof Error ? error.message : "候选人信息提取失败"
          }
        };
      }
    }
  };
}
