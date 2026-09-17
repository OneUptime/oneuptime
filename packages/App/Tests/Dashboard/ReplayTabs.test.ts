import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  SessionReplayManifest,
  parseManifest,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayManifest";
import {
  REPLAY_TAB_SPAN_MIN_WIDTH_PERCENT,
  REPLAY_TAB_STRIP_MAX_PILLS,
  REPLAY_TAB_UNKNOWN_PAGE,
  ReplayTabCounts,
  ReplayTabGroup,
  ReplayTabStatus,
  ReplayTabSummary,
  computeReplayTabSpan,
  countReplayTabs,
  describeReplayTabCounts,
  describeReplayTabOpened,
  describeReplayTabPage,
  filterReplayTabs,
  formatReplayTabLabel,
  getReplayTabStatus,
  groupReplayTabs,
  hasOpenReplayTabs,
  orderReplayTabsForDisplay,
  resolveReplayTabStatus,
  resolveReplayTabsSessionDurationMs,
  selectVisibleReplayTabs,
  summarizeReplayTabs,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";

/*
 * The tab model behind the header's tab switcher. The browser recorder
 * mints a new tab id on every page load, so a multi-page session carries a
 * dozen "tabs" and the viewer's questions are "which one is still open",
 * "what page is each" and "where am I". What is pinned here: status
 * resolution (including the session-level facts overriding a tab's flag),
 * summaries built from realistic manifests, the display order and its
 * stability, grouping, the counts sentence, page descriptions for every
 * url shape a recorder can send, the picker's filter, which pills a long
 * strip shows (the active tab always among them) and the span geometry.
 */

const CHUNK_MS: number = 15000;

interface ChunkOptions {
  eventCount?: number;
  url?: string;
  errorCount?: number;
  rageClickCount?: number;
  deadClickCount?: number;
  errorClickCount?: number;
  refreshRageCount?: number;
}

function chunkRow(
  chunkIndex: number,
  tabId: string,
  startMs: number,
  endMs: number,
  options?: ChunkOptions,
): JSONObject {
  const row: JSONObject = {
    chunkIndex: chunkIndex,
    tabId: tabId,
    chunkStartOffsetMs: startMs,
    chunkEndOffsetMs: endMs,
    eventCount: options?.eventCount ?? 120,
    hasFullSnapshot: chunkIndex === 0 ? 1 : 0,
    payloadBytes: 4096,
    errorCount: options?.errorCount ?? 0,
    rageClickCount: options?.rageClickCount ?? 0,
    deadClickCount: options?.deadClickCount ?? 0,
    errorClickCount: options?.errorClickCount ?? 0,
    refreshRageCount: options?.refreshRageCount ?? 0,
    routeCount: 0,
  };

  if (options?.url !== undefined) {
    row["url"] = options.url;
  }

  return row;
}

/*
 * A three-tab recording of the shape the browser recorder actually
 * produces: a tab per page load, the second one still recording, and a
 * duplicated tab that minted an id and never flushed anything.
 */
function manifestResponse(overrides?: {
  isFinalized?: boolean;
  hasRecordingEnded?: boolean;
  tabFlags?: Record<string, boolean | null>;
}): JSONObject {
  const flags: Record<string, boolean | null> = overrides?.tabFlags ?? {
    "tab-checkout": true,
    "tab-pay": false,
    "tab-ghost": null,
  };

  const tabRow: (
    tabId: string,
    chunks: Array<JSONObject>,
    firstOffsetMs: number | null,
  ) => JSONObject = (
    tabId: string,
    chunks: Array<JSONObject>,
    firstOffsetMs: number | null,
  ): JSONObject => {
    const row: JSONObject = { tabId: tabId, chunks: chunks, gaps: [] };

    if (firstOffsetMs !== null) {
      row["firstChunkStartOffsetMs"] = firstOffsetMs;
    }

    if (flags[tabId] !== undefined && flags[tabId] !== null) {
      row["hasRecordingEnded"] = flags[tabId] as boolean;
    }

    return row;
  };

  return {
    viewId: "view-1",
    isChunkIndexTruncated: 0,
    header: {
      sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      rumApplicationId: "app-1",
      startTime: "2026-09-04T10:12:41.200Z",
      durationMs: 200000,
      isFinalized: overrides?.isFinalized ? 1 : 0,
      hasRecordingEnded: overrides?.hasRecordingEnded ? 1 : 0,
      sealedReason: "",
      chunkCount: 5,
    },
    tabs: [
      tabRow(
        "tab-pay",
        [
          chunkRow(0, "tab-pay", 60000, 75000, {
            url: "https://app.acme.com/pay?step=2",
            errorCount: 2,
            rageClickCount: 1,
          }),
          chunkRow(1, "tab-pay", 75000, 92000, {
            url: "https://app.acme.com/pay/confirm",
            deadClickCount: 2,
            refreshRageCount: 1,
            errorClickCount: 1,
          }),
        ],
        60000,
      ),
      tabRow(
        "tab-checkout",
        [
          chunkRow(0, "tab-checkout", 0, CHUNK_MS, {
            url: "https://app.acme.com/checkout",
          }),
          chunkRow(1, "tab-checkout", CHUNK_MS, 40000, {
            url: "https://app.acme.com/checkout",
            errorCount: 1,
          }),
        ],
        0,
      ),
      tabRow("tab-ghost", [], null),
    ],
  };
}

function summarize(
  response: JSONObject,
  activeTabId: string | null,
): Array<ReplayTabSummary> {
  const manifest: SessionReplayManifest = parseManifest(response);

  return summarizeReplayTabs({
    tabs: manifest.tabs,
    activeTabId: activeTabId,
    isSessionFinalized: manifest.isFinalized,
    hasSessionRecordingEnded: manifest.hasRecordingEnded,
  });
}

/* A hand-built summary, for the ordering / grouping / geometry cases. */
function summary(overrides: Partial<ReplayTabSummary>): ReplayTabSummary {
  return {
    tabId: overrides.tabId ?? "tab-1",
    label: overrides.label ?? "Tab 1",
    durationMs: overrides.durationMs ?? 30000,
    openedAtMs: overrides.openedAtMs === undefined ? 0 : overrides.openedAtMs,
    hasFootage: overrides.hasFootage ?? true,
    isActive: overrides.isActive ?? false,
    ...overrides,
  };
}

function labelsOf(tabs: Array<ReplayTabSummary>): Array<string> {
  return tabs.map((tab: ReplayTabSummary): string => {
    return tab.label;
  });
}

describe("resolveReplayTabStatus", () => {
  test("a tab with no footage is empty, whatever else is true", () => {
    expect(
      resolveReplayTabStatus({
        hasFootage: false,
        tabHasRecordingEnded: false,
        isSessionFinalized: false,
        hasSessionRecordingEnded: false,
      }),
    ).toBe("empty");
    expect(
      resolveReplayTabStatus({
        hasFootage: false,
        tabHasRecordingEnded: null,
        isSessionFinalized: true,
        hasSessionRecordingEnded: true,
      }),
    ).toBe("empty");
  });

  test("a finalized session has no open tabs", () => {
    expect(
      resolveReplayTabStatus({
        hasFootage: true,
        tabHasRecordingEnded: false,
        isSessionFinalized: true,
        hasSessionRecordingEnded: false,
      }),
    ).toBe("closed");
  });

  test("a session whose recording ended has no open tabs either", () => {
    expect(
      resolveReplayTabStatus({
        hasFootage: true,
        tabHasRecordingEnded: null,
        isSessionFinalized: false,
        hasSessionRecordingEnded: true,
      }),
    ).toBe("closed");
  });

  test("the per-tab flag decides for a live session", () => {
    expect(
      resolveReplayTabStatus({
        hasFootage: true,
        tabHasRecordingEnded: true,
        isSessionFinalized: false,
        hasSessionRecordingEnded: false,
      }),
    ).toBe("closed");
    expect(
      resolveReplayTabStatus({
        hasFootage: true,
        tabHasRecordingEnded: false,
        isSessionFinalized: false,
        hasSessionRecordingEnded: false,
      }),
    ).toBe("open");
  });

  test("a server that did not report the flag leaves the tab unknown, never open", () => {
    expect(
      resolveReplayTabStatus({
        hasFootage: true,
        tabHasRecordingEnded: null,
        isSessionFinalized: false,
        hasSessionRecordingEnded: false,
      }),
    ).toBe("unknown");
  });
});

describe("getReplayTabStatus", () => {
  test("reads the status when the summary carries one", () => {
    expect(getReplayTabStatus(summary({ status: "open" }))).toBe("open");
    expect(getReplayTabStatus(summary({ status: "closed" }))).toBe("closed");
  });

  test("a summary without a status is unknown with footage, empty without", () => {
    expect(getReplayTabStatus(summary({}))).toBe("unknown");
    expect(getReplayTabStatus(summary({ hasFootage: false }))).toBe("empty");
  });
});

describe("summarizeReplayTabs from a realistic manifest", () => {
  const tabs: Array<ReplayTabSummary> = summarize(
    manifestResponse(),
    "tab-checkout",
  );

  test("labels tabs in opened order, whatever order the manifest listed them in", () => {
    expect(
      tabs.map((tab: ReplayTabSummary): [string, string] => {
        return [tab.tabId, tab.label];
      }),
    ).toEqual([
      ["tab-checkout", "Tab 1"],
      ["tab-pay", "Tab 2"],
      ["tab-ghost", "Tab 3"],
    ]);
  });

  test("carries each tab's footage window: opened, closed and duration", () => {
    expect(tabs[0]?.openedAtMs).toBe(0);
    expect(tabs[0]?.closedAtMs).toBe(40000);
    expect(tabs[0]?.durationMs).toBe(40000);
    expect(tabs[1]?.openedAtMs).toBe(60000);
    expect(tabs[1]?.closedAtMs).toBe(92000);
    expect(tabs[1]?.durationMs).toBe(32000);
    /* Nothing was ever flushed for the duplicated tab. */
    expect(tabs[2]?.openedAtMs).toBeNull();
    expect(tabs[2]?.closedAtMs).toBeNull();
    expect(tabs[2]?.durationMs).toBe(0);
  });

  test("resolves a status per tab from the tab flag and the session facts", () => {
    expect(
      tabs.map((tab: ReplayTabSummary): ReplayTabStatus | undefined => {
        return tab.status;
      }),
    ).toEqual(["closed", "open", "empty"]);
    expect(hasOpenReplayTabs(tabs)).toBe(true);
  });

  test("marks the active tab, and only it", () => {
    expect(
      tabs.map((tab: ReplayTabSummary): boolean => {
        return tab.isActive;
      }),
    ).toEqual([true, false, false]);
    expect(
      summarize(manifestResponse(), null).some(
        (tab: ReplayTabSummary): boolean => {
          return tab.isActive;
        },
      ),
    ).toBe(false);
    expect(summarize(manifestResponse(), "tab-ghost")[2]?.isActive).toBe(true);
  });

  test("names the first and last page of each tab and counts the distinct ones", () => {
    expect(tabs[0]?.firstUrl).toBe("https://app.acme.com/checkout");
    expect(tabs[0]?.lastUrl).toBe("https://app.acme.com/checkout");
    /* Two chunks, one page: a page count, not a chunk count. */
    expect(tabs[0]?.pageCount).toBe(1);
    expect(tabs[1]?.firstUrl).toBe("https://app.acme.com/pay?step=2");
    expect(tabs[1]?.lastUrl).toBe("https://app.acme.com/pay/confirm");
    expect(tabs[1]?.pageCount).toBe(2);
    expect(tabs[2]?.firstUrl).toBe("");
    expect(tabs[2]?.lastUrl).toBe("");
    expect(tabs[2]?.pageCount).toBe(0);
  });

  test("sums the chunk counters into errors and frustrations", () => {
    expect(tabs[0]?.errorCount).toBe(1);
    expect(tabs[0]?.frustrationCount).toBe(0);
    expect(tabs[1]?.errorCount).toBe(2);
    /* rage 1 + dead 2 + error-click 1 + refresh-rage 1 */
    expect(tabs[1]?.frustrationCount).toBe(5);
    expect(tabs[2]?.errorCount).toBe(0);
    expect(tabs[2]?.frustrationCount).toBe(0);
  });

  test("a blank chunk url does not hide a page the tab did report", () => {
    const response: JSONObject = manifestResponse();
    const tabRows: Array<JSONObject> = response["tabs"] as Array<JSONObject>;
    const payChunks: Array<JSONObject> = (tabRows[0] as JSONObject)[
      "chunks"
    ] as Array<JSONObject>;

    (payChunks[0] as JSONObject)["url"] = "";

    const summarized: Array<ReplayTabSummary> = summarize(response, null);

    expect(summarized[1]?.firstUrl).toBe("https://app.acme.com/pay/confirm");
    expect(summarized[1]?.pageCount).toBe(1);
  });

  test("a finalized session reports every tab closed, whatever the tab flags said", () => {
    const finalized: Array<ReplayTabSummary> = summarize(
      manifestResponse({ isFinalized: true }),
      "tab-checkout",
    );

    expect(
      finalized.map((tab: ReplayTabSummary): ReplayTabStatus | undefined => {
        return tab.status;
      }),
    ).toEqual(["closed", "closed", "empty"]);
    expect(hasOpenReplayTabs(finalized)).toBe(false);
  });

  test("a session whose recording ended closes every tab too", () => {
    const ended: Array<ReplayTabSummary> = summarize(
      manifestResponse({ hasRecordingEnded: true }),
      null,
    );

    expect(
      ended.map((tab: ReplayTabSummary): ReplayTabStatus | undefined => {
        return tab.status;
      }),
    ).toEqual(["closed", "closed", "empty"]);
  });

  test("an older server that sends no tab flags leaves the footage tabs unknown", () => {
    const older: Array<ReplayTabSummary> = summarize(
      manifestResponse({
        tabFlags: {
          "tab-checkout": null,
          "tab-pay": null,
          "tab-ghost": null,
        },
      }),
      null,
    );

    expect(
      older.map((tab: ReplayTabSummary): ReplayTabStatus | undefined => {
        return tab.status;
      }),
    ).toEqual(["unknown", "unknown", "empty"]);
    expect(hasOpenReplayTabs(older)).toBe(false);
  });

  test("a tab whose only chunk is an empty sealing chunk has no footage", () => {
    const response: JSONObject = manifestResponse();

    response["tabs"] = [
      {
        tabId: "tab-sealed",
        firstChunkStartOffsetMs: 0,
        chunks: [chunkRow(0, "tab-sealed", 0, 0, { eventCount: 0 })],
        gaps: [],
        hasRecordingEnded: true,
      },
    ];

    const sealed: Array<ReplayTabSummary> = summarize(response, "tab-sealed");

    expect(sealed[0]?.hasFootage).toBe(false);
    expect(sealed[0]?.status).toBe("empty");
    /* The offsets are still known - the sealing chunk had them. */
    expect(sealed[0]?.openedAtMs).toBe(0);
    expect(sealed[0]?.closedAtMs).toBe(0);
  });

  test("an empty manifest summarizes to no tabs", () => {
    expect(
      summarizeReplayTabs({
        tabs: [],
        activeTabId: "tab-1",
        isSessionFinalized: false,
        hasSessionRecordingEnded: false,
      }),
    ).toEqual([]);
  });
});

describe("orderReplayTabsForDisplay", () => {
  const tabs: Array<ReplayTabSummary> = [
    summary({ tabId: "a", label: "Tab 1", status: "closed" }),
    summary({ tabId: "b", label: "Tab 2", status: "empty", hasFootage: false }),
    summary({ tabId: "c", label: "Tab 3", status: "open" }),
    summary({ tabId: "d", label: "Tab 4", status: "unknown" }),
    summary({ tabId: "e", label: "Tab 5", status: "open" }),
    summary({ tabId: "f", label: "Tab 6", status: "closed" }),
  ];

  test("open first, then unknown, then closed, then the tabs without footage", () => {
    expect(labelsOf(orderReplayTabsForDisplay(tabs))).toEqual([
      "Tab 3",
      "Tab 5",
      "Tab 4",
      "Tab 1",
      "Tab 6",
      "Tab 2",
    ]);
  });

  test("keeps opened order inside each status, and does not mutate the input", () => {
    const ordered: Array<ReplayTabSummary> = orderReplayTabsForDisplay(tabs);

    expect(labelsOf(tabs)).toEqual([
      "Tab 1",
      "Tab 2",
      "Tab 3",
      "Tab 4",
      "Tab 5",
      "Tab 6",
    ]);
    /* Same objects, re-ordered: identity is what the strip keys on. */
    expect(ordered).toHaveLength(tabs.length);
    expect(ordered.includes(tabs[2] as ReplayTabSummary)).toBe(true);
  });

  test("ordering twice is the same order (stable, not merely sorted)", () => {
    const once: Array<ReplayTabSummary> = orderReplayTabsForDisplay(tabs);

    expect(labelsOf(orderReplayTabsForDisplay(once))).toEqual(labelsOf(once));
  });

  test("a summary without a status is ordered as unknown (or empty without footage)", () => {
    expect(
      labelsOf(
        orderReplayTabsForDisplay([
          summary({ label: "Tab 1", hasFootage: false }),
          summary({ label: "Tab 2" }),
          summary({ label: "Tab 3", status: "open" }),
        ]),
      ),
    ).toEqual(["Tab 3", "Tab 2", "Tab 1"]);
  });

  test("an empty list orders to an empty list", () => {
    expect(orderReplayTabsForDisplay([])).toEqual([]);
  });
});

describe("groupReplayTabs", () => {
  test("a live session groups Open (open and unknown), Closed and No footage", () => {
    const groups: Array<ReplayTabGroup> = groupReplayTabs([
      summary({ label: "Tab 1", status: "closed" }),
      summary({ label: "Tab 2", status: "open" }),
      summary({ label: "Tab 3", status: "unknown" }),
      summary({ label: "Tab 4", status: "empty", hasFootage: false }),
      summary({ label: "Tab 5", status: "closed" }),
    ]);

    expect(
      groups.map((group: ReplayTabGroup): [string, string, Array<string>] => {
        return [group.id, group.title, labelsOf(group.tabs)];
      }),
    ).toEqual([
      ["open", "Open", ["Tab 2", "Tab 3"]],
      ["closed", "Closed", ["Tab 1", "Tab 5"]],
      ["empty", "No footage", ["Tab 4"]],
    ]);
  });

  test("empty groups are never returned", () => {
    const groups: Array<ReplayTabGroup> = groupReplayTabs([
      summary({ label: "Tab 1", status: "open" }),
      summary({ label: "Tab 2", status: "open" }),
    ]);

    expect(
      groups.map((group: ReplayTabGroup): string => {
        return group.id;
      }),
    ).toEqual(["open"]);
  });

  test("a finished session is one 'all' group titled Tabs", () => {
    const groups: Array<ReplayTabGroup> = groupReplayTabs([
      summary({ label: "Tab 1", status: "closed" }),
      summary({ label: "Tab 2", status: "closed" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("all");
    expect(groups[0]?.title).toBe("Tabs");
    expect(labelsOf(groups[0]?.tabs ?? [])).toEqual(["Tab 1", "Tab 2"]);
  });

  test("a finished session still separates the tabs without footage", () => {
    const groups: Array<ReplayTabGroup> = groupReplayTabs([
      summary({ label: "Tab 1", status: "closed" }),
      summary({ label: "Tab 2", status: "empty", hasFootage: false }),
    ]);

    expect(
      groups.map((group: ReplayTabGroup): [string, Array<string>] => {
        return [group.id, labelsOf(group.tabs)];
      }),
    ).toEqual([
      ["all", ["Tab 1"]],
      ["empty", ["Tab 2"]],
    ]);
  });

  test("an older server's unknown tabs are one 'all' group, not a wrong 'Open' heading", () => {
    const groups: Array<ReplayTabGroup> = groupReplayTabs([
      summary({ label: "Tab 1", status: "unknown" }),
      summary({ label: "Tab 2", status: "unknown" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe("all");
  });

  test("tabs keep display order inside their group", () => {
    const groups: Array<ReplayTabGroup> = groupReplayTabs([
      summary({ label: "Tab 1", status: "unknown" }),
      summary({ label: "Tab 2", status: "open" }),
      summary({ label: "Tab 3", status: "open" }),
    ]);

    expect(labelsOf(groups[0]?.tabs ?? [])).toEqual([
      "Tab 2",
      "Tab 3",
      "Tab 1",
    ]);
  });

  test("only tabs without footage is a single No footage group", () => {
    const groups: Array<ReplayTabGroup> = groupReplayTabs([
      summary({ label: "Tab 1", status: "empty", hasFootage: false }),
    ]);

    expect(
      groups.map((group: ReplayTabGroup): string => {
        return group.id;
      }),
    ).toEqual(["empty"]);
  });

  test("no tabs at all is no groups", () => {
    expect(groupReplayTabs([])).toEqual([]);
  });

  test("every tab appears in exactly one group", () => {
    const tabs: Array<ReplayTabSummary> = [
      summary({ label: "Tab 1", status: "open" }),
      summary({ label: "Tab 2", status: "unknown" }),
      summary({ label: "Tab 3", status: "closed" }),
      summary({ label: "Tab 4", status: "empty", hasFootage: false }),
    ];

    const grouped: Array<string> = groupReplayTabs(tabs).flatMap(
      (group: ReplayTabGroup): Array<string> => {
        return labelsOf(group.tabs);
      },
    );

    expect(grouped.slice().sort()).toEqual(labelsOf(tabs).slice().sort());
  });
});

describe("countReplayTabs and describeReplayTabCounts", () => {
  const mixed: Array<ReplayTabSummary> = [
    summary({ label: "Tab 1", status: "open" }),
    summary({ label: "Tab 2", status: "closed" }),
    summary({ label: "Tab 3", status: "closed" }),
    summary({ label: "Tab 4", status: "empty", hasFootage: false }),
    summary({ label: "Tab 5", status: "unknown" }),
  ];

  test("counts every status and the total", () => {
    const counts: ReplayTabCounts = countReplayTabs(mixed);

    expect(counts).toEqual({
      total: 5,
      open: 1,
      closed: 2,
      unknown: 1,
      empty: 1,
    });
    expect(countReplayTabs([])).toEqual({
      total: 0,
      open: 0,
      closed: 0,
      unknown: 0,
      empty: 0,
    });
  });

  test("counts a summary without a status as unknown, or empty without footage", () => {
    expect(
      countReplayTabs([summary({}), summary({ hasFootage: false })]),
    ).toEqual({ total: 2, open: 0, closed: 0, unknown: 1, empty: 1 });
  });

  test("a live session reads '3 tabs · 1 open · 2 closed'", () => {
    expect(
      describeReplayTabCounts([
        summary({ label: "Tab 1", status: "open" }),
        summary({ label: "Tab 2", status: "closed" }),
        summary({ label: "Tab 3", status: "closed" }),
      ]),
    ).toBe("3 tabs · 1 open · 2 closed");
  });

  test("zero parts are omitted", () => {
    expect(
      describeReplayTabCounts([
        summary({ label: "Tab 1", status: "open" }),
        summary({ label: "Tab 2", status: "open" }),
      ]),
    ).toBe("2 tabs · 2 open");
  });

  test("tabs without footage are counted as 'without footage'", () => {
    expect(describeReplayTabCounts(mixed)).toBe(
      "5 tabs · 2 open · 2 closed · 1 without footage",
    );
  });

  test("the open part matches the picker's Open group, which holds the unknown tabs too", () => {
    const tabs: Array<ReplayTabSummary> = [
      summary({ label: "Tab 1", status: "open" }),
      summary({ label: "Tab 2", status: "unknown" }),
    ];

    expect(describeReplayTabCounts(tabs)).toBe("2 tabs · 2 open");
    expect(groupReplayTabs(tabs)[0]?.tabs).toHaveLength(2);
  });

  test("a finished session just says how many tabs there were", () => {
    expect(
      describeReplayTabCounts([
        summary({ label: "Tab 1", status: "closed" }),
        summary({ label: "Tab 2", status: "closed" }),
        summary({ label: "Tab 3", status: "empty", hasFootage: false }),
      ]),
    ).toBe("3 tabs");
  });

  test("one tab is singular, and no tabs reads '0 tabs'", () => {
    expect(
      describeReplayTabCounts([summary({ label: "Tab 1", status: "open" })]),
    ).toBe("1 tab · 1 open");
    expect(
      describeReplayTabCounts([summary({ label: "Tab 1", status: "closed" })]),
    ).toBe("1 tab");
    expect(describeReplayTabCounts([])).toBe("0 tabs");
  });
});

describe("describeReplayTabPage", () => {
  test("keeps the path and the query, drops the origin and the hash", () => {
    expect(describeReplayTabPage("https://app.acme.com/checkout?step=2")).toBe(
      "/checkout?step=2",
    );
    expect(describeReplayTabPage("https://app.acme.com/checkout#payment")).toBe(
      "/checkout",
    );
    expect(
      describeReplayTabPage("http://localhost:3000/dashboard?tab=logs#row-4"),
    ).toBe("/dashboard?tab=logs");
  });

  test("a root url is '/'", () => {
    expect(describeReplayTabPage("https://app.acme.com")).toBe("/");
    expect(describeReplayTabPage("https://app.acme.com/")).toBe("/");
    expect(describeReplayTabPage("https://app.acme.com/?ref=email")).toBe(
      "/?ref=email",
    );
  });

  test("a long query string is cut with an ellipsis", () => {
    const long: string =
      "https://app.acme.com/checkout?utm_source=newsletter&utm_campaign=september-relaunch&utm_medium=email";
    const described: string = describeReplayTabPage(long);

    expect(described.startsWith("/checkout?utm_source=newsletter")).toBe(true);
    expect(described.endsWith("…")).toBe(true);
    /* "/checkout" + 40 characters of query + the ellipsis. */
    expect(described).toHaveLength("/checkout".length + 41);
  });

  test("a query string exactly at the limit is not cut", () => {
    const search: string = `?q=${"a".repeat(37)}`;

    expect(search).toHaveLength(40);
    expect(describeReplayTabPage(`https://app.acme.com/s${search}`)).toBe(
      `/s${search}`,
    );
  });

  test("percent-encoded paths are shown as the viewer typed them", () => {
    expect(describeReplayTabPage("https://app.acme.com/caf%C3%A9/menu")).toBe(
      "/café/menu",
    );
  });

  test("an empty, blank or absent url is 'Unknown page'", () => {
    expect(describeReplayTabPage("")).toBe(REPLAY_TAB_UNKNOWN_PAGE);
    expect(describeReplayTabPage("   ")).toBe(REPLAY_TAB_UNKNOWN_PAGE);
    expect(describeReplayTabPage(undefined)).toBe(REPLAY_TAB_UNKNOWN_PAGE);
    expect(REPLAY_TAB_UNKNOWN_PAGE).toBe("Unknown page");
  });

  test("a relative or unparseable value is shown as recorded, trimmed", () => {
    expect(describeReplayTabPage("/checkout?step=2")).toBe("/checkout?step=2");
    expect(describeReplayTabPage("  /checkout  ")).toBe("/checkout");
    expect(describeReplayTabPage("not a url at all")).toBe("not a url at all");
  });

  test("a non-http scheme (a native screen, a file, a blob) is shown as recorded", () => {
    expect(describeReplayTabPage("app://checkout/summary")).toBe(
      "app://checkout/summary",
    );
    expect(describeReplayTabPage("file:///Users/jane/index.html")).toBe(
      "file:///Users/jane/index.html",
    );
    expect(describeReplayTabPage("about:blank")).toBe("about:blank");
  });

  test("never throws, whatever the recorder sent", () => {
    const values: Array<string> = [
      "https://",
      "http://[",
      "%%%",
      "https://app.acme.com/%E0%A4%A",
      "https://user:pass@app.acme.com/private?x=1",
    ];

    for (const value of values) {
      expect((): string => {
        return describeReplayTabPage(value);
      }).not.toThrow();
    }

    /* Credentials in the url never reach the pill: only path and query do. */
    expect(
      describeReplayTabPage("https://user:pass@app.acme.com/private?x=1"),
    ).toBe("/private?x=1");
  });
});

describe("filterReplayTabs", () => {
  const tabs: Array<ReplayTabSummary> = [
    summary({
      label: "Tab 1",
      tabId: "a",
      firstUrl: "https://app.acme.com/checkout",
      lastUrl: "https://app.acme.com/checkout",
    }),
    summary({
      label: "Tab 2",
      tabId: "b",
      firstUrl: "https://app.acme.com/pay?step=2",
      lastUrl: "https://app.acme.com/pay/confirm",
    }),
    summary({ label: "Tab 3", tabId: "c", hasFootage: false }),
    summary({
      label: "Tab 13",
      tabId: "d",
      firstUrl: "https://app.acme.com/settings",
    }),
  ];

  test("a blank query keeps every tab, in the order given", () => {
    expect(labelsOf(filterReplayTabs(tabs, ""))).toEqual(labelsOf(tabs));
    expect(labelsOf(filterReplayTabs(tabs, "   "))).toEqual(labelsOf(tabs));
  });

  test("matches the label, case-insensitively", () => {
    expect(labelsOf(filterReplayTabs(tabs, "tab 2"))).toEqual(["Tab 2"]);
    expect(labelsOf(filterReplayTabs(tabs, "TAB 13"))).toEqual(["Tab 13"]);
    expect(labelsOf(filterReplayTabs(tabs, "tab"))).toEqual(labelsOf(tabs));
  });

  test("a bare ordinal matches that tab, '#3' too", () => {
    expect(labelsOf(filterReplayTabs(tabs, "2"))).toEqual(["Tab 2"]);
    expect(labelsOf(filterReplayTabs(tabs, "#3"))).toEqual(["Tab 3"]);
    expect(labelsOf(filterReplayTabs(tabs, "13"))).toEqual(["Tab 13"]);
  });

  test("matches the first and the last url", () => {
    expect(labelsOf(filterReplayTabs(tabs, "checkout"))).toEqual(["Tab 1"]);
    /* Only the last url has /confirm. */
    expect(labelsOf(filterReplayTabs(tabs, "confirm"))).toEqual(["Tab 2"]);
    expect(labelsOf(filterReplayTabs(tabs, "acme.com"))).toEqual([
      "Tab 1",
      "Tab 2",
      "Tab 13",
    ]);
    expect(labelsOf(filterReplayTabs(tabs, "STEP=2"))).toEqual(["Tab 2"]);
  });

  test("keeps the input order and does not mutate the input", () => {
    const filtered: Array<ReplayTabSummary> = filterReplayTabs(tabs, "a");

    expect(labelsOf(tabs)).toEqual(["Tab 1", "Tab 2", "Tab 3", "Tab 13"]);
    expect(labelsOf(filtered)).toEqual(
      labelsOf(
        tabs.filter((tab: ReplayTabSummary): boolean => {
          return filtered.includes(tab);
        }),
      ),
    );
  });

  test("a query nothing matches yields nothing", () => {
    expect(filterReplayTabs(tabs, "zzz")).toEqual([]);
    expect(filterReplayTabs([], "checkout")).toEqual([]);
  });

  test("a tab with no urls is still findable by its label", () => {
    expect(labelsOf(filterReplayTabs(tabs, "tab 3"))).toEqual(["Tab 3"]);
    expect(labelsOf(filterReplayTabs(tabs, "settings"))).toEqual(["Tab 13"]);
  });
});

describe("selectVisibleReplayTabs", () => {
  function strip(
    count: number,
    statusOf: (index: number) => ReplayTabStatus,
    activeIndex: number,
  ): Array<ReplayTabSummary> {
    const tabs: Array<ReplayTabSummary> = [];

    for (let index: number = 0; index < count; index++) {
      tabs.push(
        summary({
          tabId: `tab-${index + 1}`,
          label: `Tab ${index + 1}`,
          status: statusOf(index),
          hasFootage: statusOf(index) !== "empty",
          isActive: index === activeIndex,
        }),
      );
    }

    return tabs;
  }

  test("a short strip shows every tab, in display order", () => {
    const tabs: Array<ReplayTabSummary> = [
      summary({ label: "Tab 1", status: "closed" }),
      summary({ label: "Tab 2", status: "open", isActive: true }),
      summary({ label: "Tab 3", status: "empty", hasFootage: false }),
    ];

    expect(labelsOf(selectVisibleReplayTabs(tabs))).toEqual([
      "Tab 2",
      "Tab 1",
      "Tab 3",
    ]);
  });

  test("exactly the cap still shows every tab", () => {
    const tabs: Array<ReplayTabSummary> = strip(
      REPLAY_TAB_STRIP_MAX_PILLS,
      (): ReplayTabStatus => {
        return "closed";
      },
      0,
    );

    expect(selectVisibleReplayTabs(tabs)).toHaveLength(
      REPLAY_TAB_STRIP_MAX_PILLS,
    );
  });

  test("a long strip shows the open tabs and the one being watched", () => {
    const tabs: Array<ReplayTabSummary> = strip(
      12,
      (index: number): ReplayTabStatus => {
        return index === 2 || index === 9 ? "open" : "closed";
      },
      5,
    );

    expect(labelsOf(selectVisibleReplayTabs(tabs))).toEqual([
      "Tab 3",
      "Tab 10",
      "Tab 6",
    ]);
  });

  test("the active tab survives the cap when the open tabs alone would fill it", () => {
    const tabs: Array<ReplayTabSummary> = strip(
      12,
      (index: number): ReplayTabStatus => {
        return index < 8 ? "open" : "closed";
      },
      10,
    );

    const visible: Array<ReplayTabSummary> = selectVisibleReplayTabs(tabs);

    expect(visible).toHaveLength(REPLAY_TAB_STRIP_MAX_PILLS);
    expect(labelsOf(visible)).toEqual([
      "Tab 1",
      "Tab 2",
      "Tab 3",
      "Tab 4",
      "Tab 5",
      "Tab 11",
    ]);
    expect(
      visible.some((tab: ReplayTabSummary): boolean => {
        return tab.isActive;
      }),
    ).toBe(true);
  });

  test("an active tab already among the open ones is not counted twice", () => {
    const tabs: Array<ReplayTabSummary> = strip(
      12,
      (index: number): ReplayTabStatus => {
        return index < 8 ? "open" : "closed";
      },
      2,
    );

    const visible: Array<ReplayTabSummary> = selectVisibleReplayTabs(tabs);

    expect(labelsOf(visible)).toEqual([
      "Tab 1",
      "Tab 2",
      "Tab 3",
      "Tab 4",
      "Tab 5",
      "Tab 6",
    ]);
  });

  test("unknown tabs count as open for the strip", () => {
    const tabs: Array<ReplayTabSummary> = strip(
      9,
      (index: number): ReplayTabStatus => {
        return index < 3 ? "unknown" : "closed";
      },
      8,
    );

    expect(labelsOf(selectVisibleReplayTabs(tabs))).toEqual([
      "Tab 1",
      "Tab 2",
      "Tab 3",
      "Tab 9",
    ]);
  });

  test("a finished session with no active tab shows no pills; the picker lists them", () => {
    const tabs: Array<ReplayTabSummary> = strip(
      10,
      (): ReplayTabStatus => {
        return "closed";
      },
      -1,
    );

    expect(selectVisibleReplayTabs(tabs)).toEqual([]);
  });

  test("honours an explicit max, and never returns none for a bad one", () => {
    const tabs: Array<ReplayTabSummary> = strip(
      8,
      (): ReplayTabStatus => {
        return "open";
      },
      7,
    );

    expect(selectVisibleReplayTabs(tabs, 3)).toHaveLength(3);
    expect(labelsOf(selectVisibleReplayTabs(tabs, 3))).toEqual([
      "Tab 1",
      "Tab 2",
      "Tab 8",
    ]);
    expect(selectVisibleReplayTabs(tabs, 0)).toHaveLength(1);
    expect(labelsOf(selectVisibleReplayTabs(tabs, 0))).toEqual(["Tab 8"]);
    expect(selectVisibleReplayTabs(tabs, NaN)).toHaveLength(
      REPLAY_TAB_STRIP_MAX_PILLS,
    );
  });

  test("an empty list selects nothing", () => {
    expect(selectVisibleReplayTabs([])).toEqual([]);
  });

  test("the cap is six pills", () => {
    expect(REPLAY_TAB_STRIP_MAX_PILLS).toBe(6);
  });
});

/*
 * The length the picker's span bars are drawn against.
 *
 * The bug this reverses: the header used to hand the switcher its
 * `durationMs`, which follows the ENGINE - so it is the footage of the tab
 * being WATCHED ("0:41 / 4:12" is within this tab), not the session. Every
 * other tab was then scaled by one tab's length, and in an eight-tab
 * recording the first three bars came out at left 0% / width 100% and
 * every later one pinned at left 98%: a timeline that answered nothing.
 * So the tabs are the floor - the furthest point any of them reaches is,
 * by definition, at least as long as the session they all sit in - and the
 * caller's figure only wins when it is the larger of the two.
 */
describe("resolveReplayTabsSessionDurationMs", () => {
  /* Three tabs of a 10 minute session; the watched one is 30s of it. */
  function sessionTabs(): Array<ReplayTabSummary> {
    return [
      summary({
        tabId: "tab-1",
        label: "Tab 1",
        openedAtMs: 0,
        closedAtMs: 30000,
        durationMs: 30000,
        isActive: true,
      }),
      summary({
        tabId: "tab-2",
        label: "Tab 2",
        openedAtMs: 120000,
        closedAtMs: 180000,
        durationMs: 60000,
      }),
      summary({
        tabId: "tab-3",
        label: "Tab 3",
        openedAtMs: 400000,
        closedAtMs: 480000,
        durationMs: 80000,
      }),
    ];
  }

  test("the caller's session length wins when it is the longer of the two", () => {
    expect(resolveReplayTabsSessionDurationMs(sessionTabs(), 600000)).toBe(
      600000,
    );
  });

  test("the tabs floor a caller who handed over the watched tab's length", () => {
    /*
     * 30000 is Tab 1's footage, the figure the engine reports. Tab 3 alone
     * proves the session ran to at least 8 minutes.
     */
    expect(resolveReplayTabsSessionDurationMs(sessionTabs(), 30000)).toBe(
      480000,
    );
  });

  test("the tabs floor a caller who says nothing at all", () => {
    expect(resolveReplayTabsSessionDurationMs(sessionTabs())).toBe(480000);
    expect(resolveReplayTabsSessionDurationMs(sessionTabs(), undefined)).toBe(
      480000,
    );
  });

  test("zero, negative and non-finite figures are ignored, not trusted", () => {
    const tabs: Array<ReplayTabSummary> = sessionTabs();

    expect(resolveReplayTabsSessionDurationMs(tabs, 0)).toBe(480000);
    expect(resolveReplayTabsSessionDurationMs(tabs, -1)).toBe(480000);
    expect(resolveReplayTabsSessionDurationMs(tabs, NaN)).toBe(480000);
    expect(resolveReplayTabsSessionDurationMs(tabs, Infinity)).toBe(480000);
    expect(
      resolveReplayTabsSessionDurationMs(tabs, "600000" as unknown as number),
    ).toBe(480000);
  });

  test("nothing known at all is zero, which draws no bars rather than wrong ones", () => {
    expect(resolveReplayTabsSessionDurationMs([])).toBe(0);
    expect(resolveReplayTabsSessionDurationMs([], 0)).toBe(0);
    expect(resolveReplayTabsSessionDurationMs([], NaN)).toBe(0);
  });

  test("an empty list still takes a usable figure from the caller", () => {
    expect(resolveReplayTabsSessionDurationMs([], 600000)).toBe(600000);
  });

  test("a tab that reported no offsets contributes nothing", () => {
    const ghost: ReplayTabSummary = summary({
      tabId: "tab-ghost",
      label: "Tab 3",
      openedAtMs: null,
      closedAtMs: null,
      durationMs: 0,
      hasFootage: false,
    });

    expect(resolveReplayTabsSessionDurationMs([ghost])).toBe(0);
    expect(resolveReplayTabsSessionDurationMs([ghost], 600000)).toBe(600000);
    expect(resolveReplayTabsSessionDurationMs([...sessionTabs(), ghost])).toBe(
      480000,
    );
  });

  test("a tab with no opening offset is still worth its own duration", () => {
    expect(
      resolveReplayTabsSessionDurationMs([
        summary({ openedAtMs: null, closedAtMs: null, durationMs: 45000 }),
      ]),
    ).toBe(45000);
  });

  test("closedAtMs is the tab's end when it has one, openedAt + duration otherwise", () => {
    /* The last chunk's end, even when it is longer than the tab's own duration. */
    expect(
      resolveReplayTabsSessionDurationMs([
        summary({ openedAtMs: 60000, closedAtMs: 200000, durationMs: 30000 }),
      ]),
    ).toBe(200000);

    /* Without one, the duration from the opening offset. */
    expect(
      resolveReplayTabsSessionDurationMs([
        summary({ openedAtMs: 60000, closedAtMs: null, durationMs: 30000 }),
      ]),
    ).toBe(90000);

    /* A non-finite closing offset falls back the same way. */
    expect(
      resolveReplayTabsSessionDurationMs([
        summary({
          openedAtMs: 60000,
          closedAtMs: NaN,
          durationMs: 30000,
        }),
      ]),
    ).toBe(90000);

    /* And a closing offset BEFORE the opening one never shortens the session. */
    expect(
      resolveReplayTabsSessionDurationMs([
        summary({ openedAtMs: 150000, closedAtMs: 10000, durationMs: 0 }),
      ]),
    ).toBe(150000);
  });

  test("works straight off a summarized manifest, matching its header duration", () => {
    const tabs: Array<ReplayTabSummary> = summarize(
      manifestResponse(),
      "tab-checkout",
    );

    /* The furthest any tab reaches is tab-pay's last chunk, at 92s. */
    expect(resolveReplayTabsSessionDurationMs(tabs)).toBe(92000);
    /* The manifest header says 200s, and it is the longer, so it wins. */
    expect(resolveReplayTabsSessionDurationMs(tabs, 200000)).toBe(200000);
    /* The watched tab is 40s of it, and must not become the scale. */
    expect(resolveReplayTabsSessionDurationMs(tabs, 40000)).toBe(92000);
  });

  /*
   * The two functions are used together: resolve first, then place each
   * tab against the result. Fed the watched tab's length, the pair still
   * lays the tabs out in order instead of stacking them at either end.
   */
  test("feeds computeReplayTabSpan a scale that keeps later tabs to the right", () => {
    const tabs: Array<ReplayTabSummary> = sessionTabs();
    const scale: number = resolveReplayTabsSessionDurationMs(tabs, 30000);

    expect(computeReplayTabSpan(tabs[0] as ReplayTabSummary, scale)).toEqual({
      leftPercent: 0,
      widthPercent: 6.25,
    });
    expect(computeReplayTabSpan(tabs[1] as ReplayTabSummary, scale)).toEqual({
      leftPercent: 25,
      widthPercent: 12.5,
    });
    expect(computeReplayTabSpan(tabs[2] as ReplayTabSummary, scale)).toEqual({
      leftPercent: 83.33333333333334,
      widthPercent: 16.666666666666657,
    });
  });
});

describe("computeReplayTabSpan", () => {
  test("places the tab's footage on the session clock", () => {
    expect(
      computeReplayTabSpan(
        summary({ openedAtMs: 30000, closedAtMs: 60000 }),
        120000,
      ),
    ).toEqual({ leftPercent: 25, widthPercent: 25 });
  });

  test("a tab that spans the whole session fills the bar", () => {
    expect(
      computeReplayTabSpan(
        summary({ openedAtMs: 0, closedAtMs: 100000 }),
        100000,
      ),
    ).toEqual({ leftPercent: 0, widthPercent: 100 });
  });

  test("uses the tab's duration when the closing offset is unknown", () => {
    expect(
      computeReplayTabSpan(
        summary({ openedAtMs: 20000, closedAtMs: null, durationMs: 20000 }),
        100000,
      ),
    ).toEqual({ leftPercent: 20, widthPercent: 20 });
  });

  test("a very short tab still gets a visible mark", () => {
    const span: { leftPercent: number; widthPercent: number } | null =
      computeReplayTabSpan(
        summary({ openedAtMs: 10000, closedAtMs: 10100 }),
        600000,
      );

    expect(span?.widthPercent).toBe(REPLAY_TAB_SPAN_MIN_WIDTH_PERCENT);
    expect(span?.leftPercent).toBeCloseTo(1.6667, 3);
  });

  test("a tab without footage is not widened to the minimum", () => {
    expect(
      computeReplayTabSpan(
        summary({
          openedAtMs: 10000,
          closedAtMs: 10000,
          hasFootage: false,
          durationMs: 0,
        }),
        100000,
      ),
    ).toEqual({ leftPercent: 10, widthPercent: 0 });
  });

  test("the bar never runs past the end of the track", () => {
    const span: { leftPercent: number; widthPercent: number } | null =
      computeReplayTabSpan(
        summary({ openedAtMs: 99000, closedAtMs: 99500 }),
        100000,
      );

    expect(span?.leftPercent).toBe(98);
    expect(span?.widthPercent).toBe(REPLAY_TAB_SPAN_MIN_WIDTH_PERCENT);
    expect((span?.leftPercent ?? 0) + (span?.widthPercent ?? 0)).toBe(100);
  });

  test("footage past the session duration is clamped, not drawn outside", () => {
    expect(
      computeReplayTabSpan(
        summary({ openedAtMs: 150000, closedAtMs: 200000 }),
        100000,
      ),
    ).toEqual({ leftPercent: 98, widthPercent: 2 });
  });

  test("a closing offset before the opening one is treated as a point in time", () => {
    expect(
      computeReplayTabSpan(
        summary({ openedAtMs: 50000, closedAtMs: 10000, durationMs: 0 }),
        100000,
      ),
    ).toEqual({ leftPercent: 50, widthPercent: 2 });
  });

  test("an unknown opening offset or an unusable session duration has no geometry", () => {
    expect(
      computeReplayTabSpan(summary({ openedAtMs: null }), 100000),
    ).toBeNull();
    expect(computeReplayTabSpan(summary({ openedAtMs: 0 }), 0)).toBeNull();
    expect(computeReplayTabSpan(summary({ openedAtMs: 0 }), -1)).toBeNull();
    expect(computeReplayTabSpan(summary({ openedAtMs: 0 }), NaN)).toBeNull();
    expect(
      computeReplayTabSpan(
        summary({ openedAtMs: NaN as unknown as number }),
        100000,
      ),
    ).toBeNull();
  });

  test("works straight off a summarized manifest", () => {
    const tabs: Array<ReplayTabSummary> = summarize(
      manifestResponse(),
      "tab-checkout",
    );

    expect(computeReplayTabSpan(tabs[0] as ReplayTabSummary, 200000)).toEqual({
      leftPercent: 0,
      widthPercent: 20,
    });
    expect(computeReplayTabSpan(tabs[1] as ReplayTabSummary, 200000)).toEqual({
      leftPercent: 30,
      widthPercent: 16,
    });
    /* The tab that never flushed has no place on the clock. */
    expect(
      computeReplayTabSpan(tabs[2] as ReplayTabSummary, 200000),
    ).toBeNull();
  });
});

/*
 * The pill copy ReplayHeader has always exported, now next to the model it
 * describes. Behaviour is unchanged: sub-second openings say nothing, a
 * compact strip leaves the opening to the tooltip.
 */
describe("describeReplayTabOpened and formatReplayTabLabel", () => {
  test("describes an opening only when it is a meaningful way in", () => {
    expect(describeReplayTabOpened(summary({ openedAtMs: 134000 }))).toBe(
      "opened 2:14",
    );
    expect(describeReplayTabOpened(summary({ openedAtMs: 999 }))).toBeNull();
    expect(describeReplayTabOpened(summary({ openedAtMs: 0 }))).toBeNull();
    expect(describeReplayTabOpened(summary({ openedAtMs: null }))).toBeNull();
    expect(
      describeReplayTabOpened(
        summary({ openedAtMs: 134000, hasFootage: false }),
      ),
    ).toBeNull();
  });

  test("labels a pill with its duration, and the opening when there is room", () => {
    expect(
      formatReplayTabLabel(
        summary({ label: "Tab 2", durationMs: 30000, openedAtMs: 134000 }),
      ),
    ).toBe("Tab 2 · 30s · (opened 2:14)");
    expect(
      formatReplayTabLabel(
        summary({ label: "Tab 2", durationMs: 30000, openedAtMs: 134000 }),
        { isCompact: true },
      ),
    ).toBe("Tab 2 · 30s");
    expect(
      formatReplayTabLabel(summary({ label: "Tab 1", durationMs: 30000 })),
    ).toBe("Tab 1 · 30s");
    expect(
      formatReplayTabLabel(summary({ label: "Tab 3", hasFootage: false })),
    ).toBe("Tab 3 · no footage");
  });
});
