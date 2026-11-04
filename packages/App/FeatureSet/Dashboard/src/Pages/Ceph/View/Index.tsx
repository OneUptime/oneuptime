import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import ResourceRecordDetailsCard from "../../../Components/TelemetryResource/ResourceRecordDetailsCard";
import ResourceHeroDescription from "../../../Components/TelemetryResource/ResourceHeroDescription";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import FieldType from "Common/UI/Components/Types/FieldType";
import Card from "Common/UI/Components/Card/Card";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import { CARD_GRID_CENTERED_STATE_CLASS_NAME } from "Common/UI/Components/Card/CardGridLayout";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import { getCephClusterConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import { getConfiguredOneUptimeUrl } from "../../../Components/SetupGuide/ConfiguredOneUptimeUrl";
import ResourceAiAgentStatusSummaryCard from "../../../Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Dictionary from "Common/Types/Dictionary";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import StackedProgressBar, {
  StackedProgressBarSegment,
} from "Common/UI/Components/StackedProgressBar/StackedProgressBar";
import CephRateChart from "../../../Components/Ceph/CephRateChart";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import CephResourceUtils, {
  getCephShortVersion,
} from "../Utils/CephResourceUtils";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
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
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { formatRelativeTime } from "../../../Components/Home/HomeRelativeTime";
import {
  ResourceAttentionItem,
  ResourceHealth,
} from "../../../Components/ResourcePart/ResourceAttention";
import {
  CephPartRoutes,
  getCephPartRoutes,
} from "../../../Components/Ceph/Part/CephPartRoutes";
import {
  CEPH_CLUSTER_FULL_PERCENT,
  CEPH_CLUSTER_NEARFULL_PERCENT,
  CephHealthCheck,
  CephPoolPgStates,
  getCephAttentionItems,
  getCephHealth,
  getCephPoolReadings,
} from "../Utils/CephHealth";
import {
  CephHealthCheckReadings,
  CephLatestPerLabel,
  CephPgStateReadings,
  loadCephHealthChecks,
  loadCephLatestPerLabel,
  loadCephPgStates,
} from "../Utils/CephReadings";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CephMetricDescriptions";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A Ceph cluster's Overview, what `ceph status` and `ceph health detail`
 * would tell an administrator first:
 *
 *   - the hero: the agent's connection and the cluster's health by its
 *     rules (CephHealth: Ceph's own verdict, its OSDs, monitors and pools),
 *     and counts that open their lists - OSDs up, monitors in quorum,
 *     pools;
 *   - Needs attention: what is broken or needs a look, the most urgent
 *     first - Ceph's own checks on the cluster's row, as Ceph names them,
 *     then each OSD, monitor and pool with why, one step from its page -
 *     while the agent reports (a disconnected cluster's last picture is no
 *     longer the truth, and the hero says Health Unknown instead);
 *   - capacity, OSD and placement-group tiles at their alerts' lines, the
 *     OSD up/in matrix, placement-group states, the golden charts, the
 *     largest and fullest pools, its details and its AI agent.
 *
 * Counts and health ride the CephCluster snapshot columns and the
 * CephResource Postgres inventory (single-source with the side menu's
 * counts); ClickHouse is only read for what Postgres cannot answer: the
 * checks Ceph raised, placement-group states, raw capacity bytes with the
 * growth projection, and the charts. Each section has its own loader, so a
 * slow ClickHouse never blanks the Postgres-served hero (K8s lesson: no
 * Promise.all gating across sections).
 */

const CLUSTER_ATTR: string = "resource.ceph.cluster.name";

type PgStats = CephPoolPgStates;

interface CapacityStats {
  totalBytes: number | null;
  usedBytes: number | null;
  usedPercent: number | null;
  /*
   * Days until used capacity crosses 85% of total (the default Ceph
   * nearfull ratio) assuming the linear growth observed over the
   * projection window. null = unknown; Infinity = not growing.
   */
  daysToNearfull: number | null;
}

export interface OsdMatrix {
  upIn: number;
  upOut: number;
  downIn: number;
  downOut: number;
  total: number;
}

interface TopPoolRow {
  poolId: string;
  poolName: string;
  storedBytes: number | null;
  usedPercent: number | null;
}

/*
 * One of the two lists of pools. Its title and description are English
 * text, which the card and its title translate.
 */
interface TopPoolList {
  title: string;
  description: string;
  tooltip: string;
  rows: Array<TopPoolRow>;
  renderValue: (row: TopPoolRow) => string;
}

const PROJECTION_WINDOW_HOURS: number = 24;
// The Cluster Near Full alert's line, which the projection counts down to.
const NEARFULL_RATIO: number = CEPH_CLUSTER_NEARFULL_PERCENT / 100;

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const formatInt: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return Math.round(value).toString();
};

/*
 * A card or chart title followed by the (i) that says what its numbers
 * mean. Exported for the tooltip render tests.
 */
export interface CephMetricTitleProps {
  title: string;
  description: string;
}

export const CephMetricTitle: FunctionComponent<CephMetricTitleProps> = (
  props: CephMetricTitleProps,
): ReactElement => {
  // A Card translates a title it is given as text, not one inside an element.
  const translator: Translator = useTranslator();
  return (
    <span className="inline-flex items-center gap-1.5">
      {translator.translateText(props.title) || props.title}
      <InfoTooltip label={props.title} text={props.description} />
    </span>
  );
};

export interface OsdStateCell {
  label: string;
  sublabel: string;
  count: number;
  className: string;
  description: string;
}

/*
 * The four up/in quadrants of the OSD States card, each with the (i) text
 * that explains it. Pure, so the render tests can build the cells.
 */
export function buildOsdStateCells(matrix: OsdMatrix): Array<OsdStateCell> {
  return [
    {
      label: "Up + In",
      sublabel: "healthy",
      count: matrix.upIn,
      className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      description: CEPH_METRIC_DESCRIPTIONS.osdUpIn,
    },
    {
      label: "Up + Out",
      sublabel: "draining / rebalancing",
      count: matrix.upOut,
      className: "bg-sky-50 text-sky-800 ring-sky-200",
      description: CEPH_METRIC_DESCRIPTIONS.osdUpOut,
    },
    {
      label: "Down + In",
      sublabel: "failed but still mapped",
      count: matrix.downIn,
      className: "bg-red-50 text-red-800 ring-red-200",
      description: CEPH_METRIC_DESCRIPTIONS.osdDownIn,
    },
    {
      label: "Down + Out",
      sublabel: "removed from placement",
      count: matrix.downOut,
      className: "bg-gray-50 text-gray-700 ring-gray-200",
      description: CEPH_METRIC_DESCRIPTIONS.osdDownOut,
    },
  ];
}

export const OsdStateCellView: FunctionComponent<{
  cell: OsdStateCell;
}> = (props: { cell: OsdStateCell }): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <div className={`rounded-lg p-4 ring-1 ring-inset ${props.cell.className}`}>
      <div className="text-2xl font-semibold leading-none">
        {props.cell.count}
      </div>
      <div className="mt-1 flex items-center gap-1 text-sm font-medium">
        <span>
          {translator.translateText(props.cell.label) || props.cell.label}
        </span>
        <InfoTooltip label={props.cell.label} text={props.cell.description} />
      </div>
      <div className="text-xs opacity-75">
        {translator.translateText(props.cell.sublabel) || props.cell.sublabel}
      </div>
    </div>
  );
};

const CephClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  // A count in a sentence, as the reader's language writes numbers.
  const formatCount: (value: number | null) => string = (
    value: number | null,
  ): string => {
    if (value === null || !isFinite(value)) {
      return "—";
    }
    return translator.formatNumber(Math.round(value));
  };
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [pageError, setPageError] = useState<string>("");
  /*
   * Toggled on every refresh after the first load, so the details card
   * re-reads Last Seen and Agent Version along with the rest of the page.
   */
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);

  // Inventory-backed sections (Postgres, instant).
  const [inventoryRows, setInventoryRows] = useState<Array<CephResourceModel>>(
    [],
  );
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);
  const [inventoryError, setInventoryError] = useState<string>("");
  const [inventoryReadAt, setInventoryReadAt] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );
  const [osdMatrix, setOsdMatrix] = useState<OsdMatrix | null>(null);
  const [monsInQuorum, setMonsInQuorum] = useState<number | null>(null);
  const [monsTotal, setMonsTotal] = useState<number | null>(null);
  const [topPoolsByStored, setTopPoolsByStored] = useState<Array<TopPoolRow>>(
    [],
  );
  const [topPoolsByUsed, setTopPoolsByUsed] = useState<Array<TopPoolRow>>([]);

  /*
   * ClickHouse-backed sections (best-effort). The checks are null while
   * unread, or when this Ceph exports none (older than Quincy): the
   * cluster's row then says Ceph's verdict without them.
   */
  const [healthChecks, setHealthChecks] =
    useState<Array<CephHealthCheck> | null>(null);
  const [pgStats, setPgStats] = useState<PgStats | null>(null);
  const [pgStatesByPool, setPgStatesByPool] = useState<Map<
    string,
    CephPoolPgStates
  > | null>(null);
  const [capacity, setCapacity] = useState<CapacityStats | null>(null);

  // Shared time range for the golden charts.
  const [chartTimeRange, setChartTimeRange] =
    useState<RangeStartAndEndDateTime>({
      range: TimeRange.PAST_ONE_HOUR,
    });
  const [chartDateRange, setChartDateRange] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
  );

  const handleChartTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setChartTimeRange(newTimeRange);
    setChartDateRange(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  const fetchCluster: (
    showLoader: boolean,
  ) => Promise<CephCluster | null> = async (
    showLoader: boolean,
  ): Promise<CephCluster | null> => {
    const item: CephCluster | null = await ModelAPI.getItem({
      modelType: CephCluster,
      id: modelId,
      select: {
        name: true,
        description: true,
        fsid: true,
        otelCollectorStatus: true,
        lastSeenAt: true,
        cephVersion: true,
        agentVersion: true,
        healthStatus: true,
        monCount: true,
        osdCount: true,
        osdUpCount: true,
        osdInCount: true,
        poolCount: true,
        capacityUsedPercent: true,
      },
    });

    if (!item?.name) {
      /*
       * A missing or unreadable item comes back as null (the API answers
       * 404), and so does a momentary blip, so a transient one looks like
       * "not found". Only escalate that to a full-page error on the initial
       * load; a background tick keeps the current view.
       */
      if (showLoader) {
        setPageError("Cluster not found.");
      }
      return null;
    }

    setCluster(item);
    return item;
  };

  const fetchInventory: PromiseVoidFunction = async (): Promise<void> => {
    let rows: Array<CephResourceModel>;
    try {
      rows = await CephResourceUtils.fetchCephResources({
        cephClusterId: modelId,
        kinds: ["Osd", "Pool", "Mon"],
      });
    } catch (err) {
      // Said in Needs attention's frame, with Refresh; the rest stays.
      setInventoryError(API.getFriendlyMessage(err));
      setIsInventoryLoading(false);
      return;
    }
    const readAt: Date = OneUptimeDate.getCurrentDate();
    setInventoryRows(rows);
    setInventoryReadAt(readAt);
    setInventoryError("");
    setIsInventoryLoading(false);

    const matrix: OsdMatrix = {
      upIn: 0,
      upOut: 0,
      downIn: 0,
      downOut: 0,
      total: 0,
    };
    let quorum: number = 0;
    let monTotal: number = 0;
    const pools: Array<TopPoolRow> = [];

    for (const row of rows) {
      if (row.kind === "Osd") {
        matrix.total++;
        if (row.isUp && row.isIn) {
          matrix.upIn++;
        } else if (row.isUp && !row.isIn) {
          matrix.upOut++;
        } else if (!row.isUp && row.isIn) {
          matrix.downIn++;
        } else {
          matrix.downOut++;
        }
      } else if (row.kind === "Mon") {
        monTotal++;
        if (row.inQuorum) {
          quorum++;
        }
      } else if (row.kind === "Pool") {
        const readings: {
          storedBytes: number | null;
          usedPercent: number | null;
        } = getCephPoolReadings(row, readAt);
        pools.push({
          poolId: row.externalId || "",
          poolName: row.name || `pool ${row.externalId || ""}`,
          storedBytes: readings.storedBytes,
          usedPercent: readings.usedPercent,
        });
      }
    }

    setOsdMatrix(matrix.total > 0 ? matrix : null);
    setMonsTotal(monTotal > 0 ? monTotal : null);
    setMonsInQuorum(monTotal > 0 ? quorum : null);
    setTopPoolsByStored(
      [...pools]
        .filter((p: TopPoolRow) => {
          return p.storedBytes !== null;
        })
        .sort((a: TopPoolRow, b: TopPoolRow) => {
          return (b.storedBytes || 0) - (a.storedBytes || 0);
        })
        .slice(0, 5),
    );
    setTopPoolsByUsed(
      [...pools]
        .filter((p: TopPoolRow) => {
          return p.usedPercent !== null;
        })
        .sort((a: TopPoolRow, b: TopPoolRow) => {
          return (b.usedPercent || 0) - (a.usedPercent || 0);
        })
        .slice(0, 5),
    );
  };

  const fetchHealthChecks: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      /*
       * ceph_health_detail (one series per named check, value 1 while
       * raised) is exported by the mgr prometheus module on Quincy and
       * newer; without it the cluster's row says Ceph's verdict alone.
       */
      const readings: CephHealthCheckReadings =
        await loadCephHealthChecks(clusterName);
      setHealthChecks(readings.isExported ? readings.checks : null);
    } catch {
      // Best-effort: the cluster's row says Ceph's verdict without them.
    }
  };

  const fetchPgStats: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      /*
       * Per pool on recent releases (pool_id label), cluster-wide on older
       * ones (CephReadings sums the pools, or falls back).
       */
      const readings: CephPgStateReadings = await loadCephPgStates(clusterName);
      setPgStats(readings.totals);
      setPgStatesByPool(readings.byPool);
    } catch {
      // Best-effort: the PG card stays hidden, the pools' rows say the rest.
    }
  };

  const fetchCapacity: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveHours(
        endDate,
        -PROJECTION_WINDOW_HOURS,
      );

      const aggregateUsed: AggregatedResult =
        await AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: {
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              time: new InBetween(startDate, endDate),
              name: "ceph_cluster_total_used_bytes",
              attributes: {
                [CLUSTER_ATTR]: clusterName,
              } as Dictionary<string | number | boolean>,
            },
            aggregationType: AggregationType.Avg,
            aggregateColumnName: "value",
            aggregationTimestampColumnName: "time",
            startTimestamp: startDate,
            endTimestamp: endDate,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          },
        });

      type Sample = { t: number; v: number };
      const samples: Array<Sample> = [];
      for (const p of (aggregateUsed.data || []) as Array<AggregatedModel>) {
        const raw: unknown =
          p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
        const t: number =
          raw instanceof Date
            ? raw.getTime()
            : new Date(raw as string).getTime();
        const v: number = Number(p["value"]);
        if (Number.isFinite(t) && Number.isFinite(v)) {
          samples.push({ t, v });
        }
      }
      samples.sort((a: Sample, b: Sample) => {
        return a.t - b.t;
      });

      const latestTotal: CephLatestPerLabel = await loadCephLatestPerLabel({
        clusterName: clusterName,
        metricName: "ceph_cluster_total_bytes",
        labelAttribute: "",
      });
      const totalBytes: number | null = latestTotal.get("")?.value ?? null;
      const usedBytes: number | null =
        samples.length > 0 ? samples[samples.length - 1]!.v : null;
      const usedPercent: number | null =
        totalBytes !== null && usedBytes !== null && totalBytes > 0
          ? (usedBytes / totalBytes) * 100
          : null;

      /*
       * Least-squares linear fit of used bytes over the projection
       * window → growth in bytes/ms → "85% (nearfull) in ~N days".
       * Pure client math, no server-side forecasting (K8s raw-fetch
       * precedent). Shared with the per-pool projection (WI-29).
       */
      let daysToNearfull: number | null = null;
      if (totalBytes !== null && usedBytes !== null) {
        daysToNearfull = CephResourceUtils.linearGrowthDaysToTarget(
          samples,
          NEARFULL_RATIO * totalBytes,
        ).daysToTarget;
      }

      setCapacity({
        totalBytes: totalBytes,
        usedBytes: usedBytes,
        usedPercent: usedPercent,
        daysToNearfull: daysToNearfull,
      });
    } catch {
      // Best-effort — the tile falls back to the snapshot column.
    }
  };

  const fetchAll: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    setIsRefreshing(true);
    /*
     * Slide the relative chart window forward on every refresh so the
     * Golden Signals charts advance; a custom absolute range is returned
     * unchanged by getStartAndEndDate, so it stays pinned. Skipped on the
     * initial load (showLoader) — the state initializer just computed the
     * window and re-setting it would double-fetch every chart at mount.
     */
    if (!showLoader) {
      setChartDateRange(
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(chartTimeRange),
      );
    }
    if (showLoader) {
      setPageError("");
    }
    let item: CephCluster | null = null;
    try {
      item = await fetchCluster(showLoader);
    } catch (err) {
      /*
       * A background refresh keeps the existing data on screen; only the
       * initial load escalates a failure to a full-page error.
       */
      if (showLoader) {
        setPageError(API.getFriendlyMessage(err));
      }
      setIsRefreshing(false);
      setIsInitialLoading(false);
      return;
    }
    setIsInitialLoading(false);

    if (!showLoader) {
      setDetailsRefresher((prev: boolean) => {
        return !prev;
      });
    }

    // Inventory is Postgres-fast; failures only blank its sections.
    fetchInventory().catch(() => {});

    /*
     * Pull the ClickHouse-backed panels (health checks, PG stats, capacity)
     * here rather than from a name-keyed effect. The cluster name is stable
     * across refreshes, so a [cluster?.name] effect would never re-run on an
     * auto-refresh tick — these live time-series would silently freeze.
     * Driving them from fetchAll keeps every tick (and the manual button)
     * actually refreshing them.
     */
    if (item?.name) {
      // A healthy refresh clears any stale "not found" from a transient blip.
      setPageError("");
      fetchHealthChecks(item.name).catch(() => {});
      fetchPgStats(item.name).catch(() => {});
      fetchCapacity(item.name).catch(() => {});
    }

    setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchAll(true).catch((err: Error) => {
      setPageError(API.getFriendlyMessage(err));
    });
  }, []);

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "ceph-overview-auto-refresh-interval",
    onRefresh: (): void => {
      fetchAll(false).catch(() => {});
    },
  });

  const routes: CephPartRoutes = getCephPartRoutes(modelId);
  const osdsRoute: Route = routes.osdsRoute;

  const collectorStatus: string =
    (cluster?.otelCollectorStatus as string) || "";
  const isConnected: boolean =
    collectorStatus.toLowerCase() === "connected" ||
    collectorStatus.toLowerCase() === "active";

  /*
   * What needs attention, most urgent first (CephHealth): the same rules
   * the lists, an OSD's and a pool's page and the Topology use, so the
   * health pill, this list and a part's page can never disagree.
   */
  const attentionItems: Array<ResourceAttentionItem> = cluster
    ? getCephAttentionItems({
        rows: inventoryRows,
        cluster: {
          name: (cluster.name as string | undefined) || "",
          healthStatus:
            cluster.healthStatus === null || cluster.healthStatus === undefined
              ? null
              : Number(cluster.healthStatus),
          checks: healthChecks,
          capacityUsedPercent:
            cluster.capacityUsedPercent === null ||
            cluster.capacityUsedPercent === undefined
              ? null
              : Number(cluster.capacityUsedPercent),
        },
        pgStatesByPool: pgStatesByPool,
        routeFor: routes.getPartRoute,
        now: inventoryReadAt,
      })
    : [];
  const clusterHealth: ResourceHealth = getCephHealth(attentionItems);

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!cluster) {
      return null;
    }

    const status: string = collectorStatus;
    const lastSeenAt: Date | undefined = cluster.lastSeenAt;
    /*
     * One whole sentence either way: an English "never" in a translated
     * "Last seen {{time}}" would read in two languages at once.
     */
    const lastSeenText: string = lastSeenAt
      ? translator.translateTemplate("Last seen {{time}}", {
          // In the reader's language, as a part's page says it.
          time: formatRelativeTime({
            date: OneUptimeDate.fromString(lastSeenAt),
            now: new Date(),
            language: translator.language,
          }),
        })
      : translator.translateText("Never seen") || "Never seen";

    const displayName: string =
      (cluster.name as string | undefined) || tx("Untitled Ceph cluster");

    /*
     * The health is worked out from the cluster's last report, which goes
     * stale once the agent disconnects: "Healthy" beside "Disconnected"
     * would contradict it, so while the cluster is not connected the pill
     * says Health Unknown, in grey. A cluster that has reported neither a
     * verdict nor a part yet has no health to tell.
     */
    const showsHealth: boolean =
      !isInventoryLoading &&
      !inventoryError &&
      (inventoryRows.length > 0 ||
        (cluster.healthStatus !== null && cluster.healthStatus !== undefined));
    const healthLabel: string = getResourceHealthLabel({
      translator: translator,
      health: clusterHealth,
      isConnected: isConnected,
    });
    const healthBadgeClass: string = !isConnected
      ? "bg-gray-50 text-gray-600 ring-gray-200"
      : clusterHealth === "Healthy"
        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
        : clusterHealth === "Degraded"
          ? "bg-amber-50 text-amber-700 ring-amber-200"
          : "bg-red-50 text-red-700 ring-red-200";
    const healthDotClass: string = !isConnected
      ? "bg-gray-400"
      : clusterHealth === "Healthy"
        ? "bg-emerald-500"
        : clusterHealth === "Degraded"
          ? "bg-amber-500"
          : "bg-red-500";

    /*
     * The count chips open their list: the Overview's one step to the
     * OSDs, the monitors (the Daemons list) and the pools.
     */
    const specChips: Array<{
      icon: IconProp;
      label: string;
      route?: Route | undefined;
      testId?: string | undefined;
    }> = [];

    if (cluster.osdCount) {
      specChips.push({
        icon: IconProp.Disc,
        route: routes.osdsRoute,
        testId: "ceph-hero-osds",
        label: translator.translatePlural(
          { one: "{{up}}/{{count}} OSD up", other: "{{up}}/{{count}} OSDs up" },
          cluster.osdCount,
          { up: formatCount(cluster.osdUpCount || 0) },
        ),
      });
    }
    if (monsTotal !== null) {
      specChips.push({
        icon: IconProp.Eye,
        route: routes.daemonsRoute,
        testId: "ceph-hero-mons",
        label: translator.translatePlural(
          {
            one: "{{inQuorum}}/{{count}} mon in quorum",
            other: "{{inQuorum}}/{{count}} mons in quorum",
          },
          monsTotal,
          { inQuorum: formatCount(monsInQuorum || 0) },
        ),
      });
    } else if (cluster.monCount) {
      specChips.push({
        icon: IconProp.Eye,
        route: routes.daemonsRoute,
        testId: "ceph-hero-mons",
        label: translator.translatePlural(
          { one: "{{count}} mon", other: "{{count}} mons" },
          cluster.monCount,
        ),
      });
    }
    if (cluster.poolCount) {
      specChips.push({
        icon: IconProp.Database,
        route: routes.poolsRoute,
        testId: "ceph-hero-pools",
        label: translator.translatePlural(
          { one: "{{count}} pool", other: "{{count}} pools" },
          cluster.poolCount,
        ),
      });
    }
    // Every chip so far is a count; the Ceph version below is metadata.
    const hasCountChips: boolean = specChips.length > 0;
    if (cluster.cephVersion) {
      // The release, not the build's hash: the Details card has the rest.
      specChips.push({
        icon: IconProp.Info,
        label: getCephShortVersion(String(cluster.cephVersion)),
      });
    }

    const statusBadgeClass: string = isConnected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
    const statusDotClass: string = isConnected
      ? "bg-emerald-500"
      : "bg-amber-500";
    const statusLabel: string = getResourceConnectionLabel({
      translator: translator,
      isConnected: isConnected,
      status: status,
    });

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-red-50 via-white to-white"
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
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-red-200 shadow-sm">
                  <Icon
                    icon={IconProp.Database}
                    className="h-6 w-6 text-red-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {displayName}
                    </h1>
                    {/*
                     * Connected first, then the cluster's health, as every
                     * resource hero orders them: whether OneUptime hears
                     * from the cluster, then what it says.
                     */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                      />
                      {statusLabel}
                    </span>
                    {showsHealth ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          data-testid="ceph-hero-health"
                          data-health={isConnected ? clusterHealth : "Unknown"}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthBadgeClass}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${healthDotClass}`}
                          />
                          {healthLabel}
                        </span>
                        <InfoTooltip
                          label="Cluster health"
                          text={CEPH_METRIC_DESCRIPTIONS.health}
                        />
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                  {/*
                   * What the cluster is, in its owner's words: under its
                   * name, as every resource hero says it. It used to be a
                   * Description row of the Details card at the page's foot.
                   */}
                  <ResourceHeroDescription
                    text={cluster.description as string | undefined}
                  />
                  {cluster.fsid && (
                    <div className="mt-1 truncate font-mono text-sm text-gray-500">
                      {String(cluster.fsid)}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    {lastSeenText}
                  </div>
                </div>
              </div>
              <div
                data-testid={RESOURCE_HERO_CONTROLS_TEST_ID}
                className={RESOURCE_HERO_CONTROLS_CLASS_NAME}
              >
                <AutoRefreshControl
                  autoRefreshInterval={autoRefreshInterval}
                  onAutoRefreshIntervalChange={setAutoRefreshInterval}
                  onManualRefresh={(): void => {
                    fetchAll(false).catch(() => {});
                  }}
                  isRefreshing={isRefreshing}
                  lastRefreshedAt={lastRefreshedAt}
                />
              </div>
            </div>

            {specChips.length > 0 && (
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
                    return chip.route ? (
                      <Link
                        key={`spec-${idx}`}
                        to={chip.route}
                        dataTestId={chip.testId}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                      >
                        {content}
                      </Link>
                    ) : (
                      <span
                        key={`spec-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                      >
                        {content}
                      </span>
                    );
                  },
                )}
                {/*
                 * One (i) for the OSD, monitor and pool count chips; a row
                 * holding only the version chip is metadata and gets none.
                 */}
                {hasCountChips && (
                  <InfoTooltip
                    label="Cluster inventory counts"
                    text={CEPH_METRIC_DESCRIPTIONS.inventoryCounts}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderGoldenTiles: () => ReactElement = (): ReactElement => {
    if (!cluster) {
      return <Fragment />;
    }

    const usedPercent: number | null =
      capacity?.usedPercent ??
      (cluster.capacityUsedPercent !== null &&
      cluster.capacityUsedPercent !== undefined
        ? Number(cluster.capacityUsedPercent)
        : null);

    /*
     * How much of the raw capacity is used, and when the growth of the
     * last 24 hours takes it past the Cluster Near Full alert's line: each
     * one sentence in the reader's language.
     */
    const capacitySublabel: string = (() => {
      if (
        capacity?.usedBytes !== null &&
        capacity?.usedBytes !== undefined &&
        capacity?.totalBytes !== null &&
        capacity?.totalBytes !== undefined
      ) {
        const amounts: { used: string; total: string; nearfull: string } = {
          used: CephResourceUtils.formatBytes(capacity.usedBytes),
          total: CephResourceUtils.formatBytes(capacity.totalBytes),
          nearfull: `${CEPH_CLUSTER_NEARFULL_PERCENT}%`,
        };
        if (capacity.daysToNearfull === null) {
          return translator.translateTemplate("{{used}} of {{total}}", amounts);
        }
        if (capacity.daysToNearfull === 0) {
          return translator.translateTemplate(
            "{{used}} of {{total}} — above {{nearfull}} nearfull",
            amounts,
          );
        }
        if (!Number.isFinite(capacity.daysToNearfull)) {
          return translator.translateTemplate(
            "{{used}} of {{total}} — not growing",
            amounts,
          );
        }
        if (capacity.daysToNearfull > 365) {
          return translator.translateTemplate(
            "{{used}} of {{total}} — {{nearfull}} in >1 year",
            amounts,
          );
        }
        return translator.translateTemplate(
          "{{used}} of {{total}} — {{nearfull}} in ~{{days}}d at current growth",
          {
            ...amounts,
            days: formatCount(Math.max(1, capacity.daysToNearfull)),
          },
        );
      }
      return tx("of raw capacity");
    })();

    const osdTotal: number = cluster.osdCount || 0;
    const osdUp: number = cluster.osdUpCount || 0;
    const osdIn: number = cluster.osdInCount || 0;

    const pgProblemCount: number | null =
      pgStats === null
        ? null
        : (pgStats.degraded || 0) + (pgStats.undersized || 0);

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GoldenMetricTile
          title="Capacity Used"
          description={CEPH_METRIC_DESCRIPTIONS.capacityUsed}
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(usedPercent)}
          sublabel={capacitySublabel}
          percent={usedPercent}
          thresholds={{
            warn: CEPH_CLUSTER_NEARFULL_PERCENT,
            danger: CEPH_CLUSTER_FULL_PERCENT,
          }}
        />
        <GoldenMetricTile
          title="OSDs Up"
          description={CEPH_METRIC_DESCRIPTIONS.osdsUp}
          icon={IconProp.Database}
          iconColor="emerald"
          value={osdTotal > 0 ? `${osdUp}/${osdTotal}` : "—"}
          sublabel={
            osdTotal > 0
              ? translator.translateTemplate("{{in}} in", {
                  in: formatCount(osdIn),
                })
              : tx("object storage daemons")
          }
          percent={osdTotal > 0 ? (osdUp / osdTotal) * 100 : null}
          thresholds={{ warn: 100, danger: 90 }}
          higherIsBetter={true}
        />
        <GoldenMetricTile
          title="Mons In Quorum"
          description={CEPH_METRIC_DESCRIPTIONS.monsInQuorum}
          icon={IconProp.CheckCircle}
          iconColor="sky"
          value={
            monsTotal !== null
              ? `${monsInQuorum || 0}/${monsTotal}`
              : cluster.monCount
                ? String(cluster.monCount)
                : "—"
          }
          sublabel="monitor daemons"
        />
        <GoldenMetricTile
          title="Problem PGs"
          description={CEPH_METRIC_DESCRIPTIONS.problemPgs}
          icon={IconProp.Alert}
          iconColor="amber"
          value={formatInt(pgProblemCount)}
          sublabel={
            pgStats !== null
              ? translator.translateTemplate(
                  "{{degraded}} degraded, {{undersized}} undersized",
                  {
                    degraded: formatCount(pgStats.degraded),
                    undersized: formatCount(pgStats.undersized),
                  },
                )
              : tx("degraded + undersized")
          }
        />
      </div>
    );
  };

  /*
   * OSD up/in matrix — client-side join of the inventory's isUp × isIn
   * flags (themselves the latest ceph_osd_up × ceph_osd_in values per
   * daemon). down&in is the dangerous quadrant: data placement still
   * expects those OSDs.
   */
  const renderOsdMatrix: () => ReactElement = (): ReactElement => {
    if (!osdMatrix) {
      return <Fragment />;
    }

    const cells: Array<OsdStateCell> = buildOsdStateCells(osdMatrix);

    return (
      <div className="mb-6">
        <Card
          title={
            <CephMetricTitle
              title="OSD States"
              description={CEPH_METRIC_DESCRIPTIONS.osdStates}
            />
          }
          description={translator.translatePlural(
            {
              one: "Up/in matrix across {{count}} OSD.",
              other: "Up/in matrix across {{count}} OSDs.",
            },
            osdMatrix.total,
          )}
          rightElement={
            <Link
              to={osdsRoute}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-900"
            >
              {translator.translateText("View OSDs")}
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cells.map((cell: OsdStateCell): ReactElement => {
              return <OsdStateCellView key={cell.label} cell={cell} />;
            })}
          </div>
        </Card>
      </div>
    );
  };

  const renderPgDistribution: () => ReactElement = (): ReactElement => {
    if (!pgStats || pgStats.total === null || pgStats.total <= 0) {
      return <Fragment />;
    }

    const total: number = pgStats.total;
    const clean: number = pgStats.clean || 0;
    const degraded: number = pgStats.degraded || 0;
    const undersized: number = pgStats.undersized || 0;
    const other: number = Math.max(0, total - clean - degraded - undersized);

    /*
     * The bar draws its legend as it is given: the reader's words, and
     * placement groups' words - a degraded group is missing copies, which
     * the word on its own says of a slow service in some languages.
     */
    const segments: Array<StackedProgressBarSegment> = [
      {
        value: clean,
        color: "bg-emerald-500",
        label: tx("Active + Clean"),
      },
      {
        value: degraded,
        color: "bg-amber-500",
        label: tx("Degraded PGs"),
      },
      {
        value: undersized,
        color: "bg-orange-500",
        label: tx("Undersized PGs"),
      },
      {
        value: other,
        color: "bg-gray-400",
        label: tx("Other"),
      },
    ];

    return (
      <div className="mb-6">
        <Card
          title={
            <CephMetricTitle
              title="Placement Group States"
              description={CEPH_METRIC_DESCRIPTIONS.pgStates}
            />
          }
          description={translator.translatePlural(
            {
              one: "{{count}} placement group ({{active}} active).",
              other: "{{count}} placement groups ({{active}} active).",
            },
            Math.round(total),
            { active: formatCount(pgStats.active) },
          )}
        >
          <StackedProgressBar segments={segments} totalValue={total} />
        </Card>
      </div>
    );
  };

  const renderGoldenCharts: () => ReactElement = (): ReactElement => {
    if (!cluster?.name) {
      return <Fragment />;
    }

    const clusterName: string = cluster.name;

    // The charts draw their titles and legends as they are given.
    const capacityQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_used_bytes",
        title: tx("Capacity Used"),
        description: tx("Raw storage used across all OSDs (bytes)."),
        legend: tx("Used"),
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_cluster_total_used_bytes",
          attributes: {
            [CLUSTER_ATTR]: clusterName,
          },
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const latencyQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "osd_apply_latency",
        title: tx("Average OSD Apply Latency"),
        description: tx("Apply latency averaged across all OSDs (ms)."),
        legend: tx("Apply Latency"),
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_osd_apply_latency_ms",
          attributes: {
            [CLUSTER_ATTR]: clusterName,
          },
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const commitLatencyQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "osd_commit_latency",
        title: tx("Average OSD Commit Latency"),
        description: tx("Commit latency averaged across all OSDs (ms)."),
        legend: tx("Commit Latency"),
        legendUnit: "ms",
      },
      metricQueryData: {
        filterData: {
          metricName: "ceph_osd_commit_latency_ms",
          attributes: {
            [CLUSTER_ATTR]: clusterName,
          },
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    return (
      <div className="mb-6">
        <EmbeddedMetricCard
          title="Golden Signals"
          description="Capacity, client I/O, and OSD latency for this cluster."
          queryConfigs={[capacityQuery, latencyQuery, commitLatencyQuery]}
          timeRange={chartTimeRange}
          onTimeRangeChange={handleChartTimeRangeChange}
          startAndEndDate={chartDateRange}
        >
          {/*
           * Each rate chart's heading names the drag, revealed while the
           * pointer is over that chart (its named group): the card's
           * metric panels name it in their own headers, which these
           * charts do not have.
           */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="group/zoomhint">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                {translator.translateText("Client IOPS")}
                <InfoTooltip
                  label="Client IOPS"
                  text={CEPH_METRIC_DESCRIPTIONS.clientIops}
                />
                <TimeRangeZoomHint
                  revealOnHover={true}
                  className="ml-auto font-normal"
                />
              </div>
              <CephRateChart
                clusterName={clusterName}
                series={[
                  { metricName: "ceph_pool_rd", label: "Read" },
                  { metricName: "ceph_pool_wr", label: "Write" },
                ]}
                seriesKeyAttributes={["pool_id"]}
                startDate={chartDateRange.startValue}
                endDate={chartDateRange.endValue}
                heightInPx={220}
                syncId={`ceph-overview-${clusterName}`}
                emptyMessage="No client I/O reported in the selected time range."
              />
            </div>
            <div className="group/zoomhint">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                {translator.translateText("Client Throughput")}
                <InfoTooltip
                  label="Client Throughput"
                  text={CEPH_METRIC_DESCRIPTIONS.clientThroughput}
                />
                <TimeRangeZoomHint
                  revealOnHover={true}
                  className="ml-auto font-normal"
                />
              </div>
              <CephRateChart
                clusterName={clusterName}
                series={[
                  { metricName: "ceph_pool_rd_bytes", label: "Read" },
                  { metricName: "ceph_pool_wr_bytes", label: "Write" },
                ]}
                seriesKeyAttributes={["pool_id"]}
                startDate={chartDateRange.startValue}
                endDate={chartDateRange.endValue}
                yAxisUnit="By/s"
                heightInPx={220}
                syncId={`ceph-overview-${clusterName}`}
                emptyMessage="No throughput reported in the selected time range."
              />
            </div>
          </div>
        </EmbeddedMetricCard>
      </div>
    );
  };

  const renderTopPoolList: (list: TopPoolList) => ReactElement = (
    list: TopPoolList,
  ): ReactElement => {
    const rows: Array<TopPoolRow> = list.rows;
    return (
      <Card
        title={
          <CephMetricTitle title={list.title} description={list.tooltip} />
        }
        description={list.description}
      >
        {rows.length === 0 ? (
          <div
            className={`${CARD_GRID_CENTERED_STATE_CLASS_NAME} py-6 text-sm text-gray-500`}
          >
            {translator.translateText("No pools in the inventory yet.")}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {rows.map((row: TopPoolRow) => {
              const detailRoute: Route = RouteUtil.populateRouteParams(
                RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL] as Route,
                {
                  modelId: modelId,
                  subModelId: new ObjectID(row.poolId),
                },
              );
              return (
                <div
                  key={row.poolId}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <Link
                      to={detailRoute}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate block"
                    >
                      {row.poolName}
                    </Link>
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {list.renderValue(row)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  };

  const renderTopPools: () => ReactElement = (): ReactElement => {
    if (topPoolsByStored.length === 0 && topPoolsByUsed.length === 0) {
      return <Fragment />;
    }

    return (
      <CardGrid
        columns={2}
        cardWidth="narrow"
        className="!mb-6"
        dataTestId="ceph-top-pools"
      >
        {renderTopPoolList({
          title: "Largest Pools",
          description: "Top pools by stored bytes.",
          tooltip: CEPH_METRIC_DESCRIPTIONS.largestPools,
          rows: topPoolsByStored,
          renderValue: (row: TopPoolRow): string => {
            return CephResourceUtils.formatBytes(row.storedBytes);
          },
        })}
        {renderTopPoolList({
          title: "Fullest Pools",
          description:
            "Top pools by used capacity (stored / (stored + max avail)).",
          tooltip: CEPH_METRIC_DESCRIPTIONS.fullestPools,
          rows: topPoolsByUsed,
          renderValue: (row: TopPoolRow): string => {
            return formatPercent(row.usedPercent);
          },
        })}
      </CardGrid>
    );
  };

  if (isInitialLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }

  return (
    /*
     * The Golden Signals card is the page's only time series, and its range
     * is the page's (chartTimeRange): a drag on any of its charts - the
     * capacity and latency panels or the two rate charts - zooms that
     * range, and a double-click on any of them, or "Reset zoom" beside the
     * card's picker, puts it back. A zoom is a Custom range, so the
     * auto-refresh leaves it pinned (see fetchAll) and a reset returns to
     * the sliding preset.
     */
    <TimeRangeZoomScope
      timeRange={chartTimeRange}
      onTimeRangeChange={handleChartTimeRangeChange}
    >
      {renderHero()}

      {/* How to connect it, while it is not connected */}
      {cluster ? (
        <ResourceConnectionGuideCard
          status={cluster.otelCollectorStatus as string | undefined}
          lastSeenAt={cluster.lastSeenAt}
          guide={getCephClusterConnectionGuide(
            (cluster.name as string | undefined) || "",
            getConfiguredOneUptimeUrl(),
          )}
          documentationRoute={RouteUtil.populateRouteParams(
            RouteMap[PageMap.CEPH_CLUSTER_VIEW_DOCUMENTATION] as Route,
            { modelId: modelId },
          )}
        />
      ) : (
        <></>
      )}
      {/*
       * What needs someone, most urgent first - while the agent reports: a
       * disconnected cluster's last picture is no longer the truth, and the
       * hero says Health Unknown instead. A read that fails says so in the
       * card's frame, with Refresh.
       */}
      {inventoryError ? (
        <NeedsAttentionCard
          testId="ceph-needs-attention"
          items={[]}
          error={inventoryError}
          onRetry={(): void => {
            setIsInventoryLoading(true);
            fetchInventory().catch(() => {});
          }}
        />
      ) : isConnected && !isInventoryLoading ? (
        <NeedsAttentionCard
          testId="ceph-needs-attention"
          items={attentionItems}
        />
      ) : (
        <></>
      )}
      {renderGoldenTiles()}
      {renderOsdMatrix()}
      {renderPgDistribution()}
      {renderGoldenCharts()}
      {renderTopPools()}
      {/*
       * What the cluster reported about itself, and only that
       * (ResourceRecordDetailsCard): its name, description and when it was
       * last seen are the hero's, its labels the header's (a phone's own
       * card under this one). Edited on its Settings page, in the card of
       * the same title.
       */}
      <ResourceRecordDetailsCard<CephCluster>
        modelType={CephCluster}
        modelId={modelId}
        id="ceph-cluster-details"
        title="Ceph Cluster Details"
        refresher={detailsRefresher}
        settingsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CEPH_CLUSTER_VIEW_SETTINGS] as Route,
          { modelId: modelId },
        )}
        facts={[
          {
            field: {
              fsid: true,
            },
            title: "Cluster FSID",
            fieldType: FieldType.Text,
          },
          {
            field: {
              cephVersion: true,
            },
            title: "Ceph Version",
            fieldType: FieldType.Text,
          },
          {
            field: {
              agentVersion: true,
            },
            title: "Agent Version",
            fieldType: FieldType.Element,
            getElement: (item: CephCluster): ReactElement => {
              return (
                <AgentVersion
                  kind={AgentKind.CephAgent}
                  version={item.agentVersion}
                />
              );
            },
          },
        ]}
      />

      {/*
       * Last on the page: the Ceph AI agent's connection, whether AI may
       * investigate, and how fixes run, linking to AI → AI agent.
       */}
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.CephCluster)}
        resourceId={modelId}
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
      />
    </TimeRangeZoomScope>
  );
};

export default CephClusterOverview;
