import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Metric from "Common/Models/AnalyticsModels/Metric";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ValueFormatter from "Common/Utils/ValueFormatter";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/VMwareMetricDescriptions";
import ResourceAiAgentStatusSummaryCard from "../../ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../ResourceAiAgent/ResourceAiAgentDescriptors";
import AutoRefreshControl from "../../TelemetryResource/AutoRefreshControl";
import ChartCard from "../../TelemetryResource/ChartCard";
import useAutoRefresh from "../../TelemetryResource/useAutoRefresh";
import {
  VMWARE_DISK_LATENCY_GAUGE_THRESHOLDS,
  VMWARE_HOST_BUSIEST_VM_LIMIT,
  VMWARE_HOST_OVERVIEW_METRICS,
  VMWARE_HOST_TILE_WINDOW_MINUTES,
  VMwareBusyVirtualMachine,
  VMwareHostIdentity,
  VMwareHostMetric,
  VMwareHostMetricResults,
  VMwareHostOverviewMetrics,
  VMwareHostVirtualMachineSummary,
  buildVMwareHostAggregateBy,
  formatVMwareMilliseconds,
  getBusiestVMwareVirtualMachines,
  getVMwareDiskLatencyGaugePercent,
  summarizeVMwareHostMetrics,
  toFiniteNumber,
} from "../../../Pages/VMware/Utils/VMwareHostData";
import {
  formatBytes,
  formatMhz,
  formatPercent,
} from "../../../Pages/VMware/Utils/VMwareResourceUtils";
import VMwareHostAlertsCard from "./VMwareHostAlertsCard";
import VMwareHostBusiestVirtualMachines from "./VMwareHostBusiestVirtualMachines";
import VMwareHostDetailsCard from "./VMwareHostDetailsCard";
import {
  VMwareHostNetworkAdaptersCard,
  VMwareHostStorageDevicesCard,
} from "./VMwareHostDeviceTables";
import VMwareHostOpenEventsCard from "./VMwareHostOpenEventsCard";

/*
 * An ESXi host's Overview: the same story the host page outside VMware
 * tells, from what vCenter reports - how busy the host is now (tiles), how
 * that moved over the selected range (charts), what is wrong with it
 * (open incidents and alerts), what keeps it busy (its virtual machines),
 * its hardware (network adapters and storage devices), whether anyone will
 * hear when it is in trouble (Host alerts), its details and the AI agent
 * that can look at it.
 *
 * The tiles, charts and tables follow the time picker and refresh with it;
 * the virtual machines and the details are the latest inventory, which the
 * page re-reads on the same refresh.
 */

export const DEFAULT_VMWARE_HOST_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

export const VMWARE_HOST_REFRESH_STORAGE_KEY: string =
  "vmware-host-overview-auto-refresh-interval";

export interface ComponentProps {
  vcenterId: ObjectID;
  identity: VMwareHostIdentity;
  externalId: string;
  row: VMwareResourceModel | null;
  virtualMachineRows: Array<VMwareResourceModel>;
  virtualMachineSummary: VMwareHostVirtualMachineSummary;
  clusterRoute?: Route | undefined;
  getVirtualMachineRoute: (externalId: string) => Route;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
  onShowVirtualMachines: () => void;
  // Re-read the host's inventory row and its VMs (on every refresh).
  onRefreshInventory: () => void;
}

interface ChartWindow {
  start: Date;
  end: Date;
}

function formatBytesPerSecond(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return ValueFormatter.formatValue(value, "By/s");
}

const VMwareHostOverviewTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    DEFAULT_VMWARE_HOST_TIME_RANGE,
  );
  const [chartWindow, setChartWindow] = useState<ChartWindow | null>(null);
  const [metrics, setMetrics] = useState<VMwareHostOverviewMetrics | null>(
    null,
  );
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");

  /*
   * Only the newest fetch may commit: a zoom, its reset, the picker and
   * Refresh can each start one while another is still out, and a slow
   * answer for the window the reader just left must not repaint the page.
   */
  const fetchSequence: React.MutableRefObject<number> = useRef<number>(0);

  const fetchMetrics: () => Promise<void> = async (): Promise<void> => {
    const sequence: number = ++fetchSequence.current;
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    setIsRefreshing(true);

    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;

    const metricKeys: Array<VMwareHostMetric> = Object.values(
      VMwareHostMetric,
    ) as Array<VMwareHostMetric>;

    const errors: Array<string> = [];

    const answers: Array<AggregatedResult | null> = await Promise.all(
      metricKeys.map(
        async (metric: VMwareHostMetric): Promise<AggregatedResult | null> => {
          if (!projectId) {
            return null;
          }

          try {
            return await AnalyticsModelAPI.aggregate<Metric>({
              modelType: Metric,
              aggregateBy: buildVMwareHostAggregateBy({
                projectId: projectId.toString(),
                identity: props.identity,
                read: VMWARE_HOST_OVERVIEW_METRICS[metric],
                start: start,
                end: end,
              }),
            });
          } catch (err) {
            errors.push(API.getFriendlyMessage(err));
            return null;
          }
        },
      ),
    );

    if (sequence !== fetchSequence.current) {
      return;
    }

    const results: VMwareHostMetricResults = {};

    metricKeys.forEach((metric: VMwareHostMetric, index: number) => {
      results[metric] = answers[index] || null;
    });

    /*
     * One read that failed leaves its own tile or table empty; only when
     * every read failed is there nothing to show but why.
     */
    setError(errors.length === metricKeys.length ? errors[0] || "" : "");
    setMetrics(
      summarizeVMwareHostMetrics({
        results: results,
        tileWindowStart: OneUptimeDate.addRemoveMinutes(
          end,
          -VMWARE_HOST_TILE_WINDOW_MINUTES,
        ),
      }),
    );
    setChartWindow({ start: start, end: end });
    setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    setIsRefreshing(false);
    setIsInitialLoading(false);
  };

  const refresh: () => void = (): void => {
    fetchMetrics().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsRefreshing(false);
      setIsInitialLoading(false);
    });
    props.onRefreshInventory();
  };

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: VMWARE_HOST_REFRESH_STORAGE_KEY,
    onRefresh: refresh,
  });

  useEffect(() => {
    fetchMetrics().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsRefreshing(false);
      setIsInitialLoading(false);
    });
  }, [
    timeRange,
    props.identity.vcenterName,
    props.identity.datacenterName,
    props.identity.hostName,
  ]);

  const refreshToken: number | undefined = lastRefreshedAt
    ? lastRefreshedAt.getTime()
    : undefined;

  const busiest: Array<VMwareBusyVirtualMachine> =
    getBusiestVMwareVirtualMachines({
      rows: props.virtualMachineRows,
      now: OneUptimeDate.getCurrentDate(),
      limit: VMWARE_HOST_BUSIEST_VM_LIMIT,
    });

  const cpuCapacityMhz: number | null = toFiniteNumber(
    props.row?.cpuCapacityMhz,
  );
  const memoryCapacityBytes: number | null = toFiniteNumber(
    props.row?.maxMemoryBytes,
  );

  const renderTiles: () => ReactElement = (): ReactElement => {
    if (isInitialLoading || !metrics) {
      return (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          aria-busy="true"
        >
          {Array.from({ length: 5 }, (_: unknown, index: number) => {
            return (
              <div
                key={`vmware-host-tile-skeleton-${index}`}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
                <div className="mt-3 h-8 w-24 animate-pulse rounded bg-gray-100" />
                <div className="mt-2 h-3 w-20 animate-pulse rounded bg-gray-100" />
              </div>
            );
          })}
        </div>
      );
    }

    const tiles: VMwareHostOverviewMetrics["tiles"] = metrics.tiles;
    const networkTotal: number | null =
      tiles.networkReceivedBytesPerSecond === null &&
      tiles.networkSentBytesPerSecond === null
        ? null
        : (tiles.networkReceivedBytesPerSecond || 0) +
          (tiles.networkSentBytesPerSecond || 0);

    return (
      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
        data-testid="vmware-host-tiles"
      >
        <GoldenMetricTile
          title={tx("CPU")}
          icon={IconProp.CPUChip}
          iconColor="blue"
          value={formatPercent(tiles.cpuPercent)}
          sublabel={
            cpuCapacityMhz !== null
              ? translator.translateTemplate("of {{capacity}}", {
                  capacity: formatMhz(cpuCapacityMhz),
                })
              : undefined
          }
          percent={tiles.cpuPercent}
          description={VMWARE_METRIC_DESCRIPTIONS.hostCpu}
        />
        <GoldenMetricTile
          title={tx("Memory")}
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(tiles.memoryPercent)}
          sublabel={
            memoryCapacityBytes !== null
              ? translator.translateTemplate("of {{capacity}}", {
                  capacity: formatBytes(memoryCapacityBytes),
                })
              : undefined
          }
          percent={tiles.memoryPercent}
          description={VMWARE_METRIC_DESCRIPTIONS.hostMemory}
        />
        <GoldenMetricTile
          title={tx("Disk latency")}
          icon={IconProp.Database}
          iconColor="amber"
          value={formatVMwareMilliseconds(tiles.highestDiskLatencyMs)}
          sublabel={tx("slowest disk")}
          percent={getVMwareDiskLatencyGaugePercent(tiles.highestDiskLatencyMs)}
          thresholds={VMWARE_DISK_LATENCY_GAUGE_THRESHOLDS}
          description={VMWARE_METRIC_DESCRIPTIONS.hostPageDiskLatency}
        />
        <GoldenMetricTile
          title={tx("Network")}
          icon={IconProp.Wifi}
          iconColor="emerald"
          value={formatBytesPerSecond(networkTotal)}
          sublabel={
            networkTotal !== null
              ? translator.translateTemplate("in {{received}} · out {{sent}}", {
                  received: formatBytesPerSecond(
                    tiles.networkReceivedBytesPerSecond,
                  ),
                  sent: formatBytesPerSecond(tiles.networkSentBytesPerSecond),
                })
              : undefined
          }
          description={VMWARE_METRIC_DESCRIPTIONS.hostPageNetwork}
        />
        <GoldenMetricTile
          title={tx("Virtual machines")}
          icon={IconProp.ComputerDesktop}
          iconColor="slate"
          value={String(props.virtualMachineSummary.running)}
          sublabel={translator.translateTemplate("running · {{total}} total", {
            total: props.virtualMachineSummary.total,
          })}
          description={VMWARE_METRIC_DESCRIPTIONS.hostPageVirtualMachines}
        />
      </div>
    );
  };

  const syncId: string = `vmware-host-${props.vcenterId.toString()}-${props.identity.hostName}`;

  const percentFormatter: (value: number) => string = (
    value: number,
  ): string => {
    return `${Math.round(value)}%`;
  };

  const renderCharts: () => ReactElement = (): ReactElement => {
    const isLoading: boolean = isInitialLoading || !metrics;
    const windowStart: Date | null = chartWindow?.start ?? null;
    const windowEnd: Date | null = chartWindow?.end ?? null;

    const cpu: Array<SeriesPoint> = metrics?.series.cpuPercent.length
      ? [
          {
            seriesName: tx("CPU"),
            data: metrics.series.cpuPercent,
          },
        ]
      : [];
    const memory: Array<SeriesPoint> = metrics?.series.memoryPercent.length
      ? [
          {
            seriesName: tx("Memory"),
            data: metrics.series.memoryPercent,
          },
        ]
      : [];
    const latency: Array<SeriesPoint> = metrics?.series.highestDiskLatencyMs
      .length
      ? [
          {
            seriesName: tx("Slowest disk"),
            data: metrics.series.highestDiskLatencyMs,
          },
        ]
      : [];
    const network: Array<SeriesPoint> = [];

    if (metrics?.series.networkReceivedBytesPerSecond.length) {
      network.push({
        seriesName: tx("Received"),
        data: metrics.series.networkReceivedBytesPerSecond,
      });
    }

    if (metrics?.series.networkSentBytesPerSecond.length) {
      network.push({
        seriesName: tx("Sent"),
        data: metrics.series.networkSentBytesPerSecond,
      });
    }

    return (
      <div
        className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-testid="vmware-host-charts"
      >
        <ChartCard
          title={tx("CPU")}
          icon={IconProp.CPUChip}
          iconColor="blue"
          series={cpu}
          windowStart={windowStart}
          windowEnd={windowEnd}
          syncId={syncId}
          yLegend="%"
          yMax={100}
          yFormatter={percentFormatter}
          loading={isLoading}
          description={VMWARE_METRIC_DESCRIPTIONS.hostPageCpuChart}
        />
        <ChartCard
          title={tx("Memory")}
          icon={IconProp.SquareStack}
          iconColor="violet"
          series={memory}
          windowStart={windowStart}
          windowEnd={windowEnd}
          syncId={syncId}
          yLegend="%"
          yMax={100}
          yFormatter={percentFormatter}
          loading={isLoading}
          description={VMWARE_METRIC_DESCRIPTIONS.hostPageMemoryChart}
        />
        <ChartCard
          title={tx("Disk latency")}
          icon={IconProp.Database}
          iconColor="amber"
          series={latency}
          windowStart={windowStart}
          windowEnd={windowEnd}
          syncId={syncId}
          yLegend="ms"
          yFormatter={(value: number): string => {
            return formatVMwareMilliseconds(value);
          }}
          loading={isLoading}
          description={VMWARE_METRIC_DESCRIPTIONS.hostPageDiskLatencyChart}
        />
        <ChartCard
          title={tx("Network")}
          icon={IconProp.Wifi}
          iconColor="emerald"
          series={network}
          windowStart={windowStart}
          windowEnd={windowEnd}
          syncId={syncId}
          yFormatter={(value: number): string => {
            return formatBytesPerSecond(value);
          }}
          showLegend={network.length > 1}
          loading={isLoading}
          description={VMWARE_METRIC_DESCRIPTIONS.hostPageNetworkChart}
        />
      </div>
    );
  };

  /*
   * One zoom for the whole tab (issue #4105): a drag on any chart narrows
   * the range, and the tiles, charts and tables are read again over it; a
   * double-click, or Reset zoom beside the picker, puts it back.
   */
  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">
            {tx("Resource usage")}
          </h3>
          <p className="text-xs text-gray-500">
            {tx("As vCenter reports this host, over the selected time range")}
          </p>
        </div>
        <div className="max-w-full" data-testid="vmware-host-controls">
          <AutoRefreshControl
            autoRefreshInterval={autoRefreshInterval}
            onAutoRefreshIntervalChange={setAutoRefreshInterval}
            onManualRefresh={refresh}
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
        </div>
      </div>

      {error ? (
        <div className="mb-6">
          <ErrorMessage message={error} />
        </div>
      ) : (
        <></>
      )}

      {renderTiles()}

      <VMwareHostOpenEventsCard
        vcenterId={props.vcenterId}
        hostName={props.identity.hostName}
        getIncidentRoute={props.getIncidentRoute}
        getAlertRoute={props.getAlertRoute}
        incidentsRoute={props.incidentsRoute}
        alertsRoute={props.alertsRoute}
        refreshToken={refreshToken}
      />

      {renderCharts()}

      <VMwareHostBusiestVirtualMachines
        virtualMachines={busiest}
        summary={props.virtualMachineSummary}
        getVirtualMachineRoute={props.getVirtualMachineRoute}
        onShowAll={props.onShowVirtualMachines}
      />

      <VMwareHostNetworkAdaptersCard
        adapters={metrics?.networkAdapters || []}
      />

      <VMwareHostStorageDevicesCard devices={metrics?.storageDevices || []} />

      <VMwareHostAlertsCard
        vcenterId={props.vcenterId}
        vcenterName={props.identity.vcenterName}
        getRecommendationsRoute={props.getRecommendationsRoute}
        getMonitorRoute={props.getMonitorRoute}
        refreshToken={refreshToken}
      />

      <VMwareHostDetailsCard
        identity={props.identity}
        externalId={props.externalId}
        row={props.row}
        clusterRoute={props.clusterRoute}
        virtualMachines={props.virtualMachineSummary}
      />

      {/*
       * Last, as on every overview: the vCenter's AI agent, which OneUptime
       * AI works through for this host too (govc host.info, its events and
       * performance counters), with what AI may do.
       */}
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.VMwareVCenter)}
        resourceId={props.vcenterId}
        refreshToken={refreshToken}
      />
    </TimeRangeZoomScope>
  );
};

export default VMwareHostOverviewTab;
