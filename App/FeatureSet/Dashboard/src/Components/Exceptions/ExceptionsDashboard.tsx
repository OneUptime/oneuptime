import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import TelemetryServiceElement from "../TelemetryService/TelemetryServiceElement";
import TelemetryExceptionElement from "./ExceptionElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";

interface ServiceExceptionSummary {
  service: Service;
  unresolvedCount: number;
  totalOccurrences: number;
}

const ExceptionsDashboard: FunctionComponent = (): ReactElement => {
  const [unresolvedCount, setUnresolvedCount] = useState<number>(0);
  const [resolvedCount, setResolvedCount] = useState<number>(0);
  const [archivedCount, setArchivedCount] = useState<number>(0);
  const [topExceptions, setTopExceptions] = useState<Array<TelemetryException>>(
    [],
  );
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceExceptionSummary>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadDashboard: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

      // Load counts, top exceptions, and services in parallel
      const [
        unresolvedResult,
        resolvedResult,
        archivedResult,
        topExceptionsResult,
        servicesResult,
      ] = await Promise.all([
        ModelAPI.count({
          modelType: TelemetryException,
          query: {
            projectId,
            isResolved: false,
            isArchived: false,
          },
        }),
        ModelAPI.count({
          modelType: TelemetryException,
          query: {
            projectId,
            isResolved: true,
            isArchived: false,
          },
        }),
        ModelAPI.count({
          modelType: TelemetryException,
          query: {
            projectId,
            isArchived: true,
          },
        }),
        ModelAPI.getList({
          modelType: TelemetryException,
          query: {
            projectId,
            isResolved: false,
            isArchived: false,
          },
          select: {
            message: true,
            exceptionType: true,
            fingerprint: true,
            isResolved: true,
            isArchived: true,
            occuranceCount: true,
            lastSeenAt: true,
            firstSeenAt: true,
            environment: true,
            service: {
              name: true,
              serviceColor: true,
            } as any,
          },
          limit: 10,
          skip: 0,
          sort: {
            occuranceCount: SortOrder.Descending,
          },
        }),
        ModelAPI.getList({
          modelType: Service,
          query: {
            projectId,
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
      ]);

      setUnresolvedCount(unresolvedResult);
      setResolvedCount(resolvedResult);
      setArchivedCount(archivedResult);
      setTopExceptions(topExceptionsResult.data || []);

      const loadedServices: Array<Service> = servicesResult.data || [];

      // Load unresolved exception counts per service
      const serviceExceptionCounts: Array<ServiceExceptionSummary> = [];

      for (const service of loadedServices) {
        // Get unresolved exceptions for this service
        const serviceExceptions: ListResult<TelemetryException> =
          await ModelAPI.getList({
            modelType: TelemetryException,
            query: {
              projectId,
              serviceId: service.id!,
              isResolved: false,
              isArchived: false,
            },
            select: {
              occuranceCount: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: {
              occuranceCount: SortOrder.Descending,
            },
          });

        const exceptions: Array<TelemetryException> =
          serviceExceptions.data || [];

        if (exceptions.length > 0) {
          let totalOccurrences: number = 0;

          for (const ex of exceptions) {
            totalOccurrences += ex.occuranceCount || 0;
          }

          serviceExceptionCounts.push({
            service,
            unresolvedCount: exceptions.length,
            totalOccurrences,
          });
        }
      }

      // Sort by unresolved count descending
      serviceExceptionCounts.sort(
        (a: ServiceExceptionSummary, b: ServiceExceptionSummary) => {
          return b.unresolvedCount - a.unresolvedCount;
        },
      );

      setServiceSummaries(serviceExceptionCounts);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
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

  const totalCount: number = unresolvedCount + resolvedCount + archivedCount;

  if (totalCount === 0) {
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
              d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152 6.06M12 12.75c-2.883 0-5.647.508-8.208 1.44.125 2.104.52 4.136 1.153 6.06M12 12.75a2.25 2.25 0 002.248-2.354M12 12.75a2.25 2.25 0 01-2.248-2.354M12 8.25c.995 0 1.971-.08 2.922-.236.403-.066.74-.358.795-.762a3.778 3.778 0 00-.399-2.25M12 8.25c-.995 0-1.97-.08-2.922-.236-.402-.066-.74-.358-.795-.762a3.734 3.734 0 01.4-2.253M12 8.25a2.25 2.25 0 00-2.248 2.146M12 8.25a2.25 2.25 0 012.248 2.146M8.683 5a6.032 6.032 0 01-1.155-1.002c.07-.63.27-1.222.574-1.747m.581 2.749A3.75 3.75 0 0115.318 5m0 0c.427-.283.815-.62 1.155-.999a4.471 4.471 0 00-.575-1.752M4.921 12s-.148-.277-.277-.5M19.08 12s.147-.277.277-.5"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No exceptions caught yet
        </h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Once your services start reporting exceptions, you{"'"}ll see a
          summary of bugs, their frequency, and which services are most
          affected.
        </p>
      </div>
    );
  }

  return (
    <Fragment>
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <AppLink
          className="block"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
          )}
        >
          <div className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Unresolved Bugs</p>
                <p className="text-3xl font-bold text-red-600 mt-1">
                  {unresolvedCount.toLocaleString()}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-red-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">Needs attention</p>
          </div>
        </AppLink>

        <AppLink
          className="block"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route,
          )}
        >
          <div className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Resolved</p>
                <p className="text-3xl font-bold text-green-600 mt-1">
                  {resolvedCount.toLocaleString()}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-50 flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">Fixed and verified</p>
          </div>
        </AppLink>

        <AppLink
          className="block"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route,
          )}
        >
          <div className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Archived</p>
                <p className="text-3xl font-bold text-gray-600 mt-1">
                  {archivedCount.toLocaleString()}
                </p>
              </div>
              <div className="h-12 w-12 rounded-full bg-gray-50 flex items-center justify-center">
                <svg
                  className="h-6 w-6 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                  />
                </svg>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Dismissed or won{"'"}t fix
            </p>
          </div>
        </AppLink>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Frequent Exceptions */}
        {topExceptions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Most Frequent Bugs
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Unresolved exceptions with the highest occurrence count
                </p>
              </div>
              <AppLink
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
                )}
              >
                View all
              </AppLink>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-100">
                {topExceptions.map(
                  (exception: TelemetryException, index: number) => {
                    const maxOccurrences: number =
                      topExceptions[0]?.occuranceCount || 1;
                    const barWidth: number =
                      ((exception.occuranceCount || 0) / maxOccurrences) * 100;

                    return (
                      <AppLink
                        key={exception.id?.toString() || index.toString()}
                        className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                        to={
                          exception.fingerprint
                            ? new Route(
                                RouteUtil.populateRouteParams(
                                  RouteMap[
                                    PageMap.EXCEPTIONS_VIEW_ROOT
                                  ] as Route,
                                )
                                  .toString()
                                  .replace(/\/$/, `/${exception.fingerprint}`),
                              )
                            : RouteUtil.populateRouteParams(
                                RouteMap[
                                  PageMap.EXCEPTIONS_UNRESOLVED
                                ] as Route,
                              )
                        }
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="min-w-0 flex-1 mr-3">
                            <TelemetryExceptionElement
                              message={
                                exception.message ||
                                exception.exceptionType ||
                                "Unknown exception"
                              }
                              isResolved={exception.isResolved || false}
                              isArchived={exception.isArchived || false}
                              className="text-sm"
                            />
                            <div className="flex items-center space-x-3 mt-1">
                              {exception.service && (
                                <span className="text-xs text-gray-500">
                                  {exception.service.name?.toString()}
                                </span>
                              )}
                              {exception.environment && (
                                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                  {exception.environment}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold text-gray-900">
                              {(exception.occuranceCount || 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-400">occurrences</p>
                          </div>
                        </div>
                        <div className="mt-1">
                          <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-red-400"
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
          </div>
        )}

        {/* Services Affected */}
        {serviceSummaries.length > 0 && (
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Affected Services
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Services with unresolved exceptions
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-100">
                {serviceSummaries.map((summary: ServiceExceptionSummary) => {
                  return (
                    <div
                      key={summary.service.id?.toString()}
                      className="px-4 py-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <TelemetryServiceElement
                          telemetryService={summary.service}
                        />
                        <div className="flex items-center space-x-4">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-red-600">
                              {summary.unresolvedCount}
                            </p>
                            <p className="text-xs text-gray-400">unresolved</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-700">
                              {summary.totalOccurrences.toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-400">total hits</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Fragment>
  );
};

export default ExceptionsDashboard;
