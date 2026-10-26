import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Service from "Common/Models/DatabaseModels/Service";
import TechStack from "Common/Types/Service/TechStack";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import TechStackView from "../../../Components/TechStack/TechStackView";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import ResourceSecurityCard from "../../../Components/SecurityConnections/ResourceSecurityCard";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import OneUptimeDate from "Common/Types/Date";
import {
  fetchLogAndExceptionSignals,
  fetchSpanMetrics,
  formatCompact,
  formatDurationMs,
  formatPercent,
  LogAndExceptionSignals,
  SpanMetrics,
  TimePoint,
} from "../../../Components/TelemetryResource/telemetryMetrics";
import {
  detectServiceLanguage,
  formatRuntimeValue,
  probeRuntimeCharts,
  ProbedRuntimeChart,
  SERVICE_LANGUAGE_DISPLAY_NAMES,
  ServiceLanguage,
} from "../../../Components/TelemetryResource/serviceGoldenMetrics";
import { SERVICE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/ServiceMetricDescriptions";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

// A service is "connected" if telemetry arrived in the last 30 minutes.
const CONNECTED_WINDOW_MS: number = 30 * 60 * 1000;

const meanOf: (series: Array<TimePoint>) => number | null = (
  series: Array<TimePoint>,
): number | null => {
  if (series.length === 0) {
    return null;
  }
  const sum: number = series.reduce((acc: number, p: TimePoint): number => {
    return acc + p.y;
  }, 0);
  return sum / series.length;
};

const ServiceView: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [service, setService] = useState<Service | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");
  const [spanMetrics, setSpanMetrics] = useState<SpanMetrics | null>(null);
  const [logExceptionSignals, setLogExceptionSignals] =
    useState<LogAndExceptionSignals | null>(null);
  const [runtimeCharts, setRuntimeCharts] = useState<Array<ProbedRuntimeChart>>(
    [],
  );
  const [metricsLoading, setMetricsLoading] = useState<boolean>(true);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);
  // Bumped by a refresh; the metrics reload when it changes.
  const [metricsRefreshCount, setMetricsRefreshCount] = useState<number>(0);
  // Set while the metrics for the current window are still loading.
  const metricsInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * showLoader=false refetches in place (used after an inline edit) so the
   * page doesn't flash back to the full-page loader.
   */
  const loadModel: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    if (showLoader) {
      setIsLoading(true);
      setError("");
    } else {
      setIsRefreshing(true);
    }
    try {
      const item: Service | null = await ModelAPI.getItem({
        modelType: Service,
        id: modelId,
        select: {
          name: true,
          description: true,
          techStack: true,
          labels: {
            name: true,
            color: true,
          },
          lastSeenAt: true,
          serviceVersion: true,
          deploymentEnvironment: true,
          serviceNamespace: true,
          runtimeName: true,
          runtimeVersion: true,
          telemetrySdkLanguage: true,
          cloudProvider: true,
          cloudPlatform: true,
          cloudRegion: true,
          cloudAccountId: true,
        },
      });

      if (!item) {
        if (showLoader) {
          setError("Service not found.");
        }
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setService(item);
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
      setIsLoading(false);
      setIsRefreshing(false);
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
    loadModel(true).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * The metrics follow what scopes them, not the model object: loadModel
   * stores a new object on every refresh, and an effect keyed on it re-ran
   * on every tick, cancelling a load still running for the same window. The
   * span, log and exception queries are scoped by the page's id alone, the
   * runtime charts by the language these fields are detected from. A
   * refresh reloads them through metricsRefreshCount instead.
   */
  const metricsScope: string = service
    ? JSON.stringify({
        telemetrySdkLanguage: service.telemetrySdkLanguage || "",
        runtimeName: service.runtimeName || "",
        techStack: service.techStack || [],
      })
    : "";

  useEffect(() => {
    if (!service) {
      return;
    }

    const language: ServiceLanguage | null = detectServiceLanguage({
      telemetrySdkLanguage: service.telemetrySdkLanguage,
      runtimeName: service.runtimeName,
      techStack: service.techStack,
    });

    setMetricsLoading(true);
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;
    setChartWindow({ start, end });

    /*
     * Staleness guard: a wide-range fetch fans out many aggregate queries
     * and can resolve after a subsequently selected narrower range (a zoom,
     * its reset, the picker) or a Refresh — without the guard the older
     * response would clobber the newer one.
     */
    let ignore: boolean = false;
    metricsInFlightRef.current = true;
    Promise.all([
      fetchSpanMetrics({ primaryEntityId: modelId, start, end }),
      probeRuntimeCharts({ language, primaryEntityId: modelId, start, end }),
      fetchLogAndExceptionSignals({ primaryEntityId: modelId, start, end }),
    ])
      .then(
        ([m, runtime, signals]: [
          SpanMetrics,
          Array<ProbedRuntimeChart>,
          LogAndExceptionSignals,
        ]) => {
          if (ignore) {
            return;
          }
          metricsInFlightRef.current = false;
          setSpanMetrics(m);
          setRuntimeCharts(runtime);
          setLogExceptionSignals(signals);
          setMetricsLoading(false);
        },
      )
      .catch(() => {
        if (ignore) {
          return;
        }
        metricsInFlightRef.current = false;
        setMetricsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [metricsScope, timeRange, metricsRefreshCount]);

  /*
   * A refresh reloads the model and the metrics. The auto-refresh tick lets
   * a metrics load that is still running land instead of replacing it with
   * one for the same window: when the span, runtime and log queries outlast
   * the interval, the tiles and charts would otherwise never load.
   */
  const refresh: (options: { isAutoRefresh: boolean }) => void = (options: {
    isAutoRefresh: boolean;
  }): void => {
    loadModel(false).catch(() => {
      // loadModel surfaces its own errors; a refresh stays silent.
    });

    if (options.isAutoRefresh && metricsInFlightRef.current) {
      return;
    }

    setMetricsRefreshCount((count: number): number => {
      return count + 1;
    });
  };

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "service-overview-auto-refresh-interval",
    onRefresh: (): void => {
      refresh({ isAutoRefresh: true });
    },
  });

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!service) {
    return <ErrorMessage message="Service not found." />;
  }

  const r: Service = service;
  const m: SpanMetrics | null = spanMetrics;

  const language: ServiceLanguage | null = detectServiceLanguage({
    telemetrySdkLanguage: r.telemetrySdkLanguage,
    runtimeName: r.runtimeName,
    techStack: r.techStack,
  });
  const languageDisplay: string | undefined = language
    ? SERVICE_LANGUAGE_DISPLAY_NAMES[language]
    : undefined;

  const lastSeen: Date | undefined = r.lastSeenAt
    ? new Date(r.lastSeenAt as unknown as string)
    : undefined;
  const status: string =
    lastSeen && Date.now() - lastSeen.getTime() < CONNECTED_WINDOW_MS
      ? "connected"
      : "disconnected";

  const chips: Array<ResourceOverviewChip> = [];
  if (languageDisplay) {
    chips.push({ icon: IconProp.Code, label: languageDisplay });
  }
  if (r.runtimeName) {
    chips.push({
      icon: IconProp.CPUChip,
      label: [r.runtimeName, r.runtimeVersion].filter(Boolean).join(" "),
    });
  }
  if (r.serviceVersion) {
    chips.push({ icon: IconProp.Tag, label: String(r.serviceVersion) });
  }
  if (r.deploymentEnvironment) {
    chips.push({
      icon: IconProp.Globe,
      label: String(r.deploymentEnvironment),
    });
  }
  if (r.cloudProvider) {
    chips.push({
      icon: IconProp.Cloud,
      label: [r.cloudProvider, r.cloudRegion].filter(Boolean).join(" "),
    });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Requests",
      value: m ? formatCompact(m.total) : "—",
      icon: IconProp.Workflow,
      iconColor: "sky",
      loading: metricsLoading,
      sublabel: "spans, selected range",
      to: populate(PageMap.SERVICE_VIEW_TRACES),
      description: SERVICE_METRIC_DESCRIPTIONS.requests,
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent) : "—",
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: metricsLoading,
      sublabel: "of spans errored",
      percent: m?.errorRatePercent,
      thresholds: { warn: 1, danger: 5 },
      description: SERVICE_METRIC_DESCRIPTIONS.errorRate,
    },
    {
      title: "Latency (p95)",
      value: m ? formatDurationMs(m.p95DurationMs) : "—",
      icon: IconProp.Clock,
      iconColor: "amber",
      loading: metricsLoading,
      sublabel: "span duration",
      description: SERVICE_METRIC_DESCRIPTIONS.latencyP95,
    },
  ];

  const firstRuntime: ProbedRuntimeChart | undefined = runtimeCharts[0];
  if (firstRuntime) {
    /*
     * Counter-style charts (per-bucket deltas) total over the range;
     * gauge-style charts average.
     */
    const isRangeTotal: boolean =
      firstRuntime.def.aggregationType === AggregationType.Sum ||
      firstRuntime.def.cumulativeCounter === true;
    const tileValue: number | null = isRangeTotal
      ? firstRuntime.series.reduce((acc: number, p: TimePoint): number => {
          return acc + p.y;
        }, 0)
      : meanOf(firstRuntime.series);
    tiles.push({
      title: firstRuntime.def.title,
      value: formatRuntimeValue(tileValue, firstRuntime.def.unit),
      icon: firstRuntime.def.icon,
      iconColor: firstRuntime.def.iconColor,
      loading: metricsLoading,
      sublabel: firstRuntime.def.sublabel,
      percent: firstRuntime.def.unit === "percent" ? tileValue : undefined,
      description: firstRuntime.def.description,
    });
  } else {
    tiles.push({
      title: "Technology",
      value: languageDisplay || "Unknown",
      icon: IconProp.Code,
      iconColor: "slate",
      sublabel: "detected from telemetry",
      description: SERVICE_METRIC_DESCRIPTIONS.technology,
    });
  }

  const syncId: string = `service-${modelId.toString()}`;

  /*
   * A chart keeps its last lines on screen while a refresh or a zoom
   * refetches; only the first load shows the skeleton. An auto-refresh tick
   * that finds no load running re-runs the metrics effect, and a chart
   * swapped for its skeleton would throw away a drag-to-zoom the reader is
   * in the middle of.
   */
  const spanChartsLoading: boolean = metricsLoading && !m;
  const signalChartsLoading: boolean = metricsLoading && !logExceptionSignals;

  const charts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Requests"
        icon={IconProp.Workflow}
        iconColor="sky"
        series={
          [
            { seriesName: "Requests", data: m?.countSeries ?? [] },
            { seriesName: "Errors", data: m?.errorSeries ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={spanChartsLoading}
        description={SERVICE_METRIC_DESCRIPTIONS.requestsChart}
      />
      <ChartCard
        title="Latency (p95)"
        icon={IconProp.Clock}
        iconColor="amber"
        series={
          [
            { seriesName: "p95", data: m?.p95Series ?? [] },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        yFormatter={(n: number): string => {
          return formatDurationMs(n);
        }}
        loading={spanChartsLoading}
        description={SERVICE_METRIC_DESCRIPTIONS.latencyP95Chart}
      />
      <ChartCard
        title="Logs"
        icon={IconProp.Logs}
        iconColor="amber"
        series={
          [
            {
              seriesName: "Log lines",
              data: logExceptionSignals?.logs.countSeries ?? [],
            },
            {
              seriesName: "Errors",
              data: logExceptionSignals?.logs.errorSeries ?? [],
            },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={signalChartsLoading}
        description={SERVICE_METRIC_DESCRIPTIONS.logsChart}
      />
      <ChartCard
        title="Exceptions"
        icon={IconProp.Bug}
        iconColor="rose"
        series={
          [
            {
              seriesName: "Unhandled",
              data: logExceptionSignals?.exceptions.unhandledSeries ?? [],
            },
            {
              seriesName: "Handled",
              data: logExceptionSignals?.exceptions.handledSeries ?? [],
            },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={syncId}
        showLegend={true}
        loading={signalChartsLoading}
        description={SERVICE_METRIC_DESCRIPTIONS.exceptionsChart}
      />
      {runtimeCharts.map((chart: ProbedRuntimeChart): ReactElement => {
        return (
          <ChartCard
            key={chart.def.key}
            title={chart.def.title}
            icon={chart.def.icon}
            iconColor={chart.def.iconColor}
            series={
              [
                { seriesName: chart.def.title, data: chart.series },
              ] as Array<SeriesPoint>
            }
            windowStart={chartWindow?.start ?? null}
            windowEnd={chartWindow?.end ?? null}
            syncId={syncId}
            yMax={chart.def.unit === "percent" ? 100 : "auto"}
            yFormatter={(n: number): string => {
              return formatRuntimeValue(n, chart.def.unit);
            }}
            loading={metricsLoading && chart.series.length === 0}
            description={chart.def.description}
          />
        );
      })}
    </div>
  );

  /*
   * One Details card (follow-up of #4980): the service's ID and tech stack,
   * which a second "Service Details" card used to show beside its name, are
   * rows here, its labels the Labels card under it, and its description
   * the card's own line. A row the service never reported is left out
   * (ResourceOverviewDetails), so a service without a cloud detector shows
   * no four empty cloud rows.
   */
  const techStack: Array<TechStack> = r.techStack || [];
  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Service ID", value: modelId.toString() },
    {
      /*
       * The tech stack set in Settings, else the language detected from
       * the service's telemetry (telemetry.sdk.language, then the runtime):
       * the answer the Technology tile and chip give too.
       */
      label: "Technology",
      value: techStack.length > 0 ? techStack.join(", ") : languageDisplay,
      element:
        techStack.length > 0 ? (
          <TechStackView techStack={techStack} />
        ) : undefined,
      mono: false,
    },
    {
      label: "Runtime",
      value:
        [r.runtimeName, r.runtimeVersion].filter(Boolean).join(" ") ||
        undefined,
    },
    { label: "Service Version", value: r.serviceVersion },
    { label: "Deployment Environment", value: r.deploymentEnvironment },
    { label: "Service Namespace", value: r.serviceNamespace },
    { label: "Cloud Provider", value: r.cloudProvider },
    { label: "Cloud Platform", value: r.cloudPlatform },
    { label: "Cloud Region", value: r.cloudRegion },
    { label: "Cloud Account ID", value: r.cloudAccountId },
  ];

  /*
   * Drag-to-zoom (issue #4105): a drag across any chart on the page sets
   * the page's range to the window dragged out, and a double-click on any
   * chart - or "Reset zoom" beside the picker - puts the range from before
   * the zoom back. Every chart and tile is fetched from `timeRange`, so all
   * of them follow; a zoomed (custom) range also stays put across
   * auto-refresh ticks.
   */
  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      <ResourceOverview
        icon={IconProp.SquareStack}
        title={(r.name as string) || "Service"}
        identifier={(r.name as string) || ""}
        identifierLabel="service.name"
        status={status}
        lastSeenAt={lastSeen}
        description={r.description as string}
        chips={chips}
        tiles={tiles}
        charts={charts}
        controls={
          <AutoRefreshControl
            autoRefreshInterval={autoRefreshInterval}
            onAutoRefreshIntervalChange={setAutoRefreshInterval}
            onManualRefresh={(): void => {
              refresh({ isAutoRefresh: false });
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
        labels={r.labels}
        settingsRoute={populate(PageMap.SERVICE_VIEW_SETTINGS)}
      />

      <div className="mt-6">
        <ResourceActivityCards
          modelId={modelId}
          resourceQueryKey="services"
          refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
          incidentsRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_VIEW_INCIDENTS] as Route,
            { modelId: modelId },
          )}
          alertsRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_VIEW_ALERTS] as Route,
            { modelId: modelId },
          )}
          scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.SERVICE_VIEW_SCHEDULED_MAINTENANCE] as Route,
            { modelId: modelId },
          )}
        />
        {/*
         * What Security Events found about it this week, for whoever
         * may read it (Components/SecurityConnections).
         */}
        <ResourceSecurityCard
          kind={SecurityConnectionKind.Service}
          modelId={modelId}
          refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
        />
      </div>

    </TimeRangeZoomScope>
  );
};

export default ServiceView;
