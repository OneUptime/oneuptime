import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import Skeleton from "Common/UI/Components/Skeleton/Skeleton";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ChunkLoader, {
  SessionReplayChunkFetchRequest,
  SessionReplayRecordedEvent,
} from "./ChunkLoader";
import {
  createBrowserReplayEngineDeps,
  createReplayEngine,
} from "./Engine/ReplayEngine";
import {
  ReplayEngine,
  ReplayEngineListener,
  ReplayEngineReplayerEvent,
  ReplayEngineSnapshot,
  ReplayIdleBand,
  ReplayPhase,
  ReplayRecordedSize,
  ReplayerFactory,
  ReplayerLike,
} from "./Engine/ReplayEngineTypes";
import ReplayStage, {
  REPLAY_STAGE_ASPECT_CSS_VAR,
  ReplayStageFit,
  ReplayStageSizing,
  formatReplayStageAspect,
  getReplayStageBoxClassName,
} from "./ReplayStage";
import useReplayClock, { ReplayClockLike } from "./useReplayClock";
import ReplayStageOverlays, {
  ReplayNextUserSession,
  ReplayStageOverlaysProps,
  findIdleBandAt,
} from "./ReplayStageOverlays";
import ReplayHeader, {
  ReplayHeaderFact,
  ReplayHeaderHandle,
  ReplayHeaderProps,
} from "./ReplayHeader";
import { ReplayTabSummary, summarizeReplayTabs } from "./ReplayTabs";
import {
  ReplayAutoContinueDecision,
  ReplayAutoContinueTracker,
  decideReplayAutoContinue,
  describeReplayAutoContinue,
  isReplayPlaybackPhase,
} from "./ReplayAutoContinue";
import {
  REPLAY_FILL_HEIGHT_CSS_VAR,
  useReplayFillHeight,
} from "./ReplayFillHeight";
import ReplayScrubber from "./ReplayScrubber";
import ReplayRail, {
  ReplayRailHandle,
  ReplayRailProps,
} from "./Rail/ReplayRail";
import {
  ReplayBackendSignalsSnapshot,
  ReplayBackendSignalsStore,
  makeIdleBackendSignalsState,
} from "./Rail/ReplayBackendSignals";
import {
  REPLAY_RAIL_TAB_IDS,
  ReplayClockAlignmentState,
  ReplayRailTabId,
  ReplaySignal,
} from "./Rail/ReplaySignalTypes";
import { isSignalInTab } from "./Rail/ReplayRailFilters";
import { fromTimelineEvents, mergeSignals } from "./Rail/ReplaySignals";
import ReplayPinControl from "./ReplayPinControl";
import ReplayCorrelationPanel, {
  ReplayRailCounts,
} from "./ReplayCorrelationPanel";
import {
  FidelityNoticeCopy,
  SealedReasonCopy,
  getFidelityNoticeCopy,
  getFidelityNoticeSeverity,
  getSealedReasonCopy,
} from "./FidelityNoticeCopy";
import {
  REPLAY_URL_PARAM_RAIL,
  REPLAY_URL_PARAM_RAIL_SEARCH,
  REPLAY_URL_PARAM_SIGNAL,
  REPLAY_URL_PARAM_TAB,
  ReplayInitialMoment,
  ReplayPlayerUrlState,
  buildReplayMomentRoute,
  describeReplayAccessReason,
  describeReplayMomentNotice,
  makeEmptyReplayPlayerUrlState,
  resolveReplayInitialMoment,
} from "./ReplayPlayerUrlState";
import {
  ReplayFootageAbsence,
  ReplayManifestFailure,
  SessionReplayManifest,
  SessionReplayManifestChunk,
  SessionReplayManifestTab,
  classifyManifestFailure,
  describeFootageAbsence,
  findTab,
  findTabContinuingAfter,
  isManifestAwaitingFinalization,
  isManifestRecordingLive,
  parseManifest,
  pickInitialTab,
  tabHasFootage,
} from "./ReplayManifest";
import {
  REPLAY_RAIL_MAX_WIDTH_REM,
  REPLAY_RAIL_MIN_WIDTH_REM,
  ReplayViewPrefs,
  cycleReplayStageFit,
  getReplayViewPrefsSnapshot,
  readReplayListUrl,
  replayViewPrefsStore,
  subscribeToReplayViewPrefs,
} from "./ReplayViewPrefs";
import {
  ReplayActivityBucket,
  ReplayTimelineMarker,
  ReplayTrackBand,
  buildActivityHeat,
  buildTimelineMarkers,
  buildTrackBands,
} from "./ReplayTimelineMath";
import { formatReplayOffset } from "./ReplayTimeFormat";
import {
  ReplayAdjacentUserSessions,
  ReplayUserSessionDescription,
  ReplayUserSessionItem,
  ReplayUserSessionsFetchResult,
  ReplayUserSessionsKind,
  ReplayUserSessionsState,
  ReplayUserSessionsWindow,
  buildReplayUserSessionsWindow,
  describeReplayUserSession,
  fetchReplayUserSessions,
  findAdjacentUserSessions,
  mergeReplayUserSessions,
  overlayCurrentReplayUserSession,
  resolveReplayUserSessionsKind,
} from "./ReplayUserSessions";
import {
  getReplayClientLabel,
  getReplayRecorderKindLabel,
  isMobileSessionReplay,
} from "./ReplayRecorderKind";

/*
 * The composition root of the player: manifest transport, the chunk
 * transport, the single lazy rrweb import, the engine's lifetime, the
 * heartbeat, live polling, URL state, preferences - and the assembly of
 * ReplayHeader -> (ReplayStageOverlays(ReplayStage) + ReplayScrubber) +
 * ReplayRail -> ReplayCorrelationPanel.
 *
 * Nothing about WHAT plays lives here any more: that is
 * Engine/ReplayEngine.ts, read through useSyncExternalStore. This file
 * owns the things that need the page - fetch, the URL, storage, the
 * document's fullscreen element - and hands the engine what it needs.
 *
 * THIS IS THE ONLY FILE IN THE DASHBOARD THAT MAY REFERENCE rrweb, and only
 * through the dynamic import below. Common/UI/esbuild-config.js hardcodes
 * minify:false with splitting:true and format esm, so the dynamic import
 * lands the ~450KB Replayer in its own lazily fetched chunk. A single
 * top-level `import { Replayer } from "rrweb"` anywhere would move all of it
 * into the shared chunk downloaded by every user who never opens a replay.
 * SessionReplayRoutes.test.ts and SessionReplayPlayerWiring.test.ts pin it.
 */

const MANIFEST_ROUTE: string = "/telemetry/rum/session-replay/manifest";
const CHUNKS_ROUTE: string = "/telemetry/rum/session-replay/chunks";
const HEARTBEAT_ROUTE: string = "/telemetry/rum/session-replay/heartbeat";

/* Matches the server-side throttle; anything finer is discarded there. */
export const HEARTBEAT_INTERVAL_MS: number = 15 * 1000;

/* How often the watched-time accumulator samples the engine. */
const HEARTBEAT_TICK_MS: number = 1000;

/*
 * Unfinalized sessions re-fetch the manifest this often - live ones, and
 * ended ones until the finalized header lands. The request carries
 * isRefresh + viewId so the server reuses the audit row (WP-S2): ONE
 * audit row per view, however long the viewer follows a live session.
 */
export const LIVE_MANIFEST_POLL_MS: number = 30 * 1000;

/* "Opened at the moment of the log line" stays up this long. */
const SHELL_NOTICE_MS: number = 4000;

type ReplayerConstructor = new (
  events: Array<SessionReplayRecordedEvent>,
  config: Record<string, unknown>,
) => ReplayerLike;

interface RrwebModule {
  Replayer: unknown;
}

export interface SessionReplayPlayerProps {
  rumApplicationId: ObjectID;
  sessionId: string;
  /* ?t / ?at / ?tab / ?rail / ?signal / ?q, parsed by the page. */
  initialUrlState?: ReplayPlayerUrlState | undefined;
  /* Older callers' ?t= in seconds; folded into initialUrlState. */
  initialOffsetSeconds?: number | undefined;
}

/* What the shell renders from before the engine exists. */
function makeIdleSnapshot(tabId: string): ReplayEngineSnapshot {
  return {
    phase: "loading",
    intent: "paused",
    buffer: "empty",
    currentTimeMs: 0,
    durationMs: 0,
    speed: 1,
    skipInactive: false,
    fedRange: null,
    loadedChunkIndexes: [],
    activeTabId: tabId,
    recordedSize: null,
    bufferingSinceMs: null,
    lastGap: null,
    lastIdleSkip: null,
    error: null,
    pendingSeekMs: null,
    generation: 0,
    notice: null,
    idleBands: [],
    feedAheadMs: 30000,
    earliestPlayableMs: null,
  };
}

const EMPTY_BACKEND_SNAPSHOT: ReplayBackendSignalsSnapshot = {
  slots: makeIdleBackendSignalsState(),
  rows: { log: [], span: [], exception: [] },
};

function noopUnsubscribe(): () => void {
  return (): void => {
    return;
  };
}

const NO_SIGNALS: Array<ReplaySignal> = [];
const NO_CHUNKS: Array<SessionReplayManifestChunk> = [];

/* ---- Clocked wrappers. ---- */

/*
 * The playhead reaches each part of the player through one of these, and
 * never through the composition root's snapshot.
 *
 * The root subscribes to the engine's STRUCTURAL channel, so it re-renders
 * only on real transitions. Each wrapper below subscribes to the clock on
 * its own at the coarsest quantum its content can live with, so between
 * two structural changes React re-renders only the wrapper whose
 * quantised time actually moved. That is what keeps the ~30Hz publish
 * from reconciling the header, the rail, the overlays and the transport
 * in the same frame rrweb is casting mutations into.
 *
 * The memo on each wrapper is a backstop, not the mechanism: the props
 * bag it receives is a fresh literal on every root render, so it only
 * ever bails out for a re-render that comes from ABOVE the root. The
 * isolation that matters comes from the root not re-rendering at all
 * between structural changes.
 *
 * Quanta: the rail, the header and the overlays show whole seconds, so
 * 250ms; the transport's readout is finer-grained while seeking, so
 * 100ms; the spoken offset changes once a second. The timeline's needle
 * is the one thing that must move every frame, and ReplayScrubber owns
 * that (it takes the clock source itself and drives the track at 16ms).
 */
export const REPLAY_RAIL_CLOCK_MS: number = 250;
export const REPLAY_HEADER_CLOCK_MS: number = 250;
export const REPLAY_OVERLAYS_CLOCK_MS: number = 250;
export const REPLAY_OFFSET_TEXT_CLOCK_MS: number = 1000;

/*
 * Paused, the rail is allowed the exact playhead: its "now" divider shows
 * tenths of a second when nothing is moving, and there is no frame budget
 * to protect while the picture is still.
 */
const REPLAY_CLOCK_EXACT_MS: number = 1;

/*
 * ---- The two sizing modes. ----
 *
 * "fill": the player has a DEFINITE height and every box between the root
 * and the stage is a flex column that passes the leftover height down, so
 * the picture takes everything the chrome does not. That is what makes the
 * recording big: nothing is measured in JavaScript and subtracted any more
 * (the old reservedBottomHeightPx), the stage simply gets what is left.
 *
 * "flow": today's document flow, for narrow screens - the stage sizes
 * itself from the recorded aspect ratio (capped at 70vh) and the rail
 * stacks under the player.
 *
 * Outside theater both live in ONE class string: the flow rules are
 * unprefixed and the fill rules carry `xl:`, so the mode is chosen by the
 * viewport with no breakpoint check in JavaScript. The root's definite
 * height at xl comes from REPLAY_FILL_HEIGHT_CSS_VAR, which
 * useReplayFillHeight measures (CSS cannot express "to the bottom of the
 * window from wherever I start"). In theater the element IS the viewport,
 * so the same rules apply unprefixed at every width.
 *
 * The strings are literals rather than built from parts: Tailwind's
 * scanner only sees whole class names.
 */
const REPLAY_ROOT_FLOW_CLASS: string =
  "flex min-w-0 flex-col xl:h-[var(--oneuptime-replay-fill-height)] xl:min-h-0";
const REPLAY_ROOT_FILL_CLASS: string =
  "flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 p-3";

const REPLAY_MAIN_ROW_FLOW_CLASS: string =
  "flex min-w-0 flex-col gap-4 xl:min-h-0 xl:flex-1 xl:flex-row xl:items-stretch";
const REPLAY_MAIN_ROW_FILL_CLASS: string =
  "flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:flex-row xl:items-stretch";

const REPLAY_PLAYER_COLUMN_FLOW_CLASS: string =
  "flex min-w-0 flex-1 flex-col xl:min-h-0";
const REPLAY_PLAYER_COLUMN_FILL_CLASS: string =
  "flex min-h-0 min-w-0 flex-1 flex-col";

/*
 * The one player card. Deliberately NOT overflow-hidden: the speed menu,
 * the More menu and the tab picker are drawn beyond its edges.
 */
const REPLAY_CARD_FLOW_CLASS: string =
  "flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm xl:min-h-0 xl:flex-1";
const REPLAY_CARD_FILL_CLASS: string =
  "flex min-h-0 flex-1 flex-col rounded-xl border border-gray-200 bg-white shadow-sm";

/*
 * The rail column. Stacked under the player it is capped so its list -
 * not the page - is what scrolls (ux-02); beside the player the row has a
 * definite height already, so the cap comes off and the column stretches
 * to the stage's height instead of to an approximation of the viewport.
 */
const REPLAY_RAIL_COLUMN_CLASS: string =
  "relative flex min-h-0 max-h-[32rem] w-full shrink-0 xl:max-h-none xl:max-w-[40%]";

/* Matches REPLAY_RAIL_DEFAULT_WIDTH_REM; the variable is set by the row. */
const REPLAY_RAIL_COLUMN_WIDTH_CLASS: string =
  "xl:w-[var(--oneuptime-replay-rail-width,26rem)]";

interface ReplayRailClockedProps {
  clock: ReplayClockLike | null;
  quantumMs: number;
  railRef: React.RefObject<ReplayRailHandle>;
  railProps: Omit<ReplayRailProps, "currentTimeMs">;
}

const ReplayRailClockedComponent: FunctionComponent<ReplayRailClockedProps> = (
  props: ReplayRailClockedProps,
): ReactElement => {
  const currentTimeMs: number = useReplayClock(props.clock, props.quantumMs);

  return (
    <ReplayRail
      ref={props.railRef}
      {...props.railProps}
      currentTimeMs={currentTimeMs}
    />
  );
};

const ReplayRailClocked: React.NamedExoticComponent<ReplayRailClockedProps> =
  memo(ReplayRailClockedComponent);

interface ReplayHeaderClockedProps {
  clock: ReplayClockLike | null;
  quantumMs: number;
  headerRef: React.RefObject<ReplayHeaderHandle>;
  headerProps: Omit<ReplayHeaderProps, "currentTimeMs">;
}

const ReplayHeaderClockedComponent: FunctionComponent<
  ReplayHeaderClockedProps
> = (props: ReplayHeaderClockedProps): ReactElement => {
  const currentTimeMs: number = useReplayClock(props.clock, props.quantumMs);

  return (
    <ReplayHeader
      ref={props.headerRef}
      {...props.headerProps}
      currentTimeMs={currentTimeMs}
    />
  );
};

const ReplayHeaderClocked: React.NamedExoticComponent<ReplayHeaderClockedProps> =
  memo(ReplayHeaderClockedComponent);

interface ReplayStageOverlaysClockedProps {
  clock: ReplayClockLike | null;
  quantumMs: number;
  overlayProps: ReplayStageOverlaysProps;
}

/*
 * The overlays read the playhead off the snapshot they are given (the URL
 * bar, the idle-band prompt), so the wrapper hands them a snapshot with
 * the live time merged in rather than a separate prop. The merge is
 * memoised, so the object identity changes only when one of the two
 * actually moved.
 */
const ReplayStageOverlaysClockedComponent: FunctionComponent<
  ReplayStageOverlaysClockedProps
> = (props: ReplayStageOverlaysClockedProps): ReactElement => {
  const currentTimeMs: number = useReplayClock(props.clock, props.quantumMs);
  const { overlayProps } = props;

  const snapshot: ReplayEngineSnapshot = useMemo(() => {
    return { ...overlayProps.snapshot, currentTimeMs: currentTimeMs };
  }, [overlayProps.snapshot, currentTimeMs]);

  return <ReplayStageOverlays {...overlayProps} snapshot={snapshot} />;
};

const ReplayStageOverlaysClocked: React.NamedExoticComponent<ReplayStageOverlaysClockedProps> =
  memo(ReplayStageOverlaysClockedComponent);

interface ReplayOffsetTextProps {
  clock: ReplayClockLike | null;
}

/* The playhead as text for assistive tech, at a calm cadence. */
const ReplayOffsetTextComponent: FunctionComponent<ReplayOffsetTextProps> = (
  props: ReplayOffsetTextProps,
): ReactElement => {
  const currentTimeMs: number = useReplayClock(
    props.clock,
    REPLAY_OFFSET_TEXT_CLOCK_MS,
  );

  return (
    <span className="sr-only" aria-live="off" data-testid="replay-offset-text">
      {formatReplayOffset(currentTimeMs)}
    </span>
  );
};

const ReplayOffsetText: React.NamedExoticComponent<ReplayOffsetTextProps> =
  memo(ReplayOffsetTextComponent);

/*
 * The rail tab a row lives on. "all" shows everything, so a signal that
 * is already visible on the open tab never forces a switch; otherwise the
 * first kind-specific tab that claims it wins - the same rule ReplayRail
 * applies internally when it reveals a row.
 */
function homeRailTabForSignal(signal: ReplaySignal): ReplayRailTabId {
  for (const tabId of REPLAY_RAIL_TAB_IDS) {
    if (tabId !== "all" && isSignalInTab(signal, tabId)) {
      return tabId;
    }
  }

  return "all";
}

/* ---- Transport. ---- */

async function fetchManifest(args: {
  rumApplicationId: string;
  sessionId: string;
  refresh?: { viewId: string } | undefined;
  /* Why this playback was opened; written to the audit row. */
  accessReason?: string | null | undefined;
}): Promise<SessionReplayManifest> {
  /*
   * The manifest request is also the audit event - the server writes a
   * RumSessionReplayView row for it. That is why the payload endpoint is
   * never called first: the record of who watched must exist before a
   * single recorded byte is served. A refresh names the existing view so
   * no second row is written.
   */
  const body: JSONObject = {
    rumApplicationId: args.rumApplicationId,
    sessionId: args.sessionId,
  };

  if (args.refresh) {
    body["isRefresh"] = true;
    body["viewId"] = args.refresh.viewId;
  } else if (args.accessReason) {
    /*
     * ux-12 / integration-004: the audit page exists to answer "why did
     * this person watch this customer's session", and it read "None
     * given" on every row because nothing ever sent a reason. A refresh
     * writes no row, so the reason travels only with the first request.
     */
    body["accessReason"] = args.accessReason;
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(MANIFEST_ROUTE),
      data: body,
      headers: {
        ...ModelAPI.getCommonHeaders(),
      },
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseManifest(response.data);
}

/*
 * Watch-time heartbeat. fetch with keepalive rather than the shared API
 * util so the final flush on pagehide / unmount survives the page going
 * away; the same headers the chunk transport sends. Fire-and-forget: a
 * failed heartbeat must never interrupt playback.
 */
function postHeartbeat(
  viewId: string,
  secondsWatched: number,
  keepalive: boolean,
): void {
  try {
    const headers: Dictionary<string> = {
      ...ModelAPI.getCommonHeaders(),
      "Content-Type": "application/json",
    };

    void fetch(
      URL.fromString(APP_API_URL.toString())
        .addRoute(HEARTBEAT_ROUTE)
        .toString(),
      {
        method: "POST",
        headers: headers,
        credentials: "same-origin",
        keepalive: keepalive,
        body: JSON.stringify({
          viewId: viewId,
          secondsWatched: secondsWatched,
        }),
      },
    ).catch((): void => {
      /* Deliberately ignored - see above. */
    });
  } catch {
    /* A throwing fetch (no window, blocked) is not worth a render. */
  }
}

/* ---- Component. ---- */

const SessionReplayPlayer: FunctionComponent<SessionReplayPlayerProps> = (
  props: SessionReplayPlayerProps,
): ReactElement => {
  /*
   * Navigation.getLastParamAsObjectID mints a NEW ObjectID on every call, so
   * props.rumApplicationId is a different object each render even though
   * the id never changes. Everything below keys on the string.
   */
  const rumApplicationIdString: string = props.rumApplicationId.toString();
  const { sessionId } = props;

  const urlState: ReplayPlayerUrlState = useMemo((): ReplayPlayerUrlState => {
    if (props.initialUrlState) {
      return props.initialUrlState;
    }

    const legacy: ReplayPlayerUrlState = makeEmptyReplayPlayerUrlState();

    if (
      typeof props.initialOffsetSeconds === "number" &&
      Number.isFinite(props.initialOffsetSeconds) &&
      props.initialOffsetSeconds > 0
    ) {
      legacy.offsetMs = Math.round(props.initialOffsetSeconds * 1000);
    }

    return legacy;
    /* Read once per session: the URL is input on load, then the player writes it. */
  }, [sessionId]);

  const prefs: ReplayViewPrefs = useSyncExternalStore(
    subscribeToReplayViewPrefs,
    getReplayViewPrefsSnapshot,
    getReplayViewPrefsSnapshot,
  );

  const [manifest, setManifest] = useState<SessionReplayManifest | null>(null);
  const [manifestFailure, setManifestFailure] =
    useState<ReplayManifestFailure | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [replayerFactory, setReplayerFactory] =
    useState<ReplayerFactory | null>(null);
  const [engine, setEngine] = useState<ReplayEngine | null>(null);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [scale, setScale] = useState<number>(1);
  const [isTheater, setIsTheater] = useState<boolean>(false);
  const [isTextSelectionEnabled, setIsTextSelectionEnabled] =
    useState<boolean>(false);
  const [isReplayDocumentReady, setIsReplayDocumentReady] =
    useState<boolean>(false);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(
    urlState.signalId,
  );
  const [ghostMs, setGhostMs] = useState<number | null>(null);
  const [telemetrySignals, setTelemetrySignals] =
    useState<Array<ReplaySignal>>(NO_SIGNALS);
  const [railTab, setRailTab] = useState<ReplayRailTabId>(
    urlState.railTab ?? prefs.railTab,
  );
  const [railQuery, setRailQuery] = useState<string>(urlState.railSearch ?? "");
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [backendStore, setBackendStore] =
    useState<ReplayBackendSignalsStore | null>(null);
  /*
   * The other sessions of the person being watched (issue #3705). Starts
   * "idle" with the current id so the header, which only mounts once the
   * manifest is in, never sees a state that names another session.
   */
  const [userSessions, setUserSessions] = useState<ReplayUserSessionsState>({
    status: "idle",
    kind: "none",
    sessions: [],
    currentSessionId: sessionId,
    isTruncated: false,
  });

  const rootRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const railContainerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const railRef: React.RefObject<ReplayRailHandle> =
    useRef<ReplayRailHandle>(null);
  const headerRef: React.RefObject<ReplayHeaderHandle> =
    useRef<ReplayHeaderHandle>(null);
  const engineRef: React.MutableRefObject<ReplayEngine | null> =
    useRef<ReplayEngine | null>(null);
  const loaderRef: React.MutableRefObject<ChunkLoader | null> =
    useRef<ChunkLoader | null>(null);
  /* The loader created the moment the manifest landed, before rrweb arrived. */
  const pendingLoaderRef: React.MutableRefObject<ChunkLoader | null> =
    useRef<ChunkLoader | null>(null);
  const replayerRef: React.MutableRefObject<ReplayerLike | null> =
    useRef<ReplayerLike | null>(null);
  const manifestRef: React.MutableRefObject<SessionReplayManifest | null> =
    useRef<SessionReplayManifest | null>(null);
  const activeTabIdRef: React.MutableRefObject<string> = useRef<string>("");
  const seekTokenRef: React.MutableRefObject<number> = useRef<number>(0);
  const isTextSelectionEnabledRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const pendingTextSelectionActionRef: React.MutableRefObject<
    (() => void) | null
  > = useRef<(() => void) | null>(null);
  const hasRevealedSignalRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  /* Bumped per user-sessions lookup so a superseded response cannot land. */
  const userSessionsGenerationRef: React.MutableRefObject<number> =
    useRef<number>(0);
  /*
   * Which tabs continuous playback has walked into on its own, and how
   * many hops that took. Per mount, and the page keys the player on the
   * session, so opening another recording starts from nothing.
   */
  const autoContinueRef: React.MutableRefObject<ReplayAutoContinueTracker> =
    useRef<ReplayAutoContinueTracker>(new ReplayAutoContinueTracker());
  /*
   * The phase the engine was in before the one being rendered.
   *
   * Auto-continue is a decision about a TRANSITION into "ended" - the tab
   * played out under a viewer who was watching - and the phase alone
   * cannot say that: the shell re-renders many times while the engine is
   * parked at the end (a manifest poll appending rows, the rail's
   * telemetry landing), and it must not also say "ended" about a viewer
   * who paused at 99% or about a tab they came back to by hand.
   */
  const previousPhaseRef: React.MutableRefObject<ReplayPhase | null> =
    useRef<ReplayPhase | null>(null);
  /*
   * Whether the stop the engine is parked at was playback running out
   * rather than the viewer choosing it. Latched on the transition into
   * "ended" so the answer survives until the tab that continues the
   * session is known, which for a live recording is a poll away.
   */
  const didPlayOutRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  engineRef.current = engine;
  manifestRef.current = manifest;
  activeTabIdRef.current = activeTabId;
  isTextSelectionEnabledRef.current = isTextSelectionEnabled;

  /*
   * How the stage gets its height, in one value passed to every box that
   * has to agree about it. In theater the fullscreen element is the
   * viewport, so the fill rules apply at every width; inline, the class
   * strings switch at xl on their own and the mode stays "responsive".
   */
  const stageSizing: ReplayStageSizing = isTheater ? "fill" : "responsive";

  /*
   * The root's height at xl, measured rather than computed in CSS. Null in
   * theater (the fullscreen element already has one) and before the first
   * measurement, in which case the variable is simply not set and the
   * xl:h-[var(...)] rule falls back to auto - the flow layout.
   */
  const fillHeightPx: number | null = useReplayFillHeight(rootRef, !isTheater);

  const fillHeightStyle: React.CSSProperties =
    useMemo((): React.CSSProperties => {
      return (
        fillHeightPx === null
          ? {}
          : { [REPLAY_FILL_HEIGHT_CSS_VAR]: `${fillHeightPx}px` }
      ) as React.CSSProperties;
    }, [fillHeightPx]);

  /* ReplayStage restores its read-only inspection state in a layout effect. */
  useEffect(() => {
    if (isTextSelectionEnabled) {
      return;
    }

    const pendingAction: (() => void) | null =
      pendingTextSelectionActionRef.current;

    if (!pendingAction) {
      return;
    }

    pendingTextSelectionActionRef.current = null;
    pendingAction();
  }, [isTextSelectionEnabled]);

  /* ---- Chunk transport. ---- */

  const fetchChunks: (
    request: SessionReplayChunkFetchRequest,
  ) => Promise<ArrayBuffer> = useCallback(
    async (request: SessionReplayChunkFetchRequest): Promise<ArrayBuffer> => {
      /*
       * fetch rather than the shared API util: the response is
       * application/octet-stream and the axios-based helper deserialises
       * JSON. The loader's abort signal is forwarded so a timeout or a
       * dispose frees the connection, not just the promise.
       */
      const headers: Dictionary<string> = {
        ...ModelAPI.getCommonHeaders(),
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      };

      const init: RequestInit = {
        method: "POST",
        headers: headers,
        credentials: "same-origin",
        body: JSON.stringify({
          rumApplicationId: rumApplicationIdString,
          sessionId: request.sessionId,
          tabId: request.tabId,
          chunkIndexes: request.chunkIndexes,
        }),
      };

      if (request.signal) {
        init.signal = request.signal;
      }

      const response: Response = await fetch(
        URL.fromString(APP_API_URL.toString())
          .addRoute(CHUNKS_ROUTE)
          .toString(),
        init,
      );

      if (!response.ok) {
        throw new Error(
          `Could not load recording data (HTTP ${response.status}).`,
        );
      }

      return await response.arrayBuffer();
    },
    [rumApplicationIdString],
  );

  const createLoader: (tab: SessionReplayManifestTab) => ChunkLoader =
    useCallback(
      (tab: SessionReplayManifestTab): ChunkLoader => {
        /*
         * One loader per tab, and only one tab plays at a time. chunkIndex
         * is minted per tab and rrweb node ids are per document, so two tabs
         * are two independent recordings that merely share a sessionId.
         */
        return new ChunkLoader({
          sessionId: sessionId,
          tabId: tab.tabId,
          entries: tab.chunks,
          fetcher: fetchChunks,
        });
      },
      [sessionId, fetchChunks],
    );

  /* ---- Manifest + rrweb, in parallel. ---- */

  useEffect(() => {
    let isCancelled: boolean = false;

    setManifest(null);
    setManifestFailure(null);
    setEngine(null);
    setReplayerFactory(null);
    setActiveTabId("");
    setTelemetrySignals(NO_SIGNALS);
    pendingTextSelectionActionRef.current = null;
    isTextSelectionEnabledRef.current = false;
    setIsTextSelectionEnabled(false);
    setIsReplayDocumentReady(false);
    hasRevealedSignalRef.current = false;

    /*
     * INSTANT FEEL: the rrweb download starts at mount, the manifest is
     * fetched alongside it, and the first chunks go on the wire the moment
     * the manifest resolves - before the Replayer has finished arriving.
     */
    /*
     * React Native view-tree recordings deliberately use this same player:
     * that recorder serializes its native tree as rrweb-compatible synthetic
     * snapshot and mutation events. recorderKind changes the explanation in
     * the shell, not the playback engine.
     */
    const rrwebModulePromise: Promise<RrwebModule> =
      (async (): Promise<RrwebModule> => {
        return (await import("rrweb")) as unknown as RrwebModule;
      })();

    const manifestPromise: Promise<SessionReplayManifest> = fetchManifest({
      rumApplicationId: rumApplicationIdString,
      sessionId: sessionId,
      accessReason: describeReplayAccessReason(urlState),
    });

    void (async (): Promise<void> => {
      try {
        const parsed: SessionReplayManifest = await manifestPromise;

        if (isCancelled) {
          return;
        }

        setManifest(parsed);

        const initialTab: SessionReplayManifestTab | null = pickInitialTab(
          parsed,
          urlState.tabId,
        );

        setActiveTabId(initialTab?.tabId ?? parsed.tabs[0]?.tabId ?? "");

        if (initialTab) {
          const loader: ChunkLoader = createLoader(initialTab);
          const moment: ReplayInitialMoment = resolveReplayInitialMoment({
            state: urlState,
            startTimeUnixMs: parsed.startTimeUnixMs,
            durationMs: loader.getDurationMs(),
          });
          const chunkAtMoment: number | null = loader.getChunkIndexForOffset(
            moment.offsetMs,
          );
          const anchor: number | null =
            (chunkAtMoment !== null
              ? loader.getSeekAnchor(chunkAtMoment)
              : null) ?? loader.getFirstPlayableChunkIndex();

          pendingLoaderRef.current = loader;

          if (anchor !== null) {
            void loader.loadFirst(anchor).catch((): void => {
              /* Surfaces through the engine's own LOAD when it runs. */
            });
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setManifestFailure(classifyManifestFailure(err));
        }
      }
    })();

    void (async (): Promise<void> => {
      try {
        const rrweb: RrwebModule = await rrwebModulePromise;

        if (isCancelled) {
          return;
        }

        const ReplayerConstructor: ReplayerConstructor =
          rrweb.Replayer as ReplayerConstructor;

        /*
         * Wrapped in a thunk: useState treats a bare function argument as a
         * lazy initialiser and would call the factory instead of storing it.
         */
        setReplayerFactory((): ReplayerFactory => {
          return (
            events: Array<SessionReplayRecordedEvent>,
            config: Record<string, unknown>,
          ): ReplayerLike => {
            return new ReplayerConstructor(events, config);
          };
        });
      } catch (err) {
        if (!isCancelled) {
          setManifestFailure({
            kind: "error",
            message: `The replay engine could not be downloaded. ${API.getFriendlyMessage(
              err,
            )}`,
            isRetryable: true,
          });
        }
      }
    })();

    return () => {
      isCancelled = true;
      pendingLoaderRef.current?.dispose();
      pendingLoaderRef.current = null;
    };
  }, [rumApplicationIdString, sessionId, reloadToken, createLoader, urlState]);

  /* ---- Engine lifetime: once per session, the moment both halves exist. ---- */

  useEffect(() => {
    if (!manifest || !replayerFactory || engine) {
      return;
    }

    const tab: SessionReplayManifestTab | null = pickInitialTab(
      manifest,
      activeTabIdRef.current || urlState.tabId,
    );

    if (!tab) {
      return;
    }

    const pending: ChunkLoader | null = pendingLoaderRef.current;
    const loader: ChunkLoader =
      pending && pending.getTabId() === tab.tabId ? pending : createLoader(tab);

    pendingLoaderRef.current = null;
    loaderRef.current = loader;

    const created: ReplayEngine = createReplayEngine(
      createBrowserReplayEngineDeps(loader, replayerFactory),
      {
        tabId: tab.tabId,
        headerViewport:
          manifest.details.viewportWidth > 0 &&
          manifest.details.viewportHeight > 0
            ? {
                width: manifest.details.viewportWidth,
                height: manifest.details.viewportHeight,
              }
            : null,
        initialSpeed: prefs.speed,
        initialSkipInactive: prefs.skipIdle,
      },
    );

    const moment: ReplayInitialMoment = resolveReplayInitialMoment({
      state: urlState,
      startTimeUnixMs: manifest.startTimeUnixMs,
      durationMs: loader.getDurationMs(),
    });
    const chunkAtMoment: number | null = loader.getChunkIndexForOffset(
      moment.offsetMs,
    );
    const anchor: number =
      (chunkAtMoment !== null ? loader.getSeekAnchor(chunkAtMoment) : null) ??
      loader.getFirstPlayableChunkIndex() ??
      0;

    created.dispatch({
      type: "LOAD",
      anchorChunkIndex: anchor,
      targetMs: moment.offsetMs,
    });

    /*
     * Start playing as soon as there is something to play. Opening a
     * recording is an unambiguous request to watch it, and by the time the
     * viewer reaches for a control the transport is already proven to be
     * moving. Once per session: the engine keeps the viewer's intent from
     * here on, so a pause is never overridden.
     */
    created.dispatch({ type: "PLAY" });

    if (moment.source === "at" || moment.wasClamped) {
      setShellNotice(
        describeReplayMomentNotice({
          wasClamped: moment.wasClamped,
          signal: urlState.signalId,
        }),
      );
    }

    setActiveTabId(tab.tabId);
    setEngine(created);
  }, [
    manifest,
    replayerFactory,
    engine,
    createLoader,
    urlState,
    prefs.speed,
    prefs.skipIdle,
  ]);

  useEffect(() => {
    if (!engine) {
      return;
    }

    return () => {
      engine.dispose();
      loaderRef.current = null;
      replayerRef.current = null;
    };
  }, [engine]);

  /* Transient shell notices clear themselves. */
  useEffect(() => {
    if (!shellNotice) {
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setShellNotice(null);
    }, SHELL_NOTICE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [shellNotice]);

  /* ---- Snapshot. ---- */

  const idleSnapshot: ReplayEngineSnapshot = useMemo(() => {
    return makeIdleSnapshot(activeTabId);
  }, [activeTabId]);

  /*
   * THE STRUCTURAL CHANNEL, not the whole snapshot.
   *
   * The engine publishes about thirty times a second while playing, and
   * every publish is a new object, so subscribing this component - the
   * composition root of the entire player - to it re-rendered the header,
   * the overlays, the stage, the scrubber, the timeline and the rail on
   * every tick, synchronously, in the frame rrweb was using to cast
   * mutations. The structural snapshot keeps its identity until something
   * other than the playhead changes, so this tree now re-renders on real
   * transitions only (phase, buffer, fed range, bands, errors).
   *
   * The playhead reaches the components that need it through
   * useReplayClock, each at the coarsest quantum it can live with. Nothing
   * below may read snapshot.currentTimeMs to RENDER with: on the
   * structural snapshot it is the playhead as of the last structural
   * change, which is stale by design.
   */
  const subscribeToEngine: (listener: ReplayEngineListener) => () => void =
    useCallback(
      (listener: ReplayEngineListener): (() => void) => {
        if (!engine) {
          return noopUnsubscribe();
        }

        return engine.subscribeStructural
          ? engine.subscribeStructural(listener)
          : engine.subscribe(listener);
      },
      [engine],
    );
  const getEngineSnapshot: () => ReplayEngineSnapshot =
    useCallback((): ReplayEngineSnapshot => {
      if (!engine) {
        return idleSnapshot;
      }

      return engine.getStructuralSnapshot
        ? engine.getStructuralSnapshot()
        : engine.getSnapshot();
    }, [engine, idleSnapshot]);

  const snapshot: ReplayEngineSnapshot = useSyncExternalStore(
    subscribeToEngine,
    getEngineSnapshot,
    getEngineSnapshot,
  );

  /* ---- Mouse trail: applied to every Replayer the engine creates. ---- */

  useEffect(() => {
    if (!engine) {
      return;
    }

    return engine.onReplayer((event: ReplayEngineReplayerEvent): void => {
      if (event.type === "created") {
        replayerRef.current = event.replayer;
        setIsReplayDocumentReady(false);
        isTextSelectionEnabledRef.current = false;
        setIsTextSelectionEnabled(false);

        if (!prefs.mouseTrail) {
          try {
            event.replayer.setConfig({ mouseTail: false });
          } catch {
            /* A config rrweb rejects is cosmetic; playback continues. */
          }
        }
      } else if (event.type === "fullsnapshot-rebuilded") {
        replayerRef.current = event.replayer;

        try {
          const replayDocument: Document | null =
            event.replayer.iframe.contentDocument;
          const isReady: boolean =
            replayDocument !== null &&
            replayDocument.documentElement !== null &&
            replayDocument.body !== null;
          setIsReplayDocumentReady(isReady);

          if (!isReady) {
            isTextSelectionEnabledRef.current = false;
            setIsTextSelectionEnabled(false);
          }
        } catch {
          setIsReplayDocumentReady(false);
          isTextSelectionEnabledRef.current = false;
          setIsTextSelectionEnabled(false);
        }
      } else if (
        event.type === "destroyed" &&
        replayerRef.current === event.replayer
      ) {
        replayerRef.current = null;
        setIsReplayDocumentReady(false);
        isTextSelectionEnabledRef.current = false;
        setIsTextSelectionEnabled(false);
      }
    });
  }, [engine, prefs.mouseTrail]);

  /* ---- Backend signals store: one per session. ---- */

  useEffect(() => {
    if (!manifest || manifest.startTimeUnixMs === null) {
      return;
    }

    const store: ReplayBackendSignalsStore = new ReplayBackendSignalsStore({
      sessionId: manifest.sessionId || sessionId,
      startTimeUnixMs: manifest.startTimeUnixMs,
      endTimeUnixMs: manifest.endTimeUnixMs,
      isFinalized: manifest.isFinalized,
    });

    setBackendStore(store);

    return () => {
      store.dispose();
      setBackendStore(null);
    };
    /* The clock's zero never changes for a session; refreshes update bounds below. */
  }, [sessionId, manifest?.startTimeUnixMs]);

  const subscribeToBackend: (listener: () => void) => () => void = useCallback(
    (listener: () => void): (() => void) => {
      return backendStore
        ? backendStore.subscribe(listener)
        : noopUnsubscribe();
    },
    [backendStore],
  );
  const getBackendSnapshot: () => ReplayBackendSignalsSnapshot =
    useCallback((): ReplayBackendSignalsSnapshot => {
      return backendStore ? backendStore.getSnapshot() : EMPTY_BACKEND_SNAPSHOT;
    }, [backendStore]);
  const backendSnapshot: ReplayBackendSignalsSnapshot = useSyncExternalStore(
    subscribeToBackend,
    getBackendSnapshot,
    getBackendSnapshot,
  );

  /* ---- This user's other sessions: one lookup per session. ---- */

  useEffect(() => {
    /*
     * Keyed on the two identity keys and the session clock rather than
     * on the manifest object: the 30s live poll replaces the manifest
     * every tick, and a lookup that re-ran with it would hit the list
     * route twice a minute for a list that cannot have changed for that
     * reason. The keys change exactly once - when the manifest first
     * lands - and the page remounts the whole player on a new session.
     * The manifest itself is read through the ref, which the render
     * above has already pointed at the value the dependencies describe.
     */
    const current: SessionReplayManifest | null = manifestRef.current;

    if (!current) {
      return;
    }

    const identifiedUserKey: string = current.details.identifiedUserKey;
    const visitorId: string = current.details.visitorId;

    const kind: ReplayUserSessionsKind = resolveReplayUserSessionsKind({
      identifiedUserKey: identifiedUserKey,
      visitorId: visitorId,
    });

    userSessionsGenerationRef.current += 1;

    const generation: number = userSessionsGenerationRef.current;
    let isCancelled: boolean = false;

    if (kind === "none") {
      setUserSessions({
        status: "ready",
        kind: "none",
        sessions: [],
        currentSessionId: sessionId,
        isTruncated: false,
      });

      return;
    }

    setUserSessions({
      status: "loading",
      kind: kind,
      sessions: [],
      currentSessionId: sessionId,
      isTruncated: false,
    });

    /*
     * The session on screen, in the list's shape, so the merge can put it
     * in the list even when the index has not caught up with it (a live
     * session a few seconds old) or the window has passed it.
     */
    const self: ReplayUserSessionItem = {
      sessionId: current.sessionId || sessionId,
      startTimeUnixMs: current.startTimeUnixMs ?? 0,
      durationMs: current.durationMs,
      entryUrl: current.details.entryUrl,
      browserName: current.details.browserName,
      deviceType: current.details.deviceType,
      hasError: current.counts.errorCount > 0,
      errorCount: current.counts.errorCount,
      isFinalized: current.isFinalized,
      hasRecordingEnded: current.hasRecordingEnded,
      identifiedUserKey: identifiedUserKey,
      visitorId: visitorId,
      identifiedUserLabel: current.details.identifiedUserLabel,
    };

    const lookupWindow: ReplayUserSessionsWindow =
      buildReplayUserSessionsWindow(current.startTimeUnixMs, Date.now());

    void (async (): Promise<void> => {
      try {
        /*
         * Two anchored requests per key - older sessions up to this one,
         * newer ones paged back towards it - so the neighbours are the
         * real neighbours for a person with hundreds of sessions, and a
         * flag for when the newer side could not be paged all the way.
         */
        const result: ReplayUserSessionsFetchResult =
          await fetchReplayUserSessions({
            rumApplicationId: rumApplicationIdString,
            sessionId: self.sessionId,
            identifiedUserKey: identifiedUserKey,
            visitorId: visitorId,
            startTime: lookupWindow.startTime,
            anchorTime: lookupWindow.anchorTime,
            endTime: lookupWindow.endTime,
          });
        const lists: Array<Array<ReplayUserSessionItem>> = result.lists;

        if (isCancelled || generation !== userSessionsGenerationRef.current) {
          return;
        }

        setUserSessions({
          status: "ready",
          kind: kind,
          sessions: mergeReplayUserSessions(lists, self),
          currentSessionId: sessionId,
          isTruncated: result.isTruncated,
        });
      } catch {
        if (isCancelled || generation !== userSessionsGenerationRef.current) {
          return;
        }

        /* The header says "couldn't load"; playback is unaffected. */
        setUserSessions({
          status: "error",
          kind: kind,
          sessions: [],
          currentSessionId: sessionId,
          isTruncated: false,
        });
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [
    rumApplicationIdString,
    sessionId,
    manifest?.details.identifiedUserKey,
    manifest?.details.visitorId,
    manifest?.startTimeUnixMs,
  ]);

  /* ---- Unfinalized sessions: re-poll the manifest and append new footage. ---- */

  /*
   * Two questions an unfinalized session answers differently once every
   * one of its tabs has closed:
   *
   * - isAwaitingFinalization: the header is still provisional. The poll
   *   below keeps running on it, because the finalized header (counts,
   *   duration, sealed reason) only arrives through a refresh, a trailing
   *   chunk posted as the tab closed can still land, and each refresh
   *   carries the latest hasRecordingEnded.
   * - isLive: footage may still be recorded. The Live pill, the "caught
   *   up with the live recording" overlay and data-replay-live follow
   *   this one, so a session whose tabs have all closed stops calling
   *   itself Live the moment the server says so - not 10-15 minutes
   *   later, when the idle finalizer got to it.
   */
  const isAwaitingFinalization: boolean =
    manifest !== null && isManifestAwaitingFinalization(manifest);
  const isLive: boolean =
    manifest !== null && isManifestRecordingLive(manifest);
  const viewId: string = manifest?.viewId ?? "";

  useEffect(() => {
    if (!isAwaitingFinalization) {
      return;
    }

    let isCancelled: boolean = false;
    let isInFlight: boolean = false;

    const poll: () => Promise<void> = async (): Promise<void> => {
      if (isInFlight) {
        return;
      }

      isInFlight = true;

      try {
        const refreshed: SessionReplayManifest = await fetchManifest({
          rumApplicationId: rumApplicationIdString,
          sessionId: sessionId,
          refresh: { viewId: viewId },
        });

        if (isCancelled) {
          return;
        }

        /* The server echoes the same viewId; keep ours if it sent none. */
        setManifest((previous: SessionReplayManifest | null) => {
          return {
            ...refreshed,
            viewId: refreshed.viewId || previous?.viewId || "",
          };
        });

        const tab: SessionReplayManifestTab | null = findTab(
          refreshed,
          activeTabIdRef.current,
        );

        if (engineRef.current && tab && tab.chunks.length > 0) {
          engineRef.current.dispatch({
            type: "APPEND_ENTRIES",
            entries: tab.chunks,
          });
        }

        backendStore?.setSessionBounds({
          endTimeUnixMs: refreshed.endTimeUnixMs,
          isFinalized: refreshed.isFinalized,
        });
      } catch {
        /* A missed poll is retried on the next tick; the footage is unchanged. */
      } finally {
        isInFlight = false;
      }
    };

    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      void poll();
    }, LIVE_MANIFEST_POLL_MS);

    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, [
    isAwaitingFinalization,
    viewId,
    rumApplicationIdString,
    sessionId,
    backendStore,
  ]);

  /* ---- Heartbeat: time actually WATCHED, flushed on the way out. ---- */

  useEffect(() => {
    /*
     * The endpoint identifies the audit row by viewId and nothing else, so
     * without one from the manifest response there is no row to advance.
     */
    if (!engine || !viewId) {
      return;
    }

    /*
     * secondsWatched is the time footage actually PLAYED (scaled by speed),
     * accumulated only while the engine phase is "playing". The old shell
     * reported the furthest offset reached, so one drag to the end of the
     * scrubber told the audit the whole session had been watched
     * (player-shell-3); and it never flushed under 15s or on unmount
     * (player-shell-4).
     */
    let watchedMs: number = 0;
    let lastSampleAt: number = performance.now();
    let lastSentSeconds: number = 0;

    const accrue: () => void = (): void => {
      const now: number = performance.now();
      const current: ReplayEngineSnapshot = engine.getSnapshot();

      if (current.phase === "playing") {
        watchedMs += Math.max(0, now - lastSampleAt) * current.speed;
      }

      lastSampleAt = now;
    };

    const send: (keepalive: boolean) => void = (keepalive: boolean): void => {
      accrue();

      const seconds: number = Math.floor(watchedMs / 1000);

      if (seconds <= 0 || seconds === lastSentSeconds) {
        return;
      }

      lastSentSeconds = seconds;
      postHeartbeat(viewId, seconds, keepalive);
    };

    const sampleTimer: ReturnType<typeof setInterval> = setInterval(
      accrue,
      HEARTBEAT_TICK_MS,
    );
    const flushTimer: ReturnType<typeof setInterval> = setInterval((): void => {
      send(false);
    }, HEARTBEAT_INTERVAL_MS);

    const onPageHide: () => void = (): void => {
      send(true);
    };
    const onVisibilityChange: () => void = (): void => {
      if (document.visibilityState === "hidden") {
        send(true);
      }
    };

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(sampleTimer);
      clearInterval(flushTimer);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      send(true);
    };
  }, [engine, viewId]);

  /* ---- Theater: follows the DOCUMENT's fullscreen element. ---- */

  useEffect(() => {
    const onFullscreenChange: () => void = (): void => {
      setIsTheater(
        Boolean(rootRef.current) &&
          document.fullscreenElement === rootRef.current,
      );
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  /* ---- Derived view models. ---- */

  const activeTab: SessionReplayManifestTab | null = useMemo(() => {
    return manifest ? findTab(manifest, activeTabId) : null;
  }, [manifest, activeTabId]);

  const chunks: Array<SessionReplayManifestChunk> =
    activeTab?.chunks ?? NO_CHUNKS;
  const startTimeUnixMs: number | null = manifest?.startTimeUnixMs ?? null;

  /*
   * Recording rows, re-adapted when the fed range grows (that is when a
   * chunk's extraction has definitely happened) or the tab changes.
   */
  const timelineVersion: number =
    loaderRef.current?.getTimelineVersion?.() ?? 0;

  const recordingSignals: Array<ReplaySignal> = useMemo(() => {
    const loader: ChunkLoader | null = loaderRef.current;

    if (!engine || !loader) {
      return NO_SIGNALS;
    }

    return fromTimelineEvents(loader.getTimelineEvents(), {
      startTimeUnixMs: startTimeUnixMs,
    });
    /*
     * timelineVersion, not just the fed range: the loader only advances
     * it when a chunk's rows were actually extracted, so a feed that
     * added no rows re-uses the adapted signals instead of rebuilding
     * every one of them. generation stays a dependency so a tab switch,
     * which hands over a different loader whose version restarts at 0,
     * always re-adapts.
     */
  }, [
    engine,
    snapshot.loadedChunkIndexes,
    snapshot.generation,
    startTimeUnixMs,
    timelineVersion,
  ]);

  const allSignals: Array<ReplaySignal> = useMemo(() => {
    return mergeSignals(recordingSignals, telemetrySignals);
  }, [recordingSignals, telemetrySignals]);

  const bands: Array<ReplayTrackBand> = useMemo(() => {
    return buildTrackBands({
      chunks: chunks,
      gaps: activeTab?.gaps ?? [],
      loadedChunkIndexes: snapshot.loadedChunkIndexes,
      idleBands: snapshot.idleBands ?? [],
      durationMs: snapshot.durationMs,
    });
  }, [
    chunks,
    activeTab,
    snapshot.loadedChunkIndexes,
    snapshot.idleBands,
    snapshot.durationMs,
  ]);

  const activity: Array<ReplayActivityBucket> = useMemo(() => {
    return buildActivityHeat(chunks, snapshot.durationMs);
  }, [chunks, snapshot.durationMs]);

  const markers: Array<ReplayTimelineMarker> = useMemo(() => {
    return buildTimelineMarkers({
      signals: allSignals,
      chunks: chunks,
      loadedChunkIndexes: snapshot.loadedChunkIndexes,
      durationMs: snapshot.durationMs,
    });
  }, [allSignals, chunks, snapshot.loadedChunkIndexes, snapshot.durationMs]);

  /*
   * The tab strip's model: opened order, each tab's page, its span on the
   * session clock and - from the manifest's per-tab hasRecordingEnded -
   * whether it is still open. The recorder mints a new tab id on every
   * page load, so a multi-page visit produces a wall of "tabs"; that is
   * what the switcher's open-first ordering and picker are for.
   */
  const headerTabs: Array<ReplayTabSummary> = useMemo(() => {
    if (!manifest) {
      return [];
    }

    return summarizeReplayTabs({
      tabs: manifest.tabs,
      activeTabId: activeTabId,
      isSessionFinalized: manifest.isFinalized,
      hasSessionRecordingEnded: manifest.hasRecordingEnded,
    });
  }, [manifest, activeTabId]);

  /*
   * The one place the structural snapshot's currentTimeMs is the right
   * value to read: this only answers at phase "ended", and the publish
   * that ended the tab is itself a structural change carrying the final
   * playhead. Nothing moves after it until the viewer acts.
   */
  const continueInTab: ReplayTabSummary | null = useMemo(() => {
    if (!manifest || snapshot.phase !== "ended") {
      return null;
    }

    const next: SessionReplayManifestTab | null = findTabContinuingAfter(
      manifest,
      activeTabId,
      snapshot.currentTimeMs,
    );

    if (!next) {
      return null;
    }

    return (
      headerTabs.find((tab: ReplayTabSummary): boolean => {
        return tab.tabId === next.tabId;
      }) ?? null
    );
  }, [
    manifest,
    snapshot.phase,
    snapshot.currentTimeMs,
    activeTabId,
    headerTabs,
  ]);

  const facts: Array<ReplayHeaderFact> = useMemo(() => {
    if (!manifest) {
      return [];
    }

    const details: SessionReplayManifest["details"] = manifest.details;

    /*
     * Blank values are dropped rather than rendered as an em dash, so a
     * session that lacks a fact does not advertise the field it lacks.
     */
    return [
      {
        label: getReplayClientLabel(details.recorderKind),
        value: [details.browserName, details.browserVersion]
          .filter(Boolean)
          .join(" "),
      },
      { label: "OS", value: details.osName },
      {
        label: "Source",
        value: isMobileSessionReplay(details.recorderKind)
          ? getReplayRecorderKindLabel(details.recorderKind)
          : "",
      },
      { label: "Device", value: details.deviceType },
      { label: "Country", value: details.countryCode },
      {
        label: "Viewport",
        value:
          details.viewportWidth > 0 && details.viewportHeight > 0
            ? `${details.viewportWidth}x${details.viewportHeight}`
            : "",
      },
    ].filter((fact: ReplayHeaderFact): boolean => {
      return Boolean(fact.value);
    });
  }, [manifest]);

  /*
   * The sealed reason is a claim about how the recording ENDED, so it is
   * quoted once the recording has - finalized, or every tab closed. A
   * live session's provisional header can already carry "final-chunk"
   * from a page the user navigated away from, and must not be told it
   * "ended normally" while its next page is still recording.
   */
  const sealedReason: SealedReasonCopy | null = useMemo(() => {
    return manifest && (manifest.isFinalized || manifest.hasRecordingEnded)
      ? getSealedReasonCopy(manifest.sealedReason)
      : null;
  }, [manifest]);

  const absence: ReplayFootageAbsence | null = useMemo(() => {
    return manifest ? describeFootageAbsence(manifest, Date.now()) : null;
  }, [manifest]);

  const recordedSize: ReplayRecordedSize | null = useMemo(() => {
    if (snapshot.recordedSize) {
      return snapshot.recordedSize;
    }

    if (
      manifest &&
      manifest.details.viewportWidth > 0 &&
      manifest.details.viewportHeight > 0
    ) {
      return {
        width: manifest.details.viewportWidth,
        height: manifest.details.viewportHeight,
      };
    }

    return null;
  }, [snapshot.recordedSize, manifest]);

  /* Counts the details panel quotes; null until the rail fetched them. */
  const railCounts: ReplayRailCounts = useMemo(() => {
    const logs: number | null =
      backendSnapshot.slots.log.status === "ready"
        ? backendSnapshot.slots.log.rowCount
        : null;
    const traces: number | null =
      backendSnapshot.slots.span.status === "ready"
        ? telemetrySignals.filter((signal: ReplaySignal): boolean => {
            return signal.kind === "span";
          }).length
        : null;
    const errors: number | null =
      backendSnapshot.slots.exception.status === "ready"
        ? allSignals.filter((signal: ReplaySignal): boolean => {
            return (
              signal.kind === "client-error" || signal.kind === "server-error"
            );
          }).length
        : null;

    return { logs: logs, traces: traces, errors: errors };
  }, [backendSnapshot, telemetrySignals, allSignals]);

  /* Static, manifest-level notes about the recording (not runtime state). */
  const recordingNotes: Array<string> = useMemo(() => {
    if (!manifest) {
      return [];
    }

    const notes: Array<string> = [];

    if (manifest.isChunkIndexTruncated) {
      notes.push(
        "This session has more chunks than the index can return, so the timeline stops short of the full recording.",
      );
    }

    if (manifest.gaps.length > 0) {
      notes.push(
        `${manifest.gaps.length} gap${
          manifest.gaps.length === 1 ? "" : "s"
        } in this recording; playback jumps forward at each one instead of guessing what happened.`,
      );
    }

    for (const notice of manifest.fidelityNotices) {
      const copy: FidelityNoticeCopy = getFidelityNoticeCopy(notice);

      if (getFidelityNoticeSeverity(notice) === "playback") {
        notes.push(`${copy.title}. ${copy.description}`);
      }
    }

    if (sealedReason && sealedReason.severity === "warn") {
      notes.push(`${sealedReason.title}. ${sealedReason.description}`);
    }

    return notes;
  }, [manifest, sealedReason]);

  const captureNotes: Array<FidelityNoticeCopy> = useMemo(() => {
    if (!manifest) {
      return [];
    }

    return manifest.fidelityNotices
      .filter((notice: string): boolean => {
        return getFidelityNoticeSeverity(notice) !== "playback";
      })
      .map(getFidelityNoticeCopy);
  }, [manifest]);

  /* ---- URL: rail / q / tab / signal mirror the view state. ---- */

  useEffect(() => {
    if (!manifest) {
      return;
    }

    Navigation.setQueryString({
      [REPLAY_URL_PARAM_TAB]:
        manifest.tabs.length > 1 && activeTabId ? activeTabId : null,
      [REPLAY_URL_PARAM_RAIL]: railTab === "all" ? null : railTab,
      [REPLAY_URL_PARAM_RAIL_SEARCH]: railQuery || null,
      [REPLAY_URL_PARAM_SIGNAL]: selectedSignalId,
    });
  }, [manifest, activeTabId, railTab, railQuery, selectedSignalId]);

  /* ?signal= on load: reveal the row once it exists in the merged list. */
  useEffect(() => {
    if (
      hasRevealedSignalRef.current ||
      !urlState.signalId ||
      !railRef.current
    ) {
      return;
    }

    const target: ReplaySignal | undefined = allSignals.find(
      (signal: ReplaySignal): boolean => {
        return signal.id === urlState.signalId;
      },
    );

    if (!target) {
      return;
    }

    hasRevealedSignalRef.current = true;

    /*
     * With an explicit moment (t / at) the row is only selected: the
     * pre-roll seek is what a bare ?signal= asks for, and the URL's own
     * moment is the more specific statement of intent.
     *
     * ux-11: the shared link still has to put the row where it can be
     * seen. The rail tab is a per-viewer preference, so a teammate whose
     * last tab was Network opened a link to a console error and saw the
     * Network tab with nothing selected. A signal named in the URL wins
     * over that preference: if the open tab does not show this kind of
     * row, the player switches to the tab that does before selecting.
     */
    if (urlState.offsetMs !== null || urlState.atUnixMs !== null) {
      setRailTab((current: ReplayRailTabId): ReplayRailTabId => {
        return isSignalInTab(target, current)
          ? current
          : homeRailTabForSignal(target);
      });
      setSelectedSignalId(urlState.signalId);
      return;
    }

    /* revealSignal switches tab, selects AND seeks - what a bare ?signal= means. */
    railRef.current.revealSignal(urlState.signalId);
  }, [allSignals, urlState]);

  /* ---- Actions. ---- */

  const runAfterTextSelectionExit: (action: () => void) => void = useCallback(
    (action: () => void): void => {
      if (
        !isTextSelectionEnabledRef.current &&
        pendingTextSelectionActionRef.current === null
      ) {
        action();
        return;
      }

      pendingTextSelectionActionRef.current = action;
      isTextSelectionEnabledRef.current = false;
      setIsTextSelectionEnabled(false);
    },
    [],
  );

  const dispatchSeek: (offsetMs: number) => void = useCallback(
    (offsetMs: number): void => {
      seekTokenRef.current += 1;
      engineRef.current?.dispatch({
        type: "SEEK",
        offsetMs: Math.max(0, offsetMs),
        token: seekTokenRef.current,
      });
    },
    [],
  );

  const seekTo: (offsetMs: number) => void = useCallback(
    (offsetMs: number): void => {
      runAfterTextSelectionExit((): void => {
        dispatchSeek(offsetMs);
      });
    },
    [dispatchSeek, runAfterTextSelectionExit],
  );

  const playPause: () => void = useCallback((): void => {
    const current: ReplayEngine | null = engineRef.current;

    if (!current) {
      return;
    }

    if (current.getSnapshot().intent !== "playing") {
      runAfterTextSelectionExit((): void => {
        current.dispatch({ type: "PLAY" });
      });
      return;
    }

    current.dispatch({
      type: current.getSnapshot().intent === "playing" ? "PAUSE" : "PLAY",
    });
  }, [runAfterTextSelectionExit]);

  const watchAgain: () => void = useCallback((): void => {
    runAfterTextSelectionExit((): void => {
      dispatchSeek(0);
      engineRef.current?.dispatch({ type: "PLAY" });
    });
  }, [dispatchSeek, runAfterTextSelectionExit]);

  const changeTextSelection: (isEnabled: boolean) => void = useCallback(
    (isEnabled: boolean): void => {
      if (isEnabled) {
        engineRef.current?.dispatch({ type: "PAUSE" });
        pendingTextSelectionActionRef.current = null;
      }

      isTextSelectionEnabledRef.current = isEnabled;
      setIsTextSelectionEnabled(isEnabled);
    },
    [],
  );

  const retry: () => void = useCallback((): void => {
    runAfterTextSelectionExit((): void => {
      engineRef.current?.dispatch({ type: "RETRY" });
    });
  }, [runAfterTextSelectionExit]);

  const stillLoadingRetry: () => void = useCallback((): void => {
    const current: ReplayEngine | null = engineRef.current;

    if (!current) {
      return;
    }

    const latest: ReplayEngineSnapshot = current.getSnapshot();

    if (latest.error && latest.error.retryable) {
      runAfterTextSelectionExit((): void => {
        current.dispatch({ type: "RETRY" });
      });
      return;
    }

    /* Nothing halted: a fresh seek to the same offset restarts the fetch. */
    seekTo(latest.currentTimeMs);
  }, [runAfterTextSelectionExit, seekTo]);

  const setSpeed: (speed: number) => void = useCallback(
    (speed: number): void => {
      engineRef.current?.dispatch({ type: "SET_SPEED", speed: speed });
      replayViewPrefsStore.update({ speed: speed });
    },
    [],
  );

  const setSkipInactive: (isEnabled: boolean) => void = useCallback(
    (isEnabled: boolean): void => {
      engineRef.current?.dispatch({
        type: "SET_SKIP_INACTIVE",
        enabled: isEnabled,
      });
      replayViewPrefsStore.update({ skipIdle: isEnabled });
    },
    [],
  );

  const skipIdle: (band: ReplayIdleBand) => void = useCallback(
    (band: ReplayIdleBand): void => {
      runAfterTextSelectionExit((): void => {
        engineRef.current?.dispatch({ type: "IDLE_SKIP", band: band });
      });
    },
    [runAfterTextSelectionExit],
  );

  const skipIdleJump: () => void = useCallback((): void => {
    const current: ReplayEngine | null = engineRef.current;

    if (!current) {
      return;
    }

    const latest: ReplayEngineSnapshot = current.getSnapshot();
    const band: ReplayIdleBand | null = findIdleBandAt(
      latest.idleBands,
      latest.currentTimeMs,
    );

    if (band) {
      runAfterTextSelectionExit((): void => {
        current.dispatch({ type: "IDLE_SKIP", band: band });
      });
    }
  }, [runAfterTextSelectionExit]);

  /*
   * Move to another tab of the same recording.
   *
   * `resume` says whether the switch is "keep watching" (auto-continue,
   * the Continue chips) or "take me there" (a tab pill, the picker). Only
   * the first carries the playing intent into the engine: a tab that
   * played out left the engine paused, and a switch that did not say so
   * landed on a still picture the viewer had to press Play on - the
   * second half of the click-per-tab this fixes (issue 3865).
   */
  const switchTabTo: (tabId: string, resume: boolean) => void = useCallback(
    (tabId: string, resume: boolean): void => {
      const current: SessionReplayManifest | null = manifestRef.current;
      const target: SessionReplayManifestTab | null = current
        ? findTab(current, tabId)
        : null;

      if (
        !target ||
        !tabHasFootage(target) ||
        tabId === activeTabIdRef.current
      ) {
        return;
      }

      if (engineRef.current) {
        runAfterTextSelectionExit((): void => {
          const loader: ChunkLoader = createLoader(target);
          loaderRef.current = loader;
          /* TAB_SWITCH preserves the session-clock playhead when the tab covers it. */
          engineRef.current?.dispatch({
            type: "TAB_SWITCH",
            tabId: tabId,
            loader: loader,
            resume: resume,
          });
          setActiveTabId(tabId);
        });
        return;
      }

      const loader: ChunkLoader = createLoader(target);
      pendingLoaderRef.current?.dispose();
      pendingLoaderRef.current = loader;
      setActiveTabId(tabId);
    },
    [createLoader, runAfterTextSelectionExit],
  );

  /*
   * A tab the viewer picked themselves. That also hands the wheel back:
   * the auto-continue tracker forgets which tabs it walked into, so
   * jumping back to Tab 1 by hand arms continuous playback for that
   * stretch again instead of leaving the viewer parked at every end for
   * the rest of the session.
   */
  const switchTab: (tabId: string) => void = useCallback(
    (tabId: string): void => {
      autoContinueRef.current.reset();
      switchTabTo(tabId, false);
    },
    [switchTabTo],
  );

  /* The "Continue in Tab N" chips: keep watching, so keep playing. */
  const continueInTabById: (tabId: string) => void = useCallback(
    (tabId: string): void => {
      autoContinueRef.current.noteEntered(tabId);
      switchTabTo(tabId, true);
    },
    [switchTabTo],
  );

  /*
   * ---- Continuous playback across the tabs of one session. ----
   *
   * The recorder mints a new tab id on every page load, so a visit that
   * touched four pages is four "tabs" and the engine plays exactly one of
   * them: at the end of each, rrweb Finishes, the engine parks at "ended"
   * and the shell offered a chip. Watching a session end to end was a
   * click per page - twice over, because the switch landed paused
   * (github.com/OneUptime/oneuptime/issues/3865).
   *
   * Every rule about when NOT to move the viewer lives in the pure
   * decideReplayAutoContinue; this effect is only the wiring: read the
   * transition, act on the answer, remember the hop. It runs off the
   * STRUCTURAL snapshot, which publishes on a phase change and not on the
   * playhead, so it is evaluated on transitions rather than per frame.
   */
  useEffect(() => {
    const previousPhase: ReplayPhase | null = previousPhaseRef.current;
    previousPhaseRef.current = snapshot.phase;

    /*
     * Did THIS stop at the end come from playback running out, or from the
     * viewer? Latched on the transition and held for as long as the engine
     * stays at "ended", because a live recording can only offer the tab
     * that continues it on a later manifest poll. Anything that moves the
     * engine off "ended" - Watch again, a seek, a tab the viewer picked -
     * clears it.
     */
    if (snapshot.phase !== "ended") {
      didPlayOutRef.current = false;
    } else if (previousPhase !== "ended") {
      didPlayOutRef.current = isReplayPlaybackPhase(previousPhase);
    }

    const decision: ReplayAutoContinueDecision = decideReplayAutoContinue({
      isEnabled: prefs.autoContinue,
      phase: snapshot.phase,
      didPlayOut: didPlayOutRef.current,
      nextTab: continueInTab,
      enteredTabIds: autoContinueRef.current.getEnteredTabIds(),
      hopCount: autoContinueRef.current.getHopCount(),
    });

    if (!decision.shouldContinue || !decision.tabId || !continueInTab) {
      return;
    }

    /*
     * Said before the picture changes, not after: the stage is about to
     * show another page, and a viewer who was not told why reads that as
     * the player having lost its place. The notice clears itself.
     */
    setShellNotice(describeReplayAutoContinue(continueInTab));
    continueInTabById(decision.tabId);
  }, [snapshot.phase, prefs.autoContinue, continueInTab, continueInTabById]);

  const toggleTheater: () => void = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch((): void => {
        /* The fullscreenchange listener owns the state. */
      });
      return;
    }

    void rootRef.current?.requestFullscreen?.().catch((): void => {
      /* Fullscreen denied (iframe policy, user setting). Stay inline. */
    });
  }, []);

  const toggleWide: () => void = useCallback((): void => {
    replayViewPrefsStore.update({
      wide: !replayViewPrefsStore.getSnapshot().wide,
    });
  }, []);

  const toggleDetails: () => void = useCallback((): void => {
    setIsPanelOpen((isOpen: boolean): boolean => {
      return !isOpen;
    });
  }, []);

  const openDetails: () => void = useCallback((): void => {
    setIsPanelOpen(true);
  }, []);

  const closeDetails: () => void = useCallback((): void => {
    setIsPanelOpen(false);
  }, []);

  const buildMomentUrl: () => string | null = useCallback((): string | null => {
    const latest: ReplayEngineSnapshot | null =
      engineRef.current?.getSnapshot() ?? null;
    const route: Route | null = buildReplayMomentRoute({
      rumApplicationId: rumApplicationIdString,
      sessionId: sessionId,
      t: latest ? latest.currentTimeMs : 0,
      signal: selectedSignalId,
      /*
       * ux-11: written even when it is "all". Omitting the default meant a
       * link copied from the All tab opened on whatever tab the RECIPIENT
       * happened to have open last, which is where a shared &signal= row
       * went missing.
       */
      rail: railTab,
      tab:
        manifestRef.current && manifestRef.current.tabs.length > 1
          ? activeTabIdRef.current
          : null,
      /* "At this moment" means exactly here, not a second before. */
      preRollMs: 0,
    });

    if (!route) {
      return null;
    }

    return `${window.location.origin}${route.toString()}`;
  }, [rumApplicationIdString, sessionId, selectedSignalId, railTab]);

  const copyLink: () => void = useCallback((): void => {
    headerRef.current?.copyLink();
  }, []);

  const copySignalLink: (signal: ReplaySignal) => void = useCallback(
    (signal: ReplaySignal): void => {
      const route: Route | null = buildReplayMomentRoute({
        rumApplicationId: rumApplicationIdString,
        sessionId: sessionId,
        t: signal.offsetMs,
        signal: signal.id,
        /* The tab the recipient must land on to see this row (ux-11). */
        rail: isSignalInTab(signal, railTab)
          ? railTab
          : homeRailTabForSignal(signal),
      });

      if (!route) {
        return;
      }

      /*
       * ux-10: through the header's copy path, so the row action announces
       * "Link copied" and offers the read-only field when the clipboard is
       * missing (plain http) or refuses (unfocused document) - instead of
       * writing straight to navigator.clipboard and swallowing both
       * outcomes.
       */
      headerRef.current?.copyUrl(
        `${window.location.origin}${route.toString()}`,
      );
    },
    [rumApplicationIdString, sessionId, railTab],
  );

  /*
   * Open another recording of the same person (issue #3705). A full
   * navigation to the player route rather than a state change: the page
   * keys the player on `${modelId}:${sessionId}`, so the route change
   * remounts everything - engine, loader, heartbeat, audit row - exactly
   * as opening the session from the list would. The rail tab travels so
   * a viewer stepping through a user's sessions on the Errors tab stays
   * on Errors; the playhead does not (a different recording has its own
   * clock), and the list's stamped back-link is left alone, since the
   * viewer never went through the list.
   */
  const openUserSession: (targetSessionId: string) => void = useCallback(
    (targetSessionId: string): void => {
      if (!targetSessionId || targetSessionId === sessionId) {
        return;
      }

      const route: Route | null = buildReplayMomentRoute({
        rumApplicationId: rumApplicationIdString,
        sessionId: targetSessionId,
        rail: railTab,
        preRollMs: 0,
      });

      if (!route) {
        return;
      }

      Navigation.navigate(route);
    },
    [rumApplicationIdString, sessionId, railTab],
  );

  /*
   * The lookup's rows with the watched session's entry kept in step with
   * the manifest poll. The lookup itself runs once per session, so its
   * row for this session says "Recording now" for as long as the page is
   * open; the Live pill, fed by the poll, goes out when the last tab
   * closes. Overlaying the latest manifest's two flags onto that one entry
   * keeps the menu's dot and the pill telling the same story, without
   * re-running the lookup. Keyed on the flags rather than the manifest
   * object, which every poll replaces.
   */
  const manifestSessionId: string = manifest
    ? manifest.sessionId || sessionId
    : "";
  const isManifestFinalized: boolean = manifest?.isFinalized ?? false;
  const hasManifestRecordingEnded: boolean =
    manifest?.hasRecordingEnded ?? false;

  const displayedUserSessions: ReplayUserSessionsState =
    useMemo((): ReplayUserSessionsState => {
      return overlayCurrentReplayUserSession(
        userSessions,
        manifestSessionId
          ? {
              sessionId: manifestSessionId,
              isFinalized: isManifestFinalized,
              hasRecordingEnded: hasManifestRecordingEnded,
            }
          : null,
      );
    }, [
      userSessions,
      manifestSessionId,
      isManifestFinalized,
      hasManifestRecordingEnded,
    ]);

  const adjacentUserSessions: ReplayAdjacentUserSessions =
    useMemo((): ReplayAdjacentUserSessions => {
      return displayedUserSessions.status === "ready"
        ? findAdjacentUserSessions(displayedUserSessions.sessions, sessionId)
        : { newer: null, older: null };
    }, [displayedUserSessions, sessionId]);

  /*
   * The ended card's onward step (the "what happened next" question a
   * viewer has the moment a recording runs out): the same newer session
   * the header's arrow and "}" open, described the way the sessions menu
   * describes its rows. One clock read for the whole card.
   */
  const nextUserSession: ReplayNextUserSession | null =
    useMemo((): ReplayNextUserSession | null => {
      const newer: ReplayUserSessionItem | null = adjacentUserSessions.newer;

      if (!newer) {
        return null;
      }

      const description: ReplayUserSessionDescription =
        describeReplayUserSession(newer, Date.now());

      return {
        sessionId: newer.sessionId,
        description: [
          description.when,
          description.path || "Unknown page",
          description.duration,
        ]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(" · "),
      };
    }, [adjacentUserSessions]);

  /* "{" and "}": the same two steps the header's arrow buttons take. */
  const openOlderUserSession: () => void = useCallback((): void => {
    if (adjacentUserSessions.older) {
      openUserSession(adjacentUserSessions.older.sessionId);
    }
  }, [adjacentUserSessions, openUserSession]);

  const openNewerUserSession: () => void = useCallback((): void => {
    if (adjacentUserSessions.newer) {
      openUserSession(adjacentUserSessions.newer.sessionId);
    }
  }, [adjacentUserSessions, openUserSession]);

  const selectSignal: (signalId: string | null) => void = useCallback(
    (signalId: string | null): void => {
      setSelectedSignalId(signalId);
    },
    [],
  );

  const selectSignalFromTimeline: (signalId: string) => void = useCallback(
    (signalId: string): void => {
      setSelectedSignalId(signalId);
      railRef.current?.revealSignal(signalId);
    },
    [],
  );

  const handleRailTabChange: (tabId: ReplayRailTabId) => void = useCallback(
    (tabId: ReplayRailTabId): void => {
      setRailTab(tabId);
      replayViewPrefsStore.update({ railTab: tabId });
    },
    [],
  );

  const openRailTab: (tabId: ReplayRailTabId) => void = useCallback(
    (tabId: ReplayRailTabId): void => {
      handleRailTabChange(tabId);
      setIsPanelOpen(false);
    },
    [handleRailTabChange],
  );

  const handleFollowChange: (isEnabled: boolean) => void = useCallback(
    (isEnabled: boolean): void => {
      replayViewPrefsStore.update({ follow: isEnabled });
    },
    [],
  );

  const handleMouseTrailChange: (isEnabled: boolean) => void = useCallback(
    (isEnabled: boolean): void => {
      replayViewPrefsStore.update({ mouseTrail: isEnabled });

      try {
        replayerRef.current?.setConfig({
          mouseTail: isEnabled
            ? {
                duration: 800,
                lineCap: "round",
                lineWidth: 3,
                strokeStyle: "rgba(73, 80, 246, 0.5)",
              }
            : false,
        });
      } catch {
        /* Cosmetic. */
      }
    },
    [],
  );

  const handleTelemetrySignalsChange: (
    signals: Array<ReplaySignal>,
    alignment: ReplayClockAlignmentState,
  ) => void = useCallback((signals: Array<ReplaySignal>): void => {
    setTelemetrySignals(signals);
  }, []);

  const handleShowOnStage: (x: number, y: number) => void = useCallback(
    (x: number, y: number): void => {
      /* Flash a ring at the recorded coordinates, through the stage's own path. */
      const host: HTMLElement | null =
        engineRef.current?.getHostElement() ?? null;

      if (!host) {
        return;
      }

      const ring: HTMLDivElement = document.createElement("div");
      ring.className = "oneuptime-replay-touch-ring";
      ring.style.left = `${Math.round(x)}px`;
      ring.style.top = `${Math.round(y)}px`;
      ring.style.position = "absolute";
      ring.style.pointerEvents = "none";
      host.appendChild(ring);

      setTimeout((): void => {
        ring.remove();
      }, 900);
    },
    [],
  );

  const handleEscape: () => void = useCallback((): void => {
    if (isPanelOpen) {
      setIsPanelOpen(false);
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch((): void => {
        /* Owned by the fullscreenchange listener. */
      });
      return;
    }

    railRef.current?.clearSelection();
  }, [isPanelOpen]);

  const getKeyboardScope: () => "player" | "rail" = useCallback(():
    | "player"
    | "rail" => {
    const container: HTMLDivElement | null = railContainerRef.current;

    return container &&
      typeof document !== "undefined" &&
      document.activeElement &&
      container.contains(document.activeElement)
      ? "rail"
      : "player";
  }, []);

  const getDiagnostic: () => string = useCallback((): string => {
    const current: ReplayEngine | null = engineRef.current;
    const latest: ReplayEngineSnapshot | null = current?.getSnapshot() ?? null;
    const currentManifest: SessionReplayManifest | null = manifestRef.current;

    return JSON.stringify(
      {
        sessionId: sessionId,
        rumApplicationId: rumApplicationIdString,
        tabId: activeTabIdRef.current,
        viewId: currentManifest?.viewId ?? null,
        recorderVersion: currentManifest?.details.recorderVersion ?? null,
        rrwebVersion: currentManifest?.details.rrwebVersion ?? null,
        phase: latest?.phase ?? null,
        buffer: latest?.buffer ?? null,
        currentTimeMs: latest?.currentTimeMs ?? null,
        durationMs: latest?.durationMs ?? null,
        loadedChunkIndexes: latest?.loadedChunkIndexes ?? [],
        error: latest?.error ?? null,
        engine: current?.getDiagnostics() ?? null,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        at: new Date().toISOString(),
      },
      null,
      2,
    );
  }, [sessionId, rumApplicationIdString]);

  const backHref: string = useMemo((): string => {
    const stored: string | null = readReplayListUrl();

    if (stored) {
      return stored;
    }

    try {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY] as Route,
        { modelId: new ObjectID(rumApplicationIdString) },
      ).toString();
    } catch {
      return "";
    }
  }, [rumApplicationIdString]);

  const goBack: () => void = useCallback((): void => {
    if (backHref && Navigation.isSafeInternalRoute(backHref)) {
      Navigation.navigate(new Route(backHref));
    }
  }, [backHref]);

  const reload: () => void = useCallback((): void => {
    setReloadToken((token: number): number => {
      return token + 1;
    });
  }, []);

  /* ---- Rail width drag. ---- */

  const handleRailResizeStart: (
    event: React.PointerEvent<HTMLDivElement>,
  ) => void = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const startX: number = event.clientX;
    const startRem: number = replayViewPrefsStore.getSnapshot().railWidthRem;
    const pxPerRem: number =
      parseFloat(getComputedStyle(document.documentElement).fontSize || "16") ||
      16;

    const onMove: (moveEvent: PointerEvent) => void = (
      moveEvent: PointerEvent,
    ): void => {
      /* The handle sits on the rail's LEFT edge: dragging left widens it. */
      const deltaRem: number = (startX - moveEvent.clientX) / pxPerRem;

      replayViewPrefsStore.update({
        railWidthRem: Math.min(
          REPLAY_RAIL_MAX_WIDTH_REM,
          Math.max(REPLAY_RAIL_MIN_WIDTH_REM, startRem + deltaRem),
        ),
      });
    };

    const onUp: () => void = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  const toggleRailCollapsed: () => void = useCallback((): void => {
    replayViewPrefsStore.update({
      railCollapsed: !replayViewPrefsStore.getSnapshot().railCollapsed,
    });
  }, []);

  /*
   * How the picture is fitted is a preference, not per-view state: someone
   * who reads recordings at 1:1 or scrolls tall pages at full width wants
   * that on the next session too, and the "z" shortcut would otherwise
   * reset on every navigation between sessions.
   */
  const changeFit: (fit: ReplayStageFit) => void = useCallback(
    (fit: ReplayStageFit): void => {
      replayViewPrefsStore.update({ stageFit: fit });
    },
    [],
  );

  /* "z": Fit -> Width -> 1:1 -> Fit, the URL bar's three segments in order. */
  const cycleFit: () => void = useCallback((): void => {
    replayViewPrefsStore.update({
      stageFit: cycleReplayStageFit(
        replayViewPrefsStore.getSnapshot().stageFit,
      ),
    });
  }, []);

  const changeTimelineLanes: (isVisible: boolean) => void = useCallback(
    (isVisible: boolean): void => {
      replayViewPrefsStore.update({ timelineLanes: isVisible });
    },
    [],
  );

  /*
   * Turning continuous playback back ON mid-session also clears what the
   * tracker remembers, so the viewer does not have to reach the end of a
   * tab they have not already been walked into before it does anything.
   */
  const changeAutoContinue: (isEnabled: boolean) => void = useCallback(
    (isEnabled: boolean): void => {
      if (isEnabled) {
        autoContinueRef.current.reset();
      }

      replayViewPrefsStore.update({ autoContinue: isEnabled });
    },
    [],
  );

  /* ---- Render. ---- */

  if (manifestFailure) {
    if (manifestFailure.kind === "error") {
      return (
        <ErrorMessage
          message={manifestFailure.message}
          onRefreshClick={reload}
        />
      );
    }

    const emptyCopy: { title: string; description: string; icon: IconProp } =
      manifestFailure.kind === "expired"
        ? {
            title: "Footage expired",
            description: `${manifestFailure.message}${
              manifestFailure.expiresAtIso
                ? ` Expired on ${OneUptimeDate.getDateAsLocalFormattedString(
                    manifestFailure.expiresAtIso,
                    true,
                  )}.`
                : ""
            } Its logs, traces and exceptions can still be found by session id.`,
            icon: IconProp.VideoCameraSlash,
          }
        : manifestFailure.kind === "erased"
          ? {
              title: "Recording erased",
              description: manifestFailure.message,
              icon: IconProp.Trash,
            }
          : manifestFailure.kind === "forbidden"
            ? {
                title: "You cannot watch this recording",
                description: manifestFailure.message,
                icon: IconProp.Lock,
              }
            : {
                title: "Recording not found",
                description: manifestFailure.message,
                icon: IconProp.MagnifyingGlass,
              };

    return (
      <div
        data-testid="replay-manifest-failure"
        data-kind={manifestFailure.kind}
      >
        <EmptyState
          id="replay-manifest-failure"
          icon={emptyCopy.icon}
          title={emptyCopy.title}
          description={emptyCopy.description}
          paddingClassName="pt-24 pb-24"
          footer={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                title="Back to sessions"
                icon={IconProp.ArrowLeft}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={goBack}
              />
              <span
                className="font-mono text-xs text-gray-400"
                title="Session id"
              >
                {sessionId}
              </span>
            </div>
          }
        />
      </div>
    );
  }

  /*
   * The viewer's rail width, read before the loading branch so the skeleton
   * lays the row out at the width the rail will actually have. Left to the
   * class default, a viewer who had dragged the rail wider watched the
   * stage jump sideways the instant the manifest landed.
   */
  const railWidthStyle: React.CSSProperties = (
    prefs.railCollapsed
      ? {}
      : { "--oneuptime-replay-rail-width": `${prefs.railWidthRem}rem` }
  ) as React.CSSProperties;

  if (!manifest) {
    /*
     * Loading. The same boxes, the same classes and the same ref as the
     * real player, so the fill height is already measured when the
     * manifest lands and the page lays out exactly once: a compact header
     * bar, the stage box at 16:9 through ReplayStage's own responsive
     * class, and the rail's own skeleton rows beside it.
     */
    return (
      <div
        ref={rootRef}
        data-testid="replay-loading"
        data-replay-sizing="responsive"
        className={REPLAY_ROOT_FLOW_CLASS}
        style={fillHeightStyle}
      >
        <Skeleton className="mb-3 h-16" widthVariantIndex={0} />
        <div className={REPLAY_MAIN_ROW_FLOW_CLASS} style={railWidthStyle}>
          <div className={REPLAY_PLAYER_COLUMN_FLOW_CLASS}>
            <div className={REPLAY_CARD_FLOW_CLASS}>
              <div
                className={`${getReplayStageBoxClassName(
                  "responsive",
                  prefs.stageFit,
                )} animate-pulse`}
                style={
                  {
                    [REPLAY_STAGE_ASPECT_CSS_VAR]:
                      formatReplayStageAspect(null),
                  } as React.CSSProperties
                }
                role="status"
                aria-label="Loading the recording"
              />
            </div>
          </div>
          {/*
           * The rail the viewer will actually get: their stored width
           * through railWidthStyle above, and nothing at all when they
           * keep it collapsed. A skeleton that always reserved a 26rem
           * column made the stage jump sideways the moment the manifest
           * landed - for one preference by growing, for the other by
           * shrinking.
           */}
          <div
            className={`${REPLAY_RAIL_COLUMN_CLASS} ${REPLAY_RAIL_COLUMN_WIDTH_CLASS} ${
              prefs.railCollapsed ? "hidden" : ""
            }`}
          >
            <ReplayRail
              signals={NO_SIGNALS}
              sessionId={sessionId}
              startTimeUnixMs={null}
              isFinalized={false}
              isExpiredFootage={false}
              isLoading={true}
              currentTimeMs={0}
              isPlaying={false}
              selectedSignalId={null}
              onSeek={seekTo}
              onSelectSignal={selectSignal}
              className="min-h-0 flex-1"
            />
          </div>
        </div>
      </div>
    );
  }

  const isPlayable: boolean = absence === null;

  /*
   * Quantised while playing, exact while paused: the rail's "now" divider
   * shows tenths when the picture is still, and there is no frame budget
   * to protect then.
   */
  const railElement: ReactElement = (
    <ReplayRailClocked
      clock={engine}
      quantumMs={
        snapshot.phase === "playing"
          ? REPLAY_RAIL_CLOCK_MS
          : REPLAY_CLOCK_EXACT_MS
      }
      railRef={railRef}
      railProps={{
        signals: recordingSignals,
        backendStore: backendStore,
        sessionId: manifest.sessionId || sessionId,
        startTimeUnixMs: startTimeUnixMs,
        clockSkewMs: manifest.details.clockSkewMs,
        isFinalized: manifest.isFinalized,
        isExpiredFootage: !isPlayable,
        isLoading: isPlayable && !engine,
        isPlaying: snapshot.phase === "playing",
        selectedSignalId: selectedSignalId,
        onSeek: seekTo,
        onSelectSignal: selectSignal,
        onHoverSignal: setGhostMs,
        activeTab: railTab,
        onTabChange: handleRailTabChange,
        query: railQuery,
        onQueryChange: setRailQuery,
        follow: prefs.follow,
        onFollowChange: handleFollowChange,
        truncatedKinds:
          loaderRef.current?.getExtractionStats().truncatedKinds ?? null,
        loadedChunkCount:
          loaderRef.current?.getExtractedChunkIndexes().length ?? null,
        totalChunkCount: chunks.length > 0 ? chunks.length : null,
        recorderCapabilities: manifest.recorderCapabilities,
        onShowOnStage: handleShowOnStage,
        onCopyLink: copySignalLink,
        onTelemetrySignalsChange: handleTelemetrySignalsChange,
        onCollapse: toggleRailCollapsed,
        /*
         * flex-1 + min-h-0 inside a column whose height is bounded above
         * (see the rail column) is what lets the rail's own list overflow
         * and scroll. `h-full` resolved to the rail's full CONTENT height,
         * which is why nothing in the rail ever scrolled (ux-02).
         */
        className: "min-h-0 flex-1",
      }}
    />
  );

  return (
    <Fragment>
      <div
        ref={rootRef}
        data-testid="replay-player"
        data-replay-layout="true"
        data-replay-live={isLive ? "true" : "false"}
        data-replay-sizing={stageSizing}
        className={isTheater ? REPLAY_ROOT_FILL_CLASS : REPLAY_ROOT_FLOW_CLASS}
        style={fillHeightStyle}
      >
        <ReplayHeaderClocked
          clock={engine}
          quantumMs={REPLAY_HEADER_CLOCK_MS}
          headerRef={headerRef}
          headerProps={{
            sessionId: manifest.sessionId || sessionId,
            backHref: backHref,
            onBack: goBack,
            identity: {
              label: manifest.details.identifiedUserLabel,
              traits: manifest.details.identifiedUserTraits,
              visitorId: manifest.details.visitorId,
            },
            facts: facts,
            startTimeUnixMs: startTimeUnixMs,
            durationMs: snapshot.durationMs || manifest.durationMs,
            /*
             * The whole recording, not the tab being watched: the engine's
             * duration above is this tab's footage, and the tab picker
             * draws every tab's span against the session clock.
             */
            sessionDurationMs: manifest.durationMs,
            isLive: isLive,
            tabs: headerTabs,
            onSwitchTab: switchTab,
            continueInTab: continueInTab,
            onContinueInTab: continueInTabById,
            sealedReason: sealedReason,
            isWide: prefs.wide,
            onToggleWide: toggleWide,
            isTheater: isTheater,
            onToggleTheater: toggleTheater,
            onOpenDetails: openDetails,
            buildMomentUrl: buildMomentUrl,
            pinControl: (
              <ReplayPinControl
                rumApplicationId={props.rumApplicationId}
                sessionId={sessionId}
              />
            ),
            userSessions: displayedUserSessions,
            onOpenUserSession: openUserSession,
          }}
        />

        {recordingNotes.length > 0 && (
          <details
            className="group mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 shrink-0"
            data-testid="replay-recording-notes"
          >
            {/*
             * The summary is a flex row with the native marker hidden and
             * an explicit caret. With the default `display: list-item`
             * the browser's disclosure triangle, the icon and the text
             * each took a line of their own inside the amber box (a
             * customer's screenshot showed the banner three lines tall
             * for one sentence); `list-none` plus the WebKit marker
             * pseudo-element is what actually removes the triangle in
             * every engine, and the caret rotates with `group-open`.
             */}
            <summary
              className="flex cursor-pointer items-center gap-1.5 list-none text-xs text-amber-800 [&::-webkit-details-marker]:hidden"
              data-testid="replay-recording-notes-summary"
            >
              <Icon
                icon={IconProp.ChevronRight}
                className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
              />
              <span className="inline-flex shrink-0">
                <Icon icon={IconProp.Alert} className="h-3 w-3" />
              </span>
              <span>
                {recordingNotes.length} note
                {recordingNotes.length === 1 ? "" : "s"} about this recording
              </span>
            </summary>
            <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
              {recordingNotes.map(
                (note: string, index: number): ReactElement => {
                  return <li key={index}>{note}</li>;
                },
              )}
            </ul>
          </details>
        )}

        <div
          className={
            isTheater ? REPLAY_MAIN_ROW_FILL_CLASS : REPLAY_MAIN_ROW_FLOW_CLASS
          }
          style={railWidthStyle}
        >
          <div
            className={
              isTheater
                ? REPLAY_PLAYER_COLUMN_FILL_CLASS
                : REPLAY_PLAYER_COLUMN_FLOW_CLASS
            }
          >
            {/*
             * ONE card for the player.
             *
             * The address bar, the picture and the transport used to be
             * three floating boxes, each with its own border, radius and
             * shadow, separated by 12px of page background - so the thing
             * a viewer thinks of as "the player" was drawn as three
             * unrelated widgets that happened to be stacked. They are now
             * sections of a single surface, in the order every media
             * player uses: address -> picture -> track -> transport.
             * Menus may extend beyond this card; clipping here would hide
             * playback speed options and the overflow menu.
             *
             * It is also the box that hands the stage its height: a flex
             * column whose stage child grows and whose scrubber child does
             * not (shrink-0 below).
             */}
            <div
              className={
                isTheater ? REPLAY_CARD_FILL_CLASS : REPLAY_CARD_FLOW_CLASS
              }
            >
              <ReplayStageOverlaysClocked
                clock={engine}
                quantumMs={REPLAY_OVERLAYS_CLOCK_MS}
                overlayProps={{
                  snapshot: snapshot,
                  signals: recordingSignals,
                  chunks: chunks,
                  entryUrl: manifest.details.entryUrl,
                  recordedSize: recordedSize,
                  scale: scale,
                  fit: prefs.stageFit,
                  onFitChange: changeFit,
                  sizing: stageSizing,
                  canSelectText:
                    isPlayable && engine !== null && isReplayDocumentReady,
                  isTextSelectionEnabled: isTextSelectionEnabled,
                  onTextSelectionChange: changeTextSelection,
                  onPlayPause: playPause,
                  onWatchAgain: watchAgain,
                  onRetry: retry,
                  onStillLoadingRetry: stillLoadingRetry,
                  onSkipIdle: skipIdle,
                  getDiagnostic: getDiagnostic,
                  continueInTab: continueInTab,
                  onSwitchTab: switchTab,
                  onContinueInTab: continueInTabById,
                  shellNotice: shellNotice,
                  absence: absence,
                  sealedReason: sealedReason,
                  isLive: isLive,
                  nextUserSession: nextUserSession,
                  onOpenNextUserSession: openUserSession,
                  children: (
                    <Fragment>
                      {isPlayable && engine && (
                        <ReplayStage
                          engine={engine}
                          recorderCapabilities={manifest.recorderCapabilities}
                          viewportWidth={manifest.details.viewportWidth}
                          viewportHeight={manifest.details.viewportHeight}
                          sizing={stageSizing}
                          fit={prefs.stageFit}
                          isTextSelectionEnabled={isTextSelectionEnabled}
                          onScaleChange={setScale}
                        />
                      )}
                      {isPlayable && !engine && (
                        /*
                         * The same box the stage will occupy, down to the
                         * class string, so swapping the engine in moves
                         * nothing on the page.
                         */
                        <div
                          className={`${getReplayStageBoxClassName(
                            stageSizing,
                            prefs.stageFit,
                          )} animate-pulse`}
                          style={
                            {
                              [REPLAY_STAGE_ASPECT_CSS_VAR]:
                                formatReplayStageAspect(recordedSize),
                            } as React.CSSProperties
                          }
                          role="status"
                          aria-label="Loading the replay engine"
                          data-testid="replay-stage-placeholder"
                        />
                      )}
                    </Fragment>
                  ),
                }}
              />

              {isPlayable && (
                /* shrink-0: the transport keeps its height, the stage takes the rest. */
                <div className="shrink-0 border-t border-gray-200">
                  <ReplayScrubber
                    snapshot={snapshot}
                    clock={engine}
                    bands={bands}
                    activity={activity}
                    markers={markers}
                    signals={allSignals}
                    ghostMs={ghostMs}
                    selectedSignalId={selectedSignalId}
                    startTimeUnixMs={startTimeUnixMs}
                    errorMessage={snapshot.error?.message ?? null}
                    areShortcutsEnabled={!isPanelOpen}
                    keyboardScope={getKeyboardScope}
                    isFollowEnabled={prefs.follow}
                    isMouseTrailEnabled={prefs.mouseTrail}
                    showTimelineLanes={prefs.timelineLanes}
                    onTimelineLanesChange={changeTimelineLanes}
                    isAutoContinueEnabled={prefs.autoContinue}
                    onAutoContinueChange={changeAutoContinue}
                    onToggleRail={toggleRailCollapsed}
                    onCycleFit={cycleFit}
                    onSeek={seekTo}
                    onPlayPause={playPause}
                    onSpeedChange={setSpeed}
                    onSkipInactiveChange={setSkipInactive}
                    onSkipIdleJump={skipIdleJump}
                    onRetry={retry}
                    onSelectSignal={selectSignalFromTimeline}
                    onHoverTimeline={setGhostMs}
                    onNextSignal={(): void => {
                      railRef.current?.stepSignal(1);
                    }}
                    onPrevSignal={(): void => {
                      railRef.current?.stepSignal(-1);
                    }}
                    onToggleTheater={toggleTheater}
                    onToggleWide={toggleWide}
                    onFollowChange={handleFollowChange}
                    onMouseTrailChange={handleMouseTrailChange}
                    onFocusRailSearch={(): void => {
                      railRef.current?.focusSearch();
                    }}
                    onCopyLink={copyLink}
                    onToggleDetails={toggleDetails}
                    onEscape={handleEscape}
                    onRailRowDown={(): void => {
                      railRef.current?.moveSelection(1);
                    }}
                    onRailRowUp={(): void => {
                      railRef.current?.moveSelection(-1);
                    }}
                    onRailSeekSelected={(): void => {
                      railRef.current?.seekSelected();
                    }}
                    onRailClear={(): void => {
                      railRef.current?.clearSelection();
                    }}
                    onOlderUserSession={openOlderUserSession}
                    onNewerUserSession={openNewerUserSession}
                  />
                </div>
              )}
            </div>

            {captureNotes.length > 0 && (
              <details
                className="group mt-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shrink-0"
                data-testid="replay-capture-notes"
              >
                {/* Same one-line summary as the recording notes above. */}
                <summary
                  className="flex cursor-pointer items-center gap-1.5 list-none text-xs text-gray-500 [&::-webkit-details-marker]:hidden"
                  data-testid="replay-capture-notes-summary"
                >
                  <Icon
                    icon={IconProp.ChevronRight}
                    className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
                  />
                  <span className="min-w-0 truncate">
                    {captureNotes.length} capture note
                    {captureNotes.length === 1 ? "" : "s"}:{" "}
                    {captureNotes
                      .map((note: FidelityNoticeCopy): string => {
                        return note.title.toLowerCase();
                      })
                      .join(", ")}
                  </span>
                </summary>
                <div className="mt-2 space-y-2">
                  {captureNotes.map(
                    (note: FidelityNoticeCopy, index: number): ReactElement => {
                      return (
                        <div key={index} className="text-xs">
                          <div className="font-medium text-gray-700">
                            {note.title}
                          </div>
                          <div className="text-gray-500">
                            {note.description}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </details>
            )}
          </div>

          {/*
           * The rail beside the picture on xl and up (22-44rem, dragged at
           * its left edge), under the scrubber below that. Collapsed, it
           * is a 2.5rem strip with one button to bring it back.
           *
           * ux-02: the column's height is BOUNDED, and that is what makes
           * the rail a rail. Without a bound, `xl:items-stretch` sized the
           * flex line to the rail's whole content, so the list never
           * overflowed: follow, the 40% now-divider anchoring, "Jump to
           * now" and the >500-row windowing were all inert, and an
           * 800-signal session produced a page tens of thousands of pixels
           * tall beside a 70vh stage. Stacked, the 32rem cap is that
           * bound; beside the player the row itself has a definite height
           * now, so the cap comes off (xl:max-h-none) and the rail is
           * exactly as tall as the picture. Every wrapper down to
           * ReplayRail's own list carries min-h-0 so the overflow lands on
           * the list, not on the page.
           */}
          <div
            ref={railContainerRef}
            data-testid="replay-rail-column"
            data-collapsed={prefs.railCollapsed ? "true" : "false"}
            className={`${REPLAY_RAIL_COLUMN_CLASS} ${
              prefs.railCollapsed
                ? "xl:w-10"
                : isTheater
                  ? "xl:w-[22rem]"
                  : REPLAY_RAIL_COLUMN_WIDTH_CLASS
            }`}
          >
            {!prefs.railCollapsed && !isTheater && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the events rail"
                title="Drag to resize the rail"
                data-testid="replay-rail-resize-handle"
                className="absolute -left-2 top-0 hidden h-full w-3 cursor-col-resize xl:block"
                onPointerDown={handleRailResizeStart}
              />
            )}
            {prefs.railCollapsed && (
              /*
               * Shown at every width, because the collapsed state now
               * applies at every width: "r" hides the rail on a narrow
               * screen too, and this is the only way back there (the
               * rail's own collapse button is a desktop affordance).
               */
              <button
                type="button"
                data-testid="replay-rail-expand"
                className="flex h-full w-10 flex-col items-center justify-start gap-2 rounded-lg border border-gray-200 bg-white py-3 text-gray-500 hover:text-gray-800"
                title="Show the events rail"
                onClick={toggleRailCollapsed}
              >
                <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
                <span className="text-[10px] [writing-mode:vertical-rl]">
                  Events {allSignals.length > 0 ? `(${allSignals.length})` : ""}
                </span>
              </button>
            )}
            {/* Stays mounted while collapsed (only hidden) so the rail keeps its state. */}
            <div
              className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
                prefs.railCollapsed ? "hidden" : ""
              }`}
            >
              {railElement}
            </div>
          </div>
        </div>

        {/*
         * Inside the root, not beside it: the details panel is a fixed
         * overlay, and the top layer a fullscreen element creates hides
         * every element that is not its descendant - so rendered as a
         * sibling it was simply invisible in theater mode, with "i" and
         * the "Session details" button doing nothing a viewer could see.
         */}
        <ReplayCorrelationPanel
          isOpen={isPanelOpen}
          onClose={closeDetails}
          activeTabId={prefs.detailsTab}
          onTabChange={(tabId: string): void => {
            if (
              tabId === "session" ||
              tabId === "provenance" ||
              tabId === "fidelity"
            ) {
              replayViewPrefsStore.update({ detailsTab: tabId });
            }
          }}
          sessionId={manifest.sessionId || sessionId}
          details={manifest.details}
          hasRecordingEnded={manifest.hasRecordingEnded}
          fidelityNotices={manifest.fidelityNotices}
          gaps={manifest.gaps}
          onOpenRailTab={openRailTab}
          railCounts={railCounts}
        />
      </div>

      <ReplayOffsetText clock={engine} />
    </Fragment>
  );
};

export default SessionReplayPlayer;
