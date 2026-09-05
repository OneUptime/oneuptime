import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
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
  ReplayRecordedSize,
  ReplayerFactory,
  ReplayerLike,
} from "./Engine/ReplayEngineTypes";
import ReplayStage, { ReplayStageFit } from "./ReplayStage";
import ReplayStageOverlays, { findIdleBandAt } from "./ReplayStageOverlays";
import ReplayHeader, {
  ReplayHeaderFact,
  ReplayHeaderHandle,
  ReplayHeaderTab,
} from "./ReplayHeader";
import ReplayScrubber from "./ReplayScrubber";
import ReplayRail, { ReplayRailHandle } from "./Rail/ReplayRail";
import {
  ReplayBackendSignalsSnapshot,
  ReplayBackendSignalsStore,
  makeIdleBackendSignalsState,
} from "./Rail/ReplayBackendSignals";
import {
  ReplayClockAlignmentState,
  ReplayRailTabId,
  ReplaySignal,
} from "./Rail/ReplaySignalTypes";
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
  parseManifest,
  pickInitialTab,
  tabHasFootage,
} from "./ReplayManifest";
import {
  REPLAY_RAIL_MAX_WIDTH_REM,
  REPLAY_RAIL_MIN_WIDTH_REM,
  ReplayViewPrefs,
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
 * Live sessions re-fetch the manifest this often. The request carries
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

/* ---- Transport. ---- */

async function fetchManifest(args: {
  rumApplicationId: string;
  sessionId: string;
  refresh?: { viewId: string } | undefined;
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
  const [fit, setFit] = useState<ReplayStageFit>("contain");
  const [scale, setScale] = useState<number>(1);
  const [isTheater, setIsTheater] = useState<boolean>(false);
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
  const hasRevealedSignalRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  engineRef.current = engine;
  manifestRef.current = manifest;
  activeTabIdRef.current = activeTabId;

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
    hasRevealedSignalRef.current = false;

    /*
     * INSTANT FEEL: the rrweb download starts at mount, the manifest is
     * fetched alongside it, and the first chunks go on the wire the moment
     * the manifest resolves - before the Replayer has finished arriving.
     */
    const rrwebModulePromise: Promise<RrwebModule> =
      (async (): Promise<RrwebModule> => {
        return (await import("rrweb")) as unknown as RrwebModule;
      })();

    const manifestPromise: Promise<SessionReplayManifest> = fetchManifest({
      rumApplicationId: rumApplicationIdString,
      sessionId: sessionId,
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

    if (moment.source === "at") {
      setShellNotice(
        moment.wasClamped
          ? "The linked moment is outside this recording; opened at the nearest edge"
          : "Opened at the moment of the linked log line",
      );
    } else if (moment.wasClamped) {
      setShellNotice(
        "The linked moment is outside this recording; opened at the nearest edge",
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

  const subscribeToEngine: (listener: ReplayEngineListener) => () => void =
    useCallback(
      (listener: ReplayEngineListener): (() => void) => {
        return engine ? engine.subscribe(listener) : noopUnsubscribe();
      },
      [engine],
    );
  const getEngineSnapshot: () => ReplayEngineSnapshot =
    useCallback((): ReplayEngineSnapshot => {
      return engine ? engine.getSnapshot() : idleSnapshot;
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

        if (!prefs.mouseTrail) {
          try {
            event.replayer.setConfig({ mouseTail: false });
          } catch {
            /* A config rrweb rejects is cosmetic; playback continues. */
          }
        }
      } else if (
        event.type === "destroyed" &&
        replayerRef.current === event.replayer
      ) {
        replayerRef.current = null;
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

  /* ---- Live sessions: re-poll the manifest and append new footage. ---- */

  const isLive: boolean = manifest !== null && !manifest.isFinalized;
  const viewId: string = manifest?.viewId ?? "";

  useEffect(() => {
    if (!isLive) {
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
  }, [isLive, viewId, rumApplicationIdString, sessionId, backendStore]);

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
  const recordingSignals: Array<ReplaySignal> = useMemo(() => {
    const loader: ChunkLoader | null = loaderRef.current;

    if (!engine || !loader) {
      return NO_SIGNALS;
    }

    return fromTimelineEvents(loader.getTimelineEvents(), {
      startTimeUnixMs: startTimeUnixMs,
    });
  }, [
    engine,
    snapshot.loadedChunkIndexes,
    snapshot.generation,
    startTimeUnixMs,
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

  const headerTabs: Array<ReplayHeaderTab> = useMemo(() => {
    if (!manifest) {
      return [];
    }

    return manifest.tabs.map(
      (tab: SessionReplayManifestTab, index: number): ReplayHeaderTab => {
        return {
          tabId: tab.tabId,
          label: `Tab ${index + 1}`,
          durationMs: tab.durationMs,
          openedAtMs: tab.firstChunkStartOffsetMs,
          hasFootage: tabHasFootage(tab),
          isActive: tab.tabId === activeTabId,
        };
      },
    );
  }, [manifest, activeTabId]);

  const continueInTab: ReplayHeaderTab | null = useMemo(() => {
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
      headerTabs.find((tab: ReplayHeaderTab): boolean => {
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
        label: "Browser",
        value: [details.browserName, details.browserVersion]
          .filter(Boolean)
          .join(" "),
      },
      { label: "OS", value: details.osName },
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

  const sealedReason: SealedReasonCopy | null = useMemo(() => {
    return manifest && manifest.isFinalized
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

    const exists: boolean = allSignals.some((signal: ReplaySignal): boolean => {
      return signal.id === urlState.signalId;
    });

    if (!exists) {
      return;
    }

    hasRevealedSignalRef.current = true;

    /*
     * With an explicit moment (t / at) the row is only selected; the
     * pre-roll seek is what a bare ?signal= asks for.
     */
    if (urlState.offsetMs !== null || urlState.atUnixMs !== null) {
      setSelectedSignalId(urlState.signalId);
      return;
    }

    railRef.current.revealSignal(urlState.signalId);
  }, [allSignals, urlState]);

  /* ---- Actions. ---- */

  const seekTo: (offsetMs: number) => void = useCallback(
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

  const playPause: () => void = useCallback((): void => {
    const current: ReplayEngine | null = engineRef.current;

    if (!current) {
      return;
    }

    current.dispatch({
      type: current.getSnapshot().intent === "playing" ? "PAUSE" : "PLAY",
    });
  }, []);

  const watchAgain: () => void = useCallback((): void => {
    seekTo(0);
    engineRef.current?.dispatch({ type: "PLAY" });
  }, [seekTo]);

  const retry: () => void = useCallback((): void => {
    engineRef.current?.dispatch({ type: "RETRY" });
  }, []);

  const stillLoadingRetry: () => void = useCallback((): void => {
    const current: ReplayEngine | null = engineRef.current;

    if (!current) {
      return;
    }

    const latest: ReplayEngineSnapshot = current.getSnapshot();

    if (latest.error && latest.error.retryable) {
      current.dispatch({ type: "RETRY" });
      return;
    }

    /* Nothing halted: a fresh seek to the same offset restarts the fetch. */
    seekTo(latest.currentTimeMs);
  }, [seekTo]);

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
      engineRef.current?.dispatch({ type: "IDLE_SKIP", band: band });
    },
    [],
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
      current.dispatch({ type: "IDLE_SKIP", band: band });
    }
  }, []);

  const switchTab: (tabId: string) => void = useCallback(
    (tabId: string): void => {
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

      const loader: ChunkLoader = createLoader(target);

      if (engineRef.current) {
        loaderRef.current = loader;
        /* TAB_SWITCH preserves the session-clock playhead when the tab covers it. */
        engineRef.current.dispatch({
          type: "TAB_SWITCH",
          tabId: tabId,
          loader: loader,
        });
      } else {
        pendingLoaderRef.current?.dispose();
        pendingLoaderRef.current = loader;
      }

      setActiveTabId(tabId);
    },
    [createLoader],
  );

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
      rail: railTab === "all" ? null : railTab,
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
        rail: railTab === "all" ? null : railTab,
      });

      if (!route) {
        return;
      }

      /* The header owns the copy UI; the row's own hover action is best-effort. */
      void navigator.clipboard
        ?.writeText(`${window.location.origin}${route.toString()}`)
        .catch((): void => {
          /* Denied: the header's Link button offers the visible fallback. */
        });
    },
    [rumApplicationIdString, sessionId, railTab],
  );

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

  if (!manifest) {
    /*
     * Loading: the header's shape, a stage box at a 16:9 aspect, and the
     * rail's own skeleton rows, so the page lays out once and fills in.
     */
    return (
      <div data-testid="replay-loading" className="flex flex-col">
        <div className="mb-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <Skeleton className="h-4" widthVariantIndex={0} />
          <Skeleton className="mt-2 h-4" widthVariantIndex={1} />
        </div>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
          <div className="flex min-w-0 flex-1 flex-col">
            <div
              className="w-full animate-pulse rounded-lg bg-gray-900"
              style={{
                aspectRatio: "16 / 9",
                minHeight: "24rem",
                maxHeight: "70vh",
              }}
              role="status"
              aria-label="Loading the recording"
            />
          </div>
          <div className="w-full shrink-0 xl:w-[30rem]">
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
            />
          </div>
        </div>
      </div>
    );
  }

  const isPlayable: boolean = absence === null;
  const railWidthStyle: React.CSSProperties = (
    prefs.railCollapsed
      ? {}
      : { "--oneuptime-replay-rail-width": `${prefs.railWidthRem}rem` }
  ) as React.CSSProperties;

  const railElement: ReactElement = (
    <ReplayRail
      ref={railRef}
      signals={recordingSignals}
      backendStore={backendStore}
      sessionId={manifest.sessionId || sessionId}
      startTimeUnixMs={startTimeUnixMs}
      clockSkewMs={manifest.details.clockSkewMs}
      isFinalized={manifest.isFinalized}
      isExpiredFootage={!isPlayable}
      isLoading={isPlayable && !engine}
      currentTimeMs={snapshot.currentTimeMs}
      isPlaying={snapshot.phase === "playing"}
      selectedSignalId={selectedSignalId}
      onSeek={seekTo}
      onSelectSignal={selectSignal}
      onHoverSignal={setGhostMs}
      activeTab={railTab}
      onTabChange={handleRailTabChange}
      query={railQuery}
      onQueryChange={setRailQuery}
      follow={prefs.follow}
      onFollowChange={handleFollowChange}
      truncatedKinds={
        loaderRef.current?.getExtractionStats().truncatedKinds ?? null
      }
      loadedChunkCount={
        loaderRef.current?.getExtractedChunkIndexes().length ?? null
      }
      totalChunkCount={chunks.length > 0 ? chunks.length : null}
      recorderCapabilities={manifest.recorderCapabilities}
      onShowOnStage={handleShowOnStage}
      onCopyLink={copySignalLink}
      onTelemetrySignalsChange={handleTelemetrySignalsChange}
      className="h-full"
    />
  );

  return (
    <Fragment>
      <div
        ref={rootRef}
        data-testid="replay-player"
        data-replay-live={isLive ? "true" : "false"}
        className={
          isTheater
            ? "flex h-full flex-col overflow-auto bg-gray-950 p-3"
            : "flex flex-col"
        }
      >
        <ReplayHeader
          ref={headerRef}
          sessionId={manifest.sessionId || sessionId}
          backHref={backHref}
          onBack={goBack}
          identity={{
            label: manifest.details.identifiedUserLabel,
            traits: manifest.details.identifiedUserTraits,
          }}
          facts={facts}
          startTimeUnixMs={startTimeUnixMs}
          currentTimeMs={snapshot.currentTimeMs}
          durationMs={snapshot.durationMs || manifest.durationMs}
          isLive={isLive}
          tabs={headerTabs}
          onSwitchTab={switchTab}
          continueInTab={continueInTab}
          sealedReason={sealedReason}
          isWide={prefs.wide}
          onToggleWide={toggleWide}
          isTheater={isTheater}
          onToggleTheater={toggleTheater}
          onOpenDetails={openDetails}
          buildMomentUrl={buildMomentUrl}
          pinControl={
            <ReplayPinControl
              rumApplicationId={props.rumApplicationId}
              sessionId={sessionId}
            />
          }
        />

        {recordingNotes.length > 0 && (
          <details
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5"
            data-testid="replay-recording-notes"
          >
            <summary className="cursor-pointer text-xs text-amber-800">
              <Icon icon={IconProp.Alert} className="mr-1 inline h-3 w-3" />
              {recordingNotes.length} note
              {recordingNotes.length === 1 ? "" : "s"} about this recording
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
          className="flex flex-col gap-4 xl:flex-row xl:items-stretch"
          style={railWidthStyle}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <ReplayStageOverlays
              snapshot={snapshot}
              signals={recordingSignals}
              chunks={chunks}
              entryUrl={manifest.details.entryUrl}
              recordedSize={recordedSize}
              scale={scale}
              fit={fit}
              onFitChange={setFit}
              onPlayPause={playPause}
              onWatchAgain={watchAgain}
              onRetry={retry}
              onStillLoadingRetry={stillLoadingRetry}
              onSkipIdle={skipIdle}
              getDiagnostic={getDiagnostic}
              continueInTab={continueInTab}
              onSwitchTab={switchTab}
              shellNotice={shellNotice}
              absence={absence}
              sealedReason={sealedReason}
              isLive={isLive}
            >
              {isPlayable && engine && (
                <ReplayStage
                  engine={engine}
                  viewportWidth={manifest.details.viewportWidth}
                  viewportHeight={manifest.details.viewportHeight}
                  isTheater={isTheater}
                  fit={fit}
                  onScaleChange={setScale}
                />
              )}
              {isPlayable && !engine && (
                <div
                  className="w-full animate-pulse rounded-lg bg-gray-900"
                  style={{
                    aspectRatio:
                      recordedSize && recordedSize.height > 0
                        ? `${recordedSize.width} / ${recordedSize.height}`
                        : "16 / 9",
                    minHeight: "24rem",
                    maxHeight: "70vh",
                  }}
                  role="status"
                  aria-label="Loading the replay engine"
                  data-testid="replay-stage-placeholder"
                />
              )}
            </ReplayStageOverlays>

            {isPlayable && (
              <div className="mt-3">
                <ReplayScrubber
                  snapshot={snapshot}
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
                />
              </div>
            )}

            {captureNotes.length > 0 && (
              <details
                className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5"
                data-testid="replay-capture-notes"
              >
                <summary className="cursor-pointer text-xs text-gray-500">
                  {captureNotes.length} capture note
                  {captureNotes.length === 1 ? "" : "s"}:{" "}
                  {captureNotes
                    .map((note: FidelityNoticeCopy): string => {
                      return note.title.toLowerCase();
                    })
                    .join(", ")}
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
           */}
          <div
            ref={railContainerRef}
            data-testid="replay-rail-column"
            data-collapsed={prefs.railCollapsed ? "true" : "false"}
            className={`relative flex w-full shrink-0 ${
              prefs.railCollapsed
                ? "xl:w-10"
                : isTheater
                  ? "xl:w-[22rem]"
                  : "xl:w-[var(--oneuptime-replay-rail-width,30rem)]"
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
              <button
                type="button"
                data-testid="replay-rail-expand"
                className="hidden h-full w-10 flex-col items-center justify-start gap-2 rounded-lg border border-gray-200 bg-white py-3 text-gray-500 hover:text-gray-800 xl:flex"
                title="Show the events rail"
                onClick={toggleRailCollapsed}
              >
                <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
                <span className="text-[10px] [writing-mode:vertical-rl]">
                  Events {allSignals.length > 0 ? `(${allSignals.length})` : ""}
                </span>
              </button>
            )}
            {/* Stays mounted while collapsed (hidden on xl only) so the rail keeps its state. */}
            <div
              className={`flex min-w-0 flex-1 flex-col ${
                prefs.railCollapsed ? "xl:hidden" : ""
              }`}
            >
              {!prefs.railCollapsed && (
                <div className="mb-1 hidden justify-end xl:flex">
                  <button
                    type="button"
                    data-testid="replay-rail-collapse"
                    className="rounded px-1.5 py-0.5 text-[11px] text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="Collapse the events rail"
                    onClick={toggleRailCollapsed}
                  >
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="inline h-3 w-3"
                    />{" "}
                    Collapse
                  </button>
                </div>
              )}
              {railElement}
            </div>
          </div>
        </div>
      </div>

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
        fidelityNotices={manifest.fidelityNotices}
        missingAssets={[]}
        gaps={manifest.gaps}
        onOpenRailTab={openRailTab}
        railCounts={railCounts}
      />

      {/* The playhead as text for assistive tech, at a calm cadence. */}
      <span
        className="sr-only"
        aria-live="off"
        data-testid="replay-offset-text"
      >
        {formatReplayOffset(snapshot.currentTimeMs)}
      </span>
    </Fragment>
  );
};

export default SessionReplayPlayer;
