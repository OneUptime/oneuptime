import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareResourceModel from "Common/Models/DatabaseModels/VMwareResource";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import Card from "Common/UI/Components/Card/Card";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
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
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
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
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import ValueFormatter from "Common/Utils/ValueFormatter";
import GoldenMetricTile, {
  tileColorClasses,
} from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  VMwareResourceKind,
  fetchVMwareInventoryRows,
  formatBytes,
  routeParamFromExternalId,
  displayNameForResource,
  hasFreshMetrics,
} from "../Utils/VMwareResourceUtils";

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

interface DegradedItem {
  kind: "Datacenter" | "Cluster" | "Host" | "VirtualMachine" | "Datastore";
  externalId: string;
  name: string;
  reasons: Array<string>;
  /* true = drives Unhealthy (red), false = drives Degraded (amber). */
  isCritical: boolean;
}

interface InventorySummary {
  datacenterCount: number;
  clusterCount: number;
  hostCount: number;
  /* Non-template VMs. */
  vmTotal: number;
  vmPoweredOn: number;
  /* VMs whose power state has been inferred at least once. */
  vmWithPowerState: number;
  templateCount: number;
  datastoreCount: number;
  resourcePoolCount: number;
  /* Σ across Datastore rows — null until at least one datastore reports. */
  datastoreUsedBytes: number | null;
  datastoreCapacityBytes: number | null;
  worstDatastorePercent: number | null;
  worstDatastoreName: string;
  /* Σ across Cluster rows (hosts DRS/HA can schedule vs. all). */
  clusterHostsTotal: number;
  clusterHostsEffective: number;
  topHostsByCpu: Array<TopRow>;
  topHostsByMemory: Array<TopRow>;
  topDatastoresByUtilization: Array<TopRow>;
  topVmsByCpuReady: Array<TopRow>;
  degradedItems: Array<DegradedItem>;
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
const DATASTORE_WARN_PERCENT: number = 80;
const DATASTORE_CRITICAL_PERCENT: number = 90;

/* Aligned with the vmware-vm-cpu-ready-contention template (avg > 10 %). */
const VM_CPU_READY_WARN_PERCENT: number = 10;

const MIB: number = 1024 * 1024;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "vmware-overview-auto-refresh-interval";

const VMwareVCenterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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
   * Inventory-derived summary — health, counts, top-N lists and the
   * "why degraded?" drill-down all come from the VMwareResource
   * Postgres table (instant; no ClickHouse).
   */
  const loadInventory: PromiseVoidFunction = async (): Promise<void> => {
    setInventoryError("");
    try {
      const rows: Array<VMwareResourceModel> = await fetchVMwareInventoryRows({
        vmwareVCenterId: modelId,
      });

      let datacenterCount: number = 0;
      let clusterCount: number = 0;
      let hostCount: number = 0;
      let vmTotal: number = 0;
      let vmPoweredOn: number = 0;
      let vmWithPowerState: number = 0;
      let templateCount: number = 0;
      let datastoreCount: number = 0;
      let resourcePoolCount: number = 0;
      let datastoreUsedBytes: number | null = null;
      let datastoreCapacityBytes: number | null = null;
      let worstDatastorePercent: number | null = null;
      let worstDatastoreName: string = "";
      let clusterHostsTotal: number = 0;
      let clusterHostsEffective: number = 0;
      const hosts: Array<{
        externalId: string;
        name: string;
        context: string;
        cpuPercent: number | null;
        memoryBytes: number | null;
        memoryPercent: number | null;
      }> = [];
      const datastores: Array<TopRow> = [];
      const vmsByCpuReady: Array<TopRow> = [];
      const degradedItems: Array<DegradedItem> = [];

      for (const row of rows) {
        const name: string = displayNameForResource(row);
        const externalId: string = row.externalId || "";
        const fresh: boolean = hasFreshMetrics(row);

        if (row.kind === VMwareResourceKind.Datacenter) {
          datacenterCount++;
          /*
           * vcenter.datacenter.host.count fans out over power_state —
           * the ingest scan folds the powered-on slice separately, so
           * a shortfall here is hosts that are off or in standby.
           */
          const dcHosts: number | null = toNumber(row.hostCount);
          const dcHostsOn: number | null = toNumber(row.poweredOnHostCount);
          if (dcHosts !== null && dcHostsOn !== null && dcHostsOn < dcHosts) {
            const off: number = dcHosts - dcHostsOn;
            degradedItems.push({
              kind: "Datacenter",
              externalId,
              name,
              reasons: [
                `${off} host${off === 1 ? "" : "s"} powered off or in standby`,
              ],
              isCritical: false,
            });
          }
        } else if (row.kind === VMwareResourceKind.Cluster) {
          clusterCount++;
          /*
           * vcenter.cluster.host.count{effective=false} is the receiver's
           * only per-cluster host-health signal: a host in maintenance
           * mode or disconnected/unresponsive is counted but not
           * effective — DRS/HA cannot place VMs on it.
           */
          const total: number | null = toNumber(row.hostCount);
          const effective: number | null = toNumber(row.effectiveHostCount);
          if (total !== null) {
            clusterHostsTotal += total;
            if (effective !== null) {
              clusterHostsEffective += effective;
              if (effective < total) {
                const notEffective: number = total - effective;
                degradedItems.push({
                  kind: "Cluster",
                  externalId,
                  name,
                  reasons: [
                    `${notEffective} host${notEffective === 1 ? "" : "s"} not effective (maintenance mode or unresponsive)`,
                  ],
                  isCritical: true,
                });
              }
            }
          }
        } else if (row.kind === VMwareResourceKind.Host) {
          hostCount++;
          // Top-N source: stale metric values render as no-data.
          hosts.push({
            externalId,
            name,
            context: row.clusterName || row.datacenterName || "",
            cpuPercent: fresh ? toNumber(row.latestCpuPercent) : null,
            memoryBytes: fresh ? toNumber(row.latestMemoryBytes) : null,
            memoryPercent: fresh ? toNumber(row.latestMemoryPercent) : null,
          });
        } else if (row.kind === VMwareResourceKind.VirtualMachine) {
          if (row.isTemplate) {
            templateCount++;
            continue;
          }
          vmTotal++;
          if (row.isPoweredOn !== null && row.isPoweredOn !== undefined) {
            vmWithPowerState++;
            if (row.isPoweredOn) {
              vmPoweredOn++;
            }
          }

          const reasons: Array<string> = [];
          let isCritical: boolean = false;
          const swapped: number | null = toNumber(row.memorySwappedBytes);
          if (fresh && swapped !== null && swapped > 0) {
            // Hypervisor swapping = the guest is paging through the host — red.
            reasons.push(
              `${formatBytes(swapped)} of memory swapped by the host`,
            );
            isCritical = true;
          }
          const ballooned: number | null = toNumber(row.memoryBalloonedBytes);
          if (fresh && ballooned !== null && ballooned > 0) {
            reasons.push(`${formatBytes(ballooned)} of memory ballooned`);
          }
          const cpuReady: number | null = fresh
            ? toNumber(row.cpuReadinessPercent)
            : null;
          if (cpuReady !== null && cpuReady > VM_CPU_READY_WARN_PERCENT) {
            reasons.push(
              `CPU ready ${cpuReady.toFixed(1)}% (host CPU contention)`,
            );
          }
          if (reasons.length > 0) {
            degradedItems.push({
              kind: "VirtualMachine",
              externalId,
              name,
              reasons,
              isCritical,
            });
          }
          if (cpuReady !== null && row.isPoweredOn) {
            vmsByCpuReady.push({
              externalId,
              name,
              context: row.hostName || "",
              value: cpuReady,
              percent: cpuReady,
            });
          }
        } else if (row.kind === VMwareResourceKind.Datastore) {
          datastoreCount++;
          const used: number | null = toNumber(row.latestDiskBytes);
          const total: number | null = toNumber(row.maxDiskBytes);
          if (used !== null) {
            datastoreUsedBytes = (datastoreUsedBytes ?? 0) + used;
          }
          if (total !== null) {
            datastoreCapacityBytes = (datastoreCapacityBytes ?? 0) + total;
          }
          const pctFromReceiver: number | null = toNumber(
            row.latestDiskPercent,
          );
          const pct: number | null =
            pctFromReceiver !== null
              ? pctFromReceiver
              : used !== null && total !== null && total > 0
                ? (used / total) * 100
                : null;
          if (pct !== null) {
            if (worstDatastorePercent === null || pct > worstDatastorePercent) {
              worstDatastorePercent = pct;
              worstDatastoreName = name;
            }
            datastores.push({
              externalId,
              name,
              context: row.datacenterName || "",
              value: pct,
              percent: pct,
            });
            if (pct >= DATASTORE_WARN_PERCENT) {
              degradedItems.push({
                kind: "Datastore",
                externalId,
                name,
                reasons: [`${pct.toFixed(1)}% used`],
                isCritical: pct >= DATASTORE_CRITICAL_PERCENT,
              });
            }
          }
        } else if (row.kind === VMwareResourceKind.ResourcePool) {
          resourcePoolCount++;
        }
      }

      const topHostsByCpu: Array<TopRow> = hosts
        .filter((h: (typeof hosts)[number]) => {
          return h.cpuPercent !== null;
        })
        .sort((a: (typeof hosts)[number], b: (typeof hosts)[number]) => {
          return (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
        })
        .slice(0, 5)
        .map((h: (typeof hosts)[number]): TopRow => {
          return {
            externalId: h.externalId,
            name: h.name,
            context: h.context,
            value: h.cpuPercent ?? 0,
            percent: h.cpuPercent ?? 0,
          };
        });

      const maxMemory: number = hosts.reduce(
        (max: number, h: (typeof hosts)[number]) => {
          return Math.max(max, h.memoryBytes ?? 0);
        },
        0,
      );
      const topHostsByMemory: Array<TopRow> = hosts
        .filter((h: (typeof hosts)[number]) => {
          return h.memoryBytes !== null;
        })
        .sort((a: (typeof hosts)[number], b: (typeof hosts)[number]) => {
          return (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0);
        })
        .slice(0, 5)
        .map((h: (typeof hosts)[number]): TopRow => {
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

      const topDatastoresByUtilization: Array<TopRow> = datastores
        .sort((a: TopRow, b: TopRow) => {
          return b.value - a.value;
        })
        .slice(0, 5);

      const topVmsByCpuReady: Array<TopRow> = vmsByCpuReady
        .sort((a: TopRow, b: TopRow) => {
          return b.value - a.value;
        })
        .slice(0, 5);

      /*
       * Health: Unhealthy when a cluster has non-effective hosts, a
       * datastore is at/over the critical threshold, or a VM is being
       * swapped by the hypervisor; Degraded for datastores past the
       * warning threshold, ballooned VMs, CPU-ready contention, or
       * hosts powered off / in standby.
       */
      let health: VCenterHealth = "Healthy";
      if (
        degradedItems.some((item: DegradedItem) => {
          return item.isCritical;
        })
      ) {
        health = "Unhealthy";
      } else if (degradedItems.length > 0) {
        health = "Degraded";
      }

      setInventory({
        datacenterCount,
        clusterCount,
        hostCount,
        vmTotal,
        vmPoweredOn,
        vmWithPowerState,
        templateCount,
        datastoreCount,
        resourcePoolCount,
        datastoreUsedBytes,
        datastoreCapacityBytes,
        worstDatastorePercent,
        worstDatastoreName,
        clusterHostsTotal,
        clusterHostsEffective,
        topHostsByCpu,
        topHostsByMemory,
        topDatastoresByUtilization,
        topVmsByCpuReady,
        degradedItems,
        health,
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
   */
  const loadGoldenMetrics: (vcenterName: string) => Promise<void> = async (
    vcenterName: string,
  ): Promise<void> => {
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
      setGoldenError(API.getFriendlyMessage(err));
    } finally {
      setIsRefreshing(false);
      setIsGoldenLoading(false);
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
        void loadGoldenMetricsRef.current(vcenter.name);
        void loadInventory();
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
  const vmPowerStateKnown: boolean = inventory
    ? inventory.vmWithPowerState > 0
    : vcenter.poweredOnVmCount !== null &&
      vcenter.poweredOnVmCount !== undefined;
  const datastoreCount: number =
    inventory?.datastoreCount || vcenter.datastoreCount || 0;
  const resourcePoolCount: number =
    inventory?.resourcePoolCount || vcenter.resourcePoolCount || 0;
  const datastoreUsedBytes: number | null =
    inventory?.datastoreUsedBytes ?? toNumber(vcenter.datastoreUsedBytes);
  const datastoreCapacityBytes: number | null =
    inventory?.datastoreCapacityBytes ??
    toNumber(vcenter.datastoreCapacityBytes);
  const datastoreUsedPercent: number | null =
    datastoreUsedBytes !== null &&
    datastoreCapacityBytes !== null &&
    datastoreCapacityBytes > 0
      ? (datastoreUsedBytes / datastoreCapacityBytes) * 100
      : null;

  const clusterHostsTotal: number = inventory?.clusterHostsTotal || 0;
  const clusterHostsEffective: number = inventory?.clusterHostsEffective || 0;
  const hostEffectivenessPct: number | null =
    clusterHostsTotal > 0
      ? (clusterHostsEffective / clusterHostsTotal) * 100
      : null;

  const vcenterHealth: VCenterHealth = inventory?.health || "Healthy";
  const allDegradedItems: Array<DegradedItem> = inventory?.degradedItems || [];

  /*
   * When the collector is disconnected the inventory snapshot is stale, so
   * the derived health is no longer trustworthy. Surface "Unknown" instead
   * of a misleading last-known status (mirrors the hero badge).
   */
  const isVCenterConnected: boolean = ["connected", "active"].includes(
    ((vcenter?.otelCollectorStatus as string) || "").toLowerCase(),
  );
  const displayVCenterHealth: string = isVCenterConnected
    ? vcenterHealth
    : "Unknown";

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
  const resourcePoolsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS] as Route,
    { modelId: modelId },
  );

  const detailPageMapForKind: (kind: DegradedItem["kind"]) => PageMap | null = (
    kind: DegradedItem["kind"],
  ): PageMap | null => {
    switch (kind) {
      case "Host":
        return PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL;
      case "VirtualMachine":
        return PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL;
      case "Datastore":
        return PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL;
      case "Cluster":
        return PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL;
      default:
        // Datacenters have no detail page.
        return null;
    }
  };

  const navigateToDetail: (
    kind: DegradedItem["kind"],
    externalId: string,
  ) => void = (kind: DegradedItem["kind"], externalId: string): void => {
    const pageMap: PageMap | null = detailPageMapForKind(kind);
    if (!pageMap || !externalId) {
      return;
    }
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
        modelId: modelId,
        subModelId: routeParamFromExternalId(externalId),
      }),
    );
  };

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
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : "never";

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
    const connectionLabel: string = isConnected
      ? "Connected"
      : status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : "Disconnected";

    /*
     * Health is derived from the last inventory snapshot, which goes stale
     * once the collector disconnects. Reporting "Healthy" next to a
     * "Disconnected" badge is contradictory and misleading, so when the
     * vCenter is not connected we surface health as "Unknown" (neutral
     * grey) rather than the last-known live status.
     */
    const healthLabel: string = isConnected ? vcenterHealth : "Unknown";
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

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];
    if (datacenterCount > 0) {
      specChips.push({
        icon: IconProp.Folder,
        label: `${datacenterCount} datacenter${datacenterCount === 1 ? "" : "s"}`,
      });
    }
    if (clusterCount > 0) {
      specChips.push({
        icon: IconProp.SquareStack,
        label: `${clusterCount} cluster${clusterCount === 1 ? "" : "s"}`,
      });
    }
    if (hostCount > 0) {
      specChips.push({
        icon: IconProp.ServerStack,
        label: `${hostCount} ESXi host${hostCount === 1 ? "" : "s"}`,
      });
    }
    if (vmTotal > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: vmPowerStateKnown
          ? `${vmPoweredOn}/${vmTotal} VM${vmTotal === 1 ? "" : "s"} powered on`
          : `${vmTotal} VM${vmTotal === 1 ? "" : "s"}`,
      });
    }
    if (datastoreCount > 0) {
      specChips.push({
        icon: IconProp.Database,
        label: `${datastoreCount} datastore${datastoreCount === 1 ? "" : "s"}`,
      });
    }
    if (vcenter.agentVersion) {
      specChips.push({
        icon: IconProp.Terminal,
        label: `Agent ${String(vcenter.agentVersion)}`,
      });
    }

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
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
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
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${connectionBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${connectionDotClass}`}
                      />
                      {connectionLabel}
                    </span>
                    {!isInventoryLoading && !inventoryError && (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthBadgeClass}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${healthDotClass}`}
                        />
                        {healthLabel}
                      </span>
                    )}
                  </div>
                  {vcenter.description && (
                    <div className="mt-1 truncate text-sm text-gray-500">
                      {String(vcenter.description)}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    Last seen {lastSeenText}
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 md:self-start">
                {renderRefreshControl()}
              </div>
            </div>

            {specChips.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {specChips.map(
                  (
                    chip: { icon: IconProp; label: string },
                    idx: number,
                  ): ReactElement => {
                    return (
                      <span
                        key={`spec-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                      >
                        <Icon
                          icon={chip.icon}
                          className="h-3 w-3 text-gray-500"
                        />
                        <span className="font-medium">{chip.label}</span>
                      </span>
                    );
                  },
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
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_: unknown, idx: number) => {
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

    const vmPoweredOnPct: number | null =
      vmPowerStateKnown && vmTotal > 0 ? (vmPoweredOn / vmTotal) * 100 : null;

    /*
     * Datastore tile: the inventory's worst datastore (instant, names the
     * culprit) wins; the ClickHouse worst-per-bucket mean is the fallback
     * while the inventory is in flight.
     */
    const worstDatastorePercent: number | null =
      inventory?.worstDatastorePercent ?? s.datastoreWorstPercent;

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <GoldenMetricTile
          title="Host Effectiveness"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={
            hostEffectivenessPct === null
              ? "—"
              : `${clusterHostsEffective}/${clusterHostsTotal}`
          }
          sublabel={
            hostEffectivenessPct === null
              ? "clustered hosts DRS/HA can schedule"
              : clusterHostsEffective < clusterHostsTotal
                ? `${clusterHostsTotal - clusterHostsEffective} in maintenance or unresponsive`
                : "clustered hosts DRS/HA can schedule"
          }
          percent={hostEffectivenessPct}
          thresholds={{ warn: 99, danger: 51 }}
          higherIsBetter={true}
        />
        <GoldenMetricTile
          title="Host CPU"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(s.hostCpuPercent)}
          sublabel="capacity-weighted across ESXi hosts"
          percent={s.hostCpuPercent}
        />
        <GoldenMetricTile
          title="Host Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatPercent(s.hostMemoryPercent)}
          sublabel={
            s.hostMemoryUsedBytes !== null && s.hostMemoryCapacityBytes !== null
              ? `${formatBytes(s.hostMemoryUsedBytes)} of ${formatBytes(s.hostMemoryCapacityBytes)}`
              : "of ESXi host memory"
          }
          percent={s.hostMemoryPercent}
          thresholds={{ warn: 80, danger: 95 }}
        />
        <GoldenMetricTile
          title="Datastores"
          icon={IconProp.Database}
          iconColor="amber"
          value={formatPercent(worstDatastorePercent)}
          sublabel={
            inventory?.worstDatastoreName
              ? `fullest: ${inventory.worstDatastoreName}`
              : "fullest datastore"
          }
          percent={worstDatastorePercent}
          thresholds={{
            warn: DATASTORE_WARN_PERCENT,
            danger: DATASTORE_CRITICAL_PERCENT,
          }}
        />
        <GoldenMetricTile
          title="VM CPU Ready"
          icon={IconProp.CPUChip}
          iconColor="sky"
          value={formatPercent(s.vmCpuReadyAvgPercent)}
          sublabel={
            s.vmCpuReadyMaxPercent !== null
              ? `max ${formatPercent(s.vmCpuReadyMaxPercent)} across ${s.vmCpuReadyVmCount} powered-on VM${s.vmCpuReadyVmCount === 1 ? "" : "s"}`
              : "avg across powered-on VMs"
          }
          percent={s.vmCpuReadyAvgPercent}
          /*
           * CPU ready is a contention signal, not a utilization: the
           * alert template fires past 10%, so amber at 5 and red at 10.
           */
          thresholds={{ warn: 5, danger: VM_CPU_READY_WARN_PERCENT }}
        />
        <GoldenMetricTile
          title="Virtual Machines"
          icon={IconProp.Cube}
          iconColor="slate"
          value={
            vmTotal > 0
              ? vmPowerStateKnown
                ? `${vmPoweredOn}/${vmTotal}`
                : String(vmTotal)
              : "—"
          }
          sublabel={
            vmPowerStateKnown
              ? `powered on${
                  inventory && inventory.templateCount > 0
                    ? ` · ${inventory.templateCount} template${inventory.templateCount === 1 ? "" : "s"}`
                    : ""
                }`
              : "power state inferred after the first collection"
          }
          percent={vmPoweredOnPct}
          /*
           * A powered-off VM is not a fault — the bar only shows the
           * proportion, it never turns amber or red.
           */
          thresholds={{ warn: 0, danger: 0 }}
          higherIsBetter={true}
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
  }) => ReactElement = (params: {
    title: string;
    icon: IconProp;
    iconColor: "blue" | "violet" | "amber" | "emerald" | "sky";
    data: Array<SeriesPoint>;
    yAxis?: YAxis;
    showLegend?: boolean;
  }): ReactElement => {
    const colors: { bg: string; ring: string; text: string } =
      tileColorClasses[params.iconColor];

    if (!chartWindow) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              {params.title}
            </span>
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
            >
              <Icon
                icon={params.icon}
                className={`h-3.5 w-3.5 ${colors.text}`}
              />
            </div>
          </div>
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
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            {params.title}
          </span>
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
          >
            <Icon icon={params.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
          </div>
        </div>
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

    return (
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              vCenter resource usage
            </h2>
            <p className="text-xs text-gray-500">
              Aggregated across ESXi hosts (CPU/memory), datastores (used space)
              and powered-on VMs (CPU ready) over the selected time range
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {renderChartCard({
            title: "Host CPU",
            icon: IconProp.ChartBar,
            iconColor: "blue",
            data: cpuSeries,
          })}
          {renderChartCard({
            title: "Host Memory",
            icon: IconProp.SquareStack,
            iconColor: "violet",
            data: memorySeries,
          })}
          {renderChartCard({
            title: "Datastore Used",
            icon: IconProp.Database,
            iconColor: "amber",
            data: datastoreSeries,
            yAxis: bytesYAxis,
          })}
          {renderChartCard({
            title: "VM CPU Ready",
            icon: IconProp.CPUChip,
            iconColor: "sky",
            data: cpuReadySeries,
            yAxis: cpuReadyYAxis,
            showLegend: cpuReadySeries.length > 1,
          })}
        </div>
      </div>
    );
  };

  const renderWhyDegraded: () => ReactElement = (): ReactElement => {
    if (vcenterHealth === "Healthy" || allDegradedItems.length === 0) {
      return <Fragment />;
    }

    const kindLabel: (kind: DegradedItem["kind"]) => string = (
      kind: DegradedItem["kind"],
    ): string => {
      switch (kind) {
        case "VirtualMachine":
          return "VM";
        case "Host":
          return "ESXi Host";
        default:
          return kind;
      }
    };

    return (
      <Card
        title="Why is this vCenter degraded?"
        description="Specific clusters, datacenters, virtual machines and datastores that are driving the current health status. Click through to investigate."
      >
        <div className="divide-y divide-gray-100">
          {allDegradedItems.map((item: DegradedItem, index: number) => {
            const icon: IconProp =
              item.kind === "Cluster"
                ? IconProp.SquareStack
                : item.kind === "Datacenter"
                  ? IconProp.Folder
                  : item.kind === "Host"
                    ? IconProp.ServerStack
                    : item.kind === "VirtualMachine"
                      ? IconProp.Cube
                      : IconProp.Database;
            const iconBgClass: string = item.isCritical
              ? "bg-red-100"
              : "bg-amber-100";
            const iconColorClass: string = item.isCritical
              ? "text-red-600"
              : "text-amber-600";
            const chipClass: string = item.isCritical
              ? "bg-red-50 text-red-700 border-red-200"
              : "bg-amber-50 text-amber-700 border-amber-200";
            const isClickable: boolean =
              detailPageMapForKind(item.kind) !== null &&
              Boolean(item.externalId);
            return (
              <div
                key={`degraded-${index}`}
                onClick={() => {
                  navigateToDetail(item.kind, item.externalId);
                }}
                className={`flex items-start gap-3 px-5 py-3.5 transition-colors ${
                  isClickable ? "hover:bg-gray-50 cursor-pointer" : ""
                }`}
              >
                <div
                  className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-full ${iconBgClass} flex items-center justify-center`}
                >
                  <Icon
                    icon={icon}
                    className={`h-3.5 w-3.5 ${iconColorClass}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {item.name}
                    </span>
                    <span className="inline-flex px-1.5 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-600">
                      {kindLabel(item.kind)}
                    </span>
                    {item.reasons.map((reason: string) => {
                      return (
                        <span
                          key={reason}
                          className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded border ${chipClass}`}
                        >
                          {reason}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 font-mono">
                    {item.externalId}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  const renderTopList: (params: {
    rows: Array<TopRow>;
    kind: DegradedItem["kind"];
    valueOf: (row: TopRow) => string;
    barColorClass: string;
    emptyMessage: string;
  }) => ReactElement = (params: {
    rows: Array<TopRow>;
    kind: DegradedItem["kind"];
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
    return (
      <div className="space-y-3">
        {params.rows.map((row: TopRow, index: number) => {
          const pct: number = Math.min(Math.max(row.percent, 0), 100);
          return (
            <div
              key={row.externalId}
              onClick={() => {
                navigateToDetail(params.kind, row.externalId);
              }}
              className="group cursor-pointer rounded-lg p-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="flex-shrink-0 text-xs font-medium text-gray-400 w-4">
                    {index + 1}.
                  </span>
                  <span className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-700">
                    {row.name}
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
            </div>
          );
        })}
      </div>
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
  }) => ReactElement = (params: {
    title: string;
    subtitle: string;
    icon: IconProp;
    iconBgClass: string;
    iconTextClass: string;
    children: ReactElement;
    className?: string;
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
            <h4 className="text-sm font-semibold text-gray-900">
              {params.title}
            </h4>
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
        description="ESXi hosts, datastores and virtual machines with the highest utilization in this vCenter — read from the Postgres inventory, instant."
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
              children: renderTopList({
                rows: inventory?.topHostsByCpu || [],
                kind: "Host",
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
              children: renderTopList({
                rows: inventory?.topHostsByMemory || [],
                kind: "Host",
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
              children: renderTopList({
                rows: inventory?.topDatastoresByUtilization || [],
                kind: "Datastore",
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
              children: renderTopList({
                rows: inventory?.topVmsByCpuReady || [],
                kind: "VirtualMachine",
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

  const renderResourceLinks: () => ReactElement = (): ReactElement => {
    const links: Array<{
      title: string;
      description: string;
      route: Route;
      count: number | undefined;
      icon: IconProp;
      iconBgClass: string;
      iconTextClass: string;
    }> = [
      {
        title: "Hosts",
        description: "ESXi hosts with CPU, memory, disk latency and NIC health",
        route: hostsRoute,
        count: hostCount > 0 ? hostCount : undefined,
        icon: IconProp.ServerStack,
        iconBgClass: "bg-slate-100",
        iconTextClass: "text-slate-600",
      },
      {
        title: "Virtual Machines",
        description:
          "VMs and templates with power state and live resource usage",
        route: virtualMachinesRoute,
        count: vmTotal > 0 ? vmTotal : undefined,
        icon: IconProp.Cube,
        iconBgClass: "bg-emerald-100",
        iconTextClass: "text-emerald-600",
      },
      {
        title: "Datastores",
        description: "Datastores with usage, capacity and growth forecast",
        route: datastoresRoute,
        count: datastoreCount > 0 ? datastoreCount : undefined,
        icon: IconProp.Database,
        iconBgClass: "bg-amber-100",
        iconTextClass: "text-amber-600",
      },
      {
        title: "Clusters",
        description: "vSphere clusters with host effectiveness and vSAN health",
        route: clustersRoute,
        count: clusterCount > 0 ? clusterCount : undefined,
        icon: IconProp.SquareStack,
        iconBgClass: "bg-sky-100",
        iconTextClass: "text-sky-600",
      },
      {
        title: "Resource Pools",
        description: "Resource pools with CPU, memory, ballooning and swapping",
        route: resourcePoolsRoute,
        count: resourcePoolCount > 0 ? resourcePoolCount : undefined,
        icon: IconProp.Layers,
        iconBgClass: "bg-violet-100",
        iconTextClass: "text-violet-600",
      },
    ];

    return (
      <Card
        title="Resources"
        description="Explore the vSphere inventory managed by this vCenter."
      >
        {isInventoryLoading ? (
          <ComponentLoader />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4 pr-4 pl-1">
            {links.map(
              (link: {
                title: string;
                description: string;
                route: Route;
                count: number | undefined;
                icon: IconProp;
                iconBgClass: string;
                iconTextClass: string;
              }) => {
                return (
                  <div
                    key={link.title}
                    onClick={() => {
                      Navigation.navigate(link.route);
                    }}
                    className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all duration-200 group cursor-pointer"
                  >
                    <div
                      className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${link.iconBgClass}`}
                    >
                      <Icon
                        icon={link.icon}
                        className={`h-5 w-5 ${link.iconTextClass}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 group-hover:text-indigo-700 flex items-center justify-between">
                        <span>{link.title}</span>
                        {link.count !== undefined && (
                          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-semibold rounded-full bg-indigo-100 text-indigo-700">
                            {link.count}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {link.description}
                      </div>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        )}
      </Card>
    );
  };

  const renderSummaryValue: (value: ReactElement) => ReactElement = (
    value: ReactElement,
  ): ReactElement => {
    if (isInventoryLoading) {
      return <span className="text-2xl font-semibold text-gray-300">…</span>;
    }
    if (inventoryError) {
      return <span className="text-2xl font-semibold text-gray-300">—</span>;
    }
    return value;
  };

  const renderDatastoreSummaryValue: () => ReactElement = (): ReactElement => {
    const barColor: string =
      datastoreUsedPercent === null
        ? "bg-gray-300"
        : datastoreUsedPercent >= DATASTORE_CRITICAL_PERCENT
          ? "bg-red-500"
          : datastoreUsedPercent >= DATASTORE_WARN_PERCENT
            ? "bg-amber-500"
            : "bg-emerald-500";
    const clamped: number =
      datastoreUsedPercent === null
        ? 0
        : Math.min(100, Math.max(0, datastoreUsedPercent));
    return (
      <div>
        <span className="text-2xl font-semibold">
          {datastoreCount.toString()}
        </span>
        {datastoreCapacityBytes !== null && datastoreUsedBytes !== null && (
          <div className="mt-1.5">
            <div className="mb-1 text-xs text-gray-500">
              {formatBytes(datastoreUsedBytes)} of{" "}
              {formatBytes(datastoreCapacityBytes)} used
              {datastoreUsedPercent !== null
                ? ` (${datastoreUsedPercent.toFixed(1)}%)`
                : ""}
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-200">
              <div
                className={`h-1.5 rounded-full ${barColor}`}
                style={{ width: `${clamped}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Fragment>
      {renderHero()}

      {/* Golden metrics — at-a-glance vCenter health */}
      {renderGoldenMetrics()}

      {/* Golden charts — vCenter resource usage (synced) */}
      {renderGoldenCharts()}

      {/* Why is this vCenter degraded? */}
      {renderWhyDegraded()}

      {/* Summary InfoCards */}
      {inventoryError && (
        <div className="mb-5">
          <ErrorMessage message={inventoryError} />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <InfoCard
          title="vCenter Health"
          value={renderSummaryValue(
            <span
              className={`text-2xl font-semibold ${
                !isVCenterConnected
                  ? "text-gray-500"
                  : vcenterHealth === "Healthy"
                    ? "text-emerald-600"
                    : vcenterHealth === "Degraded"
                      ? "text-amber-600"
                      : "text-red-600"
              }`}
            >
              {displayVCenterHealth}
            </span>,
          )}
        />
        <InfoCard
          title="Datacenters"
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {datacenterCount.toString()}
            </span>,
          )}
        />
        <InfoCard
          title="Clusters"
          onClick={() => {
            Navigation.navigate(clustersRoute);
          }}
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {clusterCount.toString()}
              {clusterHostsTotal > 0 &&
                clusterHostsEffective < clusterHostsTotal && (
                  <span className="text-sm text-red-500 ml-1">
                    ({clusterHostsTotal - clusterHostsEffective} host
                    {clusterHostsTotal - clusterHostsEffective === 1
                      ? ""
                      : "s"}{" "}
                    not effective)
                  </span>
                )}
            </span>,
          )}
        />
        <InfoCard
          title="Hosts"
          onClick={() => {
            Navigation.navigate(hostsRoute);
          }}
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {hostCount.toString()}
            </span>,
          )}
        />
        <InfoCard
          title="Virtual Machines"
          onClick={() => {
            Navigation.navigate(virtualMachinesRoute);
          }}
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {vmPowerStateKnown ? `${vmPoweredOn} / ${vmTotal}` : vmTotal}
              {vmPowerStateKnown && (
                <span className="text-sm text-gray-500 ml-1">powered on</span>
              )}
            </span>,
          )}
        />
        <InfoCard
          title="Datastores"
          onClick={() => {
            Navigation.navigate(datastoresRoute);
          }}
          value={renderSummaryValue(renderDatastoreSummaryValue())}
        />
        <InfoCard
          title="Resource Pools"
          onClick={() => {
            Navigation.navigate(resourcePoolsRoute);
          }}
          value={renderSummaryValue(
            <span className="text-2xl font-semibold">
              {resourcePoolCount.toString()}
            </span>,
          )}
        />
        <InfoCard
          title="Agent Status"
          value={
            <StatusBadge
              text={
                vcenter.otelCollectorStatus === "connected"
                  ? "Connected"
                  : "Disconnected"
              }
              type={
                vcenter.otelCollectorStatus === "connected"
                  ? StatusBadgeType.Success
                  : StatusBadgeType.Danger
              }
            />
          }
        />
      </div>

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

      {/* Quick Navigation */}
      {renderResourceLinks()}

      {/* Top Resource Consumers */}
      {renderTopConsumers()}

      {/* vCenter Details */}
      <CardModelDetail<VMwareVCenter>
        name="vCenter Details"
        formSteps={[
          {
            title: "vCenter Info",
            id: "vcenter-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        cardProps={{
          title: "vCenter Details",
          description: "Basic information about this vCenter.",
        }}
        isEditable={true}
        editButtonText="Edit vCenter"
        formFields={[
          {
            field: {
              name: true,
            },
            stepId: "vcenter-info",
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "prod-vcenter",
            description:
              "This should match the vmware.vcenter.name resource attribute reported by the VMware Agent (its VMWARE_VCENTER_NAME).",
          },
          {
            field: {
              description: true,
            },
            stepId: "vcenter-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production vCenter Server in the US East datacenter",
          },
          {
            field: {
              labels: true,
            },
            stepId: "labels",
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
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
              fieldType: FieldType.Text,
              placeholder: "Not reported",
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
    </Fragment>
  );
};

export default VMwareVCenterOverview;
