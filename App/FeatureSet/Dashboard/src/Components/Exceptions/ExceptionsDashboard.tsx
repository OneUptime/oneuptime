import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Service from "Common/Models/DatabaseModels/Service";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { APP_API_URL } from "Common/UI/Config";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
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

interface DashboardData {
  unresolvedCount: number;
  resolvedCount: number;
  archivedCount: number;
  topExceptions: Array<TelemetryException>;
  recentExceptions: Array<TelemetryException>;
  serviceSummaries: Array<ServiceExceptionSummary>;
}

type Severity = "calm" | "info" | "warning" | "critical";

const severityFromUnresolved: (count: number) => Severity = (
  count: number,
): Severity => {
  if (count === 0) {
    return "calm";
  }
  if (count > 20) {
    return "critical";
  }
  if (count > 5) {
    return "warning";
  }
  return "info";
};

const exceptionDetailRoute: (
  exception: TelemetryException,
) => Route = (exception: TelemetryException): Route => {
  if (exception.id) {
    return new Route(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_VIEW_ROOT] as Route,
      )
        .toString()
        .replace(/\/?$/, `/${exception.id.toString()}`),
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
  );
};

const ExceptionsDashboard: FunctionComponent = (): ReactElement => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadDashboard: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/telemetry-exception/dashboard-summary`,
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const body: JSONObject = response.data || {};

      const topExceptions: Array<TelemetryException> = BaseModel.fromJSONArray(
        (body["topExceptions"] as JSONArray) || [],
        TelemetryException,
      );

      const recentExceptions: Array<TelemetryException> =
        BaseModel.fromJSONArray(
          (body["recentExceptions"] as JSONArray) || [],
          TelemetryException,
        );

      const rawSummaries: JSONArray =
        (body["serviceSummaries"] as JSONArray) || [];

      const serviceSummaries: Array<ServiceExceptionSummary> = rawSummaries.map(
        (raw: JSONObject | unknown): ServiceExceptionSummary => {
          const entry: JSONObject = (raw as JSONObject) || {};
          const service: Service = BaseModel.fromJSONObject(
            (entry["service"] as JSONObject) || {},
            Service,
          );
          return {
            service,
            unresolvedCount: Number(entry["unresolvedCount"] || 0),
            totalOccurrences: Number(entry["totalOccurrences"] || 0),
          };
        },
      );

      setData({
        unresolvedCount: Number(body["unresolvedCount"] || 0),
        resolvedCount: Number(body["resolvedCount"] || 0),
        archivedCount: Number(body["archivedCount"] || 0),
        topExceptions,
        recentExceptions,
        serviceSummaries,
      });
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

  if (!data) {
    return <PageLoader isVisible={true} />;
  }

  const {
    unresolvedCount,
    resolvedCount,
    archivedCount,
    topExceptions,
    recentExceptions,
    serviceSummaries,
  } = data;

  const totalCount: number = unresolvedCount + resolvedCount + archivedCount;

  if (totalCount === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-16 text-center">
        <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center mb-5 ring-8 ring-emerald-50/40">
          <Icon
            icon={IconProp.CheckCircle}
            className="text-emerald-500 h-7 w-7"
          />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No exceptions yet
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

  const now: Date = OneUptimeDate.getCurrentDate();
  const oneDayAgo: Date = OneUptimeDate.addRemoveHours(now, -24);
  const newTodayCount: number = topExceptions.filter(
    (e: TelemetryException) => {
      return e.firstSeenAt && new Date(e.firstSeenAt) > oneDayAgo;
    },
  ).length;

  const maxServiceBugs: number =
    serviceSummaries.length > 0 ? serviceSummaries[0]!.unresolvedCount : 1;

  const severity: Severity = severityFromUnresolved(unresolvedCount);

  const heroStyles: Record<
    Severity,
    {
      bg: string;
      border: string;
      iconBg: string;
      iconRing: string;
      iconColor: string;
      title: string;
      subtitle: string;
      chevron: string;
      pulse: string;
    }
  > = {
    calm: {
      bg: "bg-emerald-50/60",
      border: "border-emerald-100",
      iconBg: "bg-emerald-100",
      iconRing: "ring-emerald-50",
      iconColor: "text-emerald-600",
      title: "text-emerald-900",
      subtitle: "text-emerald-700/80",
      chevron: "text-emerald-400",
      pulse: "bg-emerald-400",
    },
    info: {
      bg: "bg-sky-50/60",
      border: "border-sky-100",
      iconBg: "bg-sky-100",
      iconRing: "ring-sky-50",
      iconColor: "text-sky-600",
      title: "text-sky-900",
      subtitle: "text-sky-700/80",
      chevron: "text-sky-400",
      pulse: "bg-sky-400",
    },
    warning: {
      bg: "bg-amber-50/60",
      border: "border-amber-100",
      iconBg: "bg-amber-100",
      iconRing: "ring-amber-50",
      iconColor: "text-amber-600",
      title: "text-amber-900",
      subtitle: "text-amber-700/80",
      chevron: "text-amber-400",
      pulse: "bg-amber-400",
    },
    critical: {
      bg: "bg-rose-50/60",
      border: "border-rose-100",
      iconBg: "bg-rose-100",
      iconRing: "ring-rose-50",
      iconColor: "text-rose-600",
      title: "text-rose-900",
      subtitle: "text-rose-700/80",
      chevron: "text-rose-400",
      pulse: "bg-rose-400",
    },
  };

  const hero: (typeof heroStyles)[Severity] = heroStyles[severity];

  const heroTitle: string =
    unresolvedCount === 0
      ? "All bugs handled"
      : `${unresolvedCount.toLocaleString()} unresolved ${
          unresolvedCount === 1 ? "bug" : "bugs"
        } need attention`;

  const heroSubtitle: string =
    unresolvedCount === 0
      ? `${(resolvedCount + archivedCount).toLocaleString()} ${
          resolvedCount + archivedCount === 1 ? "bug has" : "bugs have"
        } been resolved or archived`
      : newTodayCount > 0
        ? `${newTodayCount} new in the last 24 hours · Click to triage`
        : "Click to view and triage";

  return (
    <Fragment>
      {/* Hero status banner — always visible, severity-aware */}
      <AppLink
        className="block mb-6 group"
        to={RouteUtil.populateRouteParams(
          RouteMap[
            unresolvedCount > 0
              ? PageMap.EXCEPTIONS_UNRESOLVED
              : PageMap.EXCEPTIONS_RESOLVED
          ] as Route,
        )}
      >
        <div
          className={`relative overflow-hidden rounded-2xl border ${hero.border} ${hero.bg} px-5 py-4 flex items-center justify-between transition-shadow group-hover:shadow-sm`}
        >
          <div className="flex items-center gap-4 min-w-0">
            <div
              className={`relative h-11 w-11 shrink-0 rounded-xl ${hero.iconBg} ring-4 ${hero.iconRing} flex items-center justify-center`}
            >
              <Icon
                icon={
                  unresolvedCount === 0 ? IconProp.CheckCircle : IconProp.Bug
                }
                className={`${hero.iconColor} h-5 w-5`}
              />
              {unresolvedCount > 0 && (
                <span
                  className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${hero.pulse} ring-2 ring-white`}
                />
              )}
            </div>
            <div className="min-w-0">
              <p
                className={`text-sm font-semibold ${hero.title} truncate`}
              >
                {heroTitle}
              </p>
              <p className={`text-xs mt-0.5 ${hero.subtitle}`}>
                {heroSubtitle}
              </p>
            </div>
          </div>
          <Icon
            icon={IconProp.ChevronRight}
            className={`${hero.chevron} h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5`}
          />
        </div>
      </AppLink>

      {/* Stat strip — unified card, thin dividers */}
      <div className="rounded-2xl border border-gray-200 bg-white mb-6 overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100">
          <StatCell
            label="Unresolved"
            value={unresolvedCount}
            sublabel={unresolvedCount === 1 ? "bug" : "bugs"}
            valueClassName="text-rose-600"
            accent="bg-rose-500"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
            )}
          />
          <StatCell
            label="Resolved"
            value={resolvedCount}
            sublabel={resolvedCount === 1 ? "fix shipped" : "fixes shipped"}
            valueClassName="text-emerald-600"
            accent="bg-emerald-500"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route,
            )}
          />
          <StatCell
            label="Archived"
            value={archivedCount}
            sublabel="dismissed"
            valueClassName="text-gray-700"
            accent="bg-gray-400"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route,
            )}
          />
          <div className="p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider font-medium text-gray-500">
                Resolution rate
              </span>
            </div>
            <p className="text-3xl font-semibold text-gray-900 mt-3 tabular-nums">
              {resolutionRate}
              <span className="text-base font-medium text-gray-400 ml-0.5">
                %
              </span>
            </p>
            <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mt-3">
              <div
                className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                style={{ width: `${resolutionRate}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Most Frequent Bugs */}
        {topExceptions.length > 0 && (
          <div className="lg:col-span-2">
            <SectionHeader
              dot="bg-rose-500"
              title="Most frequent bugs"
              subtitle="Sorted by occurrence count"
              actionLabel="View all"
              actionTo={RouteUtil.populateRouteParams(
                RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
              )}
            />
            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {topExceptions.map(
                  (exception: TelemetryException, index: number) => {
                    const maxOccurrences: number =
                      topExceptions[0]?.occuranceCount || 1;
                    const barWidth: number = Math.max(
                      ((exception.occuranceCount || 0) / maxOccurrences) * 100,
                      2,
                    );

                    const isNewToday: boolean = Boolean(
                      exception.firstSeenAt &&
                        new Date(exception.firstSeenAt) > oneDayAgo,
                    );

                    return (
                      <li
                        key={exception.id?.toString() || index.toString()}
                        className="relative"
                      >
                        <AppLink
                          className="block px-5 py-3.5 hover:bg-gray-50/70 transition-colors"
                          to={exceptionDetailRoute(exception)}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1.5">
                                <TelemetryExceptionElement
                                  message={
                                    exception.message ||
                                    exception.exceptionType ||
                                    "Unknown exception"
                                  }
                                  isResolved={exception.isResolved || false}
                                  isArchived={exception.isArchived || false}
                                  className="text-sm font-medium text-gray-900"
                                />
                                {isNewToday && (
                                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded-md font-semibold">
                                    <span className="h-1 w-1 rounded-full bg-sky-500" />
                                    New
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs">
                                {exception.exceptionType && (
                                  <span className="font-mono text-[11px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                    {exception.exceptionType}
                                  </span>
                                )}
                                {exception.service && (
                                  <span className="inline-flex items-center gap-1.5 text-gray-600">
                                    <span
                                      className="h-1.5 w-1.5 rounded-full"
                                      style={{
                                        backgroundColor:
                                          exception.service.serviceColor?.toString() ||
                                          "#9ca3af",
                                      }}
                                    />
                                    {exception.service.name?.toString()}
                                  </span>
                                )}
                                {exception.environment && (
                                  <span className="text-gray-500">
                                    · {exception.environment}
                                  </span>
                                )}
                                {exception.lastSeenAt && (
                                  <span className="text-gray-400">
                                    · {OneUptimeDate.fromNow(
                                      new Date(exception.lastSeenAt),
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-semibold text-gray-900 tabular-nums">
                                {(
                                  exception.occuranceCount || 0
                                ).toLocaleString()}
                              </p>
                              <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">
                                hits
                              </p>
                            </div>
                          </div>
                          <div className="mt-2.5 h-0.5 w-full bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-500 transition-[width] duration-500"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </AppLink>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Right sidebar */}
        <div className="space-y-6">
          {serviceSummaries.length > 0 && (
            <div>
              <SectionHeader
                dot="bg-amber-500"
                title="Affected services"
                subtitle={`${serviceSummaries.length} ${serviceSummaries.length === 1 ? "service has" : "services have"} open bugs`}
              />
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <ul className="divide-y divide-gray-100">
                  {serviceSummaries.map((summary: ServiceExceptionSummary) => {
                    const barWidth: number = Math.max(
                      (summary.unresolvedCount / maxServiceBugs) * 100,
                      4,
                    );
                    const serviceColor: string =
                      summary.service.serviceColor?.toString() || "#9ca3af";

                    return (
                      <li
                        key={summary.service.id?.toString()}
                        className="px-4 py-3 hover:bg-gray-50/70 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: serviceColor }}
                            />
                            <span className="text-sm font-medium text-gray-800 truncate">
                              {summary.service.name?.toString()}
                            </span>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="text-sm font-semibold text-gray-900 tabular-nums">
                              {summary.unresolvedCount}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide text-gray-400 ml-1">
                              {summary.unresolvedCount === 1 ? "bug" : "bugs"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-[width] duration-500"
                              style={{
                                width: `${barWidth}%`,
                                backgroundColor: serviceColor,
                              }}
                            />
                          </div>
                          <span className="text-[11px] tabular-nums text-gray-400 shrink-0">
                            {summary.totalOccurrences.toLocaleString()} hits
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {recentExceptions.length > 0 && (
            <div>
              <SectionHeader
                dot="bg-sky-500"
                title="Recently active"
                subtitle="Last seen first"
              />
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <ul className="divide-y divide-gray-100">
                  {recentExceptions.map(
                    (exception: TelemetryException, index: number) => {
                      return (
                        <li
                          key={exception.id?.toString() || index.toString()}
                        >
                          <AppLink
                            className="block px-4 py-3 hover:bg-gray-50/70 transition-colors"
                            to={exceptionDetailRoute(exception)}
                          >
                            <p className="text-sm text-gray-900 truncate font-medium">
                              {exception.message ||
                                exception.exceptionType ||
                                "Unknown"}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 text-xs">
                              {exception.service && (
                                <span className="inline-flex items-center gap-1.5 text-gray-600">
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{
                                      backgroundColor:
                                        exception.service.serviceColor?.toString() ||
                                        "#9ca3af",
                                    }}
                                  />
                                  {exception.service.name?.toString()}
                                </span>
                              )}
                              {exception.lastSeenAt && (
                                <span className="text-gray-400">
                                  · {OneUptimeDate.fromNow(
                                    new Date(exception.lastSeenAt),
                                  )}
                                </span>
                              )}
                            </div>
                          </AppLink>
                        </li>
                      );
                    },
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </Fragment>
  );
};

interface StatCellProps {
  label: string;
  value: number;
  sublabel: string;
  valueClassName: string;
  accent: string;
  to: Route;
}

const StatCell: FunctionComponent<StatCellProps> = (
  props: StatCellProps,
): ReactElement => {
  return (
    <AppLink className="block group" to={props.to}>
      <div className="p-5 h-full hover:bg-gray-50/60 transition-colors">
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-wider font-medium text-gray-500">
            {props.label}
          </span>
          <span className={`h-1.5 w-1.5 rounded-full ${props.accent}`} />
        </div>
        <p
          className={`text-3xl font-semibold mt-3 tabular-nums ${props.valueClassName}`}
        >
          {props.value.toLocaleString()}
        </p>
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
          {props.sublabel}
          <Icon
            icon={IconProp.ChevronRight}
            size={SizeProp.ExtraSmall}
            className="opacity-0 group-hover:opacity-100 transition-opacity h-3 w-3"
          />
        </p>
      </div>
    </AppLink>
  );
};

interface SectionHeaderProps {
  dot: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  actionTo?: Route;
}

const SectionHeader: FunctionComponent<SectionHeaderProps> = (
  props: SectionHeaderProps,
): ReactElement => {
  return (
    <div className="flex items-end justify-between mb-3 px-0.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`h-1.5 w-1.5 rounded-full ${props.dot}`} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {props.title}
          </h3>
          {props.subtitle && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {props.subtitle}
            </p>
          )}
        </div>
      </div>
      {props.actionLabel && props.actionTo && (
        <AppLink
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 shrink-0"
          to={props.actionTo}
        >
          <span>{`${props.actionLabel} →`}</span>
        </AppLink>
      )}
    </div>
  );
};

export default ExceptionsDashboard;
