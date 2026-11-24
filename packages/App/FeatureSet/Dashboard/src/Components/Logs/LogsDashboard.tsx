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
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import API from "Common/UI/Utils/API/API";
import Dictionary from "Common/Types/Dictionary";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import Route from "Common/Types/API/Route";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { getSeverityTheme } from "Common/UI/Components/LogsViewer/components/severityTheme";
import AppLink from "../AppLink/AppLink";
import ErrorPatternDetail from "./ErrorPatternDetail";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ServiceElement from "../Service/ServiceElement";
import TopErrorsPanel from "./TopErrorsPanel";
import {
  LogsResourceDisplay,
  LogsResourceRef,
  buildLogsResourceTypeHints,
  collectLogsInsightsResourceRefs,
  collectLogsResourceIds,
  describeLogsResource,
} from "./LogsResourceDisplay";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { TelemetryEntityNameMap } from "Common/UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { describeLogsTimeRange } from "./LogsInsightsCopy";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";
import TelemetryResourceScopePicker from "../Telemetry/TelemetryResourceScopePicker";
import { SERVICE_SCOPE_FACET_KEY } from "../Telemetry/TelemetryResourceScope";
import {
  TelemetryServicesOnPage,
  useTelemetryServicesOnPage,
} from "../Telemetry/TelemetryServicesOnPage";
import TelemetryServiceUtil from "Common/UI/Utils/TelemetryService";

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
  const translator: Translator = useTranslator();
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

  /*
   * The services the page's sources and top errors name, read by their ids
   * as each load lands (TelemetryServicesOnPage), by lower-cased id: never
   * the project's first 10,000 by name, past which a service's card lost
   * its name, its colour and its link, and the scope picker could not name
   * it (#10921).
   */
  const servicesOnPage: TelemetryServicesOnPage = useTelemetryServicesOnPage();
  const [serviceById, setServiceById] = useState<Map<string, Service>>(
    new Map(),
  );
  /*
   * How many services the project has, counted on the server: the
   * population the quiet services are counted against when the page is not
   * scoped.
   */
  const [projectServiceCount, setProjectServiceCount] = useState<number>(0);
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
    return describeUnappliedScopeFilters(
      unappliedFilters,
      undefined,
      translator,
    );
  }, [unappliedFilters, translator.language]);

  /*
   * How many services the project has: one row and the count, never the
   * first 10,000 by name, which a project can pass (#10921).
   */
  const countProjectServices: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      try {
        const result: { data: Array<Service>; count?: number } =
          await ModelAPI.getList({
            modelType: Service,
            query: { projectId },
            select: { _id: true },
            limit: 1,
            skip: 0,
            sort: {},
          });

        setProjectServiceCount(
          Math.max(result.count ?? 0, result.data?.length || 0),
        );
      } catch {
        // Non-critical: the coverage card counts the reporting sources then.
      }
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

        /*
         * The services the sources and the top errors name, read by their
         * ids before they are drawn: a card is a service's card, named and
         * coloured, however far past the project's first 10,000 services
         * it is. An id that is no service (a host, a RUM application, the
         * project's own) is named by the resolver below, as before.
         */
        const known: Map<string, Service> = await servicesOnPage.readServicesOf(
          [
            ...breakdown.map((row: ResourceLogBreakdown): string => {
              return row.resourceId;
            }),
            ...patterns.flatMap((row: TopErrorPatternRow): Array<string> => {
              return row.resourceIds || [];
            }),
          ],
        );

        if (loadGenerationRef.current !== generation) {
          return;
        }

        setServiceById(new Map(known));
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
    void countProjectServices();
  }, [countProjectServices]);

  useEffect(() => {
    void loadInsights();
  }, [loadInsights]);

  /*
   * Set by a zoom (or its reset) and read by the effect below. The zoom is
   * made from the error drawer's own timeline — the reader digging into
   * that error — so the drawer stays open and follows the new window.
   */
  const isZoomChangeRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  /*
   * Drag-to-zoom (issue #4105). A drag across the error drawer's timeline
   * retimes the whole page — stat cards, severity split, top errors,
   * sources and the drawer — and a double-click or "Reset zoom" beside the
   * picker puts the page back. The picker keeps setting the range itself:
   * a pick is a new starting point, and it still closes the drawer.
   */
  const handleZoomTimeRangeChange: (next: RangeStartAndEndDateTime) => void =
    useCallback((next: RangeStartAndEndDateTime): void => {
      isZoomChangeRef.current = true;
      setTimeRange(next);
    }, []);

  /*
   * A drawer opened against the previous scope would keep describing a
   * window the page has moved on from, so close it when the scope changes —
   * unless the change is a zoom, which the drawer follows.
   */
  useEffect(() => {
    if (isZoomChangeRef.current) {
      isZoomChangeRef.current = false;
      return;
    }

    setSelectedPattern(null);
  }, [scope]);

  /*
   * After a zoom the list reloads for the new window; the open drawer takes
   * its row from it, so its header (first and last seen, sources) describes
   * the window it is now showing rather than the one before the zoom.
   */
  useEffect(() => {
    setSelectedPattern(
      (current: TopErrorPatternRow | null): TopErrorPatternRow | null => {
        if (!current) {
          return current;
        }

        return (
          errorPatterns.find((row: TopErrorPatternRow): boolean => {
            return row.pattern === current.pattern;
          }) || current
        );
      },
    );
  }, [errorPatterns]);

  /*
   * Resource ids the Service list cannot name. Logs are keyed on a
   * polymorphic primaryEntityId, so a RUM application, host or cluster
   * reporting logs has no Service row — the cards, the "Top errors" rows
   * and the picker used to show its raw UUID. Resolve those against their
   * own tables (hinted by the facet they came from) with one lookup.
   */
  const resourceRefsToName: Array<LogsResourceRef> = useMemo(() => {
    return collectLogsInsightsResourceRefs({
      breakdownResourceIds: resourceBreakdown
        .slice(0, RESOURCE_CARD_LIMIT)
        .map((row: ResourceLogBreakdown): string => {
          return row.resourceId;
        }),
      errorPatterns,
    });
  }, [resourceBreakdown, errorPatterns]);

  const unnamedResourceIds: Array<string> = useMemo(() => {
    return collectLogsResourceIds(resourceRefsToName, (resourceId: string) => {
      return Boolean(serviceById.get(resourceId.toLowerCase())?.name);
    });
  }, [resourceRefsToName, serviceById]);

  const resourceTypeHints: Record<string, ServiceType> | undefined =
    useMemo(() => {
      return buildLogsResourceTypeHints(resourceRefsToName);
    }, [resourceRefsToName]);

  const resourceNames: TelemetryEntityNameMap = useTelemetryEntityNames(
    unnamedResourceIds,
    { typeHints: resourceTypeHints },
  );

  /*
   * The kinds of resource the scope picker searches beside the services:
   * the kinds the logs facets list for the window (the project has some of
   * them). The picker searches each on the server and names what the scope
   * holds by its ids (TelemetryResourceScopePicker) - never the window's
   * first 200 of each, named from the project's first 10,000 services
   * (#10921).
   */
  const scopeResourceFacetKeys: Array<string> = useMemo(() => {
    return INSIGHTS_SCOPE_FACET_KEYS.filter((facetKey: string): boolean => {
      return (
        facetKey !== SERVICE_SCOPE_FACET_KEY &&
        (scopeFacets[facetKey] || []).length > 0
      );
    });
  }, [scopeFacets]);

  /*
   * "Unknown Service" is offered in the scope picker while the window's
   * logs name it: logs that named no service are tagged with the project's
   * id.
   */
  const offersUnknownService: boolean = resourceBreakdown.some(
    (row: ResourceLogBreakdown): boolean => {
      return TelemetryServiceUtil.isUnknownServiceId(
        row.resourceId,
        ProjectUtil.getCurrentProjectId(),
      );
    },
  );

  const rangeLabel: string = describeLogsTimeRange(timeRange, translator);

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
        <h2 className="text-base font-semibold text-gray-900">
          {translator.translateText("Insights")}
        </h2>
        <p className="text-xs text-gray-500">
          {translator.translateTemplate(
            "What your services are logging in {{range}} — and what is going wrong.",
            { range: rangeLabel },
          )}
        </p>
        {(savedViewName || unappliedFiltersHint) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {savedViewName && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
                <span>
                  <TranslatedSentence
                    template="Scoped by saved view {{view}}"
                    slots={{
                      view: (
                        <span className="font-medium">{savedViewName}</span>
                      ),
                    }}
                  />
                </span>
                <button
                  type="button"
                  className="ml-0.5 rounded p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700"
                  title={translator.translateText(
                    "Stop scoping by this saved view",
                  )}
                  aria-label={translator.translateText(
                    "Stop scoping by this saved view",
                  )}
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
          <TelemetryResourceScopePicker
            values={selectedScopeValues}
            resourceFacetKeys={scopeResourceFacetKeys}
            offersUnknownService={offersUnknownService}
            placeholder="All services and hosts"
            ariaLabel="Scope insights to a service, host or cluster"
            dataTestId="logs-insights-scope"
            onChange={(values: Array<string>): void => {
              applyScopeSelection(values);
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
          title={translator.translateText("Refresh")}
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          <span>{translator.translateText("Refresh")}</span>
        </button>
      </div>
    </div>
  );

  const patternDrawer: ReactElement | null = selectedPattern ? (
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
  ) : null;

  /*
   * Every state of the page renders through here, under one zoom scope
   * with the header (whose picker shows "Reset zoom" while zoomed) and the
   * drawer at the same places. A zoom reloads the page, and the loading
   * state must not unmount the zoom it came from or the drawer it was made
   * in.
   */
  type RenderPageFunction = (content: ReactElement) => ReactElement;
  const renderPage: RenderPageFunction = (
    content: ReactElement,
  ): ReactElement => {
    return (
      <TimeRangeZoomScope
        timeRange={timeRange}
        onTimeRangeChange={handleZoomTimeRangeChange}
      >
        {headerBar}
        {content}
        {patternDrawer}
      </TimeRangeZoomScope>
    );
  };

  if (isLoading && !volume) {
    return renderPage(
      <div className="rounded-xl border border-gray-200 bg-white p-12">
        <ChartSkeleton />
      </div>,
    );
  }

  if (error) {
    return renderPage(
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void loadInsights();
        }}
      />,
    );
  }

  const total: number = volume?.total || 0;

  if (total === 0) {
    return renderPage(
      <Fragment>
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gradient-to-br from-white to-gray-50 p-16 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Icon icon={IconProp.List} className="h-7 w-7 text-indigo-500" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-gray-900">
            {translator.translateTemplate("No logs in {{range}}", {
              range: rangeLabel,
            })}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
            {translator.translateText(
              "Once your services start shipping logs via OpenTelemetry, you'll see your top errors, severity distribution and per-service volume here.",
            )}
          </p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <AppLink
              to={viewerRoute}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50"
            >
              <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
              <span>{translator.translateText("Open Viewer")}</span>
            </AppLink>
            <AppLink
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.LOGS_DOCUMENTATION] as Route,
              )}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
            >
              <Icon icon={IconProp.Book} className="h-3.5 w-3.5" />
              <span>{translator.translateText("Setup Guide")}</span>
            </AppLink>
          </div>
        </div>
      </Fragment>,
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
      return serviceById.has(row.resourceId.toLowerCase());
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
    projectServiceCount,
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

  return renderPage(
    <Fragment>
      {/* Hero stat cards */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total logs"
          value={total}
          subtext={translator.translateTemplate("ingested in {{range}}", {
            range: rangeLabel,
          })}
          icon={IconProp.List}
          tone="indigo"
        />
        <StatCard
          label="Errors"
          value={volume?.errorCount || 0}
          subtext={translator.translateTemplate(
            "{{percent}}% of total volume",
            { percent: volume?.errorRatePercent || 0 },
          )}
          icon={IconProp.Alert}
          tone={(volume?.errorCount || 0) > 0 ? "amber" : "emerald"}
        />
        <StatCard
          label="Distinct errors"
          value={errorPatterns.length}
          subtext={
            translator.translateText(
              errorPatterns.length > 0
                ? "unique messages, listed below"
                : "nothing failing",
            ) as string
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
              ? (translator.translateText("no logs in range") as string)
              : coverage.isCoverageMeaningful && coverage.scopedServiceCount > 0
                ? translator.translatePlural(
                    {
                      one: "{{reporting}} of {{count}} service",
                      other: "{{reporting}} of {{count}} services",
                    },
                    coverage.scopedServiceCount,
                    { reporting: reportingServices },
                  )
                : (translator.translateText("sending logs") as string)
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
              {translator.translateText("Severity distribution")}
            </h3>
            <p className="text-xs text-gray-500">
              {translator.translatePlural(
                {
                  one: "How {{count}} log breaks down by severity",
                  other: "How {{count}} logs break down by severity",
                },
                total,
              )}
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
                    {share.count.toLocaleString(getReaderNumberLocale())} ·{" "}
                    {share.percent}%
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
        resourceNames={resourceNames}
        selectedPattern={selectedPattern?.pattern}
        onSelect={(row: TopErrorPatternRow): void => {
          setSelectedPattern(row);
        }}
      />

      {/* Per-resource volume */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {translator.translateText("Sources reporting logs")}
          </h3>
          <p className="text-xs text-gray-500">
            {translator.translateTemplate(
              "Volume and error signal per service in {{range}}",
              { range: rangeLabel },
            )}
          </p>
        </div>
        <AppLink
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          to={viewerRoute}
        >
          <span>{translator.translateText("Open Viewer")}</span>
          <Icon icon={IconProp.ChevronRight} className="h-3.5 w-3.5" />
        </AppLink>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {resourceBreakdown
          .slice(0, RESOURCE_CARD_LIMIT)
          .map((row: ResourceLogBreakdown): ReactElement => {
            const service: Service | undefined = serviceById.get(
              row.resourceId.toLowerCase(),
            );
            const resourceDisplay: LogsResourceDisplay = describeLogsResource({
              resourceId: row.resourceId,
              nameMap: resourceNames,
            });
            const coverage: number = Math.round(
              (row.total / maxResourceVolume) * 100,
            );

            const card: ReactElement = (
              <div className="h-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
                <div className="mb-4 flex items-start justify-between gap-2">
                  {service ? (
                    <ServiceElement service={service} />
                  ) : resourceDisplay.name !== row.resourceId ? (
                    /*
                     * Logs primary-keyed on a RUM application, host, cluster
                     * or other non-Service resource have no Service row, so
                     * they are named from their own table, with their type.
                     */
                    <span
                      className="min-w-0 truncate text-sm font-medium text-gray-900"
                      title={row.resourceId}
                    >
                      {resourceDisplay.name}
                      {resourceDisplay.typeLabel && (
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          {translator.translateText(resourceDisplay.typeLabel)}
                        </span>
                      )}
                    </span>
                  ) : (
                    /*
                     * Nothing could name it (deleted, or a table the user
                     * cannot read). Showing the raw id beats dropping the
                     * row: it is still volume the user is paying for and can
                     * search on.
                     */
                    <span className="truncate font-mono text-xs text-gray-500">
                      {row.resourceId}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {row.errorCount > 0 && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        {translator.translatePlural(
                          { one: "{{count}} error", other: "{{count}} errors" },
                          row.errorCount,
                        )}
                      </span>
                    )}
                    {row.warnCount > 0 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {translator.translatePlural(
                          { one: "{{count}} warn", other: "{{count}} warn" },
                          row.warnCount,
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mb-1">
                  <div className="mb-1.5 flex items-end justify-between">
                    <span className="text-2xl font-bold text-gray-900">
                      {row.total.toLocaleString(getReaderNumberLocale())}
                    </span>
                    <span className="mb-1 text-xs text-gray-500">
                      {translator.translatePlural(
                        { one: "log", other: "logs" },
                        row.total,
                      )}
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
    </Fragment>,
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
  const translator: Translator = useTranslator();
  const tone: { bg: string; text: string; valueText: string } =
    TONE_STYLES[props.tone];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">
          {translator.translateText(props.label)}
        </p>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone.bg}`}
        >
          <Icon icon={props.icon} className={`h-4 w-4 ${tone.text}`} />
        </div>
      </div>
      <p className={`mt-2 text-3xl font-bold ${tone.valueText}`}>
        {props.value.toLocaleString(getReaderNumberLocale())}
      </p>
      <p className="mt-1 text-xs text-gray-500">{props.subtext}</p>
    </div>
  );
};

export default LogsDashboard;
