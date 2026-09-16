import {
  SessionReplayManifestChunk,
  SessionReplayManifestTab,
  tabHasFootage,
} from "./ReplayManifest";
import { formatReplayDuration, formatReplayOffset } from "./ReplayTimeFormat";

/*
 * The browser tabs of one recording, as a pure model.
 *
 * The browser recorder mints a NEW tab id on every page load
 * (SessionId.rotateTabId), so in a multi-page app every navigation is a
 * new "tab" and a ten-minute session can carry a dozen of them. Shown as
 * a wall of pills in opened order, a viewer could not tell which tab was
 * still open or what page each one was. Everything the header's tab
 * switcher needs to answer that - status, page, ordering, grouping, the
 * short strip for a long list, the filter and the span bar - is decided
 * here, so it is testable in a node environment and the component only
 * renders.
 */

/*
 * open     the tab is still recording (the server says it has not sent
 *          its final chunk)
 * closed   the tab sent its final chunk, or the whole session ended
 * unknown  the server did not say (an older server): may still be open
 * empty    no footage stored for the tab; nothing to switch to
 */
export type ReplayTabStatus = "open" | "closed" | "unknown" | "empty";

export interface ReplayTabSummary {
  tabId: string;
  /* "Tab N", in the order the end user opened them. */
  label: string;
  durationMs: number;
  /* Session-clock offset of the tab's first footage; null when unknown. */
  openedAtMs: number | null;
  hasFootage: boolean;
  isActive: boolean;
  /* Everything below is optional so existing ReplayHeaderTab literals stay valid. */
  /* Absent reads as "unknown" (or "empty" without footage); see getReplayTabStatus. */
  status?: ReplayTabStatus | undefined;
  /* Session-clock offset of the tab's last footage (its last chunk's end). */
  closedAtMs?: number | null | undefined;
  /* The first chunk url the tab reported ("" when none did). */
  firstUrl?: string | undefined;
  /* The last chunk url the tab reported ("" when none did). */
  lastUrl?: string | undefined;
  /* Distinct non-empty chunk urls. */
  pageCount?: number | undefined;
  /* Sum of the chunks' errorCount. */
  errorCount?: number | undefined;
  /* Sum of the chunks' rage + dead + error + refresh-rage clicks. */
  frustrationCount?: number | undefined;
}

/*
 * Above this many tabs the strip stops listing every tab: it shows the
 * open ones and the one being watched, and a picker lists the rest.
 * Six pills still fit one row of the compact header at desktop widths.
 */
export const REPLAY_TAB_STRIP_MAX_PILLS: number = 6;

/*
 * Above this many tabs the "(opened 2:14)" part moves off the pill and
 * into its tooltip (see formatReplayTabLabel). Same value ReplayHeader
 * has always exported.
 */
export const REPLAY_TAB_STRIP_COMPACT_THRESHOLD: number = 6;

/* The narrowest span bar, in percent, so a two-second tab is still visible. */
export const REPLAY_TAB_SPAN_MIN_WIDTH_PERCENT: number = 2;

/* Past this many characters a query string is cut, so one tab cannot claim a row. */
export const REPLAY_TAB_PAGE_MAX_SEARCH_LENGTH: number = 40;

export const REPLAY_TAB_UNKNOWN_PAGE: string = "Unknown page";

/*
 * Status of one tab. The session-level facts win over the per-tab flag:
 * a finalized (or ended) session has no open tab whatever a tab row says,
 * and a server that predates the per-tab flag still reports those.
 */
export function resolveReplayTabStatus(args: {
  hasFootage: boolean;
  tabHasRecordingEnded: boolean | null;
  isSessionFinalized: boolean;
  hasSessionRecordingEnded: boolean;
}): ReplayTabStatus {
  if (!args.hasFootage) {
    return "empty";
  }

  if (args.isSessionFinalized || args.hasSessionRecordingEnded) {
    return "closed";
  }

  if (args.tabHasRecordingEnded === true) {
    return "closed";
  }

  if (args.tabHasRecordingEnded === false) {
    return "open";
  }

  return "unknown";
}

/*
 * The status a summary stands for. A summary built without one (an older
 * ReplayHeaderTab literal) is "unknown" - it may be open - unless it has
 * no footage, which is "empty" whatever else is known.
 */
export function getReplayTabStatus(tab: ReplayTabSummary): ReplayTabStatus {
  if (tab.status) {
    return tab.status;
  }

  return tab.hasFootage ? "unknown" : "empty";
}

function sumChunks(
  chunks: Array<SessionReplayManifestChunk>,
  read: (chunk: SessionReplayManifestChunk) => number,
): number {
  let total: number = 0;

  for (const chunk of chunks) {
    const value: number = read(chunk);

    if (Number.isFinite(value) && value > 0) {
      total += value;
    }
  }

  return total;
}

function readChunkUrl(chunk: SessionReplayManifestChunk): string {
  return typeof chunk.url === "string" ? chunk.url.trim() : "";
}

/*
 * Builds summaries in opened order from the parsed manifest. manifest.tabs
 * is already in opened order (parseManifest sorts it), so "Tab N" follows
 * that order - the same labels the stage, the rail and shared links use.
 */
export function summarizeReplayTabs(args: {
  tabs: Array<SessionReplayManifestTab>;
  activeTabId: string | null;
  isSessionFinalized: boolean;
  hasSessionRecordingEnded: boolean;
}): Array<ReplayTabSummary> {
  return args.tabs.map(
    (tab: SessionReplayManifestTab, index: number): ReplayTabSummary => {
      const hasFootage: boolean = tabHasFootage(tab);
      const lastChunk: SessionReplayManifestChunk | undefined =
        tab.chunks[tab.chunks.length - 1];

      /*
       * Chunk urls, not the first and last chunk's: a chunk flushed before
       * the recorder knew its url carries "", and one blank chunk must not
       * make a tab with a known page read "Unknown page".
       */
      const urls: Array<string> = tab.chunks
        .map(readChunkUrl)
        .filter((url: string): boolean => {
          return url.length > 0;
        });

      return {
        tabId: tab.tabId,
        label: `Tab ${index + 1}`,
        durationMs: tab.durationMs,
        openedAtMs: tab.firstChunkStartOffsetMs,
        hasFootage: hasFootage,
        isActive: args.activeTabId !== null && tab.tabId === args.activeTabId,
        status: resolveReplayTabStatus({
          hasFootage: hasFootage,
          /* ?? null, not a plain read: a fixture built before the field existed. */
          tabHasRecordingEnded: tab.hasRecordingEnded ?? null,
          isSessionFinalized: args.isSessionFinalized,
          hasSessionRecordingEnded: args.hasSessionRecordingEnded,
        }),
        closedAtMs: lastChunk ? lastChunk.chunkEndOffsetMs : null,
        firstUrl: urls[0] ?? "",
        lastUrl: urls[urls.length - 1] ?? "",
        pageCount: new Set<string>(urls).size,
        errorCount: sumChunks(
          tab.chunks,
          (chunk: SessionReplayManifestChunk): number => {
            return chunk.errorCount;
          },
        ),
        frustrationCount: sumChunks(
          tab.chunks,
          (chunk: SessionReplayManifestChunk): number => {
            return (
              chunk.rageClickCount +
              chunk.deadClickCount +
              chunk.errorClickCount +
              chunk.refreshRageCount
            );
          },
        ),
      };
    },
  );
}

const STATUS_DISPLAY_RANK: Record<ReplayTabStatus, number> = {
  open: 0,
  unknown: 1,
  closed: 2,
  empty: 3,
};

/*
 * Stable display order: open -> unknown -> closed -> empty, opened order
 * within each status. What a viewer is looking for is usually the tab that
 * is still going; a tab that may be (unknown) comes next; tabs with
 * nothing to show go last. Array.prototype.sort is stable, but the index
 * tie-break keeps that explicit rather than an engine guarantee to recall.
 */
export function orderReplayTabsForDisplay(
  tabs: Array<ReplayTabSummary>,
): Array<ReplayTabSummary> {
  return tabs
    .map(
      (
        tab: ReplayTabSummary,
        index: number,
      ): {
        tab: ReplayTabSummary;
        index: number;
      } => {
        return { tab: tab, index: index };
      },
    )
    .sort(
      (
        a: { tab: ReplayTabSummary; index: number },
        b: { tab: ReplayTabSummary; index: number },
      ): number => {
        const rankDelta: number =
          STATUS_DISPLAY_RANK[getReplayTabStatus(a.tab)] -
          STATUS_DISPLAY_RANK[getReplayTabStatus(b.tab)];

        return rankDelta !== 0 ? rankDelta : a.index - b.index;
      },
    )
    .map(
      (entry: { tab: ReplayTabSummary; index: number }): ReplayTabSummary => {
        return entry.tab;
      },
    );
}

export interface ReplayTabGroup {
  id: "open" | "closed" | "empty" | "all";
  title: string;
  tabs: Array<ReplayTabSummary>;
}

/*
 * The picker's sections. Open/closed headings only mean something while
 * at least one tab is KNOWN to be open: for a finished session every tab
 * is closed, and for an older server every tab is unknown, and a lone
 * "Closed" or "Open" heading over the whole list would say nothing (or
 * the wrong thing). Then the footage tabs form one "all" group titled
 * "Tabs". Tabs without footage always get their own trailing group, since
 * they cannot be selected. Empty groups are never returned; tabs keep
 * display order within each group.
 */
export function groupReplayTabs(
  tabs: Array<ReplayTabSummary>,
): Array<ReplayTabGroup> {
  const ordered: Array<ReplayTabSummary> = orderReplayTabsForDisplay(tabs);
  const withStatus: (
    statuses: Array<ReplayTabStatus>,
  ) => Array<ReplayTabSummary> = (
    statuses: Array<ReplayTabStatus>,
  ): Array<ReplayTabSummary> => {
    return ordered.filter((tab: ReplayTabSummary): boolean => {
      return statuses.includes(getReplayTabStatus(tab));
    });
  };

  const candidates: Array<ReplayTabGroup> = hasOpenReplayTabs(tabs)
    ? [
        { id: "open", title: "Open", tabs: withStatus(["open", "unknown"]) },
        { id: "closed", title: "Closed", tabs: withStatus(["closed"]) },
        { id: "empty", title: "No footage", tabs: withStatus(["empty"]) },
      ]
    : [
        {
          id: "all",
          title: "Tabs",
          tabs: withStatus(["open", "unknown", "closed"]),
        },
        { id: "empty", title: "No footage", tabs: withStatus(["empty"]) },
      ];

  return candidates.filter((group: ReplayTabGroup): boolean => {
    return group.tabs.length > 0;
  });
}

/* Whether at least one tab is known to be still recording. */
export function hasOpenReplayTabs(tabs: Array<ReplayTabSummary>): boolean {
  return tabs.some((tab: ReplayTabSummary): boolean => {
    return getReplayTabStatus(tab) === "open";
  });
}

export interface ReplayTabCounts {
  total: number;
  open: number;
  closed: number;
  unknown: number;
  empty: number;
}

export function countReplayTabs(
  tabs: Array<ReplayTabSummary>,
): ReplayTabCounts {
  const counts: ReplayTabCounts = {
    total: tabs.length,
    open: 0,
    closed: 0,
    unknown: 0,
    empty: 0,
  };

  for (const tab of tabs) {
    counts[getReplayTabStatus(tab)] += 1;
  }

  return counts;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/*
 * "3 tabs · 1 open · 2 closed · 1 without footage" (zero parts omitted).
 * The open part counts the unknown tabs too, so it always matches the
 * picker's "Open · N" heading, which groups them together. When no tab is
 * known to be open (a finished session, or an older server that cannot
 * say) the breakdown would only restate the total, so it is just "3 tabs".
 */
export function describeReplayTabCounts(tabs: Array<ReplayTabSummary>): string {
  const counts: ReplayTabCounts = countReplayTabs(tabs);
  const total: string = pluralize(counts.total, "tab", "tabs");

  if (counts.open === 0) {
    return total;
  }

  const parts: Array<string> = [total, `${counts.open + counts.unknown} open`];

  if (counts.closed > 0) {
    parts.push(`${counts.closed} closed`);
  }

  if (counts.empty > 0) {
    parts.push(`${counts.empty} without footage`);
  }

  return parts.join(" · ");
}

function decodeSafely(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/*
 * The page a tab is on, short enough for a pill: "/checkout?step=2".
 * pathname + search for an http(s) url, the host dropped (every tab of a
 * session is the same site) and the hash dropped (in-page anchors are not
 * a different page). A long query string is cut at 40 characters with
 * "…" so a tracking-parameter soup cannot push the duration off the pill.
 * Anything that is not an http(s) url (a relative path, a native screen
 * name, garbage) is shown as recorded, trimmed; nothing at all is
 * "Unknown page". Never throws: this runs inside render.
 */
export function describeReplayTabPage(url: string | undefined): string {
  const trimmed: string = typeof url === "string" ? url.trim() : "";

  if (trimmed.length === 0) {
    return REPLAY_TAB_UNKNOWN_PAGE;
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return trimmed;
  }

  const pathname: string = decodeSafely(parsed.pathname) || "/";
  const search: string = decodeSafely(parsed.search);
  const shortSearch: string =
    search.length > REPLAY_TAB_PAGE_MAX_SEARCH_LENGTH
      ? `${search.slice(0, REPLAY_TAB_PAGE_MAX_SEARCH_LENGTH)}…`
      : search;

  return `${pathname}${shortSearch}`;
}

/* 3 for "Tab 3"; null for a label that does not end in an ordinal. */
function readTabOrdinal(label: string): number | null {
  const match: RegExpMatchArray | null = label.match(/(\d+)\s*$/);

  return match && match[1] ? Number(match[1]) : null;
}

/*
 * The picker's search. Case-insensitive substring match on the label
 * ("tab 3"), the first and last url; a query of digits (optionally "#3")
 * also matches the tab with that ordinal. A blank query keeps every tab.
 * Input order is kept, so the caller decides whether it filters a display
 * order or the opened order.
 */
export function filterReplayTabs(
  tabs: Array<ReplayTabSummary>,
  query: string,
): Array<ReplayTabSummary> {
  const needle: string = (typeof query === "string" ? query : "")
    .trim()
    .toLowerCase();

  if (needle.length === 0) {
    return [...tabs];
  }

  const ordinalQuery: RegExpMatchArray | null = needle.match(/^#?(\d+)$/);
  const ordinal: number | null =
    ordinalQuery && ordinalQuery[1] ? Number(ordinalQuery[1]) : null;

  return tabs.filter((tab: ReplayTabSummary): boolean => {
    if (ordinal !== null && readTabOrdinal(tab.label) === ordinal) {
      return true;
    }

    const haystacks: Array<string> = [
      tab.label,
      tab.firstUrl ?? "",
      tab.lastUrl ?? "",
    ];

    return haystacks.some((haystack: string): boolean => {
      return haystack.toLowerCase().includes(needle);
    });
  });
}

/*
 * The pills a long strip shows: every open / unknown tab plus the one
 * being watched, in display order, at most `max`. The active tab always
 * survives the cap - a strip that hid the tab on screen would give the
 * viewer no way to see where they are - so when the open tabs alone fill
 * it, the last open pill makes room. With `max` tabs or fewer the strip
 * shows them all (in display order) and no picker is needed.
 */
export function selectVisibleReplayTabs(
  tabs: Array<ReplayTabSummary>,
  max?: number,
): Array<ReplayTabSummary> {
  const limit: number =
    typeof max === "number" && Number.isFinite(max)
      ? Math.max(1, Math.floor(max))
      : REPLAY_TAB_STRIP_MAX_PILLS;

  const ordered: Array<ReplayTabSummary> = orderReplayTabsForDisplay(tabs);

  if (ordered.length <= limit) {
    return ordered;
  }

  const candidates: Array<ReplayTabSummary> = ordered.filter(
    (tab: ReplayTabSummary): boolean => {
      const status: ReplayTabStatus = getReplayTabStatus(tab);

      return tab.isActive || status === "open" || status === "unknown";
    },
  );

  if (candidates.length <= limit) {
    return candidates;
  }

  const active: ReplayTabSummary | undefined = candidates.find(
    (tab: ReplayTabSummary): boolean => {
      return tab.isActive;
    },
  );

  const head: Array<ReplayTabSummary> = candidates.slice(0, limit);

  if (!active || head.includes(active)) {
    return head;
  }

  /* Keep display order: drop the last pill, then put the active one in place. */
  const kept: Array<ReplayTabSummary> = candidates
    .filter((tab: ReplayTabSummary): boolean => {
      return tab !== active;
    })
    .slice(0, limit - 1);

  return candidates.filter((tab: ReplayTabSummary): boolean => {
    return tab === active || kept.includes(tab);
  });
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/*
 * The length the span bars are drawn against.
 *
 * The caller's session length wins when it is usable, but it is worth
 * nothing when it is the length of the tab being WATCHED - the player's
 * clock follows the engine, so "0:41 / 4:12" is this tab's footage, not
 * the session's, and scaling every other tab by it pushes their bars off
 * the end of the track. So the tabs themselves are the floor: the
 * furthest point any of them reaches is, by definition, at least as long
 * as the session they all sit in. 0 when nothing is known, which draws no
 * bars at all rather than wrong ones.
 */
export function resolveReplayTabsSessionDurationMs(
  tabs: Array<ReplayTabSummary>,
  sessionDurationMs?: number | undefined,
): number {
  const given: number =
    typeof sessionDurationMs === "number" &&
    Number.isFinite(sessionDurationMs) &&
    sessionDurationMs > 0
      ? sessionDurationMs
      : 0;

  let furthestMs: number = 0;

  for (const tab of tabs) {
    const openedAtMs: number =
      typeof tab.openedAtMs === "number" && Number.isFinite(tab.openedAtMs)
        ? tab.openedAtMs
        : 0;
    const durationMs: number =
      Number.isFinite(tab.durationMs) && tab.durationMs > 0
        ? tab.durationMs
        : 0;
    const closedAtMs: number =
      typeof tab.closedAtMs === "number" && Number.isFinite(tab.closedAtMs)
        ? tab.closedAtMs
        : openedAtMs + durationMs;

    furthestMs = Math.max(furthestMs, openedAtMs, closedAtMs);
  }

  return Math.max(given, furthestMs);
}

/*
 * Where a tab's footage sits on the session, for the picker's span bar:
 * left = openedAt / session, width = (closedAt - openedAt) / session, in
 * percent. Clamped to [0, 100] and kept inside the track (left + width
 * never exceeds 100); a tab with footage is at least 2% wide so a short
 * tab is still a visible mark. Without closedAtMs the tab's duration
 * gives the end. null when the geometry is unknown: no opening offset, or
 * no usable session duration.
 */
export function computeReplayTabSpan(
  tab: ReplayTabSummary,
  sessionDurationMs: number,
): { leftPercent: number; widthPercent: number } | null {
  if (
    typeof sessionDurationMs !== "number" ||
    !Number.isFinite(sessionDurationMs) ||
    sessionDurationMs <= 0
  ) {
    return null;
  }

  if (typeof tab.openedAtMs !== "number" || !Number.isFinite(tab.openedAtMs)) {
    return null;
  }

  const openedAtMs: number = tab.openedAtMs;
  const durationMs: number =
    Number.isFinite(tab.durationMs) && tab.durationMs > 0 ? tab.durationMs : 0;
  const closedAtMs: number =
    typeof tab.closedAtMs === "number" && Number.isFinite(tab.closedAtMs)
      ? Math.max(openedAtMs, tab.closedAtMs)
      : openedAtMs + durationMs;

  /*
   * Both ends are clamped to the track BEFORE the width is taken, so a
   * tab whose offsets run past the duration it is scaled by (a clock
   * skew, a chunk flushed after the session was sealed) reads as a mark
   * at the end rather than a bar covering half the session. The switcher
   * scales by resolveReplayTabsSessionDurationMs, which already floors
   * the duration by the tabs' own reach, so there the clamp is the last
   * resort behind that floor rather than the usual path.
   */
  const startPercent: number = clampPercent(
    (openedAtMs / sessionDurationMs) * 100,
  );
  const endPercent: number = clampPercent(
    (closedAtMs / sessionDurationMs) * 100,
  );

  let widthPercent: number = Math.max(0, endPercent - startPercent);

  if (tab.hasFootage) {
    widthPercent = Math.max(REPLAY_TAB_SPAN_MIN_WIDTH_PERCENT, widthPercent);
  }

  const leftPercent: number = Math.min(startPercent, 100 - widthPercent);

  return { leftPercent: leftPercent, widthPercent: widthPercent };
}

export interface ReplayTabLabelOptions {
  /* Leave the "(opened ...)" part to the tooltip. */
  isCompact?: boolean | undefined;
}

/*
 * "opened 2:14" when the tab's footage starts a meaningful way into the
 * session; null otherwise. Sub-second offsets are the FIRST tab (or a
 * tab duplicated at load), where "(opened 0:00)" said nothing a viewer
 * could use and cost the width of a whole extra pill.
 */
export function describeReplayTabOpened(tab: ReplayTabSummary): string | null {
  if (!tab.hasFootage || tab.openedAtMs === null || tab.openedAtMs < 1000) {
    return null;
  }

  return `opened ${formatReplayOffset(tab.openedAtMs)}`;
}

/* "Tab 2 · 30s · (opened 2:14)", or "Tab 2 · 30s" in a compact strip. */
export function formatReplayTabLabel(
  tab: ReplayTabSummary,
  options?: ReplayTabLabelOptions,
): string {
  if (!tab.hasFootage) {
    return `${tab.label} · no footage`;
  }

  const parts: Array<string> = [
    tab.label,
    formatReplayDuration(tab.durationMs),
  ];

  const opened: string | null = describeReplayTabOpened(tab);

  if (opened !== null && !options?.isCompact) {
    parts.push(`(${opened})`);
  }

  return parts.join(" · ");
}
