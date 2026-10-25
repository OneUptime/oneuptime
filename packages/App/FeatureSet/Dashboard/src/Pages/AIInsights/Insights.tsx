import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import OneUptimeDate from "Common/Types/Date";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import AIPlanGate from "../../Components/AI/AIPlanGate";
import InsightFilterBar, {
  InsightFilterOption,
} from "../../Components/AIInsights/InsightFilterBar";
import {
  DEFAULT_INSIGHT_SORT,
  INSIGHT_SEEN_WITHIN_OPTIONS,
  INSIGHT_SORT_OPTIONS,
  InsightSeenWithinValue,
  InsightSortValue,
  getInsightSeenWithinFilter,
  getInsightSort,
  parseInsightSeenWithin,
  parseInsightSort,
} from "../../Components/AIInsights/InsightListOrdering";
import InsightHighlights from "../../Components/AIInsights/InsightHighlights";
import InsightListItem from "../../Components/AIInsights/InsightListItem";
import InsightListSkeleton from "../../Components/AIInsights/InsightListSkeleton";
import InsightStatusSummary, {
  InsightStatusBucket,
} from "../../Components/AIInsights/InsightStatusSummary";
import {
  INSIGHT_TYPE_LABELS,
  STATUS_LABELS,
  getStatusDotClasses,
} from "../../Components/AIInsights/InsightPresentation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

const INSIGHTS_PER_PAGE: number = 20;

const SKELETON_ROW_COUNT: number = 6;

const ALL_FILTER_VALUE: string = "All";

interface StatusSummaryDefinition {
  label: string;
  value: string;
  dotClassName: string;
}

/*
 * The lifecycle states worth their own tile. Detected is deliberately absent:
 * the scanner routes every insight out of it in the same tick, so a tile for
 * it would read zero forever (those rows are still in the All total).
 */
const STATUS_SUMMARY_DEFINITIONS: Array<StatusSummaryDefinition> = [
  {
    label: "All insights",
    value: ALL_FILTER_VALUE,
    dotClassName: "bg-indigo-500",
  },
  {
    label: STATUS_LABELS[AIInsightStatus.ActionRequired],
    value: AIInsightStatus.ActionRequired,
    dotClassName: getStatusDotClasses(AIInsightStatus.ActionRequired),
  },
  {
    label: STATUS_LABELS[AIInsightStatus.FixOpened],
    value: AIInsightStatus.FixOpened,
    dotClassName: getStatusDotClasses(AIInsightStatus.FixOpened),
  },
  {
    label: STATUS_LABELS[AIInsightStatus.Resolved],
    value: AIInsightStatus.Resolved,
    dotClassName: getStatusDotClasses(AIInsightStatus.Resolved),
  },
  {
    label: STATUS_LABELS[AIInsightStatus.Dismissed],
    value: AIInsightStatus.Dismissed,
    dotClassName: getStatusDotClasses(AIInsightStatus.Dismissed),
  },
];

const SEVERITY_FILTER_OPTIONS: Array<InsightFilterOption> = [
  { label: "Any severity", value: ALL_FILTER_VALUE },
  { label: "High severity", value: AIInsightSeverity.High },
  { label: "Medium severity", value: AIInsightSeverity.Medium },
  { label: "Low severity", value: AIInsightSeverity.Low },
];

// The type filter's choices: every kind of insight, or a scope's.
function getTypeFilterOptions(
  insightTypes: ReadonlyArray<AIInsightType>,
): Array<InsightFilterOption> {
  return [
    { label: "All types", value: ALL_FILTER_VALUE },
    ...insightTypes.map((insightType: AIInsightType) => {
      return {
        label: INSIGHT_TYPE_LABELS[insightType],
        value: insightType as string,
      };
    }),
  ];
}

const ALL_INSIGHT_TYPES: ReadonlyArray<AIInsightType> =
  Object.values(AIInsightType);

/*
 * The inbox inside a product's AI section - the Profiler's AI insights:
 * only the product's own kinds of insight, opened in the product's own
 * view, in the product's words, with its own Settings as the way on. The
 * highlights across every kind of insight are AI Insights' alone.
 */
export interface AIInsightsInboxScope {
  insightTypes: ReadonlyArray<AIInsightType>;
  viewPage: PageMap;
  settingsPage: PageMap;
  intro: string;
  emptyTitle: string;
  emptyDescription: string;
}

export interface AIInsightsPageProps extends PageComponentProps {
  scope?: AIInsightsInboxScope | undefined;
}

/*
 * Filters live in the URL query string (replaceState, no history spam) so a
 * filtered view survives opening an insight and clicking Back, and so it can
 * be shared/bookmarked — the same behavior the old table got from
 * TableFilterUrlState.
 */
type ReadFilterParamFunction = (
  paramName: string,
  validValues: Array<string>,
) => string;

const readFilterParam: ReadFilterParamFunction = (
  paramName: string,
  validValues: Array<string>,
): string => {
  const value: string | null = Navigation.getQueryStringByName(paramName);
  if (value && validValues.includes(value)) {
    return value;
  }
  return ALL_FILTER_VALUE;
};

/*
 * The AI insights inbox. It leads with what to look at first — the open
 * finding that matters most, with what OneUptime AI's triage concluded, the
 * service behind most of them, and what is new this week
 * (InsightHighlights) — then a triage strip of per-status counts (which is
 * also the status filter), one search/type/severity toolbar, and a single
 * aligned list where every finding reads as title-first with its status,
 * detection count and freshness in fixed right-hand columns.
 */
const AIInsightsPage: FunctionComponent<AIInsightsPageProps> = (
  props: AIInsightsPageProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const scope: AIInsightsInboxScope | undefined = props.scope;
  /*
   * What the scope narrows the list to. The reads follow this alone, not
   * the scope's words: a product that swaps its empty state's words (the
   * Profiler, while its switch is off) does not read the list again.
   */
  const scopeInsightTypes: ReadonlyArray<AIInsightType> | undefined =
    scope?.insightTypes;
  const insightTypes: ReadonlyArray<AIInsightType> =
    scopeInsightTypes || ALL_INSIGHT_TYPES;
  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[scope?.settingsPage || PageMap.AI_INSIGHTS_SETTINGS] as Route,
  );

  const [insights, setInsights] = useState<Array<AIInsight>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Append failures get their own inline error so a transient blip on Load
   * More never unmounts the rows that already loaded.
   */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  /*
   * Per-status totals for the triage strip. null means "no numbers to show" —
   * the counts are a nicety, so a failed count request quietly renders an
   * em dash instead of taking the page down with it.
   */
  const [statusCounts, setStatusCounts] = useState<Record<
    string,
    number
  > | null>(null);
  const [isLoadingCounts, setIsLoadingCounts] = useState<boolean>(true);

  const [statusFilter, setStatusFilter] = useState<string>(() => {
    return readFilterParam("status", Object.values(AIInsightStatus));
  });
  const [severityFilter, setSeverityFilter] = useState<string>(() => {
    return readFilterParam("severity", Object.values(AIInsightSeverity));
  });
  const [typeFilter, setTypeFilter] = useState<string>(() => {
    return readFilterParam("type", [...insightTypes]);
  });
  /*
   * "Any time" is the same "All" sentinel the other filters use, so the bar's
   * one unfilteredValue covers it too.
   */
  const [seenWithinFilter, setSeenWithinFilter] =
    useState<InsightSeenWithinValue>(() => {
      return parseInsightSeenWithin(Navigation.getQueryStringByName("seen"));
    });
  const [sortValue, setSortValue] = useState<InsightSortValue>(() => {
    return parseInsightSort(Navigation.getQueryStringByName("sort"));
  });
  const [searchText, setSearchText] = useState<string>(() => {
    return Navigation.getQueryStringByName("search") || "";
  });
  // Seeded from the URL too so the very first fetch already applies it.
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>(() => {
    return (Navigation.getQueryStringByName("search") || "").trim();
  });

  // Reflect the current filters back into the URL (see readFilterParam).
  useEffect(() => {
    Navigation.setQueryString({
      status: statusFilter === ALL_FILTER_VALUE ? null : statusFilter,
      severity: severityFilter === ALL_FILTER_VALUE ? null : severityFilter,
      type: typeFilter === ALL_FILTER_VALUE ? null : typeFilter,
      seen:
        seenWithinFilter === InsightSeenWithinValue.AnyTime
          ? null
          : seenWithinFilter,
      sort: sortValue === DEFAULT_INSIGHT_SORT ? null : sortValue,
      search: debouncedSearchText || null,
    });
  }, [
    statusFilter,
    severityFilter,
    typeFilter,
    seenWithinFilter,
    sortValue,
    debouncedSearchText,
  ]);

  // Debounce the title search so typing does not fire a request per key.
  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, 400);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchText]);

  // The order is not a filter: it narrows nothing, and Clear keeps it.
  const hasActiveFilters: boolean = Boolean(
    statusFilter !== ALL_FILTER_VALUE ||
      severityFilter !== ALL_FILTER_VALUE ||
      typeFilter !== ALL_FILTER_VALUE ||
      seenWithinFilter !== InsightSeenWithinValue.AnyTime ||
      debouncedSearchText,
  );

  type ClearFiltersFunction = () => void;

  const clearFilters: ClearFiltersFunction = (): void => {
    setStatusFilter(ALL_FILTER_VALUE);
    setSeverityFilter(ALL_FILTER_VALUE);
    setTypeFilter(ALL_FILTER_VALUE);
    setSeenWithinFilter(InsightSeenWithinValue.AnyTime);
    setSearchText("");
    setDebouncedSearchText("");
  };

  /*
   * Everything except status, which the caller supplies — the triage strip
   * needs the same query once per status bucket.
   */
  type BuildQueryFunction = (status: string | null) => Query<AIInsight>;

  const buildQuery: BuildQueryFunction = useCallback(
    (status: string | null): Query<AIInsight> => {
      const query: Query<AIInsight> = {};

      if (status) {
        (query as Record<string, unknown>)["status"] = status;
      }

      if (severityFilter !== ALL_FILTER_VALUE) {
        (query as Record<string, unknown>)["severity"] = severityFilter;
      }

      if (typeFilter !== ALL_FILTER_VALUE) {
        (query as Record<string, unknown>)["insightType"] = typeFilter;
      } else if (scopeInsightTypes) {
        (query as Record<string, unknown>)["insightType"] = new Includes([
          ...scopeInsightTypes,
        ]);
      }

      if (debouncedSearchText) {
        (query as Record<string, unknown>)["title"] = new Search(
          debouncedSearchText,
        );
      }

      const seenWithin: GreaterThanOrEqual<Date> | null =
        getInsightSeenWithinFilter(
          seenWithinFilter,
          OneUptimeDate.getCurrentDate(),
        );

      if (seenWithin) {
        (query as Record<string, unknown>)["lastSeenAt"] = seenWithin;
      }

      return query;
    },
    [
      severityFilter,
      typeFilter,
      seenWithinFilter,
      debouncedSearchText,
      scopeInsightTypes,
    ],
  );

  /*
   * Guards against out-of-order responses: a Load More issued just before a
   * filter change could otherwise land after the filter's fresh page and
   * append rows from the previous query onto the new list. Every fetch takes
   * a ticket; only the latest ticket may write state.
   */
  const fetchGenerationRef: React.MutableRefObject<number> = useRef<number>(0);
  const countGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchInsights: (options: {
    skip: number;
    append: boolean;
  }) => Promise<void> = useCallback(
    async (options: { skip: number; append: boolean }): Promise<void> => {
      const generation: number = ++fetchGenerationRef.current;

      if (options.append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const result: ListResult<AIInsight> = await ModelAPI.getList<AIInsight>(
          {
            modelType: AIInsight,
            query: buildQuery(
              statusFilter === ALL_FILTER_VALUE ? null : statusFilter,
            ),
            limit: INSIGHTS_PER_PAGE,
            skip: options.skip,
            select: {
              _id: true,
              insightType: true,
              title: true,
              serviceName: true,
              telemetryServiceId: true,
              telemetryExceptionId: true,
              metricName: true,
              severity: true,
              status: true,
              humanVerdict: true,
              firstSeenAt: true,
              lastSeenAt: true,
              occurrenceCount: true,
            },
            /*
             * Every order ends on the id, and the id is a tiebreaker, not
             * decoration: the scanner stamps ONE lastSeenAt per project scan,
             * so every live insight in a project carries the same timestamp
             * to the millisecond. Ordering by a column that is tied across
             * the whole page leaves Postgres free to return the rows in a
             * different order per request, and offset pagination over a
             * reshuffling order silently SKIPS rows — the de-dupe below only
             * catches the opposite case (a row repeating). See
             * InsightListOrdering.getInsightSort.
             */
            sort: getInsightSort(sortValue),
          },
        );

        if (generation !== fetchGenerationRef.current) {
          // A newer fetch superseded this one — drop the stale response.
          return;
        }

        setTotalCount(result.count);
        setInsights((current: Array<AIInsight>) => {
          if (!options.append) {
            return result.data;
          }
          /*
           * De-duplicate by id: the list is offset-paginated on lastSeenAt,
           * which the scanner bumps on every re-detection, so a row already
           * on screen can slide back into the appended window. Without this
           * the same row renders twice (with a duplicate React key).
           */
          const seenIds: Set<string> = new Set(
            current.map((item: AIInsight) => {
              return item.id?.toString() || "";
            }),
          );
          return [
            ...current,
            ...result.data.filter((item: AIInsight) => {
              return !seenIds.has(item.id?.toString() || "");
            }),
          ];
        });
        setError(null);
        setLoadMoreError(null);
      } catch (err) {
        if (generation === fetchGenerationRef.current) {
          if (options.append) {
            setLoadMoreError(API.getFriendlyMessage(err));
          } else {
            setError(API.getFriendlyMessage(err));
          }
        }
      } finally {
        if (generation === fetchGenerationRef.current) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [buildQuery, statusFilter, sortValue],
  );

  const fetchStatusCounts: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const generation: number = ++countGenerationRef.current;
      setIsLoadingCounts(true);

      try {
        const counts: Array<number> = await Promise.all(
          STATUS_SUMMARY_DEFINITIONS.map(
            (definition: StatusSummaryDefinition) => {
              return ModelAPI.count<AIInsight>({
                modelType: AIInsight,
                query: buildQuery(
                  definition.value === ALL_FILTER_VALUE
                    ? null
                    : definition.value,
                ),
              });
            },
          ),
        );

        if (generation !== countGenerationRef.current) {
          return;
        }

        const nextCounts: Record<string, number> = {};
        STATUS_SUMMARY_DEFINITIONS.forEach(
          (definition: StatusSummaryDefinition, index: number) => {
            nextCounts[definition.value] = counts[index] || 0;
          },
        );
        setStatusCounts(nextCounts);
      } catch {
        if (generation === countGenerationRef.current) {
          setStatusCounts(null);
        }
      } finally {
        if (generation === countGenerationRef.current) {
          setIsLoadingCounts(false);
        }
      }
    }, [buildQuery]);

  useEffect(() => {
    fetchInsights({ skip: 0, append: false }).catch(() => {
      // handled inside fetchInsights
    });
  }, [fetchInsights]);

  // Counts do not depend on the status filter — that is what they label.
  useEffect(() => {
    fetchStatusCounts().catch(() => {
      // handled inside fetchStatusCounts
    });
  }, [fetchStatusCounts]);

  type RefreshFunction = () => void;

  const refresh: RefreshFunction = (): void => {
    fetchInsights({ skip: 0, append: false }).catch(() => {
      // handled inside fetchInsights
    });
    fetchStatusCounts().catch(() => {
      // handled inside fetchStatusCounts
    });
  };

  const statusBuckets: Array<InsightStatusBucket> =
    STATUS_SUMMARY_DEFINITIONS.map((definition: StatusSummaryDefinition) => {
      return {
        label: definition.label,
        value: definition.value,
        dotClassName: definition.dotClassName,
        count: statusCounts ? statusCounts[definition.value] ?? null : null,
      };
    });

  type GetListHeaderFunction = () => ReactElement;

  /*
   * The column labels the wide layout's right-hand columns line up under.
   * Gated at xl, in step with InsightListItem and InsightListSkeleton — at lg
   * the page's 15rem side menu leaves the title column too narrow to hold a
   * title, and the three gates must flip together or the header desyncs from
   * the rows it labels.
   */
  const getListHeader: GetListHeaderFunction = (): ReactElement => {
    return (
      <div className="max-xl:hidden items-center gap-4 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400 xl:flex">
        <span className="flex-1">{translator.translateText("Insight")}</span>
        <span className="w-32 flex-shrink-0">
          {translator.translateText("Status")}
        </span>
        <span className="w-24 flex-shrink-0 text-right">
          {translator.translateText("Detections")}
        </span>
        <span className="w-36 flex-shrink-0 text-right">
          {translator.translateText("Last seen")}
        </span>
        <span className="w-5 flex-shrink-0" />
      </div>
    );
  };

  type GetContentFunction = () => ReactElement;

  const getContent: GetContentFunction = (): ReactElement => {
    // Full-page error only when there is nothing loaded to keep on screen.
    if (error && insights.length === 0) {
      return <ErrorMessage message={error} onRefreshClick={refresh} />;
    }

    /*
     * role="status" replaces what the old ComponentLoader announced: every
     * tile click and every debounced keystroke swaps the whole list, and the
     * skeleton itself is aria-hidden, so without this a screen reader user
     * would get no word that anything was happening (WCAG 4.1.3).
     */
    if (isLoading) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
        >
          <span className="sr-only">
            {translator.translateText("Loading insights…")}
          </span>
          {getListHeader()}
          <InsightListSkeleton rowCount={SKELETON_ROW_COUNT} />
        </div>
      );
    }

    if (insights.length === 0 && !hasActiveFilters) {
      return (
        <EmptyState
          id="ai-insights-empty-state"
          icon={IconProp.LightBulb}
          showSolidBackground={true}
          /*
           * The whole page on a first run: tall on a laptop, not a screen
           * and a half of white on a phone.
           */
          paddingClassName="py-20 md:pt-52 md:pb-52"
          title={scope?.emptyTitle || "No insights yet"}
          description={
            scope?.emptyDescription ||
            "OneUptime AI watches this project's telemetry and files a quiet insight when something looks off. It never pages anyone."
          }
          footer={
            /*
             * The page's one way on, drawn as a button: the OUTLINE style
             * has no border, so it read as a line of text. The wrapper
             * takes off the dialog-footer margin Button carries from md,
             * which set it off centre.
             */
            <div className="[&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
              <Button
                title={scope ? "Go to AI Settings" : "Go to Insights Settings"}
                icon={IconProp.Settings}
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={() => {
                  Navigation.navigate(settingsRoute);
                }}
              />
            </div>
          }
        />
      );
    }

    /*
     * The no-match state stays inside the list frame (rather than using the
     * tall shared EmptyState) so the filters above it do not jump when the
     * result set empties out.
     */
    if (insights.length === 0) {
      return (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
              <Icon icon={IconProp.Search} className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-gray-900">
              {translator.translateText("No insights match your filters")}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              {translator.translateText(
                "Try a different status or severity, or clear your search to see everything OneUptime AI has found.",
              )}
            </p>
            <div className="mt-5">
              <Button
                title="Clear Filters"
                icon={IconProp.Close}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                onClick={clearFilters}
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {error ? (
          <p className="text-sm text-red-500">
            {translator.translateTemplate(
              "Could not refresh insights: {{error}}",
              { error: error },
            )}
          </p>
        ) : (
          <></>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {getListHeader()}

          <ul className="divide-y divide-gray-100">
            {insights.map((item: AIInsight) => {
              return (
                <InsightListItem
                  key={item.id?.toString()}
                  insight={item}
                  viewPage={scope?.viewPage}
                  // One kind of insight here: no row says its kind.
                  isTypeShown={insightTypes.length > 1}
                />
              );
            })}
          </ul>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row">
            <p className="text-xs text-gray-500">
              <TranslatedSentence
                template={{
                  one: "Showing {{shown}} of {{total}} insight",
                  other: "Showing {{shown}} of {{total}} insights",
                }}
                count={totalCount}
                slots={{
                  shown: (
                    <span className="font-medium text-gray-700">
                      {translator.formatNumber(insights.length)}
                    </span>
                  ),
                  total: (
                    <span className="font-medium text-gray-700">
                      {translator.formatNumber(totalCount)}
                    </span>
                  ),
                }}
              />
            </p>

            {insights.length < totalCount ? (
              <Button
                title="Load More"
                icon={IconProp.ChevronDown}
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                isLoading={isLoadingMore}
                onClick={() => {
                  fetchInsights({ skip: insights.length, append: true }).catch(
                    () => {
                      // handled inside fetchInsights
                    },
                  );
                }}
              />
            ) : (
              <></>
            )}
          </div>
        </div>

        {loadMoreError ? (
          <p className="text-center text-sm text-red-500">
            {translator.translateTemplate(
              "Could not load more insights: {{error}}",
              { error: loadMoreError },
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  /*
   * A project with no insights at all, and nothing filtered: the five
   * status tiles would each read 0 and the filters would narrow nothing,
   * so the page is its empty state alone - what Insights are, and one way
   * on (Insights Settings). The intro above the list says what the empty
   * state says. As soon as there is one insight, or a filter from a shared
   * link, the inbox is drawn whole.
   */
  const isFirstRun: boolean =
    !hasActiveFilters &&
    !isLoading &&
    !error &&
    insights.length === 0 &&
    statusCounts !== null &&
    (statusCounts[ALL_FILTER_VALUE] || 0) === 0;

  if (isFirstRun) {
    return (
      <div className="space-y-5" data-testid="ai-insights-first-run">
        <AIPlanGate />
        {getContent()}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AIPlanGate />

      {scope ? (
        <p className="max-w-3xl text-sm leading-6 text-gray-500">
          {translator.translateText(scope.intro)}
        </p>
      ) : (
        <p className="max-w-3xl text-sm leading-6 text-gray-500">
          {translator.translateText(
            "OneUptime AI watches your telemetry around the clock and tells you about problems before anyone is paged: new or spiking exceptions, error-log spikes, slower requests and metrics that drift. Insights never page and never open incidents.",
          )}{" "}
          {translator.translateText(
            "To be alerted when a finding happens again, open it and choose Create Monitor.",
          )}
        </p>
      )}

      {scope ? <></> : <InsightHighlights />}

      <InsightStatusSummary
        buckets={statusBuckets}
        selectedValue={statusFilter}
        isLoading={isLoadingCounts}
        onSelect={setStatusFilter}
      />

      <InsightFilterBar
        searchText={searchText}
        onSearchTextChange={setSearchText}
        typeOptions={getTypeFilterOptions(insightTypes)}
        typeValue={typeFilter}
        onTypeChange={setTypeFilter}
        isTypeFilterShown={insightTypes.length > 1}
        severityOptions={SEVERITY_FILTER_OPTIONS}
        severityValue={severityFilter}
        onSeverityChange={setSeverityFilter}
        seenWithinOptions={INSIGHT_SEEN_WITHIN_OPTIONS}
        seenWithinValue={seenWithinFilter}
        onSeenWithinChange={(value: string) => {
          setSeenWithinFilter(parseInsightSeenWithin(value));
        }}
        sortOptions={INSIGHT_SORT_OPTIONS}
        sortValue={sortValue}
        onSortChange={(value: string) => {
          setSortValue(parseInsightSort(value));
        }}
        unfilteredValue={ALL_FILTER_VALUE}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

      {getContent()}
    </div>
  );
};

export default AIInsightsPage;
