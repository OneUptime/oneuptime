import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
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
      "⟦6 tabs⟧ · ⟦2 still open⟧ · ⟦2 closed⟧ · ⟦2 without footage⟧",
    );
    expect(describeReplayTabCounts(tabs)).toBe(
      "6 tabs · 2 still open · 2 closed · 2 without footage",
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

/*
 * A TAB'S NUMBER AND OPENING IN THE READER'S DIGITS (#7098).
 *
 * "Tab {{number}}" was filled with the raw ordinal and "opened {{time}}"
 * with the session clock as formatReplayOffset writes it, and a template
 * value goes in exactly as it is given: a Persian page read "زبانه 2" and
 * "2:14" beside the Persian digits of the counts next to them. Both are now
 * written in the digits the reader's language writes - Persian's own,
 * Latin everywhere else (Arabic included: OneUptime writes Arabic in Latin
 * digits) - and read in English exactly as they did.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

function shippedTranslator(language: string): Translator {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;

// Tab 12, opened at 1:02:14 into the session: two-digit ordinal, an hour.
const LATE_TAB: ReplayTabSummary = summary({
  tabId: "tab-12",
  label: "Tab 12",
  ordinal: 12,
  openedAtMs: 3734000,
  durationMs: 30000,
});

// Tab 2, opened at 2:14.
const SECOND_TAB: ReplayTabSummary = summary({
  tabId: "tab-2",
  label: "Tab 2",
  ordinal: 2,
  openedAtMs: 134000,
  durationMs: 30000,
});

describe("in Persian, a tab's number and opening are in Persian digits", () => {
  const persian: Translator = shippedTranslator("fa");

  test("the name: زبانه ۲, زبانه ۱۲", () => {
    expect(describeReplayTabName(SECOND_TAB, persian)).toBe("زبانه ۲");
    expect(describeReplayTabName(LATE_TAB, persian)).toBe("زبانه ۱۲");
  });

  test("the opening keeps the clock's shape: ۲:۱۴, ۱:۰۲:۱۴", () => {
    expect(describeReplayTabOpened(SECOND_TAB, persian)).toBe(
      "باز شده در ۲:۱۴",
    );
    expect(describeReplayTabOpened(LATE_TAB, persian)).toBe(
      "باز شده در ۱:۰۲:۱۴",
    );
  });

  test("a pill's whole label has no Latin digit", () => {
    for (const tab of [SECOND_TAB, LATE_TAB]) {
      for (const isCompact of [false, true]) {
        const label: string = formatReplayTabLabel(
          tab,
          { isCompact: isCompact },
          persian,
        );

        expect({ label, latin: LATIN_DIGIT.test(label) }).toEqual({
          label,
          latin: false,
        });
        expect(label).toMatch(PERSIAN_DIGIT);
      }
    }
  });

  test("summarizeReplayTabs labels the tabs in Persian digits too", () => {
    const tabs: Array<ReplayTabSummary> = summarizeReplayTabs(
      {
        tabs: [manifestTab("a"), manifestTab("b"), manifestTab("c")],
        activeTabId: "a",
        isSessionFinalized: true,
        hasSessionRecordingEnded: true,
      },
      persian,
    );

    expect(
      tabs.map((tab: ReplayTabSummary): string => {
        return tab.label;
      }),
    ).toEqual(["زبانه ۱", "زبانه ۲", "زبانه ۳"]);
  });
});

describe("every other language keeps Latin digits", () => {
  test.each([
    ["Arabic", "ar", "علامة التبويب 12", "فُتحت عند 1:02:14"],
    ["German", "de", "Tab 12", "geöffnet bei 1:02:14"],
    ["English", "en", "Tab 12", "opened 1:02:14"],
  ])("%s", (_name: string, language: string, name: string, opened: string) => {
    const translator: Translator =
      language === "en"
        ? createTranslator(undefined, "en")
        : shippedTranslator(language);

    expect(describeReplayTabName(LATE_TAB, translator)).toBe(name);
    expect(describeReplayTabOpened(LATE_TAB, translator)).toBe(opened);
    expect(formatReplayTabLabel(LATE_TAB, undefined, translator)).not.toMatch(
      PERSIAN_DIGIT,
    );
  });

  test("English reads word for word as it did", () => {
    expect(describeReplayTabName(SECOND_TAB)).toBe("Tab 2");
    expect(describeReplayTabOpened(SECOND_TAB)).toBe("opened 2:14");
    expect(formatReplayTabLabel(SECOND_TAB)).toBe(
      "Tab 2 · 30s · (opened 2:14)",
    );
    expect(formatReplayTabLabel(LATE_TAB)).toBe(
      "Tab 12 · 30s · (opened 1:02:14)",
    );
  });
});

describe("filterReplayTabs reads a number in whichever digits it is typed", () => {
  const persian: Translator = shippedTranslator("fa");
  const tabs: Array<ReplayTabSummary> = [1, 2, 3, 12, 13].map(
    (ordinal: number): ReplayTabSummary => {
      return summary({
        tabId: `tab-${ordinal}`,
        label: `Tab ${ordinal}`,
        ordinal: ordinal,
        firstUrl: `https://app.acme.com/page-${ordinal * 100}`,
        lastUrl: `https://app.acme.com/page-${ordinal * 100}`,
      });
    },
  );

  function idsFor(query: string, translator: Translator): Array<string> {
    return filterReplayTabs(tabs, query, translator).map(
      (tab: ReplayTabSummary): string => {
        return tab.tabId;
      },
    );
  }

  test("a Persian ordinal finds the tab a Latin one finds", () => {
    expect(idsFor("#۳", persian)).toEqual(["tab-3"]);
    expect(idsFor("#3", persian)).toEqual(["tab-3"]);
    expect(idsFor("۱۲", persian)).toEqual(idsFor("12", persian));
    expect(idsFor("۱۲", persian)).toEqual(["tab-12"]);
  });

  test("an Arabic-Indic one too", () => {
    expect(idsFor("#٣", persian)).toEqual(["tab-3"]);
    expect(idsFor("٢", persian)).toEqual(idsFor("2", persian));
  });

  test("the name the Persian reader sees, typed in Persian digits", () => {
    expect(idsFor("زبانه ۱۳", persian)).toEqual(["tab-13"]);
    expect(idsFor("زبانه 13", persian)).toEqual(["tab-13"]);
  });

  test("a page's number typed in Persian digits matches its address", () => {
    expect(idsFor("page-۱۳۰۰", persian)).toEqual(["tab-13"]);
  });

  test("English is unchanged", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(idsFor("#3", english)).toEqual(["tab-3"]);
    expect(idsFor("tab 1", english)).toEqual(["tab-1", "tab-12", "tab-13"]);
    expect(idsFor("checkout", english)).toEqual([]);
  });
});
