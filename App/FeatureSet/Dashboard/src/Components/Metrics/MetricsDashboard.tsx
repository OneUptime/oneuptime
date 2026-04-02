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
import ListResult from "Common/Types/BaseDatabase/ListResult";
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
}

const MetricsDashboard: FunctionComponent = (): ReactElement => {
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceMetricSummary>
  >([]);
  const [totalMetricCount, setTotalMetricCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadDashboard: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

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

      const services: Array<Service> = servicesResult.data || [];

      // Load all metric types with their services
      const metricsResult: ListResult<MetricType> = await ModelAPI.getList({
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
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {
          name: SortOrder.Ascending,
        },
      });

      const metrics: Array<MetricType> = metricsResult.data || [];
      setTotalMetricCount(metrics.length);

      // Build per-service summaries
      const summaryMap: Map<string, ServiceMetricSummary> = new Map();

      for (const service of services) {
        const serviceId: string = service.id?.toString() || "";
        summaryMap.set(serviceId, {
          service,
          metricCount: 0,
          metricNames: [],
        });
      }

      for (const metric of metrics) {
        const metricServices: Array<Service> = metric.services || [];

        for (const metricService of metricServices) {
          const serviceId: string =
            metricService._id?.toString() || metricService.id?.toString() || "";
          let summary: ServiceMetricSummary | undefined =
            summaryMap.get(serviceId);

          if (!summary) {
            // Service exists in metric but wasn't in our services list
            summary = {
              service: metricService,
              metricCount: 0,
              metricNames: [],
            };
            summaryMap.set(serviceId, summary);
          }

          summary.metricCount += 1;

          const metricName: string = metric.name || "";
          if (metricName && summary.metricNames.length < 5) {
            summary.metricNames.push(metricName);
          }
        }
      }

      // Only show services that have metrics
      const summariesWithData: Array<ServiceMetricSummary> = Array.from(
        summaryMap.values(),
      ).filter((s: ServiceMetricSummary) => {
        return s.metricCount > 0;
      });

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
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
        <div className="text-gray-400 text-5xl mb-4">
          <svg
            className="mx-auto h-16 w-16 text-indigo-200"
            fill="none"
            viewBox="0 0 48 48"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M6 38 L6 20 L12 20 L12 38"
              fill="currentColor"
              opacity={0.4}
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 38 L16 14 L22 14 L22 38"
              fill="currentColor"
              opacity={0.6}
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M26 38 L26 24 L32 24 L32 38"
              fill="currentColor"
              opacity={0.5}
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M36 38 L36 10 L42 10 L42 38"
              fill="currentColor"
              opacity={0.8}
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M4 38 L44 38"
              opacity={0.3}
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No metrics data yet
        </h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Once your services start sending metrics via OpenTelemetry, you{"'"}ll
          see a summary of which services are reporting, what metrics they
          collect, and more.
        </p>
      </div>
    );
  }

  return (
    <Fragment>
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Total Metrics</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {totalMetricCount}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Services Reporting</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {serviceSummaries.length}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="text-sm text-gray-500">Avg Metrics per Service</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {serviceSummaries.length > 0
              ? Math.round(totalMetricCount / serviceSummaries.length)
              : 0}
          </p>
        </div>
      </div>

      {/* Service Cards */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Services Reporting Metrics
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Each service and the metrics it collects
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
            return (
              <div
                key={
                  summary.service.id?.toString() ||
                  summary.service._id?.toString()
                }
                className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <ServiceElement service={summary.service} />
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
                    Active
                  </span>
                </div>

                <div className="mb-3">
                  <p className="text-xs text-gray-500">Metrics Collected</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {summary.metricCount}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1.5">Sample Metrics</p>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.metricNames.map((name: string) => {
                      return (
                        <span
                          key={name}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700"
                        >
                          {name}
                        </span>
                      );
                    })}
                    {summary.metricCount > summary.metricNames.length && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                        +{summary.metricCount - summary.metricNames.length} more
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100">
                  <AppLink
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
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
                    View service metrics
                  </AppLink>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Fragment>
  );
};

export default MetricsDashboard;
