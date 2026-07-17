import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import Host from "Common/Models/DatabaseModels/Host";
import Card from "Common/UI/Components/Card/Card";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
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
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  WINDOWS_SERVICE_METRIC_NAME,
  SERVICE_NAME_ATTR,
  SERVICE_STARTUP_MODE_ATTR,
  ServiceStatusMeta,
  statusMeta,
  startupModeLabel,
  decodeServiceNameFromUrl,
} from "../Utils/WindowsServices";

interface ServiceSample {
  time: Date;
  code: number;
}

interface ServiceTransition {
  time: Date;
  fromCode: number;
  toCode: number;
}

interface ServiceIdentity {
  startupMode: string | null;
  latestSampleAt: Date | null;
  currentCode: number | null;
}

/*
 * Raw samples are capped at this many rows per fetch (newest first). At
 * the collector's 30s scrape cadence that covers ~16 hours — plenty for
 * the default ranges. When a wider range hits the cap, the chart window
 * is narrowed to the observed samples so it doesn't render a misleading
 * empty region.
 */
const SAMPLE_FETCH_LIMIT: number = 2000;

const DEFAULT_TIME_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_THIRTY_MINS,
};

const REFRESH_STORAGE_KEY: string = "host-service-view-auto-refresh-interval";

const MAX_TRANSITIONS_SHOWN: number = 50;

const colorClasses: Record<
  "blue" | "violet" | "amber" | "emerald" | "slate",
  { bg: string; ring: string; text: string }
> = {
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  slate: { bg: "bg-slate-50", ring: "ring-slate-200", text: "text-slate-600" },
};

interface StatTileProps {
  title: string;
  icon: IconProp;
  iconColor: keyof typeof colorClasses;
  value: string | ReactElement;
  sublabel?: string | undefined;
  percent?: number | null | undefined;
  barClassName?: string | undefined;
}

const StatTile: FunctionComponent<StatTileProps> = (
  props: StatTileProps,
): ReactElement => {
  const colors: { bg: string; ring: string; text: string } =
    colorClasses[props.iconColor];

  const safePercent: number =
    props.percent === null || props.percent === undefined
      ? 0
      : Math.min(100, Math.max(0, props.percent));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          {props.title}
        </span>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-md ${colors.bg} ring-1 ring-inset ${colors.ring}`}
        >
          <Icon icon={props.icon} className={`h-3.5 w-3.5 ${colors.text}`} />
        </div>
      </div>
      <div className="text-2xl font-semibold text-gray-900 leading-none">
        {props.value}
      </div>
      {props.sublabel ? (
        <div className="mt-1 text-xs text-gray-500">{props.sublabel}</div>
      ) : (
        <div className="mt-1 text-xs text-gray-400">&nbsp;</div>
      )}
      {props.percent !== undefined && props.percent !== null && (
        <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5">
          <div
            className={`${props.barClassName || "bg-emerald-500"} h-1.5 rounded-full transition-all`}
            style={{ width: `${safePercent}%` }}
          />
        </div>
      )}
    </div>
  );
};

const StatusPill: FunctionComponent<{ code: number | null }> = (props: {
  code: number | null;
}): ReactElement => {
  const meta: ServiceStatusMeta = statusMeta(props.code);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${meta.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
};

const availabilityBarClass: (percent: number) => string = (
  percent: number,
): string => {
  if (percent >= 99) {
    return "bg-emerald-500";
  }
  if (percent >= 90) {
    return "bg-amber-500";
  }
  return "bg-red-500";
};

/*
 * Severity-ordered plotting scale for the status chart. Raw SCM codes are
 * arbitrary (Stopped=1, Running=4, Paused=7), so no aggregate over them is
 * meaningful when the chart buckets wide ranges. Ranks order the states
 * worst → best, letting Min-aggregation surface the worst state a bucket
 * saw. Codes outside 1–7 aren't plotted (they still show in State Changes).
 */
const codeToPlotRank: (code: number) => number | null = (
  code: number,
): number | null => {
  switch (code) {
    case 1: // SERVICE_STOPPED
      return 0;
    case 3: // SERVICE_STOP_PENDING
      return 1;
    case 7: // SERVICE_PAUSED
      return 2;
    case 6: // SERVICE_PAUSE_PENDING
      return 3;
    case 2: // SERVICE_START_PENDING
      return 4;
    case 5: // SERVICE_CONTINUE_PENDING
      return 5;
    case 4: // SERVICE_RUNNING
      return 6;
    default:
      return null;
  }
};

const plotRankLabel: (rank: number) => string = (rank: number): string => {
  switch (rank) {
    case 0:
      return "Stopped";
    case 1:
      return "Stop pending";
    case 2:
      return "Paused";
    case 3:
      return "Pause pending";
    case 4:
      return "Start pending";
    case 5:
      return "Continue pending";
    case 6:
      return "Running";
    default:
      return "";
  }
};

const HostServiceView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const serviceName: string = decodeServiceNameFromUrl(
    Navigation.getLastParamAsString(),
  );

  const [host, setHost] = useState<Host | null>(null);
  const [identity, setIdentity] = useState<ServiceIdentity | null>(null);
  const [samples, setSamples] = useState<Array<ServiceSample>>([]);
  const [transitions, setTransitions] = useState<Array<ServiceTransition>>([]);
  /*
   * Set to the oldest fetched sample's time when the selected range held
   * more samples than the fetch cap — stats only cover from here on, and
   * every label that says "in selected range" must disclose that.
   */
  const [truncatedFrom, setTruncatedFrom] = useState<Date | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_TIME_RANGE);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
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
   * Manual refresh, the auto-refresh timer, and time-range changes can
   * overlap in flight; only the most recently started fetch may commit
   * state, or a slow stale response would overwrite newer data.
   */
  const fetchSeqRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    const seq: number = ++fetchSeqRef.current;
    const isStale: () => boolean = (): boolean => {
      return seq !== fetchSeqRef.current;
    };

    setIsRefreshing(true);
    setError("");
    try {
      const item: Host | null = await ModelAPI.getItem({
        modelType: Host,
        id: modelId,
        select: {
          name: true,
          hostIdentifier: true,
          osType: true,
        },
      });

      if (isStale()) {
        return;
      }

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsRefreshing(false);
        setIsInitialLoading(false);
        return;
      }

      setHost(item);

      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      const startDate: Date = dateRange.startValue;
      const endDate: Date = dateRange.endValue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = {
        modelType: Metric,
        query: {
          projectId: projectId,
          name: WINDOWS_SERVICE_METRIC_NAME,
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "resource.host.name": item.hostIdentifier,
            [SERVICE_NAME_ATTR]: serviceName,
          },
        },
        limit: SAMPLE_FETCH_LIMIT,
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

      const result: ListResult<Metric> =
        await AnalyticsModelAPI.getList<Metric>(query);

      if (isStale()) {
        return;
      }

      const parsed: Array<ServiceSample> = [];
      let startupMode: string | null = null;

      // Rows arrive newest-first; the first row carries the freshest attrs.
      for (const m of result.data) {
        if (!m.time || m.value === undefined || m.value === null) {
          continue;
        }
        const t: Date = new Date(m.time as unknown as string | Date);
        const code: number = Number(m.value);
        if (Number.isNaN(t.getTime()) || !Number.isFinite(code)) {
          continue;
        }
        if (startupMode === null) {
          const attrs: Record<string, unknown> =
            (m.attributes as Record<string, unknown>) || {};
          startupMode =
            (attrs[SERVICE_STARTUP_MODE_ATTR] as string | undefined) || null;
        }
        parsed.push({ time: t, code });
      }

      parsed.sort((a: ServiceSample, b: ServiceSample) => {
        return a.time.getTime() - b.time.getTime();
      });

      const newTransitions: Array<ServiceTransition> = [];
      for (let i: number = 1; i < parsed.length; i++) {
        const prev: ServiceSample = parsed[i - 1]!;
        const cur: ServiceSample = parsed[i]!;
        if (prev.code !== cur.code) {
          newTransitions.push({
            time: cur.time,
            fromCode: prev.code,
            toCode: cur.code,
          });
        }
      }

      const latest: ServiceSample | null =
        parsed.length > 0 ? parsed[parsed.length - 1]! : null;

      setIdentity({
        startupMode: startupMode,
        latestSampleAt: latest ? latest.time : null,
        currentCode: latest ? latest.code : null,
      });
      setSamples(parsed);
      setTransitions(newTransitions);

      /*
       * When the fetch cap truncated the range, only the newest samples
       * came back — narrow the chart window to what was observed instead
       * of rendering a misleading empty stretch on the left.
       */
      const truncated: boolean =
        result.data.length >= SAMPLE_FETCH_LIMIT && parsed.length > 0;
      setTruncatedFrom(truncated ? parsed[0]!.time : null);
      setChartWindow({
        start: truncated ? parsed[0]!.time : startDate,
        end: endDate,
      });
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      if (isStale()) {
        return;
      }
      setError(API.getFriendlyMessage(err));
    }
    if (isStale()) {
      return;
    }
    setIsRefreshing(false);
    setIsInitialLoading(false);
  };

  const fetchDataRef: React.MutableRefObject<PromiseVoidFunction> =
    useRef<PromiseVoidFunction>(fetchData);
  fetchDataRef.current = fetchData;

  useEffect(() => {
    fetchDataRef.current().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
    /*
     * modelId.toString(): history jumps can swap the host while this
     * component stays mounted on the same route pattern.
     */
  }, [timeRange, serviceName, modelId.toString()]);

  useEffect(() => {
    const ms: number | null = getAutoRefreshIntervalInMs(autoRefreshInterval);
    if (ms === null) {
      return undefined;
    }
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      fetchDataRef.current().catch((err: Error) => {
        setError(API.getFriendlyMessage(err));
      });
    }, ms);
    return () => {
      clearInterval(timer);
    };
  }, [autoRefreshInterval]);

  const onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void = (
    interval: AutoRefreshInterval,
  ): void => {
    setAutoRefreshInterval(interval);
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(REFRESH_STORAGE_KEY, interval);
    }
  };

  const renderRefreshControl: () => ReactElement = (): ReactElement => {
    return (
      <AutoRefreshControl
        autoRefreshInterval={autoRefreshInterval}
        onAutoRefreshIntervalChange={onAutoRefreshIntervalChange}
        onManualRefresh={() => {
          fetchDataRef.current().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
          });
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
    );
  };

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!host) {
      return null;
    }

    const servicesRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW_SERVICES] as Route,
      { modelId: modelId },
    );
    const hostRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.HOST_VIEW] as Route,
      { modelId: modelId },
    );

    const hostDisplayName: string =
      (host.name as string | undefined) ||
      (host.hostIdentifier as string | undefined) ||
      "host";

    const chips: Array<{ icon: IconProp; label: string }> = [];
    if (identity?.startupMode) {
      chips.push({
        icon: IconProp.Cog,
        label: `Startup: ${startupModeLabel(identity.startupMode)}`,
      });
    }
    if (identity?.latestSampleAt) {
      chips.push({
        icon: IconProp.Clock,
        label: `Last sample ${OneUptimeDate.fromNow(identity.latestSampleAt)}`,
      });
    }

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-indigo-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-indigo-200 shadow-sm">
                  <Icon
                    icon={IconProp.Cog6Tooth}
                    className="h-6 w-6 text-indigo-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {serviceName}
                    </h1>
                    {identity && <StatusPill code={identity.currentCode} />}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    <Link
                      to={servicesRoute}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      Services
                    </Link>
                    <span className="mx-1.5 text-gray-300">/</span>
                    <Link
                      to={hostRoute}
                      className="text-indigo-600 hover:text-indigo-900"
                    >
                      {hostDisplayName}
                    </Link>
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 md:self-start">
                {renderRefreshControl()}
              </div>
            </div>

            {chips.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {chips.map(
                  (
                    chip: { icon: IconProp; label: string },
                    idx: number,
                  ): ReactElement => {
                    return (
                      <span
                        key={`chip-${idx}`}
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

  const renderSummaryTiles: () => ReactElement = (): ReactElement => {
    if (isInitialLoading) {
      return (
        <div className="mb-6">
          <PageLoader isVisible={true} />
        </div>
      );
    }

    if (error) {
      return (
        <div className="mb-6">
          <ErrorMessage message={error} />
        </div>
      );
    }

    if (!identity) {
      return <Fragment />;
    }

    const runningCount: number = samples.filter((s: ServiceSample) => {
      return s.code === 4; // SERVICE_RUNNING
    }).length;
    const availability: number | null =
      samples.length > 0 ? (runningCount / samples.length) * 100 : null;

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          title="Current Status"
          icon={IconProp.Bolt}
          iconColor={identity.currentCode === 4 ? "emerald" : "slate"}
          value={statusMeta(identity.currentCode).label}
          sublabel={
            identity.latestSampleAt
              ? `as of ${OneUptimeDate.fromNow(identity.latestSampleAt)}`
              : "no samples in range"
          }
        />
        <StatTile
          title="Availability"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={availability === null ? "—" : `${availability.toFixed(1)}%`}
          sublabel={`running in ${runningCount} of ${samples.length} sample${samples.length === 1 ? "" : "s"}${truncatedFrom ? " (capped)" : ""}`}
          percent={availability}
          barClassName={
            availability === null
              ? undefined
              : availabilityBarClass(availability)
          }
        />
        <StatTile
          title="Startup Mode"
          icon={IconProp.Cog}
          iconColor="violet"
          value={startupModeLabel(identity.startupMode)}
          sublabel="service start type"
        />
        <StatTile
          title="State Changes"
          icon={IconProp.ArrowPath}
          iconColor="amber"
          value={transitions.length.toString()}
          sublabel={
            truncatedFrom
              ? `since ${OneUptimeDate.fromNow(truncatedFrom)} (sample cap reached)`
              : "in selected range"
          }
        />
      </div>
    );
  };

  const renderStatusChart: () => ReactElement = (): ReactElement => {
    if (isInitialLoading || error) {
      return <Fragment />;
    }

    if (!chartWindow || samples.length === 0) {
      return <Fragment />;
    }

    const points: Array<{ x: Date; y: number }> = [];
    for (const s of samples) {
      const rank: number | null = codeToPlotRank(s.code);
      if (rank !== null) {
        points.push({ x: s.time, y: rank });
      }
    }

    if (points.length === 0) {
      return <Fragment />;
    }

    /*
     * The chart buckets points on wide ranges, and Min on the
     * severity-ordered rank keeps the worst state a bucket saw visible —
     * a Max/Avg over raw SCM codes would swallow short outages.
     */
    const xAxis: ChartXAxis = {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        min: chartWindow.start,
        max: chartWindow.end,
        aggregateType: XAxisAggregateType.Min,
      },
    };

    /*
     * Max 8 (not 6) so the default 5-tick layout lands on the even
     * integers 0/2/4/6 — Stopped, Paused, Start pending, Running —
     * instead of fractional ticks the formatter would have to blank.
     */
    const yAxis: YAxis = {
      legend: "State",
      options: {
        type: YAxisType.Number,
        min: 0,
        max: 8,
        precision: YAxisPrecision.NoDecimals,
        formatter: plotRankLabel,
      },
    };

    const data: Array<SeriesPoint> = [
      {
        seriesName: "State",
        data: points,
      },
    ];

    return (
      <div className="mb-6">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Status timeline
          </h2>
          <p className="text-xs text-gray-500">
            {`Worst observed state per interval${
              truncatedFrom
                ? `, from the most recent ${SAMPLE_FETCH_LIMIT} samples`
                : " over the selected time range"
            }. Exact changes are listed under State Changes.`}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <LineChartElement
            data={data}
            xAxis={xAxis}
            yAxis={yAxis}
            curve={ChartCurve.STEP}
            sync={false}
            syncid={`host-service-view-${modelId.toString()}`}
            heightInPx={220}
            showLegend={false}
          />
        </div>
      </div>
    );
  };

  const renderTransitions: () => ReactElement = (): ReactElement => {
    if (isInitialLoading || error || samples.length === 0) {
      return <Fragment />;
    }

    const newestFirst: Array<ServiceTransition> = [...transitions].reverse();
    const shown: Array<ServiceTransition> = newestFirst.slice(
      0,
      MAX_TRANSITIONS_SHOWN,
    );

    const scopeLabel: string = truncatedFrom
      ? `since ${OneUptimeDate.getDateAsLocalFormattedString(truncatedFrom)} — the selected range exceeded the ${SAMPLE_FETCH_LIMIT}-sample cap`
      : "in the selected time range";

    return (
      <Card
        title="State Changes"
        description={
          transitions.length === 0
            ? `The service state did not change ${scopeLabel}.`
            : `State changes observed ${scopeLabel}, newest first${
                transitions.length > MAX_TRANSITIONS_SHOWN
                  ? ` (showing the latest ${MAX_TRANSITIONS_SHOWN} of ${transitions.length})`
                  : ""
              }.`
        }
      >
        {transitions.length === 0 ? (
          <Fragment />
        ) : (
          <div className="divide-y divide-gray-100">
            {shown.map(
              (transition: ServiceTransition, idx: number): ReactElement => {
                return (
                  <div
                    key={`transition-${idx}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                  >
                    <span className="w-40 text-sm text-gray-500">
                      {OneUptimeDate.getDateAsLocalFormattedString(
                        transition.time,
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusPill code={transition.fromCode} />
                      <Icon
                        icon={IconProp.ChevronRight}
                        className="h-3.5 w-3.5 text-gray-400"
                      />
                      <StatusPill code={transition.toCode} />
                    </span>
                    <span className="ml-auto text-xs text-gray-400">
                      {OneUptimeDate.fromNow(transition.time)}
                    </span>
                  </div>
                );
              },
            )}
          </div>
        )}
      </Card>
    );
  };

  const renderNoDataNote: () => ReactElement = (): ReactElement => {
    if (isInitialLoading || error || samples.length > 0) {
      return <Fragment />;
    }
    return (
      <Card
        title="No service metrics in range"
        description={`No "${serviceName}" samples were found on this host during the selected time window. Pick a wider time range, or verify the OTel collector's windows_service receiver is enabled on this host — the Documentation tab has setup steps.`}
      >
        <Fragment />
      </Card>
    );
  };

  if (isInitialLoading && !host) {
    return <PageLoader isVisible={true} />;
  }

  if (error && !host) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      {renderHero()}
      {renderSummaryTiles()}
      {renderStatusChart()}
      {renderTransitions()}
      {renderNoDataNote()}
    </Fragment>
  );
};

export default HostServiceView;
