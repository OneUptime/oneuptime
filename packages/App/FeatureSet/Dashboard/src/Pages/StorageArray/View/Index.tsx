import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayResource from "Common/Models/DatabaseModels/StorageArrayResource";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import EditInSettingsLink from "../../../Components/TelemetryResource/EditInSettingsLink";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import { getStorageArrayConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import StorageArrayResourceKind, {
  StorageArrayResourceKindUtil,
} from "Common/Types/StorageArray/StorageArrayResourceKind";
import StorageSystem, {
  StorageSystemUtil,
} from "Common/Types/StorageArray/StorageSystem";
import StorageArrayResourceUtils, {
  STORAGE_ARRAY_ATTRIBUTE,
  UNHEALTHY_RESOURCE_STATUSES,
} from "../Utils/StorageArrayResourceUtils";
import StorageArrayHealthPill, {
  StorageArrayHealthState,
  getStorageArrayHealthState,
} from "../../../Components/StorageArray/StorageArrayHealthPill";
import StorageArrayResourceStatusBadge from "../../../Components/StorageArray/StorageArrayResourceStatusBadge";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { STORAGE_ARRAY_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/StorageArrayMetricDescriptions";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
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
 * Storage array overview hero — the Ceph View/Index.tsx analog. Health,
 * capacity, data reduction and the alert and inventory counts ride the
 * StorageArray snapshot columns, and the unhealthy parts and top objects
 * the StorageArrayResource Postgres inventory (single-source with the
 * sidebar badges); ClickHouse is only touched for what Postgres cannot
 * answer: the open alerts behind the alert counts, and the golden charts.
 * Each section has its own loader so a slow ClickHouse never blanks the
 * Postgres-served hero (no Promise.all gating across sections).
 */

/*
 * The array endpoint is scraped every 60 seconds. An alert whose latest
 * series is more than a few scrapes older than the newest alert series has
 * closed — the array stopped exporting it.
 */
const ALERT_WINDOW_MINUTES: number = 10;
const ALERT_STALE_AFTER_MS: number = 3 * 60 * 1000;

const TOP_LIST_SIZE: number = 5;

interface ActiveAlertRow {
  key: string;
  severity: string;
  summary: string;
  code: string;
  component: string;
}

interface TopObjectRow {
  externalId: string;
  name: string;
  value: string;
}

const SEVERITY_ORDER: Array<string> = ["critical", "warning", "info"];

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const toNumberOrNull: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/*
 * A card or chart title followed by the (i) that says what its numbers
 * mean. Exported for the tooltip render tests.
 */
export interface StorageArrayMetricTitleProps {
  title: string;
  description: string;
}

export const StorageArrayMetricTitle: FunctionComponent<
  StorageArrayMetricTitleProps
> = (props: StorageArrayMetricTitleProps): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string = translator.translateText(props.title) as string;

  return (
    <span className="inline-flex items-center gap-1.5">
      {title}
      <InfoTooltip label={title} text={props.description} />
    </span>
  );
};

/*
 * The golden charts of a platform, from StorageArrayMetricCatalog: read and
 * write latency, IOPS and bandwidth drawn on one panel each, and capacity
 * used. Nothing for a platform OneUptime has no catalog for.
 */
export function getGoldenChartQueries(data: {
  storageSystem: string | null | undefined;
  arrayName: string;
}): Array<MetricQueryConfigData> {
  const prefix: string | null =
    data.storageSystem === StorageSystem.PureStorageFlashArray
      ? "purefa"
      : data.storageSystem === StorageSystem.PureStorageFlashBlade
        ? "purefb"
        : null;

  if (!prefix) {
    return [];
  }

  return StorageArrayResourceUtils.buildCatalogQueries([
    {
      metricId: `${prefix}-array-read-latency`,
      arrayName: data.arrayName,
      legend: "Read",
    },
    {
      metricId: `${prefix}-array-write-latency`,
      arrayName: data.arrayName,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: `${prefix}-array-read-iops`,
      arrayName: data.arrayName,
      legend: "Read",
    },
    {
      metricId: `${prefix}-array-write-iops`,
      arrayName: data.arrayName,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: `${prefix}-array-read-bandwidth`,
      arrayName: data.arrayName,
      legend: "Read",
    },
    {
      metricId: `${prefix}-array-write-bandwidth`,
      arrayName: data.arrayName,
      legend: "Write",
      overlayWithPreviousQuery: true,
    },
    {
      metricId: `${prefix}-array-space-utilization`,
      arrayName: data.arrayName,
    },
  ]);
}

/*
 * The alert series of a platform (one series per open alert, value 1);
 * both for an array whose platform is not known yet.
 */
export function getAlertMetricNames(
  storageSystem: string | null | undefined,
): Array<string> {
  if (storageSystem === StorageSystem.PureStorageFlashArray) {
    return ["purefa_alerts_open"];
  }
  if (storageSystem === StorageSystem.PureStorageFlashBlade) {
    return ["purefb_alerts_open"];
  }
  return ["purefa_alerts_open", "purefb_alerts_open"];
}

const StorageArrayOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [storageArray, setStorageArray] = useState<StorageArray | null>(null);
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
  const [unhealthyParts, setUnhealthyParts] = useState<
    Array<StorageArrayResource>
  >([]);
  const [slowestObjects, setSlowestObjects] = useState<Array<TopObjectRow>>([]);
  const [largestObjects, setLargestObjects] = useState<Array<TopObjectRow>>([]);

  // ClickHouse-backed sections (best-effort).
  const [activeAlerts, setActiveAlerts] = useState<Array<ActiveAlertRow>>([]);
  const [activeAlertsLoaded, setActiveAlertsLoaded] = useState<boolean>(false);

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

  const fetchStorageArray: (
    showLoader: boolean,
  ) => Promise<StorageArray | null> = async (
    showLoader: boolean,
  ): Promise<StorageArray | null> => {
    const item: StorageArray | null = await ModelAPI.getItem({
      modelType: StorageArray,
      id: modelId,
      select: {
        name: true,
        description: true,
        storageSystem: true,
        reportedName: true,
        systemId: true,
        osName: true,
        osVersion: true,
        otelCollectorStatus: true,
        lastSeenAt: true,
        agentVersion: true,
        capacityBytes: true,
        usedBytes: true,
        capacityUsedPercent: true,
        dataReductionRatio: true,
        openAlertCount: true,
        criticalAlertCount: true,
        warningAlertCount: true,
        volumeCount: true,
        hostCount: true,
        podCount: true,
        fileSystemCount: true,
        bucketCount: true,
        hardwareComponentCount: true,
        unhealthyHardwareCount: true,
        healthStatus: true,
      },
    });

    if (!item?.name) {
      /*
       * get-item returns 200 {} (never 404) for a momentarily-missing item,
       * so a transient blip looks like "not found". Only escalate that to a
       * full-page error on the initial load; a background tick keeps the
       * current view.
       */
      if (showLoader) {
        setPageError("Storage array not found.");
      }
      return null;
    }

    setStorageArray(item);
    return item;
  };

  /*
   * The worst of an object's read and write latency, or null when it has
   * not reported recently.
   */
  const worstLatency: (row: StorageArrayResource) => number | null = (
    row: StorageArrayResource,
  ): number | null => {
    const read: number | null = StorageArrayResourceUtils.freshMetricValue(
      row,
      row.readLatencyUsec,
    );
    const write: number | null = StorageArrayResourceUtils.freshMetricValue(
      row,
      row.writeLatencyUsec,
    );
    if (read === null && write === null) {
      return null;
    }
    return Math.max(read || 0, write || 0);
  };

  const fetchTopObjects: (
    kind: StorageArrayResourceKind,
    sortColumn: "readLatencyUsec" | "writeLatencyUsec" | "usedBytes",
  ) => Promise<Array<StorageArrayResource>> = async (
    kind: StorageArrayResourceKind,
    sortColumn: "readLatencyUsec" | "writeLatencyUsec" | "usedBytes",
  ): Promise<Array<StorageArrayResource>> => {
    /*
     * Twice the list's size: rows whose values went stale are dropped
     * after the fetch, and the list should still fill.
     */
    const result: ListResult<StorageArrayResource> =
      await ModelAPI.getList<StorageArrayResource>({
        modelType: StorageArrayResource,
        query: {
          storageArrayId: modelId,
          kind: kind,
        },
        skip: 0,
        limit: TOP_LIST_SIZE * 2,
        select: StorageArrayResourceUtils.INVENTORY_SELECT,
        sort: {
          [sortColumn]: SortOrder.Descending,
        },
      });
    return result.data;
  };

  const fetchInventory: (item: StorageArray) => Promise<void> = async (
    item: StorageArray,
  ): Promise<void> => {
    const kinds: Array<StorageArrayResourceKind> =
      StorageArrayResourceKindUtil.getKindsForSystem(item.storageSystem);

    /*
     * Hardware parts whose latest status needs a person, worst first.
     * Served by the inventory's status column, so the card agrees with
     * the Hardware page and the side menu's red badge.
     */
    const hardwareKinds: Array<StorageArrayResourceKind> = [
      StorageArrayResourceKind.Hardware,
      StorageArrayResourceKind.Drive,
      StorageArrayResourceKind.Controller,
    ].filter((kind: StorageArrayResourceKind): boolean => {
      return kinds.includes(kind);
    });

    if (hardwareKinds.length > 0) {
      const unhealthy: ListResult<StorageArrayResource> =
        await ModelAPI.getList<StorageArrayResource>({
          modelType: StorageArrayResource,
          query: {
            storageArrayId: modelId,
            kind: new Includes(hardwareKinds),
            status: new Includes([...UNHEALTHY_RESOURCE_STATUSES]),
          },
          skip: 0,
          limit: 50,
          select: StorageArrayResourceUtils.INVENTORY_SELECT,
          sort: {
            name: SortOrder.Ascending,
          },
        });

      setUnhealthyParts(
        [...unhealthy.data].sort(
          (a: StorageArrayResource, b: StorageArrayResource): number => {
            const aCritical: number =
              StorageArrayResourceUtils.isCriticalResourceStatus(a.status)
                ? 0
                : 1;
            const bCritical: number =
              StorageArrayResourceUtils.isCriticalResourceStatus(b.status)
                ? 0
                : 1;
            return aCritical - bCritical;
          },
        ),
      );
    } else {
      setUnhealthyParts([]);
    }

    // Volumes on a FlashArray, file systems on a FlashBlade.
    const topKind: StorageArrayResourceKind | null = kinds.includes(
      StorageArrayResourceKind.Volume,
    )
      ? StorageArrayResourceKind.Volume
      : kinds.includes(StorageArrayResourceKind.FileSystem)
        ? StorageArrayResourceKind.FileSystem
        : null;

    if (!topKind) {
      setSlowestObjects([]);
      setLargestObjects([]);
      return;
    }

    const [byReadLatency, byWriteLatency, byPhysical] = await Promise.all([
      fetchTopObjects(topKind, "readLatencyUsec"),
      fetchTopObjects(topKind, "writeLatencyUsec"),
      fetchTopObjects(topKind, "usedBytes"),
    ]);

    const slowest: Map<string, { row: StorageArrayResource; value: number }> =
      new Map();
    for (const row of [...byReadLatency, ...byWriteLatency]) {
      const latency: number | null = worstLatency(row);
      if (latency !== null && latency > 0) {
        slowest.set(row.externalId || "", { row: row, value: latency });
      }
    }

    setSlowestObjects(
      [...slowest.values()]
        .sort(
          (
            a: { row: StorageArrayResource; value: number },
            b: { row: StorageArrayResource; value: number },
          ): number => {
            return b.value - a.value;
          },
        )
        .slice(0, TOP_LIST_SIZE)
        .map(
          (entry: {
            row: StorageArrayResource;
            value: number;
          }): TopObjectRow => {
            return {
              externalId: entry.row.externalId || "",
              name: StorageArrayResourceUtils.displayNameForResource(entry.row),
              value: StorageArrayResourceUtils.formatLatencyUsec(entry.value),
            };
          },
        ),
    );

    setLargestObjects(
      byPhysical
        .filter((row: StorageArrayResource): boolean => {
          return (
            StorageArrayResourceUtils.freshMetricValue(row, row.usedBytes) !==
            null
          );
        })
        .slice(0, TOP_LIST_SIZE)
        .map((row: StorageArrayResource): TopObjectRow => {
          return {
            externalId: row.externalId || "",
            name: StorageArrayResourceUtils.displayNameForResource(row),
            value: StorageArrayResourceUtils.formatBytes(
              StorageArrayResourceUtils.freshMetricValue(row, row.usedBytes),
            ),
          };
        }),
    );
  };

  const fetchActiveAlerts: (item: StorageArray) => Promise<void> = async (
    item: StorageArray,
  ): Promise<void> => {
    try {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(
        endDate,
        -ALERT_WINDOW_MINUTES,
      );

      const rows: Array<Metric> = [];
      for (const metricName of getAlertMetricNames(item.storageSystem)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const queryOptions: any = {
          modelType: Metric,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!.toString(),
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              [STORAGE_ARRAY_ATTRIBUTE]: item.name || "",
            },
          },
          limit: 500,
          skip: 0,
          select: {
            time: true,
            value: true,
            attributes: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
          requestOptions: {},
        };

        const listResult: AnalyticsListResult<Metric> =
          await AnalyticsModelAPI.getList<Metric>(queryOptions);
        rows.push(...listResult.data);
      }

      /*
       * Results are time-descending, so the first row per alert is its
       * latest. An alert is still open when its latest series is as recent
       * as the newest alert series (a scrape or two of slack).
       */
      let newest: number = 0;
      const latestPerAlert: Map<
        string,
        { time: number; value: number; attrs: Record<string, unknown> }
      > = new Map();

      for (const metric of rows) {
        const attrs: Record<string, unknown> =
          (metric.attributes as Record<string, unknown>) || {};
        const time: number = metric.time
          ? new Date(metric.time as Date).getTime()
          : 0;
        newest = Math.max(newest, time);
        const key: string = [
          attrs["code"],
          attrs["component_name"] || attrs["component_type"],
          attrs["summary"],
          attrs["created"],
        ]
          .map((part: unknown): string => {
            return String(part ?? "");
          })
          .join("|");
        if (!latestPerAlert.has(key)) {
          latestPerAlert.set(key, {
            time: time,
            value: Number(metric.value),
            attrs: attrs,
          });
        }
      }

      const open: Array<ActiveAlertRow> = [];
      for (const [key, entry] of latestPerAlert.entries()) {
        const severity: string = String(entry.attrs["severity"] || "")
          .trim()
          .toLowerCase();
        if (severity === "hidden" || !(entry.value >= 1)) {
          continue;
        }
        if (newest - entry.time > ALERT_STALE_AFTER_MS) {
          continue;
        }
        open.push({
          key: key,
          severity: severity,
          summary: String(
            entry.attrs["summary"] || entry.attrs["issue"] || "",
          ).trim(),
          code: String(entry.attrs["code"] || "").trim(),
          component: String(
            entry.attrs["component_name"] ||
              entry.attrs["component_type"] ||
              "",
          ).trim(),
        });
      }

      open.sort((a: ActiveAlertRow, b: ActiveAlertRow): number => {
        const aRank: number = SEVERITY_ORDER.indexOf(a.severity);
        const bRank: number = SEVERITY_ORDER.indexOf(b.severity);
        const rankDiff: number =
          (aRank === -1 ? SEVERITY_ORDER.length : aRank) -
          (bRank === -1 ? SEVERITY_ORDER.length : bRank);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return a.summary.localeCompare(b.summary);
      });

      setActiveAlerts(open);
      setActiveAlertsLoaded(true);
    } catch {
      // Best-effort — the alerts card shows only the snapshot counts.
    }
  };

  const fetchAll: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    setIsRefreshing(true);
    /*
     * Slide the relative chart window forward on every refresh so the
     * golden charts advance; a custom absolute range is returned unchanged
     * by getStartAndEndDate, so it stays pinned. Skipped on the initial
     * load (showLoader) — the state initializer just computed the window
     * and re-setting it would double-fetch every chart at mount.
     */
    if (!showLoader) {
      setChartDateRange(
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(chartTimeRange),
      );
    }
    if (showLoader) {
      setPageError("");
    }
    let item: StorageArray | null = null;
    try {
      item = await fetchStorageArray(showLoader);
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

    if (item?.name) {
      // A healthy refresh clears any stale "not found" from a transient blip.
      setPageError("");
      // Inventory is Postgres-fast; failures only blank its sections.
      fetchInventory(item).catch(() => {});
      /*
       * Pulled here rather than from a name-keyed effect: the name is
       * stable across refreshes, so such an effect would never re-run on
       * an auto-refresh tick and the open alerts would freeze.
       */
      fetchActiveAlerts(item).catch(() => {});
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
    storageKey: "storage-array-overview-auto-refresh-interval",
    onRefresh: (): void => {
      fetchAll(false).catch(() => {});
    },
  });

  const getViewRoute: (pageKey: PageMap) => Route = (
    pageKey: PageMap,
  ): Route => {
    return RouteUtil.populateRouteParams(RouteMap[pageKey] as Route, {
      modelId: modelId,
    });
  };

  const isFlashBlade: boolean = StorageSystemUtil.isFlashBlade(
    storageArray?.storageSystem,
  );
  const isFlashArray: boolean = StorageSystemUtil.isFlashArray(
    storageArray?.storageSystem,
  );

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!storageArray) {
      return null;
    }

    const status: string = (storageArray.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = storageArray.lastSeenAt;
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : (translator.translateText("never") as string);

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    const displayName: string =
      (storageArray.name as string | undefined) ||
      (translator.translateText("Untitled storage array") as string);

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];

    if (isFlashArray) {
      if (storageArray.volumeCount !== undefined) {
        specChips.push({
          icon: IconProp.Disc,
          label: translator.translatePlural(
            { one: "{{count}} volume", other: "{{count}} volumes" },
            storageArray.volumeCount || 0,
          ),
        });
      }
      if (storageArray.hostCount !== undefined) {
        specChips.push({
          icon: IconProp.Server,
          label: translator.translatePlural(
            { one: "{{count}} host", other: "{{count}} hosts" },
            storageArray.hostCount || 0,
          ),
        });
      }
      if (storageArray.podCount) {
        specChips.push({
          icon: IconProp.Refresh,
          label: translator.translatePlural(
            { one: "{{count}} pod", other: "{{count}} pods" },
            storageArray.podCount,
          ),
        });
      }
    }
    if (isFlashBlade) {
      if (storageArray.fileSystemCount !== undefined) {
        specChips.push({
          icon: IconProp.Folder,
          label: translator.translatePlural(
            { one: "{{count}} file system", other: "{{count}} file systems" },
            storageArray.fileSystemCount || 0,
          ),
        });
      }
      if (storageArray.bucketCount !== undefined) {
        specChips.push({
          icon: IconProp.Archive,
          label: translator.translatePlural(
            { one: "{{count}} bucket", other: "{{count}} buckets" },
            storageArray.bucketCount || 0,
          ),
        });
      }
    }
    if (storageArray.hardwareComponentCount) {
      specChips.push({
        icon: IconProp.CPUChip,
        label: translator.translatePlural(
          {
            one: "{{count}} hardware component",
            other: "{{count}} hardware components",
          },
          storageArray.hardwareComponentCount,
        ),
      });
    }
    // Every chip so far is a count; the OS version below is metadata.
    const hasCountChips: boolean = specChips.length > 0;
    if (storageArray.osVersion) {
      specChips.push({
        icon: IconProp.Info,
        label: [storageArray.osName, storageArray.osVersion]
          .filter(Boolean)
          .join(" "),
      });
    }

    const statusBadgeClass: string = isConnected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
    const statusDotClass: string = isConnected
      ? "bg-emerald-500"
      : "bg-amber-500";
    const statusLabel: string = isConnected
      ? (translator.translateText("Connected") as string)
      : status === "disconnected" || !status
        ? (translator.translateText("Disconnected") as string)
        : status.charAt(0).toUpperCase() + status.slice(1);

    /*
     * The array's own name and system id, when the array reported them —
     * the name it goes by in Purity and Pure1, which can differ from the
     * name OneUptime knows it by (STORAGE_ARRAY_NAME on the agent).
     */
    const identity: string = [
      storageArray.reportedName &&
      storageArray.reportedName !== storageArray.name
        ? storageArray.reportedName
        : "",
      storageArray.systemId || "",
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-orange-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-orange-200 shadow-sm">
                  <Icon
                    icon={IconProp.StorageArray}
                    className="h-6 w-6 text-orange-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {displayName}
                    </h1>
                    <span className="inline-flex items-center gap-1">
                      <StorageArrayHealthPill
                        healthStatus={storageArray.healthStatus}
                        showHealthPrefix={true}
                      />
                      <InfoTooltip
                        label={
                          translator.translateText(
                            "Storage array health",
                          ) as string
                        }
                        text={STORAGE_ARRAY_METRIC_DESCRIPTIONS.health}
                      />
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                      />
                      {statusLabel}
                    </span>
                  </div>
                  {storageArray.storageSystem && (
                    <div className="mt-1 text-sm text-gray-600">
                      {StorageSystemUtil.getDisplayName(
                        storageArray.storageSystem,
                      )}
                    </div>
                  )}
                  {identity && (
                    <div className="mt-1 truncate font-mono text-sm text-gray-500">
                      {identity}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    {translator.translateTemplate("Last seen {{time}}", {
                      time: lastSeenText,
                    })}
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 md:self-start">
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
                {/*
                 * One (i) for the count chips; a row holding only the
                 * version chip is metadata and gets none.
                 */}
                {hasCountChips && (
                  <InfoTooltip
                    label={
                      translator.translateText(
                        "Storage array inventory counts",
                      ) as string
                    }
                    text={STORAGE_ARRAY_METRIC_DESCRIPTIONS.inventoryCounts}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  /*
   * "Why is this array unhealthy?" — the alerts the array itself still
   * reports as open, critical first. Shown while the snapshot counts any
   * open alert, so it never hides one the tiles count.
   */
  const renderActiveAlerts: () => ReactElement = (): ReactElement => {
    if (!storageArray || !storageArray.openAlertCount) {
      return <Fragment />;
    }

    return (
      <div className="mb-6">
        <Card
          title={
            <StorageArrayMetricTitle
              title="Active Alerts"
              description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.activeAlerts}
            />
          }
          description="Alerts the array raised itself and still reports as open — the reason behind its health."
        >
          {activeAlerts.length > 0 ? (
            <div className="divide-y divide-gray-200">
              {activeAlerts.map((alert: ActiveAlertRow) => {
                return (
                  <div
                    key={alert.key}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        {alert.summary || alert.code || alert.component}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {[
                          alert.code
                            ? translator.translateTemplate("Code {{code}}", {
                                code: alert.code,
                              })
                            : "",
                          alert.component,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <StorageArrayResourceStatusBadge
                      status={alert.severity || "unknown"}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              {activeAlertsLoaded
                ? translator.translateText(
                    "The array closed its alerts within the last few minutes; the counts update with its next report.",
                  )
                : translator.translateText(
                    "Alert details are unavailable right now. Open Pure1 or run purealert list on the array for the full list.",
                  )}
            </div>
          )}
        </Card>
      </div>
    );
  };

  const renderGoldenTiles: () => ReactElement = (): ReactElement => {
    if (!storageArray) {
      return <Fragment />;
    }

    const usedPercent: number | null = toNumberOrNull(
      storageArray.capacityUsedPercent,
    );
    const usedBytes: number | null = toNumberOrNull(storageArray.usedBytes);
    const capacityBytes: number | null = toNumberOrNull(
      storageArray.capacityBytes,
    );
    const dataReduction: number | null = toNumberOrNull(
      storageArray.dataReductionRatio,
    );

    const capacitySublabel: string =
      usedBytes !== null && capacityBytes !== null
        ? translator.translateTemplate("{{used}} of {{total}}", {
            used: StorageArrayResourceUtils.formatBytes(usedBytes),
            total: StorageArrayResourceUtils.formatBytes(capacityBytes),
          })
        : (translator.translateText("of usable capacity") as string);

    const openAlerts: number | undefined = storageArray.openAlertCount;
    const hardwareTotal: number | undefined =
      storageArray.hardwareComponentCount;
    const unhealthyHardware: number | undefined =
      storageArray.unhealthyHardwareCount;

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <GoldenMetricTile
          title={translator.translateText("Capacity Used") as string}
          description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.capacityUsed}
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={formatPercent(usedPercent)}
          sublabel={capacitySublabel}
          percent={usedPercent}
          thresholds={{ warn: 80, danger: 90 }}
        />
        <GoldenMetricTile
          title={translator.translateText("Data Reduction") as string}
          description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.dataReduction}
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={StorageArrayResourceUtils.formatRatio(dataReduction)}
          sublabel={translator.translateText("deduplication and compression")}
        />
        <GoldenMetricTile
          title={translator.translateText("Open Alerts") as string}
          description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.openAlerts}
          icon={IconProp.Alert}
          iconColor="amber"
          value={
            openAlerts === null || openAlerts === undefined
              ? "—"
              : String(openAlerts)
          }
          sublabel={translator.translateTemplate(
            "{{critical}} critical, {{warning}} warning",
            {
              critical: storageArray.criticalAlertCount || 0,
              warning: storageArray.warningAlertCount || 0,
            },
          )}
        />
        <GoldenMetricTile
          title={translator.translateText("Unhealthy Hardware") as string}
          description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.unhealthyHardware}
          icon={IconProp.CPUChip}
          iconColor="emerald"
          value={
            unhealthyHardware === null || unhealthyHardware === undefined
              ? "—"
              : String(unhealthyHardware)
          }
          sublabel={
            hardwareTotal
              ? translator.translatePlural(
                  {
                    one: "of {{count}} component",
                    other: "of {{count}} components",
                  },
                  hardwareTotal,
                )
              : translator.translateText("hardware components")
          }
        />
        {isFlashBlade ? (
          <GoldenMetricTile
            title={translator.translateText("File Systems") as string}
            description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.fileSystemsTile}
            icon={IconProp.Folder}
            iconColor="sky"
            value={
              storageArray.fileSystemCount === null ||
              storageArray.fileSystemCount === undefined
                ? "—"
                : String(storageArray.fileSystemCount)
            }
            sublabel={translator.translatePlural(
              { one: "{{count}} bucket", other: "{{count}} buckets" },
              storageArray.bucketCount || 0,
            )}
          />
        ) : (
          <GoldenMetricTile
            title={translator.translateText("Volumes") as string}
            description={STORAGE_ARRAY_METRIC_DESCRIPTIONS.volumesTile}
            icon={IconProp.Disc}
            iconColor="sky"
            value={
              storageArray.volumeCount === null ||
              storageArray.volumeCount === undefined
                ? "—"
                : String(storageArray.volumeCount)
            }
            sublabel={translator.translatePlural(
              { one: "{{count}} host", other: "{{count}} hosts" },
              storageArray.hostCount || 0,
            )}
          />
        )}
      </div>
    );
  };

  const renderUnhealthyHardware: () => ReactElement = (): ReactElement => {
    if (unhealthyParts.length === 0) {
      return <Fragment />;
    }

    return (
      <div className="mb-6">
        <Card
          title={
            <StorageArrayMetricTitle
              title="Hardware Needing Attention"
              description={
                STORAGE_ARRAY_METRIC_DESCRIPTIONS.unhealthyHardwareList
              }
            />
          }
          description={translator.translatePlural(
            {
              one: "{{count}} part reports a status that needs a person.",
              other: "{{count}} parts report a status that needs a person.",
            },
            unhealthyParts.length,
          )}
          rightElement={
            <Link
              to={getViewRoute(PageMap.STORAGE_ARRAY_VIEW_HARDWARE)}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-900"
            >
              {translator.translateText("View Hardware")}
            </Link>
          }
        >
          <div className="divide-y divide-gray-200">
            {unhealthyParts.map((part: StorageArrayResource) => {
              return (
                <div
                  key={`${part.kind}-${part.externalId}`}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-medium text-gray-900">
                      {StorageArrayResourceUtils.displayNameForResource(part)}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {[
                        translator.translateText(
                          StorageArrayResourceKindUtil.getSingularLabel(
                            part.kind as StorageArrayResourceKind,
                          ),
                        ),
                        part.componentType || "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <StorageArrayResourceStatusBadge status={part.status} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  };

  const renderGoldenCharts: () => ReactElement = (): ReactElement => {
    if (!storageArray?.name) {
      return <Fragment />;
    }

    const queryConfigs: Array<MetricQueryConfigData> = getGoldenChartQueries({
      storageSystem: storageArray.storageSystem,
      arrayName: storageArray.name,
    });

    if (queryConfigs.length === 0) {
      return <Fragment />;
    }

    return (
      <div className="mb-6">
        <EmbeddedMetricCard
          title="Golden Signals"
          description="Read and write latency, IOPS and bandwidth as hosts see them, and capacity used, for this array."
          queryConfigs={queryConfigs}
          timeRange={chartTimeRange}
          onTimeRangeChange={handleChartTimeRangeChange}
          startAndEndDate={chartDateRange}
        />
      </div>
    );
  };

  const renderTopList: (data: {
    title: string;
    description: string;
    tooltip: string;
    rows: Array<TopObjectRow>;
    detailPageKey: PageMap;
  }) => ReactElement = (data: {
    title: string;
    description: string;
    tooltip: string;
    rows: Array<TopObjectRow>;
    detailPageKey: PageMap;
  }): ReactElement => {
    return (
      <Card
        title={
          <StorageArrayMetricTitle
            title={data.title}
            description={data.tooltip}
          />
        }
        description={data.description}
      >
        {data.rows.length === 0 ? (
          <div className="text-sm text-gray-500">
            {translator.translateText(
              "Nothing has reported recently enough to rank.",
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {data.rows.map((row: TopObjectRow) => {
              const detailRoute: Route = RouteUtil.populateRouteParams(
                RouteMap[data.detailPageKey] as Route,
                {
                  modelId: modelId,
                  subModelId:
                    StorageArrayResourceUtils.routeParamFromExternalId(
                      row.externalId,
                    ),
                },
              );
              return (
                <div
                  key={row.externalId}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <Link
                      to={detailRoute}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate block"
                    >
                      {row.name}
                    </Link>
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {row.value}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  };

  const renderTopObjects: () => ReactElement = (): ReactElement => {
    if (slowestObjects.length === 0 && largestObjects.length === 0) {
      return <Fragment />;
    }

    if (isFlashBlade) {
      return (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {renderTopList({
            title: "Slowest File Systems",
            description: "File systems with the highest read or write latency.",
            tooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.slowestFileSystems,
            rows: slowestObjects,
            detailPageKey: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
          })}
          {renderTopList({
            title: "Largest File Systems",
            description: "File systems using the most flash.",
            tooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.largestFileSystems,
            rows: largestObjects,
            detailPageKey: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
          })}
        </div>
      );
    }

    return (
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {renderTopList({
          title: "Slowest Volumes",
          description: "Volumes with the highest read or write latency.",
          tooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.slowestVolumes,
          rows: slowestObjects,
          detailPageKey: PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
        })}
        {renderTopList({
          title: "Largest Volumes",
          description: "Volumes using the most flash after data reduction.",
          tooltip: STORAGE_ARRAY_METRIC_DESCRIPTIONS.largestVolumes,
          rows: largestObjects,
          detailPageKey: PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
        })}
      </div>
    );
  };

  const renderQuickLink: (data: {
    pageKey: PageMap;
    title: string;
    description: string;
  }) => ReactElement = (data: {
    pageKey: PageMap;
    title: string;
    description: string;
  }): ReactElement => {
    return (
      <Link
        key={data.pageKey}
        to={getViewRoute(data.pageKey)}
        className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
      >
        <div className="text-sm font-semibold text-gray-900">
          {translator.translateText(data.title)}
        </div>
        <div className="text-xs text-gray-500">
          {translator.translateText(data.description)}
        </div>
      </Link>
    );
  };

  const renderQuickLinks: () => ReactElement = (): ReactElement => {
    const links: Array<ReactElement> = [];

    if (isFlashArray) {
      links.push(
        renderQuickLink({
          pageKey: PageMap.STORAGE_ARRAY_VIEW_VOLUMES,
          title: "Volumes",
          description: "Block volumes with their size, latency and IOPS.",
        }),
        renderQuickLink({
          pageKey: PageMap.STORAGE_ARRAY_VIEW_HOSTS,
          title: "Hosts",
          description: "Hosts with their path redundancy and volumes.",
        }),
      );
    }

    if (isFlashBlade) {
      links.push(
        renderQuickLink({
          pageKey: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS,
          title: "File Systems",
          description: "NFS and SMB file systems with their space and latency.",
        }),
        renderQuickLink({
          pageKey: PageMap.STORAGE_ARRAY_VIEW_BUCKETS,
          title: "Buckets",
          description: "S3 buckets with their quota, space and objects.",
        }),
      );
    }

    if (isFlashArray || isFlashBlade) {
      links.push(
        renderQuickLink({
          pageKey: PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
          title: "Hardware",
          description: "Components, drives and controllers with their status.",
        }),
      );
    }

    links.push(
      renderQuickLink({
        pageKey: PageMap.STORAGE_ARRAY_VIEW_METRICS,
        title: "Metrics",
        description: "Explore every metric this array reports.",
      }),
    );

    return (
      <Card
        title="Quick Links"
        description="Jump to key views for this storage array."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {links}
        </div>
      </Card>
    );
  };

  if (isInitialLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage message={pageError} />;
  }

  const health: StorageArrayHealthState = getStorageArrayHealthState(
    storageArray?.healthStatus,
  );

  return (
    /*
     * The Golden Signals card is the page's only time series, and its range
     * is the page's (chartTimeRange): a drag on any of its charts zooms that
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
      {storageArray ? (
        <ResourceConnectionGuideCard
          status={storageArray.otelCollectorStatus as string | undefined}
          lastSeenAt={storageArray.lastSeenAt}
          guide={getStorageArrayConnectionGuide(
            (storageArray.name as string | undefined) || "",
          )}
          documentationRoute={getViewRoute(
            PageMap.STORAGE_ARRAY_VIEW_DOCUMENTATION,
          )}
        />
      ) : (
        <></>
      )}
      {health !== StorageArrayHealthState.Ok ? renderActiveAlerts() : <></>}
      {renderGoldenTiles()}
      {renderUnhealthyHardware()}
      {renderGoldenCharts()}
      {renderTopObjects()}
      <div className="mb-6">{renderQuickLinks()}</div>
      <CardModelDetail<StorageArray>
        name="Storage Array Details"
        refresher={detailsRefresher}
        cardProps={{
          title: "Storage Array Details",
          // Edited in one place: the same card on the array's Settings page.
          buttons: [
            <EditInSettingsLink
              key="edit-in-settings"
              to={getViewRoute(PageMap.STORAGE_ARRAY_VIEW_SETTINGS)}
            />,
          ],
        }}
        modelDetailProps={{
          modelType: StorageArray,
          id: "storage-array-details",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.name);
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                storageSystem: true,
              },
              title: "Platform",
              fieldType: FieldType.Element,
              getElement: (item: StorageArray): ReactElement => {
                return (
                  <span>
                    {StorageSystemUtil.getDisplayName(item.storageSystem)}
                  </span>
                );
              },
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.storageSystem);
              },
            },
            {
              field: {
                reportedName: true,
              },
              title: "Name on the Array",
              fieldType: FieldType.Text,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.reportedName);
              },
            },
            {
              field: {
                systemId: true,
              },
              title: "System ID",
              fieldType: FieldType.Text,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.systemId);
              },
            },
            {
              field: {
                osName: true,
              },
              title: "Operating System",
              fieldType: FieldType.Text,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.osName);
              },
            },
            {
              field: {
                osVersion: true,
              },
              title: "Operating System Version",
              fieldType: FieldType.Text,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.osVersion);
              },
            },
            {
              field: {
                otelCollectorStatus: true,
              },
              title: "Collector Status",
              fieldType: FieldType.Text,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.otelCollectorStatus);
              },
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.lastSeenAt);
              },
            },
            {
              field: {
                agentVersion: true,
              },
              title: "Agent Version",
              fieldType: FieldType.Text,
              placeholder: "Not reported",
              showIf: (item: StorageArray): boolean => {
                return Boolean(item.agentVersion);
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
              getElement: (item: StorageArray): ReactElement => {
                return (
                  <LabelsElement labels={item["labels"] as Array<Label>} />
                );
              },
              showIf: (item: StorageArray): boolean => {
                const labels: Array<Label> | undefined =
                  (item.labels as Array<Label> | undefined) ?? undefined;
                return Array.isArray(labels) && labels.length > 0;
              },
            },
          ],
        }}
      />
    </TimeRangeZoomScope>
  );
};

export default StorageArrayOverview;
