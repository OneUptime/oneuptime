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
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
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
import {
  fetchSpanMetrics,
  fetchWebVitals,
  formatCompact,
  formatDurationMs,
  formatPercent,
  SpanMetrics,
  WebVital,
} from "../../../Components/TelemetryResource/telemetryMetrics";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const RumApplicationOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [clientCount, setClientCount] = useState<number | null>(null);
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
        .then(setClientCount)
        .catch(() => {
          return setClientCount(0);
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

  useEffect(() => {
    if (!rumApplication?.appIdentifier) {
      return;
    }
    setMetricsLoading(true);
    setWebVitalsLoading(true);
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;
    setChartWindow({ start, end });

    /*
     * Staleness guard: a slow wide-range fetch can resolve after a
     * subsequently selected narrower range — without the guard the older
     * response would clobber the newer one.
     */
    let ignore: boolean = false;

    // RUM telemetry is tagged with primaryEntityId = this application's id.
    fetchSpanMetrics({ primaryEntityId: modelId, start, end })
      .then((m: SpanMetrics) => {
        if (ignore) {
          return;
        }
        setMetrics(m);
        setMetricsLoading(false);
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setMetricsLoading(false);
      });

    fetchWebVitals({ primaryEntityId: modelId, start, end })
      .then((v: Array<WebVital>) => {
        if (ignore) {
          return;
        }
        setWebVitals(v);
        setWebVitalsLoading(false);
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setWebVitalsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [rumApplication, timeRange]);

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "rum-overview-auto-refresh-interval",
    onRefresh: (): void => {
      fetchModel(false).catch(() => {});
    },
  });

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
      value: m ? formatCompact(m.total) : "…",
      icon: IconProp.Activity,
      iconColor: "blue",
      sublabel: "events, selected range",
    },
    {
      title: "Error rate",
      value: m ? formatPercent(m.errorRatePercent) : "…",
      icon: IconProp.Alert,
      iconColor: "rose",
      sublabel: m ? `${formatCompact(m.errors)} errored` : undefined,
      percent: m ? m.errorRatePercent : null,
      thresholds: { warn: 1, danger: 5 },
    },
    {
      title: "p95 duration",
      value: m ? formatDurationMs(m.p95DurationMs) : "…",
      icon: IconProp.Clock,
      iconColor: "violet",
      sublabel: "page / interaction",
    },
    {
      title: "Clients",
      value: clientCount === null ? "…" : formatCompact(clientCount),
      icon: IconProp.Window,
      iconColor: "amber",
      sublabel: "platforms seen",
      to: populate(PageMap.RUM_APPLICATION_VIEW_CLIENTS),
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

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "App Identifier (service.name)", value: a.appIdentifier },
    { label: "Client Type", value: a.clientType },
    { label: "SDK Language (telemetry.sdk.language)", value: a.sdkLanguage },
    { label: "SDK Version", value: a.agentVersion },
  ];

  return (
    <Fragment>
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
              fetchModel(false).catch(() => {});
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
    </Fragment>
  );
};

export default RumApplicationOverview;
