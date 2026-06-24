import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceInstance from "Common/Models/DatabaseModels/CloudResourceInstance";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Card from "Common/UI/Components/Card/Card";
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
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import {
  fetchMetricSeries,
  fetchSpanMetrics,
  formatBytes,
  formatCompact,
  formatPercent,
  SpanMetrics,
  TimePoint,
} from "../../../Components/TelemetryResource/telemetryMetrics";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

const CloudResourceOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cloudResource, setCloudResource] = useState<CloudResource | null>(
    null,
  );
  const [instances, setInstances] = useState<Array<CloudResourceInstance>>([]);
  const [instancesLoaded, setInstancesLoaded] = useState<boolean>(false);
  const [metrics, setMetrics] = useState<SpanMetrics | null>(null);
  const [memorySeries, setMemorySeries] = useState<Array<TimePoint>>([]);
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
      const item: CloudResource | null = await ModelAPI.getItem({
        modelType: CloudResource,
        id: modelId,
        select: {
          name: true,
          description: true,
          resourceIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          cloudPlatform: true,
          cloudProvider: true,
          cloudRegion: true,
          cloudAccountId: true,
          labels: { name: true, color: true },
        },
      });

      if (!item?.resourceIdentifier) {
        if (showLoader) {
          setError("Cloud resource not found.");
        }
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setCloudResource(item);
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
      setIsLoading(false);
      setIsRefreshing(false);

      ModelAPI.getList({
        modelType: CloudResourceInstance,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: { cloudResourceId: modelId } as any,
        select: {
          instanceName: true,
          latestCpuPercent: true,
          latestMemoryBytes: true,
          lastSeenAt: true,
        },
        sort: { latestCpuPercent: SortOrder.Descending },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      })
        .then((result: { data: Array<CloudResourceInstance> }) => {
          setInstances(result.data);
          setInstancesLoaded(true);
        })
        .catch(() => {
          setInstancesLoaded(true);
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
    const item: CloudResource | null = cloudResource;
    if (!item?.resourceIdentifier) {
      return;
    }
    const attributes: Record<string, string> = {};
    if (item.cloudPlatform) {
      attributes["resource.cloud.platform"] = String(item.cloudPlatform);
    }
    if (item.cloudAccountId) {
      attributes["resource.cloud.account.id"] = String(item.cloudAccountId);
    }
    if (item.cloudRegion) {
      attributes["resource.cloud.region"] = String(item.cloudRegion);
    }

    setMetricsLoading(true);
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
    Promise.all([
      fetchSpanMetrics({ attributes, start, end }),
      fetchMetricSeries({
        name: "container.memory.usage",
        attributes,
        aggregationType: AggregationType.Sum,
        start,
        end,
      }),
    ])
      .then(([m, mem]: [SpanMetrics, Array<TimePoint>]) => {
        if (ignore) {
          return;
        }
        setMetrics(m);
        setMemorySeries(mem);
        setMetricsLoading(false);
      })
      .catch(() => {
        if (ignore) {
          return;
        }
        setMetricsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [cloudResource, timeRange]);

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "cloud-overview-auto-refresh-interval",
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

  if (!cloudResource) {
    return <ErrorMessage message="Cloud resource not found." />;
  }

  const r: CloudResource = cloudResource;
  const m: SpanMetrics | null = metrics;

  const cpuValues: Array<number> = instances
    .map((i: CloudResourceInstance): number | undefined => {
      return i.latestCpuPercent;
    })
    .filter((n: number | undefined): n is number => {
      return typeof n === "number" && Number.isFinite(n);
    });
  const avgCpu: number | null =
    cpuValues.length > 0
      ? cpuValues.reduce((a: number, b: number): number => {
          return a + b;
        }, 0) / cpuValues.length
      : null;
  const totalMem: number = instances.reduce(
    (sum: number, i: CloudResourceInstance): number => {
      return sum + (i.latestMemoryBytes || 0);
    },
    0,
  );

  const chips: Array<ResourceOverviewChip> = [];
  if (r.cloudProvider) {
    chips.push({ icon: IconProp.Cloud, label: String(r.cloudProvider) });
  }
  if (r.cloudRegion) {
    chips.push({ icon: IconProp.Globe, label: String(r.cloudRegion) });
  }
  if (r.cloudAccountId) {
    chips.push({ icon: IconProp.Info, label: String(r.cloudAccountId) });
  }

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "CPU",
      value: instancesLoaded ? formatPercent(avgCpu) : "…",
      icon: IconProp.ChartBar,
      iconColor: "blue",
      sublabel: "avg across instances",
      percent: avgCpu,
    },
    {
      title: "Memory",
      value: instancesLoaded ? formatBytes(totalMem) : "…",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      sublabel: "total across instances",
    },
    {
      title: "Instances",
      value: instancesLoaded ? formatCompact(instances.length) : "…",
      icon: IconProp.Cube,
      iconColor: "amber",
      sublabel: "running tasks",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_INSTANCES),
    },
    {
      title: "Requests",
      value: m ? formatCompact(m.total) : "…",
      icon: IconProp.Workflow,
      iconColor: "sky",
      sublabel: "spans, selected range",
    },
  ];

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
        syncId={`cloud-${modelId.toString()}`}
        showLegend={true}
        loading={metricsLoading && !m}
      />
      <ChartCard
        title="Memory"
        icon={IconProp.SquareStack}
        iconColor="violet"
        series={
          [{ seriesName: "Memory", data: memorySeries }] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`cloud-${modelId.toString()}`}
        yLegend="Bytes"
        yFormatter={(n: number): string => {
          return formatBytes(n);
        }}
        loading={metricsLoading && memorySeries.length === 0}
      />
    </div>
  );

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "Distributed traces across this environment",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Logs from workloads on this environment",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "Metrics from this environment",
      to: populate(PageMap.CLOUD_RESOURCE_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
  ];

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Cloud Platform", value: r.cloudPlatform },
    { label: "Cloud Provider", value: r.cloudProvider },
    { label: "Cloud Region", value: r.cloudRegion },
    { label: "Cloud Account ID", value: r.cloudAccountId },
    { label: "Environment Key", value: r.resourceIdentifier },
  ];

  const topInstances: Array<CloudResourceInstance> = instances.slice(0, 5);

  return (
    <Fragment>
      <ResourceOverview
        icon={IconProp.Cloud}
        title={(r.name as string) || "Cloud Environment"}
        identifier={(r.cloudPlatform as string) || ""}
        identifierLabel="cloud.platform"
        status={r.otelCollectorStatus}
        lastSeenAt={r.lastSeenAt}
        description={r.description as string}
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
        labels={r.labels}
      />

      {instancesLoaded && topInstances.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Top instances by CPU"
            description="Live CPU and memory per running task / instance."
          >
            <div className="-m-6 -mt-2 border-t border-gray-200 divide-y divide-gray-100">
              {topInstances.map(
                (i: CloudResourceInstance, idx: number): ReactElement => {
                  return (
                    <div
                      key={`inst-${idx}`}
                      className="flex items-center gap-4 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1 truncate font-mono text-sm text-gray-900">
                        {(i.instanceName as string) || "—"}
                      </div>
                      <div className="w-20 text-right text-sm text-gray-700">
                        {formatPercent(
                          typeof i.latestCpuPercent === "number"
                            ? i.latestCpuPercent
                            : null,
                        )}
                      </div>
                      <div className="w-24 text-right text-sm text-gray-500">
                        {formatBytes(
                          typeof i.latestMemoryBytes === "number"
                            ? i.latestMemoryBytes
                            : null,
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </Card>
        </div>
      ) : (
        <></>
      )}

      <ArchiveResourceCard<CloudResource>
        modelType={CloudResource}
        modelId={modelId}
        singularName="cloud resource"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_RESOURCES] as Route,
        )}
      />
    </Fragment>
  );
};

export default CloudResourceOverview;
