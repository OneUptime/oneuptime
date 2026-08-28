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
import API from "Common/UI/Utils/API/API";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dictionary from "Common/Types/Dictionary";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Route from "Common/Types/API/Route";
import Service from "Common/Models/DatabaseModels/Service";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { getSeverityTheme } from "Common/UI/Components/LogsViewer/components/severityTheme";
import AppLink from "../AppLink/AppLink";
import ErrorPatternDetail from "./ErrorPatternDetail";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ServiceElement from "../Service/ServiceElement";
import TopErrorsPanel from "./TopErrorsPanel";
import {
  fetchInsightsHistogram,
  fetchResourceBreakdown,
  fetchScopeFacets,
  fetchTopErrorPatterns,
} from "./LogsInsightsApi";
import LogSavedView from "Common/Models/DatabaseModels/LogSavedView";
import Navigation from "Common/UI/Utils/Navigation";
import HintChip from "../Metrics/HintChip";
import {
  INSIGHTS_SCOPE_FACET_KEYS,
  INSIGHTS_SCOPE_FACET_LABELS,
  LOGS_TAB_DEFAULT_TIME_RANGE,
  LogVolumeSummary,
  LogsInsightsScope,
  LogsInsightsUrlScope,
  ParsedScopeSelections,
  ResourceLogBreakdown,
  ScopeFacetValue,
  SeverityShare,
  TopErrorPatternRow,
  buildLogsInsightsUrlParams,
  describeTimeRange,
  encodeScopeSelection,
  parseScopeSelections,
  readLogsInsightsUrlScope,
  summarizeSeverityBuckets,
} from "../../Utils/LogsInsights";
import {
  TelemetryFilterTuple,
  describeUnappliedScopeFilters,
  toPresentParams,
  withTelemetryTabScopeParams,
} from "../../Utils/TelemetryTabScope";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";
import {
  ScopedServiceCoverage,
  computeScopedServiceCoverage,
} from "../../Utils/ServiceCoverage";
import { hasResourceEntityFacetSelections } from "Common/Types/Telemetry/ResourceEntityFacet";

/*
 * The Logs Insights page.
 *
 * Two things distinguish it from a wall of counters. First, every number is
 * aggregated in ClickHouse over the whole window: the page previously
 * fetched a capped page of raw log rows and counted those in the browser,
 * so on any busy project its totals silently described the fetch rather
 * than the project. Second, it names the errors — the distinct messages,
 * how often each happened, and, one click in, what surrounded it.
 */

/** How many error patterns the list asks for. */
const TOP_ERROR_LIMIT: number = 12;

/** How many resources the per-service section renders before cutting off. */
const RESOURCE_CARD_LIMIT: number = 12;

const LogsDashboard: FunctionComponent = (): ReactElement => {
  /*
   * The slice the Viewer tab handed over, read once on mount.
   *
   * This is the whole answer to "selecting a saved view in the Viewer and
   * switching to Insights shows All services and hosts": the Viewer already
   * mirrors its scope into the URL, the tab link carries those params here,
   * and this page starts from them instead of from nothing.
   */
  const [initialUrlScope] = useState<LogsInsightsUrlScope>(() => {
    return readLogsInsightsUrlScope(Navigation.getQueryString());
  });

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(() => {
    return initialUrlScope.timeRange || { range: LOGS_TAB_DEFAULT_TIME_RANGE };
  });
  /*
   * Encoded "<facetKey>:<id>" values — one flat multi-select over Services
   * AND the resources that log under their own id (hosts, docker hosts,
   * Kubernetes clusters). Decoded into the two scope fields the API takes
   * by parseScopeSelections.
   */
  const [selectedScopeValues, setSelectedScopeValues] = useState<Array<string>>(
    initialUrlScope.scopeValues,
  );

  /*
   * Viewer chips this page has no dimension for — a body search, a trace id,
   * a severity selection. Held, never applied, and re-emitted on the way
   * back so the round trip does not quietly drop them.
   */
  const [unappliedFilters] = useState<Array<TelemetryFilterTuple>>(
    initialUrlScope.unappliedFilters,
  );

  /*
   * The saved view this scope came from. Provenance only: it names the chip
   * the page shows, and it is what lets the trip back land the user inside
   * the same view rather than on its filters with nothing selected. Cleared
   * the moment the user edits the scope, because at that point the scope is
   * no longer the view's.
   */
  const [savedViewId, setSavedViewId] = useState<string | null>(
    initialUrlScope.savedViewId,
  );
  const [savedViewName, setSavedViewName] = useState<string>("");

  const [services, setServices] = useState<Array<Service>>([]);
  const [scopeFacets, setScopeFacets] = useState<
    Dictionary<Array<ScopeFacetValue>>
  >({});
  const [volume, setVolume] = useState<LogVolumeSummary | null>(null);
  const [errorPatterns, setErrorPatterns] = useState<Array<TopErrorPatternRow>>(
    [],
  );
  const [resourceBreakdown, setResourceBreakdown] = useState<
    Array<ResourceLogBreakdown>
  >([]);
  const [selectedPattern, setSelectedPattern] =
    useState<TopErrorPatternRow | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Generation token for the in-flight batch. Both the time picker and the
   * scope multi-select commit immediately — no apply step, no debounce — so
   * two quick changes leave two batches racing, and without this the batch
   * that RESOLVES last wins rather than the one the user asked for last.
   * Switching to a 30-day window and straight back to 1 hour would leave
   * the slow 30-day numbers on screen under a "past 1 hour" label.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  /*
   * One scope object, shared by every panel and by the detail drawer, so a
   * correlation the page draws is always a correlation inside the slice the
   * user selected.
   */
  const scope: LogsInsightsScope = useMemo(() => {
    const selections: ParsedScopeSelections =
      parseScopeSelections(selectedScopeValues);

    return { timeRange, ...selections };
  }, [timeRange, selectedScopeValues]);

  /*
   * Mirror this page's scope into the URL, in the Logs Viewer's own grammar.
   *
   * Two things fall out of writing the Viewer's grammar rather than a
   * private one. The tab link back needs no translation — an Insights URL IS
   * a Viewer URL — and a refresh, a bookmark or a pasted link restores the
   * scope the user built here, which the page previously forgot on every
   * reload.
   */
  useEffect(() => {
    writeTelemetryViewerUrlState(
      buildLogsInsightsUrlParams({
        timeRange,
        scopeValues: selectedScopeValues,
        unappliedFilters,
        savedViewId,
      }),
    );
  }, [timeRange, selectedScopeValues, unappliedFilters, savedViewId]);

  /*
   * The name behind the carried saved-view id, so the page can say WHERE its
   * scope came from rather than showing an unexplained set of services.
   *
   * Best-effort: a view that has been deleted (or belongs to another
   * project) drops the reference instead of surfacing an error — the scope
   * itself came over in the URL and is still perfectly usable.
   */
  useEffect(() => {
    if (!savedViewId) {
      setSavedViewName("");
      return;
    }

    let isCancelled: boolean = false;

    ModelAPI.getItem({
      modelType: LogSavedView,
      id: new ObjectID(savedViewId),
      select: { name: true },
    })
      .then((savedView: LogSavedView | null): void => {
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
   * Every in-page route back to the Viewer carries this scope, not just the
   * tab. A user who followed "Open Viewer" out of an empty Insights page and
   * landed on the unfiltered firehose would reasonably read that as the
   * filter having been lost.
   */
  const viewerRoute: Route = useMemo(() => {
    /*
     * Built from the same state the URL write above is built from, NOT by
     * reading the query string: that write happens in an effect, so during
     * this render the URL still describes the previous scope and the link
     * would always be one change behind.
     */
    return withTelemetryTabScopeParams(
      RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
      toPresentParams(
        buildLogsInsightsUrlParams({
          timeRange,
          scopeValues: selectedScopeValues,
          unappliedFilters,
          savedViewId,
        }),
      ),
    );
  }, [timeRange, selectedScopeValues, unappliedFilters, savedViewId]);

  const unappliedFiltersHint: string = useMemo(() => {
    return describeUnappliedScopeFilters(unappliedFilters);
  }, [unappliedFilters]);

  const loadServices: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      const result: { data: Array<Service> } = await ModelAPI.getList({
        modelType: Service,
        query: { projectId },
        select: { name: true, serviceColor: true },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { name: SortOrder.Ascending },
      });

      setServices(result.data || []);
    }, []);

  const loadInsights: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const generation: number = ++loadGenerationRef.current;

      try {
        setIsLoading(true);
        setError("");

        /*
         * Clear the derived state as the new load starts. Without this the
         * stat cards, severity split and per-source cards keep rendering
         * the PREVIOUS window's numbers under the new range label for the
         * whole duration of the refetch — and if the previous window was
         * empty, the page asserts "No logs in <new range>" for a window it
         * has not queried yet.
         */
        setVolume(null);
        setErrorPatterns([]);
        setResourceBreakdown([]);

        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          setIsLoading(false);
          return;
        }

        const [buckets, patterns, breakdown, facets] = await Promise.all([
          fetchInsightsHistogram(scope),
          fetchTopErrorPatterns(scope, TOP_ERROR_LIMIT),
          fetchResourceBreakdown(scope),
          /*
           * Non-critical: without it the picker just falls back to the
           * Services the project has, which is still a usable page.
           */
          fetchScopeFacets(scope).catch(
            (): Dictionary<Array<ScopeFacetValue>> => {
              return {};
            },
          ),
        ]);

        // A batch the user has already moved on from must not commit.
        if (loadGenerationRef.current !== generation) {
          return;
        }

        setVolume(summarizeSeverityBuckets(buckets as Array<JSONObject>));
        setErrorPatterns(patterns);
        setResourceBreakdown(breakdown);
        setScopeFacets(facets);
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
    }, [scope]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  /*
   * A drawer opened against the previous scope would keep describing a
   * window the page has moved on from, so close it when the scope changes.
   */
  useEffect(() => {
    setSelectedPattern(null);
  }, [scope]);

  const serviceById: Map<string, Service> = useMemo(() => {
    const map: Map<string, Service> = new Map();

    for (const service of services) {
      const id: string | undefined =
        service.id?.toString() || (service._id as string | undefined);

      if (id) {
        map.set(id, service);
      }
    }

    return map;
  }, [services]);

  /*
   * One option group per resource kind. Built from the facet response
   * rather than from the project's Service list so the picker offers
   * exactly what has telemetry in the window — including hosts and
   * clusters, which have no Service row at all.
   */
  const scopeOptionGroups: Array<DropdownOptionGroup> = useMemo(() => {
    const groups: Array<DropdownOptionGroup> = [];

    for (const facetKey of INSIGHTS_SCOPE_FACET_KEYS) {
      const values: Array<ScopeFacetValue> = scopeFacets[facetKey] || [];

      if (values.length === 0) {
        continue;
      }

      groups.push({
        label: INSIGHTS_SCOPE_FACET_LABELS[facetKey] || facetKey,
        options: values.map((value: ScopeFacetValue): DropdownOption => {
          return {
            value: encodeScopeSelection(facetKey, value.value),
            label:
              serviceById.get(value.value)?.name?.toString() ||
              value.displayName,
          };
        }),
      });
    }

    return groups;
  }, [scopeFacets, serviceById]);

  const scopeOptionByValue: Map<string, DropdownOption> = useMemo(() => {
    const map: Map<string, DropdownOption> = new Map();

    for (const group of scopeOptionGroups) {
      for (const option of group.options) {
        map.set(option.value as string, option);
      }
    }

    return map;
  }, [scopeOptionGroups]);

  const selectedScopeOptions: Array<DropdownOption> = useMemo(() => {
    return selectedScopeValues
      .map((value: string): DropdownOption | undefined => {
        /*
         * A selection whose option has left the facet list (the window
         * moved and that host stopped logging) still has to render, or the
         * user would have a filter they cannot see or remove.
         */
        return (
          scopeOptionByValue.get(value) || {
            value,
            label: value.split(":")[1] || value,
          }
        );
      })
      .filter(
        (option: DropdownOption | undefined): option is DropdownOption => {
          return option !== undefined;
        },
      );
  }, [selectedScopeValues, scopeOptionByValue]);

  const rangeLabel: string = describeTimeRange(timeRange);

  /*
   * The user editing the scope by hand means it is no longer the saved
   * view's scope, so the provenance chip goes and the id stops travelling —
   * carrying it on would send the user back into a view whose filters no
   * longer match what they are looking at.
   */
  const applyScopeSelection: (values: Array<string>) => void = (
    values: Array<string>,
  ): void => {
    setSelectedScopeValues(values);
    setSavedViewId(null);
  };

  const headerBar: ReactElement = (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Insights</h2>
        <p className="text-xs text-gray-500">
          What your services are logging in {rangeLabel} — and what is going
          wrong.
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
                    applyScopeSelection([]);
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
            options={scopeOptionGroups}
            value={selectedScopeOptions}
            isMultiSelect={true}
            placeholder="All services and hosts"
            ariaLabel="Scope insights to a service, host or cluster"
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              if (!value) {
                applyScopeSelection([]);
                return;
              }

              const values: Array<DropdownValue> = Array.isArray(value)
                ? value
                : [value];

              applyScopeSelection(
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
            void loadInsights();
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

  if (isLoading && !volume) {
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
            void loadInsights();
          }}
        />
      </Fragment>
    );
  }

  const total: number = volume?.total || 0;

  if (total === 0) {
    return (
      <Fragment>
        {headerBar}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gradient-to-br from-white to-gray-50 p-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Icon icon={IconProp.List} className="h-7 w-7 text-indigo-500" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-gray-900">
            No logs in {rangeLabel}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            Once your services start shipping logs via OpenTelemetry,
            you&apos;ll see your top errors, severity distribution and
            per-service volume here.
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
                RouteMap[PageMap.LOGS_DOCUMENTATION] as Route,
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

  const reportingResources: number = resourceBreakdown.length;
  /*
   * Counted against the resources that ARE Services, not against every
   * reporting resource: hosts and clusters log under their own ids too, and
   * including them would make "quiet services" go negative on any project
   * running the infrastructure agent.
   */
  const reportingServices: number = resourceBreakdown.filter(
    (row: ResourceLogBreakdown): boolean => {
      return serviceById.has(row.resourceId);
    },
  ).length;
  /*
   * The denominator for "quiet services" and "N of M services" is the SCOPE,
   * not the project — and under a scope with no service dimension at all (a
   * host, a Kubernetes cluster) there is no denominator, so the question
   * goes away rather than being answered with the project's total. See
   * Utils/ServiceCoverage for why.
   */
  const coverage: ScopedServiceCoverage = computeScopedServiceCoverage({
    scopedServiceIds: scope.serviceIds || [],
    hasNonServiceResourceScope: hasResourceEntityFacetSelections(
      scope.resourceFilters,
    ),
    projectServiceCount: services.length,
    reportingServices,
  });
  const showQuietServices: boolean =
    coverage.isCoverageMeaningful && coverage.quietServices > 0;
  const maxResourceVolume: number = Math.max(
    ...resourceBreakdown.map((row: ResourceLogBreakdown): number => {
      return row.total;
    }),
    1,
  );

  return (
    <Fragment>
      {headerBar}

      {/* Hero stat cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total logs"
          value={total}
          subtext={`ingested in ${rangeLabel}`}
          icon={IconProp.List}
          tone="indigo"
        />
        <StatCard
          label="Errors"
          value={volume?.errorCount || 0}
          subtext={`${volume?.errorRatePercent || 0}% of total volume`}
          icon={IconProp.Alert}
          tone={(volume?.errorCount || 0) > 0 ? "amber" : "emerald"}
        />
        <StatCard
          label="Distinct errors"
          value={errorPatterns.length}
          subtext={
            errorPatterns.length > 0
              ? "unique messages, listed below"
              : "nothing failing"
          }
          icon={IconProp.Search}
          tone={errorPatterns.length > 0 ? "amber" : "emerald"}
        />
        <StatCard
          label={showQuietServices ? "Quiet services" : "Reporting sources"}
          value={
            showQuietServices ? coverage.quietServices : reportingResources
          }
          subtext={
            showQuietServices
              ? "no logs in range"
              : coverage.isCoverageMeaningful && coverage.scopedServiceCount > 0
                ? `${reportingServices} of ${coverage.scopedServiceCount} services`
                : "sending logs"
          }
          icon={showQuietServices ? IconProp.Alert : IconProp.CheckCircle}
          tone={showQuietServices ? "amber" : "emerald"}
        />
      </div>

      {/* Severity distribution */}
      {volume && volume.severities.length > 0 && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-gray-900">
              Severity distribution
            </h3>
            <p className="text-xs text-gray-500">
              How {total.toLocaleString()} log{total === 1 ? "" : "s"} break
              down by severity
            </p>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
            {volume.severities.map((share: SeverityShare): ReactElement => {
              const widthPercent: number =
                total > 0 ? (share.count / total) * 100 : 0;

              return (
                <div
                  key={share.severity}
                  className={getSeverityTheme(share.severity).dotClass}
                  style={{ width: `${Math.max(widthPercent, 1)}%` }}
                  title={`${share.severity}: ${share.count}`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {volume.severities.map((share: SeverityShare): ReactElement => {
              return (
                <div
                  key={share.severity}
                  className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                    getSeverityTheme(share.severity).badgeClass
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      getSeverityTheme(share.severity).dotClass
                    }`}
                  />
                  <span>{share.severity}</span>
                  <span className="opacity-70">
                    {share.count.toLocaleString()} · {share.percent}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <TopErrorsPanel
        patterns={errorPatterns}
        timeRange={timeRange}
        isLoading={isLoading}
        serviceNameById={serviceById}
        selectedPattern={selectedPattern?.pattern}
        onSelect={(row: TopErrorPatternRow): void => {
          setSelectedPattern(row);
        }}
      />

      {/* Per-resource volume */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Sources reporting logs
          </h3>
          <p className="text-xs text-gray-500">
            Volume and error signal per service in {rangeLabel}
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
        {resourceBreakdown
          .slice(0, RESOURCE_CARD_LIMIT)
          .map((row: ResourceLogBreakdown): ReactElement => {
            const service: Service | undefined = serviceById.get(
              row.resourceId,
            );
            const coverage: number = Math.round(
              (row.total / maxResourceVolume) * 100,
            );

            const card: ReactElement = (
              <div className="h-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                <div className="mb-4 flex items-start justify-between gap-2">
                  {service ? (
                    <ServiceElement service={service} />
                  ) : (
                    /*
                     * Logs primary-keyed on a host, cluster or other
                     * non-Service resource have no Service row to name them.
                     * Showing the raw id beats dropping the row: it is still
                     * volume the user is paying for and can search on.
                     */
                    <span className="truncate font-mono text-xs text-gray-500">
                      {row.resourceId}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {row.errorCount > 0 && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        {row.errorCount.toLocaleString()} error
                        {row.errorCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {row.warnCount > 0 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {row.warnCount.toLocaleString()} warn
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-1">
                  <div className="mb-1.5 flex items-end justify-between">
                    <span className="text-2xl font-bold text-gray-900">
                      {row.total.toLocaleString()}
                    </span>
                    <span className="mb-1 text-xs text-gray-400">
                      log{row.total === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-500 transition-all duration-500"
                      style={{ width: `${Math.max(coverage, 4)}%` }}
                    />
                  </div>
                </div>
              </div>
            );

            if (!service) {
              return <div key={row.resourceId}>{card}</div>;
            }

            return (
              <AppLink
                key={row.resourceId}
                className="block"
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.SERVICE_VIEW_LOGS] as Route,
                  { modelId: new ObjectID(row.resourceId) },
                )}
              >
                {card}
              </AppLink>
            );
          })}
      </div>

      {selectedPattern && (
        <ErrorPatternDetail
          /*
           * Keyed on the pattern so switching rows REMOUNTS the drawer.
           * SideOver is deliberately non-modal, so the list stays clickable
           * behind it; without the key an in-flight correlation for the
           * previous pattern could resolve last and pair its timeline,
           * attributes and traces with the new pattern's header.
           */
          key={selectedPattern.pattern}
          pattern={selectedPattern}
          scope={scope}
          serviceNameById={serviceById}
          onClose={() => {
            setSelectedPattern(null);
          }}
        />
      )}
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
        {props.value.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-gray-400">{props.subtext}</p>
    </div>
  );
};

export default LogsDashboard;
