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
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IsNull from "Common/Types/BaseDatabase/IsNull";
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
}

interface RecentTrace {
  traceId: string;
  name: string;
  serviceId: string;
  startTime: Date;
  statusCode: SpanStatus;
  durationNano: number;
}

const TracesDashboard: FunctionComponent = (): ReactElement => {
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceTraceSummary>
  >([]);
  const [recentErrorTraces, setRecentErrorTraces] = useState<
    Array<RecentTrace>
  >([]);
  const [recentSlowTraces, setRecentSlowTraces] = useState<
    Array<RecentTrace>
  >([]);
  const [services, setServices] = useState<Array<Service>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const formatDuration: (nanos: number) => string = (
    nanos: number,
  ): string => {
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

  const loadDashboard: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const now: Date = OneUptimeDate.getCurrentDate();
      const oneHourAgo: Date = OneUptimeDate.addRemoveHours(now, -1);

      // Load services
      const servicesResult: ListResult<Service> = await ModelAPI.getList({
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
      });

      const loadedServices: Array<Service> = servicesResult.data || [];
      setServices(loadedServices);

      // Load recent root spans (last 1 hour) to build per-service summaries
      const rootSpansResult: AnalyticsListResult<Span> =
        await AnalyticsModelAPI.getList({
          modelType: Span,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            startTime: new InBetween(oneHourAgo, now),
            parentSpanId: new IsNull(),
          },
          select: {
            traceId: true,
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
        });

      const rootSpans: Array<Span> = rootSpansResult.data || [];

      // Build per-service summaries from root spans
      const summaryMap: Map<string, ServiceTraceSummary> = new Map();

      for (const service of loadedServices) {
        const serviceId: string = service.id?.toString() || "";
        summaryMap.set(serviceId, {
          service,
          totalTraces: 0,
          errorTraces: 0,
          latestTraceTime: null,
        });
      }

      const errorTraces: Array<RecentTrace> = [];
      const allTraces: Array<RecentTrace> = [];

      for (const span of rootSpans) {
        const serviceId: string = span.serviceId?.toString() || "";
        const summary: ServiceTraceSummary | undefined =
          summaryMap.get(serviceId);

        if (summary) {
          summary.totalTraces += 1;

          if (span.statusCode === SpanStatus.Error) {
            summary.errorTraces += 1;
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

        const traceRecord: RecentTrace = {
          traceId: span.traceId?.toString() || "",
          name: span.name?.toString() || "Unknown",
          serviceId: serviceId,
          startTime: span.startTime ? new Date(span.startTime) : new Date(),
          statusCode: span.statusCode || SpanStatus.Unset,
          durationNano: (span.durationUnixNano as number) || 0,
        };

        if (span.statusCode === SpanStatus.Error) {
          errorTraces.push(traceRecord);
        }

        allTraces.push(traceRecord);
      }

      // Only show services that have traces
      const summariesWithData: Array<ServiceTraceSummary> = Array.from(
        summaryMap.values(),
      ).filter((s: ServiceTraceSummary) => {
        return s.totalTraces > 0;
      });

      // Sort by total traces descending
      summariesWithData.sort(
        (a: ServiceTraceSummary, b: ServiceTraceSummary) => {
          return b.totalTraces - a.totalTraces;
        },
      );

      setServiceSummaries(summariesWithData);
      setRecentErrorTraces(errorTraces.slice(0, 10));

      // Get slowest traces
      const slowTraces: Array<RecentTrace> = [...allTraces]
        .sort((a: RecentTrace, b: RecentTrace) => {
          return b.durationNano - a.durationNano;
        })
        .slice(0, 10);
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
    const service: Service | undefined = services.find((s: Service) => {
      return s.id?.toString() === serviceId;
    });
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
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
        <div className="text-gray-400 text-5xl mb-4">
          <svg
            className="mx-auto h-12 w-12"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No trace data yet
        </h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Once your services start sending distributed tracing data, you{"'"}ll
          see a summary of requests flowing through your system, error rates,
          and slow operations.
        </p>
      </div>
    );
  }

  return (
    <Fragment>
      {/* Service Cards */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Services Overview
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Request activity across your services in the last hour
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {serviceSummaries.map((summary: ServiceTraceSummary) => {
            const errorRate: number =
              summary.totalTraces > 0
                ? (summary.errorTraces / summary.totalTraces) * 100
                : 0;

            return (
              <div
                key={summary.service.id?.toString()}
                className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <ServiceElement service={summary.service} />
                  {errorRate > 5 ? (
                    <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full font-medium">
                      {errorRate.toFixed(1)}% errors
                    </span>
                  ) : (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
                      Healthy
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div>
                    <p className="text-xs text-gray-500">Requests</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {summary.totalTraces.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Errors</p>
                    <p
                      className={`text-lg font-semibold ${summary.errorTraces > 0 ? "text-red-600" : "text-gray-900"}`}
                    >
                      {summary.errorTraces.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Last Seen</p>
                    <p className="text-sm text-gray-700">
                      {summary.latestTraceTime
                        ? OneUptimeDate.getDateAsLocalFormattedString(
                            summary.latestTraceTime,
                            true,
                          )
                        : "-"}
                    </p>
                  </div>
                </div>

                {/* Error rate bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Error Rate</span>
                    <span>{errorRate.toFixed(1)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${errorRate > 5 ? "bg-red-500" : errorRate > 0 ? "bg-yellow-400" : "bg-green-400"}`}
                      style={{
                        width: `${Math.max(errorRate, errorRate > 0 ? 2 : 0)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100">
                  <AppLink
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                      {
                        modelId: new ObjectID(
                          summary.service._id as string,
                        ),
                      },
                    )}
                  >
                    View service traces
                  </AppLink>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column layout for errors and slow traces */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Errors */}
        <div>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Recent Errors
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Failed requests in the last hour
            </p>
          </div>
          {recentErrorTraces.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
              <p className="text-sm text-gray-500">
                No errors in the last hour
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-100">
                {recentErrorTraces.map(
                  (trace: RecentTrace, index: number) => {
                    return (
                      <AppLink
                        key={`${trace.traceId}-${index}`}
                        className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.TRACE_VIEW]!,
                          {
                            modelId: trace.traceId,
                          },
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
                              {OneUptimeDate.getDateAsLocalFormattedString(
                                trace.startTime,
                                true,
                              )}
                            </p>
                          </div>
                        </div>
                      </AppLink>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>

        {/* Slowest Traces */}
        <div>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Slowest Requests
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Longest running operations in the last hour
            </p>
          </div>
          {recentSlowTraces.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
              <p className="text-sm text-gray-500">
                No traces found in the last hour
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-100">
                {recentSlowTraces.map(
                  (trace: RecentTrace, index: number) => {
                    const maxDuration: number =
                      recentSlowTraces[0]?.durationNano || 1;
                    const barWidth: number =
                      (trace.durationNano / maxDuration) * 100;

                    return (
                      <AppLink
                        key={`${trace.traceId}-slow-${index}`}
                        className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                        to={RouteUtil.populateRouteParams(
                          RouteMap[PageMap.TRACE_VIEW]!,
                          {
                            modelId: trace.traceId,
                          },
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
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
                  },
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default TracesDashboard;
