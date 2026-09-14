import { ReplayTimelineEventKind } from "../ReplayTimelineTypes";
import {
  ReplayBackendSignalKind,
  ReplayBackendSignalsSlot,
  ReplayBackendSignalsState,
  ReplayRailTabId,
  ReplaySignal,
  ReplaySignalKind,
} from "./ReplaySignalTypes";
import { isSignalInTab } from "./ReplayRailFilters";
import { getActiveSignalIndex } from "./ReplaySignals";

/*
 * The rail's pure model: which tabs exist, what each one counts, and the
 * list helpers (grouping, stepping, windowing, coverage copy) that the
 * React rail renders. No DOM, no React, so every rule is testable without
 * mounting anything and the component stays a thin binding.
 *
 * COUNTS ARE NEVER A CLAIMED ZERO. A recording tab counts the rows lifted
 * from the chunks loaded so far - that is a real number, qualified by the
 * coverage note. A telemetry tab (Logs, Traces, and the server half of
 * Errors) has no number until its fetch has completed: "Logs 0" before
 * the request returns would read as "this session logged nothing".
 */

export interface ReplayRailTabDefinition {
  id: ReplayRailTabId;
  label: string;
  /* The backend data set this tab needs, if any. */
  backendKind: ReplayBackendSignalKind | null;
}

export const REPLAY_RAIL_TABS: ReadonlyArray<ReplayRailTabDefinition> = [
  { id: "all", label: "All", backendKind: null },
  { id: "console", label: "Console", backendKind: null },
  { id: "network", label: "Network", backendKind: null },
  { id: "navigation", label: "Nav", backendKind: null },
  { id: "interactions", label: "Interact", backendKind: null },
  { id: "performance", label: "Perf", backendKind: null },
  { id: "errors", label: "Errors", backendKind: "exception" },
  { id: "logs", label: "Logs", backendKind: "log" },
  { id: "traces", label: "Traces", backendKind: "span" },
];

export function getRailTabDefinition(
  tabId: ReplayRailTabId,
): ReplayRailTabDefinition {
  return (
    REPLAY_RAIL_TABS.find((tab: ReplayRailTabDefinition): boolean => {
      return tab.id === tabId;
    }) || (REPLAY_RAIL_TABS[0] as ReplayRailTabDefinition)
  );
}

/* Which backend fetch a tab opens; null for recording-only tabs. */
export function backendKindForTab(
  tabId: ReplayRailTabId,
): ReplayBackendSignalKind | null {
  return getRailTabDefinition(tabId).backendKind;
}

/* ---- Glyphs. One character per kind so the merged stream scans. ---- */

export interface ReplayRailGlyph {
  label: string;
  className: string;
  /* For screen readers: "network request", not "->". */
  description: string;
}

const KIND_GLYPHS: Record<ReplaySignalKind, { label: string; noun: string }> = {
  console: { label: "·", noun: "console" },
  network: { label: "→", noun: "request" },
  navigation: { label: "↗", noun: "navigation" },
  interaction: { label: "○", noun: "click" },
  frustration: { label: "z", noun: "frustration" },
  performance: { label: "ⓒ", noun: "performance" },
  "client-error": { label: "!", noun: "client error" },
  "server-error": { label: "‼", noun: "server exception" },
  log: { label: "=", noun: "log" },
  span: { label: "/", noun: "trace" },
  custom: { label: "*", noun: "custom event" },
  marker: { label: "#", noun: "marker" },
};

export function glyphForSignal(signal: ReplaySignal): ReplayRailGlyph {
  const glyph: { label: string; noun: string } =
    KIND_GLYPHS[signal.kind] || KIND_GLYPHS.marker;

  let className: string = "bg-gray-100 text-gray-500";

  if (signal.severity === "error") {
    className = "bg-rose-100 text-rose-700";
  } else if (signal.severity === "warn") {
    className = "bg-amber-100 text-amber-700";
  } else if (signal.severity === "success") {
    className = "bg-emerald-100 text-emerald-700";
  } else if (signal.kind === "navigation") {
    className = "bg-sky-100 text-sky-700";
  } else if (signal.kind === "span") {
    className = "bg-indigo-100 text-indigo-700";
  }

  return {
    label: glyph.label,
    className: className,
    description: `${glyph.noun}, ${signal.severity}`,
  };
}

/* ---- Tab models (label + count + state) for the tab strip. ---- */

export type ReplayRailTabStatus =
  | "ready"
  | "idle"
  | "loading"
  | "locked"
  | "error";

export interface ReplayRailTabModel {
  id: ReplayRailTabId;
  label: string;
  /* null = not known yet (telemetry not fetched); never a claimed 0. */
  count: number | null;
  /* Rows matching the current query on this tab; null when not filtering. */
  matchingCount: number | null;
  status: ReplayRailTabStatus;
  lockedPermission: string | null;
  errorMessage: string | null;
  isTruncated: boolean;
}

function countInTab(
  signals: Array<ReplaySignal>,
  tabId: ReplayRailTabId,
): number {
  let count: number = 0;

  for (const signal of signals) {
    if (isSignalInTab(signal, tabId)) {
      count++;
    }
  }

  return count;
}

function slotStatus(
  slot: ReplayBackendSignalsSlot | null,
): ReplayRailTabStatus {
  if (!slot) {
    return "idle";
  }

  return slot.status;
}

/*
 * Build the nine tab models. `signals` is the merged list (recording plus
 * whatever telemetry has loaded); `matchingSignals` is the same list after
 * the query, or null when nothing is being searched.
 */
export function buildRailTabModels(args: {
  signals: Array<ReplaySignal>;
  matchingSignals: Array<ReplaySignal> | null;
  slots: ReplayBackendSignalsState | null;
}): Array<ReplayRailTabModel> {
  return REPLAY_RAIL_TABS.map(
    (definition: ReplayRailTabDefinition): ReplayRailTabModel => {
      const slot: ReplayBackendSignalsSlot | null =
        definition.backendKind && args.slots
          ? args.slots[definition.backendKind]
          : null;
      const status: ReplayRailTabStatus = definition.backendKind
        ? slotStatus(slot)
        : "ready";
      const hasRows: boolean = slot ? slot.rowCount !== null : false;
      const loadedCount: number = countInTab(args.signals, definition.id);
      let count: number | null = loadedCount;

      if (definition.backendKind) {
        if (definition.id === "errors") {
          /*
           * Errors merges the recording's client errors with the fetched
           * server exceptions. Before the fetch the client half is real,
           * so show it when there is one - but "Errors 0" before the
           * server half has arrived would be a claim about the backend.
           */
          if (!hasRows && loadedCount === 0) {
            count = null;
          }
        } else if (!hasRows) {
          count = null;
        }
      }

      return {
        id: definition.id,
        label: definition.label,
        count: count,
        matchingCount:
          args.matchingSignals && count !== null
            ? countInTab(args.matchingSignals, definition.id)
            : null,
        status: status,
        lockedPermission: slot?.lockedPermission || null,
        errorMessage: slot?.errorMessage || null,
        isTruncated: slot?.isTruncated === true,
      };
    },
  );
}

/* ---- Truncation notices, per tab. ---- */

const TRUNCATION_TAB_FOR_KIND: Partial<
  Record<ReplayTimelineEventKind, ReplayRailTabId>
> = {
  console: "console",
  network: "network",
  route: "navigation",
  navigation: "navigation",
  error: "errors",
  frustration: "interactions",
  click: "interactions",
  custom: "interactions",
  performance: "performance",
};

/*
 * Which tabs carry a recording-side truncation notice. The loader keeps
 * the earliest rows of a kind up to its cap and drops the rest, so the
 * tab says so rather than presenting a capped list as the whole session.
 */
export function tabsWithTruncatedRecordingRows(
  truncatedKinds: ReadonlyArray<ReplayTimelineEventKind> | null | undefined,
): Set<ReplayRailTabId> {
  const tabs: Set<ReplayRailTabId> = new Set<ReplayRailTabId>();

  for (const kind of truncatedKinds || []) {
    const tabId: ReplayRailTabId | undefined = TRUNCATION_TAB_FOR_KIND[kind];

    if (tabId) {
      tabs.add(tabId);
      tabs.add("all");
    }
  }

  return tabs;
}

/* ---- Coverage: how much of the recording the rows come from. ---- */

/*
 * "Recording rows come from 3 of 24 segments loaded so far" - the number
 * that stops "Network 3" reading as "this session made three requests".
 * Null once every segment is loaded (nothing to qualify) or when the
 * total is unknown (a claim about M we cannot make).
 */
export function describeRailCoverage(args: {
  loadedChunkCount: number | null | undefined;
  totalChunkCount: number | null | undefined;
}): string | null {
  const loaded: number | null =
    typeof args.loadedChunkCount === "number" &&
    Number.isFinite(args.loadedChunkCount)
      ? Math.max(0, Math.floor(args.loadedChunkCount))
      : null;
  const total: number | null =
    typeof args.totalChunkCount === "number" &&
    Number.isFinite(args.totalChunkCount)
      ? Math.max(0, Math.floor(args.totalChunkCount))
      : null;

  if (loaded === null || total === null || total === 0) {
    return null;
  }

  if (loaded >= total) {
    return null;
  }

  const noun: string = total === 1 ? "segment" : "segments";

  return `Recording rows come from ${loaded} of ${total} ${noun} loaded so far; they fill in as footage loads`;
}

/* ---- Grouping of repeated rows. ---- */

export interface ReplayRailRowModel {
  /* The first signal of the group; the row's id, offset and detail. */
  signal: ReplaySignal;
  /* 1 for a plain row; N for N consecutive identical rows collapsed. */
  repeatCount: number;
  /* Offset of the last member, for "repeated 12 times until 0:48". */
  lastOffsetMs: number;
  /* Every member's id, so ?signal= to a collapsed member still lands. */
  memberIds: Array<string>;
}

/* Kinds a page can emit in a loop; requests and clicks stay distinct. */
const GROUPABLE_KINDS: ReadonlySet<ReplaySignalKind> =
  new Set<ReplaySignalKind>(["console", "log", "client-error"]);

function isSameRepeat(a: ReplaySignal, b: ReplaySignal): boolean {
  return (
    a.kind === b.kind &&
    a.severity === b.severity &&
    a.title === b.title &&
    a.source === b.source
  );
}

/*
 * Collapse CONSECUTIVE identical console/log/error rows into one row with
 * a repeat count (a warning logged in a render loop would otherwise fill
 * the rail with hundreds of the same line). Only consecutive rows merge,
 * so "A B A" stays three rows and the order of events is never rewritten.
 */
export function groupRepeatedSignals(
  signals: Array<ReplaySignal>,
): Array<ReplayRailRowModel> {
  const rows: Array<ReplayRailRowModel> = [];

  for (const signal of signals) {
    const previous: ReplayRailRowModel | undefined = rows[rows.length - 1];

    if (
      previous &&
      GROUPABLE_KINDS.has(signal.kind) &&
      isSameRepeat(previous.signal, signal)
    ) {
      previous.repeatCount++;
      previous.lastOffsetMs = signal.offsetMs;
      previous.memberIds.push(signal.id);
      continue;
    }

    rows.push({
      signal: signal,
      repeatCount: 1,
      lastOffsetMs: signal.offsetMs,
      memberIds: [signal.id],
    });
  }

  return rows;
}

/* Row index for a signal id, honouring collapsed members. -1 if absent. */
export function findRowIndexForSignalId(
  rows: Array<ReplayRailRowModel>,
  signalId: string | null | undefined,
): number {
  if (!signalId) {
    return -1;
  }

  for (let i: number = 0; i < rows.length; i++) {
    const row: ReplayRailRowModel | undefined = rows[i];

    if (row && row.memberIds.includes(signalId)) {
      return i;
    }
  }

  return -1;
}

/* ---- Stepping ([ and ], j and k). ---- */

/*
 * The next (delta +1) or previous (delta -1) row from where the viewer is:
 * the selected row when one is selected in this list, else the row the
 * playhead is on. Before the first row, "next" is the first row and
 * "previous" is nothing. Clamped at both ends rather than wrapping - a
 * wrap from the last error to the first one reads as a bug in a list
 * whose order IS the point.
 */
export function stepRailRow(
  rows: Array<ReplayRailRowModel>,
  args: {
    selectedSignalId: string | null | undefined;
    currentTimeMs: number;
    delta: 1 | -1;
  },
): ReplayRailRowModel | null {
  if (rows.length === 0) {
    return null;
  }

  const selectedIndex: number = findRowIndexForSignalId(
    rows,
    args.selectedSignalId,
  );
  const baseIndex: number =
    selectedIndex !== -1
      ? selectedIndex
      : getActiveSignalIndex(
          rows.map((row: ReplayRailRowModel): ReplaySignal => {
            return row.signal;
          }),
          args.currentTimeMs,
        );

  const targetIndex: number = baseIndex + args.delta;

  if (targetIndex < 0 || targetIndex >= rows.length) {
    return null;
  }

  return rows[targetIndex] || null;
}

/* ---- Windowed rendering. ---- */

/* Lists at or under this size render every row; above it, a slice. */
export const REPLAY_RAIL_WINDOW_THRESHOLD: number = 500;

/* Rows rendered on each side of the window's centre. */
export const REPLAY_RAIL_WINDOW_RADIUS: number = 150;

/* A collapsed row's height; spacers stand in for the rows not rendered. */
export const REPLAY_RAIL_ROW_HEIGHT_PX: number = 28;

export interface ReplayRailWindow {
  startIndex: number;
  /* Exclusive. */
  endIndex: number;
}

/*
 * The slice of rows to mount. Centred on the row the viewer is looking
 * at (the active row while following, the scrolled-to row otherwise) and
 * widened to include any row that must stay mounted (the selected row,
 * whose detail is open). No library: the rows are one line each until
 * expanded, so plain spacers of rowCount * REPLAY_RAIL_ROW_HEIGHT_PX
 * keep the scrollbar honest.
 */
export function computeRailWindow(args: {
  rowCount: number;
  centerIndex: number;
  mustIncludeIndexes?: Array<number> | undefined;
  radius?: number | undefined;
}): ReplayRailWindow {
  const rowCount: number = Math.max(0, Math.floor(args.rowCount));

  if (rowCount <= REPLAY_RAIL_WINDOW_THRESHOLD) {
    return { startIndex: 0, endIndex: rowCount };
  }

  const radius: number =
    typeof args.radius === "number" && args.radius > 0
      ? Math.floor(args.radius)
      : REPLAY_RAIL_WINDOW_RADIUS;
  const center: number = Math.min(
    rowCount - 1,
    Math.max(0, Math.floor(args.centerIndex)),
  );

  let startIndex: number = Math.max(0, center - radius);
  let endIndex: number = Math.min(rowCount, center + radius + 1);

  for (const index of args.mustIncludeIndexes || []) {
    if (!Number.isFinite(index) || index < 0 || index >= rowCount) {
      continue;
    }

    startIndex = Math.min(startIndex, index);
    endIndex = Math.max(endIndex, index + 1);
  }

  return { startIndex: startIndex, endIndex: endIndex };
}
