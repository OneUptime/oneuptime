import React, {
  ForwardedRef,
  ReactElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  buildReplayFingerprintLinks,
  buildReplayLogsAtMomentRoute,
} from "../../../Utils/ReplayCorrelation";
import { ReplayTimelineEventKind } from "../ReplayTimelineTypes";
import {
  formatReplayOffset,
  formatReplayOffsetPrecise,
} from "../ReplayTimeFormat";
import {
  REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS,
  ReplayBackendSignalsSnapshot,
  ReplayBackendSignalsStore,
  makeIdleBackendSignalsState,
} from "./ReplayBackendSignals";
import {
  computeClockAlignment,
  describeClockAlignment,
  formatAlignmentUncertainty,
  makePendingClockAlignment,
  networkAnchorsFromSignals,
  spanAnchorsFromRows,
} from "./ReplayClockAlignment";
import ReplayRailDetail, { ReplayRailLinks } from "./ReplayRailDetail";
import { ReplayRailEmptyCopy, getRailEmptyCopy } from "./ReplayRailEmptyCopy";
import {
  REPLAY_RAIL_CHIPS,
  ReplayRailChip,
  ReplayRailChipId,
  ReplayRailParsedQuery,
  ReplayRailScope,
  isSignalInTab,
  makePlayheadScope,
  matchesSignal,
  parseRailQuery,
  signalsForTab,
} from "./ReplayRailFilters";
import ReplayRailRow from "./ReplayRailRow";
import {
  REPLAY_RAIL_ROW_HEIGHT_PX,
  REPLAY_RAIL_TABS,
  ReplayRailRowModel,
  ReplayRailTabDefinition,
  ReplayRailTabModel,
  ReplayRailWindow,
  backendKindForTab,
  buildRailTabModels,
  computeRailWindow,
  describeRailCoverage,
  findRowIndexForSignalId,
  groupRepeatedSignals,
  stepRailRow,
  tabsWithTruncatedRecordingRows,
} from "./ReplayRailTabs";
import {
  ReplayBackendSignalKind,
  ReplayBackendSignalsSlot,
  ReplayClockAlignmentState,
  ReplayRailTabId,
  ReplaySignal,
  ReplayTelemetryClock,
} from "./ReplaySignalTypes";
import {
  REPLAY_SIGNAL_SEEK_PRE_ROLL_MS,
  ReplaySignalMatch,
  buildErrorCounterpartIndex,
  findSignalMatch,
  fromExceptionRow,
  fromLogRow,
  getActiveSignalIndex,
  groupSpansIntoTraces,
  mergeSignals,
  pairClientAndServerErrors,
} from "./ReplaySignals";

/*
 * The synced rail beside the stage: one list of everything that happened
 * in the session - what the recording captured and what the backend
 * logged, traced or threw for it - on the session clock, nine tabs, a
 * "now" divider that follows the playhead, and an inline detail per row.
 *
 * Replaces ReplayDevtoolsPanel. rrweb-free: it renders ReplaySignal rows
 * (WP-P4a's adapters) and never touches a chunk. Telemetry is fetched
 * lazily through ReplayBackendSignalsStore on the first open of Logs,
 * Traces or Errors (or immediately once footage has expired, when the
 * rail is the whole product), aligned to the recording's clock through
 * trace anchoring, and refreshed every minute while the session is live.
 *
 * FOLLOW is the devtools pattern: on by default, a wheel or touch inside
 * the list turns it off, a "Resume following" chip (or the m key) turns
 * it back on, and "Jump to now" scrolls once without re-enabling it.
 * Selecting a row never moves the list. The old checkbox scrolled only
 * while playing and never yielded to the viewer (scrubber-devtools-6).
 *
 * SELECTION is explicit and separate from the active row. Clicking a row
 * seeks one second BEFORE it (so the cause is on screen too), which by
 * the plain "last row the playhead passed" rule highlighted the previous
 * row and dimmed the one just clicked (scrubber-devtools-5). The active
 * rule now honours the selected row while the playhead sits in its
 * pre-roll window; see getActiveSignalIndex.
 */

export type ReplayRailScopeMode = "session" | "playhead";

export interface ReplayRailProps {
  /* Recording rows, adapted by fromTimelineEvents; any order. */
  signals: Array<ReplaySignal>;
  /*
   * The backend store for this session (one per session, created by the
   * player). null = no telemetry (no session start known yet).
   */
  backendStore?: ReplayBackendSignalsStore | null | undefined;
  sessionId: string;
  /* header.startTimeUnixMs, the session clock's zero; null before the manifest. */
  startTimeUnixMs: number | null;
  /* The manifest's client-vs-server delta; only labels uncertainty. */
  clockSkewMs?: number | null | undefined;
  /* primaryEntityId -> service name for telemetry rows. */
  serviceNameById?: Record<string, string> | undefined;
  isFinalized: boolean;
  /* Footage expired: telemetry tabs still work, recording tabs say why they are empty. */
  isExpiredFootage: boolean;
  /* The manifest is still loading: skeleton rows instead of empty copy. */
  isLoading?: boolean | undefined;

  currentTimeMs: number;
  isPlaying: boolean;
  selectedSignalId: string | null;
  onSeek: (offsetMs: number) => void;
  onSelectSignal: (signalId: string | null) => void;
  /* Ghost playhead on the timeline while a row is hovered. */
  onHoverSignal?: ((offsetMs: number | null) => void) | undefined;

  /* Controlled view state (mirrored to the URL / prefs by the player). */
  activeTab?: ReplayRailTabId | undefined;
  onTabChange?: ((tabId: ReplayRailTabId) => void) | undefined;
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  follow?: boolean | undefined;
  onFollowChange?: ((follow: boolean) => void) | undefined;
  scope?: ReplayRailScopeMode | undefined;
  onScopeChange?: ((scope: ReplayRailScopeMode) => void) | undefined;

  /* Recording-side extraction caps that were hit, per kind. */
  truncatedKinds?: ReadonlyArray<ReplayTimelineEventKind> | null | undefined;
  /* Coverage: chunks decoded so far vs. the manifest's total. */
  loadedChunkCount?: number | null | undefined;
  totalChunkCount?: number | null | undefined;
  /* header.recorderCapabilities, for the old-recording explanation. */
  recorderCapabilities?: ReadonlyArray<string> | null | undefined;

  /* Override any link builder (tests, or a page without RouteMap context). */
  links?: Partial<ReplayRailLinks> | undefined;
  onShowOnStage?: ((x: number, y: number) => void) | undefined;
  /* "Copy link to this moment" hover action; absent = no button. */
  onCopyLink?: ((signal: ReplaySignal) => void) | undefined;
  /*
   * The adapted telemetry rows and the alignment they were placed with,
   * whenever either changes - the player hands them to the timeline for
   * its markers so both surfaces draw the same rows.
   */
  onTelemetrySignalsChange?:
    | ((
        signals: Array<ReplaySignal>,
        alignment: ReplayClockAlignmentState,
      ) => void)
    | undefined;
  className?: string | undefined;
}

/* What the player drives from the keyboard map. */
export interface ReplayRailHandle {
  /* [ and ]: seek to and select the previous/next row of the current tab. */
  stepSignal: (delta: 1 | -1) => ReplaySignal | null;
  /* j and k: move the selection without seeking. */
  moveSelection: (delta: 1 | -1) => ReplaySignal | null;
  /* Enter: seek to the selected row. */
  seekSelected: () => void;
  /* Escape: clear the selection. */
  clearSelection: () => void;
  /* /: focus the search box. */
  focusSearch: () => void;
  /* Reveal a signal by id (from ?signal=): switch tab if needed, select, seek. */
  revealSignal: (signalId: string) => boolean;
  /*
   * Same, but WITHOUT seeking: ?signal= together with an explicit ?t or
   * ?at means "select this row, at the time the URL already names".
   * Returns false when no row on any tab answers to that id.
   */
  selectSignal: (signalId: string) => boolean;
}

/* Scope windows move in whole seconds so the list does not churn at 30Hz. */
const SCOPE_QUANTUM_MS: number = 1000;

/* A row-click seek that lands within this of its target suppresses follow. */
const ROW_SEEK_SETTLE_MS: number = 1500;

/* The divider is kept this far down the list while following. */
const FOLLOW_ANCHOR_FRACTION: number = 0.4;

/* jsdom and a collapsed panel report no height; assume a sensible one. */
const FALLBACK_LIST_HEIGHT_PX: number = 600;

const SKELETON_ROW_COUNT: number = 8;

const EMPTY_SNAPSHOT: ReplayBackendSignalsSnapshot = {
  slots: makeIdleBackendSignalsState(),
  rows: { log: [], span: [], exception: [] },
};

function noopSubscribe(): () => void {
  return (): void => {
    return;
  };
}

function getEmptySnapshot(): ReplayBackendSignalsSnapshot {
  return EMPTY_SNAPSHOT;
}

function safeRoute(build: () => Route | null): Route | null {
  try {
    return build();
  } catch {
    /* A route that cannot be populated is no link, never a crash in render. */
    return null;
  }
}

/*
 * The default link builders, from RouteMap. Each one is guarded so a
 * missing project context (a test, a page rendered outside the app)
 * yields "no link" rather than an exception out of a row.
 */
function buildDefaultLinks(
  sessionId: string,
  startTimeUnixMs: number | null,
): ReplayRailLinks {
  const traceView: (traceId: string) => Route | null = (
    traceId: string,
  ): Route | null => {
    if (!traceId) {
      return null;
    }

    return safeRoute((): Route | null => {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.TRACE_VIEW] as Route,
        { modelId: traceId },
      );
    });
  };

  return {
    traceView: traceView,
    spanView: (traceId: string, spanId: string): Route | null => {
      const base: Route | null = traceView(traceId);

      if (!base || !spanId) {
        return base;
      }

      return safeRoute((): Route | null => {
        return new Route(base.toString()).addQueryParams({
          spanId: encodeURIComponent(spanId),
        });
      });
    },
    exceptionGroup: (fingerprint: string): Route | null => {
      return safeRoute((): Route | null => {
        return (
          buildReplayFingerprintLinks(
            [fingerprint],
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
            ),
          )[0]?.route || null
        );
      });
    },
    logsAtMoment: (offsetMs: number): Route | null => {
      if (startTimeUnixMs === null) {
        return null;
      }

      return safeRoute((): Route | null => {
        return buildReplayLogsAtMomentRoute({
          sessionId: sessionId,
          momentUnixMs: startTimeUnixMs + Math.max(0, offsetMs),
          logsExplorerRoute: RouteUtil.populateRouteParams(
            RouteMap[PageMap.LOGS] as Route,
          ),
        });
      });
    },
  };
}

/*
 * Controlled-with-fallback state: the player mirrors tab, query, follow
 * and scope to the URL and prefs, but the rail stays usable (and
 * testable) when a caller does not wire a setter.
 */
function useControllable<T>(
  value: T | undefined,
  fallback: T,
  onChange: ((next: T) => void) | undefined,
): [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(fallback);
  const current: T = value === undefined ? internal : value;
  const set: (next: T) => void = useCallback(
    (next: T): void => {
      setInternal(next);
      onChange?.(next);
    },
    [onChange],
  );

  return [current, set];
}

/* The tab a signal lives on when it is not on the current one. */
function homeTabForSignal(signal: ReplaySignal): ReplayRailTabId {
  for (const tab of REPLAY_RAIL_TABS) {
    if (tab.id !== "all" && isSignalInTab(signal, tab.id)) {
      return tab.id;
    }
  }

  return "all";
}

const ReplayRailComponent: React.ForwardRefRenderFunction<
  ReplayRailHandle,
  ReplayRailProps
> = (
  props: ReplayRailProps,
  ref: ForwardedRef<ReplayRailHandle>,
): ReactElement => {
  const [activeTab, setActiveTab] = useControllable<ReplayRailTabId>(
    props.activeTab,
    "all",
    props.onTabChange,
  );
  const [query, setQuery] = useControllable<string>(
    props.query,
    "",
    props.onQueryChange,
  );
  const [follow, setFollow] = useControllable<boolean>(
    props.follow,
    true,
    props.onFollowChange,
  );
  const [scope, setScope] = useControllable<ReplayRailScopeMode>(
    props.scope,
    "session",
    props.onScopeChange,
  );
  const [activeChips, setActiveChips] = useState<Array<ReplayRailChipId>>([]);
  const [isDividerOffscreen, setIsDividerOffscreen] = useState<boolean>(false);
  const [scrollCenterIndex, setScrollCenterIndex] = useState<number>(0);

  const listRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const dividerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const searchRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  /*
   * The tab buttons by id. The tablist uses a roving tabindex (only the
   * selected tab is in the Tab order), so Left/Right/Home/End are the only
   * way a keyboard reaches the other eight tabs and they have to move DOM
   * focus themselves - see handleTabsKeyDown.
   */
  const tabRefs: React.MutableRefObject<
    Map<ReplayRailTabId, HTMLButtonElement>
  > = useRef<Map<ReplayRailTabId, HTMLButtonElement>>(
    new Map<ReplayRailTabId, HTMLButtonElement>(),
  );
  /* Set when a list command moved the selection from the keyboard. */
  const pendingRowFocusRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /* The offset a row click is seeking to; follow stays still for it. */
  const rowSeekTargetRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  /* Programmatic scrolls must not be mistaken for the viewer scrolling. */
  const programmaticScrollRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /* The scope was defaulted to +-30s once for a truncated fetch. */
  const scopeDefaultedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /* The playhead as of the last render, read by effects that must not re-run per tick. */
  const currentTimeRef: React.MutableRefObject<number> = useRef<number>(
    props.currentTimeMs,
  );

  currentTimeRef.current = props.currentTimeMs;

  /* ---- Backend store binding. ---- */

  const store: ReplayBackendSignalsStore | null = props.backendStore || null;
  const subscribe: (listener: () => void) => () => void = useCallback(
    (listener: () => void): (() => void) => {
      return store ? store.subscribe(listener) : noopSubscribe();
    },
    [store],
  );
  const getSnapshot: () => ReplayBackendSignalsSnapshot =
    useCallback((): ReplayBackendSignalsSnapshot => {
      return store ? store.getSnapshot() : getEmptySnapshot();
    }, [store]);
  const snapshot: ReplayBackendSignalsSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const loadBackend: (kind: ReplayBackendSignalKind, force?: boolean) => void =
    useCallback(
      (kind: ReplayBackendSignalKind, force?: boolean): void => {
        if (!store) {
          return;
        }

        void store.load(kind, { force: force === true });
      },
      [store],
    );

  /* First open of a telemetry tab fetches its rows. */
  useEffect(() => {
    const kind: ReplayBackendSignalKind | null = backendKindForTab(activeTab);

    if (kind) {
      loadBackend(kind);
    }
  }, [activeTab, loadBackend]);

  /* Expired footage: the rail IS the product, so load everything now. */
  useEffect(() => {
    if (props.isExpiredFootage && store) {
      void store.loadAll();
    }
  }, [props.isExpiredFootage, store]);

  /* Live sessions: refresh whatever is loaded, once a minute. */
  useEffect(() => {
    if (!store || props.isFinalized) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      void store.refreshIfDue();
    }, REPLAY_BACKEND_SIGNALS_LIVE_REFRESH_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, [store, props.isFinalized]);

  /* ---- Telemetry adapted onto the session clock. ---- */

  const hasTelemetry: boolean =
    snapshot.slots.log.rowCount !== null ||
    snapshot.slots.span.rowCount !== null ||
    snapshot.slots.exception.rowCount !== null;

  const alignment: ReplayClockAlignmentState = useMemo(() => {
    if (props.startTimeUnixMs === null) {
      return makePendingClockAlignment();
    }

    return computeClockAlignment({
      startTimeUnixMs: props.startTimeUnixMs,
      networkAnchors: networkAnchorsFromSignals(props.signals),
      spanAnchors: spanAnchorsFromRows(snapshot.rows.span),
      clockSkewMs: props.clockSkewMs,
      hasTelemetry: hasTelemetry,
    });
  }, [
    props.startTimeUnixMs,
    props.signals,
    snapshot.rows.span,
    props.clockSkewMs,
    hasTelemetry,
  ]);

  const telemetrySignals: Array<ReplaySignal> = useMemo(() => {
    if (props.startTimeUnixMs === null) {
      return [];
    }

    const clock: ReplayTelemetryClock = {
      startTimeUnixMs: props.startTimeUnixMs,
      alignment: alignment,
      serviceNameById: props.serviceNameById,
    };
    const logs: Array<ReplaySignal> = [];
    const exceptions: Array<ReplaySignal> = [];

    for (const row of snapshot.rows.log) {
      const signal: ReplaySignal | null = fromLogRow(row, clock);

      if (signal) {
        logs.push(signal);
      }
    }

    for (const row of snapshot.rows.exception) {
      const signal: ReplaySignal | null = fromExceptionRow(row, clock);

      if (signal) {
        exceptions.push(signal);
      }
    }

    return mergeSignals(
      logs,
      groupSpansIntoTraces(snapshot.rows.span, clock),
      exceptions,
    );
  }, [
    props.startTimeUnixMs,
    alignment,
    props.serviceNameById,
    snapshot.rows.log,
    snapshot.rows.span,
    snapshot.rows.exception,
  ]);

  useEffect(() => {
    /* Fires on data changes only; the callback's identity is the player's concern. */
    props.onTelemetrySignalsChange?.(telemetrySignals, alignment);
  }, [telemetrySignals, alignment]);

  const allSignals: Array<ReplaySignal> = useMemo(() => {
    return mergeSignals(props.signals, telemetrySignals);
  }, [props.signals, telemetrySignals]);

  /* ---- Filtering. ---- */

  const parsedQuery: ReplayRailParsedQuery = useMemo(() => {
    return parseRailQuery(query);
  }, [query]);
  const isQueryActive: boolean =
    parsedQuery.terms.length > 0 || parsedQuery.tokens.length > 0;

  const quantisedTimeMs: number =
    Math.floor(props.currentTimeMs / SCOPE_QUANTUM_MS) * SCOPE_QUANTUM_MS;
  const scopeWindow: ReplayRailScope | null = useMemo(() => {
    return scope === "playhead" ? makePlayheadScope(quantisedTimeMs) : null;
  }, [scope, quantisedTimeMs]);

  const tabChips: ReadonlyArray<ReplayRailChip> = REPLAY_RAIL_CHIPS[activeTab];
  const chipsOnTab: Array<ReplayRailChipId> = useMemo(() => {
    const ids: Set<ReplayRailChipId> = new Set<ReplayRailChipId>(
      tabChips.map((chip: ReplayRailChip): ReplayRailChipId => {
        return chip.id;
      }),
    );

    return activeChips.filter((chipId: ReplayRailChipId): boolean => {
      return ids.has(chipId);
    });
  }, [activeChips, tabChips]);

  const isFiltering: boolean =
    isQueryActive || chipsOnTab.length > 0 || scopeWindow !== null;

  const unfilteredTabCount: number = useMemo(() => {
    return signalsForTab(allSignals, activeTab).length;
  }, [allSignals, activeTab]);

  const tabSignals: Array<ReplaySignal> = useMemo(() => {
    return signalsForTab(allSignals, activeTab, {
      query: parsedQuery,
      chips: chipsOnTab,
      scope: scopeWindow,
    });
  }, [allSignals, activeTab, parsedQuery, chipsOnTab, scopeWindow]);

  const rows: Array<ReplayRailRowModel> = useMemo(() => {
    return groupRepeatedSignals(tabSignals);
  }, [tabSignals]);

  const rowSignals: Array<ReplaySignal> = useMemo(() => {
    return rows.map((row: ReplayRailRowModel): ReplaySignal => {
      return row.signal;
    });
  }, [rows]);

  const selectedIndex: number = useMemo(() => {
    return findRowIndexForSignalId(rows, props.selectedSignalId);
  }, [rows, props.selectedSignalId]);

  const activeIndex: number = useMemo(() => {
    return getActiveSignalIndex(
      rowSignals,
      props.currentTimeMs,
      selectedIndex !== -1 ? rowSignals[selectedIndex]?.id : undefined,
    );
  }, [rowSignals, props.currentTimeMs, selectedIndex]);

  const counterpartIndex: Map<string, string> = useMemo(() => {
    return buildErrorCounterpartIndex(pairClientAndServerErrors(allSignals));
  }, [allSignals]);

  const matchingSignals: Array<ReplaySignal> | null = useMemo(() => {
    if (!isQueryActive) {
      return null;
    }

    return allSignals.filter((signal: ReplaySignal): boolean => {
      return matchesSignal(signal, parsedQuery);
    });
  }, [allSignals, parsedQuery, isQueryActive]);

  const tabModels: Array<ReplayRailTabModel> = useMemo(() => {
    return buildRailTabModels({
      signals: allSignals,
      matchingSignals: matchingSignals,
      slots: store ? snapshot.slots : null,
    });
  }, [allSignals, matchingSignals, store, snapshot.slots]);

  const activeBackendKind: ReplayBackendSignalKind | null =
    backendKindForTab(activeTab);
  const activeSlot: ReplayBackendSignalsSlot | null =
    activeBackendKind && store ? snapshot.slots[activeBackendKind] : null;

  const truncatedTabs: Set<ReplayRailTabId> = useMemo(() => {
    return tabsWithTruncatedRecordingRows(props.truncatedKinds);
  }, [props.truncatedKinds]);

  /* A capped telemetry fetch defaults the scope to +-30s, once. */
  useEffect(() => {
    const anyTruncated: boolean =
      snapshot.slots.log.isTruncated ||
      snapshot.slots.span.isTruncated ||
      snapshot.slots.exception.isTruncated;

    if (anyTruncated && !scopeDefaultedRef.current) {
      scopeDefaultedRef.current = true;
      setScope("playhead");
    }
  }, [snapshot.slots, setScope]);

  const links: ReplayRailLinks = useMemo(() => {
    const defaults: ReplayRailLinks = buildDefaultLinks(
      props.sessionId,
      props.startTimeUnixMs,
    );

    return { ...defaults, ...(props.links || {}) };
  }, [props.sessionId, props.startTimeUnixMs, props.links]);

  /* ---- Actions. ---- */

  /* Every rail seek lands one second early, so the cause is on screen too. */
  const seekToOffset: (offsetMs: number) => void = useCallback(
    (offsetMs: number): void => {
      const target: number = Math.max(
        0,
        offsetMs - REPLAY_SIGNAL_SEEK_PRE_ROLL_MS,
      );

      rowSeekTargetRef.current = target;
      props.onSeek(target);
    },
    [props.onSeek],
  );

  const seekToSignal: (signal: ReplaySignal) => void = useCallback(
    (signal: ReplaySignal): void => {
      seekToOffset(signal.offsetMs);
    },
    [seekToOffset],
  );

  const activateRow: (row: ReplayRailRowModel) => void = useCallback(
    (row: ReplayRailRowModel): void => {
      props.onSelectSignal(row.signal.id);
      seekToSignal(row.signal);
    },
    [props.onSelectSignal, seekToSignal],
  );

  const seekRow: (row: ReplayRailRowModel) => void = useCallback(
    (row: ReplayRailRowModel): void => {
      seekToSignal(row.signal);
    },
    [seekToSignal],
  );

  const hoverRow: (offsetMs: number | null) => void = useCallback(
    (offsetMs: number | null): void => {
      props.onHoverSignal?.(offsetMs);
    },
    [props.onHoverSignal],
  );

  const copyRow: ((row: ReplayRailRowModel) => void) | undefined =
    useMemo(() => {
      if (!props.onCopyLink) {
        return undefined;
      }

      const onCopyLink: (signal: ReplaySignal) => void = props.onCopyLink;

      return (row: ReplayRailRowModel): void => {
        onCopyLink(row.signal);
      };
    }, [props.onCopyLink]);

  /*
   * Select a signal wherever it lives WITHOUT moving the playhead: on
   * this tab, select it; on another, switch there first (the row is
   * selected by id, so it is highlighted as soon as that tab's rows
   * render). This is what ?signal= with an explicit ?t does - the URL's
   * own time wins, and seeking to the row would throw it away.
   */
  const selectSignal: (signalId: string) => boolean = useCallback(
    (signalId: string): boolean => {
      const match: ReplaySignalMatch | null = findSignalMatch(
        allSignals,
        signalId,
      );

      if (!match) {
        return false;
      }

      if (!isSignalInTab(match.signal, activeTab)) {
        setActiveTab(homeTabForSignal(match.signal));
      }

      props.onSelectSignal(match.signal.id);

      return true;
    },
    [allSignals, activeTab, setActiveTab, props.onSelectSignal],
  );

  /*
   * Reveal a signal: select it as above AND seek to the moment the id
   * addresses - which for a span id inside a trace row is that span's
   * start, not the trace's.
   */
  const revealSignal: (signalId: string) => boolean = useCallback(
    (signalId: string): boolean => {
      const match: ReplaySignalMatch | null = findSignalMatch(
        allSignals,
        signalId,
      );

      if (!match) {
        return false;
      }

      if (!isSignalInTab(match.signal, activeTab)) {
        setActiveTab(homeTabForSignal(match.signal));
      }

      props.onSelectSignal(match.signal.id);
      seekToOffset(match.offsetMs);

      return true;
    },
    [allSignals, activeTab, setActiveTab, props.onSelectSignal, seekToOffset],
  );

  const stepSignal: (delta: 1 | -1) => ReplaySignal | null = useCallback(
    (delta: 1 | -1): ReplaySignal | null => {
      const row: ReplayRailRowModel | null = stepRailRow(rows, {
        selectedSignalId: props.selectedSignalId,
        currentTimeMs: props.currentTimeMs,
        delta: delta,
      });

      if (!row) {
        return null;
      }

      activateRow(row);

      return row.signal;
    },
    [rows, props.selectedSignalId, props.currentTimeMs, activateRow],
  );

  const moveSelection: (delta: 1 | -1) => ReplaySignal | null = useCallback(
    (delta: 1 | -1): ReplaySignal | null => {
      const row: ReplayRailRowModel | null = stepRailRow(rows, {
        selectedSignalId: props.selectedSignalId,
        currentTimeMs: props.currentTimeMs,
        delta: delta,
      });

      if (!row) {
        return null;
      }

      props.onSelectSignal(row.signal.id);

      return row.signal;
    },
    [rows, props.selectedSignalId, props.currentTimeMs, props.onSelectSignal],
  );

  const seekSelected: () => void = useCallback((): void => {
    const row: ReplayRailRowModel | undefined =
      selectedIndex !== -1 ? rows[selectedIndex] : undefined;

    if (row) {
      seekToSignal(row.signal);
    }
  }, [rows, selectedIndex, seekToSignal]);

  const clearSelection: () => void = useCallback((): void => {
    props.onSelectSignal(null);
  }, [props.onSelectSignal]);

  const focusSearch: () => void = useCallback((): void => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  const filterLogsByTrace: (traceId: string) => void = useCallback(
    (traceId: string): void => {
      setActiveTab("logs");
      setQuery(`trace:${traceId}`);
    },
    [setActiveTab, setQuery],
  );

  useImperativeHandle(ref, (): ReplayRailHandle => {
    return {
      stepSignal: stepSignal,
      moveSelection: moveSelection,
      seekSelected: seekSelected,
      clearSelection: clearSelection,
      focusSearch: focusSearch,
      revealSignal: revealSignal,
      selectSignal: selectSignal,
    };
  }, [
    stepSignal,
    moveSelection,
    seekSelected,
    clearSelection,
    focusSearch,
    revealSignal,
    selectSignal,
  ]);

  /* ---- Follow. ---- */

  const scrollDividerIntoPlace: () => void = useCallback((): void => {
    const list: HTMLDivElement | null = listRef.current;
    const divider: HTMLDivElement | null = dividerRef.current;

    if (!list || !divider) {
      return;
    }

    const height: number = list.clientHeight || FALLBACK_LIST_HEIGHT_PX;
    const target: number = divider.offsetTop - height * FOLLOW_ANCHOR_FRACTION;

    programmaticScrollRef.current = true;
    list.scrollTop = Math.max(0, target);
    setIsDividerOffscreen(false);
  }, []);

  useEffect(() => {
    if (!follow) {
      return;
    }

    /*
     * A row click seeks to the row's pre-roll; the viewer is already
     * looking at that row, so following would only shove it around.
     */
    if (rowSeekTargetRef.current !== null) {
      const settled: boolean =
        Math.abs(currentTimeRef.current - rowSeekTargetRef.current) <=
        ROW_SEEK_SETTLE_MS;

      rowSeekTargetRef.current = null;

      if (settled) {
        return;
      }
    }

    scrollDividerIntoPlace();
    /*
     * Re-anchor whenever the divider moves (a new active row, a tab or
     * filter change) or follow resumes - not on every tick, which would
     * write scrollTop 30 times a second for nothing.
     */
  }, [follow, activeIndex, activeTab, rows.length, scrollDividerIntoPlace]);

  const stopFollowing: () => void = useCallback((): void => {
    if (follow) {
      setFollow(false);
    }
  }, [follow, setFollow]);

  const handleScroll: () => void = useCallback((): void => {
    const list: HTMLDivElement | null = listRef.current;

    if (!list) {
      return;
    }

    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
    }

    const height: number = list.clientHeight || FALLBACK_LIST_HEIGHT_PX;
    const center: number = Math.floor(
      (list.scrollTop + height / 2) / REPLAY_RAIL_ROW_HEIGHT_PX,
    );

    setScrollCenterIndex(center);

    const divider: HTMLDivElement | null = dividerRef.current;

    if (divider) {
      const top: number = divider.offsetTop;
      const offscreen: boolean =
        top < list.scrollTop || top > list.scrollTop + height;

      setIsDividerOffscreen(offscreen);
    }
  }, []);

  /* ---- Windowing. ---- */

  const rowWindow: ReplayRailWindow = useMemo(() => {
    return computeRailWindow({
      rowCount: rows.length,
      centerIndex: follow ? Math.max(0, activeIndex) : scrollCenterIndex,
      mustIncludeIndexes: [selectedIndex, activeIndex],
    });
  }, [rows.length, follow, activeIndex, scrollCenterIndex, selectedIndex]);

  /*
   * Roving tabindex: exactly ONE row is in the Tab order, so tabbing into
   * the rail lands on the row that matters (the selected one, else the
   * one under the playhead, else the first rendered row) instead of
   * walking hundreds of rows. It must be inside the mounted window or the
   * rail would have no tab stop at all.
   */
  const focusStopIndex: number = useMemo(() => {
    const isMounted: (index: number) => boolean = (index: number): boolean => {
      return index >= rowWindow.startIndex && index < rowWindow.endIndex;
    };

    if (isMounted(selectedIndex)) {
      return selectedIndex;
    }

    if (isMounted(activeIndex)) {
      return activeIndex;
    }

    return rowWindow.startIndex;
  }, [selectedIndex, activeIndex, rowWindow]);

  /*
   * j/k/Arrow move the selection; focus follows it so the row a screen
   * reader reads is the row the viewer is on. Only when focus is already
   * inside the list: a selection driven by the URL or by the player's own
   * shortcuts must never steal focus from wherever the viewer is.
   */
  useEffect(() => {
    if (!pendingRowFocusRef.current) {
      return;
    }

    pendingRowFocusRef.current = false;

    const list: HTMLDivElement | null = listRef.current;

    if (!list || !list.contains(document.activeElement)) {
      return;
    }

    const body: HTMLElement | null = list.querySelector<HTMLElement>(
      "[data-testid='rail-row'][data-selected='true'] [data-rail-row-body='true']",
    );

    body?.focus();
  });

  /* ---- Keyboard on the tab strip (WAI-ARIA tabs pattern). ---- */

  /*
   * Roving tabindex means Tab lands on the selected tab and skips the
   * other eight; the arrows are what a keyboard user navigates with. The
   * handler moves selection AND focus together (automatic activation,
   * which is right here because switching a tab is cheap and reversible),
   * and stops the event so the player's global map never reads it as a
   * seek - ReplayKeyboardMap yields role="tab" arrows for the same reason.
   */
  const handleTabsKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const tabIds: Array<ReplayRailTabId> = tabModels.map(
        (tab: ReplayRailTabModel): ReplayRailTabId => {
          return tab.id;
        },
      );

      if (tabIds.length === 0) {
        return;
      }

      const currentIndex: number = Math.max(0, tabIds.indexOf(activeTab));
      let nextIndex: number | null = null;

      switch (event.key) {
        case "ArrowRight":
          nextIndex = (currentIndex + 1) % tabIds.length;
          break;
        case "ArrowLeft":
          nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = tabIds.length - 1;
          break;
        default:
          return;
      }

      const nextTab: ReplayRailTabId | undefined = tabIds[nextIndex];

      if (!nextTab) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setActiveTab(nextTab);
      /* The button exists across this re-render (keyed by tab id). */
      tabRefs.current.get(nextTab)?.focus();
    },
    [tabModels, activeTab, setActiveTab],
  );

  /* ---- Keyboard inside the list. ---- */

  const handleListKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const target: HTMLElement = event.target as HTMLElement;

      /* Typing in the search box is never a list command. */
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      /*
       * Enter and Space belong to whatever control has focus - the row's
       * own body button, Seek, Copy, the trace link. Consuming them here
       * used to seek the SELECTED row when the viewer meant to activate
       * the focused one.
       */
      const isOnControl: boolean =
        typeof target.closest === "function" &&
        Boolean(target.closest("button, a, [role='button']"));

      if (isOnControl && (event.key === "Enter" || event.key === " ")) {
        return;
      }

      let handled: boolean = true;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          if (moveSelection(1)) {
            pendingRowFocusRef.current = true;
          }
          break;
        case "k":
        case "ArrowUp":
          if (moveSelection(-1)) {
            pendingRowFocusRef.current = true;
          }
          break;
        case "Enter":
          seekSelected();
          break;
        case "Escape":
          clearSelection();
          break;
        case "]":
          stepSignal(1);
          break;
        case "[":
          stepSignal(-1);
          break;
        case "PageDown":
        case "PageUp":
          stopFollowing();
          handled = false;
          break;
        default:
          handled = false;
          break;
      }

      if (handled) {
        event.preventDefault();
        /* The player's keyboard map must not see a key the rail consumed. */
        event.stopPropagation();
      }
    },
    [moveSelection, seekSelected, clearSelection, stepSignal, stopFollowing],
  );

  /* ---- Derived copy. ---- */

  const alignmentNote: string = describeClockAlignment(alignment);
  const uncertaintyLabel: string = formatAlignmentUncertainty(alignment);
  const coverageNote: string | null = describeRailCoverage({
    loadedChunkCount: props.loadedChunkCount,
    totalChunkCount: props.totalChunkCount,
  });

  const emptyCopy: ReplayRailEmptyCopy | null =
    rows.length === 0 && !props.isLoading
      ? getRailEmptyCopy({
          tabId: activeTab,
          isFiltering: isFiltering,
          hadRowsBeforeFilter: unfilteredTabCount > 0,
          slot: activeSlot,
          isExpiredFootage: props.isExpiredFootage,
          recorderCapabilities: props.recorderCapabilities,
          hasLoadedFootage:
            typeof props.loadedChunkCount === "number"
              ? props.loadedChunkCount > 0
              : props.signals.length > 0,
        })
      : null;

  const selectedRow: ReplayRailRowModel | null =
    selectedIndex !== -1 ? rows[selectedIndex] || null : null;

  const railId: string = `replay-rail-${props.sessionId || "session"}`;

  /* ---- Render. ---- */

  const renderTab: (tab: ReplayRailTabModel) => ReactElement = (
    tab: ReplayRailTabModel,
  ): ReactElement => {
    const isSelected: boolean = tab.id === activeTab;
    let badge: ReactElement | null = null;

    if (tab.status === "locked") {
      badge = (
        <Icon
          icon={IconProp.Lock}
          className="ml-1 h-3 w-3 text-gray-400"
          aria-hidden="true"
        />
      );
    } else if (tab.count !== null) {
      const total: string = `${tab.count}${tab.isTruncated ? "+" : ""}`;
      const text: string =
        tab.matchingCount !== null ? `${tab.matchingCount}/${total}` : total;

      badge = (
        <span
          className={`ml-1 rounded-full px-1.5 text-[10px] tabular-nums ${
            isSelected
              ? "bg-indigo-200 text-indigo-900"
              : "bg-gray-100 text-gray-500"
          }`}
          title={
            tab.matchingCount !== null
              ? `${tab.matchingCount} of ${total} match the search`
              : tab.isTruncated
                ? `The first ${tab.count} rows; the fetch was capped`
                : undefined
          }
        >
          {text}
        </span>
      );
    } else if (tab.status === "loading") {
      badge = (
        <span className="ml-1 text-[10px] text-gray-400" aria-label="loading">
          …
        </span>
      );
    }

    return (
      <button
        key={tab.id}
        type="button"
        role="tab"
        ref={(element: HTMLButtonElement | null): void => {
          if (element) {
            tabRefs.current.set(tab.id, element);
          } else {
            tabRefs.current.delete(tab.id);
          }
        }}
        id={`${railId}-tab-${tab.id}`}
        data-testid={`rail-tab-${tab.id}`}
        aria-selected={isSelected}
        aria-controls={`${railId}-list`}
        tabIndex={isSelected ? 0 : -1}
        className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
          isSelected
            ? "bg-indigo-100 text-indigo-800 ring-indigo-200"
            : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
        }`}
        onClick={(): void => {
          setActiveTab(tab.id);
        }}
      >
        {tab.label}
        {badge}
      </button>
    );
  };

  const renderNotices: () => ReactElement | null = (): ReactElement | null => {
    const notices: Array<ReactElement> = [];

    if (truncatedTabs.has(activeTab)) {
      notices.push(
        <div key="truncated" className="text-[11px] text-amber-700">
          Recording rows on this tab stop at the per-kind cap: the footage held
          more than the rail keeps, and the earliest rows were kept.
        </div>,
      );
    }

    if (activeSlot?.isTruncated) {
      notices.push(
        <div key="slot-truncated" className="text-[11px] text-amber-700">
          Only the first {activeSlot.rowCount} rows were fetched; the scope
          defaults to ±30s around the playhead so nothing here reads as the
          whole session.
        </div>,
      );
    }

    if (
      activeTab === "errors" &&
      activeSlot?.status === "locked" &&
      rows.length > 0
    ) {
      notices.push(
        <div key="errors-locked" className="text-[11px] text-gray-500">
          Server exceptions are locked: your role lacks &quot;
          {activeSlot.lockedPermission}&quot;. Client errors from the recording
          are shown.
        </div>,
      );
    }

    /* With rows on screen the failure is a notice; with none, the empty copy carries it. */
    if (
      activeSlot?.status === "error" &&
      activeBackendKind &&
      rows.length > 0
    ) {
      notices.push(
        <div
          key="slot-error"
          className="flex items-center gap-2 text-[11px] text-rose-700"
        >
          <span>{activeSlot.errorMessage}</span>
          <button
            type="button"
            className="rounded border border-rose-200 bg-white px-1.5 py-0.5 font-medium hover:bg-rose-50"
            onClick={(): void => {
              loadBackend(activeBackendKind, true);
            }}
          >
            Retry
          </button>
        </div>,
      );
    }

    if (notices.length === 0) {
      return null;
    }

    return <div className="space-y-1 px-3 pb-1">{notices}</div>;
  };

  const renderEmpty: () => ReactElement | null = (): ReactElement | null => {
    if (props.isLoading && rows.length === 0) {
      return (
        <div className="space-y-1 px-2 py-2" data-testid="rail-skeleton">
          {Array.from({ length: SKELETON_ROW_COUNT }).map(
            (_: unknown, index: number): ReactElement => {
              return (
                <div
                  key={index}
                  className={`h-4 animate-pulse rounded bg-gray-100 ${
                    index % 3 === 0
                      ? "w-3/4"
                      : index % 3 === 1
                        ? "w-1/2"
                        : "w-2/3"
                  }`}
                />
              );
            },
          )}
        </div>
      );
    }

    if (!emptyCopy) {
      return null;
    }

    return (
      <div
        className="px-3 py-4 text-xs"
        data-testid="rail-empty"
        data-tab={activeTab}
      >
        <div className="font-medium text-gray-700">{emptyCopy.title}</div>
        <div className="mt-1 text-gray-500">{emptyCopy.detail}</div>
        {emptyCopy.snippet && (
          <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 font-mono text-[10px] leading-4 text-gray-700">
            {emptyCopy.snippet}
          </pre>
        )}
        {emptyCopy.capabilities && (
          <div className="mt-2 flex flex-wrap gap-1">
            {emptyCopy.capabilities.map((capability: string): ReactElement => {
              return (
                <code
                  key={capability}
                  className="rounded bg-gray-100 px-1 text-[10px] text-gray-600"
                >
                  {capability}
                </code>
              );
            })}
          </div>
        )}
        {activeSlot?.status === "error" && activeBackendKind && (
          <button
            type="button"
            className="mt-2 rounded border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50"
            onClick={(): void => {
              loadBackend(activeBackendKind, true);
            }}
          >
            Retry
          </button>
        )}
        {isFiltering && unfilteredTabCount > 0 && (
          <button
            type="button"
            className="mt-2 rounded border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
            onClick={(): void => {
              setQuery("");
              setActiveChips([]);
              setScope("session");
            }}
          >
            Clear filters
          </button>
        )}
      </div>
    );
  };

  const dividerElement: ReactElement = (
    <div
      ref={dividerRef}
      data-testid="rail-now-divider"
      className="my-0.5 flex items-center gap-2 px-2"
      aria-hidden="true"
    >
      <div className="h-px flex-1 bg-indigo-300" />
      <span className="font-mono text-[10px] tabular-nums text-indigo-600">
        {/* Tenths only while paused: at 1x the decimal would flicker ten times a second. */}
        now{" "}
        {props.isPlaying
          ? formatReplayOffset(props.currentTimeMs)
          : formatReplayOffsetPrecise(props.currentTimeMs)}
      </span>
      <div className="h-px flex-1 bg-indigo-300" />
    </div>
  );

  const renderRows: () => Array<ReactElement> = (): Array<ReactElement> => {
    const elements: Array<ReactElement> = [];

    if (rowWindow.startIndex > 0) {
      elements.push(
        <div
          key="spacer-top"
          style={{
            height: `${rowWindow.startIndex * REPLAY_RAIL_ROW_HEIGHT_PX}px`,
          }}
          aria-hidden="true"
        />,
      );
    }

    /* The divider sits before the first future row; before row 0 when nothing has happened yet. */
    if (activeIndex === -1 && rowWindow.startIndex === 0) {
      elements.push(
        <React.Fragment key="divider">{dividerElement}</React.Fragment>,
      );
    }

    for (
      let index: number = rowWindow.startIndex;
      index < rowWindow.endIndex;
      index++
    ) {
      const row: ReplayRailRowModel | undefined = rows[index];

      if (!row) {
        continue;
      }

      const isSelected: boolean = index === selectedIndex;
      const isActive: boolean = index === activeIndex;
      const counterpartId: string | undefined = counterpartIndex.get(
        row.signal.id,
      );
      const linkRoute: Route | null = row.signal.links.traceId
        ? links.traceView(row.signal.links.traceId)
        : null;

      elements.push(
        <ReplayRailRow
          key={row.signal.id}
          row={row}
          domId={`${railId}-option-${index}`}
          isActive={isActive}
          isSelected={isSelected}
          isFocusStop={index === focusStopIndex}
          isFuture={row.signal.offsetMs > props.currentTimeMs && !isActive}
          uncertaintyLabel={
            row.signal.alignment === "unanchored" ? uncertaintyLabel : null
          }
          counterpartNote={
            counterpartId
              ? row.signal.kind === "client-error"
                ? "also reported server-side"
                : "also seen in the browser"
              : null
          }
          link={linkRoute ? { route: linkRoute, label: "trace" } : null}
          onActivate={activateRow}
          onSeek={seekRow}
          onHover={hoverRow}
          onCopyLink={copyRow}
          detail={
            isSelected ? (
              <ReplayRailDetail
                signal={row.signal}
                signals={allSignals}
                repeat={
                  row.repeatCount > 1
                    ? { count: row.repeatCount, lastOffsetMs: row.lastOffsetMs }
                    : null
                }
                links={links}
                spanSlot={store ? snapshot.slots.span : null}
                onLoadBackend={store ? loadBackend : undefined}
                onSeek={(offsetMs: number): void => {
                  props.onSeek(
                    Math.max(0, offsetMs - REPLAY_SIGNAL_SEEK_PRE_ROLL_MS),
                  );
                }}
                onSelectSignal={revealSignal}
                onShowOnStage={props.onShowOnStage}
                onFilterLogsByTrace={filterLogsByTrace}
                onClose={clearSelection}
                startTimeUnixMs={props.startTimeUnixMs}
              />
            ) : null
          }
        />,
      );

      if (index === activeIndex) {
        elements.push(
          <React.Fragment key="divider">{dividerElement}</React.Fragment>,
        );
      }
    }

    /* The active row is outside the window (never, by construction) or past the end. */
    if (activeIndex >= rowWindow.endIndex) {
      elements.push(
        <React.Fragment key="divider">{dividerElement}</React.Fragment>,
      );
    }

    if (rowWindow.endIndex < rows.length) {
      elements.push(
        <div
          key="spacer-bottom"
          style={{
            height: `${(rows.length - rowWindow.endIndex) * REPLAY_RAIL_ROW_HEIGHT_PX}px`,
          }}
          aria-hidden="true"
        />,
      );
    }

    return elements;
  };

  return (
    <div
      className={`flex h-full min-h-0 flex-col rounded-lg border border-gray-200 bg-white ${
        props.className || ""
      }`}
      data-testid="replay-rail"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
        <div className="min-w-0 text-xs font-semibold text-gray-700">
          Signals
          {alignmentNote && (
            <span
              className="ml-1 font-normal text-gray-400"
              data-testid="rail-alignment-note"
            >
              {alignmentNote}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!follow && (
            <button
              type="button"
              data-testid="rail-resume-follow"
              className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-700"
              title="Keep the now divider in view as playback moves (m)"
              onClick={(): void => {
                setFollow(true);
              }}
            >
              Resume following
            </button>
          )}
          {!follow && isDividerOffscreen && (
            <button
              type="button"
              data-testid="rail-jump-to-now"
              className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50"
              title="Scroll to the playhead once, without following"
              onClick={scrollDividerIntoPlace}
            >
              Jump to now
            </button>
          )}
          {follow && (
            <span
              className="text-[10px] text-gray-400"
              title="The list follows the playhead; scroll to pause it"
            >
              following
            </span>
          )}
        </div>
      </div>

      {coverageNote && (
        <div
          className="px-3 pt-1 text-[10px] text-gray-400"
          data-testid="rail-coverage-note"
        >
          {coverageNote}
        </div>
      )}

      <div
        role="tablist"
        aria-label="Signal tabs"
        data-testid="rail-tablist"
        className="flex flex-wrap items-center gap-1 px-3 pt-2"
        onKeyDown={handleTabsKeyDown}
      >
        {tabModels.map(renderTab)}
      </div>

      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            icon={IconProp.Search}
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            data-testid="rail-search-input"
            placeholder="Filter: text, status:>=400, level:error, trace:…"
            aria-label="Filter signals"
            className="w-full rounded-md border border-gray-200 py-1 pl-7 pr-2 font-mono text-xs text-gray-700 placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>): void => {
              if (event.key === "Escape") {
                if (query) {
                  setQuery("");
                } else {
                  searchRef.current?.blur();
                }

                event.stopPropagation();
              }
            }}
          />
        </div>

        <div
          className="flex shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-gray-200"
          role="group"
          aria-label="Scope"
          data-testid="rail-scope-toggle"
        >
          <button
            type="button"
            aria-pressed={scope === "session"}
            className={`px-2 py-1 text-[11px] ${
              scope === "session"
                ? "bg-gray-100 text-gray-800"
                : "bg-white text-gray-500 hover:bg-gray-50"
            }`}
            onClick={(): void => {
              setScope("session");
            }}
          >
            Whole session
          </button>
          <button
            type="button"
            aria-pressed={scope === "playhead"}
            className={`px-2 py-1 text-[11px] ${
              scope === "playhead"
                ? "bg-gray-100 text-gray-800"
                : "bg-white text-gray-500 hover:bg-gray-50"
            }`}
            title="Only rows within 30 seconds of the playhead"
            onClick={(): void => {
              setScope("playhead");
            }}
          >
            ±30s
          </button>
        </div>
      </div>

      {tabChips.length > 0 && (
        <div
          className="flex flex-wrap gap-1 px-3 pb-2"
          role="group"
          aria-label="Quick filters"
        >
          {tabChips.map((chip: ReplayRailChip): ReactElement => {
            const isOn: boolean = chipsOnTab.includes(chip.id);

            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={isOn}
                data-testid={`rail-chip-${chip.id}`}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                  isOn
                    ? "bg-indigo-50 text-indigo-800 ring-indigo-200"
                    : "bg-white text-gray-500 ring-gray-200 hover:bg-gray-50"
                }`}
                onClick={(): void => {
                  setActiveChips(
                    isOn
                      ? activeChips.filter((id: ReplayRailChipId): boolean => {
                          return id !== chip.id;
                        })
                      : [...activeChips, chip.id],
                  );
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {renderNotices()}

      {/*
       * A list, not a listbox: rows carry their own controls and an
       * expandable detail, which ARIA's "children presentational" rule
       * would have hidden under role="option". Selection lives on the
       * row's body button (aria-expanded) and focus roves with j/k.
       */}
      <div
        ref={listRef}
        id={`${railId}-list`}
        role="list"
        aria-label={`${
          (
            REPLAY_RAIL_TABS.find((tab: ReplayRailTabDefinition): boolean => {
              return tab.id === activeTab;
            }) as ReplayRailTabDefinition
          ).label
        } signals`}
        tabIndex={0}
        data-testid="rail-list"
        className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-300"
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onScroll={handleScroll}
        onKeyDown={handleListKeyDown}
      >
        {rows.length === 0 ? renderEmpty() : renderRows()}
      </div>

      {selectedRow && (
        <div className="sr-only" aria-live="polite">
          Selected {selectedRow.signal.title} at{" "}
          {formatReplayOffsetPrecise(selectedRow.signal.offsetMs)}
        </div>
      )}
    </div>
  );
};

const ReplayRail: React.ForwardRefExoticComponent<
  ReplayRailProps & React.RefAttributes<ReplayRailHandle>
> = forwardRef<ReplayRailHandle, ReplayRailProps>(ReplayRailComponent);

ReplayRail.displayName = "ReplayRail";

export default ReplayRail;
