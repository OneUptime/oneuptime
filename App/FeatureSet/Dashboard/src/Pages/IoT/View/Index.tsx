import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import IoTDeviceModel from "Common/Models/DatabaseModels/IoTDevice";
import Card from "Common/UI/Components/Card/Card";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
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
import GoldenMetricTile from "../../../Components/Infrastructure/GoldenMetricTile";
import {
  fetchIoTInventoryRows,
  routeParamFromExternalId,
  displayNameForDevice,
  METRIC_STALE_MS,
} from "../Utils/IoTDeviceUtils";

interface GoldenStats {
  /* Latest-window aggregates across the device series in the fleet. */
  onlineDevices: number | null;
  totalDevices: number | null;
  avgBatteryPercent: number | null;
  avgSignalDbm: number | null;
}

interface AtRiskDevice {
  externalId: string;
  name: string;
  reasons: Array<string>;
  /* true = drives the red (offline) treatment, false = amber (warning). */
  isCritical: boolean;
}

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const formatDbm: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(0)} dBm`;
};

/*
 * Thresholds that drive the "at risk" device list and the battery/
 * signal tile coloring. Match the default IoT alert templates
 * (lowBattery < 20%, weakSignal < -100 dBm).
 */
const LOW_BATTERY_PERCENT: number = 20;
const WEAK_SIGNAL_DBM: number = -100;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "iot-overview-auto-refresh-interval";

const IoTFleetOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [fleet, setFleet] = useState<IoTFleet | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Golden metrics state — aggregated from ClickHouse.
  const [goldenStats, setGoldenStats] = useState<GoldenStats | null>(null);
  const [isGoldenLoading, setIsGoldenLoading] = useState<boolean>(true);
  const [goldenError, setGoldenError] = useState<string>("");

  // At-risk device list — derived from the Postgres inventory (instant).
  const [atRiskDevices, setAtRiskDevices] = useState<Array<AtRiskDevice>>([]);
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);

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

  /*
   * At-risk devices come from the IoTDevice Postgres inventory — the
   * same rows the sidebar badge counts, so the page never drifts from
   * the badges. Offline devices are critical (red); low battery / weak
   * signal are warnings (amber). Stale metric values are ignored so a
   * device that has fallen off the stream isn't flagged on old numbers.
   */
  const loadInventory: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const rows: Array<IoTDeviceModel> = await fetchIoTInventoryRows({
        iotFleetId: modelId,
      });

      const now: number = Date.now();
      const atRisk: Array<AtRiskDevice> = [];

      for (const row of rows) {
        /*
         * Archived devices are user-hidden and Retired devices are
         * history — pinning either as critical "Offline" forever
         * would poison the at-risk list and drift from the badge
         * counts (which exclude both).
         */
        if (row.isArchived === true || (row.state as string) === "Retired") {
          continue;
        }

        const name: string = displayNameForDevice(row);
        const externalId: string = row.externalId || "";
        const reasons: Array<string> = [];
        let isCritical: boolean = false;

        const state: string | undefined = row.state as string | undefined;
        if (
          state === "Offline" ||
          (state === undefined && row.isUp === false) ||
          (state === null && row.isUp === false)
        ) {
          reasons.push("Offline");
          isCritical = true;
        } else if (state === "Stale") {
          reasons.push("Stale — no data past threshold");
        }

        const metricsFresh: boolean = row.metricsUpdatedAt
          ? now - new Date(row.metricsUpdatedAt as Date).getTime() <=
            METRIC_STALE_MS
          : false;

        if (metricsFresh) {
          if (
            row.latestBatteryPercent !== null &&
            row.latestBatteryPercent !== undefined &&
            Number(row.latestBatteryPercent) < LOW_BATTERY_PERCENT
          ) {
            reasons.push(
              `Battery ${Number(row.latestBatteryPercent).toFixed(0)}%`,
            );
          }
          if (
            row.latestSignalStrengthDbm !== null &&
            row.latestSignalStrengthDbm !== undefined &&
            Number(row.latestSignalStrengthDbm) < WEAK_SIGNAL_DBM
          ) {
            reasons.push(
              `Signal ${Number(row.latestSignalStrengthDbm).toFixed(0)} dBm`,
            );
          }
        }

        if (reasons.length > 0) {
          atRisk.push({ externalId, name, reasons, isCritical });
        }
      }

      // Critical (offline) devices first, then by name for a stable list.
      atRisk.sort((a: AtRiskDevice, b: AtRiskDevice): number => {
        if (a.isCritical !== b.isCritical) {
          return a.isCritical ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      setAtRiskDevices(atRisk);
    } catch {
      // At-risk list is supplementary — keep it empty on failure.
    } finally {
      setIsInventoryLoading(false);
    }
  };

  /*
   * Golden fleet metrics — aggregated across the device series for the
   * selected time range, grouped by device.id. iot_device_up is a 0/1
   * gauge per device (online = latest value >= 1); battery/signal tiles
   * average the latest value of each reporting device.
   */
  const loadGoldenMetrics: (fleetName: string) => Promise<void> = async (
    fleetName: string,
  ): Promise<void> => {
    setIsRefreshing(true);
    setGoldenError("");
    try {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const startDate: Date = dateRange.startValue;
      const endDate: Date = dateRange.endValue;
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      const baseAttributes: Record<string, string> = {
        "resource.iot.fleet.name": fleetName,
      };

      const buildAggregateBy: (
        metricName: string,
        aggType: AggregationType,
      ) => AggregateBy<Metric> = (
        metricName: string,
        aggType: AggregationType,
      ): AggregateBy<Metric> => {
        return {
          query: {
            projectId: projectId,
            time: new InBetween<Date>(startDate, endDate),
            name: metricName,
            attributes: { ...baseAttributes },
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
          // Grouping by attributes preserves the device.id dimension.
          groupBy: { attributes: true },
        };
      };

      const [upResult, batteryResult, signalResult]: [
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
      ] = await Promise.all([
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy("iot_device_up", AggregationType.Max),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "iot_battery_percent",
            AggregationType.Avg,
          ),
        }),
        AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: buildAggregateBy(
            "iot_signal_strength_dbm",
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

      const getDeviceId: (p: AggregatedModel) => string = (
        p: AggregatedModel,
      ): string => {
        const attrs: Record<string, unknown> =
          (p["attributes"] as Record<string, unknown>) || {};
        return (
          (attrs["device.id"] as string) || (attrs["device_id"] as string) || ""
        );
      };

      /*
       * For each device.id, keep the value at the latest bucket within
       * the window — the "current" reading we tile.
       */
      const latestPerDevice: (
        result: AggregatedResult,
      ) => Map<string, number> = (
        result: AggregatedResult,
      ): Map<string, number> => {
        const latestTs: Map<string, number> = new Map();
        const out: Map<string, number> = new Map();
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const id: string = getDeviceId(p);
          if (!id) {
            continue;
          }
          const t: number = getBucketTimestamp(p);
          const v: number = Number(p["value"]);
          if (!Number.isFinite(t) || !Number.isFinite(v)) {
            continue;
          }
          const prev: number | undefined = latestTs.get(id);
          if (prev === undefined || t > prev) {
            latestTs.set(id, t);
            out.set(id, v);
          }
        }
        return out;
      };

      const mean: (values: Iterable<number>) => number | null = (
        values: Iterable<number>,
      ): number | null => {
        let sum: number = 0;
        let count: number = 0;
        for (const v of values) {
          sum += v;
          count++;
        }
        return count > 0 ? sum / count : null;
      };

      const upByDevice: Map<string, number> = latestPerDevice(upResult);
      const totalDevices: number = upByDevice.size;
      let onlineDevices: number = 0;
      for (const v of upByDevice.values()) {
        if (v >= 1) {
          onlineDevices++;
        }
      }

      const batteryByDevice: Map<string, number> =
        latestPerDevice(batteryResult);
      const signalByDevice: Map<string, number> = latestPerDevice(signalResult);

      setGoldenStats({
        onlineDevices: totalDevices > 0 ? onlineDevices : null,
        totalDevices: totalDevices > 0 ? totalDevices : null,
        avgBatteryPercent: mean(batteryByDevice.values()),
        avgSignalDbm: mean(signalByDevice.values()),
      });

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
   * (timeRange / fleet name) without tearing the timer down on every
   * render.
   */
  const loadGoldenMetricsRef: React.MutableRefObject<
    (fleetName: string) => Promise<void>
  > = useRef<(fleetName: string) => Promise<void>>(loadGoldenMetrics);
  loadGoldenMetricsRef.current = loadGoldenMetrics;

  const fetchFleet: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: IoTFleet | null = await ModelAPI.getItem({
        modelType: IoTFleet,
        id: modelId,
        select: {
          name: true,
          description: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentVersion: true,
          deviceCount: true,
          onlineDeviceCount: true,
        },
      });
      setFleet(item);
      setIsLoading(false);

      if (item?.name) {
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
    fetchFleet().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  // Re-fetch golden metrics whenever the user picks a different range.
  useEffect(() => {
    if (fleet?.name) {
      void loadGoldenMetricsRef.current(fleet.name);
    }
  }, [timeRange]);

  useEffect(() => {
    const ms: number | null = getAutoRefreshIntervalInMs(autoRefreshInterval);
    if (ms === null) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      if (fleet?.name) {
        void loadGoldenMetricsRef.current(fleet.name);
        void loadInventory();
      }
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshInterval, fleet?.name]);

  const onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void = (
    interval: AutoRefreshInterval,
  ): void => {
    setAutoRefreshInterval(interval);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(REFRESH_STORAGE_KEY, interval);
    }
  };

  const onManualRefresh: () => void = (): void => {
    if (fleet?.name) {
      void loadGoldenMetricsRef.current(fleet.name);
      void loadInventory();
    }
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!fleet) {
    return <ErrorMessage message="Fleet not found." />;
  }

  const totalDevices: number =
    goldenStats?.totalDevices ?? fleet.deviceCount ?? 0;
  const onlineDevices: number =
    goldenStats?.onlineDevices ?? fleet.onlineDeviceCount ?? 0;
  const onlinePct: number | null =
    totalDevices > 0 ? (onlineDevices / totalDevices) * 100 : null;

  const navigateToDevice: (externalId: string) => void = (
    externalId: string,
  ): void => {
    if (!externalId) {
      return;
    }
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.IOT_FLEET_VIEW_DEVICE_DETAIL] as Route,
        {
          modelId: modelId,
          subModelId: routeParamFromExternalId(externalId),
        },
      ),
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
    const status: string = (fleet.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = fleet.lastSeenAt;
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : "never";

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    const displayName: string =
      (fleet.name as string | undefined) || "Untitled IoT fleet";

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

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];
    if (totalDevices > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: `${onlineDevices}/${totalDevices} device${
          totalDevices === 1 ? "" : "s"
        } online`,
      });
    }
    if (fleet.agentVersion) {
      specChips.push({
        icon: IconProp.Terminal,
        label: `Agent ${String(fleet.agentVersion)}`,
      });
    }

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-blue-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-blue-200 shadow-sm">
                  <Icon icon={IconProp.IoT} className="h-6 w-6 text-blue-600" />
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
                  </div>
                  {fleet.description && (
                    <div className="mt-1 truncate text-sm text-gray-500">
                      {String(fleet.description)}
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
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_: unknown, idx: number) => {
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

    const batteryPct: number | null = s.avgBatteryPercent;
    /*
     * Signal strength is negative dBm (-30 strong, -120 weak). Map it
     * onto a 0..100 bar so stronger reads greener: clamp [-120, -30].
     */
    const signalPercent: number | null =
      s.avgSignalDbm === null
        ? null
        : Math.min(
            100,
            Math.max(0, ((s.avgSignalDbm - -120) / (-30 - -120)) * 100),
          );

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GoldenMetricTile
          title="Online Devices"
          icon={IconProp.Heartbeat}
          iconColor="emerald"
          value={onlinePct === null ? "—" : `${onlineDevices}/${totalDevices}`}
          sublabel="devices reporting up"
          percent={onlinePct}
          thresholds={{ warn: 99, danger: 75 }}
          higherIsBetter={true}
        />
        <GoldenMetricTile
          title="Total Devices"
          icon={IconProp.Cube}
          iconColor="sky"
          value={totalDevices > 0 ? `${totalDevices}` : "—"}
          sublabel="in this fleet"
        />
        <GoldenMetricTile
          title="Avg Battery"
          icon={IconProp.Bolt}
          iconColor="amber"
          value={formatPercent(batteryPct)}
          sublabel="across reporting devices"
          percent={batteryPct}
          thresholds={{ warn: 40, danger: LOW_BATTERY_PERCENT }}
          higherIsBetter={true}
        />
        <GoldenMetricTile
          title="Avg Signal"
          icon={IconProp.Wifi}
          iconColor="violet"
          value={formatDbm(s.avgSignalDbm)}
          sublabel="across reporting devices"
          percent={signalPercent}
          thresholds={{ warn: 35, danger: 16 }}
          higherIsBetter={true}
        />
      </div>
    );
  };

  const renderAtRiskDevices: () => ReactElement = (): ReactElement => {
    if (isInventoryLoading || atRiskDevices.length === 0) {
      return <Fragment />;
    }

    return (
      <Card
        title="Devices needing attention"
        description="Devices that are offline, low on battery, or have a weak signal. Click through to investigate."
      >
        <div className="divide-y divide-gray-100">
          {atRiskDevices.map(
            (item: AtRiskDevice, index: number): ReactElement => {
              const iconBgClass: string = item.isCritical
                ? "bg-red-100"
                : "bg-amber-100";
              const iconColorClass: string = item.isCritical
                ? "text-red-600"
                : "text-amber-600";
              const chipClass: string = item.isCritical
                ? "bg-red-50 text-red-700 border-red-200"
                : "bg-amber-50 text-amber-700 border-amber-200";
              return (
                <div
                  key={`at-risk-${index}`}
                  onClick={() => {
                    navigateToDevice(item.externalId);
                  }}
                  className={`flex items-start gap-3 px-5 py-3.5 transition-colors ${
                    item.externalId ? "hover:bg-gray-50 cursor-pointer" : ""
                  }`}
                >
                  <div
                    className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-full ${iconBgClass} flex items-center justify-center`}
                  >
                    <Icon
                      icon={IconProp.Cube}
                      className={`h-3.5 w-3.5 ${iconColorClass}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {item.name}
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
            },
          )}
        </div>
      </Card>
    );
  };

  return (
    <Fragment>
      {renderHero()}
      {renderGoldenMetrics()}
      {renderAtRiskDevices()}
    </Fragment>
  );
};

export default IoTFleetOverview;
