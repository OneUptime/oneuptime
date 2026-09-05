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
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import WebVitalsCard from "../../../Components/TelemetryResource/WebVitalsCard";
import {
  fetchSpanMetrics,
  fetchWebVitals,
  formatCompact,
  formatDurationMs,
  formatPercent,
  SpanMetrics,
  WebVital,
} from "../../../Components/TelemetryResource/telemetryMetrics";
import {
  fetchSessionReplayList,
  SessionReplayListResult,
} from "../../../Components/SessionReplay/SessionReplayTable";
import isReplayOnlyInstrumented from "../../../Components/SessionReplay/RumInstrumentation";
import useSessionReplayHealth, {
  SessionReplayHealthError,
  UseSessionReplayHealthResult,
  describeHealthError,
} from "../../../Components/SessionReplay/useSessionReplayHealth";
import { RecordingHealthDiagnosis } from "Common/Types/Rum/SessionReplayHealth";

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
 * The range a tile counted, in the tile's own words - "past 1 hour", not
 * "selected range" - so a viewer who clicks through to a list showing a
 * different default window is never told two counts for one thing without
 * being shown why (correlation-11).
 */
export function describeTimeRangeForTile(
  timeRange: RangeStartAndEndDateTime,
): string {
  if (timeRange.range === TimeRange.CUSTOM) {
    return "custom range";
  }

  return String(timeRange.range).toLowerCase();
}

/*
 * The URL grammar every telemetry explorer reads (range=<TimeRange>, plus
 * start/end for Custom), stamped onto a list route so the list can open on
 * the window the tile counted. Values are encoded because Route appends
 * them verbatim and rejects raw spaces and colons.
 */
export function buildRangedListRoute(
  listRoute: Route,
  timeRange: RangeStartAndEndDateTime,
): Route {
  const route: Route = new Route(listRoute.toString());
  const params: Record<string, string> = {
    range: encodeURIComponent(String(timeRange.range)),
  };

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    params["start"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.startValue),
    );
    params["end"] = encodeURIComponent(
      OneUptimeDate.toString(timeRange.startAndEndDate.endValue),
    );
  }

  try {
    return route.addQueryParams(params);
  } catch {
    return listRoute;
  }
}

/*
 * The "Recording health" detail row's value, or undefined to leave the row
 * out entirely.
 *
 * A viewer without the Read Session Replay permission (or on a plan that
 * does not include replay) is shown nothing rather than a permission error
 * in a list of SDK facts - they cannot act on it here, and the settings
 * page is where that conversation belongs. Every other failure IS named,
 * because a silent row would read as "healthy".
 */
export function describeRecordingHealthRow(health: {
  isLoading: boolean;
  error: SessionReplayHealthError | null;
  diagnosis: RecordingHealthDiagnosis;
}): string | undefined {
  if (health.isLoading) {
    return "Checking…";
  }

  if (health.error) {
    if (health.error.kind === "permission" || health.error.kind === "plan") {
      return undefined;
    }

    return describeHealthError(health.error).title;
  }

  return health.diagnosis.title;
}

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
  const [webVitals, setWebVitals] = useState<Array<WebVital>>([]);
  const [webVitalsLoading, setWebVitalsLoading] = useState<boolean>(true);
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
        })
        .catch(() => {
          if (!isCurrent()) {
            return;
          }
          setWebVitalsLoading(false);
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
  const m: SpanMetrics | null = metrics;

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

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Page views",
      value: m ? formatCompact(m.total) : "—",
      icon: IconProp.Activity,
      iconColor: "blue",
      loading: metricsLoading,
      sublabel: "events, selected range",
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent) : "—",
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: metricsLoading,
      sublabel: m ? `${formatCompact(m.errors)} errored` : undefined,
      percent: m ? m.errorRatePercent : null,
      thresholds: { warn: 1, danger: 5 },
    },
    {
      title: "p95 duration",
      value: m ? formatDurationMs(m.p95DurationMs) : "—",
      icon: IconProp.Clock,
      iconColor: "violet",
      loading: metricsLoading,
      sublabel: "page / interaction",
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
    },
  ];

  const charts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Page views"
        icon={IconProp.Activity}
        iconColor="blue"
        series={
          [
            { seriesName: "Page views", data: m?.countSeries ?? [] },
            { seriesName: "Errors", data: m?.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`rum-${modelId.toString()}`}
        showLegend={true}
        loading={metricsLoading && !m}
      />
      <ChartCard
        title="p95 duration"
        icon={IconProp.Clock}
        iconColor="violet"
        series={
          [
            { seriesName: "p95", data: m?.p95Series ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`rum-${modelId.toString()}`}
        yLegend="ms"
        yFormatter={(n: number): string => {
          return formatDurationMs(n);
        }}
        loading={metricsLoading && !m}
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

  return (
    <Fragment>
      {showRumSdkMissingNotice && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Session replay is reporting, the RUM SDK is not"
          title={
            <span>
              Recordings are arriving for this application, so the replay
              snippet and your ingestion key are working. Page views, error
              rate, p95 duration and clients come from a different install — the
              OpenTelemetry browser SDK — and nothing has reported through it
              yet, which is why those tiles read zero. Add the SDK with{" "}
              <code>service.name</code> set to{" "}
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

      <WebVitalsCard vitals={webVitals} loading={webVitalsLoading} />

      <ArchiveResourceCard<RumApplication>
        modelType={RumApplication}
        modelId={modelId}
        singularName="application"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.RUM_APPLICATIONS] as Route,
        )}
      />
    </Fragment>
  );
};

export default RumApplicationOverview;
