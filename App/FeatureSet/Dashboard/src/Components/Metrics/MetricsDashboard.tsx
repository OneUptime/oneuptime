import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Service from "Common/Models/DatabaseModels/Service";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult as AnalyticsListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ServiceElement from "../Service/ServiceElement";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import AppLink from "../AppLink/AppLink";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Includes from "Common/Types/BaseDatabase/Includes";
import MetricSavedView from "Common/Models/DatabaseModels/MetricSavedView";
import Navigation from "Common/UI/Utils/Navigation";
import HintChip from "./HintChip";
import {
  ServiceScopedInsightsUrlScope,
  TelemetryFilterTuple,
  buildServiceScopedInsightsUrlParams,
  describeUnappliedScopeFilters,
  readServiceScopedInsightsUrlScope,
  toPresentParams,
  withTelemetryTabScopeParams,
} from "../../Utils/TelemetryTabScope";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import {
  ScopedServiceCoverage,
  computeScopedServiceCoverage,
} from "../../Utils/ServiceCoverage";

interface MetricCategory {
  name: string;
  count: number;
  color: string;
  bgColor: string;
  barColor: string;
}

interface ServiceSummary {
  service: Service;
  metricCount: number;
  metricNames: Array<string>;
  hasSystemMetrics: boolean;
  hasAppMetrics: boolean;
}

const CATEGORY_STYLES: Record<
  string,
  { color: string; bgColor: string; barColor: string }
> = {
  System: {
    color: "text-sky-700",
    bgColor: "bg-sky-50",
    barColor: "bg-sky-400",
  },
  Request: {
    color: "text-violet-700",
    bgColor: "bg-violet-50",
    barColor: "bg-violet-400",
  },
  Database: {
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    barColor: "bg-amber-400",
  },
  Messaging: {
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    barColor: "bg-emerald-400",
  },
  Custom: {
    color: "text-gray-700",
    bgColor: "bg-gray-100",
    barColor: "bg-gray-300",
  },
};

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

function timeRangeLabel(range: RangeStartAndEndDateTime): string {
  if (range.range === TimeRange.CUSTOM) {
    return "the selected time range";
  }
  return `the ${(range.range as string).toLowerCase()}`;
}

const MetricsDashboard: FunctionComponent = (): ReactElement => {
  /*
   * The slice the Viewer tab handed over, read once on mount. Without this
   * the Insights tab silently widened back out to the whole project every
   * time the user switched lens on a scoped view.
   */
  const [initialUrlScope] = useState<ServiceScopedInsightsUrlScope>(() => {
    return readServiceScopedInsightsUrlScope(Navigation.getQueryString());
  });

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(() => {
    return initialUrlScope.timeRange || { range: TimeRange.PAST_ONE_HOUR };
  });
  const [selectedServiceIds, setSelectedServiceIds] = useState<Array<string>>(
    initialUrlScope.serviceIds,
  );
  /*
   * Viewer chips with no counterpart here — a metric-name search, an
   * attribute filter, a host selection. Carried so the trip back does not
   * drop them, and announced so the numbers on this page are not mistaken
   * for having honoured them.
   */
  const [unappliedFilters] = useState<Array<TelemetryFilterTuple>>(
    initialUrlScope.unappliedFilters,
  );
  const [savedViewId, setSavedViewId] = useState<string | null>(
    initialUrlScope.savedViewId,
  );
  const [savedViewName, setSavedViewName] = useState<string>("");
  /*
   * The Viewer's own search text — a real predicate compiled through the
   * metrics grammar, which this page cannot apply. Carried and announced
   * like an unapplicable chip rather than dropped, which used to widen the
   * slice on the way here and destroy the user's search on the way back.
   */
  const [carriedSearch] = useState<string | null>(initialUrlScope.search);

  const [services, setServices] = useState<Array<Service>>([]);
  const [metricTypes, setMetricTypes] = useState<Array<MetricType>>([]);
  const [activeMetrics, setActiveMetrics] = useState<Array<Metric>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * Generation token for the in-flight batch. Both the scope picker and the
   * time picker commit immediately, and the loading state still renders
   * both, so two quick changes leave two capped 5000-point fetches racing.
   * Without this the batch that RESOLVES last wins rather than the one the
   * user asked for last. Same guard the Logs Insights page has always had.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  const [error, setError] = useState<string>("");

  const loadDashboard: () => Promise<void> = useCallback(async () => {
    const generation: number = ++loadGenerationRef.current;

    try {
      setIsLoading(true);
      setError("");

      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
      if (!projectId) {
        setIsLoading(false);
        return;
      }

      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

      const [servicesResult, metricTypesResult, metricsResult] =
        await Promise.all([
          ModelAPI.getList({
            modelType: Service,
            query: { projectId },
            select: { name: true, serviceColor: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: MetricType,
            query: { projectId },
            select: { name: true, unit: true, description: true },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: { name: SortOrder.Ascending },
          }),
          AnalyticsModelAPI.getList<Metric>({
            modelType: Metric,
            query: {
              projectId,
              time: new InBetween<Date>(
                dateRange.startValue,
                dateRange.endValue,
              ),
              /*
               * The service scope carried from the Viewer tab. Applied to
               * the fetch rather than filtered client-side: the fetch is
               * capped, so filtering after it would leave the numbers
               * describing whichever 5000 points came back rather than the
               * services the user selected.
               */
              ...(selectedServiceIds.length > 0
                ? { primaryEntityId: new Includes(selectedServiceIds) }
                : {}),
            } as Query<Metric>,
            limit: 5000,
            skip: 0,
            select: {
              name: true,
              primaryEntityId: true,
              time: true,
            } as Select<Metric>,
            sort: { time: SortOrder.Descending } as Record<string, SortOrder>,
            requestOptions: {},
          }),
        ]);

      const loadedMetrics: Array<Metric> = ((
        metricsResult as AnalyticsListResult<Metric>
      ).data || []) as Array<Metric>;

      // A batch the user has already moved on from must not commit.
      if (loadGenerationRef.current !== generation) {
        return;
      }

      /*
       * Telemetry with no service.name is tagged with the projectId and has
       * no Service row, and serviceSummaries below injects a synthetic
       * "Unknown Service" for it. That put it in the NUMERATOR while the
       * denominator counted Postgres rows only — so a project with three
       * services and one unattributed collector rendered "4 of 3 services",
       * and the quiet-services count came out one too low. Wrapping the list
       * here puts it in both populations, which is what the Traces Insights
       * page already does.
       */
      const referencedServiceIds: Set<string> = new Set(
        loadedMetrics
          .map((metric: Metric): string => {
            return metric.primaryEntityId?.toString() || "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      );

      setServices(
        TelemetryServiceUtil.withUnknownServiceIfReferenced({
          services: servicesResult.data || [],
          referencedServiceIds,
          projectId,
        }),
      );
      setMetricTypes(metricTypesResult.data || []);
      setActiveMetrics(loadedMetrics);
    } catch (err) {
      if (loadGenerationRef.current !== generation) {
        return;
      }

      setError(API.getFriendlyMessage(err as Error));
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [timeRange, selectedServiceIds]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  /*
   * Mirror this page's scope into the URL, in the Metrics Viewer's own
   * grammar — so the tab link back needs no translation, and a refresh or a
   * shared link restores what the user was looking at.
   */
  useEffect(() => {
    writeTelemetryViewerUrlState(
      buildServiceScopedInsightsUrlParams({
        timeRange,
        serviceIds: selectedServiceIds,
        unappliedFilters,
        savedViewId,
        grammar: "pairs",
        search: carriedSearch,
      }),
    );
  }, [
    timeRange,
    selectedServiceIds,
    unappliedFilters,
    savedViewId,
    carriedSearch,
  ]);

  /*
   * The name behind the carried saved-view id, so the page can say where its
   * scope came from. Best-effort: a deleted view drops the reference rather
   * than surfacing an error, since the scope itself arrived in the URL.
   */
  useEffect(() => {
    if (!savedViewId) {
      setSavedViewName("");
      return;
    }

    let isCancelled: boolean = false;

    ModelAPI.getItem({
      modelType: MetricSavedView,
      id: new ObjectID(savedViewId),
      select: { name: true },
    })
      .then((savedView: MetricSavedView | null): void => {
        if (isCancelled) {
          return;
        }

        const name: string = savedView?.name?.toString() || "";

        if (name) {
          setSavedViewName(name);
          return;
        }

        setSavedViewName("");
        setSavedViewId(null);
      })
      .catch((): void => {
        if (isCancelled) {
          return;
        }

        setSavedViewName("");
        setSavedViewId(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [savedViewId]);

  /*
   * Built from the same state the URL write above is, not by reading the
   * query string: that write happens in an effect, so during this render the
   * URL is still one change behind.
   */
  const viewerRoute: Route = useMemo(() => {
    return withTelemetryTabScopeParams(
      RouteUtil.populateRouteParams(RouteMap[PageMap.METRICS] as Route),
      toPresentParams(
        buildServiceScopedInsightsUrlParams({
          timeRange,
          serviceIds: selectedServiceIds,
          unappliedFilters,
          savedViewId,
          grammar: "pairs",
          search: carriedSearch,
        }),
      ),
    );
  }, [
    timeRange,
    selectedServiceIds,
    unappliedFilters,
    savedViewId,
    carriedSearch,
  ]);

  const unappliedFiltersHint: string = useMemo(() => {
    return describeUnappliedScopeFilters(unappliedFilters, {
      search: carriedSearch,
    });
  }, [unappliedFilters, carriedSearch]);

  const serviceOptions: Array<DropdownOption> = useMemo(() => {
    return services.map((service: Service): DropdownOption => {
      return {
        value: service.id?.toString() || "",
        label: service.name?.toString() || "Unknown Service",
      };
    });
  }, [services]);

  const selectedServiceOptions: Array<DropdownOption> = useMemo(() => {
    return selectedServiceIds.map((serviceId: string): DropdownOption => {
      /*
       * A carried selection has to render even before the service list has
       * loaded — and even for a service that stopped reporting — or the user
       * would have a filter they can see the effect of but not remove.
       */
      return (
        serviceOptions.find((option: DropdownOption): boolean => {
          return option.value === serviceId;
        }) || { value: serviceId, label: serviceId }
      );
    });
  }, [selectedServiceIds, serviceOptions]);

  /*
   * Editing the scope by hand means it is no longer the saved view's scope,
   * so the provenance chip goes and the id stops travelling.
   */
  const applyServiceSelection: (serviceIds: Array<string>) => void = (
    serviceIds: Array<string>,
  ): void => {
    setSelectedServiceIds(serviceIds);
    setSavedViewId(null);
  };

  // Aggregate client-side from analytics result
  const stats: {
    activeMetricNames: Set<string>;
    activeServiceIds: Set<string>;
    metricNamesByService: Map<string, Set<string>>;
    categoryCounts: Map<string, number>;
    totalDataPoints: number;
  } = useMemo(() => {
    const activeMetricNames: Set<string> = new Set();
    const activeServiceIds: Set<string> = new Set();
    const metricNamesByService: Map<string, Set<string>> = new Map();
    const categoryCounts: Map<string, number> = new Map();

    for (const m of activeMetrics) {
      const name: string | undefined = m.name as unknown as string | undefined;
      const primaryEntityId: ObjectID | undefined = m.primaryEntityId;
      if (!name) {
        continue;
      }
      activeMetricNames.add(name);
      if (primaryEntityId) {
        const sid: string = primaryEntityId.toString();
        activeServiceIds.add(sid);
        if (!metricNamesByService.has(sid)) {
          metricNamesByService.set(sid, new Set());
        }
        metricNamesByService.get(sid)!.add(name);
      }
    }

    for (const name of activeMetricNames) {
      const cat: string = categorizeMetric(name);
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    }

    return {
      activeMetricNames,
      activeServiceIds,
      metricNamesByService,
      categoryCounts,
      totalDataPoints: activeMetrics.length,
    };
  }, [activeMetrics]);

  const categories: Array<MetricCategory> = useMemo(() => {
    return Array.from(stats.categoryCounts.entries())
      .map(([name, count]: [string, number]): MetricCategory => {
        const style: { color: string; bgColor: string; barColor: string } =
          CATEGORY_STYLES[name] || CATEGORY_STYLES["Custom"]!;
        return {
          name,
          count,
          color: style.color,
          bgColor: style.bgColor,
          barColor: style.barColor,
        };
      })
      .sort((a: MetricCategory, b: MetricCategory): number => {
        return b.count - a.count;
      });
  }, [stats.categoryCounts]);

  const serviceSummaries: Array<ServiceSummary> = useMemo(() => {
    const serviceById: Map<string, Service> = new Map();
    for (const s of services) {
      if (s.id) {
        serviceById.set(s.id.toString(), s);
      }
    }

    /*
     * Metrics without a service.name are tagged with the projectId
     * (ServiceType.Unknown) and have no Service row. Represent them with
     * a synthetic "Unknown Service" so they still get a summary card
     * (only surfaces when stats.metricNamesByService keys on projectId).
     */
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (projectId && !serviceById.has(projectId.toString())) {
      serviceById.set(
        projectId.toString(),
        TelemetryServiceUtil.getUnknownService(projectId),
      );
    }

    const out: Array<ServiceSummary> = [];
    for (const [sid, names] of stats.metricNamesByService.entries()) {
      const service: Service | undefined = serviceById.get(sid);
      if (!service) {
        continue;
      }
      let hasSystem: boolean = false;
      let hasApp: boolean = false;
      for (const name of names) {
        if (categorizeMetric(name) === "System") {
          hasSystem = true;
        } else {
          hasApp = true;
        }
      }
      out.push({
        service,
        metricCount: names.size,
        metricNames: Array.from(names).slice(0, 6),
        hasSystemMetrics: hasSystem,
        hasAppMetrics: hasApp,
      });
    }
    return out.sort((a: ServiceSummary, b: ServiceSummary): number => {
      return b.metricCount - a.metricCount;
    });
  }, [services, stats.metricNamesByService]);

  const totalMetrics: number = stats.activeMetricNames.size;
  const reportingServices: number = serviceSummaries.length;
  /*
   * Same shared rule as the Logs Insights page: the denominator is the
   * SCOPE, not the project, and both terms must be drawn from the same
   * population — which is why the synthetic "Unknown Service" is folded into
   * `services` at load time rather than only into the summaries.
   *
   * This page has no non-service scope dimension, so coverage is always
   * meaningful here; the flag is read anyway so the two pages cannot drift.
   */
  const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
    scopedServiceIds: selectedServiceIds,
    hasNonServiceResourceScope: false,
    projectServiceCount: services.length,
    reportingServices,
  });
  const scopedServiceCount: number = coverage.scopedServiceCount;
  const dormantServices: number = coverage.quietServices;
  const avgPerService: number =
    reportingServices > 0 ? Math.round(totalMetrics / reportingServices) : 0;
  const cataloguedTypes: number = metricTypes.length;
  const rangeLabel: string = timeRangeLabel(timeRange);

  // -- Render --

  const headerBar: ReactElement = (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Insights</h2>
        <p className="text-xs text-gray-500">
          What your services are reporting in {rangeLabel}.
        </p>
        {(savedViewName || unappliedFiltersHint) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {savedViewName && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
                <span>
                  Scoped by saved view{" "}
                  <span className="font-medium">{savedViewName}</span>
                </span>
                <button
                  type="button"
                  className="ml-0.5 rounded p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700"
                  title="Stop scoping by this saved view"
                  aria-label="Stop scoping by this saved view"
                  onClick={() => {
                    applyServiceSelection([]);
                  }}
                >
                  <Icon icon={IconProp.Close} className="h-3 w-3" />
                </button>
              </span>
            )}
            {unappliedFiltersHint && (
              <HintChip>{unappliedFiltersHint}</HintChip>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[16rem]">
          <Dropdown
            options={serviceOptions}
            value={selectedServiceOptions}
            isMultiSelect={true}
            placeholder="All services"
            ariaLabel="Scope insights to a service"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              if (!value) {
                applyServiceSelection([]);
                return;
              }

              const values: Array<DropdownValue> = Array.isArray(value)
                ? value
                : [value];

              applyServiceSelection(
                values
                  .map((item: DropdownValue): string => {
                    return String(item);
                  })
                  .filter((item: string): boolean => {
                    return item.length > 0;
                  }),
              );
            }}
          />
        </div>
        <TelemetryTimeRangePicker
          value={timeRange}
          onChange={(value: RangeStartAndEndDateTime): void => {
            setTimeRange(value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            void loadDashboard();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          title="Refresh"
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-xl border border-gray-200 bg-white p-12">
          <ComponentLoader />
        </div>
      </Fragment>
    );
  }

  if (error) {
    return (
      <Fragment>
        {headerBar}
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            void loadDashboard();
          }}
        />
      </Fragment>
    );
  }

  if (totalMetrics === 0) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gradient-to-br from-white to-gray-50 p-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Icon
              icon={IconProp.ChartBar}
              className="h-7 w-7 text-indigo-500"
            />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-gray-900">
            No metrics in {rangeLabel}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            {cataloguedTypes > 0
              ? `Your project has ${cataloguedTypes} catalogued metric ${
                  cataloguedTypes === 1 ? "type" : "types"
                }, but none reported during this window. Try widening the time range or check your collectors.`
              : "Once your services start sending metrics via OpenTelemetry, you'll see coverage, categories, and per-service breakdowns here."}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <AppLink
              to={viewerRoute}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
            >
              <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
              <span>Open Viewer</span>
            </AppLink>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.METRICS_DOCUMENTATION] as Route,
              )}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
            >
              <Icon icon={IconProp.Book} className="h-3.5 w-3.5" />
              <span>Setup Guide</span>
            </AppLink>
          </div>
        </div>
      </Fragment>
    );
  }

  const maxMetrics: number = Math.max(
    ...serviceSummaries.map((s: ServiceSummary): number => {
      return s.metricCount;
    }),
    1,
  );

  return (
    <Fragment>
      {headerBar}

      {/* Hero stat cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active metrics"
          value={totalMetrics}
          subtext={`distinct names in ${rangeLabel}`}
          icon={IconProp.ChartBar}
          tone="indigo"
        />
        <StatCard
          label="Reporting services"
          value={reportingServices}
          subtext={
            scopedServiceCount > 0
              ? `${reportingServices} of ${scopedServiceCount} services`
              : "actively sending data"
          }
          icon={IconProp.CheckCircle}
          tone="emerald"
        />
        <StatCard
          label="Avg per service"
          value={avgPerService}
          subtext="metrics per service"
          icon={IconProp.ChartBarSquare}
          tone="sky"
        />
        <StatCard
          label={dormantServices > 0 ? "Quiet services" : "Coverage"}
          value={dormantServices > 0 ? dormantServices : reportingServices}
          subtext={
            dormantServices > 0 ? "no metrics in range" : "all services covered"
          }
          icon={dormantServices > 0 ? IconProp.Alert : IconProp.Check}
          tone={dormantServices > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Metric categories
              </h3>
              <p className="text-xs text-gray-500">
                Distribution of {totalMetrics} active metric
                {totalMetrics === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
            {categories.map((cat: MetricCategory): ReactElement => {
              const pct: number =
                totalMetrics > 0 ? (cat.count / totalMetrics) * 100 : 0;
              return (
                <div
                  key={cat.name}
                  className={cat.barColor}
                  style={{ width: `${Math.max(pct, 1)}%` }}
                  title={`${cat.name}: ${cat.count}`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((cat: MetricCategory): ReactElement => {
              const pct: number =
                totalMetrics > 0
                  ? Math.round((cat.count / totalMetrics) * 100)
                  : 0;
              return (
                <div
                  key={cat.name}
                  className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 ${cat.bgColor}`}
                >
                  <span className={`h-2 w-2 rounded-full ${cat.barColor}`} />
                  <span className={`text-xs font-medium ${cat.color}`}>
                    {cat.name}
                  </span>
                  <span className={`text-xs ${cat.color} opacity-70`}>
                    {cat.count} · {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-service cards */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Services reporting metrics
          </h3>
          <p className="text-xs text-gray-500">
            Coverage and instrumentation per service in {rangeLabel}
          </p>
        </div>
        <AppLink
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          to={viewerRoute}
        >
          <span>Open Viewer</span>
          <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
        </AppLink>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {serviceSummaries.map((summary: ServiceSummary): ReactElement => {
          const coverage: number = Math.round(
            (summary.metricCount / maxMetrics) * 100,
          );
          const sid: string =
            summary.service.id?.toString() ||
            (summary.service._id as string) ||
            "";
          const isUnknownService: boolean =
            TelemetryServiceUtil.isUnknownServiceId(
              sid,
              ProjectUtil.getCurrentProjectId(),
            );
          return (
            <AppLink
              key={sid}
              className="block"
              to={
                isUnknownService
                  ? (RouteUtil.populateRouteParams(
                      RouteMap[PageMap.METRICS] as Route,
                    ) as Route)
                  : RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SERVICE_VIEW_METRICS] as Route,
                      { modelId: new ObjectID(sid) },
                    )
              }
            >
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                <div className="mb-4 flex items-start justify-between">
                  <ServiceElement service={summary.service} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {summary.hasSystemMetrics && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                        System
                      </span>
                    )}
                    {summary.hasAppMetrics && (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                        App
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <div className="mb-1.5 flex items-end justify-between">
                    <span className="text-2xl font-bold text-gray-900">
                      {summary.metricCount}
                    </span>
                    <span className="mb-1 text-xs text-gray-400">
                      metric{summary.metricCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-500 transition-all duration-500"
                      style={{ width: `${Math.max(coverage, 4)}%` }}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {summary.metricNames.map((name: string): ReactElement => {
                    return (
                      <span
                        key={name}
                        className="inline-flex items-center rounded border border-gray-100 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600"
                      >
                        {name}
                      </span>
                    );
                  })}
                  {summary.metricCount > summary.metricNames.length && (
                    <span className="inline-flex items-center rounded bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-400">
                      +{summary.metricCount - summary.metricNames.length} more
                    </span>
                  )}
                </div>
              </div>
            </AppLink>
          );
        })}
      </div>
    </Fragment>
  );
};

interface StatCardProps {
  label: string;
  value: number;
  subtext: string;
  icon: IconProp;
  tone: "indigo" | "emerald" | "sky" | "amber";
}

const TONE_STYLES: Record<
  StatCardProps["tone"],
  { bg: string; text: string; valueText: string }
> = {
  indigo: {
    bg: "bg-indigo-50",
    text: "text-indigo-600",
    valueText: "text-gray-900",
  },
  emerald: {
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    valueText: "text-gray-900",
  },
  sky: {
    bg: "bg-sky-50",
    text: "text-sky-600",
    valueText: "text-gray-900",
  },
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-600",
    valueText: "text-amber-600",
  },
};

const StatCard: FunctionComponent<StatCardProps> = (
  props: StatCardProps,
): ReactElement => {
  const tone: { bg: string; text: string; valueText: string } =
    TONE_STYLES[props.tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{props.label}</p>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone.bg}`}
        >
          <Icon icon={props.icon} className={`h-4 w-4 ${tone.text}`} />
        </div>
      </div>
      <p className={`mt-2 text-3xl font-bold ${tone.valueText}`}>
        {props.value}
      </p>
      <p className="mt-1 text-xs text-gray-400">{props.subtext}</p>
    </div>
  );
};

export default MetricsDashboard;
