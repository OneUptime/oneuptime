import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import { getRumApplicationConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationClient from "Common/Models/DatabaseModels/RumApplicationClient";
import {
  RumApplicationStatusDescription,
  describeRumApplicationStatus,
} from "Common/Types/Rum/RumApplicationStatus";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import OneUptimeDate from "Common/Types/Date";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
import {
  getCountedSpansRoute,
  getFailedSpansRoute,
} from "../../../Components/TelemetryResource/FailedSpansRoute";
import { TraceSpanType } from "Common/Types/Telemetry/TraceSpanType";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import WebVitalsCard from "../../../Components/TelemetryResource/WebVitalsCard";
import WebVitalRouteBreakdownCard from "../../../Components/TelemetryResource/WebVitalRouteBreakdownCard";
import {
  fetchLogAndExceptionSignals,
  fetchSpanMetrics,
  fetchSpanNameStats,
  fetchWebVitalByRoute,
  fetchWebVitals,
  formatCompact,
  formatDurationMsInLanguage,
  formatPercent,
  LogAndExceptionSignals,
  SpanMetrics,
  SpanNameStats,
  WebVital,
  WebVitalByRoute,
} from "../../../Components/TelemetryResource/telemetryMetrics";
import { RUM_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/RumMetricDescriptions";
import {
  fetchSessionReplayList,
  SessionReplayListResult,
} from "../../../Components/SessionReplay/SessionReplayTable";
import isReplayOnlyInstrumented from "../../../Components/SessionReplay/RumInstrumentation";
import useSessionReplayHealth, {
  UseSessionReplayHealthResult,
} from "../../../Components/SessionReplay/useSessionReplayHealth";
import {
  buildRangedListRoute,
  describeExceptionsTile,
  describePageLoadsTile,
  describePageLoadTimeTile,
  describeRecordingHealthRow,
  describeTimeRangeForTile,
  PAGE_LOAD_SPAN_NAME,
  sumTimeSeries,
  TileText,
} from "./OverviewHelpers";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import {
  diagnoseRumSignal,
  getWebVitalsCheckWindow,
  RumApplicationArrivalFacts,
  RumSignalDiagnosis,
} from "../../../Components/Rum/SetupCheck/RumSignalDiagnosis";
import {
  getRumApplicationArrivalFacts,
  getRumClientKind,
  getRumRetentionInDays,
  RUM_SIGNAL_APPLICATION_SELECT,
  toDateOrNull,
} from "../../../Components/Rum/SetupCheck/RumSignalFacts";
import {
  fetchNewestRumExceptionAt,
  fetchNewestRumWebVitalAt,
} from "../../../Components/Rum/SetupCheck/RumSignalReads";
import {
  getRumSignalEmptyCopy,
  getRumWebVitalsEmptyCopy,
  RumClientKind,
  RumPanelSignal,
  RumSignalEmptyCopy,
} from "../../../Components/Rum/SetupCheck/RumSignalWords";
import RumSignalEmptyState from "../../../Components/Rum/SetupCheck/RumSignalEmptyState";
import RumSignalSetupModal from "../../../Components/Rum/SetupCheck/RumSignalSetupModal";
import RumKeySetupModal from "../../../Components/Rum/SetupCheck/RumKeySetupModal";
import {
  IngestRefusalFact,
  RumKindRefusal,
  RumRefusalApp,
  getRumKindRefusal,
} from "../../../Components/Rum/SetupCheck/RumIngestRefusals";
import useRecentIngestRefusals from "../../../Components/Rum/SetupCheck/useRecentIngestRefusals";
import { RumSignalArrivalRead } from "../../../Components/Rum/SetupCheck/useRumSetupCheck";
import useMobileRumSignals, {
  MobileRumSignalsLoad,
  MobileSignalArrival,
  UseMobileRumSignalsResult,
} from "../../../Components/Rum/MobileOverview/useMobileRumSignals";
import MobileSignalEmptyState from "../../../Components/Rum/MobileOverview/MobileSignalEmptyState";
import FramesByScreenCard from "../../../Components/Rum/MobileOverview/FramesByScreenCard";
import {
  MobileAppStarts,
  MobileFaultCount,
  MobileFrames,
  TimePoint as MobileTimePoint,
} from "../../../Components/Rum/MobileOverview/MobileRumSignalData";
import {
  CRASH_FREE_THRESHOLDS,
  MobileChartSignal,
  MobileSignalEmptyCopy,
  MobileTileText,
  buildMobileExceptionsRoute,
  buildMobileFrozenFramesLogsRoute,
  buildMobileTracesRoute,
  describeAppStartsTile,
  describeColdStartTile,
  describeCrashFreeTile,
  describeFaultTile,
  describeFrozenFramesTile,
  describeSessionsTile,
  getMobileSignalEmptyCopy,
  getMobileSignalEmptyState,
} from "./MobileOverviewHelpers";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

/*
 * One page of session headers for the overview tile. Matches the endpoint's
 * own default so the request is a single narrow-column granule read; the tile
 * shows "50+" rather than pretending to a total the endpoint never computes.
 */
const SESSION_REPLAY_COUNT_PAGE_SIZE: number = 50;

/*
 * describeTimeRangeForTile, buildRangedListRoute and describeRecordingHealthRow
 * are pure and live in OverviewHelpers.ts, which imports no React, so they can
 * be exercised by a node test. Re-exported here for callers of this page.
 */
export {
  buildRangedListRoute,
  describeExceptionsTile,
  describePageLoadsTile,
  describePageLoadTimeTile,
  describeRecordingHealthRow,
  describeTimeRangeForTile,
};

/* Identity for the effect below: a picker hands out a new object per change. */
function getTimeRangeKey(timeRange: RangeStartAndEndDateTime): string {
  return [
    String(timeRange.range),
    timeRange.startAndEndDate?.startValue?.toISOString() || "",
    timeRange.startAndEndDate?.endValue?.toISOString() || "",
  ].join("|");
}

const RumApplicationOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [clientCount, setClientCount] = useState<number | null>(null);
  /*
   * A failed client lookup is unknown, not zero: "0 platforms seen" beside
   * a sessions tile saying "could not load" for the same failure would be
   * a wrong number rather than a missing one (correlation-14).
   */
  const [clientCountFailed, setClientCountFailed] = useState<boolean>(false);
  const [sessionReplayCount, setSessionReplayCount] = useState<number | null>(
    null,
  );
  const [sessionReplayHasMore, setSessionReplayHasMore] =
    useState<boolean>(false);
  /*
   * Kept apart from the count so a failed lookup renders as unknown rather
   * than as zero recordings.
   */
  const [sessionReplayCountFailed, setSessionReplayCountFailed] =
    useState<boolean>(false);
  const [metrics, setMetrics] = useState<SpanMetrics | null>(null);
  /*
   * Page loads are the documentLoad spans alone: per-interval series for
   * the charts, and whole-range counts and percentiles for the tiles.
   */
  const [pageLoadMetrics, setPageLoadMetrics] = useState<SpanMetrics | null>(
    null,
  );
  const [pageLoadStats, setPageLoadStats] = useState<SpanNameStats | null>(
    null,
  );
  // Unknown, not zero - the tiles say "could not load".
  const [pageLoadStatsFailed, setPageLoadStatsFailed] =
    useState<boolean>(false);
  const [pageLoadsLoading, setPageLoadsLoading] = useState<boolean>(true);
  const [signals, setSignals] = useState<LogAndExceptionSignals | null>(null);
  const [signalsLoading, setSignalsLoading] = useState<boolean>(true);
  /*
   * When the app's newest exception arrived - read only when the range has
   * none, so the empty Exceptions chart can say "quiet since" or "not set
   * up" (issue #5770). null while it loads.
   */
  const [newestException, setNewestException] =
    useState<RumSignalArrivalRead | null>(null);
  /*
   * Recorded sessions with an error in the range: the evidence that errors
   * happen while none is reported. null until the sessions are read.
   */
  const [sessionsWithErrors, setSessionsWithErrors] = useState<number | null>(
    null,
  );
  /*
   * There are more sessions with an error than the page counted: the
   * evidence says "or more" (issue #6379).
   */
  const [sessionsWithErrorsHasMore, setSessionsWithErrorsHasMore] =
    useState<boolean>(false);
  // The setup dialog an empty chart opened.
  const [setUpSignal, setSetUpSignal] = useState<RumPanelSignal | null>(null);
  // "Pick another key", from an empty chart whose telemetry is refused.
  const [isPickingKey, setIsPickingKey] = useState<boolean>(false);
  /*
   * The newest Web Vital of the past 30 days, read only while the range has
   * none: why the card is empty (issue #6379). null while it loads, and
   * while the range has vitals to draw.
   */
  const [newestWebVital, setNewestWebVital] =
    useState<RumSignalArrivalRead | null>(null);
  /*
   * What the project's keys were refused in the past day (issue #6378),
   * read again on every refresh: an empty chart says "refused" while
   * nothing of its kind has arrived since. Like the newest exception, read
   * only while a chart has nothing to draw.
   */
  const [refusalsReloadToken, setRefusalsReloadToken] = useState<number>(0);
  const isChartEmpty: boolean = [signals?.exceptions, signals?.logs].some(
    (pillar: { total: number; failed: boolean } | undefined): boolean => {
      return Boolean(pillar && !pillar.failed && pillar.total === 0);
    },
  );
  const isWebVitalsCardEmpty: boolean = Boolean(
    newestWebVital && !newestWebVital.failed,
  );
  const refusals: Array<IngestRefusalFact> | null = useRecentIngestRefusals(
    refusalsReloadToken,
    isChartEmpty || isWebVitalsCardEmpty,
  );
  const [webVitals, setWebVitals] = useState<Array<WebVital>>([]);
  const [webVitalsLoading, setWebVitalsLoading] = useState<boolean>(true);
  const [webVitalsFailed, setWebVitalsFailed] = useState<boolean>(false);
  const [inpByRoute, setInpByRoute] = useState<WebVitalByRoute | null>(null);
  const [inpByRouteLoading, setInpByRouteLoading] = useState<boolean>(true);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");

  /*
   * What a mobile app's Overview draws in place of page loads and Web
   * Vitals (#9588) - its sessions, crashes, ANRs, app starts and frames -
   * read by the telemetry loader below, behind the same staleness guard.
   */
  const mobileSignals: UseMobileRumSignalsResult = useMobileRumSignals();
  const loadMobileSignals: (input: MobileRumSignalsLoad) => void =
    mobileSignals.load;

  const fetchModel: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    if (showLoader) {
      setIsLoading(true);
      setError("");
    } else {
      setIsRefreshing(true);
    }
    try {
      const item: RumApplication | null = await ModelAPI.getItem({
        modelType: RumApplication,
        id: modelId,
        select: {
          name: true,
          description: true,
          appIdentifier: true,
          clientType: true,
          sdkLanguage: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentVersion: true,
          /*
           * Read for the instrumentation banner below, not for a tile. See
           * isReplayOnlyInstrumented.
           */
          sessionReplayLastChunkReceivedAt: true,
          // What has arrived, kind by kind: why a chart is empty.
          ...RUM_SIGNAL_APPLICATION_SELECT,
          labels: { name: true, color: true },
        },
      });

      if (!item?.appIdentifier) {
        if (showLoader) {
          setError("RUM application not found.");
        }
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setRumApplication(item);
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
      setIsLoading(false);
      setIsRefreshing(false);

      ModelAPI.count({
        modelType: RumApplicationClient,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: { rumApplicationId: modelId } as any,
      })
        .then((count: number) => {
          setClientCount(count);
          setClientCountFailed(false);
        })
        .catch(() => {
          setClientCountFailed(true);
        });
    } catch (err) {
      /*
       * Keep stale data visible on a background refresh; only the initial
       * load surfaces a page-level error.
       */
      if (showLoader) {
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchModel(true).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const appIdentifier: string = rumApplication?.appIdentifier
    ? String(rumApplication.appIdentifier)
    : "";
  const timeRangeKey: string = getTimeRangeKey(timeRange);
  const modelIdString: string = modelId.toString();

  /*
   * A mobile app (as ingest records it, RumClientKind) reads its own
   * signals; until ingest has said, an application keeps the browser
   * Overview. Keyed in the loader, so the first telemetry that names the app
   * mobile reloads the page's reads as a mobile app's.
   */
  const isMobileApp: boolean = rumApplication
    ? getRumClientKind(rumApplication) === "mobile"
    : false;

  /*
   * Staleness guard for the telemetry fetches: a slow wide-range fetch can
   * resolve after a subsequently selected narrower range, and a refresh can
   * overlap a range change - without the guard the older response would
   * clobber the newer one.
   */
  const telemetryGenerationRef: React.MutableRefObject<number> =
    useRef<number>(0);

  /*
   * One loader for the tiles, the charts and the sessions count. Loading
   * flags are set only when `showLoading` is true (first load, range
   * change); a background refresh keeps every stale value on screen until
   * its replacement arrives, instead of dropping the page to spinners and
   * dashes every interval (correlation-12).
   */
  const loadTelemetry: (showLoading: boolean) => void = useCallback(
    (showLoading: boolean): void => {
      telemetryGenerationRef.current += 1;
      const generation: number = telemetryGenerationRef.current;
      const isCurrent: () => boolean = (): boolean => {
        return generation === telemetryGenerationRef.current;
      };

      if (showLoading) {
        setMetricsLoading(true);
        setWebVitalsLoading(true);
        setInpByRouteLoading(true);
        setPageLoadsLoading(true);
        setSignalsLoading(true);
        setSessionReplayCount(null);
        setSessionReplayCountFailed(false);
      }

      const range: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const start: Date = range.startValue;
      const end: Date = range.endValue;
      setChartWindow({ start, end });

      const primaryEntityId: ObjectID = new ObjectID(modelIdString);

      // RUM telemetry is tagged with primaryEntityId = this application's id.
      fetchSpanMetrics({ primaryEntityId, start, end })
        .then((m: SpanMetrics) => {
          if (!isCurrent()) {
            return;
          }
          setMetrics(m);
          setMetricsLoading(false);
        })
        .catch(() => {
          if (!isCurrent()) {
            return;
          }
          setMetricsLoading(false);
        });

      if (isMobileApp) {
        /*
         * A mobile app sends no page load and no Web Vital: its own signals
         * take their place (#9588), read with the same window and guard,
         * and nothing waits on the browser's.
         */
        setWebVitals([]);
        setWebVitalsLoading(false);
        setInpByRoute(null);
        setInpByRouteLoading(false);
        setPageLoadsLoading(false);

        loadMobileSignals({
          primaryEntityId,
          start,
          end,
          showLoading,
          isCurrent,
        });
      } else {
        fetchWebVitals({ primaryEntityId, start, end })
          .then((v: Array<WebVital>) => {
            if (!isCurrent()) {
              return;
            }
            setWebVitals(v);
            setWebVitalsLoading(false);
            setWebVitalsFailed(false);

            /*
             * None in the range: when the newest of the past 30 days came,
             * so the card can say why it is empty (issue #6379) - one row
             * of one metric's granules, read only then.
             */
            const anyReported: boolean = v.some((vital: WebVital): boolean => {
              return vital.value !== null && Number.isFinite(vital.value);
            });

            if (anyReported) {
              setNewestWebVital(null);
            } else {
              fetchNewestRumWebVitalAt({
                rumApplicationId: primaryEntityId,
                now: OneUptimeDate.getCurrentDate(),
              })
                .then((at: Date | null) => {
                  if (isCurrent()) {
                    setNewestWebVital({ at, failed: false });
                  }
                })
                .catch(() => {
                  if (isCurrent()) {
                    setNewestWebVital({ at: null, failed: true });
                  }
                });
            }

            /*
             * INP per route, under the name the card found INP under. No INP
             * at all means no breakdown to ask for - the card's own empty
             * state already says how to start.
             */
            const inpMetricName: string | null =
              v.find((vital: WebVital): boolean => {
                return vital.key === "inp";
              })?.metricName || null;

            if (!inpMetricName) {
              setInpByRoute(null);
              setInpByRouteLoading(false);
              return;
            }

            fetchWebVitalByRoute({
              primaryEntityId,
              metricName: inpMetricName,
              start,
              end,
            })
              .then((breakdown: WebVitalByRoute) => {
                if (!isCurrent()) {
                  return;
                }
                setInpByRoute(breakdown);
                setInpByRouteLoading(false);
              })
              .catch(() => {
                if (!isCurrent()) {
                  return;
                }
                setInpByRouteLoading(false);
              });
          })
          .catch(() => {
            if (!isCurrent()) {
              return;
            }
            setWebVitalsLoading(false);
            setWebVitalsFailed(true);
            setInpByRouteLoading(false);
          });

        /*
         * Page loads: the whole-range row for the tiles (true percentiles over
         * every page load in the range) and the per-interval series for the
         * charts. The tiles wait for both so they never show a count from one
         * refresh beside a time from another.
         */
        Promise.all([
          fetchSpanNameStats({
            primaryEntityId,
            spanName: PAGE_LOAD_SPAN_NAME,
            start,
            end,
          })
            .then((stats: SpanNameStats): SpanNameStats | null => {
              return stats;
            })
            .catch((): null => {
              return null;
            }),
          fetchSpanMetrics({
            primaryEntityId,
            spanName: PAGE_LOAD_SPAN_NAME,
            start,
            end,
          }),
        ])
          .then(([stats, series]: [SpanNameStats | null, SpanMetrics]) => {
            if (!isCurrent()) {
              return;
            }
            setPageLoadStats(stats);
            setPageLoadStatsFailed(stats === null);
            setPageLoadMetrics(series);
            setPageLoadsLoading(false);
          })
          .catch(() => {
            if (!isCurrent()) {
              return;
            }
            setPageLoadStatsFailed(true);
            setPageLoadsLoading(false);
          });
      }

      // Exceptions and logs, scoped by the same primaryEntityId.
      fetchLogAndExceptionSignals({ primaryEntityId, start, end })
        .then((result: LogAndExceptionSignals) => {
          if (!isCurrent()) {
            return;
          }

          /*
           * None in the range: when did the newest arrive, if ever? One
           * Postgres row, read only when the chart has nothing to draw.
           */
          if (!result.exceptions.failed && result.exceptions.total === 0) {
            if (showLoading) {
              setNewestException(null);
            }

            fetchNewestRumExceptionAt(primaryEntityId)
              .then((at: Date | null) => {
                if (!isCurrent()) {
                  return;
                }
                setNewestException({ at, failed: false });
              })
              .catch(() => {
                if (!isCurrent()) {
                  return;
                }
                setNewestException({ at: null, failed: true });
              });
          }

          setSignals(result);
          setSignalsLoading(false);
        })
        .catch(() => {
          if (!isCurrent()) {
            return;
          }
          setSignalsLoading(false);
        });

      /*
       * Recorded-session count for the tile.
       *
       * The list endpoint runs no COUNT - it is a keyset-paginated projection -
       * so this counts one page and says "N+" when there is another. Failure is
       * tracked separately from an empty result: collapsing a 403 from a
       * missing ReadRumSessionReplay permission, or a 500, into a confident "0"
       * would be indistinguishable from a project that genuinely has no
       * recordings, which is a wrong number rather than an unknown one.
       */
      fetchSessionReplayList({
        rumApplicationId: primaryEntityId,
        signal: "all",
        startTime: start,
        endTime: end,
        limit: SESSION_REPLAY_COUNT_PAGE_SIZE,
      })
        .then((result: SessionReplayListResult) => {
          if (!isCurrent()) {
            return;
          }
          setSessionReplayCount(result.sessions.length);
          setSessionReplayHasMore(result.nextCursor !== null);
          setSessionReplayCountFailed(false);
        })
        .catch(() => {
          if (!isCurrent()) {
            return;
          }
          setSessionReplayCountFailed(true);
        });

      /*
       * Recorded sessions with an error, for the empty Exceptions chart's
       * evidence: counted with Session Replay's own errors filter (issue
       * #6379), so every such session in the range counts, not only those
       * among the newest page. Past a page, "or more".
       */
      fetchSessionReplayList({
        rumApplicationId: primaryEntityId,
        signal: "errors",
        startTime: start,
        endTime: end,
        limit: SESSION_REPLAY_COUNT_PAGE_SIZE,
      })
        .then((result: SessionReplayListResult) => {
          if (!isCurrent()) {
            return;
          }
          setSessionsWithErrors(result.sessions.length);
          setSessionsWithErrorsHasMore(result.nextCursor !== null);
        })
        .catch(() => {
          if (!isCurrent()) {
            return;
          }
          setSessionsWithErrors(null);
          setSessionsWithErrorsHasMore(false);
        });
    },
    [modelIdString, timeRangeKey, isMobileApp, loadMobileSignals],
  );

  /*
   * Keyed on the application's identifier and the range's VALUE, not on the
   * RumApplication object: fetchModel(false) stores a fresh object on every
   * refresh, and keying on it re-fired all four queries with spinners each
   * interval.
   */
  useEffect(() => {
    if (!appIdentifier) {
      return;
    }

    loadTelemetry(true);

    return () => {
      telemetryGenerationRef.current += 1;
    };
  }, [appIdentifier, timeRangeKey, loadTelemetry]);

  const refresh: () => void = useCallback((): void => {
    fetchModel(false).catch(() => {});
    setRefusalsReloadToken((value: number): number => {
      return value + 1;
    });

    if (appIdentifier) {
      loadTelemetry(false);
    }
  }, [appIdentifier, loadTelemetry]);

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "rum-overview-auto-refresh-interval",
    onRefresh: (): void => {
      refresh();
    },
  });

  /*
   * One line of recording health in the details list. The overview is where
   * someone lands when "the replays look wrong", and until now this page
   * said nothing at all about whether the recorder is even reporting - the
   * diagnosis lived only on the list strip and the settings card. The hook
   * is a shared store keyed by application, so this subscription costs no
   * extra request when the strip or the card is already polling.
   */
  const health: UseSessionReplayHealthResult = useSessionReplayHealth(modelId);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!rumApplication) {
    return <ErrorMessage message="RUM application not found." />;
  }

  const a: RumApplication = rumApplication;
  // The hero's pill, read as the connection card under it reads the record.
  const status: RumApplicationStatusDescription = describeRumApplicationStatus({
    otelCollectorStatus: a.otelCollectorStatus,
    lastSeenAt: a.lastSeenAt,
  });
  /*
   * A failed span lookup is unknown, not zero (correlation-14): the span
   * tiles read "could not load" rather than a confident 0.
   */
  const m: SpanMetrics | null = metrics && !metrics.failed ? metrics : null;
  const spanLookupFailed: boolean = Boolean(metrics?.failed);

  const chips: Array<ResourceOverviewChip> = [];
  if (a.clientType) {
    chips.push({
      icon: isMobileApp ? IconProp.DevicePhoneMobile : IconProp.Window,
      label: String(a.clientType),
    });
  }
  if (a.sdkLanguage) {
    chips.push({ icon: IconProp.Code, label: String(a.sdkLanguage) });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const pageLoadsTile: TileText = describePageLoadsTile({
    stats: pageLoadStats,
    failed: pageLoadStatsFailed,
    eventsTotal: m ? m.total : null,
  });
  const pageLoadTimeTile: TileText = describePageLoadTimeTile({
    stats: pageLoadStats,
    failed: pageLoadStatsFailed,
  });
  /*
   * The page loads the tile counts (its documentLoad spans) over its range:
   * the failed ones while its line says how many failed (#9593), every one
   * otherwise. Nothing while they are unknown, or there are none.
   */
  const pageLoadsRoute: Route | undefined =
    pageLoadStats && !pageLoadStatsFailed && pageLoadStats.count > 0
      ? (pageLoadStats.errorCount > 0
          ? getFailedSpansRoute
          : getCountedSpansRoute)({
          tracesRoute: populate(PageMap.RUM_APPLICATION_VIEW_TRACES),
          timeRange: timeRange,
          spanType: TraceSpanType.All,
          spanName: PAGE_LOAD_SPAN_NAME,
        })
      : undefined;
  /*
   * Why the Exceptions and Logs charts are empty, when they are (issue
   * #5770): not set up, quiet in this range, or nothing arriving at all.
   */
  const diagnosisNow: Date = OneUptimeDate.getCurrentDate();
  const arrivalFacts: RumApplicationArrivalFacts =
    getRumApplicationArrivalFacts(a);
  const client: RumClientKind = getRumClientKind(a);
  const diagnosisRange:
    | { timeRange: RangeStartAndEndDateTime; start: Date; end: Date }
    | undefined = chartWindow
    ? { timeRange: timeRange, start: chartWindow.start, end: chartWindow.end }
    : undefined;
  const retentionInDays: number | null = getRumRetentionInDays(a);

  const inRangeCount: (
    pillar: { total: number; failed: boolean } | undefined,
  ) => number | null | undefined = (
    pillar: { total: number; failed: boolean } | undefined,
  ): number | null | undefined => {
    if (!pillar) {
      return signalsLoading ? undefined : null;
    }

    return pillar.failed ? null : pillar.total;
  };

  const exceptionsDiagnosis: RumSignalDiagnosis = diagnoseRumSignal({
    inRange: { count: inRangeCount(signals?.exceptions) },
    lastArrival: newestException,
    // Exceptions are rows of their own, kept for all time.
    trackedSince: null,
    app: arrivalFacts,
    range: diagnosisRange,
    retentionInDays,
    now: diagnosisNow,
  });

  const logsDiagnosis: RumSignalDiagnosis = diagnoseRumSignal({
    inRange: { count: inRangeCount(signals?.logs) },
    lastArrival: {
      at: toDateOrNull(a.logsLastReceivedAt),
      failed: false,
    },
    trackedSince: toDateOrNull(a.signalArrivalsTrackedSince),
    app: arrivalFacts,
    range: diagnosisRange,
    retentionInDays,
    now: diagnosisNow,
  });

  const refusalApp: RumRefusalApp = {
    client,
    appIdentifier: (a.appIdentifier as string) || null,
  };
  const panelRefusals: Record<RumPanelSignal, RumKindRefusal | null> = {
    // Exceptions are span events: they travel with the traces.
    exceptions: getRumKindRefusal({
      refusals,
      kind: "traces",
      lastArrivalAt: toDateOrNull(a.tracesLastReceivedAt),
      app: refusalApp,
      now: diagnosisNow,
    }),
    logs: getRumKindRefusal({
      refusals,
      kind: "logs",
      lastArrivalAt: toDateOrNull(a.logsLastReceivedAt),
      app: refusalApp,
      now: diagnosisNow,
    }),
  };

  const documentationRoute: Route = populate(
    PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION,
  );

  /*
   * Why the Core Web Vitals card is empty (issue #6379), from the same
   * diagnosis as the setup check's Web Vitals row: not set up, metrics of
   * other names only, quiet in this range, nothing arriving, or refused.
   */
  const vitalsWindow: { otherNamesArrive: boolean; since: Date } =
    getWebVitalsCheckWindow({
      metricsLastReceivedAt: toDateOrNull(a.metricsLastReceivedAt),
      trackedSince: toDateOrNull(a.signalArrivalsTrackedSince),
      now: diagnosisNow,
    });

  const webVitalsDiagnosis: RumSignalDiagnosis = diagnoseRumSignal({
    inRange: {
      count: webVitalsLoading
        ? undefined
        : webVitalsFailed
          ? null
          : webVitals.filter((vital: WebVital): boolean => {
              return vital.value !== null && Number.isFinite(vital.value);
            }).length,
    },
    lastArrival: newestWebVital,
    trackedSince: vitalsWindow.since,
    otherNamesArrive: vitalsWindow.otherNamesArrive,
    app: arrivalFacts,
    range: diagnosisRange,
    retentionInDays,
    now: diagnosisNow,
  });

  const renderEmptyWebVitals: () => ReactElement | undefined = ():
    | ReactElement
    | undefined => {
    const copy: RumSignalEmptyCopy | null = getRumWebVitalsEmptyCopy({
      diagnosis: webVitalsDiagnosis,
      // Web Vitals are metrics.
      refusal: getRumKindRefusal({
        refusals,
        kind: "metrics",
        lastArrivalAt: toDateOrNull(a.metricsLastReceivedAt),
        app: refusalApp,
        now: diagnosisNow,
      }),
      translator,
      now: diagnosisNow,
    });

    if (!copy) {
      return undefined;
    }

    return (
      <RumSignalEmptyState
        signal="webVitals"
        state={webVitalsDiagnosis.state}
        copy={copy}
        variant="chart"
        documentationRoute={documentationRoute}
        onSetUp={(picked: RumPanelSignal): void => {
          setSetUpSignal(picked);
        }}
        onRangeChange={(range: RangeStartAndEndDateTime): void => {
          setTimeRange(range);
        }}
        onRetry={(): void => {
          loadTelemetry(true);
        }}
        onPickKey={(): void => {
          setIsPickingKey(true);
        }}
      />
    );
  };

  const renderEmptySignal: (
    signal: RumPanelSignal,
    diagnosis: RumSignalDiagnosis,
  ) => ReactElement | undefined = (
    signal: RumPanelSignal,
    diagnosis: RumSignalDiagnosis,
  ): ReactElement | undefined => {
    const copy: RumSignalEmptyCopy | null = getRumSignalEmptyCopy({
      signal,
      diagnosis,
      client,
      sessionsWithErrors: signal === "exceptions" ? sessionsWithErrors : null,
      sessionsWithErrorsHasMore:
        signal === "exceptions" && sessionsWithErrorsHasMore,
      refusal: panelRefusals[signal],
      translator,
      now: diagnosisNow,
    });

    if (!copy) {
      return undefined;
    }

    return (
      <RumSignalEmptyState
        signal={signal}
        state={diagnosis.state}
        copy={copy}
        variant="chart"
        documentationRoute={documentationRoute}
        onSetUp={(picked: RumPanelSignal): void => {
          setSetUpSignal(picked);
        }}
        onRangeChange={(range: RangeStartAndEndDateTime): void => {
          setTimeRange(range);
        }}
        onRetry={(): void => {
          loadTelemetry(true);
        }}
        onPickKey={(): void => {
          setIsPickingKey(true);
        }}
      />
    );
  };

  const exceptionsTile: TileText = describeExceptionsTile({
    exceptions: signals ? signals.exceptions : null,
    isNotSetUp:
      exceptionsDiagnosis.state === "not-set-up" &&
      exceptionsDiagnosis.cause === "signal",
  });

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Page loads",
      value: pageLoadsTile.value,
      icon: IconProp.Globe,
      iconColor: "emerald",
      loading: pageLoadsLoading,
      sublabel: pageLoadsTile.sublabel,
      to: pageLoadsRoute,
      description: RUM_METRIC_DESCRIPTIONS.pageLoads,
    },
    {
      title: "Page load time (p95)",
      value: pageLoadTimeTile.value,
      icon: IconProp.Clock,
      iconColor: "blue",
      loading: pageLoadsLoading,
      sublabel: pageLoadTimeTile.sublabel,
      description: RUM_METRIC_DESCRIPTIONS.pageLoadTime,
    },
    {
      title: "Events",
      value: m ? formatCompact(m.total, translator) : undefined,
      icon: IconProp.Activity,
      iconColor: "sky",
      loading: metricsLoading,
      sublabel: spanLookupFailed ? "could not load" : "spans, selected range",
      description: RUM_METRIC_DESCRIPTIONS.events,
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent, translator) : undefined,
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: metricsLoading,
      sublabel: spanLookupFailed
        ? "could not load"
        : m
          ? translator.translateTemplate("{{errors}} errored", {
              errors: formatCompact(m.errors, translator),
            })
          : undefined,
      percent: m ? m.errorRatePercent : null,
      thresholds: { warn: 1, danger: 5 },
      /*
       * The events it counts that failed: every span of the application
       * (page loads, requests, clicks), over the range it counted.
       */
      to: m
        ? getFailedSpansRoute({
            tracesRoute: populate(PageMap.RUM_APPLICATION_VIEW_TRACES),
            timeRange: timeRange,
            spanType: TraceSpanType.All,
          })
        : undefined,
      description: RUM_METRIC_DESCRIPTIONS.errorRate,
    },
    {
      title: "Event duration (p95)",
      value: m
        ? formatDurationMsInLanguage(m.p95DurationMs, translator)
        : undefined,
      icon: IconProp.Clock,
      iconColor: "violet",
      loading: metricsLoading,
      sublabel: spanLookupFailed
        ? "could not load"
        : "page loads, requests, clicks",
      description: RUM_METRIC_DESCRIPTIONS.eventDuration,
    },
    {
      title: "Exceptions",
      value: exceptionsTile.value,
      icon: IconProp.Bug,
      iconColor: "rose",
      loading: signalsLoading,
      sublabel: exceptionsTile.sublabel,
      description: RUM_METRIC_DESCRIPTIONS.exceptions,
    },
    {
      title: "Clients",
      value:
        clientCountFailed || clientCount === null
          ? undefined
          : formatCompact(clientCount, translator),
      icon: IconProp.Window,
      iconColor: "amber",
      loading: clientCount === null && !clientCountFailed,
      sublabel: clientCountFailed ? "could not load" : "platforms seen",
      to: populate(PageMap.RUM_APPLICATION_VIEW_CLIENTS),
      description: RUM_METRIC_DESCRIPTIONS.clients,
    },
    {
      title: "Sessions recorded",
      value: sessionReplayCountFailed
        ? undefined
        : sessionReplayCount === null
          ? undefined
          : `${formatCompact(sessionReplayCount, translator)}${
              sessionReplayHasMore ? "+" : ""
            }`,
      icon: IconProp.Film,
      iconColor: "sky",
      loading: sessionReplayCount === null && !sessionReplayCountFailed,
      sublabel: sessionReplayCountFailed
        ? "could not load"
        : describeTimeRangeForTile(timeRange),
      to: buildRangedListRoute(
        populate(PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY),
        timeRange,
      ),
      description: RUM_METRIC_DESCRIPTIONS.sessionsRecorded,
    },
  ];

  const syncId: string = `rum-${modelId.toString()}`;
  const durationFormatter: (n: number) => string = (n: number): string => {
    return formatDurationMsInLanguage(n, translator);
  };

  /*
   * A MOBILE APP'S TILES AND CHARTS (#9588): what a mobile team watches
   * first, in place of page loads and Web Vitals - sessions, crash-free
   * sessions, crashes, ANRs, app starts, cold start time and frozen frames,
   * and the share of failed spans. Every tile opens where its number can be
   * read row by row: the sessions' recordings or spans, the app's
   * exceptions (ANRs alone), its AppStart spans, its frozen-frame events
   * and its failed spans, on the range the tile counted. The words are
   * MobileOverviewHelpers', the data MobileRumSignalData's.
   */
  const crashes: MobileFaultCount | null = mobileSignals.faults
    ? mobileSignals.faults.crashes
    : null;
  const anrs: MobileFaultCount | null = mobileSignals.faults
    ? mobileSignals.faults.anrs
    : null;
  const sessionsTile: MobileTileText = describeSessionsTile({
    sessions: mobileSignals.sessions,
    timeRange: timeRange,
  });
  const crashFreeTile: MobileTileText = describeCrashFreeTile({
    sessions: mobileSignals.sessions,
    crashes: crashes,
  });
  const crashesTile: MobileTileText = describeFaultTile({
    fault: crashes,
    timeRange: timeRange,
  });
  const anrsTile: MobileTileText = describeFaultTile({
    fault: anrs,
    timeRange: timeRange,
  });
  const appStartsTile: MobileTileText = describeAppStartsTile({
    appStarts: mobileSignals.appStarts,
  });
  const coldStartTile: MobileTileText = describeColdStartTile({
    appStarts: mobileSignals.appStarts,
  });
  const frozenFramesTile: MobileTileText = describeFrozenFramesTile({
    frames: mobileSignals.frames,
  });

  const rumTracesRoute: Route = populate(PageMap.RUM_APPLICATION_VIEW_TRACES);
  const exceptionsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS] as Route,
  );
  const exceptionsOfAppRoute: Route = buildMobileExceptionsRoute({
    exceptionsRoute: exceptionsRoute,
    rumApplicationId: modelIdString,
    timeRange: timeRange,
  });
  const recordsReplays: boolean = Boolean(a.sessionReplayLastChunkReceivedAt);

  /*
   * Sessions open their recordings when the app records them (React
   * Native), else its spans, where session.id is a column; while its spans
   * name no session, its setup guide.
   */
  const sessionsRoute: Route = sessionsTile.valueNote
    ? documentationRoute
    : recordsReplays
      ? buildRangedListRoute(
          populate(PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY),
          timeRange,
        )
      : buildMobileTracesRoute({ tracesRoute: rumTracesRoute, timeRange });

  const mobileTiles: Array<ResourceOverviewTile> = [
    {
      title: "Sessions",
      value: sessionsTile.value,
      valueNote: sessionsTile.valueNote,
      icon: IconProp.UserGroup,
      iconColor: "sky",
      loading: mobileSignals.sessionsLoading,
      sublabel: sessionsTile.sublabel,
      to: sessionsRoute,
      description: RUM_METRIC_DESCRIPTIONS.sessions,
    },
    {
      title: "Crash-free sessions",
      value: crashFreeTile.value,
      icon: IconProp.ShieldCheck,
      iconColor: "emerald",
      loading: mobileSignals.sessionsLoading || mobileSignals.faultsLoading,
      sublabel: crashFreeTile.sublabel,
      percent: crashFreeTile.percent,
      thresholds: CRASH_FREE_THRESHOLDS,
      higherIsBetter: true,
      to: exceptionsOfAppRoute,
      description: RUM_METRIC_DESCRIPTIONS.crashFreeSessions,
    },
    {
      title: "Crashes",
      value: crashesTile.value,
      icon: IconProp.Bug,
      iconColor: "rose",
      loading: mobileSignals.faultsLoading,
      sublabel: crashesTile.sublabel,
      to: exceptionsOfAppRoute,
      description: RUM_METRIC_DESCRIPTIONS.crashes,
    },
    {
      title: "ANRs",
      value: anrsTile.value,
      icon: IconProp.PauseCircle,
      iconColor: "amber",
      loading: mobileSignals.faultsLoading,
      sublabel: anrsTile.sublabel,
      to: buildMobileExceptionsRoute({
        exceptionsRoute: exceptionsRoute,
        rumApplicationId: modelIdString,
        timeRange: timeRange,
        anrsOnly: true,
      }),
      description: RUM_METRIC_DESCRIPTIONS.anrs,
    },
    {
      title: "App starts",
      value: appStartsTile.value,
      icon: IconProp.Power,
      iconColor: "violet",
      loading: mobileSignals.appStartsLoading,
      sublabel: appStartsTile.sublabel,
      to: buildMobileTracesRoute({
        tracesRoute: rumTracesRoute,
        timeRange: timeRange,
        appStarts: true,
      }),
      description: RUM_METRIC_DESCRIPTIONS.appStarts,
    },
    {
      title: "Cold start (p95)",
      value: coldStartTile.value,
      icon: IconProp.Clock,
      iconColor: "blue",
      loading: mobileSignals.appStartsLoading,
      sublabel: coldStartTile.sublabel,
      to: buildMobileTracesRoute({
        tracesRoute: rumTracesRoute,
        timeRange: timeRange,
        startType: "cold",
      }),
      description: RUM_METRIC_DESCRIPTIONS.coldStartTime,
    },
    {
      title: "Frozen frames",
      value: frozenFramesTile.value,
      icon: IconProp.Squares,
      iconColor: "rose",
      loading: mobileSignals.framesLoading,
      sublabel: frozenFramesTile.sublabel,
      to: buildMobileFrozenFramesLogsRoute({
        logsRoute: RouteUtil.populateRouteParams(
          RouteMap[PageMap.LOGS] as Route,
        ),
        rumApplicationId: modelIdString,
        timeRange: timeRange,
      }),
      description: RUM_METRIC_DESCRIPTIONS.frozenFrames,
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent, translator) : undefined,
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: metricsLoading,
      sublabel: spanLookupFailed
        ? "could not load"
        : m
          ? translator.translateTemplate("{{errors}} errored", {
              errors: formatCompact(m.errors, translator),
            })
          : undefined,
      percent: m ? m.errorRatePercent : null,
      thresholds: { warn: 1, danger: 5 },
      to: buildMobileTracesRoute({
        tracesRoute: rumTracesRoute,
        timeRange: timeRange,
        errorsOnly: true,
      }),
      description: RUM_METRIC_DESCRIPTIONS.errorRateMobile,
    },
  ];

  /*
   * Why an app start or frame chart is empty: none in this range, or none
   * in the past 30 days (what turns it on, with the Android Setup docs). A
   * failed read says so instead.
   */
  const renderMobileEmptySignal: (
    signal: MobileChartSignal,
    lastArrival: MobileSignalArrival | null,
  ) => ReactElement | undefined = (
    signal: MobileChartSignal,
    lastArrival: MobileSignalArrival | null,
  ): ReactElement | undefined => {
    const copy: MobileSignalEmptyCopy | null = getMobileSignalEmptyCopy({
      signal,
      lastArrival,
      translator,
      now: diagnosisNow,
    });

    if (!copy) {
      return undefined;
    }

    return (
      <MobileSignalEmptyState
        signal={signal}
        state={getMobileSignalEmptyState(lastArrival)}
        copy={copy}
      />
    );
  };

  const appStarts: MobileAppStarts | null = mobileSignals.appStarts;
  const frames: MobileFrames | null = mobileSignals.frames;

  /*
   * Empty while the newest app start (or slow frame) is still being looked
   * up: the chart keeps its skeleton rather than say "none" for a moment.
   */
  const isAppStartsChartLoading: boolean =
    (mobileSignals.appStartsLoading && !appStarts) ||
    Boolean(
      appStarts &&
        !appStarts.failed &&
        appStarts.total === 0 &&
        mobileSignals.lastAppStart === null,
    );
  const isFramesChartLoading: boolean =
    (mobileSignals.framesLoading && !frames) ||
    Boolean(
      frames &&
        !frames.failed &&
        frames.slow === 0 &&
        frames.frozen === 0 &&
        mobileSignals.lastFrameEvent === null,
    );

  /*
   * The exceptions that are neither a crash nor an ANR - a failed network
   * call's, one the app records itself - per interval: every exception less
   * the two, which the histograms bucket alike.
   */
  const otherExceptionsSeries: Array<MobileTimePoint> = sumTimeSeries(
    sumTimeSeries(
      signals?.exceptions.unhandledSeries ?? [],
      signals?.exceptions.handledSeries ?? [],
    ),
    sumTimeSeries(crashes?.series ?? [], anrs?.series ?? []).map(
      (point: MobileTimePoint): MobileTimePoint => {
        return { x: point.x, y: -point.y };
      },
    ),
  ).filter((point: MobileTimePoint): boolean => {
    return point.y > 0;
  });

  const mobileCharts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="App starts"
        icon={IconProp.Power}
        iconColor="violet"
        series={
          [
            {
              seriesName: "Cold starts",
              data: appStarts?.countSeries.cold ?? [],
            },
            {
              seriesName: "Warm starts",
              data: appStarts?.countSeries.warm ?? [],
            },
            {
              seriesName: "Hot starts",
              data: appStarts?.countSeries.hot ?? [],
            },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        yAllowDecimals={false}
        loading={isAppStartsChartLoading}
        description={RUM_METRIC_DESCRIPTIONS.appStartsChart}
        emptyMessage={
          appStarts?.failed ? "Could not load app starts" : undefined
        }
        emptyContent={
          appStarts?.failed
            ? undefined
            : renderMobileEmptySignal("appStarts", mobileSignals.lastAppStart)
        }
      />
      <ChartCard
        title="Startup time (p95)"
        icon={IconProp.Clock}
        iconColor="blue"
        series={
          [
            {
              seriesName: "Cold start",
              data: appStarts?.p95Series.cold ?? [],
            },
            {
              seriesName: "Warm start",
              data: appStarts?.p95Series.warm ?? [],
            },
            {
              seriesName: "Hot start",
              data: appStarts?.p95Series.hot ?? [],
            },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        yLegend="ms"
        yFormatter={durationFormatter}
        loading={isAppStartsChartLoading}
        description={RUM_METRIC_DESCRIPTIONS.startupTimeChart}
        emptyMessage={
          appStarts?.failed ? "Could not load app starts" : undefined
        }
        emptyContent={
          appStarts?.failed
            ? undefined
            : renderMobileEmptySignal("appStarts", mobileSignals.lastAppStart)
        }
      />
      <ChartCard
        title="Crashes and ANRs"
        icon={IconProp.Bug}
        iconColor="rose"
        series={
          [
            { seriesName: "Crashes", data: crashes?.series ?? [] },
            { seriesName: "ANRs", data: anrs?.series ?? [] },
            { seriesName: "Other exceptions", data: otherExceptionsSeries },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        yAllowDecimals={false}
        loading={
          (signalsLoading && !signals) ||
          (mobileSignals.faultsLoading && !mobileSignals.faults) ||
          exceptionsDiagnosis.state === "loading"
        }
        description={RUM_METRIC_DESCRIPTIONS.crashesChart}
        emptyContent={renderEmptySignal("exceptions", exceptionsDiagnosis)}
      />
      <ChartCard
        title="Slow and frozen frames"
        icon={IconProp.Squares}
        iconColor="amber"
        series={
          [
            { seriesName: "Slow frames", data: frames?.slowSeries ?? [] },
            { seriesName: "Frozen frames", data: frames?.frozenSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        yAllowDecimals={false}
        loading={isFramesChartLoading}
        description={RUM_METRIC_DESCRIPTIONS.framesChart}
        emptyMessage={frames?.failed ? "Could not load frames" : undefined}
        emptyContent={
          frames?.failed
            ? undefined
            : renderMobileEmptySignal("frames", mobileSignals.lastFrameEvent)
        }
      />
      <ChartCard
        title="Events"
        icon={IconProp.Activity}
        iconColor="sky"
        series={
          [
            { seriesName: "Events", data: m?.countSeries ?? [] },
            { seriesName: "Errors", data: m?.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={metricsLoading && !m}
        description={RUM_METRIC_DESCRIPTIONS.eventsChartMobile}
      />
      <ChartCard
        title="Logs"
        icon={IconProp.Logs}
        iconColor="amber"
        series={
          [
            { seriesName: "Log lines", data: signals?.logs.countSeries ?? [] },
            { seriesName: "Errors", data: signals?.logs.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={
          (signalsLoading && !signals) || logsDiagnosis.state === "loading"
        }
        description={RUM_METRIC_DESCRIPTIONS.logsChartMobile}
        emptyContent={renderEmptySignal("logs", logsDiagnosis)}
      />
    </div>
  );

  // The frames per screen show once there are frames to place on a screen.
  const isFramesByScreenShown: boolean =
    (mobileSignals.framesLoading && !frames) ||
    Boolean(
      frames &&
        !frames.failed &&
        (frames.slow > 0 || frames.frozen > 0 || frames.byScreenFailed),
    );

  const charts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Page loads"
        icon={IconProp.Globe}
        iconColor="emerald"
        series={
          [
            {
              seriesName: "Page loads",
              data: pageLoadMetrics?.countSeries ?? [],
            },
            { seriesName: "Failed", data: pageLoadMetrics?.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={pageLoadsLoading && !pageLoadMetrics}
        description={RUM_METRIC_DESCRIPTIONS.pageLoadsChart}
      />
      <ChartCard
        title="Page load time (p95)"
        icon={IconProp.Clock}
        iconColor="blue"
        series={
          [
            { seriesName: "p95", data: pageLoadMetrics?.p95Series ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        yLegend="ms"
        yFormatter={durationFormatter}
        loading={pageLoadsLoading && !pageLoadMetrics}
        description={RUM_METRIC_DESCRIPTIONS.pageLoadTimeChart}
      />
      <ChartCard
        title="Events"
        icon={IconProp.Activity}
        iconColor="sky"
        series={
          [
            { seriesName: "Events", data: m?.countSeries ?? [] },
            { seriesName: "Errors", data: m?.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={metricsLoading && !m}
        description={RUM_METRIC_DESCRIPTIONS.eventsChart}
      />
      <ChartCard
        title="Event duration (p95)"
        icon={IconProp.Clock}
        iconColor="violet"
        series={
          [
            { seriesName: "p95", data: m?.p95Series ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        yLegend="ms"
        yFormatter={durationFormatter}
        loading={metricsLoading && !m}
        description={RUM_METRIC_DESCRIPTIONS.eventDurationChart}
      />
      <ChartCard
        title="Exceptions"
        icon={IconProp.Bug}
        iconColor="rose"
        series={
          [
            {
              seriesName: "Exceptions",
              data: sumTimeSeries(
                signals?.exceptions.unhandledSeries ?? [],
                signals?.exceptions.handledSeries ?? [],
              ),
            },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        loading={
          (signalsLoading && !signals) ||
          exceptionsDiagnosis.state === "loading"
        }
        description={RUM_METRIC_DESCRIPTIONS.exceptionsChart}
        emptyContent={renderEmptySignal("exceptions", exceptionsDiagnosis)}
      />
      <ChartCard
        title="Logs"
        icon={IconProp.Logs}
        iconColor="amber"
        series={
          [
            { seriesName: "Log lines", data: signals?.logs.countSeries ?? [] },
            { seriesName: "Errors", data: signals?.logs.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={
          (signalsLoading && !signals) || logsDiagnosis.state === "loading"
        }
        description={RUM_METRIC_DESCRIPTIONS.logsChart}
        emptyContent={renderEmptySignal("logs", logsDiagnosis)}
      />
    </div>
  );

  // In the reader's language: a few words of the product's own.
  const recordingHealthWords: string | undefined =
    describeRecordingHealthRow(health);
  const recordingHealthValue: string | undefined = recordingHealthWords
    ? translator.translateText(recordingHealthWords) || recordingHealthWords
    : undefined;

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "App Name (service.name)", value: a.appIdentifier },
    { label: "Client Type", value: a.clientType },
    { label: "SDK Language (telemetry.sdk.language)", value: a.sdkLanguage },
    {
      label: "SDK Version",
      value: a.agentVersion,
      element: (
        <AgentVersion kind={AgentKind.RumSdk} version={a.agentVersion} />
      ),
    },
    // Words: in the page's own type, not a monospaced value.
    ...(recordingHealthValue
      ? [
          {
            label: "Recording Health",
            value: recordingHealthValue,
            mono: false,
          },
        ]
      : []),
  ];

  /*
   * Recordings are arriving but the OpenTelemetry browser SDK has never
   * reported, so every tile on this page except "sessions recorded" is
   * honestly zero. See RumInstrumentation for why the signal is the SDK
   * metadata columns rather than "no spans in the selected range".
   */
  const showRumSdkMissingNotice: boolean = isReplayOnlyInstrumented(a);

  // Shown only once INP has reported; until then the vitals card explains.
  const inpVital: WebVital | undefined = webVitals.find(
    (vital: WebVital): boolean => {
      return vital.key === "inp";
    },
  );

  /*
   * Drag-to-zoom (issue #4105): a drag across any chart on the page sets
   * the page's range to the window dragged out, and a double-click on any
   * chart - or "Reset zoom" beside the picker - puts the range from before
   * the zoom back. The charts, the tiles, both web-vitals cards and the
   * sessions link are all read from `timeRange`, so all of them follow; a
   * zoomed (custom) range also stays put across auto-refresh ticks.
   */
  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      {showRumSdkMissingNotice && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Session replay is reporting, the RUM SDK is not"
          title={
            <span>
              <TranslatedSentence
                template="Recordings are arriving for this application, so the replay snippet and your ingestion key are working. Page loads, events, error rate, durations, exceptions and clients come from a different install — the OpenTelemetry browser SDK — and nothing has reported through it yet, which is why those tiles read zero. Add the SDK with {{attribute}} set to {{value}} to fill them in; the steps are on this application's Documentation tab. Session replay does not need it."
                slots={{
                  attribute: <code>service.name</code>,
                  value: <code>{(a.appIdentifier as string) || ""}</code>,
                }}
              />
            </span>
          }
        />
      )}

      <ResourceOverview
        icon={isMobileApp ? IconProp.DevicePhoneMobile : IconProp.Globe}
        title={(a.name as string) || "RUM Application"}
        identifier={(a.appIdentifier as string) || ""}
        identifierLabel="service.name"
        status={a.otelCollectorStatus}
        /*
         * Receiving data, No recent traffic or Waiting for data - never
         * "Disconnected": an application nobody is using is idle, not
         * broken (RumApplicationStatus, issue #6191).
         */
        statusLabel={status.label}
        statusTone={status.tone}
        statusDescription={status.description}
        lastSeenAt={a.lastSeenAt}
        connectionGuide={
          <ResourceConnectionGuideCard
            status={a.otelCollectorStatus as string | undefined}
            lastSeenAt={a.lastSeenAt}
            guide={getRumApplicationConnectionGuide(
              (a.appIdentifier as string | undefined) ||
                (a.name as string | undefined) ||
                "",
            )}
            documentationRoute={RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION] as Route,
              { modelId: modelId },
            )}
          />
        }
        description={a.description as string}
        chips={chips}
        // A mobile app's own tiles and charts (#9588), a browser app's otherwise.
        tiles={isMobileApp ? mobileTiles : tiles}
        charts={isMobileApp ? mobileCharts : charts}
        controls={
          <AutoRefreshControl
            autoRefreshInterval={autoRefreshInterval}
            onAutoRefreshIntervalChange={setAutoRefreshInterval}
            onManualRefresh={(): void => {
              refresh();
            }}
            isRefreshing={isRefreshing}
            lastRefreshedAt={lastRefreshedAt}
            timeRangePicker={
              <TelemetryTimeRangePicker
                value={timeRange}
                onChange={(value: RangeStartAndEndDateTime): void => {
                  setTimeRange(value);
                }}
              />
            }
          />
        }
        detailRows={detailRows}
        detailsDescription={translationKey(
          "What its SDK reports, and the health of its session recordings.",
        )}
        recordId={modelId.toString()}
        settingsRoute={populate(PageMap.RUM_APPLICATION_VIEW_SETTINGS)}
        labels={a.labels}
      />

      {/*
       * Only a browser reports Web Vitals. A mobile app's card is its
       * frames per screen: where its frames freeze (#9588).
       */}
      {!isMobileApp && (
        <WebVitalsCard
          vitals={webVitals}
          loading={webVitalsLoading}
          description={RUM_METRIC_DESCRIPTIONS.webVitals}
          emptyState={renderEmptyWebVitals()}
        />
      )}

      {!isMobileApp && inpVital && inpVital.metricName && (
        <WebVitalRouteBreakdownCard
          vital={inpVital}
          breakdown={inpByRoute}
          loading={inpByRouteLoading}
          description={RUM_METRIC_DESCRIPTIONS.inpByRoute}
        />
      )}

      {isMobileApp && isFramesByScreenShown && (
        <FramesByScreenCard
          frames={frames}
          loading={mobileSignals.framesLoading}
          description={RUM_METRIC_DESCRIPTIONS.framesByScreen}
        />
      )}

      {setUpSignal ? (
        <RumSignalSetupModal
          signal={setUpSignal}
          rumApplicationId={modelId}
          appName={(a.appIdentifier as string) || (a.name as string) || ""}
          onClose={(): void => {
            setSetUpSignal(null);
          }}
        />
      ) : (
        <></>
      )}

      {isPickingKey ? (
        <RumKeySetupModal
          clientType={client}
          appName={appIdentifier || undefined}
          onClose={(): void => {
            setIsPickingKey(false);
          }}
        />
      ) : (
        <></>
      )}
    </TimeRangeZoomScope>
  );
};

export default RumApplicationOverview;
