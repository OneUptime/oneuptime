import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationClient from "Common/Models/DatabaseModels/RumApplicationClient";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import OneUptimeDate from "Common/Types/Date";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
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
  formatDurationMs,
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
  const [webVitals, setWebVitals] = useState<Array<WebVital>>([]);
  const [webVitalsLoading, setWebVitalsLoading] = useState<boolean>(true);
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

      fetchWebVitals({ primaryEntityId, start, end })
        .then((v: Array<WebVital>) => {
          if (!isCurrent()) {
            return;
          }
          setWebVitals(v);
          setWebVitalsLoading(false);

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

      // Exceptions and logs, scoped by the same primaryEntityId.
      fetchLogAndExceptionSignals({ primaryEntityId, start, end })
        .then((result: LogAndExceptionSignals) => {
          if (!isCurrent()) {
            return;
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
    },
    [modelIdString, timeRangeKey],
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
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!rumApplication) {
    return <ErrorMessage message="RUM application not found." />;
  }

  const a: RumApplication = rumApplication;
  /*
   * A failed span lookup is unknown, not zero (correlation-14): the span
   * tiles read "could not load" rather than a confident 0.
   */
  const m: SpanMetrics | null = metrics && !metrics.failed ? metrics : null;
  const spanLookupFailed: boolean = Boolean(metrics?.failed);

  const chips: Array<ResourceOverviewChip> = [];
  if (a.clientType) {
    chips.push({ icon: IconProp.Window, label: String(a.clientType) });
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
  const exceptionsTile: TileText = describeExceptionsTile({
    exceptions: signals ? signals.exceptions : null,
  });

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Page loads",
      value: pageLoadsTile.value,
      icon: IconProp.Globe,
      iconColor: "emerald",
      loading: pageLoadsLoading,
      sublabel: pageLoadsTile.sublabel,
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
      value: m ? formatCompact(m.total) : "—",
      icon: IconProp.Activity,
      iconColor: "sky",
      loading: metricsLoading,
      sublabel: spanLookupFailed ? "could not load" : "spans, selected range",
      description: RUM_METRIC_DESCRIPTIONS.events,
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent) : "—",
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: metricsLoading,
      sublabel: spanLookupFailed
        ? "could not load"
        : m
          ? `${formatCompact(m.errors)} errored`
          : undefined,
      percent: m ? m.errorRatePercent : null,
      thresholds: { warn: 1, danger: 5 },
      description: RUM_METRIC_DESCRIPTIONS.errorRate,
    },
    {
      title: "Event duration (p95)",
      value: m ? formatDurationMs(m.p95DurationMs) : "—",
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
          ? "—"
          : formatCompact(clientCount),
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
        ? "—"
        : sessionReplayCount === null
          ? "—"
          : `${formatCompact(sessionReplayCount)}${
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
    return formatDurationMs(n);
  };

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
        loading={signalsLoading && !signals}
        description={RUM_METRIC_DESCRIPTIONS.exceptionsChart}
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
        loading={signalsLoading && !signals}
        description={RUM_METRIC_DESCRIPTIONS.logsChart}
      />
    </div>
  );

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Session Replay",
      description: "Watch what real users saw",
      to: populate(PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY),
      icon: IconProp.Film,
    },
    {
      title: "Traces",
      description: "Page loads, interactions and fetches",
      to: populate(PageMap.RUM_APPLICATION_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Browser / mobile events and errors",
      to: populate(PageMap.RUM_APPLICATION_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "Client-side metrics",
      to: populate(PageMap.RUM_APPLICATION_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
  ];

  const recordingHealthValue: string | undefined =
    describeRecordingHealthRow(health);

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "App Identifier (service.name)", value: a.appIdentifier },
    { label: "Client Type", value: a.clientType },
    { label: "SDK Language (telemetry.sdk.language)", value: a.sdkLanguage },
    { label: "SDK Version", value: a.agentVersion },
    ...(recordingHealthValue
      ? [{ label: "Recording health", value: recordingHealthValue }]
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

  return (
    <Fragment>
      {showRumSdkMissingNotice && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Session replay is reporting, the RUM SDK is not"
          title={
            <span>
              Recordings are arriving for this application, so the replay
              snippet and your ingestion key are working. Page loads, events,
              error rate, durations, exceptions and clients come from a
              different install — the OpenTelemetry browser SDK — and nothing
              has reported through it yet, which is why those tiles read zero.
              Add the SDK with <code>service.name</code> set to{" "}
              <code>{(a.appIdentifier as string) || ""}</code> to fill them in;
              the steps are on this application&apos;s Documentation tab.
              Session replay does not need it.
            </span>
          }
        />
      )}

      <ResourceOverview
        icon={IconProp.Globe}
        title={(a.name as string) || "RUM Application"}
        identifier={(a.appIdentifier as string) || ""}
        identifierLabel="service.name"
        status={a.otelCollectorStatus}
        lastSeenAt={a.lastSeenAt}
        description={a.description as string}
        chips={chips}
        tiles={tiles}
        charts={charts}
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
        quickLinks={quickLinks}
        detailRows={detailRows}
        labels={a.labels}
      />

      <WebVitalsCard
        vitals={webVitals}
        loading={webVitalsLoading}
        description={RUM_METRIC_DESCRIPTIONS.webVitals}
      />

      {inpVital && inpVital.metricName && (
        <WebVitalRouteBreakdownCard
          vital={inpVital}
          breakdown={inpByRoute}
          loading={inpByRouteLoading}
          description={RUM_METRIC_DESCRIPTIONS.inpByRoute}
        />
      )}
    </Fragment>
  );
};

export default RumApplicationOverview;
