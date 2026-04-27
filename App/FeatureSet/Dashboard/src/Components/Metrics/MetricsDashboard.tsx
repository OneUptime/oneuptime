import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Service from "Common/Models/DatabaseModels/Service";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ServiceElement from "../Service/ServiceElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";

interface MetricCategory {
  name: string;
  count: number;
  color: string;
  bgColor: string;
  barColor: string;
}

interface ServiceSummary {
  service: Service;
  metricCount: number;
  metricNames: Array<string>;
  hasSystemMetrics: boolean;
  hasAppMetrics: boolean;
}

const CATEGORY_STYLES: Record<
  string,
  { color: string; bgColor: string; barColor: string }
> = {
  System: {
    color: "text-sky-700",
    bgColor: "bg-sky-50",
    barColor: "bg-sky-400",
  },
  Request: {
    color: "text-violet-700",
    bgColor: "bg-violet-50",
    barColor: "bg-violet-400",
  },
  Database: {
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    barColor: "bg-amber-400",
  },
  Messaging: {
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    barColor: "bg-emerald-400",
  },
  Custom: {
    color: "text-gray-700",
    bgColor: "bg-gray-100",
    barColor: "bg-gray-300",
  },
};

const categorizeMetric: (name: string) => string = (name: string): string => {
  const lower: string = name.toLowerCase();
  if (
    lower.includes("cpu") ||
    lower.includes("memory") ||
    lower.includes("disk") ||
    lower.includes("network") ||
    lower.includes("system") ||
    lower.includes("process") ||
    lower.includes("runtime") ||
    lower.includes("gc")
  ) {
    return "System";
  }
  if (
    lower.includes("http") ||
    lower.includes("request") ||
    lower.includes("response") ||
    lower.includes("latency") ||
    lower.includes("duration") ||
    lower.includes("rpc")
  ) {
    return "Request";
  }
  if (
    lower.includes("db") ||
    lower.includes("database") ||
    lower.includes("query") ||
    lower.includes("connection") ||
    lower.includes("pool")
  ) {
    return "Database";
  }
  if (
    lower.includes("queue") ||
    lower.includes("message") ||
    lower.includes("kafka") ||
    lower.includes("rabbit") ||
    lower.includes("publish") ||
    lower.includes("consume")
  ) {
    return "Messaging";
  }
  return "Custom";
};

function timeRangeLabel(range: RangeStartAndEndDateTime): string {
  if (range.range === TimeRange.CUSTOM) {
    return "the selected time range";
  }
  return `the ${(range.range as string).toLowerCase()}`;
}

const MetricsDashboard: FunctionComponent = (): ReactElement => {
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [services, setServices] = useState<Array<Service>>([]);
  const [metricTypes, setMetricTypes] = useState<Array<MetricType>>([]);
  const [activeMetrics, setActiveMetrics] = useState<Array<Metric>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadDashboard: () => Promise<void> = useCallback(async () => {
    try {
      setIsLoading(true);
      setError("");

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        setIsLoading(false);
        return;
      }

      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

      const [servicesResult, metricTypesResult, metricsResult] =
        await Promise.all([
          ModelAPI.getList({
            modelType: Service,
            query: { projectId },
            select: { name: true, serviceColor: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: MetricType,
            query: { projectId },
            select: { name: true, unit: true, description: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: { name: SortOrder.Ascending },
          }),
          AnalyticsModelAPI.getList<Metric>({
            modelType: Metric,
            query: {
              projectId,
              time: new InBetween<Date>(
                dateRange.startValue,
                dateRange.endValue,
              ),
            } as Query<Metric>,
            limit: 5000,
            skip: 0,
            select: {
              name: true,
              serviceId: true,
              time: true,
            } as Select<Metric>,
            sort: { time: SortOrder.Descending } as Record<string, SortOrder>,
            requestOptions: {},
          }),
        ]);

      setServices(servicesResult.data || []);
      setMetricTypes(metricTypesResult.data || []);
      setActiveMetrics(
        ((metricsResult as AnalyticsListResult<Metric>).data ||
          []) as Array<Metric>,
      );
    } catch (err) {
      setError(API.getFriendlyMessage(err as Error));
    } finally {
      setIsLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // Aggregate client-side from analytics result
  const stats: {
    activeMetricNames: Set<string>;
    activeServiceIds: Set<string>;
    metricNamesByService: Map<string, Set<string>>;
    categoryCounts: Map<string, number>;
    totalDataPoints: number;
  } = useMemo(() => {
    const activeMetricNames: Set<string> = new Set();
    const activeServiceIds: Set<string> = new Set();
    const metricNamesByService: Map<string, Set<string>> = new Map();
    const categoryCounts: Map<string, number> = new Map();

    for (const m of activeMetrics) {
      const name: string | undefined = m.name as unknown as string | undefined;
      const serviceId: ObjectID | undefined = m.serviceId;
      if (!name) {
        continue;
      }
      activeMetricNames.add(name);
      if (serviceId) {
        const sid: string = serviceId.toString();
        activeServiceIds.add(sid);
        if (!metricNamesByService.has(sid)) {
          metricNamesByService.set(sid, new Set());
        }
        metricNamesByService.get(sid)!.add(name);
      }
    }

    for (const name of activeMetricNames) {
      const cat: string = categorizeMetric(name);
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    }

    return {
      activeMetricNames,
      activeServiceIds,
      metricNamesByService,
      categoryCounts,
      totalDataPoints: activeMetrics.length,
    };
  }, [activeMetrics]);

  const categories: Array<MetricCategory> = useMemo(() => {
    return Array.from(stats.categoryCounts.entries())
      .map(([name, count]: [string, number]): MetricCategory => {
        const style: { color: string; bgColor: string; barColor: string } =
          CATEGORY_STYLES[name] || CATEGORY_STYLES["Custom"]!;
        return {
          name,
          count,
          color: style.color,
          bgColor: style.bgColor,
          barColor: style.barColor,
        };
      })
      .sort((a: MetricCategory, b: MetricCategory): number => {
        return b.count - a.count;
      });
  }, [stats.categoryCounts]);

  const serviceSummaries: Array<ServiceSummary> = useMemo(() => {
    const serviceById: Map<string, Service> = new Map();
    for (const s of services) {
      if (s.id) {
        serviceById.set(s.id.toString(), s);
      }
    }

    const out: Array<ServiceSummary> = [];
    for (const [sid, names] of stats.metricNamesByService.entries()) {
      const service: Service | undefined = serviceById.get(sid);
      if (!service) {
        continue;
      }
      let hasSystem: boolean = false;
      let hasApp: boolean = false;
      for (const name of names) {
        if (categorizeMetric(name) === "System") {
          hasSystem = true;
        } else {
          hasApp = true;
        }
      }
      out.push({
        service,
        metricCount: names.size,
        metricNames: Array.from(names).slice(0, 6),
        hasSystemMetrics: hasSystem,
        hasAppMetrics: hasApp,
      });
    }
    return out.sort((a: ServiceSummary, b: ServiceSummary): number => {
      return b.metricCount - a.metricCount;
    });
  }, [services, stats.metricNamesByService]);

  const totalMetrics: number = stats.activeMetricNames.size;
  const reportingServices: number = serviceSummaries.length;
  const dormantServices: number = Math.max(
    0,
    services.length - reportingServices,
  );
  const avgPerService: number =
    reportingServices > 0 ? Math.round(totalMetrics / reportingServices) : 0;
  const cataloguedTypes: number = metricTypes.length;
  const rangeLabel: string = timeRangeLabel(timeRange);

  // -- Render --

  const headerBar: ReactElement = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Insights</h2>
        <p className="text-xs text-gray-500">
          What your services are reporting in {rangeLabel}.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <TelemetryTimeRangePicker
          value={timeRange}
          onChange={(value: RangeStartAndEndDateTime): void => {
            setTimeRange(value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            void loadDashboard();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          title="Refresh"
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-xl border border-gray-200 bg-white p-12">
          <ComponentLoader />
        </div>
      </Fragment>
    );
  }

  if (error) {
    return (
      <Fragment>
        {headerBar}
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void loadDashboard();
          }}
        />
      </Fragment>
    );
  }

  if (totalMetrics === 0) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gradient-to-br from-white to-gray-50 p-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Icon
              icon={IconProp.ChartBar}
              className="h-7 w-7 text-indigo-500"
            />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-gray-900">
            No metrics in {rangeLabel}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            {cataloguedTypes > 0
              ? `Your project has ${cataloguedTypes} catalogued metric ${
                  cataloguedTypes === 1 ? "type" : "types"
                }, but none reported during this window. Try widening the time range or check your collectors.`
              : "Once your services start sending metrics via OpenTelemetry, you'll see coverage, categories, and per-service breakdowns here."}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.METRICS] as Route,
              )}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
            >
              <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
              <span>Open Viewer</span>
            </AppLink>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.METRICS_DOCUMENTATION] as Route,
              )}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
            >
              <Icon icon={IconProp.Book} className="h-3.5 w-3.5" />
              <span>Setup Guide</span>
            </AppLink>
          </div>
        </div>
      </Fragment>
    );
  }

  const maxMetrics: number = Math.max(
    ...serviceSummaries.map((s: ServiceSummary): number => {
      return s.metricCount;
    }),
    1,
  );

  return (
    <Fragment>
      {headerBar}

      {/* Hero stat cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active metrics"
          value={totalMetrics}
          subtext={`distinct names in ${rangeLabel}`}
          icon={IconProp.ChartBar}
          tone="indigo"
        />
        <StatCard
          label="Reporting services"
          value={reportingServices}
          subtext={
            services.length > 0
              ? `${reportingServices} of ${services.length} services`
              : "actively sending data"
          }
          icon={IconProp.CheckCircle}
          tone="emerald"
        />
        <StatCard
          label="Avg per service"
          value={avgPerService}
          subtext="metrics per service"
          icon={IconProp.ChartBarSquare}
          tone="sky"
        />
        <StatCard
          label={dormantServices > 0 ? "Quiet services" : "Coverage"}
          value={dormantServices > 0 ? dormantServices : reportingServices}
          subtext={
            dormantServices > 0 ? "no metrics in range" : "all services covered"
          }
          icon={dormantServices > 0 ? IconProp.Alert : IconProp.Check}
          tone={dormantServices > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Metric categories
              </h3>
              <p className="text-xs text-gray-500">
                Distribution of {totalMetrics} active metric
                {totalMetrics === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
            {categories.map((cat: MetricCategory): ReactElement => {
              const pct: number =
                totalMetrics > 0 ? (cat.count / totalMetrics) * 100 : 0;
              return (
                <div
                  key={cat.name}
                  className={cat.barColor}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                  title={`${cat.name}: ${cat.count}`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((cat: MetricCategory): ReactElement => {
              const pct: number =
                totalMetrics > 0
                  ? Math.round((cat.count / totalMetrics) * 100)
                  : 0;
              return (
                <div
                  key={cat.name}
                  className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 ${cat.bgColor}`}
                >
                  <span className={`h-2 w-2 rounded-full ${cat.barColor}`} />
                  <span className={`text-xs font-medium ${cat.color}`}>
                    {cat.name}
                  </span>
                  <span className={`text-xs ${cat.color} opacity-70`}>
                    {cat.count} · {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-service cards */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Services reporting metrics
          </h3>
          <p className="text-xs text-gray-500">
            Coverage and instrumentation per service in {rangeLabel}
          </p>
        </div>
        <AppLink
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          to={RouteUtil.populateRouteParams(RouteMap[PageMap.METRICS] as Route)}
        >
          <span>Open Viewer</span>
          <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
        </AppLink>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {serviceSummaries.map((summary: ServiceSummary): ReactElement => {
          const coverage: number = Math.round(
            (summary.metricCount / maxMetrics) * 100,
          );
          const sid: string =
            summary.service.id?.toString() ||
            (summary.service._id as string) ||
            "";
          return (
            <AppLink
              key={sid}
              className="block"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SERVICE_VIEW_METRICS] as Route,
                { modelId: new ObjectID(sid) },
              )}
            >
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                <div className="mb-4 flex items-start justify-between">
                  <ServiceElement service={summary.service} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {summary.hasSystemMetrics && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                        System
                      </span>
                    )}
                    {summary.hasAppMetrics && (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                        App
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <div className="mb-1.5 flex items-end justify-between">
                    <span className="text-2xl font-bold text-gray-900">
                      {summary.metricCount}
                    </span>
                    <span className="mb-1 text-xs text-gray-400">
                      metric{summary.metricCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-500 transition-all duration-500"
                      style={{ width: `${Math.max(coverage, 4)}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {summary.metricNames.map((name: string): ReactElement => {
                    return (
                      <span
                        key={name}
                        className="inline-flex items-center rounded border border-gray-100 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600"
                      >
                        {name}
                      </span>
                    );
                  })}
                  {summary.metricCount > summary.metricNames.length && (
                    <span className="inline-flex items-center rounded bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-400">
                      +{summary.metricCount - summary.metricNames.length} more
                    </span>
                  )}
                </div>
              </div>
            </AppLink>
          );
        })}
      </div>
    </Fragment>
  );
};

interface StatCardProps {
  label: string;
  value: number;
  subtext: string;
  icon: IconProp;
  tone: "indigo" | "emerald" | "sky" | "amber";
}

const TONE_STYLES: Record<
  StatCardProps["tone"],
  { bg: string; text: string; valueText: string }
> = {
  indigo: {
    bg: "bg-indigo-50",
    text: "text-indigo-600",
    valueText: "text-gray-900",
  },
  emerald: {
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    valueText: "text-gray-900",
  },
  sky: {
    bg: "bg-sky-50",
    text: "text-sky-600",
    valueText: "text-gray-900",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-600",
    valueText: "text-amber-600",
  },
};

const StatCard: FunctionComponent<StatCardProps> = (
  props: StatCardProps,
): ReactElement => {
  const tone: { bg: string; text: string; valueText: string } =
    TONE_STYLES[props.tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{props.label}</p>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone.bg}`}
        >
          <Icon icon={props.icon} className={`h-4 w-4 ${tone.text}`} />
        </div>
      </div>
      <p className={`mt-2 text-3xl font-bold ${tone.valueText}`}>
        {props.value}
      </p>
      <p className="mt-1 text-xs text-gray-400">{props.subtext}</p>
    </div>
  );
};

export default MetricsDashboard;
