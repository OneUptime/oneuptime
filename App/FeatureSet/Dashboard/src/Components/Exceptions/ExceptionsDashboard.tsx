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
import OneUptimeDate from "Common/Types/Date";
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
  const [recentExceptions, setRecentExceptions] = useState<
    Array<TelemetryException>
  >([]);
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

      const [
        unresolvedResult,
        resolvedResult,
        archivedResult,
        topExceptionsResult,
        recentExceptionsResult,
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
          limit: 8,
          skip: 0,
          sort: {
            lastSeenAt: SortOrder.Descending,
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
      setRecentExceptions(recentExceptionsResult.data || []);

      const loadedServices: Array<Service> = servicesResult.data || [];

      // Load unresolved exception counts per service
      const serviceExceptionCounts: Array<ServiceExceptionSummary> = [];

      for (const service of loadedServices) {
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
      <div className="rounded-xl border border-gray-200 bg-white p-16 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mb-5">
          <svg
            className="h-8 w-8 text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No exceptions caught yet
        </h3>
        <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
          Once your services start reporting exceptions, you{"'"}ll see bug
          frequency, affected services, and resolution status here.
        </p>
      </div>
    );
  }

  const resolutionRate: number =
    totalCount > 0
      ? Math.round(((resolvedCount + archivedCount) / totalCount) * 100)
      : 0;

  // Count how many of the top exceptions were first seen in last 24h
  const now: Date = OneUptimeDate.getCurrentDate();
  const oneDayAgo: Date = OneUptimeDate.addRemoveHours(now, -24);
  const newTodayCount: number = topExceptions.filter(
    (e: TelemetryException) => {
      return e.firstSeenAt && new Date(e.firstSeenAt) > oneDayAgo;
    },
  ).length;

  const maxServiceBugs: number =
    serviceSummaries.length > 0 ? serviceSummaries[0]!.unresolvedCount : 1;

  return (
    <Fragment>
      {/* Unresolved Alert Banner */}
      {unresolvedCount > 0 && (
        <AppLink
          className="block mb-6"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
          )}
        >
          <div
            className={`rounded-xl p-4 flex items-center justify-between ${unresolvedCount > 20 ? "bg-red-50 border border-red-200" : unresolvedCount > 5 ? "bg-amber-50 border border-amber-200" : "bg-blue-50 border border-blue-200"}`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center ${unresolvedCount > 20 ? "bg-red-100" : unresolvedCount > 5 ? "bg-amber-100" : "bg-blue-100"}`}
              >
                <svg
                  className={`h-5 w-5 ${unresolvedCount > 20 ? "text-red-600" : unresolvedCount > 5 ? "text-amber-600" : "text-blue-600"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0112 12.75zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 01-1.152 6.06M12 12.75c-2.883 0-5.647.508-8.208 1.44.125 2.104.52 4.136 1.153 6.06M12 12.75a2.25 2.25 0 002.248-2.354M12 12.75a2.25 2.25 0 01-2.248-2.354M12 8.25c.995 0 1.971-.08 2.922-.236.403-.066.74-.358.795-.762a3.778 3.778 0 00-.399-2.25M12 8.25c-.995 0-1.97-.08-2.922-.236-.402-.066-.74-.358-.795-.762a3.734 3.734 0 01.4-2.253M12 8.25a2.25 2.25 0 00-2.248 2.146M12 8.25a2.25 2.25 0 012.248 2.146M8.683 5a6.032 6.032 0 01-1.155-1.002c.07-.63.27-1.222.574-1.747m.581 2.749A3.75 3.75 0 0115.318 5m0 0c.427-.283.815-.62 1.155-.999a4.471 4.471 0 00-.575-1.752M4.921 12s-.148-.277-.277-.5M19.08 12s.147-.277.277-.5"
                  />
                </svg>
              </div>
              <div>
                <p
                  className={`text-sm font-semibold ${unresolvedCount > 20 ? "text-red-800" : unresolvedCount > 5 ? "text-amber-800" : "text-blue-800"}`}
                >
                  {unresolvedCount} unresolved{" "}
                  {unresolvedCount === 1 ? "bug" : "bugs"} need attention
                </p>
                <p
                  className={`text-xs mt-0.5 ${unresolvedCount > 20 ? "text-red-600" : unresolvedCount > 5 ? "text-amber-600" : "text-blue-600"}`}
                >
                  {newTodayCount > 0
                    ? `${newTodayCount} new in the last 24 hours`
                    : "Click to view and triage"}
                </p>
              </div>
            </div>
            <svg
              className={`h-5 w-5 ${unresolvedCount > 20 ? "text-red-400" : unresolvedCount > 5 ? "text-amber-400" : "text-blue-400"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 4.5l7.5 7.5-7.5 7.5"
              />
            </svg>
          </div>
        </AppLink>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <AppLink
          className="block"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
          )}
        >
          <div className="rounded-xl border border-gray-200 bg-white p-5 hover:border-red-200 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500">Unresolved</p>
              <div className="h-8 w-8 rounded-lg bg-red-50 flex items-center justify-center">
                <svg
                  className="h-4 w-4 text-red-500"
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
            <p className="text-3xl font-bold text-red-600 mt-2">
              {unresolvedCount.toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">needs attention</p>
          </div>
        </AppLink>

        <AppLink
          className="block"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route,
          )}
        >
          <div className="rounded-xl border border-gray-200 bg-white p-5 hover:border-green-200 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500">Resolved</p>
              <div className="h-8 w-8 rounded-lg bg-green-50 flex items-center justify-center">
                <svg
                  className="h-4 w-4 text-green-500"
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
            <p className="text-3xl font-bold text-green-600 mt-2">
              {resolvedCount.toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">fixed</p>
          </div>
        </AppLink>

        <AppLink
          className="block"
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route,
          )}
        >
          <div className="rounded-xl border border-gray-200 bg-white p-5 hover:border-gray-300 hover:shadow-sm transition-all">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-500">Archived</p>
              <div className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center">
                <svg
                  className="h-4 w-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
                  />
                </svg>
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-600 mt-2">
              {archivedCount.toLocaleString()}
            </p>
            <p className="text-xs text-gray-400 mt-1">dismissed</p>
          </div>
        </AppLink>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Resolution Rate</p>
            <div className="h-8 w-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <svg
                className="h-4 w-4 text-indigo-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941"
                />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {resolutionRate}%
          </p>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
            <div
              className="h-full rounded-full bg-indigo-400"
              style={{ width: `${resolutionRate}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Most Frequent Exceptions - takes 2 columns */}
        {topExceptions.length > 0 && (
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <h3 className="text-base font-semibold text-gray-900">
                  Most Frequent Bugs
                </h3>
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
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="divide-y divide-gray-50">
                {topExceptions.map(
                  (exception: TelemetryException, index: number) => {
                    const maxOccurrences: number =
                      topExceptions[0]?.occuranceCount || 1;
                    const barWidth: number =
                      ((exception.occuranceCount || 0) / maxOccurrences) * 100;

                    const isNewToday: boolean = Boolean(
                      exception.firstSeenAt &&
                        new Date(exception.firstSeenAt) > oneDayAgo,
                    );

                    return (
                      <AppLink
                        key={exception.id?.toString() || index.toString()}
                        className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                        to={
                          exception.id
                            ? new Route(
                                RouteUtil.populateRouteParams(
                                  RouteMap[
                                    PageMap.EXCEPTIONS_VIEW_ROOT
                                  ] as Route,
                                )
                                  .toString()
                                  .replace(/\/?$/, `/${exception.id.toString()}`),
                              )
                            : RouteUtil.populateRouteParams(
                                RouteMap[
                                  PageMap.EXCEPTIONS_UNRESOLVED
                                ] as Route,
                              )
                        }
                      >
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="min-w-0 flex-1 mr-3">
                            <div className="flex items-center gap-2 mb-1">
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
                              {isNewToday && (
                                <span className="flex-shrink-0 text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                                  New
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {exception.service && (
                                <span className="text-xs text-gray-500">
                                  {exception.service.name?.toString()}
                                </span>
                              )}
                              {exception.exceptionType && (
                                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                                  {exception.exceptionType}
                                </span>
                              )}
                              {exception.environment && (
                                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                  {exception.environment}
                                </span>
                              )}
                              {exception.lastSeenAt && (
                                <span className="text-xs text-gray-400">
                                  {OneUptimeDate.fromNow(
                                    new Date(exception.lastSeenAt),
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold text-gray-900">
                              {(exception.occuranceCount || 0).toLocaleString()}
                            </p>
                            <p className="text-xs text-gray-400">hits</p>
                          </div>
                        </div>
                        <div className="mt-1.5">
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

        {/* Right sidebar: Affected Services + Recently Seen */}
        <div className="space-y-6">
          {/* Affected Services */}
          {serviceSummaries.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <h3 className="text-base font-semibold text-gray-900">
                  Affected Services
                </h3>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="divide-y divide-gray-50">
                  {serviceSummaries.map((summary: ServiceExceptionSummary) => {
                    const barWidth: number =
                      (summary.unresolvedCount / maxServiceBugs) * 100;

                    return (
                      <div
                        key={summary.service.id?.toString()}
                        className="px-4 py-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <TelemetryServiceElement
                            telemetryService={summary.service}
                          />
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-sm font-bold text-red-600">
                                {summary.unresolvedCount}
                              </span>
                              <span className="text-xs text-gray-400 ml-1">
                                bugs
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-red-400"
                              style={{
                                width: `${Math.max(barWidth, 3)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {summary.totalOccurrences.toLocaleString()} hits
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Recently Active */}
          {recentExceptions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <h3 className="text-base font-semibold text-gray-900">
                  Recently Active
                </h3>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="divide-y divide-gray-50">
                  {recentExceptions
                    .slice(0, 5)
                    .map((exception: TelemetryException, index: number) => {
                      return (
                        <AppLink
                          key={exception.id?.toString() || index.toString()}
                          className="block px-4 py-3 hover:bg-gray-50 transition-colors"
                          to={
                            exception.id
                              ? new Route(
                                  RouteUtil.populateRouteParams(
                                    RouteMap[
                                      PageMap.EXCEPTIONS_VIEW_ROOT
                                    ] as Route,
                                  )
                                    .toString()
                                    .replace(
                                      /\/?$/,
                                      `/${exception.id.toString()}`,
                                    ),
                                )
                              : RouteUtil.populateRouteParams(
                                  RouteMap[
                                    PageMap.EXCEPTIONS_UNRESOLVED
                                  ] as Route,
                                )
                          }
                        >
                          <p className="text-sm text-gray-900 truncate font-medium">
                            {exception.message ||
                              exception.exceptionType ||
                              "Unknown"}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {exception.service && (
                              <span className="text-xs text-gray-500">
                                {exception.service.name?.toString()}
                              </span>
                            )}
                            {exception.lastSeenAt && (
                              <span className="text-xs text-gray-400">
                                {OneUptimeDate.fromNow(
                                  new Date(exception.lastSeenAt),
                                )}
                              </span>
                            )}
                          </div>
                        </AppLink>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
};

export default ExceptionsDashboard;
