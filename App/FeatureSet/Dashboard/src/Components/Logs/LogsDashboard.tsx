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
import Log from "Common/Models/AnalyticsModels/Log";
import LogSeverity from "Common/Types/Log/LogSeverity";
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

interface SeverityBucket {
  severity: LogSeverity;
  count: number;
  color: string;
  bgColor: string;
  barColor: string;
}

interface ServiceSummary {
  service: Service;
  logCount: number;
  errorCount: number;
  warnCount: number;
}

const SEVERITY_STYLES: Record<
  string,
  { color: string; bgColor: string; barColor: string; order: number }
> = {
  Fatal: {
    color: "text-rose-700",
    bgColor: "bg-rose-50",
    barColor: "bg-rose-500",
    order: 0,
  },
  Error: {
    color: "text-red-700",
    bgColor: "bg-red-50",
    barColor: "bg-red-400",
    order: 1,
  },
  Warning: {
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    barColor: "bg-amber-400",
    order: 2,
  },
  Information: {
    color: "text-sky-700",
    bgColor: "bg-sky-50",
    barColor: "bg-sky-400",
    order: 3,
  },
  Debug: {
    color: "text-violet-700",
    bgColor: "bg-violet-50",
    barColor: "bg-violet-400",
    order: 4,
  },
  Trace: {
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    barColor: "bg-emerald-400",
    order: 5,
  },
  Unspecified: {
    color: "text-gray-700",
    bgColor: "bg-gray-100",
    barColor: "bg-gray-300",
    order: 6,
  },
};

function timeRangeLabel(range: RangeStartAndEndDateTime): string {
  if (range.range === TimeRange.CUSTOM) {
    return "the selected time range";
  }
  return `the ${(range.range as string).toLowerCase()}`;
}

const LogsDashboard: FunctionComponent = (): ReactElement => {
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [services, setServices] = useState<Array<Service>>([]);
  const [logs, setLogs] = useState<Array<Log>>([]);
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

      const [servicesResult, logsResult] = await Promise.all([
        ModelAPI.getList({
          modelType: Service,
          query: { projectId },
          select: { name: true, serviceColor: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: { name: SortOrder.Ascending },
        }),
        AnalyticsModelAPI.getList<Log>({
          modelType: Log,
          query: {
            projectId,
            time: new InBetween<Date>(dateRange.startValue, dateRange.endValue),
          } as Query<Log>,
          limit: 5000,
          skip: 0,
          select: {
            serviceId: true,
            severityText: true,
            time: true,
          } as Select<Log>,
          sort: { time: SortOrder.Descending } as Record<string, SortOrder>,
          requestOptions: {},
        }),
      ]);

      setServices(servicesResult.data || []);
      setLogs(
        ((logsResult as AnalyticsListResult<Log>).data || []) as Array<Log>,
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

  const stats: {
    severityCounts: Map<string, number>;
    logsByService: Map<string, { total: number; error: number; warn: number }>;
    total: number;
    errorCount: number;
    warnCount: number;
  } = useMemo(() => {
    const severityCounts: Map<string, number> = new Map();
    const logsByService: Map<
      string,
      { total: number; error: number; warn: number }
    > = new Map();
    let errorCount: number = 0;
    let warnCount: number = 0;

    for (const log of logs) {
      const sev: LogSeverity | undefined = log.severityText;
      const sevKey: string = (sev as string) || "Unspecified";
      severityCounts.set(sevKey, (severityCounts.get(sevKey) || 0) + 1);

      const isError: boolean =
        sev === LogSeverity.Error || sev === LogSeverity.Fatal;
      const isWarn: boolean = sev === LogSeverity.Warning;
      if (isError) {
        errorCount++;
      }
      if (isWarn) {
        warnCount++;
      }

      const serviceId: ObjectID | undefined = log.serviceId;
      if (serviceId) {
        const sid: string = serviceId.toString();
        const existing: { total: number; error: number; warn: number } =
          logsByService.get(sid) || { total: 0, error: 0, warn: 0 };
        existing.total++;
        if (isError) {
          existing.error++;
        }
        if (isWarn) {
          existing.warn++;
        }
        logsByService.set(sid, existing);
      }
    }

    return {
      severityCounts,
      logsByService,
      total: logs.length,
      errorCount,
      warnCount,
    };
  }, [logs]);

  const severityBuckets: Array<SeverityBucket> = useMemo(() => {
    return Array.from(stats.severityCounts.entries())
      .map(([name, count]: [string, number]): SeverityBucket => {
        const style: {
          color: string;
          bgColor: string;
          barColor: string;
          order: number;
        } = SEVERITY_STYLES[name] || SEVERITY_STYLES["Unspecified"]!;
        return {
          severity: name as LogSeverity,
          count,
          color: style.color,
          bgColor: style.bgColor,
          barColor: style.barColor,
        };
      })
      .sort((a: SeverityBucket, b: SeverityBucket): number => {
        const oa: number = SEVERITY_STYLES[a.severity as string]?.order ?? 99;
        const ob: number = SEVERITY_STYLES[b.severity as string]?.order ?? 99;
        return oa - ob;
      });
  }, [stats.severityCounts]);

  const serviceSummaries: Array<ServiceSummary> = useMemo(() => {
    const serviceById: Map<string, Service> = new Map();
    for (const s of services) {
      if (s.id) {
        serviceById.set(s.id.toString(), s);
      }
    }

    const out: Array<ServiceSummary> = [];
    for (const [sid, counts] of stats.logsByService.entries()) {
      const service: Service | undefined = serviceById.get(sid);
      if (!service) {
        continue;
      }
      out.push({
        service,
        logCount: counts.total,
        errorCount: counts.error,
        warnCount: counts.warn,
      });
    }
    return out.sort((a: ServiceSummary, b: ServiceSummary): number => {
      return b.logCount - a.logCount;
    });
  }, [services, stats.logsByService]);

  const reportingServices: number = serviceSummaries.length;
  const quietServices: number = Math.max(
    0,
    services.length - reportingServices,
  );
  const errorRate: number =
    stats.total > 0 ? Math.round((stats.errorCount / stats.total) * 100) : 0;
  const rangeLabel: string = timeRangeLabel(timeRange);

  const headerBar: ReactElement = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Insights</h2>
        <p className="text-xs text-gray-500">
          Log activity across your services in {rangeLabel}.
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

  if (stats.total === 0) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gradient-to-br from-white to-gray-50 p-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Icon icon={IconProp.List} className="h-7 w-7 text-indigo-500" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-gray-900">
            No logs in {rangeLabel}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            Once your services start shipping logs via OpenTelemetry,
            you&apos;ll see severity distribution, error rate, and per-service
            volume here.
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.LOGS] as Route,
              )}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
            >
              <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
              <span>Open Viewer</span>
            </AppLink>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.LOGS_DOCUMENTATION] as Route,
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

  const maxLogs: number = Math.max(
    ...serviceSummaries.map((s: ServiceSummary): number => {
      return s.logCount;
    }),
    1,
  );

  return (
    <Fragment>
      {headerBar}

      {/* Hero stat cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total logs"
          value={stats.total}
          subtext={`ingested in ${rangeLabel}`}
          icon={IconProp.List}
          tone="indigo"
        />
        <StatCard
          label="Errors"
          value={stats.errorCount}
          subtext={`${errorRate}% of total volume`}
          icon={IconProp.Alert}
          tone={stats.errorCount > 0 ? "amber" : "emerald"}
        />
        <StatCard
          label="Warnings"
          value={stats.warnCount}
          subtext="warning-level logs"
          icon={IconProp.Alert}
          tone="amber"
        />
        <StatCard
          label={quietServices > 0 ? "Quiet services" : "Reporting services"}
          value={quietServices > 0 ? quietServices : reportingServices}
          subtext={
            quietServices > 0
              ? "no logs in range"
              : services.length > 0
                ? `${reportingServices} of ${services.length} services`
                : "sending logs"
          }
          icon={quietServices > 0 ? IconProp.Alert : IconProp.CheckCircle}
          tone={quietServices > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* Severity distribution */}
      {severityBuckets.length > 0 && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Severity distribution
              </h3>
              <p className="text-xs text-gray-500">
                How {stats.total} log{stats.total === 1 ? "" : "s"} break down
                by severity
              </p>
            </div>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
            {severityBuckets.map((b: SeverityBucket): ReactElement => {
              const pct: number =
                stats.total > 0 ? (b.count / stats.total) * 100 : 0;
              return (
                <div
                  key={b.severity as string}
                  className={b.barColor}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                  title={`${b.severity as string}: ${b.count}`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {severityBuckets.map((b: SeverityBucket): ReactElement => {
              const pct: number =
                stats.total > 0 ? Math.round((b.count / stats.total) * 100) : 0;
              return (
                <div
                  key={b.severity as string}
                  className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 ${b.bgColor}`}
                >
                  <span className={`h-2 w-2 rounded-full ${b.barColor}`} />
                  <span className={`text-xs font-medium ${b.color}`}>
                    {b.severity as string}
                  </span>
                  <span className={`text-xs ${b.color} opacity-70`}>
                    {b.count} · {pct}%
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
            Services reporting logs
          </h3>
          <p className="text-xs text-gray-500">
            Volume and error signal per service in {rangeLabel}
          </p>
        </div>
        <AppLink
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          to={RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route)}
        >
          <span>Open Viewer</span>
          <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
        </AppLink>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {serviceSummaries.map((summary: ServiceSummary): ReactElement => {
          const coverage: number = Math.round(
            (summary.logCount / maxLogs) * 100,
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
                RouteMap[PageMap.SERVICE_VIEW_LOGS] as Route,
                { modelId: new ObjectID(sid) },
              )}
            >
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                <div className="mb-4 flex items-start justify-between">
                  <ServiceElement service={summary.service} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {summary.errorCount > 0 && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        {summary.errorCount} error
                        {summary.errorCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {summary.warnCount > 0 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {summary.warnCount} warn
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-1">
                  <div className="mb-1.5 flex items-end justify-between">
                    <span className="text-2xl font-bold text-gray-900">
                      {summary.logCount}
                    </span>
                    <span className="mb-1 text-xs text-gray-400">
                      log{summary.logCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-500 transition-all duration-500"
                      style={{ width: `${Math.max(coverage, 4)}%` }}
                    />
                  </div>
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

export default LogsDashboard;
