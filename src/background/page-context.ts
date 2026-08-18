type ActivatedListener = () => void;
type UpdatedListener = (
  tabId: number,
  changeInfo: { status?: string; url?: string },
  tab: { active?: boolean }
) => void;

export interface PageContextTabs {
  onActivated: { addListener(listener: ActivatedListener): void };
  onUpdated: { addListener(listener: UpdatedListener): void };
}

export function registerPageContextBroadcasts(
  tabs: PageContextTabs,
  broadcast: () => void
): void {
  tabs.onActivated.addListener(() => {
    broadcast();
  });

  tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    const activeContextChanged = tab.active
      && (changeInfo.status === "loading" || typeof changeInfo.url === "string");
    if (activeContextChanged) {
      broadcast();
    }
  });
}
