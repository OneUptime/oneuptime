import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import {
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "Common/Types/Rum/SessionReplay";
import ChunkLoader, {
  ReplayTimelineEvent,
  SessionReplayRecordedEvent,
} from "./ChunkLoader";
import ReplayDevtoolsPanel from "./ReplayDevtoolsPanel";
import ReplayPinControl from "./ReplayPinControl";
import { getFidelityNoticeCopy } from "./FidelityNoticeCopy";
import ReplayStage, {
  ReplaySeekRequest,
  ReplayerFactory,
  ReplayerLike,
} from "./ReplayStage";
import ReplayScrubber, {
  ReplayBand,
  ReplayBandState,
  ReplayMarker,
} from "./ReplayScrubber";
import ReplayCorrelationPanel, {
  ReplaySessionDetails,
} from "./ReplayCorrelationPanel";

/*
 * The loader half of the player: manifest, authenticated chunk transport, the
 * single lazy rrweb import, and the assembly of stage + scrubber + panel.
 *
 * Fetch shape copied from Components/Profiles/ProfileFlamegraph.tsx, including
 * its loadGenerationRef staleness guard.
 *
 * THIS IS THE ONLY FILE IN THE DASHBOARD THAT MAY REFERENCE rrweb, and only
 * through the dynamic import below. Common/UI/esbuild-config.js hardcodes
 * minify:false with splitting:true and format esm, so the dynamic import
 * lands the ~450KB Replayer in its own lazily fetched chunk. A single
 * top-level `import { Replayer } from "rrweb"` anywhere would move all of it
 * into the shared chunk downloaded by every user who never opens a replay.
 */

const MANIFEST_ROUTE: string = "/telemetry/rum/session-replay/manifest";
const CHUNKS_ROUTE: string = "/telemetry/rum/session-replay/chunks";
const HEARTBEAT_ROUTE: string = "/telemetry/rum/session-replay/heartbeat";

/* Matches the server-side throttle; anything finer is discarded there. */
const HEARTBEAT_INTERVAL_MS: number = 15 * 1000;

/*
 * Per-chunk manifest row.
 *
 * The signal counters are projected by the manifest endpoint's SELECT
 * (Common/Server/Utils/SessionReplay/SessionReplayReadService.getManifest)
 * and feed the frustration, error and route lanes plus the "next error"
 * jump. They are still read defensively (missing -> 0) so a manifest from
 * an older server renders as an empty lane rather than a parse failure.
 */
export type SessionReplayManifestChunk = SessionReplayChunkManifestEntry;

export interface SessionReplayManifestTab {
  tabId: string;
  chunks: Array<SessionReplayManifestChunk>;
  gaps: Array<SessionReplayGap>;
}

export interface SessionReplayManifest {
  /*
   * The audit row the manifest read just created. Every heartbeat advances
   * THIS row; the endpoint takes a viewId and nothing else identifies it.
   */
  viewId: string;
  sessionId: string;
  durationMs: number;
  isFinalized: boolean;
  sealedReason: string;
  /* True when the chunk index itself was cut short server-side. */
  isChunkIndexTruncated: boolean;
  tabs: Array<SessionReplayManifestTab>;
  gaps: Array<SessionReplayGap>;
  fidelityNotices: Array<string>;
  missingAssets: Array<string>;
  details: ReplaySessionDetails;
  /*
   * Exact-timestamp network markers from the manifest endpoint. Still not
   * produced there; the player now derives its network lane from the
   * type-5 custom events the ChunkLoader extracts, which are exact to the
   * recorder's clock. Kept on the type so a future server-side producer
   * slots in without a shape change.
   */
  networkMarkers: Array<ReplayMarker>;
}

function readNumber(row: JSONObject, key: string): number {
  const parsed: number = Number(row[key]);

  return isFinite(parsed) ? parsed : 0;
}

function readString(row: JSONObject, key: string): string {
  const value: unknown = row[key];

  return value === null || value === undefined ? "" : String(value);
}

function readStringArray(row: JSONObject, key: string): Array<string> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry: unknown): string => {
    return String(entry);
  });
}

function parseManifestChunk(row: JSONObject): SessionReplayManifestChunk {
  return {
    chunkIndex: readNumber(row, "chunkIndex"),
    tabId: readString(row, "tabId"),
    chunkStartOffsetMs: readNumber(row, "chunkStartOffsetMs"),
    chunkEndOffsetMs: readNumber(row, "chunkEndOffsetMs"),
    eventCount: readNumber(row, "eventCount"),
    hasFullSnapshot:
      row["hasFullSnapshot"] === true ||
      row["hasFullSnapshot"] === 1 ||
      row["hasFullSnapshot"] === "1",
    payloadBytes: readNumber(row, "payloadBytes"),
    errorCount: readNumber(row, "errorCount"),
    rageClickCount: readNumber(row, "rageClickCount"),
    deadClickCount: readNumber(row, "deadClickCount"),
    errorClickCount: readNumber(row, "errorClickCount"),
    refreshRageCount: readNumber(row, "refreshRageCount"),
    routeCount: readNumber(row, "routeCount"),
  };
}

function readBoolean(row: JSONObject, key: string): boolean {
  const value: unknown = row[key];

  // ClickHouse UInt8 booleans arrive as 0/1, sometimes as the strings "0"/"1".
  return value === true || value === 1 || value === "1";
}

function parseGap(row: JSONObject): SessionReplayGap {
  return {
    fromIndex: readNumber(row, "fromIndex"),
    toIndex: readNumber(row, "toIndex"),
    missingMs: readNumber(row, "missingMs"),
  };
}

/*
 * Maps the /manifest response onto what the player needs.
 *
 * The endpoint answers { viewId, header, tabs, isChunkIndexTruncated }: the
 * session-level facts live under `header`, and gaps are per TAB rather than
 * per session because chunkIndex is minted per tab. This function is the one
 * place that knows that shape.
 */
function parseManifest(data: JSONObject): SessionReplayManifest {
  const header: JSONObject = (data["header"] as JSONObject) || {};
  const tabRows: JSONArray = (data["tabs"] as JSONArray) || [];
  const networkRows: JSONArray = (data["networkMarkers"] as JSONArray) || [];

  const tabs: Array<SessionReplayManifestTab> = tabRows.map(
    (row: JSONObject): SessionReplayManifestTab => {
      const chunkRows: JSONArray = (row["chunks"] as JSONArray) || [];
      const tabGapRows: JSONArray = (row["gaps"] as JSONArray) || [];

      return {
        tabId: readString(row, "tabId"),
        chunks: chunkRows.map(parseManifestChunk),
        gaps: tabGapRows.map(parseGap),
      };
    },
  );

  return {
    viewId: readString(data, "viewId"),
    sessionId: readString(header, "sessionId"),
    durationMs: readNumber(header, "durationMs"),
    isFinalized: readBoolean(header, "isFinalized"),
    sealedReason: readString(header, "sealedReason"),
    isChunkIndexTruncated: readBoolean(data, "isChunkIndexTruncated"),
    tabs: tabs,
    /*
     * Every tab's holes, so the notice count and the correlation panel
     * describe the whole recording rather than whichever tab is on screen.
     */
    gaps: tabs.flatMap(
      (tab: SessionReplayManifestTab): Array<SessionReplayGap> => {
        return tab.gaps;
      },
    ),
    fidelityNotices: readStringArray(header, "fidelityNotices"),
    /*
     * Not part of the manifest response. Left empty rather than inferred:
     * claiming an asset was captured when nothing says so is worse than
     * saying nothing.
     */
    missingAssets: [],
    networkMarkers: networkRows.map((row: JSONObject): ReplayMarker => {
      return {
        atMs: readNumber(row, "atMs"),
        label: readString(row, "label"),
      };
    }),
    details: {
      entryUrl: readString(header, "entryUrl"),
      exitUrl: readString(header, "exitUrl"),
      browserName: readString(header, "browserName"),
      browserVersion: readString(header, "browserVersion"),
      osName: readString(header, "osName"),
      deviceType: readString(header, "deviceType"),
      countryCode: readString(header, "countryCode"),
      /*
       * The header projection has no identity column - the raw end-user
       * identifier has a narrower ACL and is only served by /list, to
       * callers holding it. Blank here means pseudonymous to the panel.
       */
      identifiedUserLabel: "",
      maskingMode: readString(header, "maskingMode"),
      consentState: readString(header, "consentState"),
      triggerReason: readString(header, "triggerReason"),
      recorderVersion: readString(header, "recorderVersion"),
      rrwebVersion: readString(header, "rrwebVersion"),
      viewportWidth: readNumber(header, "viewportWidth"),
      viewportHeight: readNumber(header, "viewportHeight"),
      clockSkewMs: readNumber(header, "clockSkewMs"),
      payloadBytes: readNumber(header, "payloadBytes"),
      startTime: readString(header, "startTime"),
      endTime: readString(header, "endTime"),
      traceIds: readStringArray(header, "traceIds"),
      exceptionFingerprints: readStringArray(header, "exceptionFingerprints"),
    },
  };
}

export interface SessionReplayPlayerProps {
  rumApplicationId: ObjectID;
  sessionId: string;
  /* Deep-link start position in seconds, from the ?t= query param. */
  initialOffsetSeconds?: number | undefined;
}

const SessionReplayPlayer: FunctionComponent<SessionReplayPlayerProps> = (
  props: SessionReplayPlayerProps,
): ReactElement => {
  const [manifest, setManifest] = useState<SessionReplayManifest | null>(null);
  const [replayerFactory, setReplayerFactory] =
    useState<ReplayerFactory | null>(null);
  const [activeTabId, setActiveTabId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [stageError, setStageError] = useState<string>("");

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1);
  const [skipInactive, setSkipInactive] = useState<boolean>(true);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [seekRequest, setSeekRequest] = useState<ReplaySeekRequest | null>(
    null,
  );
  const [loadedChunkIndexes, setLoadedChunkIndexes] = useState<Array<number>>(
    [],
  );
  const [crossedGaps, setCrossedGaps] = useState<Array<SessionReplayGap>>([]);
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(false);
  const [panelTabId, setPanelTabId] = useState<string>("session");
  const [timelineEvents, setTimelineEvents] = useState<
    Array<ReplayTimelineEvent>
  >([]);
  const [areEventsTruncated, setAreEventsTruncated] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [isPermalinkCopied, setIsPermalinkCopied] = useState<boolean>(false);
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);

  const theaterRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);

  /*
   * Navigation.getLastParamAsObjectID mints a NEW ObjectID on every call, and
   * the page component recomputes it every render, so props.rumApplicationId
   * is a different object identity each time even though the id never
   * changes. Keying anything on the object itself - fetchChunks, the loader
   * memo - would dispose the ChunkLoader and restart playback from the top on
   * any unrelated parent re-render. Everything below keys on the string.
   */
  const rumApplicationIdString: string = props.rumApplicationId.toString();

  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  const seekTokenRef: React.MutableRefObject<number> = useRef<number>(0);
  /* Highest offset actually reached, which is what secondsWatched means. */
  const watchedMsRef: React.MutableRefObject<number> = useRef<number>(0);

  const load: (generation: number) => Promise<void> = useCallback(
    async (generation: number): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

        /*
         * The manifest request is also the audit event - the server writes a
         * RumSessionReplayView row for it. That is why the payload endpoint
         * is never called first: the record of who watched must exist before
         * a single recorded byte is served.
         */
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              MANIFEST_ROUTE,
            ),
            data: {
              rumApplicationId: rumApplicationIdString,
              sessionId: props.sessionId,
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (generation !== loadGenerationRef.current) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const parsed: SessionReplayManifest = parseManifest(response.data);

        /*
         * Loaded only once the manifest proves there is something to play.
         * Fetching 450KB of Replayer for a session whose chunks have already
         * expired would be pure waste on the most common failure path.
         */
        const rrweb: { Replayer: unknown } = (await import(
          "rrweb"
        )) as unknown as {
          Replayer: unknown;
        };

        if (generation !== loadGenerationRef.current) {
          return;
        }

        const ReplayerConstructor: new (
          events: Array<SessionReplayRecordedEvent>,
          config: Record<string, unknown>,
        ) => ReplayerLike = rrweb.Replayer as new (
          events: Array<SessionReplayRecordedEvent>,
          config: Record<string, unknown>,
        ) => ReplayerLike;

        setManifest(parsed);
        /*
         * The first tab that actually has footage, not simply the first tab.
         * A duplicated tab mints a tabId before anything is flushed, and one
         * tab's chunks can expire before another's, so tabs[0] is routinely
         * empty on a session that plays perfectly well.
         */
        setActiveTabId(
          parsed.tabs.find((tab: SessionReplayManifestTab): boolean => {
            return tab.chunks.length > 0;
          })?.tabId ??
            parsed.tabs[0]?.tabId ??
            "",
        );
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
        if (generation === loadGenerationRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [rumApplicationIdString, props.sessionId],
  );

  useEffect(() => {
    loadGenerationRef.current += 1;
    void load(loadGenerationRef.current);

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const activeTab: SessionReplayManifestTab | null = useMemo(() => {
    if (!manifest) {
      return null;
    }

    return (
      manifest.tabs.find((tab: SessionReplayManifestTab): boolean => {
        return tab.tabId === activeTabId;
      }) ??
      manifest.tabs[0] ??
      null
    );
  }, [manifest, activeTabId]);

  /*
   * Authenticated binary transport for chunk payloads.
   *
   * fetch rather than the shared API util: the response is
   * application/octet-stream and the axios-based helper deserialises JSON.
   * Same-origin credentials carry the session cookie exactly as every other
   * Dashboard request does.
   */
  const fetchChunks: (request: {
    sessionId: string;
    tabId: string;
    chunkIndexes: Array<number>;
  }) => Promise<ArrayBuffer> = useCallback(
    async (request: {
      sessionId: string;
      tabId: string;
      chunkIndexes: Array<number>;
    }): Promise<ArrayBuffer> => {
      const headers: Dictionary<string> = {
        ...ModelAPI.getCommonHeaders(),
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      };

      const response: Response = await fetch(
        URL.fromString(APP_API_URL.toString())
          .addRoute(CHUNKS_ROUTE)
          .toString(),
        {
          method: "POST",
          headers: headers,
          credentials: "same-origin",
          body: JSON.stringify({
            rumApplicationId: rumApplicationIdString,
            sessionId: request.sessionId,
            tabId: request.tabId,
            chunkIndexes: request.chunkIndexes,
          }),
        },
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

  const loader: ChunkLoader | null = useMemo(() => {
    if (!activeTab || activeTab.chunks.length === 0) {
      return null;
    }

    /*
     * One loader per tab, and only one tab plays at a time. chunkIndex is
     * minted per tab and rrweb node ids are per document, so two tabs are two
     * independent recordings that merely share a sessionId - interleaving
     * them into one Replayer would resolve mutations against the wrong nodes.
     */
    return new ChunkLoader({
      sessionId: props.sessionId,
      tabId: activeTab.tabId,
      entries: activeTab.chunks,
      fetcher: fetchChunks,
    });
    /*
     * activeTab is a memo over manifest+activeTabId, both of which only
     * change when there is genuinely a different tab to play.
     */
  }, [activeTab, props.sessionId, fetchChunks]);

  useEffect(() => {
    return () => {
      loader?.dispose();
    };
  }, [loader]);

  /* Reset transport-derived UI whenever the tab (and therefore loader) changes. */
  useEffect(() => {
    setCrossedGaps([]);
    setLoadedChunkIndexes([]);
    setStageError("");
    setCurrentTimeMs(0);
    setTimelineEvents([]);
    setAreEventsTruncated(false);
    /*
     * isBuffering is deliberately NOT reset here: the stage's initial
     * build effect (keyed on the same loader, and run BEFORE this parent
     * effect) has already asserted buffering=true, and buildSegment's
     * generation-guarded finally owns clearing it.
     */
    watchedMsRef.current = 0;
  }, [loader]);

  /*
   * Timeline events are extracted as chunks are admitted, so the loaded
   * set changing is exactly the signal that new events may exist. Pulled
   * rather than pushed: the loader stays a plain class with no React.
   */
  useEffect(() => {
    if (!loader) {
      return;
    }

    setTimelineEvents(loader.getTimelineEvents());
    setAreEventsTruncated(loader.areTimelineEventsTruncated());
  }, [loader, loadedChunkIndexes]);

  /*
   * Native fullscreen for theater mode. State follows the DOCUMENT's
   * fullscreen element rather than the button, so Esc — which exits
   * fullscreen without consulting us — cannot leave the toggle lying.
   */
  useEffect(() => {
    const onFullscreenChange: () => void = (): void => {
      setIsTheaterMode(document.fullscreenElement === theaterRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  /* Honour the ?t= deep link once, after the loader exists. */
  const hasAppliedInitialSeekRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (
      !loader ||
      hasAppliedInitialSeekRef.current ||
      props.initialOffsetSeconds === undefined ||
      props.initialOffsetSeconds <= 0
    ) {
      return;
    }

    hasAppliedInitialSeekRef.current = true;
    seekTokenRef.current += 1;
    setSeekRequest({
      offsetMs: props.initialOffsetSeconds * 1000,
      token: seekTokenRef.current,
    });
  }, [loader, props.initialOffsetSeconds]);

  const seekTo: (offsetMs: number) => void = useCallback(
    (offsetMs: number): void => {
      seekTokenRef.current += 1;
      setCurrentTimeMs(offsetMs);
      /*
       * A stale stage error must not outlive the action that recovers
       * from it: seeking rebuilds the segment, and keeping the old
       * banner up makes a successful rebuild look broken.
       */
      setStageError("");
      setSeekRequest({ offsetMs: offsetMs, token: seekTokenRef.current });
    },
    [],
  );

  const copyPermalink: () => void = useCallback((): void => {
    /*
     * The permalink is the CURRENT page address with the playhead stamped
     * into ?t= — the parameter the player already honours on load. Kept as
     * whole seconds: sub-second precision implies an exactness the seek
     * anchors cannot deliver.
     */
    const url: globalThis.URL = new globalThis.URL(window.location.href);

    url.searchParams.set("t", String(Math.floor(currentTimeMs / 1000)));

    void navigator.clipboard
      ?.writeText(url.toString())
      .then((): void => {
        setIsPermalinkCopied(true);

        setTimeout((): void => {
          setIsPermalinkCopied(false);
        }, 2000);
      })
      .catch((): void => {
        /* Clipboard denied: nothing useful to do beyond not crashing. */
      });
  }, [currentTimeMs]);

  const toggleTheaterMode: () => void = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch((): void => {
        /* Ignored: the fullscreenchange listener owns the state. */
      });
      return;
    }

    void theaterRef.current?.requestFullscreen?.().catch((): void => {
      /* Fullscreen denied (iframe policy, user setting). Stay inline. */
    });
  }, []);

  const handleTimeUpdate: (offsetMs: number) => void = useCallback(
    (offsetMs: number): void => {
      setCurrentTimeMs(offsetMs);
      watchedMsRef.current = Math.max(watchedMsRef.current, offsetMs);
    },
    [],
  );

  /*
   * Watch-time heartbeat. Fire-and-forget on purpose: a failed heartbeat must
   * never interrupt playback, and the audit row already exists from the
   * manifest call - this only refines how long it was watched for.
   */
  const viewId: string = manifest?.viewId ?? "";

  useEffect(() => {
    /*
     * The endpoint identifies the audit row by viewId and nothing else, so
     * without one from the manifest response there is no row to advance and
     * the request would only be a guaranteed 400.
     */
    if (!viewId) {
      return;
    }

    const timer: ReturnType<typeof setInterval> = setInterval((): void => {
      const secondsWatched: number = Math.round(watchedMsRef.current / 1000);

      if (secondsWatched <= 0) {
        return;
      }

      void API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(HEARTBEAT_ROUTE),
        data: {
          viewId: viewId,
          secondsWatched: secondsWatched,
        },
        headers: {
          ...ModelAPI.getCommonHeaders(),
        },
      }).catch(() => {
        // Deliberately ignored - see comment above.
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [viewId]);

  const durationMs: number = loader?.getDurationMs() ?? 0;

  const bands: Array<ReplayBand> = useMemo(() => {
    if (!loader) {
      return [];
    }

    const loaded: Set<number> = new Set<number>(loadedChunkIndexes);
    const entries: Array<SessionReplayChunkManifestEntry> = loader.getEntries();
    const result: Array<ReplayBand> = [];

    for (let i: number = 0; i < entries.length; i++) {
      const entry: SessionReplayChunkManifestEntry | undefined = entries[i];

      if (!entry) {
        continue;
      }

      result.push({
        startMs: entry.chunkStartOffsetMs,
        endMs: entry.chunkEndOffsetMs,
        state: loaded.has(entry.chunkIndex)
          ? ReplayBandState.Loaded
          : ReplayBandState.Available,
      });

      const next: SessionReplayChunkManifestEntry | undefined = entries[i + 1];

      if (next && next.chunkIndex !== entry.chunkIndex + 1) {
        result.push({
          startMs: entry.chunkEndOffsetMs,
          endMs: next.chunkStartOffsetMs,
          state: ReplayBandState.Missing,
          missingMs: Math.max(
            0,
            next.chunkStartOffsetMs - entry.chunkEndOffsetMs,
          ),
        });
      }
    }

    return result;
  }, [loader, loadedChunkIndexes]);

  /*
   * Markers derived from the per-chunk counters. Accurate to one flush
   * interval (15s), not to the millisecond - the counters live on the chunk
   * row precisely so the timeline can be drawn without decompressing
   * payloads. The label says so rather than implying a precision we do not
   * have.
   */
  const chunkMarkers: {
    errors: Array<ReplayMarker>;
    frustration: Array<ReplayMarker>;
    routes: Array<ReplayMarker>;
  } = useMemo(() => {
    const errors: Array<ReplayMarker> = [];
    const frustration: Array<ReplayMarker> = [];
    const routes: Array<ReplayMarker> = [];

    for (const chunk of activeTab?.chunks ?? []) {
      const atMs: number =
        (chunk.chunkStartOffsetMs + chunk.chunkEndOffsetMs) / 2;

      if (chunk.errorCount > 0) {
        errors.push({
          atMs: atMs,
          label: `${chunk.errorCount} error${
            chunk.errorCount === 1 ? "" : "s"
          } in this ~15s window`,
        });
      }

      const frustrationCount: number =
        chunk.rageClickCount + chunk.deadClickCount + chunk.errorClickCount;

      if (frustrationCount + chunk.refreshRageCount > 0) {
        frustration.push({
          atMs: atMs,
          label: `${chunk.rageClickCount} rage · ${chunk.deadClickCount} dead · ${chunk.errorClickCount} error clicks · ${chunk.refreshRageCount} refresh rage`,
        });
      }

      if (chunk.routeCount > 0) {
        routes.push({
          atMs: atMs,
          label: `${chunk.routeCount} route change${
            chunk.routeCount === 1 ? "" : "s"
          }`,
        });
      }
    }

    return { errors: errors, frustration: frustration, routes: routes };
  }, [activeTab]);

  /*
   * Exact-timestamp network markers, from the extracted timeline events.
   * 4xx/5xx only — 2xx noise would make the lane useless. This replaces
   * the manifest's never-produced markers with positions accurate to the
   * recorder's own clock, filling in as chunks load.
   */
  const networkMarkers: Array<ReplayMarker> = useMemo(() => {
    return timelineEvents
      .filter((event: ReplayTimelineEvent): boolean => {
        return event.kind === "network" && (event.status ?? 0) >= 400;
      })
      .map((event: ReplayTimelineEvent): ReplayMarker => {
        return {
          atMs: event.offsetMs,
          label: `${event.method ?? ""} ${event.status ?? ""} ${
            event.url ?? ""
          }`.trim(),
        };
      });
  }, [timelineEvents]);

  const jumpToNextError: () => void = useCallback((): void => {
    const next: ReplayMarker | undefined = chunkMarkers.errors.find(
      (marker: ReplayMarker): boolean => {
        return marker.atMs > currentTimeMs;
      },
    );

    if (next) {
      /*
       * Land a little before the marker. The counter is per chunk, so the
       * error happened somewhere inside that window and starting at its
       * midpoint would often begin after the interesting part.
       */
      seekTo(Math.max(0, next.atMs - 10000));
    }
  }, [chunkMarkers.errors, currentTimeMs, seekTo]);

  const handleGapCrossed: (gap: SessionReplayGap) => void = useCallback(
    (gap: SessionReplayGap): void => {
      setCrossedGaps(
        (existing: Array<SessionReplayGap>): Array<SessionReplayGap> => {
          const isKnown: boolean = existing.some(
            (candidate: SessionReplayGap): boolean => {
              return (
                candidate.fromIndex === gap.fromIndex &&
                candidate.toIndex === gap.toIndex
              );
            },
          );

          return isKnown ? existing : [...existing, gap];
        },
      );
    },
    [],
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={(): void => {
          loadGenerationRef.current += 1;
          void load(loadGenerationRef.current);
        }}
      />
    );
  }

  if (!manifest) {
    return <ErrorMessage message="This session could not be found." />;
  }

  /*
   * Built before the "no recording" early return, not inside the happy path.
   * A session whose FIRST tab has no chunks is otherwise a dead end: the
   * viewer is told the whole recording is gone with no control to reach the
   * tab that does have footage.
   */
  const tabSwitcher: ReactElement | null =
    manifest.tabs.length > 1 ? (
      <div className="inline-flex gap-1">
        {manifest.tabs.map((tab: SessionReplayManifestTab): ReactElement => {
          const isActive: boolean = tab.tabId === activeTabId;

          return (
            <button
              key={tab.tabId}
              type="button"
              className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                isActive
                  ? "bg-indigo-100 text-indigo-800 ring-indigo-200"
                  : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
              }`}
              title={
                tab.chunks.length === 0
                  ? "No recording available for this tab"
                  : `${tab.chunks.length} chunks`
              }
              onClick={(): void => {
                setActiveTabId(tab.tabId);
              }}
            >
              Tab {tab.tabId.slice(0, 6)}
              {tab.chunks.length === 0 ? " (empty)" : ""}
            </button>
          );
        })}
      </div>
    ) : null;

  if (!loader || !replayerFactory || !activeTab) {
    /*
     * The header row survives longer than the chunks under the metadata-only
     * retention tier, so "expired" is a normal outcome and gets its own copy
     * rather than a generic error.
     */
    return (
      <Fragment>
        {tabSwitcher && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {tabSwitcher}
          </div>
        )}
        <ErrorMessage
          message={
            activeTab &&
            activeTab.chunks.length === 0 &&
            manifest.tabs.length > 1
              ? "No recording was stored for this tab. Try another tab of this session."
              : "The recording for this session is no longer available. Session metadata is retained for longer than the recording itself, so the counts and signals on the session list remain accurate."
          }
        />
      </Fragment>
    );
  }

  const notices: Array<string> = [];

  if (!manifest.isFinalized) {
    notices.push(
      "This session is still being recorded or has not been finalized yet. Counts and duration may change.",
    );
  }

  if (manifest.isChunkIndexTruncated) {
    notices.push(
      "This session has more chunks than the index can return, so the timeline below stops short of the full recording.",
    );
  }

  if (manifest.gaps.length > 0) {
    notices.push(
      `${manifest.gaps.length} gap${
        manifest.gaps.length === 1 ? "" : "s"
      } in this recording. Playback jumps forward at each one instead of guessing what happened.`,
    );
  }

  for (const notice of manifest.fidelityNotices) {
    notices.push(getFidelityNoticeCopy(notice).title);
  }

  return (
    <Fragment>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {tabSwitcher}

        <div className="text-xs text-gray-500">
          {manifest.details.startTime
            ? OneUptimeDate.getDateAsLocalFormattedString(
                OneUptimeDate.fromString(manifest.details.startTime),
              )
            : ""}
        </div>

        {isBuffering && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
            Buffering…
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ReplayPinControl
            rumApplicationId={props.rumApplicationId}
            sessionId={props.sessionId}
          />

          <Button
            title={isPermalinkCopied ? "Copied!" : "Copy link at this moment"}
            icon={IconProp.Link}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={copyPermalink}
          />

          <Button
            title={isTheaterMode ? "Exit theater" : "Theater"}
            icon={IconProp.Window}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={toggleTheaterMode}
          />

          <Button
            title="Session details"
            icon={IconProp.Info}
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={(): void => {
              setIsPanelOpen(true);
            }}
          />
        </div>
      </div>

      {notices.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          {notices.map((notice: string, index: number): ReactElement => {
            return (
              <div
                key={index}
                className="flex items-start gap-2 py-0.5 text-xs text-amber-800"
              >
                <Icon icon={IconProp.Alert} className="mt-0.5 h-3 w-3" />
                <span>{notice}</span>
              </div>
            );
          })}
        </div>
      )}

      {crossedGaps.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-amber-800">
          {crossedGaps.map(
            (gap: SessionReplayGap, index: number): ReactElement => {
              return (
                <div key={index}>
                  Skipped {Math.round(gap.missingMs / 1000)}s of missing
                  recording between chunk {gap.fromIndex} and {gap.toIndex}.
                </div>
              );
            },
          )}
        </div>
      )}

      {stageError && (
        <div className="mb-4">
          <ErrorMessage message={stageError} />
        </div>
      )}

      <div
        ref={theaterRef}
        className={isTheaterMode ? "flex flex-col bg-white p-4" : ""}
      >
        <ReplayStage
          loader={loader}
          replayerFactory={replayerFactory}
          isPlaying={isPlaying}
          speed={speed}
          skipInactive={skipInactive}
          seekRequest={seekRequest}
          onTimeUpdate={handleTimeUpdate}
          onPlayingChange={setIsPlaying}
          onGapCrossed={handleGapCrossed}
          onLoadedChunkIndexesChange={setLoadedChunkIndexes}
          onError={setStageError}
          onBufferingChange={setIsBuffering}
        />

        <div className="mt-3">
          <ReplayScrubber
            durationMs={durationMs}
            currentTimeMs={currentTimeMs}
            isPlaying={isPlaying}
            speed={speed}
            skipInactive={skipInactive}
            bands={bands}
            frustrationMarkers={chunkMarkers.frustration}
            errorMarkers={chunkMarkers.errors}
            networkMarkers={networkMarkers}
            routeMarkers={chunkMarkers.routes}
            onSeek={seekTo}
            onPlayPauseToggle={(): void => {
              setIsPlaying((existing: boolean): boolean => {
                return !existing;
              });
            }}
            onSpeedChange={setSpeed}
            onSkipInactiveChange={setSkipInactive}
            onJumpToNextError={jumpToNextError}
            areShortcutsEnabled={!isPanelOpen}
          />
        </div>

        <ReplayDevtoolsPanel
          events={timelineEvents}
          isTruncated={areEventsTruncated}
          currentTimeMs={currentTimeMs}
          onSeek={seekTo}
        />
      </div>

      <ReplayCorrelationPanel
        isOpen={isPanelOpen}
        onClose={(): void => {
          setIsPanelOpen(false);
        }}
        activeTabId={panelTabId}
        onTabChange={setPanelTabId}
        sessionId={manifest.sessionId}
        details={manifest.details}
        fidelityNotices={manifest.fidelityNotices}
        missingAssets={manifest.missingAssets}
        gaps={manifest.gaps}
      />
    </Fragment>
  );
};

export default SessionReplayPlayer;
