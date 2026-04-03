import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/Utils/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceElement from "../Service/ServiceElement";
import SpanStatusElement from "../Span/SpanStatusElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";

interface ServiceTraceSummary {
  service: Service;
  totalTraces: number;
  errorTraces: number;
  latestTraceTime: Date | null;
  p50Nanos: number;
  p95Nanos: number;
  durations: Array<number>;
}

interface RecentTrace {
  traceId: string;
  name: string;
  serviceId: string;
  startTime: Date;
  statusCode: SpanStatus;
  durationNano: number;
}

const formatDuration: (nanos: number) => string = (nanos: number): string => {
  if (nanos >= 1_000_000_000) {
    return `${(nanos / 1_000_000_000).toFixed(2)}s`;
  }
  if (nanos >= 1_000_000) {
    return `${(nanos / 1_000_000).toFixed(1)}ms`;
  }
  if (nanos >= 1_000) {
    return `${(nanos / 1_000).toFixed(0)}us`;
  }
  return `${nanos}ns`;
};

const getPercentile: (arr: Array<number>, p: number) => number = (
  arr: Array<number>,
  p: number,
): number => {
  if (arr.length === 0) {
    return 0;
  }
  const sorted: Array<number> = [...arr].sort(
    (a: number, b: number) => a - b,
  );
  const idx: number = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] || 0;
};

const TracesDashboard: FunctionComponent = (): ReactElement => {
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceTraceSummary>
  >([]);
  const [recentErrorTraces, setRecentErrorTraces] = useState<
    Array<RecentTrace>
  >([]);
  const [recentSlowTraces, setRecentSlowTraces] = useState<Array<RecentTrace>>(
    [],
  );
  const [services, setServices] = useState<Array<Service>>([]);
  const [totalRequests, setTotalRequests] = useState<number>(0);
  const [totalErrors, setTotalErrors] = useState<number>(0);
  const [globalP50, setGlobalP50] = useState<number>(0);
  const [globalP95, setGlobalP95] = useState<number>(0);
  const [globalP99, setGlobalP99] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadDashboard: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const now: Date = OneUptimeDate.getCurrentDate();
      const oneHourAgo: Date = OneUptimeDate.addRemoveHours(now, -1);

      const [servicesResult, spansResult] = await Promise.all([
        ModelAPI.getList({
          modelType: Service,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            serviceColor: true,
            name: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        }),
        AnalyticsModelAPI.getList({
          modelType: Span,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            startTime: new InBetween(oneHourAgo, now),
          },
          select: {
            traceId: true,
            spanId: true,
            parentSpanId: true,
            serviceId: true,
            name: true,
            startTime: true,
            statusCode: true,
            durationUnixNano: true,
          },
          limit: 5000,
          skip: 0,
          sort: {
            startTime: SortOrder.Descending,
          },
        }),
      ]);

      const loadedServices: Array<Service> = servicesResult.data || [];
      setServices(loadedServices);

      const allSpans: Array<Span> = spansResult.data || [];

      // Build per-service summaries
      const summaryMap: Map<string, ServiceTraceSummary> = new Map();

      for (const service of loadedServices) {
        const serviceId: string = service.id?.toString() || "";
        summaryMap.set(serviceId, {
          service,
          totalTraces: 0,
          errorTraces: 0,
          latestTraceTime: null,
          p50Nanos: 0,
          p95Nanos: 0,
          durations: [],
        });
      }

      const serviceTraceIds: Map<string, Set<string>> = new Map();
      const serviceErrorTraceIds: Map<string, Set<string>> = new Map();
      const errorTraces: Array<RecentTrace> = [];
      const allTraces: Array<RecentTrace> = [];
      const seenTraceIds: Set<string> = new Set();
      const seenErrorTraceIds: Set<string> = new Set();
      const allDurations: Array<number> = [];

      for (const span of allSpans) {
        const serviceId: string = span.serviceId?.toString() || "";
        const traceId: string = span.traceId?.toString() || "";
        const duration: number = (span.durationUnixNano as number) || 0;
        const summary: ServiceTraceSummary | undefined =
          summaryMap.get(serviceId);

        if (duration > 0) {
          allDurations.push(duration);
        }

        if (summary) {
          if (!serviceTraceIds.has(serviceId)) {
            serviceTraceIds.set(serviceId, new Set());
          }
          if (!serviceErrorTraceIds.has(serviceId)) {
            serviceErrorTraceIds.set(serviceId, new Set());
          }

          const traceSet: Set<string> = serviceTraceIds.get(serviceId)!;
          if (!traceSet.has(traceId)) {
            traceSet.add(traceId);
            summary.totalTraces += 1;
          }

          if (duration > 0) {
            summary.durations.push(duration);
          }

          if (span.statusCode === SpanStatus.Error) {
            const errorSet: Set<string> =
              serviceErrorTraceIds.get(serviceId)!;
            if (!errorSet.has(traceId)) {
              errorSet.add(traceId);
              summary.errorTraces += 1;
            }
          }

          const spanTime: Date | undefined = span.startTime
            ? new Date(span.startTime)
            : undefined;
          if (
            spanTime &&
            (!summary.latestTraceTime || spanTime > summary.latestTraceTime)
          ) {
            summary.latestTraceTime = spanTime;
          }
        }

        if (!seenTraceIds.has(traceId) && traceId) {
          seenTraceIds.add(traceId);
          allTraces.push({
            traceId,
            name: span.name?.toString() || "Unknown",
            serviceId,
            startTime: span.startTime ? new Date(span.startTime) : new Date(),
            statusCode: span.statusCode || SpanStatus.Unset,
            durationNano: duration,
          });
        }

        if (
          span.statusCode === SpanStatus.Error &&
          traceId &&
          !seenErrorTraceIds.has(traceId)
        ) {
          seenErrorTraceIds.add(traceId);
          errorTraces.push({
            traceId,
            name: span.name?.toString() || "Unknown",
            serviceId,
            startTime: span.startTime ? new Date(span.startTime) : new Date(),
            statusCode: span.statusCode,
            durationNano: duration,
          });
        }
      }

      // Compute global percentiles
      setGlobalP50(getPercentile(allDurations, 50));
      setGlobalP95(getPercentile(allDurations, 95));
      setGlobalP99(getPercentile(allDurations, 99));

      // Compute per-service percentiles and filter
      const summariesWithData: Array<ServiceTraceSummary> = Array.from(
        summaryMap.values(),
      )
        .filter((s: ServiceTraceSummary) => s.totalTraces > 0)
        .map((s: ServiceTraceSummary) => {
          return {
            ...s,
            p50Nanos: getPercentile(s.durations, 50),
            p95Nanos: getPercentile(s.durations, 95),
          };
        });

      // Sort: highest error rate first, then by total traces
      summariesWithData.sort(
        (a: ServiceTraceSummary, b: ServiceTraceSummary) => {
          const aErrorRate: number =
            a.totalTraces > 0 ? a.errorTraces / a.totalTraces : 0;
          const bErrorRate: number =
            b.totalTraces > 0 ? b.errorTraces / b.totalTraces : 0;
          if (bErrorRate !== aErrorRate) {
            return bErrorRate - aErrorRate;
          }
          return b.totalTraces - a.totalTraces;
        },
      );

      let totalReqs: number = 0;
      let totalErrs: number = 0;
      for (const s of summariesWithData) {
        totalReqs += s.totalTraces;
        totalErrs += s.errorTraces;
      }
      setTotalRequests(totalReqs);
      setTotalErrors(totalErrs);

      setServiceSummaries(summariesWithData);
      setRecentErrorTraces(errorTraces.slice(0, 8));

      const slowTraces: Array<RecentTrace> = [...allTraces]
        .sort(
          (a: RecentTrace, b: RecentTrace) => b.durationNano - a.durationNano,
        )
        .slice(0, 8);
      setRecentSlowTraces(slowTraces);
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

  const getServiceName: (serviceId: string) => string = (
    serviceId: string,
  ): string => {
    const service: Service | undefined = services.find(
      (s: Service) => s.id?.toString() === serviceId,
    );
    return service?.name?.toString() || "Unknown";
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void loadDashboard();
        }}
      />
    );
  }

  if (serviceSummaries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-16 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-5">
          <svg
            className="h-8 w-8 text-indigo-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No trace data yet
        </h3>
        <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
          Once your services start sending distributed tracing data, you{"'"}ll
          see request rates, error rates, latency percentiles, and more.
        </p>
      </div>
    );
  }

  const overallErrorRate: number =
    totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return (
    <Fragment>
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">Requests</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {totalRequests.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">last hour</p>
        </div>

        <div
          className={`rounded-xl border p-5 ${overallErrorRate > 5 ? "border-red-200 bg-red-50" : overallErrorRate > 1 ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}
        >
          <p className="text-sm font-medium text-gray-500">Error Rate</p>
          <p
            className={`text-3xl font-bold mt-1 ${overallErrorRate > 5 ? "text-red-600" : overallErrorRate > 1 ? "text-amber-600" : "text-green-600"}`}
          >
            {overallErrorRate.toFixed(1)}%
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {totalErrors.toLocaleString()} errors
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <p className="text-sm font-medium text-gray-500">P50 Latency</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {formatDuration(globalP50)}
          </p>
          <p className="text-xs text-gray-400 mt-1">median</p>
        </div>

        <div
          className={`rounded-xl border p-5 ${globalP95 > 1_000_000_000 ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}
        >
          <p className="text-sm font-medium text-gray-500">P95 Latency</p>
          <p
            className={`text-3xl font-bold mt-1 ${globalP95 > 1_000_000_000 ? "text-amber-600" : "text-gray-900"}`}
          >
            {formatDuration(globalP95)}
          </p>
          <p className="text-xs text-gray-400 mt-1">95th percentile</p>
        </div>

        <div
          className={`rounded-xl border p-5 ${globalP99 > 2_000_000_000 ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}
        >
          <p className="text-sm font-medium text-gray-500">P99 Latency</p>
          <p
            className={`text-3xl font-bold mt-1 ${globalP99 > 2_000_000_000 ? "text-red-600" : "text-gray-900"}`}
          >
            {formatDuration(globalP99)}
          </p>
          <p className="text-xs text-gray-400 mt-1">99th percentile</p>
        </div>
      </div>

      {/* Service Health Table */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Service Health
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Sorted by error rate — services needing attention first
            </p>
          </div>
          <AppLink
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.TRACES_LIST] as Route,
            )}
          >
            View all spans
          </AppLink>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  Service
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  Requests
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  Error Rate
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  P50
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  P95
                </th>
                <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  Status
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-5 py-3">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {serviceSummaries.map((summary: ServiceTraceSummary) => {
                const errorRate: number =
                  summary.totalTraces > 0
                    ? (summary.errorTraces / summary.totalTraces) * 100
                    : 0;

                let healthColor: string = "bg-green-500";
                let healthLabel: string = "Healthy";
                let healthBg: string = "bg-green-50 text-green-700";
                if (errorRate > 10) {
                  healthColor = "bg-red-500";
                  healthLabel = "Critical";
                  healthBg = "bg-red-50 text-red-700";
                } else if (errorRate > 5) {
                  healthColor = "bg-amber-500";
                  healthLabel = "Degraded";
                  healthBg = "bg-amber-50 text-amber-700";
                } else if (errorRate > 1) {
                  healthColor = "bg-yellow-400";
                  healthLabel = "Warning";
                  healthBg = "bg-yellow-50 text-yellow-700";
                }

                return (
                  <tr
                    key={summary.service.id?.toString()}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <ServiceElement service={summary.service} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-medium text-gray-900">
                        {summary.totalTraces.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${errorRate > 10 ? "bg-red-500" : errorRate > 5 ? "bg-amber-400" : errorRate > 0 ? "bg-yellow-400" : "bg-green-400"}`}
                            style={{
                              width: `${Math.max(errorRate, errorRate > 0 ? 3 : 0)}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`text-sm font-medium ${errorRate > 5 ? "text-red-600" : "text-gray-900"}`}
                        >
                          {errorRate.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-mono text-gray-700">
                        {formatDuration(summary.p50Nanos)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-mono text-gray-700">
                        {formatDuration(summary.p95Nanos)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${healthBg}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${healthColor}`}
                        />
                        {healthLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <AppLink
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                          {
                            modelId: new ObjectID(
                              summary.service._id as string,
                            ),
                          },
                        )}
                      >
                        View
                      </AppLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two-column: Errors + Slow Requests */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Errors */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <h3 className="text-base font-semibold text-gray-900">
                Recent Errors
              </h3>
              {recentErrorTraces.length > 0 && (
                <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">
                  {recentErrorTraces.length}
                </span>
              )}
            </div>
          </div>
          {recentErrorTraces.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-green-50 flex items-center justify-center mb-3">
                <svg
                  className="h-5 w-5 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">
                No errors in the last hour
              </p>
              <p className="text-xs text-gray-400 mt-1">Looking good!</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-50">
                {recentErrorTraces.map((trace: RecentTrace, index: number) => {
                  return (
                    <AppLink
                      key={`${trace.traceId}-${index}`}
                      className="block px-4 py-3 hover:bg-red-50/30 transition-colors"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TRACE_VIEW]!,
                        { modelId: trace.traceId },
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 min-w-0">
                          <SpanStatusElement
                            spanStatusCode={trace.statusCode}
                            title=""
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {trace.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {getServiceName(trace.serviceId)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-xs font-mono text-gray-600">
                            {formatDuration(trace.durationNano)}
                          </p>
                          <p className="text-xs text-gray-400">
                            {OneUptimeDate.fromNow(trace.startTime)}
                          </p>
                        </div>
                      </div>
                    </AppLink>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Slowest Requests */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <h3 className="text-base font-semibold text-gray-900">
              Slowest Requests
            </h3>
          </div>
          {recentSlowTraces.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
              <p className="text-sm text-gray-500">
                No traces in the last hour
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-50">
                {recentSlowTraces.map((trace: RecentTrace, index: number) => {
                  const maxDuration: number =
                    recentSlowTraces[0]?.durationNano || 1;
                  const barWidth: number =
                    (trace.durationNano / maxDuration) * 100;

                  return (
                    <AppLink
                      key={`${trace.traceId}-slow-${index}`}
                      className="block px-4 py-3 hover:bg-amber-50/30 transition-colors"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.TRACE_VIEW]!,
                        { modelId: trace.traceId },
                      )}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-3 min-w-0">
                          <SpanStatusElement
                            spanStatusCode={trace.statusCode}
                            title=""
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {trace.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {getServiceName(trace.serviceId)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-sm font-mono font-semibold text-gray-900">
                            {formatDuration(trace.durationNano)}
                          </p>
                        </div>
                      </div>
                      <div className="ml-8">
                        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-400"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    </AppLink>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default TracesDashboard;
