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
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Profile from "Common/Models/AnalyticsModels/Profile";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceElement from "../Service/ServiceElement";
import ProfileUtil from "../../Utils/ProfileUtil";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";

interface ServiceProfileSummary {
  service: Service;
  profileCount: number;
  latestProfileTime: Date | null;
  profileTypes: Array<string>;
  totalSamples: number;
}

interface FunctionHotspot {
  functionName: string;
  fileName: string;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  frameType: string;
}

interface ProfileTypeStats {
  type: string;
  count: number;
  displayName: string;
  badgeColor: string;
}

const ProfilesDashboard: FunctionComponent = (): ReactElement => {
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceProfileSummary>
  >([]);
  const [hotspots, setHotspots] = useState<Array<FunctionHotspot>>([]);
  const [profileTypeStats, setProfileTypeStats] = useState<
    Array<ProfileTypeStats>
  >([]);
  const [totalProfileCount, setTotalProfileCount] = useState<number>(0);
  const [totalSampleCount, setTotalSampleCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadDashboard: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const now: Date = OneUptimeDate.getCurrentDate();
      const oneHourAgo: Date = OneUptimeDate.addRemoveHours(now, -1);

      const [servicesResult, profilesResult] = await Promise.all([
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
          modelType: Profile,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            startTime: new InBetween(oneHourAgo, now),
          },
          select: {
            serviceId: true,
            profileType: true,
            startTime: true,
            sampleCount: true,
          },
          limit: 5000,
          skip: 0,
          sort: {
            startTime: SortOrder.Descending,
          },
        }),
      ]);

      const services: Array<Service> = servicesResult.data || [];
      const profiles: Array<Profile> = profilesResult.data || [];

      setTotalProfileCount(profiles.length);

      // Build per-service summaries
      const summaryMap: Map<string, ServiceProfileSummary> = new Map();
      const typeCountMap: Map<string, number> = new Map();
      let totalSamples: number = 0;

      for (const service of services) {
        const serviceId: string = service.id?.toString() || "";
        summaryMap.set(serviceId, {
          service,
          profileCount: 0,
          latestProfileTime: null,
          profileTypes: [],
          totalSamples: 0,
        });
      }

      for (const profile of profiles) {
        const serviceId: string = profile.serviceId?.toString() || "";
        const summary: ServiceProfileSummary | undefined =
          summaryMap.get(serviceId);

        if (!summary) {
          continue;
        }

        summary.profileCount += 1;

        const samples: number = (profile.sampleCount as number) || 0;
        summary.totalSamples += samples;
        totalSamples += samples;

        const profileTime: Date | undefined = profile.startTime
          ? new Date(profile.startTime)
          : undefined;

        if (
          profileTime &&
          (!summary.latestProfileTime ||
            profileTime > summary.latestProfileTime)
        ) {
          summary.latestProfileTime = profileTime;
        }

        const profileType: string = profile.profileType || "";
        if (profileType && !summary.profileTypes.includes(profileType)) {
          summary.profileTypes.push(profileType);
        }

        // Track global type stats
        typeCountMap.set(profileType, (typeCountMap.get(profileType) || 0) + 1);
      }

      setTotalSampleCount(totalSamples);

      // Build profile type stats
      const typeStats: Array<ProfileTypeStats> = Array.from(
        typeCountMap.entries(),
      )
        .map(([type, count]: [string, number]) => {
          return {
            type,
            count,
            displayName: ProfileUtil.getProfileTypeDisplayName(type),
            badgeColor: ProfileUtil.getProfileTypeBadgeColor(type),
          };
        })
        .sort((a: ProfileTypeStats, b: ProfileTypeStats) => {
          return b.count - a.count;
        });

      setProfileTypeStats(typeStats);

      // Only show services that have profiles
      const summariesWithData: Array<ServiceProfileSummary> = Array.from(
        summaryMap.values(),
      ).filter((s: ServiceProfileSummary) => {
        return s.profileCount > 0;
      });

      summariesWithData.sort(
        (a: ServiceProfileSummary, b: ServiceProfileSummary) => {
          return b.profileCount - a.profileCount;
        },
      );

      setServiceSummaries(summariesWithData);

      // Load top hotspots
      try {
        const hotspotsResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/profiles/function-list",
            ),
            data: {
              startTime: oneHourAgo.toISOString(),
              endTime: now.toISOString(),
              limit: 10,
              sortBy: "selfValue",
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (hotspotsResponse instanceof HTTPErrorResponse) {
          throw hotspotsResponse;
        }

        const functions: Array<FunctionHotspot> = (hotspotsResponse.data[
          "functions"
        ] || []) as unknown as Array<FunctionHotspot>;
        setHotspots(functions);
      } catch {
        setHotspots([]);
      }
    } catch (err) {
      setError(API.getFriendlyErrorMessage(err as Error));
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
              d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          No profiling data yet
        </h3>
        <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">
          Once your services start sending profiling data, you{"'"}ll see
          performance hotspots, resource usage patterns, and optimization
          opportunities.
        </p>
      </div>
    );
  }

  const maxProfiles: number = Math.max(
    ...serviceSummaries.map((s: ServiceProfileSummary) => {
      return s.profileCount;
    }),
  );

  return (
    <Fragment>
      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Profiles</p>
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
                  d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
                />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {totalProfileCount.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">last hour</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Services</p>
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
                  d="M21 7.5l-2.25-1.313M21 7.5v2.25m0-2.25l-2.25 1.313M3 7.5l2.25-1.313M3 7.5l2.25 1.313M3 7.5v2.25m9 3l2.25-1.313M12 12.75l-2.25-1.313M12 12.75V15m0 6.75l2.25-1.313M12 21.75V19.5m0 2.25l-2.25-1.313m0-16.875L12 2.25l2.25 1.313M21 14.25v2.25l-2.25 1.313m-13.5 0L3 16.5v-2.25"
                />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {serviceSummaries.length}
          </p>
          <p className="text-xs text-gray-400 mt-1">being profiled</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Samples</p>
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
            {totalSampleCount >= 1_000_000
              ? `${(totalSampleCount / 1_000_000).toFixed(1)}M`
              : totalSampleCount >= 1_000
                ? `${(totalSampleCount / 1_000).toFixed(1)}K`
                : totalSampleCount.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">total samples</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-500">Hotspots</p>
            <div
              className={`h-9 w-9 rounded-lg flex items-center justify-center ${hotspots.length > 0 ? "bg-orange-50" : "bg-gray-50"}`}
            >
              <svg
                className={`h-4.5 w-4.5 ${hotspots.length > 0 ? "text-orange-600" : "text-gray-400"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 6.51 6.51 0 009 4.572c.163.07.322.148.476.232M12 18.75a6.743 6.743 0 002.14-1.234M12 18.75a6.72 6.72 0 01-2.14-1.234M12 18.75V21m-4.773-4.227l-1.591 1.591M5.636 5.636L4.045 4.045m0 15.91l1.591-1.591M18.364 5.636l1.591-1.591M21 12h-2.25M4.5 12H2.25"
                />
              </svg>
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {hotspots.length}
          </p>
          <p className="text-xs text-gray-400 mt-1">functions identified</p>
        </div>
      </div>

      {/* Profile Type Distribution */}
      {profileTypeStats.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Profile Types Collected
          </h3>
          <div className="flex flex-wrap gap-3">
            {profileTypeStats.map((stat: ProfileTypeStats) => {
              const pct: number =
                totalProfileCount > 0
                  ? Math.round((stat.count / totalProfileCount) * 100)
                  : 0;
              return (
                <div
                  key={stat.type}
                  className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg ${stat.badgeColor}`}
                >
                  <span className="text-sm font-semibold">{stat.count}</span>
                  <span className="text-sm">{stat.displayName}</span>
                  <span className="text-xs opacity-60">{pct}%</span>
                </div>
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
              Services Being Profiled
            </h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Performance data collected in the last hour
            </p>
          </div>
          <AppLink
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES_LIST] as Route,
            )}
          >
            View all profiles
          </AppLink>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {serviceSummaries.map((summary: ServiceProfileSummary) => {
            const coverage: number =
              maxProfiles > 0
                ? Math.round((summary.profileCount / maxProfiles) * 100)
                : 0;

            return (
              <AppLink
                key={summary.service.id?.toString()}
                className="block"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW_PROFILES] as Route,
                  {
                    modelId: new ObjectID(summary.service._id as string),
                  },
                )}
              >
                <div className="rounded-xl border border-gray-200 bg-white p-5 hover:border-indigo-200 hover:shadow-md transition-all duration-200">
                  <div className="flex items-start justify-between mb-4">
                    <ServiceElement service={summary.service} />
                    <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      Active
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Profiles</p>
                      <p className="text-xl font-bold text-gray-900">
                        {summary.profileCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Samples</p>
                      <p className="text-xl font-bold text-gray-900">
                        {summary.totalSamples >= 1_000
                          ? `${(summary.totalSamples / 1_000).toFixed(1)}K`
                          : summary.totalSamples.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Profile volume bar */}
                  <div className="mb-3">
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-400 transition-all duration-500"
                        style={{ width: `${Math.max(coverage, 3)}%` }}
                      />
                    </div>
                  </div>

                  {/* Profile type badges */}
                  <div className="flex flex-wrap gap-1.5">
                    {summary.profileTypes.map((profileType: string) => {
                      const badgeColor: string =
                        ProfileUtil.getProfileTypeBadgeColor(profileType);
                      return (
                        <span
                          key={profileType}
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeColor}`}
                        >
                          {ProfileUtil.getProfileTypeDisplayName(profileType)}
                        </span>
                      );
                    })}
                  </div>

                  {summary.latestProfileTime && (
                    <p className="text-xs text-gray-400 mt-3">
                      Last captured{" "}
                      {OneUptimeDate.fromNow(summary.latestProfileTime)}
                    </p>
                  )}
                </div>
              </AppLink>
            );
          })}
        </div>
      </div>

      {/* Top Hotspots */}
      {hotspots.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <h3 className="text-base font-semibold text-gray-900">
              Top Performance Hotspots
            </h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Functions consuming the most resources across all services
          </p>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="divide-y divide-gray-50">
              {hotspots.map((fn: FunctionHotspot, index: number) => {
                const maxSelf: number = hotspots[0]?.selfValue || 1;
                const barWidth: number = (fn.selfValue / maxSelf) * 100;

                return (
                  <div
                    key={`${fn.functionName}-${fn.fileName}-${index}`}
                    className="px-5 py-3.5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <div className="min-w-0 flex-1 mr-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 font-mono w-5 flex-shrink-0">
                            #{index + 1}
                          </span>
                          <p className="font-mono text-sm text-gray-900 truncate">
                            {fn.functionName}
                          </p>
                          {fn.frameType && (
                            <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">
                              {fn.frameType}
                            </span>
                          )}
                        </div>
                        {fn.fileName && (
                          <p className="text-xs text-gray-400 mt-0.5 ml-7 truncate">
                            {fn.fileName}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-5 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm font-bold font-mono text-gray-900">
                            {fn.selfValue.toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-400">own time</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono text-gray-700">
                            {fn.totalValue.toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-400">total</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono text-gray-700">
                            {fn.sampleCount.toLocaleString()}
                          </p>
                          <p className="text-xs text-gray-400">samples</p>
                        </div>
                      </div>
                    </div>
                    <div className="ml-7">
                      <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-orange-400"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Fragment>
  );
};

export default ProfilesDashboard;
