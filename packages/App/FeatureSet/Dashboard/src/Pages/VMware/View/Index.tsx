import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import EditInSettingsLink from "../../../Components/TelemetryResource/EditInSettingsLink";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import VMwareCollectionStatusCard from "../../../Components/VMware/VMwareCollectionStatusCard";
import { isProbeCollected } from "../../../Components/VMware/VMwareProbeCollectionView";
import { getVMwareVCenterConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import { getConfiguredOneUptimeUrl } from "../../../Components/SetupGuide/ConfiguredOneUptimeUrl";
import ResourceAiAgentStatusSummaryCard from "../../../Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import Route from "Common/Types/API/Route";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import OneUptimeDate from "Common/Types/Date";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import LineChartElement from "Common/UI/Components/Charts/Line/LineChart";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import {
  XAxis as ChartXAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
} from "Common/Types/Dashboard/DashboardViewConfig";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import ResourceHeroDescription from "../../../Components/TelemetryResource/ResourceHeroDescription";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_CONTROLS_TEST_ID,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_TEST_ID,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_TEST_ID,
} from "../../../Components/TelemetryResource/ResourceHeroLayout";
import {
  getResourceConnectionLabel,
  getResourceHealthLabel,
} from "../../../Components/TelemetryResource/ResourceHeroStatus";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import ValueFormatter from "Common/Utils/ValueFormatter";
import GoldenMetricTile, {
  GoldenMetricTileTone,
  tileColorClasses,
} from "../../../Components/Infrastructure/GoldenMetricTile";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/VMwareMetricDescriptions";
import {
  VMwareInventorySummary as VMwareInventoryCounts,
  VMwareResourceKind,
  fetchVMwareInventoryRows,
  fetchVMwareInventorySummary,
  fetchVMwareVirtualMachinesByCpuReady,
  fetchVMwareVirtualMachinesThatMayNeedAttention,
  formatBytes,
  displayNameForResource,
  hasFreshMetrics,
} from "../Utils/VMwareResourceUtils";
import {
  VMWARE_CPU_READY_WARNING_PERCENT,
  VMWARE_DATASTORE_CRITICAL_PERCENT,
  VMWARE_DATASTORE_WARNING_PERCENT,
  findVMwareDatacenter,
  getVMwareAttentionItems,
  getVMwareDatastorePercent,
  getVMwareHealth,
  getVMwareHostState,
  isVMwareHostRunning,
} from "../Utils/VMwareHealth";
import {
  VMwareNotEffectiveHosts,
  countVMwareNotEffectiveHosts,
  getVMwareHostLoad,
  getVMwareNotEffectiveHostsTone,
} from "../Utils/VMwarePartFacts";
import { getVMwareNotEffectiveHostsText } from "../../../Components/VMware/Part/VMwareNotEffectiveHosts";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartRow from "../../../Components/ResourcePart/ResourcePartRow";
import VMwareHostsCard from "../../../Components/VMware/VMwareHostsCard";
import {
  VMwarePartRoutes,
  getVMwarePartRoutes,
} from "../../../Components/VMware/Part/VMwarePartRoutes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

type VCenterHealth = "Healthy" | "Degraded" | "Unhealthy";

interface GoldenStats {
  hostCpuPercent: number | null;
  hostMemoryPercent: number | null;
  hostMemoryUsedBytes: number | null;
  hostMemoryCapacityBytes: number | null;
  vmCpuReadyAvgPercent: number | null;
  vmCpuReadyMaxPercent: number | null;
  vmCpuReadyVmCount: number;
  datastoreWorstPercent: number | null;
}

interface TopRow {
  externalId: string;
  name: string;
  /* Secondary line under the name — parent host / datacenter. */
  context: string;
  value: number;
  /* 0..100 for the bar. */
  percent: number;
}

/*
 * What the Overview knows about the vCenter's parts. It reads every part
 * but the VMs whole - the datacenters, clusters, hosts, datastores and pools
 * a vCenter has a few hundred of - and of the VMs, which can be tens of
 * thousands, only the ones that may need attention and the five that wait
 * longest for a CPU; the counts come from Postgres in one read.
 */
interface InventorySummary {
  // Every part but the VMs, and the VMs that may need attention.
  rows: Array<VMwareResourceModel>;
  datacenters: Array<VMwareResourceModel>;
  hosts: Array<VMwareResourceModel>;
  // What needs attention, most urgent first (VMwareHealth).
  attentionItems: Array<ResourceAttentionItem>;
  datacenterCount: number;
  clusterCount: number;
  hostCount: number;
  // Hosts vCenter reports usage for: up and connected.
  connectedHostCount: number;
  /* Non-template VMs. */
  vmTotal: number;
  vmPoweredOn: number;
  templateCount: number;
  datastoreCount: number;
  worstDatastorePercent: number | null;
  worstDatastoreName: string;
  /* Σ across Cluster rows (hosts DRS/HA can schedule vs. all). */
  clusterHostsTotal: number;
  clusterHostsEffective: number;
  // Why clustered hosts are not effective, as the rules read each.
  clusterHostsNotEffective: VMwareNotEffectiveHosts;
  topHostsByCpu: Array<TopRow>;
  topHostsByMemory: Array<TopRow>;
  topDatastoresByUtilization: Array<TopRow>;
  topVmsByCpuReady: Array<TopRow>;
  health: VCenterHealth;
}

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const TILE_WINDOW_MINUTES: number = 5;

/* Aligned with the vmware-datastore-capacity-{warning,critical} templates. */
const DATASTORE_WARN_PERCENT: number = VMWARE_DATASTORE_WARNING_PERCENT;
const DATASTORE_CRITICAL_PERCENT: number = VMWARE_DATASTORE_CRITICAL_PERCENT;

/* Aligned with the vmware-vm-cpu-ready-contention template (avg > 10 %). */
const VM_CPU_READY_WARN_PERCENT: number = VMWARE_CPU_READY_WARNING_PERCENT;

// How many rows each Top Resource Consumers section ranks.
const TOP_ROWS: number = 5;

const MIB: number = 1024 * 1024;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "vmware-overview-auto-refresh-interval";

const VMwareVCenterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  /*
   * Per-section loaders so the page paints as soon as vCenter metadata
   * arrives, then each section swaps its spinner for real data as its
   * request resolves. `isLoading` only gates the page shell; the
   * section loaders gate their respective independent fetches (no
   * Promise.all — the slowest request must not hold back the others).
   */
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);
  const [inventoryError, setInventoryError] = useState<string>("");
  const [inventory, setInventory] = useState<InventorySummary | null>(null);

  // Golden metrics state — independent of the inventory summary.
  const [goldenStats, setGoldenStats] = useState<GoldenStats | null>(null);
  const [isGoldenLoading, setIsGoldenLoading] = useState<boolean>(true);
  const [goldenError, setGoldenError] = useState<string>("");
  const [cpuSeries, setCpuSeries] = useState<Array<SeriesPoint>>([]);
  const [memorySeries, setMemorySeries] = useState<Array<SeriesPoint>>([]);
  const [datastoreSeries, setDatastoreSeries] = useState<Array<SeriesPoint>>(
    [],
  );
  const [cpuReadySeries, setCpuReadySeries] = useState<Array<SeriesPoint>>([]);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_TIME_RANGE);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  /*
   * Toggled on every auto and manual refresh, so the details card re-reads
   * Last Seen and Agent Version along with the rest of the page.
   */
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);
  const [autoRefreshInterval, setAutoRefreshInterval] =
    useState<AutoRefreshInterval>(() => {
      if (typeof window === "undefined") {
        return AutoRefreshInterval.THIRTY_SECONDS;
      }
      const stored: string | null =
        window.localStorage?.getItem(REFRESH_STORAGE_KEY) ?? null;
      if (
        stored &&
        (Object.values(AutoRefreshInterval) as Array<string>).includes(stored)
      ) {
        return stored as AutoRefreshInterval;
      }
      return AutoRefreshInterval.THIRTY_SECONDS;
    });

  const toNumber: (value: number | null | undefined) => number | null = (
    value: number | null | undefined,
  ): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const n: number = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  /*
   * The inventory: what needs attention (VMwareHealth), the counts, the
   * hosts at a glance and the top consumers, from the VMwareResource
   * Postgres table (instant; no ClickHouse) - read by kind, never every
   * VM at once (see InventorySummary).
   */
  const loadInventory: PromiseVoidFunction = async (): Promise<void> => {
    setInventoryError("");
    try {
      const now: Date = OneUptimeDate.getCurrentDate();
      const routes: VMwarePartRoutes = getVMwarePartRoutes(modelId);

      const [partRows, attentionVms, cpuReadyVms, counts]: [
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
        Array<VMwareResourceModel>,
        VMwareInventoryCounts | null,
      ] = await Promise.all([
        fetchVMwareInventoryRows({
          vmwareVCenterId: modelId,
          kinds: [
            VMwareResourceKind.Datacenter,
            VMwareResourceKind.Cluster,
            VMwareResourceKind.Host,
            VMwareResourceKind.Datastore,
            VMwareResourceKind.ResourcePool,
          ],
        }),
        fetchVMwareVirtualMachinesThatMayNeedAttention({
          vmwareVCenterId: modelId,
          now: now,
          cpuReadyWarningPercent: VM_CPU_READY_WARN_PERCENT,
        }),
        fetchVMwareVirtualMachinesByCpuReady({
          vmwareVCenterId: modelId,
          now: now,
          limit: TOP_ROWS,
        }),
        fetchVMwareInventorySummary(modelId).catch(() => {
          // The counts fall back to the vCenter's own columns.
          return null;
        }),
      ]);

      const ofKind: (kind: VMwareResourceKind) => Array<VMwareResourceModel> =
        (kind: VMwareResourceKind): Array<VMwareResourceModel> => {
          return partRows.filter((row: VMwareResourceModel): boolean => {
            return row.kind === kind;
          });
        };

      const datacenters: Array<VMwareResourceModel> = ofKind(
        VMwareResourceKind.Datacenter,
      );
      const clusters: Array<VMwareResourceModel> = ofKind(
        VMwareResourceKind.Cluster,
      );
      const hosts: Array<VMwareResourceModel> = ofKind(VMwareResourceKind.Host);
      const datastores: Array<VMwareResourceModel> = ofKind(
        VMwareResourceKind.Datastore,
      );

      let worstDatastorePercent: number | null = null;
      let worstDatastoreName: string = "";
      let clusterHostsTotal: number = 0;
      let clusterHostsEffective: number = 0;
      let connectedHostCount: number = 0;
      const datastoreRows: Array<TopRow> = [];

      for (const cluster of clusters) {
        /*
         * vcenter.cluster.host.count{effective=false}: a host in maintenance
         * mode or disconnected/unresponsive is counted but not effective -
         * DRS/HA cannot place VMs on it.
         */
        const total: number | null = toNumber(cluster.hostCount);
        const effective: number | null = toNumber(cluster.effectiveHostCount);
        if (total !== null) {
          clusterHostsTotal += total;
          if (effective !== null) {
            clusterHostsEffective += effective;
          }
        }
      }

      const hostRows: Array<{
        externalId: string;
        name: string;
        context: string;
        cpuPercent: number | null;
        memoryBytes: number | null;
        memoryPercent: number | null;
      }> = [];
      for (const host of hosts) {
        const datacenter: VMwareResourceModel | null = findVMwareDatacenter(
          datacenters,
          host.datacenterName,
        );
        if (
          isVMwareHostRunning(
            getVMwareHostState({ host: host, datacenter: datacenter, now: now }),
          )
        ) {
          connectedHostCount++;
        }
        /*
         * Top-N source: a stale reading, or one of a host that is not
         * running, renders as no data rather than an idle 0%.
         */
        const load: { cpuPercent: number | null; memoryPercent: number | null } =
          getVMwareHostLoad({ host: host, datacenter: datacenter, now: now });
        hostRows.push({
          externalId: host.externalId || "",
          name: displayNameForResource(host),
          context: host.clusterName || host.datacenterName || "",
          cpuPercent: load.cpuPercent,
          memoryBytes:
            load.memoryPercent !== null
              ? toNumber(host.latestMemoryBytes)
              : null,
          memoryPercent: load.memoryPercent,
        });
      }

      for (const datastore of datastores) {
        const pct: number | null = getVMwareDatastorePercent(datastore);
        if (pct !== null) {
          const name: string = displayNameForResource(datastore);
          if (worstDatastorePercent === null || pct > worstDatastorePercent) {
            worstDatastorePercent = pct;
            worstDatastoreName = name;
          }
          datastoreRows.push({
            externalId: datastore.externalId || "",
            name: name,
            context: datastore.datacenterName || "",
            value: pct,
            percent: pct,
          });
        }
      }

      const topHostsByCpu: Array<TopRow> = hostRows
        .filter((h: (typeof hostRows)[number]) => {
          return h.cpuPercent !== null;
        })
        .sort((a: (typeof hostRows)[number], b: (typeof hostRows)[number]) => {
          return (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
        })
        .slice(0, TOP_ROWS)
        .map((h: (typeof hostRows)[number]): TopRow => {
          return {
            externalId: h.externalId,
            name: h.name,
            context: h.context,
            value: h.cpuPercent ?? 0,
            percent: h.cpuPercent ?? 0,
          };
        });

      const maxMemory: number = hostRows.reduce(
        (max: number, h: (typeof hostRows)[number]) => {
          return Math.max(max, h.memoryBytes ?? 0);
        },
        0,
      );
      const topHostsByMemory: Array<TopRow> = hostRows
        .filter((h: (typeof hostRows)[number]) => {
          return h.memoryBytes !== null;
        })
        .sort((a: (typeof hostRows)[number], b: (typeof hostRows)[number]) => {
          return (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0);
        })
        .slice(0, TOP_ROWS)
        .map((h: (typeof hostRows)[number]): TopRow => {
          return {
            externalId: h.externalId,
            name: h.name,
            context: h.context,
            value: h.memoryBytes ?? 0,
            percent:
              h.memoryPercent !== null
                ? h.memoryPercent
                : maxMemory > 0
                  ? ((h.memoryBytes ?? 0) / maxMemory) * 100
                  : 0,
          };
        });

      const topDatastoresByUtilization: Array<TopRow> = datastoreRows
        .sort((a: TopRow, b: TopRow) => {
          return b.value - a.value;
        })
        .slice(0, TOP_ROWS);

      const topVmsByCpuReady: Array<TopRow> = cpuReadyVms
        .filter((vm: VMwareResourceModel): boolean => {
          return (
            vm.isTemplate !== true &&
            vm.isPoweredOn === true &&
            hasFreshMetrics(vm, now) &&
            toNumber(vm.cpuReadinessPercent) !== null
          );
        })
        .slice(0, TOP_ROWS)
        .map((vm: VMwareResourceModel): TopRow => {
          const ready: number = toNumber(vm.cpuReadinessPercent) ?? 0;
          return {
            externalId: vm.externalId || "",
            name: displayNameForResource(vm),
            context: vm.hostName || "",
            value: ready,
            percent: ready,
          };
        });

      const rows: Array<VMwareResourceModel> = [...partRows, ...attentionVms];
      const attentionItems: Array<ResourceAttentionItem> =
        getVMwareAttentionItems({
          rows: rows,
          now: now,
          routeFor: routes.getPartRoute,
          listRouteFor: routes.getListRoute,
        });

      setInventory({
        rows: rows,
        datacenters: datacenters,
        hosts: hosts,
        attentionItems: attentionItems,
        datacenterCount: counts?.datacenterCount ?? datacenters.length,
        clusterCount: counts?.clusterCount ?? clusters.length,
        hostCount: counts?.hostCount ?? hosts.length,
        connectedHostCount: connectedHostCount,
        vmTotal: counts?.virtualMachineCount ?? 0,
        vmPoweredOn: counts?.poweredOnVirtualMachineCount ?? 0,
        templateCount: counts?.virtualMachineTemplateCount ?? 0,
        datastoreCount: counts?.datastoreCount ?? datastores.length,
        worstDatastorePercent,
        worstDatastoreName,
        clusterHostsTotal,
        clusterHostsEffective,
        clusterHostsNotEffective: countVMwareNotEffectiveHosts({
          clusters: clusters,
          hosts: hosts,
          datacenters: datacenters,
          now: now,
        }),
        topHostsByCpu,
        topHostsByMemory,
        topDatastoresByUtilization,
        topVmsByCpuReady,
        health: getVMwareHealth(attentionItems),
      });
    } catch (err) {
      /*
       * Surface the failure instead of silently rendering zero counts,
       * which is indistinguishable from a genuinely empty vCenter.
       */
      setInventoryError(API.getFriendlyMessage(err));
    } finally {
      setIsInventoryLoading(false);
    }
  };

  /*
   * Golden vCenter metrics — aggregated across host / datastore / VM
   * series for the selected time range. vcenter.host.cpu.utilization is
   * already a percentage, so vCenter-wide CPU% is capacity-weighted:
   * Σ(utilization × vcenter.host.cpu.capacity) ÷ Σ capacity over host
   * series (a 64-core host at 50% must outweigh a 4-core host at 100%).
   * Memory is Σ vcenter.host.memory.usage ÷ Σ vcenter.host.memory.capacity
   * (both MiB) over host series, falling back to a plain mean of
   * vcenter.host.memory.utilization when the capacity series is absent
   * (it is off by default upstream; the shipped agent config enables it).
   * Datastore chart sums vcenter.datastore.disk.usage{disk_state=used}.
   * VM CPU ready is the mean (and max) of vcenter.vm.cpu.readiness over
   * powered-on VMs. Every series is a gauge — no counter-rate math. Host
   * / datastore / VM identity rides the `resource.vcenter.*` attributes
   * the vcenter receiver stamps on each resource.
   *
   * A chart zoom, its reset, the picker and Refresh can each start a load
   * while another is in flight; only the most recently started one may
   * commit, or a slow response for the window the reader just left would
   * repaint the charts and tiles with it.
   */
  const goldenLoadSeqRef: React.MutableRefObject<number> = useRef<number>(0);
  /*
   * Set while the newest golden load is still running. The auto-refresh
   * timer skips the golden load then (the inventory and details still
   * refresh) instead of superseding it with one for the same window: were
   * every load to outlast the interval, none would ever land, and the tiles
   * and charts would sit on skeletons with Refresh spinning.
   */
  const goldenLoadInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const loadGoldenMetrics: (vcenterName: string) => Promise<void> = async (
    vcenterName: string,
  ): Promise<void> => {
    const seq: number = ++goldenLoadSeqRef.current;
    const isStale: () => boolean = (): boolean => {
      return seq !== goldenLoadSeqRef.current;
    };

    goldenLoadInFlightRef.current = true;
    setIsRefreshing(true);
    setGoldenError("");
    try {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const startDate: Date = dateRange.startValue;
      const endDate: Date = dateRange.endValue;
      const tileWindowStart: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -TILE_WINDOW_MINUTES,
      );
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      const baseAttributes: Record<string, string> = {
        "resource.vmware.vcenter.name": vcenterName,
      };

      const buildAggregateBy: (
        metricName: string,
        aggType: AggregationType,
        extraAttributes?: Record<string, string>,
      ) => AggregateBy<Metric> = (
        metricName: string,
        aggType: AggregationType,
        extraAttributes?: Record<string, string>,
      ): AggregateBy<Metric> => {
        return {
          query: {
            projectId: projectId,
            time: new InBetween<Date>(startDate, endDate),
            name: metricName,
            attributes: { ...baseAttributes, ...(extraAttributes || {}) },
          } as AggregateBy<Metric>["query"],
          aggregationType: aggType,
          aggregateColumnName: "value",
          aggregationTimestampColumnName: "time",
          startTimestamp: startDate,
          endTimestamp: endDate,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            time: SortOrder.Descending,
          },
          /*
           * Grouping by attributes preserves the per-object resource
           * identity so we can join utilization with capacity per host
           * and sum per datastore client-side.
           */
          groupBy: { attributes: true },
        };
      };

      const [
        hostCpuResult,
        hostCpuCapacityResult,
        hostMemUsageResult,
        hostMemCapacityResult,
        hostMemUtilizationResult,
        datastoreUsedResult,
        datastoreUtilizationResult,
        vmCpuReadyResult,
      ]: [
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
      ] = await Promise.all([
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.host.cpu.utilization",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.host.cpu.capacity",
            AggregationType.Max,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.host.memory.usage",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.host.memory.capacity",
            AggregationType.Max,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.host.memory.utilization",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.datastore.disk.usage",
            AggregationType.Avg,
            { disk_state: "used" },
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.datastore.disk.utilization",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "vcenter.vm.cpu.readiness",
            AggregationType.Avg,
          ),
        }),
      ]);

      if (isStale()) {
        return;
      }

      const getBucketTimestamp: (p: AggregatedModel) => number = (
        p: AggregatedModel,
      ): number => {
        const raw: unknown =
          p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
        if (raw instanceof Date) {
          return raw.getTime();
        }
        if (typeof raw === "string" || typeof raw === "number") {
          return new Date(raw).getTime();
        }
        return NaN;
      };

      /*
       * Per-object identity key from the resource attributes. Hosts are
       * keyed by datacenter + host name, datastores by datacenter +
       * datastore name, VMs by instance UUID — the same identity the
       * inventory rows use.
       */
      const getObjectKey: (p: AggregatedModel) => string = (
        p: AggregatedModel,
      ): string => {
        const attrs: Record<string, unknown> =
          (p["attributes"] as Record<string, unknown>) || {};
        const dc: string =
          (attrs["resource.vcenter.datacenter.name"] as string) || "";
        const host: string =
          (attrs["resource.vcenter.host.name"] as string) || "";
        const datastore: string =
          (attrs["resource.vcenter.datastore.name"] as string) || "";
        const vmId: string = (attrs["resource.vcenter.vm.id"] as string) || "";
        const vmName: string =
          (attrs["resource.vcenter.vm.name"] as string) || "";
        if (vmId || vmName) {
          return `vm/${vmId || `${dc}/${host}/${vmName}`}`;
        }
        if (datastore) {
          return `datastore/${dc}/${datastore}`;
        }
        if (host) {
          return `host/${dc}/${host}`;
        }
        return "";
      };

      type TimeValuePoint = { x: Date; y: number };

      /* Collect (bucket, object) → value for one metric. */
      const collectByBucketAndObject: (
        result: AggregatedResult,
      ) => Map<number, Map<string, number>> = (
        result: AggregatedResult,
      ): Map<number, Map<string, number>> => {
        const out: Map<number, Map<string, number>> = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const key: string = getObjectKey(p);
          if (!key) {
            continue;
          }
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          let perObject: Map<string, number> | undefined = out.get(t);
          if (!perObject) {
            perObject = new Map();
            out.set(t, perObject);
          }
          perObject.set(key, v);
        }
        return out;
      };

      const toSortedPoints: (
        perBucket: Map<number, number>,
      ) => Array<TimeValuePoint> = (
        perBucket: Map<number, number>,
      ): Array<TimeValuePoint> => {
        return Array.from(perBucket.entries())
          .map(([t, y]: [number, number]): TimeValuePoint => {
            return { x: new Date(t), y: y };
          })
          .sort((a: TimeValuePoint, b: TimeValuePoint): number => {
            return a.x.getTime() - b.x.getTime();
          });
      };

      const meanInRecentWindow: (
        series: Array<TimeValuePoint>,
      ) => number | null = (series: Array<TimeValuePoint>): number | null => {
        if (series.length === 0) {
          return null;
        }
        const tileWindowStartMs: number = tileWindowStart.getTime();
        let sum: number = 0;
        let count: number = 0;
        for (const p of series) {
          if (p.x.getTime() < tileWindowStartMs) {
            continue;
          }
          sum += p.y;
          count++;
        }
        if (count === 0) {
          for (const p of series) {
            sum += p.y;
            count++;
          }
        }
        return count > 0 ? sum / count : null;
      };

      /*
       * vCenter CPU% per bucket — capacity-weighted across host series.
       * Falls back to a plain mean of the utilizations when no
       * vcenter.host.cpu.capacity series exists in the window.
       */
      const cpuByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(hostCpuResult);
      const cpuCapacityByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(hostCpuCapacityResult);

      const cpuPerBucket: Map<number, number> = new Map();
      for (const [t, utilizations] of cpuByBucket.entries()) {
        const capacities: Map<string, number> | undefined =
          cpuCapacityByBucket.get(t);
        let weightedSum: number = 0;
        let weightTotal: number = 0;
        let plainSum: number = 0;
        let plainCount: number = 0;
        for (const [key, utilization] of utilizations.entries()) {
          plainSum += utilization;
          plainCount++;
          const capacity: number | undefined = capacities?.get(key);
          if (capacity !== undefined && capacity > 0) {
            weightedSum += utilization * capacity;
            weightTotal += capacity;
          }
        }
        if (weightTotal > 0) {
          cpuPerBucket.set(t, weightedSum / weightTotal);
        } else if (plainCount > 0) {
          cpuPerBucket.set(t, plainSum / plainCount);
        }
      }
      const cpuPoints: Array<TimeValuePoint> = toSortedPoints(cpuPerBucket);

      // Memory: Σ usage and Σ capacity (MiB) per bucket across host series.
      const memUsageByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(hostMemUsageResult);
      const memCapacityByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(hostMemCapacityResult);
      const memUtilizationByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(hostMemUtilizationResult);

      const memPercentPerBucket: Map<number, number> = new Map();
      let latestMemUsed: number | null = null;
      let latestMemCapacity: number | null = null;
      let latestMemTs: number = 0;
      for (const [t, usages] of memUsageByBucket.entries()) {
        let usedSum: number = 0;
        for (const v of usages.values()) {
          usedSum += v;
        }
        const capacities: Map<string, number> | undefined =
          memCapacityByBucket.get(t);
        if (capacities && capacities.size > 0) {
          let capacitySum: number = 0;
          for (const v of capacities.values()) {
            capacitySum += v;
          }
          if (capacitySum > 0) {
            memPercentPerBucket.set(t, (usedSum / capacitySum) * 100);
            if (t > latestMemTs) {
              latestMemTs = t;
              latestMemUsed = usedSum * MIB;
              latestMemCapacity = capacitySum * MIB;
            }
          }
        }
      }
      if (memPercentPerBucket.size === 0) {
        // No capacity series — plain mean of the receiver's own utilization.
        for (const [t, utilizations] of memUtilizationByBucket.entries()) {
          let sum: number = 0;
          let count: number = 0;
          for (const v of utilizations.values()) {
            sum += v;
            count++;
          }
          if (count > 0) {
            memPercentPerBucket.set(t, sum / count);
          }
        }
      }
      const memoryPercentPoints: Array<TimeValuePoint> =
        toSortedPoints(memPercentPerBucket);

      // Datastores: Σ used bytes per bucket across datastore series.
      const datastoreUsedByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(datastoreUsedResult);
      const datastorePerBucket: Map<number, number> = new Map();
      for (const [t, usages] of datastoreUsedByBucket.entries()) {
        let sum: number = 0;
        for (const v of usages.values()) {
          sum += v;
        }
        datastorePerBucket.set(t, sum);
      }
      const datastorePoints: Array<TimeValuePoint> =
        toSortedPoints(datastorePerBucket);

      // Worst datastore utilization per bucket (for the tile fallback).
      const datastoreUtilizationByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(datastoreUtilizationResult);
      const datastoreWorstPerBucket: Map<number, number> = new Map();
      for (const [t, utilizations] of datastoreUtilizationByBucket.entries()) {
        let worst: number | null = null;
        for (const v of utilizations.values()) {
          if (worst === null || v > worst) {
            worst = v;
          }
        }
        if (worst !== null) {
          datastoreWorstPerBucket.set(t, worst);
        }
      }
      const datastoreWorstPoints: Array<TimeValuePoint> = toSortedPoints(
        datastoreWorstPerBucket,
      );

      // VM CPU ready: mean and max per bucket across powered-on VM series.
      const cpuReadyByBucket: Map<
        number,
        Map<string, number>
      > = collectByBucketAndObject(vmCpuReadyResult);
      const cpuReadyAvgPerBucket: Map<number, number> = new Map();
      const cpuReadyMaxPerBucket: Map<number, number> = new Map();
      const cpuReadyVmKeys: Set<string> = new Set();
      for (const [t, readiness] of cpuReadyByBucket.entries()) {
        let sum: number = 0;
        let count: number = 0;
        let max: number = 0;
        for (const [key, v] of readiness.entries()) {
          cpuReadyVmKeys.add(key);
          sum += v;
          count++;
          max = Math.max(max, v);
        }
        if (count > 0) {
          cpuReadyAvgPerBucket.set(t, sum / count);
          cpuReadyMaxPerBucket.set(t, max);
        }
      }
      const cpuReadyAvgPoints: Array<TimeValuePoint> =
        toSortedPoints(cpuReadyAvgPerBucket);
      const cpuReadyMaxPoints: Array<TimeValuePoint> =
        toSortedPoints(cpuReadyMaxPerBucket);

      setCpuSeries(
        cpuPoints.length > 0
          ? [{ seriesName: "Host CPU %", data: cpuPoints }]
          : [],
      );
      setMemorySeries(
        memoryPercentPoints.length > 0
          ? [{ seriesName: "Host Memory %", data: memoryPercentPoints }]
          : [],
      );
      setDatastoreSeries(
        datastorePoints.length > 0
          ? [{ seriesName: "Datastore Used", data: datastorePoints }]
          : [],
      );
      setCpuReadySeries(
        [
          cpuReadyAvgPoints.length > 0
            ? { seriesName: "Avg", data: cpuReadyAvgPoints }
            : null,
          cpuReadyMaxPoints.length > 0
            ? { seriesName: "Max", data: cpuReadyMaxPoints }
            : null,
        ].filter((s: SeriesPoint | null): s is SeriesPoint => {
          return s !== null;
        }),
      );

      setGoldenStats({
        hostCpuPercent: meanInRecentWindow(cpuPoints),
        hostMemoryPercent: meanInRecentWindow(memoryPercentPoints),
        hostMemoryUsedBytes: latestMemUsed,
        hostMemoryCapacityBytes: latestMemCapacity,
        vmCpuReadyAvgPercent: meanInRecentWindow(cpuReadyAvgPoints),
        vmCpuReadyMaxPercent: meanInRecentWindow(cpuReadyMaxPoints),
        vmCpuReadyVmCount: cpuReadyVmKeys.size,
        datastoreWorstPercent: meanInRecentWindow(datastoreWorstPoints),
      });

      setChartWindow({ start: startDate, end: endDate });
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      if (!isStale()) {
        setGoldenError(API.getFriendlyMessage(err));
      }
    } finally {
      /*
       * A superseded load leaves the spinner, and the timer, to the load
       * that replaced it.
       */
      if (!isStale()) {
        setIsRefreshing(false);
        setIsGoldenLoading(false);
        goldenLoadInFlightRef.current = false;
      }
    }
  };

  /*
   * Ref pattern so the refresh interval picks up the latest closure
   * (timeRange / vCenter name) without tearing the timer down on every
   * render.
   */
  const loadGoldenMetricsRef: React.MutableRefObject<
    (vcenterName: string) => Promise<void>
  > = useRef<(vcenterName: string) => Promise<void>>(loadGoldenMetrics);
  loadGoldenMetricsRef.current = loadGoldenMetrics;

  const fetchVCenter: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: VMwareVCenter | null = await ModelAPI.getItem({
        modelType: VMwareVCenter,
        id: modelId,
        select: {
          name: true,
          description: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentVersion: true,
          collectionMethod: true,
          datacenterCount: true,
          clusterCount: true,
          hostCount: true,
          vmCount: true,
          poweredOnVmCount: true,
          datastoreCount: true,
          resourcePoolCount: true,
          datastoreCapacityBytes: true,
          datastoreUsedBytes: true,
        },
      });
      setVCenter(item);
      setIsLoading(false);

      if (item?.name) {
        // Fire section fetches independently — no Promise.all.
        void loadInventory();
        void loadGoldenMetricsRef.current(item.name);
      } else {
        setIsInventoryLoading(false);
        setIsGoldenLoading(false);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
      setIsInventoryLoading(false);
      setIsGoldenLoading(false);
    }
  };

  useEffect(() => {
    fetchVCenter().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  /*
   * Re-fetch golden metrics whenever the user picks a different time
   * range. vCenter metadata and inventory stay cached.
   */
  useEffect(() => {
    if (vcenter?.name) {
      void loadGoldenMetricsRef.current(vcenter.name);
    }
  }, [timeRange]);

  useEffect(() => {
    const ms: number | null = getAutoRefreshIntervalInMs(autoRefreshInterval);
    if (ms === null) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      if (vcenter?.name) {
        // Let a golden load that is still running land.
        if (!goldenLoadInFlightRef.current) {
          void loadGoldenMetricsRef.current(vcenter.name);
        }
        void loadInventory();
        setDetailsRefresher((prev: boolean) => {
          return !prev;
        });
      }
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshInterval, vcenter?.name]);

  const onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void = (
    interval: AutoRefreshInterval,
  ): void => {
    setAutoRefreshInterval(interval);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(REFRESH_STORAGE_KEY, interval);
    }
  };

  const onManualRefresh: () => void = (): void => {
    if (vcenter?.name) {
      void loadGoldenMetricsRef.current(vcenter.name);
      void loadInventory();
      setDetailsRefresher((prev: boolean) => {
        return !prev;
      });
    }
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!vcenter) {
    return <ErrorMessage message="vCenter not found." />;
  }

  /*
   * Inventory first, vCenter snapshot columns (written by the same
   * ingest scan) as the fallback while the inventory is in flight.
   */
  const datacenterCount: number =
    inventory?.datacenterCount || vcenter.datacenterCount || 0;
  const clusterCount: number =
    inventory?.clusterCount || vcenter.clusterCount || 0;
  const hostCount: number = inventory?.hostCount || vcenter.hostCount || 0;
  const vmTotal: number = inventory?.vmTotal || vcenter.vmCount || 0;
  const vmPoweredOn: number = inventory
    ? inventory.vmPoweredOn
    : vcenter.poweredOnVmCount || 0;
  /*
   * The ingest writes the vCenter's powered-on count once a collection
   * carried VMs: before that, power state is not known yet.
   */
  const vmPowerStateKnown: boolean =
    vcenter.poweredOnVmCount !== null &&
    vcenter.poweredOnVmCount !== undefined;
  const datastoreCount: number =
    inventory?.datastoreCount || vcenter.datastoreCount || 0;

  const clusterHostsTotal: number = inventory?.clusterHostsTotal || 0;
  const clusterHostsEffective: number = inventory?.clusterHostsEffective || 0;
  const hostEffectivenessPct: number | null =
    clusterHostsTotal > 0
      ? (clusterHostsEffective / clusterHostsTotal) * 100
      : null;

  /*
   * Why clustered hosts are not effective, the most urgent first, and the
   * bar's colour as the rules read it (VMwareNotEffectiveHosts).
   */
  const effectiveHostsReasons: Array<string> = inventory
    ? getVMwareNotEffectiveHostsText(
        inventory.clusterHostsNotEffective,
        translator,
      )
    : [];
  const effectiveHostsTone: GoldenMetricTileTone = inventory
    ? getVMwareNotEffectiveHostsTone(inventory.clusterHostsNotEffective)
    : "positive";

  const vcenterHealth: VCenterHealth = inventory?.health || "Healthy";
  const attentionItems: Array<ResourceAttentionItem> =
    inventory?.attentionItems || [];

  /*
   * When the collector is disconnected the inventory snapshot is stale, so
   * the derived health is no longer trustworthy: the hero says Health
   * Unknown and Needs attention is left out, as on every resource product.
   */
  const isVCenterConnected: boolean = ["connected", "active"].includes(
    ((vcenter?.otelCollectorStatus as string) || "").toLowerCase(),
  );

  const partRoutes: VMwarePartRoutes = getVMwarePartRoutes(modelId);

  const hostsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_HOSTS] as Route,
    { modelId: modelId },
  );
  const virtualMachinesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES] as Route,
    { modelId: modelId },
  );
  const datastoresRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_DATASTORES] as Route,
    { modelId: modelId },
  );
  const clustersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_CLUSTERS] as Route,
    { modelId: modelId },
  );

  const renderRefreshControl: () => ReactElement = (): ReactElement => {
    return (
      <AutoRefreshControl
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
        onManualRefresh={onManualRefresh}
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
    );
  };

  const renderHero: () => ReactElement = (): ReactElement => {
    const status: string = (vcenter.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = vcenter.lastSeenAt;
    /*
     * One whole sentence either way: an English "never" in a translated
     * "Last seen {{time}}" would read in two languages at once.
     */
    const lastSeenText: string = lastSeenAt
      ? translator.translateTemplate("Last seen {{time}}", {
          time: OneUptimeDate.fromNow(lastSeenAt),
        })
      : translator.translateText("Never seen") || "Never seen";

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    const displayName: string =
      (vcenter.name as string | undefined) || "Untitled vCenter";

    const connectionBadgeClass: string = isConnected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
    const connectionDotClass: string = isConnected
      ? "bg-emerald-500"
      : "bg-amber-500";
    const connectionLabel: string = getResourceConnectionLabel({
      translator: translator,
      isConnected: isConnected,
      status: status,
    });

    /*
     * Health is derived from the last inventory snapshot, which goes stale
     * once the collector disconnects. Reporting "Healthy" next to a
     * "Disconnected" badge is contradictory and misleading, so while the
     * vCenter is not connected the pill says "Health Unknown" (neutral grey),
     * as a Ceph cluster's and a storage array's do, rather than the
     * last-known live status.
     */
    const healthLabel: string = getResourceHealthLabel({
      translator: translator,
      health: vcenterHealth,
      isConnected: isConnected,
    });
    const healthBadgeClass: string = !isConnected
      ? "bg-gray-50 text-gray-600 ring-gray-200"
      : vcenterHealth === "Healthy"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : vcenterHealth === "Degraded"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-red-50 text-red-700 ring-red-200";
    const healthDotClass: string = !isConnected
      ? "bg-gray-400"
      : vcenterHealth === "Healthy"
        ? "bg-emerald-500"
        : vcenterHealth === "Degraded"
          ? "bg-amber-500"
          : "bg-red-500";

    /*
     * The count chips open their list: the Overview's one step to the
     * hosts, the VMs, the datastores and the clusters (the side menu has
     * the rest).
     */
    const specChips: Array<{
      icon: IconProp;
      label: string;
      route?: Route | undefined;
      testId?: string | undefined;
    }> = [];
    if (datacenterCount > 0) {
      specChips.push({
        icon: IconProp.Folder,
        testId: "vmware-hero-datacenters",
        label: translator.translatePlural(
          { one: "{{count}} datacenter", other: "{{count}} datacenters" },
          datacenterCount,
        ),
      });
    }
    if (clusterCount > 0) {
      specChips.push({
        icon: IconProp.SquareStack,
        route: clustersRoute,
        testId: "vmware-hero-clusters",
        label: translator.translatePlural(
          { one: "{{count}} cluster", other: "{{count}} clusters" },
          clusterCount,
        ),
      });
    }
    if (hostCount > 0) {
      specChips.push({
        icon: IconProp.ServerStack,
        route: hostsRoute,
        testId: "vmware-hero-hosts",
        /*
         * How many vCenter can reach, while the inventory says so and
         * the vCenter reports: the first number a vSphere admin looks for.
         */
        label:
          inventory && isVCenterConnected
            ? translator.translatePlural(
                {
                  one: "{{connected}}/{{count}} ESXi host connected",
                  other: "{{connected}}/{{count}} ESXi hosts connected",
                },
                hostCount,
                // In the reader's digits, as the count beside it is.
                {
                  connected: translator.formatNumber(
                    inventory.connectedHostCount,
                  ),
                },
              )
            : translator.translatePlural(
                { one: "{{count}} ESXi host", other: "{{count}} ESXi hosts" },
                hostCount,
              ),
      });
    }
    if (vmTotal > 0) {
      specChips.push({
        icon: IconProp.Cube,
        route: virtualMachinesRoute,
        testId: "vmware-hero-vms",
        label: vmPowerStateKnown
          ? translator.translatePlural(
              {
                one: "{{poweredOn}}/{{count}} VM powered on",
                other: "{{poweredOn}}/{{count}} VMs powered on",
              },
              vmTotal,
              { poweredOn: translator.formatNumber(vmPoweredOn) },
            )
          : translator.translatePlural(
              { one: "{{count}} VM", other: "{{count}} VMs" },
              vmTotal,
            ),
      });
    }
    if (inventory && inventory.templateCount > 0) {
      specChips.push({
        icon: IconProp.DocumentDuplicate,
        route: virtualMachinesRoute,
        testId: "vmware-hero-templates",
        label: translator.translatePlural(
          { one: "{{count}} template", other: "{{count}} templates" },
          inventory.templateCount,
        ),
      });
    }
    if (datastoreCount > 0) {
      specChips.push({
        icon: IconProp.Database,
        route: datastoresRoute,
        testId: "vmware-hero-datastores",
        label: translator.translatePlural(
          { one: "{{count}} datastore", other: "{{count}} datastores" },
          datastoreCount,
        ),
      });
    }
    /*
     * Every chip here is a count. The agent version is metadata, drawn after
     * them by AgentVersion, so it never earns the row an (i).
     */
    const hasCountChips: boolean = specChips.length > 0;

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        {/*
         * `overflow-hidden` belongs on the gradient layer, not the
         * card itself — the time-range picker dropdown renders out
         * of the hero and would otherwise get clipped by the card's
         * rounded bounds.
         */}
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-sky-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div
              data-testid={RESOURCE_HERO_TOP_ROW_TEST_ID}
              className={RESOURCE_HERO_TOP_ROW_CLASS_NAME}
            >
              <div
                data-testid={RESOURCE_HERO_IDENTITY_TEST_ID}
                className={RESOURCE_HERO_IDENTITY_CLASS_NAME}
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-sky-200 shadow-sm">
                  <Icon
                    icon={IconProp.VMware}
                    className="h-6 w-6 text-sky-700"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {displayName}
                    </h1>
                    <span className="inline-flex items-center gap-1">
                      <span
                        data-testid="vmware-hero-connection"
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${connectionBadgeClass}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${connectionDotClass}`}
                        />
                        {connectionLabel}
                      </span>
                      <InfoTooltip
                        label="Data Status"
                        text={VMWARE_METRIC_DESCRIPTIONS.overviewAgentStatus}
                      />
                    </span>
                    {/*
                     * A vCenter that has reported nothing yet has no health
                     * to tell: "Healthy" there would be a guess.
                     */}
                    {!isInventoryLoading &&
                      !inventoryError &&
                      (inventory?.rows.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <span
                            data-testid="vmware-hero-health"
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthBadgeClass}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${healthDotClass}`}
                            />
                            {healthLabel}
                          </span>
                          <InfoTooltip
                            label="vCenter Health"
                            text={VMWARE_METRIC_DESCRIPTIONS.overviewVCenterHealth}
                          />
                        </span>
                      )}
                  </div>
                  <ResourceHeroDescription
                    text={vcenter.description as string | undefined}
                  />
                  <div className="mt-1 text-xs text-gray-400">
                    {lastSeenText}
                  </div>
                </div>
              </div>
              <div
                data-testid={RESOURCE_HERO_CONTROLS_TEST_ID}
                className={RESOURCE_HERO_CONTROLS_CLASS_NAME}
              >
                {renderRefreshControl()}
              </div>
            </div>

            {(specChips.length > 0 || Boolean(vcenter.agentVersion)) && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {specChips.map(
                  (
                    chip: {
                      icon: IconProp;
                      label: string;
                      route?: Route | undefined;
                      testId?: string | undefined;
                    },
                    idx: number,
                  ): ReactElement => {
                    const content: ReactElement = (
                      <>
                        <Icon
                          icon={chip.icon}
                          className="h-3 w-3 text-gray-500"
                        />
                        <span className="font-medium">{chip.label}</span>
                      </>
                    );
                    if (chip.route) {
                      return (
                        <Link
                          key={`spec-${idx}`}
                          to={chip.route}
                          dataTestId={chip.testId}
                          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          {content}
                        </Link>
                      );
                    }
                    return (
                      <span
                        key={`spec-${idx}`}
                        data-testid={chip.testId}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                      >
                        {content}
                      </span>
                    );
                  },
                )}
                <AgentVersion
                  kind={AgentKind.VMwareAgent}
                  version={vcenter.agentVersion}
                  variant="chip"
                />
                {/*
                 * One (i) for the count chips; a row holding only the
                 * agent version chip is metadata and gets none.
                 */}
                {hasCountChips && (
                  <InfoTooltip
                    label="vCenter inventory counts"
                    text={VMWARE_METRIC_DESCRIPTIONS.overviewInventoryCounts}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderGoldenMetrics: () => ReactElement = (): ReactElement => {
    if (isGoldenLoading && !goldenStats) {
      return (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_: unknown, idx: number) => {
            return (
              <div
                key={`golden-skeleton-${idx}`}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="h-3 w-16 rounded bg-gray-100 animate-pulse" />
                <div className="mt-3 h-8 w-24 rounded bg-gray-100 animate-pulse" />
                <div className="mt-2 h-3 w-20 rounded bg-gray-100 animate-pulse" />
                <div className="mt-3 h-1.5 w-full rounded bg-gray-100 animate-pulse" />
              </div>
            );
          })}
        </div>
      );
    }

    if (goldenError) {
      return (
        <div className="mb-6">
          <ErrorMessage message={goldenError} />
        </div>
      );
    }

    const s: GoldenStats | null = goldenStats;
    if (!s) {
      return <Fragment />;
    }

    /*
     * Datastore tile: the inventory's worst datastore (instant, names the
     * culprit) wins; the ClickHouse worst-per-bucket mean is the fallback
     * while the inventory is in flight.
     */
    const worstDatastorePercent: number | null =
      inventory?.worstDatastorePercent ?? s.datastoreWorstPercent;

    /*
     * Five tiles: how many hosts can run VMs, how busy they are, the fullest
     * datastore and how long VMs wait for a CPU. How many VMs run is the
     * hero's count chip, one step from the list.
     */
    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <GoldenMetricTile
          title="Effective hosts"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={
            hostEffectivenessPct === null
              ? "—"
              : `${clusterHostsEffective}/${clusterHostsTotal}`
          }
          sublabel={
            clusterHostsEffective < clusterHostsTotal &&
            effectiveHostsReasons.length > 0
              ? effectiveHostsReasons.join(" · ")
              : "clustered hosts DRS/HA can schedule"
          }
          percent={hostEffectivenessPct}
          tone={effectiveHostsTone}
          description={VMWARE_METRIC_DESCRIPTIONS.overviewHostEffectiveness}
        />
        <GoldenMetricTile
          title="Host CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.hostCpuPercent)}
          sublabel="capacity-weighted across ESXi hosts"
          percent={s.hostCpuPercent}
          description={VMWARE_METRIC_DESCRIPTIONS.overviewHostCpu}
        />
        <GoldenMetricTile
          title="Host Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(s.hostMemoryPercent)}
          sublabel={
            s.hostMemoryUsedBytes !== null && s.hostMemoryCapacityBytes !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatBytes(s.hostMemoryUsedBytes),
                  total: formatBytes(s.hostMemoryCapacityBytes),
                })
              : "of ESXi host memory"
          }
          percent={s.hostMemoryPercent}
          thresholds={{ warn: 80, danger: 95 }}
          description={VMWARE_METRIC_DESCRIPTIONS.overviewHostMemory}
        />
        <GoldenMetricTile
          title="Datastores"
          icon={IconProp.Database}
          iconColor="amber"
          value={formatPercent(worstDatastorePercent)}
          sublabel={
            inventory?.worstDatastoreName
              ? translator.translateTemplate("fullest: {{storageName}}", {
                  storageName: inventory.worstDatastoreName,
                })
              : "fullest datastore"
          }
          percent={worstDatastorePercent}
          thresholds={{
            warn: DATASTORE_WARN_PERCENT,
            danger: DATASTORE_CRITICAL_PERCENT,
          }}
          description={VMWARE_METRIC_DESCRIPTIONS.overviewDatastores}
        />
        <GoldenMetricTile
          title="VM CPU Ready"
          icon={IconProp.CPUChip}
          iconColor="sky"
          value={formatPercent(s.vmCpuReadyAvgPercent)}
          sublabel={
            s.vmCpuReadyMaxPercent !== null
              ? translator.translatePlural(
                  {
                    one: "max {{max}} across {{count}} powered-on VM",
                    other: "max {{max}} across {{count}} powered-on VMs",
                  },
                  s.vmCpuReadyVmCount,
                  { max: formatPercent(s.vmCpuReadyMaxPercent) },
                )
              : "avg across powered-on VMs"
          }
          percent={s.vmCpuReadyAvgPercent}
          /*
           * CPU ready is a contention signal, not a utilization: the
           * alert template fires past 10%, so amber at 5 and red at 10.
           */
          thresholds={{ warn: 5, danger: VM_CPU_READY_WARN_PERCENT }}
          description={VMWARE_METRIC_DESCRIPTIONS.overviewVmCpuReady}
        />
      </div>
    );
  };

  const renderChartCard: (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald" | "sky";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
    // What the chart plots, in an (i) beside the title.
    description?: string | undefined;
  }) => ReactElement = (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald" | "sky";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
    description?: string | undefined;
  }): ReactElement => {
    const colors: { bg: string; ring: string; text: string } =
      tileColorClasses[params.iconColor];

    /*
     * One header for the skeleton and the loaded card, so the (i) is there
     * from the first paint rather than appearing once the data lands.
     */
    const header: ReactElement = (
      <div className="flex items-center justify-between mb-3">
        <div className="flex min-w-0 items-center gap-1">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            {params.title}
          </span>
          <InfoTooltip label={params.title} text={params.description} />
        </div>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={params.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
    );

    if (!chartWindow) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {header}
          <div className="h-48 animate-pulse rounded-md bg-gray-50" />
        </div>
      );
    }

    const xAxis: ChartXAxis = {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: chartWindow.start,
        max: chartWindow.end,
        aggregateType: XAxisAggregateType.Average,
      },
    };
    const yAxis: YAxis = params.yAxis ?? {
      legend: "%",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: 100,
        formatter: (value: number): string => {
          return `${Math.round(value)}%`;
        },
        precision: YAxisPrecision.NoDecimals,
      },
    };

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {header}
        <LineChartElement
          data={params.data}
          xAxis={xAxis}
          yAxis={yAxis}
          curve={ChartCurve.MONOTONE}
          sync={true}
          syncid={`vmware-overview-${modelId.toString()}`}
          heightInPx={180}
          showLegend={params.showLegend ?? false}
        />
      </div>
    );
  };

  const renderGoldenCharts: () => ReactElement = (): ReactElement => {
    if (goldenError) {
      return <Fragment />;
    }

    const bytesYAxis: YAxis = {
      legend: "Bytes",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          return ValueFormatter.formatValue(value, "By");
        },
      },
    };

    const cpuReadyYAxis: YAxis = {
      legend: "%",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number): string => {
          return `${Math.round(value)}%`;
        },
      },
    };

    /*
     * Drag-to-zoom is named once, at the right of the section heading,
     * while the pointer is over the section: four cards share a row, too
     * narrow to hold the hint beside a title and the icon without wrapping.
     */
    return (
      <div className="group/zoomhint mb-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {translator.translateText("vCenter resource usage")}
            </h2>
            <p className="text-xs text-gray-500">
              {translator.translateText(
                "Aggregated across ESXi hosts (CPU/memory), datastores (used space) and powered-on VMs (CPU ready) over the selected time range",
              )}
            </p>
          </div>
          <TimeRangeZoomHint revealOnHover={true} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {renderChartCard({
            title: "Host CPU",
            icon: IconProp.ChartBar,
            iconColor: "blue",
            data: cpuSeries,
            description: VMWARE_METRIC_DESCRIPTIONS.overviewHostCpuChart,
          })}
          {renderChartCard({
            title: "Host Memory",
            icon: IconProp.SquareStack,
            iconColor: "violet",
            data: memorySeries,
            description: VMWARE_METRIC_DESCRIPTIONS.overviewHostMemoryChart,
          })}
          {renderChartCard({
            title: "Datastore Used",
            icon: IconProp.Database,
            iconColor: "amber",
            data: datastoreSeries,
            yAxis: bytesYAxis,
            description: VMWARE_METRIC_DESCRIPTIONS.overviewDatastoreUsedChart,
          })}
          {renderChartCard({
            title: "VM CPU Ready",
            icon: IconProp.CPUChip,
            iconColor: "sky",
            data: cpuReadySeries,
            yAxis: cpuReadyYAxis,
            showLegend: cpuReadySeries.length > 1,
            description: VMWARE_METRIC_DESCRIPTIONS.overviewVmCpuReadyChart,
          })}
        </div>
      </div>
    );
  };

  const renderTopList: (params: {
    rows: Array<TopRow>;
    kind: VMwareResourceKind;
    valueOf: (row: TopRow) => string;
    barColorClass: string;
    emptyMessage: string;
  }) => ReactElement = (params: {
    rows: Array<TopRow>;
    kind: VMwareResourceKind;
    valueOf: (row: TopRow) => string;
    barColorClass: string;
    emptyMessage: string;
  }): ReactElement => {
    if (params.rows.length === 0) {
      return (
        <p className="text-gray-400 text-sm py-8 text-center">
          {params.emptyMessage}
        </p>
      );
    }
    /*
     * Each row opens its part's page - the whole row, as Needs attention's
     * rows do (ResourcePartRow): a wide target, a focus ring for a keyboard.
     */
    return (
      <ul className="-mx-5 divide-y divide-gray-100">
        {params.rows.map((row: TopRow, index: number) => {
          const pct: number = Math.min(Math.max(row.percent, 0), 100);
          return (
            <li key={row.externalId} data-testid="vmware-top-consumer">
              <ResourcePartRow
                to={partRoutes.getPartRoute(params.kind, row.externalId)}
                className="block"
              >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="flex-shrink-0 text-xs font-medium text-gray-400 w-4">
                    {index + 1}.
                  </span>
                  <span className="text-sm font-medium text-gray-900 truncate">
                    <bdi>{row.name}</bdi>
                  </span>
                  {row.context && (
                    <span className="flex-shrink-0 inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600 truncate max-w-[10rem]">
                      {row.context}
                    </span>
                  )}
                </div>
                <span className="flex-shrink-0 text-sm font-semibold text-gray-700 tabular-nums ml-2">
                  {params.valueOf(row)}
                </span>
              </div>
              <div className="pl-6">
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      pct > 80
                        ? "bg-red-500"
                        : pct > 60
                          ? "bg-amber-500"
                          : params.barColorClass
                    }`}
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                    }}
                  />
                </div>
              </div>
              </ResourcePartRow>
            </li>
          );
        })}
      </ul>
    );
  };

  const renderTopSection: (params: {
    title: string;
    subtitle: string;
    icon: IconProp;
    iconBgClass: string;
    iconTextClass: string;
    children: ReactElement;
    className?: string;
    // What the ranked value means, in an (i) beside the title.
    description?: string | undefined;
  }) => ReactElement = (params: {
    title: string;
    subtitle: string;
    icon: IconProp;
    iconBgClass: string;
    iconTextClass: string;
    children: ReactElement;
    className?: string;
    description?: string | undefined;
  }): ReactElement => {
    return (
      <div className={`p-5 ${params.className || ""}`}>
        <div className="flex items-center gap-2 mb-4">
          <div
            className={`w-8 h-8 rounded-lg ${params.iconBgClass} flex items-center justify-center`}
          >
            <Icon
              icon={params.icon}
              className={`h-4 w-4 ${params.iconTextClass}`}
            />
          </div>
          <div>
            <div className="flex items-center gap-1">
              <h4 className="text-sm font-semibold text-gray-900">
                {params.title}
              </h4>
              <InfoTooltip label={params.title} text={params.description} />
            </div>
            <p className="text-xs text-gray-500">{params.subtitle}</p>
          </div>
        </div>
        {params.children}
      </div>
    );
  };

  const renderTopConsumers: () => ReactElement = (): ReactElement => {
    return (
      <Card
        title="Top Resource Consumers"
        description="The ESXi hosts, datastores and virtual machines using the most of what they have, at vCenter's latest report."
      >
        {isInventoryLoading ? (
          <ComponentLoader />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:divide-x lg:divide-gray-100">
            {renderTopSection({
              title: "Host CPU",
              subtitle: "Top 5 ESXi hosts by CPU utilization",
              icon: IconProp.CPUChip,
              iconBgClass: "bg-blue-50",
              iconTextClass: "text-blue-600",
              description: VMWARE_METRIC_DESCRIPTIONS.topHostsByCpu,
              children: renderTopList({
                rows: inventory?.topHostsByCpu || [],
                kind: VMwareResourceKind.Host,
                valueOf: (row: TopRow): string => {
                  return formatPercent(row.value);
                },
                barColorClass: "bg-blue-500",
                emptyMessage: "No host CPU data available.",
              }),
            })}
            {renderTopSection({
              title: "Host Memory",
              subtitle: "Top 5 ESXi hosts by memory usage",
              icon: IconProp.SquareStack,
              iconBgClass: "bg-purple-50",
              iconTextClass: "text-purple-600",
              className: "border-t lg:border-t-0 border-gray-100",
              description: VMWARE_METRIC_DESCRIPTIONS.topHostsByMemory,
              children: renderTopList({
                rows: inventory?.topHostsByMemory || [],
                kind: VMwareResourceKind.Host,
                valueOf: (row: TopRow): string => {
                  return formatBytes(row.value);
                },
                barColorClass: "bg-purple-500",
                emptyMessage: "No host memory data available.",
              }),
            })}
            {renderTopSection({
              title: "Datastore Utilization",
              subtitle: "Top 5 datastores by used capacity",
              icon: IconProp.Database,
              iconBgClass: "bg-amber-50",
              iconTextClass: "text-amber-600",
              className: "border-t border-gray-100",
              description:
                VMWARE_METRIC_DESCRIPTIONS.topDatastoresByUtilization,
              children: renderTopList({
                rows: inventory?.topDatastoresByUtilization || [],
                kind: VMwareResourceKind.Datastore,
                valueOf: (row: TopRow): string => {
                  return formatPercent(row.value);
                },
                barColorClass: "bg-amber-500",
                emptyMessage: "No datastore capacity data available.",
              }),
            })}
            {renderTopSection({
              title: "VM CPU Ready",
              subtitle: "Top 5 powered-on VMs by CPU ready time",
              icon: IconProp.Cube,
              iconBgClass: "bg-sky-50",
              iconTextClass: "text-sky-600",
              className: "border-t border-gray-100",
              description: VMWARE_METRIC_DESCRIPTIONS.topVmsByCpuReady,
              children: renderTopList({
                rows: inventory?.topVmsByCpuReady || [],
                kind: VMwareResourceKind.VirtualMachine,
                valueOf: (row: TopRow): string => {
                  return formatPercent(row.value);
                },
                barColorClass: "bg-sky-500",
                emptyMessage:
                  "No CPU ready data available — reported only for powered-on VMs.",
              }),
            })}
          </div>
        )}
      </Card>
    );
  };

  /*
   * Issue #4105: a drag on any chart sets the page's range to the window
   * dragged out (the charts and the Host CPU / Memory / CPU Ready tiles
   * reload for it); a double-click on any chart, or Reset zoom beside the
   * hero's picker, puts the range from before the zoom back. Inventory,
   * health and top consumers are the current state and stay as they are.
   */
  return (
    <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
      {renderHero()}

      {/*
       * A vCenter a probe collects: how the collection is going, and what
       * fixes it when it is not. One the VMware agent sends: how to connect
       * the agent, while it is not connected.
       */}
      {isProbeCollected(vcenter) ? (
        <div className="mb-5">
          <VMwareCollectionStatusCard modelId={modelId} />
        </div>
      ) : (
        <ResourceConnectionGuideCard
          status={vcenter.otelCollectorStatus as string | undefined}
          lastSeenAt={vcenter.lastSeenAt}
          guide={getVMwareVCenterConnectionGuide(
            (vcenter.name as string | undefined) || "",
            getConfiguredOneUptimeUrl(),
          )}
          documentationRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION] as Route,
            { modelId: modelId },
          )}
        />
      )}

      {/*
       * What needs someone, most urgent first - while the vCenter reports:
       * a disconnected vCenter's last snapshot is no longer the truth, and
       * the hero says Health Unknown instead.
       */}
      {isVCenterConnected && !isInventoryLoading && !inventoryError && (
        <NeedsAttentionCard
          testId="vmware-needs-attention"
          items={attentionItems}
        />
      )}

      {inventoryError && (
        <div className="mb-6">
          <ErrorMessage message={inventoryError} />
        </div>
      )}

      {/* Golden metrics — at-a-glance vCenter health */}
      {renderGoldenMetrics()}

      {/* Golden charts — vCenter resource usage (synced) */}
      {renderGoldenCharts()}

      {/* Each ESXi host at a glance, one step from its page */}
      {inventory && (
        <VMwareHostsCard
          hosts={inventory.hosts}
          datacenters={inventory.datacenters}
          getHostRoute={(externalId: string) => {
            return partRoutes.getPartRoute(VMwareResourceKind.Host, externalId);
          }}
          hostsRoute={hostsRoute}
          now={OneUptimeDate.getCurrentDate()}
        />
      )}

      <ResourceActivityCards
        modelId={modelId}
        resourceQueryKey="vmwareVCenters"
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
        incidentsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW_INCIDENTS] as Route,
          { modelId: modelId },
        )}
        alertsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW_ALERTS] as Route,
          { modelId: modelId },
        )}
        scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE] as Route,
          { modelId: modelId },
        )}
      />

      {/* Top Resource Consumers */}
      {renderTopConsumers()}

      {/*
       * vCenter Details: read here, edited in one place - the same card at
       * the top of the vCenter's Settings page (ResourceDetailsCard).
       */}
      <CardModelDetail<VMwareVCenter>
        name="vCenter Details"
        refresher={detailsRefresher}
        cardProps={{
          title: "vCenter Details",
          buttons: [
            <EditInSettingsLink
              key="edit-in-settings"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_SETTINGS] as Route,
                { modelId: modelId },
              )}
            />,
          ],
        }}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: VMwareVCenter,
          id: "vmware-vcenter-overview",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "vCenter Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                agentVersion: true,
              },
              title: "Agent Version",
              fieldType: FieldType.Element,
              getElement: (item: VMwareVCenter): ReactElement => {
                return (
                  <AgentVersion
                    kind={AgentKind.VMwareAgent}
                    version={item.agentVersion}
                    placeholder="Not reported"
                  />
                );
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: VMwareVCenter): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
        }}
      />

      {/*
       * Last on the page: the VMware AI agent's connection, whether AI may
       * investigate, and how fixes run, linking to AI → AI agent.
       */}
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.VMwareVCenter)}
        resourceId={modelId}
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
      />
    </TimeRangeZoomScope>
  );
};

export default VMwareVCenterOverview;
