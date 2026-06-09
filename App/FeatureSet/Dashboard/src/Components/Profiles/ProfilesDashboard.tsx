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
import {
  ProfileServiceCategory,
  categorizeProfileService,
  profileServiceCategoryLabel,
  profileServiceCategoryOrder,
} from "../../Utils/ProfileServiceCategory";

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
/*
 * Persisted UI prefs. Activity-first sort matches a developer's
 * usual question ("what's hot?"), so we default new users to it. A-Z
 * stays available for people who like a stable alphabetical list.
 */
type ProfileSortMode = "activity" | "alpha";
const SORT_MODE_STORAGE_KEY: string = "oneuptime.profiles.serviceSort";
const SHOW_KERNEL_STORAGE_KEY: string = "oneuptime.profiles.showKernel";

function readStoredSortMode(): ProfileSortMode {
  try {
    const v: string | null = window.localStorage.getItem(SORT_MODE_STORAGE_KEY);
    if (v === "activity" || v === "alpha") {
      return v;
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR) — fall through.
  }
  return "activity";
}

function readStoredShowKernel(): boolean {
  try {
    const v: string | null = window.localStorage.getItem(
      SHOW_KERNEL_STORAGE_KEY,
    );
    if (v === "true") {
      return true;
    }
  } catch {
    // localStorage may be unavailable — fall through.
  }
  return false;
}

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
  const [servicesWithProfiles, setServicesWithProfiles] = useState<Set<string>>(
    new Set(),
  );
  const [sortMode, setSortMode] = useState<ProfileSortMode>(() => {
    return readStoredSortMode();
  });
  const [showKernel, setShowKernel] = useState<boolean>(() => {
    return readStoredShowKernel();
  });
  const [serviceActivity, setServiceActivity] = useState<
    Record<string, number>
  >({});

  /*
   * Stable time window. We want a single (startTime, endTime) pair
   * shared between the flame graph and the top-functions list so they
   * agree on the same period. We bump a nonce on refresh to force a
   * re-fetch even if the range hasn't changed (otherwise React would
   * see the same Date object and skip the effect).
   */
  const [nonce, setNonce] = useState<number>(0);
  const { startTime, endTime } = useMemo(() => {
    const now: Date = OneUptimeDate.getCurrentDate();
    const start: Date = OneUptimeDate.addRemoveMinutes(now, -rangeMinutes);
    return { startTime: start, endTime: now };
    // nonce is intentionally part of the dep list so refresh works.
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

  /*
   * Top-functions fetch: keyed on window + service + type so it stays
   * in sync with the flame graph.
   */
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
              profileTypes:
                ProfileUtil.getRawProfileTypesForCategory(profileType),
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

        /*
         * While we're here, capture which services actually have data
         * — used to badge the service list below.
         */
        const fresh: Set<string> = new Set<string>();
        for (const fn of fns) {
          if ((fn as unknown as { primaryEntityId?: string }).primaryEntityId) {
            fresh.add(
              (fn as unknown as { primaryEntityId: string }).primaryEntityId.toString(),
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
  }, [
    startTime.getTime(),
    endTime.getTime(),
    profileType,
    selectedServiceIds
      ? selectedServiceIds
          .map((i: ObjectID) => {
            return i.toString();
          })
          .join(",")
      : "all",
  ]);

  /*
   * Per-service sample-count fetch. Drives the "Activity" sort and the
   * sample-count badges on the service cards. We refresh whenever the
   * time window or selected profile-type changes — the answer to
   * "what's hot right now?" is window-dependent.
   *
   * Note: this is intentionally NOT keyed on `selectedServiceId`. The
   * dropdown should reflect cluster-wide activity so the user can pivot
   * to whichever service is loudest, not just the currently-filtered one.
   */
  useEffect(() => {
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/profiles/service-activity",
            ),
            data: {
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              profileType,
              profileTypes:
                ProfileUtil.getRawProfileTypesForCategory(profileType),
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
        const rows: Array<{
          primaryEntityId: string;
          sampleCount: number;
        }> = (response.data["activity"] || []) as unknown as Array<{
          primaryEntityId: string;
          sampleCount: number;
        }>;
        const next: Record<string, number> = {};
        for (const r of rows) {
          if (r && r.primaryEntityId) {
            next[r.primaryEntityId] = Number(r.sampleCount) || 0;
          }
        }
        setServiceActivity(next);
      } catch {
        if (!cancelled) {
          setServiceActivity({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startTime.getTime(), endTime.getTime(), profileType]);

  // Persist sort + kernel-visibility prefs.
  useEffect(() => {
    try {
      window.localStorage.setItem(SORT_MODE_STORAGE_KEY, sortMode);
    } catch {
      // localStorage may be unavailable — silently skip.
    }
  }, [sortMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SHOW_KERNEL_STORAGE_KEY,
        showKernel ? "true" : "false",
      );
    } catch {
      // localStorage may be unavailable — silently skip.
    }
  }, [showKernel]);

  /*
   * Group + sort services for display. Categories run top-to-bottom in
   * a fixed order (Application -> System -> Host -> Kernel); within
   * each category the chosen sort mode applies. Kernel threads are
   * hidden entirely unless the user opts in.
   */
  const groupedServices: Array<{
    category: ProfileServiceCategory;
    services: Array<Service>;
  }> = useMemo(() => {
    type Bucket = {
      category: ProfileServiceCategory;
      services: Array<Service>;
    };
    const buckets: Map<ProfileServiceCategory, Bucket> = new Map();

    for (const svc of services) {
      const name: string = svc.name || "";
      const category: ProfileServiceCategory = categorizeProfileService(name);
      let bucket: Bucket | undefined = buckets.get(category);
      if (!bucket) {
        bucket = { category, services: [] };
        buckets.set(category, bucket);
      }
      bucket.services.push(svc);
    }

    const list: Array<Bucket> = Array.from(buckets.values());

    const compareByActivity: (a: Service, b: Service) => number = (
      a: Service,
      b: Service,
    ): number => {
      const aId: string = a.id?.toString() || "";
      const bId: string = b.id?.toString() || "";
      const aCount: number = serviceActivity[aId] || 0;
      const bCount: number = serviceActivity[bId] || 0;
      if (aCount !== bCount) {
        return bCount - aCount;
      }
      // Tie-break: alphabetical so zero-activity tails stay stable.
      return (a.name || "").localeCompare(b.name || "");
    };
    const compareByName: (a: Service, b: Service) => number = (
      a: Service,
      b: Service,
    ): number => {
      return (a.name || "").localeCompare(b.name || "");
    };

    for (const b of list) {
      b.services.sort(
        sortMode === "activity" ? compareByActivity : compareByName,
      );
    }

    list.sort((a: Bucket, b: Bucket) => {
      return (
        profileServiceCategoryOrder(a.category) -
        profileServiceCategoryOrder(b.category)
      );
    });

    return list;
  }, [services, serviceActivity, sortMode]);

  const visibleGroups: Array<{
    category: ProfileServiceCategory;
    services: Array<Service>;
  }> = useMemo(() => {
    if (showKernel) {
      return groupedServices;
    }
    return groupedServices.filter(
      (g: {
        category: ProfileServiceCategory;
        services: Array<Service>;
      }): boolean => {
        return g.category !== ProfileServiceCategory.Kernel;
      },
    );
  }, [groupedServices, showKernel]);

  const kernelCount: number = useMemo(() => {
    const k: { services: Array<Service> } | undefined = groupedServices.find(
      (g: {
        category: ProfileServiceCategory;
        services: Array<Service>;
      }): boolean => {
        return g.category === ProfileServiceCategory.Kernel;
      },
    );
    return k ? k.services.length : 0;
  }, [groupedServices]);

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
              {visibleGroups.map(
                (group: {
                  category: ProfileServiceCategory;
                  services: Array<Service>;
                }) => {
                  return (
                    <optgroup
                      key={group.category}
                      label={profileServiceCategoryLabel(group.category)}
                    >
                      {group.services.map((s: Service) => {
                        const id: string = s.id?.toString() || "";
                        const count: number = serviceActivity[id] || 0;
                        const suffix: string =
                          sortMode === "activity" && count > 0
                            ? `  (${count.toLocaleString()})`
                            : "";
                        return (
                          <option key={id} value={id}>
                            {s.name}
                            {suffix}
                          </option>
                        );
                      })}
                    </optgroup>
                  );
                },
              )}
            </select>
            <div className="mt-1.5 inline-flex items-center rounded-md border border-gray-200 bg-gray-50 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setSortMode("activity");
                }}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                  sortMode === "activity"
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                title="Sort by sample count in the current window"
              >
                Activity
              </button>
              <button
                type="button"
                onClick={() => {
                  setSortMode("alpha");
                }}
                className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                  sortMode === "alpha"
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                title="Sort alphabetically"
              >
                A-Z
              </button>
            </div>
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
              Every profile captured in the window, merged into one view. Click
              a frame to zoom in.
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
          {kernelCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowKernel((v: boolean) => {
                  return !v;
                });
              }}
              className="text-[11px] text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"
              title={
                showKernel
                  ? "Hide kernel-thread services"
                  : "Show kernel-thread services"
              }
            >
              <Icon
                icon={showKernel ? IconProp.Eye : IconProp.EyeSlash}
                className="h-3 w-3"
              />
              {showKernel ? "Hide" : "Show"} {kernelCount} kernel{" "}
              {kernelCount === 1 ? "thread" : "threads"}
            </button>
          )}
        </div>
        {visibleGroups.map(
          (group: {
            category: ProfileServiceCategory;
            services: Array<Service>;
          }) => {
            return (
              <div key={group.category} className="mb-5 last:mb-0">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-gray-400">
                  {profileServiceCategoryLabel(group.category)}{" "}
                  <span className="text-gray-300 normal-case">
                    · {group.services.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.services.map((s: Service) => {
                    const id: string = s.id?.toString() || "";
                    const sampleCount: number = serviceActivity[id] || 0;
                    const hasProfiles: boolean =
                      sampleCount > 0 || servicesWithProfiles.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setSelectedServiceId(id || "all");
                        }}
                        className={`text-left block rounded-lg border p-3 hover:border-indigo-300 hover:shadow-sm transition-all ${
                          selectedServiceId === id
                            ? "border-indigo-400 bg-indigo-50/40"
                            : "border-gray-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <ServiceElement service={s} />
                          {hasProfiles && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                              {sampleCount > 0
                                ? `${sampleCount.toLocaleString()} samples`
                                : "Active"}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          },
        )}
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
                The top <span className="font-semibold">
                  {topN.length}
                </span>{" "}
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
        Add a service and enable the OneUptime profiler agent (Node, Go, Python,
        Java, or Ruby). Once samples start arriving, this page will show a
        merged flame graph and the functions consuming the most resources across
        every recent recording.
      </p>
    </div>
  );
};

export default ProfilesDashboard;
