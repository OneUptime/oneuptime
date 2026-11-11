import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "Common/Types/Translator";
import { SessionReplayManifestTab } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayManifest";
import { formatReplayDurationInLanguage } from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTimelineMath";
import {
  REPLAY_TAB_UNKNOWN_PAGE,
  ReplayTabSummary,
  describeReplayTabCounts,
  describeReplayTabName,
  describeReplayTabOpened,
  describeReplayTabPage,
  filterReplayTabs,
  formatReplayTabLabel,
  summarizeReplayTabs,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";

/*
 * The browser tabs' words in the reader's language (#6369). "Tab 3", the
 * strip's counts, "opened 2:14" and a pill's label were English in every
 * language. Each is now looked up whole with the translator the caller
 * hands in - a marking translator shows every one comes out looked up, its
 * values in place - and without one the English is word for word what it
 * was. A tab's name is worded from its ordinal wherever it is drawn, so a
 * sentence and the name inside it are always in one language.
 */

// Every lookup comes back marked, as a German reader's would come back worded.
const MARKED: Translator = createTranslator((text: string): string => {
  return `⟦${text}⟧`;
}, "de");

// A language that words a tab's name and nothing else yet.
const TAB_NAME_ONLY: Translator = createTranslator(
  (text: string): string | undefined => {
    return text === "Tab {{number}}" ? "Registerkarte {{number}}" : undefined;
  },
  "de",
);

function manifestTab(tabId: string): SessionReplayManifestTab {
  return {
    tabId: tabId,
    chunks: [],
    gaps: [],
    firstChunkStartOffsetMs: null,
    durationMs: 0,
    hasRecordingEnded: null,
  };
}

function summary(overrides: Partial<ReplayTabSummary>): ReplayTabSummary {
  return {
    tabId: "tab-1",
    label: "Tab 1",
    ordinal: 1,
    durationMs: 30000,
    openedAtMs: 0,
    hasFootage: true,
    isActive: false,
    ...overrides,
  };
}

describe("a tab's name", () => {
  test("is worded from its ordinal in the translator's language", () => {
    const tab: ReplayTabSummary = summary({ label: "Tab 3", ordinal: 3 });

    expect(describeReplayTabName(tab, MARKED)).toBe("⟦Tab 3⟧");
    expect(describeReplayTabName(tab, TAB_NAME_ONLY)).toBe("Registerkarte 3");
    expect(describeReplayTabName(tab)).toBe("Tab 3");
  });

  test("whatever language its label was written in", () => {
    expect(
      describeReplayTabName(
        summary({ label: "Registerkarte 2", ordinal: 2 }),
        MARKED,
      ),
    ).toBe("⟦Tab 2⟧");
  });

  test("a summary built by hand, with no ordinal, keeps the label it was given", () => {
    expect(
      describeReplayTabName(
        summary({ label: "Checkout", ordinal: undefined }),
        MARKED,
      ),
    ).toBe("Checkout");
  });

  test("summarizeReplayTabs counts the tabs from one, in the translator's language", () => {
    const args: Parameters<typeof summarizeReplayTabs>[0] = {
      tabs: [manifestTab("a"), manifestTab("b"), manifestTab("c")],
      activeTabId: "a",
      isSessionFinalized: true,
      hasSessionRecordingEnded: true,
    };
    const marked: Array<ReplayTabSummary> = summarizeReplayTabs(args, MARKED);
    const english: Array<ReplayTabSummary> = summarizeReplayTabs(args);

    expect(
      marked.map((tab: ReplayTabSummary): [string, number | undefined] => {
        return [tab.label, tab.ordinal];
      }),
    ).toEqual([
      ["⟦Tab 1⟧", 1],
      ["⟦Tab 2⟧", 2],
      ["⟦Tab 3⟧", 3],
    ]);
    expect(
      english.map((tab: ReplayTabSummary): string => {
        return tab.label;
      }),
    ).toEqual(["Tab 1", "Tab 2", "Tab 3"]);
  });
});

describe("describeReplayTabCounts", () => {
  /* Two of each, so every count reads the language's general form. */
  const tabs: Array<ReplayTabSummary> = [
    summary({ tabId: "a", status: "open" }),
    summary({ tabId: "b", status: "unknown" }),
    summary({ tabId: "c", status: "closed" }),
    summary({ tabId: "d", status: "closed" }),
    summary({ tabId: "e", status: "empty", hasFootage: false }),
    summary({ tabId: "f", status: "empty", hasFootage: false }),
  ];

  test("looks every count up whole and sets them off the language's way", () => {
    expect(describeReplayTabCounts(tabs, MARKED)).toBe(
      "⟦6 tabs⟧ · ⟦2 open⟧ · ⟦2 closed⟧ · ⟦2 without footage⟧",
    );
    expect(describeReplayTabCounts(tabs)).toBe(
      "6 tabs · 2 open · 2 closed · 2 without footage",
    );
  });

  test("a finished session is just its total", () => {
    const finished: Array<ReplayTabSummary> = [
      summary({ tabId: "a", status: "closed" }),
      summary({ tabId: "b", status: "closed" }),
    ];

    expect(describeReplayTabCounts(finished, MARKED)).toBe("⟦2 tabs⟧");
    expect(describeReplayTabCounts(finished)).toBe("2 tabs");
    expect(describeReplayTabCounts([summary({ status: "closed" })])).toBe(
      "1 tab",
    );
  });
});

describe("describeReplayTabOpened and formatReplayTabLabel", () => {
  const tab: ReplayTabSummary = summary({
    tabId: "tab-2",
    label: "Tab 2",
    ordinal: 2,
    openedAtMs: 134000,
    durationMs: 30000,
  });

  test("'opened 2:14' is one sentence with its time in place", () => {
    expect(describeReplayTabOpened(tab, MARKED)).toBe("⟦opened 2:14⟧");
    expect(describeReplayTabOpened(tab)).toBe("opened 2:14");
  });

  test("a pill's label: the name, its length in the language, its opening", () => {
    const length: string = formatReplayDurationInLanguage(30000, MARKED);

    expect(formatReplayTabLabel(tab, undefined, MARKED)).toBe(
      `⟦Tab 2⟧ · ${length} · (⟦opened 2:14⟧)`,
    );
    expect(formatReplayTabLabel(tab, { isCompact: true }, MARKED)).toBe(
      `⟦Tab 2⟧ · ${length}`,
    );
    expect(
      formatReplayTabLabel(
        summary({ label: "Tab 2", ordinal: 2, hasFootage: false }),
        undefined,
        MARKED,
      ),
    ).toBe("⟦Tab 2⟧ · ⟦no footage⟧");

    expect(formatReplayTabLabel(tab)).toBe("Tab 2 · 30s · (opened 2:14)");
    expect(formatReplayTabLabel(summary({ hasFootage: false }))).toBe(
      "Tab 1 · no footage",
    );
  });
});

describe("filterReplayTabs", () => {
  const tabs: Array<ReplayTabSummary> = [
    summary({ tabId: "a", label: "Tab 1", ordinal: 1 }),
    summary({ tabId: "b", label: "Tab 2", ordinal: 2 }),
  ];

  test("finds a tab by the name the reader sees, and still by its English one", () => {
    expect(
      filterReplayTabs(tabs, "registerkarte 2", TAB_NAME_ONLY).map(
        (tab: ReplayTabSummary): string => {
          return tab.tabId;
        },
      ),
    ).toEqual(["b"]);
    expect(
      filterReplayTabs(tabs, "tab 2", TAB_NAME_ONLY).map(
        (tab: ReplayTabSummary): string => {
          return tab.tabId;
        },
      ),
    ).toEqual(["b"]);
    expect(
      filterReplayTabs(tabs, "#1", TAB_NAME_ONLY).map(
        (tab: ReplayTabSummary): string => {
          return tab.tabId;
        },
      ),
    ).toEqual(["a"]);
  });
});

describe("REPLAY_TAB_UNKNOWN_PAGE", () => {
  test("is the English key a missing page is compared against and drawn by", () => {
    expect(describeReplayTabPage("")).toBe(REPLAY_TAB_UNKNOWN_PAGE);
    expect(REPLAY_TAB_UNKNOWN_PAGE).toBe("Unknown page");
  });
});
