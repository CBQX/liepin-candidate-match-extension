import { describe, expect, it, vi } from "vitest";
import { registerPageContextBroadcasts } from "../../src/background/page-context";

type ActivatedListener = () => void;
type UpdatedListener = (
  tabId: number,
  changeInfo: { status?: string; url?: string },
  tab: { active?: boolean }
) => void;

function eventHarness() {
  let activated!: ActivatedListener;
  let updated!: UpdatedListener;
  const tabs = {
    onActivated: {
      addListener(listener: ActivatedListener) {
        activated = listener;
      }
    },
    onUpdated: {
      addListener(listener: UpdatedListener) {
        updated = listener;
      }
    }
  };
  return {
    tabs,
    activate: () => activated(),
    update: (changeInfo: { status?: string; url?: string }, active = true) => {
      updated(7, changeInfo, { active });
    }
  };
}

describe("page-context broadcasts", () => {
  it("broadcasts a URL-only active-tab transition", () => {
    // Break caught: SPA/history navigation can change candidate URLs without entering the loading status.
    const harness = eventHarness();
    const broadcast = vi.fn();
    registerPageContextBroadcasts(harness.tabs, broadcast);

    harness.update({ url: "https://www.liepin.com/candidate/new" });

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("broadcasts once when a single update contains both URL and loading signals", () => {
    // Break caught: treating URL and loading as separate branches could clear the same transient session twice for one tab update.
    const harness = eventHarness();
    const broadcast = vi.fn();
    registerPageContextBroadcasts(harness.tabs, broadcast);

    harness.update({
      status: "loading",
      url: "https://www.liepin.com/candidate/new"
    });

    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it("ignores inactive-tab updates while retaining activation and loading broadcasts", () => {
    // Break caught: background-tab navigation could erase the recruiter session in the currently visible tab.
    const harness = eventHarness();
    const broadcast = vi.fn();
    registerPageContextBroadcasts(harness.tabs, broadcast);

    harness.update({ url: "https://www.liepin.com/candidate/background" }, false);
    expect(broadcast).not.toHaveBeenCalled();

    harness.activate();
    harness.update({ status: "loading" });
    expect(broadcast).toHaveBeenCalledTimes(2);
  });
});
