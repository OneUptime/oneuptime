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
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Profile from "Common/Models/AnalyticsModels/Profile";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
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
}

interface FunctionHotspot {
  functionName: string;
  fileName: string;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  frameType: string;
}

const ProfilesDashboard: FunctionComponent = (): ReactElement => {
  const [serviceSummaries, setServiceSummaries] = useState<
    Array<ServiceProfileSummary>
  >([]);
  const [hotspots, setHotspots] = useState<Array<FunctionHotspot>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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

      const services: Array<Service> = servicesResult.data || [];

      // Load recent profiles (last 1 hour) to build per-service summaries
      const profilesResult: AnalyticsListResult<Profile> =
        await AnalyticsModelAPI.getList({
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
        });

      const profiles: Array<Profile> = profilesResult.data || [];

      // Build per-service summaries
      const summaryMap: Map<string, ServiceProfileSummary> = new Map();

      for (const service of services) {
        const serviceId: string = service.id?.toString() || "";
        summaryMap.set(serviceId, {
          service,
          profileCount: 0,
          latestProfileTime: null,
          profileTypes: [],
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
      }

      // Only show services that have profiles
      const summariesWithData: Array<ServiceProfileSummary> = Array.from(
        summaryMap.values(),
      ).filter((s: ServiceProfileSummary) => {
        return s.profileCount > 0;
      });

      // Sort by profile count descending
      summariesWithData.sort(
        (a: ServiceProfileSummary, b: ServiceProfileSummary) => {
          return b.profileCount - a.profileCount;
        },
      );

      setServiceSummaries(summariesWithData);

      // Load top hotspots (function list) across all services
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
        // Hotspots are optional - don't fail the whole page
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
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No performance data yet
        </h3>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Once your services start sending profiling data, you{"'"}ll see a
          summary of which services are being profiled, their performance
          hotspots, and more.
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
              Services Being Profiled
            </h3>
            <p className="text-sm text-gray-500 mt-1">
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
            return (
              <div
                key={summary.service.id?.toString()}
                className="rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <ServiceElement service={summary.service} />
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
                    Active
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <p className="text-xs text-gray-500">Profiles</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {summary.profileCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Last Captured</p>
                    <p className="text-sm text-gray-700">
                      {summary.latestProfileTime
                        ? OneUptimeDate.getDateAsLocalFormattedString(
                            summary.latestProfileTime,
                            true,
                          )
                        : "-"}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-1.5">
                    Profile Types Collected
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.profileTypes.map((profileType: string) => {
                      const badgeColor: string =
                        ProfileUtil.getProfileTypeBadgeColor(profileType);
                      return (
                        <span
                          key={profileType}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}
                        >
                          {ProfileUtil.getProfileTypeDisplayName(profileType)}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100">
                  <AppLink
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SERVICE_VIEW_PROFILES] as Route,
                      {
                        modelId: new ObjectID(summary.service._id as string),
                      },
                    )}
                  >
                    View service profiles
                  </AppLink>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Hotspots */}
      {hotspots.length > 0 && (
        <div>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Top Performance Hotspots
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Functions using the most resources across all services in the last
              hour
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 font-medium">#</th>
                  <th className="px-5 py-3 font-medium">Function</th>
                  <th className="px-5 py-3 font-medium">Source File</th>
                  <th className="px-5 py-3 text-right font-medium">Own Time</th>
                  <th className="px-5 py-3 text-right font-medium">
                    Total Time
                  </th>
                  <th className="px-5 py-3 text-right font-medium">
                    Occurrences
                  </th>
                </tr>
              </thead>
              <tbody>
                {hotspots.map((fn: FunctionHotspot, index: number) => {
                  const maxSelf: number = hotspots[0]?.selfValue || 1;
                  const barWidth: number = (fn.selfValue / maxSelf) * 100;

                  return (
                    <tr
                      key={`${fn.functionName}-${fn.fileName}-${index}`}
                      className="border-t border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-5 py-3 text-gray-400 font-mono text-xs">
                        {index + 1}
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs text-gray-900 truncate max-w-xs">
                          {fn.functionName}
                        </div>
                        <div
                          className="mt-1 h-1 rounded-full bg-orange-400"
                          style={{ width: `${barWidth}%` }}
                        />
                      </td>
                      <td className="px-5 py-3 text-gray-500 text-xs truncate max-w-xs">
                        {fn.fileName || "-"}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-gray-900">
                        {fn.selfValue.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-gray-700">
                        {fn.totalValue.toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-gray-700">
                        {fn.sampleCount.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Fragment>
  );
};

export default ProfilesDashboard;
