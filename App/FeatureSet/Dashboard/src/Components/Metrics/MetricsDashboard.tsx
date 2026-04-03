import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Service from "Common/Models/DatabaseModels/Service";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ServiceElement from "../Service/ServiceElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";

interface ServiceMetricSummary {
  service: Service;
  metricCount: number;
  metricNames: Array<string>;
  metricUnits: Array<string>;
  metricDescriptions: Array<string>;
  hasSystemMetrics: boolean;
  hasAppMetrics: boolean;
}

interface MetricCategory {
  name: string;
  count: number;
  color: string;
  bgColor: string;
}

const MetricsDashboard: FunctionComponent = (): ReactElement => {
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceMetricSummary>
  >([]);
  const [totalMetricCount, setTotalMetricCount] = useState<number>(0);
  const [metricCategories, setMetricCategories] = useState<
    Array<MetricCategory>
  >([]);
  const [servicesWithNoMetrics, setServicesWithNoMetrics] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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

  const loadDashboard: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      // Load services and metrics in parallel
      const [servicesResult, metricsResult] = await Promise.all([
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
        ModelAPI.getList({
          modelType: MetricType,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            name: true,
            unit: true,
            description: true,
            services: {
              _id: true,
              name: true,
              serviceColor: true,
            } as any,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          sort: {
            name: SortOrder.Ascending,
          },
        }),
      ]);

      const services: Array<Service> = servicesResult.data || [];
      const metrics: Array<MetricType> = metricsResult.data || [];
      setTotalMetricCount(metrics.length);

      // Build category counts
      const categoryMap: Map<string, number> = new Map();
      for (const metric of metrics) {
        const cat: string = categorizeMetric(metric.name || "");
        categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
      }

      const categoryColors: Record<string, { color: string; bgColor: string }> =
        {
          System: { color: "text-blue-700", bgColor: "bg-blue-50" },
          Request: { color: "text-purple-700", bgColor: "bg-purple-50" },
          Database: { color: "text-amber-700", bgColor: "bg-amber-50" },
          Messaging: { color: "text-green-700", bgColor: "bg-green-50" },
          Custom: { color: "text-gray-700", bgColor: "bg-gray-50" },
        };

      const categories: Array<MetricCategory> = Array.from(
        categoryMap.entries(),
      )
        .map(([name, count]: [string, number]) => {
          return {
            name,
            count,
            color: categoryColors[name]?.color || "text-gray-700",
            bgColor: categoryColors[name]?.bgColor || "bg-gray-50",
          };
        })
        .sort((a: MetricCategory, b: MetricCategory) => {
          return b.count - a.count;
        });

      setMetricCategories(categories);

      // Build per-service summaries
      const summaryMap: Map<string, ServiceMetricSummary> = new Map();

      for (const service of services) {
        const serviceId: string = service.id?.toString() || "";
        summaryMap.set(serviceId, {
          service,
          metricCount: 0,
          metricNames: [],
          metricUnits: [],
          metricDescriptions: [],
          hasSystemMetrics: false,
          hasAppMetrics: false,
        });
      }

      for (const metric of metrics) {
        const metricServices: Array<Service> = metric.services || [];
        const cat: string = categorizeMetric(metric.name || "");

        for (const metricService of metricServices) {
          const serviceId: string =
            metricService._id?.toString() || metricService.id?.toString() || "";
          let summary: ServiceMetricSummary | undefined =
            summaryMap.get(serviceId);

          if (!summary) {
            summary = {
              service: metricService,
              metricCount: 0,
              metricNames: [],
              metricUnits: [],
              metricDescriptions: [],
              hasSystemMetrics: false,
              hasAppMetrics: false,
            };
            summaryMap.set(serviceId, summary);
          }

          summary.metricCount += 1;

          if (cat === "System") {
            summary.hasSystemMetrics = true;
          } else {
            summary.hasAppMetrics = true;
          }

          const metricName: string = metric.name || "";
          if (metricName && summary.metricNames.length < 6) {
            summary.metricNames.push(metricName);
          }
        }
      }

      const summariesWithData: Array<ServiceMetricSummary> = Array.from(
        summaryMap.values(),
      ).filter((s: ServiceMetricSummary) => {
        return s.metricCount > 0;
      });

      const noMetricsCount: number = services.length - summariesWithData.length;
      setServicesWithNoMetrics(noMetricsCount);

      // Sort by metric count descending
      summariesWithData.sort(
        (a: ServiceMetricSummary, b: ServiceMetricSummary) => {
          return b.metricCount - a.metricCount;
        },
      );

      setServiceSummaries(summariesWithData);
    } catch (err) {
      setError(API.getFriendlyMessage(err as Error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, []);

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
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No metrics data yet
        </h3>
        <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
          Once your services start sending metrics via OpenTelemetry, you{"'"}ll
          see coverage, categories, and per-service breakdowns here.
        </p>
      </div>
    );
  }

  const maxMetrics: number = Math.max(
    ...serviceSummaries.map((s: ServiceMetricSummary) => {
      return s.metricCount;
    }),
  );

  return (
    <Fragment>
      {/* Hero Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Total Metrics</p>
            <div className="h-9 w-9 rounded-lg bg-indigo-50 flex items-center justify-center">
              <svg
                className="h-4.5 w-4.5 text-indigo-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {totalMetricCount}
          </p>
          <p className="text-xs text-gray-400 mt-1">unique metric types</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">
              Services Reporting
            </p>
            <div className="h-9 w-9 rounded-lg bg-green-50 flex items-center justify-center">
              <svg
                className="h-4.5 w-4.5 text-green-600"
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
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {serviceSummaries.length}
          </p>
          <p className="text-xs text-gray-400 mt-1">actively sending data</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Avg per Service</p>
            <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <svg
                className="h-4.5 w-4.5 text-blue-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z"
                />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {serviceSummaries.length > 0
              ? Math.round(totalMetricCount / serviceSummaries.length)
              : 0}
          </p>
          <p className="text-xs text-gray-400 mt-1">metrics per service</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">No Metrics</p>
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center ${servicesWithNoMetrics > 0 ? "bg-amber-50" : "bg-gray-50"}`}
            >
              <svg
                className={`h-4.5 w-4.5 ${servicesWithNoMetrics > 0 ? "text-amber-600" : "text-gray-400"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
          </div>
          <p
            className={`text-3xl font-bold mt-2 ${servicesWithNoMetrics > 0 ? "text-amber-600" : "text-gray-900"}`}
          >
            {servicesWithNoMetrics}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {servicesWithNoMetrics > 0
              ? "services not instrumented"
              : "all services covered"}
          </p>
        </div>
      </div>

      {/* Metric Categories */}
      {metricCategories.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Metric Categories
          </h3>
          <div className="flex flex-wrap gap-3">
            {metricCategories.map((cat: MetricCategory) => {
              const pct: number =
                totalMetricCount > 0
                  ? Math.round((cat.count / totalMetricCount) * 100)
                  : 0;
              return (
                <div
                  key={cat.name}
                  className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg ${cat.bgColor}`}
                >
                  <span className={`text-sm font-semibold ${cat.color}`}>
                    {cat.count}
                  </span>
                  <span className={`text-sm ${cat.color}`}>{cat.name}</span>
                  <span className={`text-xs ${cat.color} opacity-60`}>
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
          {/* Category distribution bar */}
          <div className="flex h-2 rounded-full overflow-hidden mt-3">
            {metricCategories.map((cat: MetricCategory) => {
              const pct: number =
                totalMetricCount > 0 ? (cat.count / totalMetricCount) * 100 : 0;
              const barColorMap: Record<string, string> = {
                System: "bg-blue-400",
                Request: "bg-purple-400",
                Database: "bg-amber-400",
                Messaging: "bg-green-400",
                Custom: "bg-gray-300",
              };
              return (
                <div
                  key={cat.name}
                  className={`${barColorMap[cat.name] || "bg-gray-300"}`}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Service Cards */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              Services Reporting Metrics
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Coverage and instrumentation per service
            </p>
          </div>
          <AppLink
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.METRICS_LIST] as Route,
            )}
          >
            View all metrics
          </AppLink>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {serviceSummaries.map((summary: ServiceMetricSummary) => {
            const coverage: number =
              maxMetrics > 0
                ? Math.round((summary.metricCount / maxMetrics) * 100)
                : 0;

            return (
              <AppLink
                key={
                  summary.service.id?.toString() ||
                  summary.service._id?.toString()
                }
                className="block"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW_METRICS] as Route,
                  {
                    modelId: new ObjectID(
                      (summary.service._id as string) ||
                        summary.service.id?.toString() ||
                        "",
                    ),
                  },
                )}
              >
                <div className="rounded-xl border border-gray-200 bg-white p-5 hover:border-indigo-200 hover:shadow-md transition-all duration-200">
                  <div className="flex items-start justify-between mb-4">
                    <ServiceElement service={summary.service} />
                    <div className="flex items-center gap-1.5">
                      {summary.hasSystemMetrics && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                          System
                        </span>
                      )}
                      {summary.hasAppMetrics && (
                        <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                          App
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metric count with relative bar */}
                  <div className="mb-4">
                    <div className="flex items-end justify-between mb-1.5">
                      <span className="text-2xl font-bold text-gray-900">
                        {summary.metricCount}
                      </span>
                      <span className="text-xs text-gray-400 mb-1">
                        metrics
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-400 transition-all duration-500"
                        style={{ width: `${Math.max(coverage, 3)}%` }}
                      />
                    </div>
                  </div>

                  {/* Metric name tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {summary.metricNames.map((name: string) => {
                      return (
                        <span
                          key={name}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-600 border border-gray-100"
                        >
                          {name}
                        </span>
                      );
                    })}
                    {summary.metricCount > summary.metricNames.length && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-400">
                        +{summary.metricCount - summary.metricNames.length} more
                      </span>
                    )}
                  </div>
                </div>
              </AppLink>
            );
          })}
        </div>
      </div>
    </Fragment>
  );
};

export default MetricsDashboard;
