import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
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
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import AggregatedFlamegraph from "./AggregatedFlamegraph";
import ProfileTypeSelector from "./ProfileTypeSelector";
import ProfileUtil, { ModuleCategory } from "../../Utils/ProfileUtil";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import ServiceElement from "../Service/ServiceElement";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

/** Each time-range chip on the home page. */
interface TimeRange {
  label: string;
  minutes: number;
}

const TIME_RANGES: Array<TimeRange> = [
  { label: "15m", minutes: 15 },
  { label: "1h", minutes: 60 },
  { label: "24h", minutes: 60 * 24 },
  { label: "7d", minutes: 60 * 24 * 7 },
];

interface TopFunction {
  functionName: string;
  fileName: string;
  selfValue: number;
  totalValue: number;
  sampleCount: number;
  frameType: string;
}

/**
 * The home page of the Profiler. Opens with a single question:
 * "where is your service spending time right now?" — answered by an
 * aggregated flame graph across every recent profile.
 *
 * Layout:
 *   1. Service picker + time range chips + profile-type pills
 *   2. Headline insight card (auto-generated from the top function)
 *   3. Aggregated flame graph (the centerpiece)
 *   4. Top functions list
 *   5. Services-being-profiled grid
 *   6. Footer link to the raw list of individual profiles
 */
const ProfilesDashboard: FunctionComponent = (): ReactElement => {
  const [services, setServices] = useState<Array<Service>>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<
    string | "all" | null
  >(null);
  const [rangeMinutes, setRangeMinutes] = useState<number>(60);
  const [profileType, setProfileType] = useState<string | undefined>("cpu");
  const [topFunctions, setTopFunctions] = useState<Array<TopFunction>>([]);
  const [topFunctionsLoading, setTopFunctionsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isServicesLoading, setIsServicesLoading] = useState<boolean>(true);
  const [servicesWithProfiles, setServicesWithProfiles] = useState<
    Set<string>
  >(new Set());

  // Stable time window. We want a single (startTime, endTime) pair
  // shared between the flame graph and the top-functions list so they
  // agree on the same period. We bump a nonce on refresh to force a
  // re-fetch even if the range hasn't changed (otherwise React would
  // see the same Date object and skip the effect).
  const [nonce, setNonce] = useState<number>(0);
  const { startTime, endTime } = useMemo(() => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const start: Date = OneUptimeDate.addRemoveMinutes(now, -rangeMinutes);
    return { startTime: start, endTime: now };
    // nonce is intentionally part of the dep list so refresh works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeMinutes, nonce]);

  const selectedServiceIds: Array<ObjectID> | undefined = useMemo(() => {
    if (!selectedServiceId || selectedServiceId === "all") {
      return undefined;
    }
    return [new ObjectID(selectedServiceId)];
  }, [selectedServiceId]);

  // Initial load: services list, plus which services have profile data.
  useEffect(() => {
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        setIsServicesLoading(true);
        setError("");

        const servicesResult: { data: Array<Service> } = await ModelAPI.getList(
          {
            modelType: Service,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
            select: { serviceColor: true, name: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: { name: SortOrder.Ascending },
          },
        );
        if (cancelled) {
          return;
        }
        setServices(servicesResult.data || []);
        // Default to "all services" on first load.
        setSelectedServiceId((prev: string | "all" | null) => {
          return prev || "all";
        });
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyErrorMessage(err as Error));
        }
      } finally {
        if (!cancelled) {
          setIsServicesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Top-functions fetch: keyed on window + service + type so it stays
  // in sync with the flame graph.
  useEffect(() => {
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        setTopFunctionsLoading(true);
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/profiles/function-list",
            ),
            data: {
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              serviceIds: selectedServiceIds?.map((id: ObjectID) => {
                return id.toString();
              }),
              profileType,
              limit: 8,
              sortBy: "selfValue",
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (cancelled) {
          return;
        }
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        const fns: Array<TopFunction> = (response.data["functions"] ||
          []) as unknown as Array<TopFunction>;
        setTopFunctions(fns);

        // While we're here, capture which services actually have data
        // — used to badge the service list below.
        const fresh: Set<string> = new Set<string>();
        for (const fn of fns) {
          if ((fn as unknown as { serviceId?: string }).serviceId) {
            fresh.add(
              (fn as unknown as { serviceId: string }).serviceId.toString(),
            );
          }
        }
        if (fresh.size > 0) {
          setServicesWithProfiles(fresh);
        }
      } catch {
        if (!cancelled) {
          setTopFunctions([]);
        }
      } finally {
        if (!cancelled) {
          setTopFunctionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startTime.getTime(),
    endTime.getTime(),
    profileType,
    selectedServiceIds
      ? selectedServiceIds.map((i: ObjectID) => i.toString()).join(",")
      : "all",
  ]);

  const selectedServiceName: string = useMemo(() => {
    if (!selectedServiceId || selectedServiceId === "all") {
      return "all services";
    }
    const s: Service | undefined = services.find((sv: Service) => {
      return sv.id?.toString() === selectedServiceId;
    });
    return s?.name || "selected service";
  }, [services, selectedServiceId]);

  if (isServicesLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // First-run empty state when no services exist at all.
  if (services.length === 0) {
    return <EmptyState />;
  }

  const unit: string = profileType
    ? ProfileUtil.getProfileTypeUnit(profileType)
    : "nanoseconds";

  return (
    <Fragment>
      {/* Toolbar */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              Service
            </div>
            <select
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              value={selectedServiceId || "all"}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                setSelectedServiceId(e.target.value);
              }}
            >
              <option value="all">All services</option>
              {services.map((s: Service) => {
                return (
                  <option key={s.id?.toString()} value={s.id?.toString()}>
                    {s.name}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              Time window
            </div>
            <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1">
              {TIME_RANGES.map((r: TimeRange) => {
                const active: boolean = rangeMinutes === r.minutes;
                return (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => {
                      setRangeMinutes(r.minutes);
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      active
                        ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              What to analyze
            </div>
            <ProfileTypeSelector
              selectedProfileType={profileType}
              onChange={setProfileType}
              showAdvanced={false}
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setNonce((n: number) => {
                  return n + 1;
                });
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white hover:bg-gray-50 text-gray-700 rounded-md border border-gray-300"
              title="Refresh data"
            >
              <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
              Refresh
            </button>
            <AppLink
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.PROFILES_INSIGHTS] as Route,
              )}
            >
              Browse raw profiles →
            </AppLink>
          </div>
        </div>
      </div>

      {/* Headline insight */}
      <HeadlineInsight
        topFunctions={topFunctions}
        unit={unit}
        profileType={profileType}
        serviceName={selectedServiceName}
        rangeMinutes={rangeMinutes}
        loading={topFunctionsLoading}
      />

      {/* Aggregated flame graph */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Where the time is going
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Every profile captured in the window, merged into one view.
              Click a frame to zoom in.
            </p>
          </div>
        </div>
        <AggregatedFlamegraph
          startTime={startTime}
          endTime={endTime}
          serviceIds={selectedServiceIds}
          profileType={profileType}
          unit={unit}
        />
      </div>

      {/* Top functions */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Top functions
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Ranked by self time — the actual work each function did.
            </p>
          </div>
        </div>
        <TopFunctionsList
          functions={topFunctions}
          unit={unit}
          loading={topFunctionsLoading}
        />
      </div>

      {/* Services being profiled */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Services being profiled
          </h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {services.map((s: Service) => {
            const hasProfiles: boolean = servicesWithProfiles.has(
              s.id?.toString() || "",
            );
            return (
              <button
                key={s.id?.toString()}
                type="button"
                onClick={() => {
                  setSelectedServiceId(s.id?.toString() || "all");
                }}
                className={`text-left block rounded-lg border p-3 hover:border-indigo-300 hover:shadow-sm transition-all ${
                  selectedServiceId === s.id?.toString()
                    ? "border-indigo-400 bg-indigo-50/40"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <ServiceElement service={s} />
                  {hasProfiles && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      Active
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </Fragment>
  );
};

/**
 * Lead-line insight card. The philosophy: never force the user to
 * interpret numbers. Turn the top-N functions into one English sentence
 * that points at the most likely place to look.
 */
interface HeadlineInsightProps {
  topFunctions: Array<TopFunction>;
  unit: string;
  profileType: string | undefined;
  serviceName: string;
  rangeMinutes: number;
  loading: boolean;
}

const HeadlineInsight: FunctionComponent<HeadlineInsightProps> = (
  props: HeadlineInsightProps,
): ReactElement => {
  const totalSelf: number = useMemo(() => {
    let t: number = 0;
    for (const f of props.topFunctions) {
      t += f.selfValue;
    }
    return t;
  }, [props.topFunctions]);

  const topN: Array<TopFunction> = props.topFunctions.slice(0, 3);
  const topShare: number =
    totalSelf > 0
      ? (topN.reduce((acc: number, f: TopFunction) => {
          return acc + f.selfValue;
        }, 0) /
          totalSelf) *
        100
      : 0;

  const timeLabel: string =
    props.rangeMinutes < 60
      ? `${props.rangeMinutes}m`
      : props.rangeMinutes < 60 * 24
        ? `${Math.round(props.rangeMinutes / 60)}h`
        : `${Math.round(props.rangeMinutes / (60 * 24))}d`;

  const category: string = props.profileType
    ? ProfileUtil.getProfileTypeDisplayName(props.profileType).toLowerCase()
    : "samples";

  if (props.loading) {
    return (
      <div className="mb-4 rounded-xl border border-gray-200 bg-gradient-to-br from-indigo-50/40 to-white p-4 animate-pulse">
        <div className="h-4 bg-gray-100 rounded w-2/3 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
    );
  }

  if (topN.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
        No profile data in the last {timeLabel} for {props.serviceName}. Try a
        wider time window.
      </div>
    );
  }

  const leader: TopFunction = topN[0]!;
  const leaderShare: number =
    totalSelf > 0 ? (leader.selfValue / totalSelf) * 100 : 0;

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-gradient-to-br from-indigo-50/40 to-white p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <Icon icon={IconProp.Bolt} className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="min-w-0">
          <div className="text-sm text-gray-700 leading-relaxed">
            In the last <span className="font-semibold">{timeLabel}</span>,{" "}
            <span className="font-semibold">{props.serviceName}</span> spent
            most of its {category} in{" "}
            <span className="font-mono font-medium text-gray-900">
              {leader.functionName || "(anonymous)"}
            </span>{" "}
            ({ProfileUtil.formatPercent(leaderShare)} of the window).
            {topN.length >= 2 && (
              <>
                {" "}
                The top <span className="font-semibold">{topN.length}</span>{" "}
                functions account for{" "}
                <span className="font-semibold">
                  {ProfileUtil.formatPercent(topShare)}
                </span>{" "}
                of the total — those are your optimization targets.
              </>
            )}
          </div>
          {leader.fileName && (
            <div className="mt-1 text-[11px] text-gray-500 font-mono truncate">
              {ProfileUtil.formatFileName(leader.fileName, 80)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface TopFunctionsListProps {
  functions: Array<TopFunction>;
  unit: string;
  loading: boolean;
}

const TopFunctionsList: FunctionComponent<TopFunctionsListProps> = (
  props: TopFunctionsListProps,
): ReactElement => {
  if (props.loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i: number) => {
          return (
            <div
              key={i}
              className="h-10 rounded-md bg-gray-50 border border-gray-100 animate-pulse"
            />
          );
        })}
      </div>
    );
  }

  if (props.functions.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-6 text-center">
        No functions found. Check that the service is actively being profiled.
      </p>
    );
  }

  const topValue: number = props.functions[0]?.selfValue || 1;
  const totalValue: number = props.functions.reduce(
    (acc: number, f: TopFunction) => {
      return acc + f.selfValue;
    },
    0,
  );

  return (
    <div className="divide-y divide-gray-100 -mx-4">
      {props.functions.map((fn: TopFunction, index: number) => {
        const bar: number = (fn.selfValue / topValue) * 100;
        const share: number =
          totalValue > 0 ? (fn.selfValue / totalValue) * 100 : 0;
        const category: ModuleCategory = ProfileUtil.getModuleCategory(
          fn.fileName,
        );
        const style: { bg: string } = ProfileUtil.getModuleFrameStyle(
          category,
          0.7,
        );
        return (
          <div
            key={`${fn.functionName}-${fn.fileName}-${index}`}
            className="px-4 py-2.5 hover:bg-gray-50/60"
          >
            <div className="flex items-start gap-3">
              <span className="text-[11px] font-mono text-gray-400 w-5 flex-shrink-0 mt-0.5">
                #{index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-sm ${style.bg} flex-shrink-0`}
                    title={ProfileUtil.getModuleCategoryLabel(category)}
                  />
                  <span className="font-mono text-sm text-gray-900 truncate">
                    {fn.functionName || "(anonymous)"}
                  </span>
                </div>
                {fn.fileName && (
                  <div className="text-[11px] text-gray-400 font-mono truncate ml-4">
                    {ProfileUtil.formatFileName(fn.fileName, 80)}
                  </div>
                )}
                <div className="mt-1.5 ml-4 w-full max-w-md h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-orange-400"
                    style={{ width: `${bar}%` }}
                  />
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-mono font-semibold text-gray-900">
                  {ProfileUtil.formatProfileValue(fn.selfValue, props.unit)}
                </div>
                <div className="text-[11px] text-gray-400">
                  {ProfileUtil.formatPercent(share)}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const EmptyState: FunctionComponent = (): ReactElement => {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-16 text-center">
      <div className="mx-auto w-16 h-16 rounded-full bg-indigo-50 flex items-center justify-center mb-5">
        <Icon icon={IconProp.ChartBar} className="h-7 w-7 text-indigo-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        No services profiling yet
      </h3>
      <p className="text-sm text-gray-500 max-w-md mx-auto leading-relaxed">
        Add a service and enable the OneUptime profiler agent (Node, Go,
        Python, Java, or Ruby). Once samples start arriving, this page will
        show a merged flame graph and the functions consuming the most
        resources across every recent recording.
      </p>
    </div>
  );
};

export default ProfilesDashboard;
