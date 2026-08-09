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
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
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

const TYPE_FILTER_OPTIONS: Array<InsightFilterOption> = [
  { label: "All types", value: ALL_FILTER_VALUE },
  ...Object.values(AIInsightType).map((insightType: AIInsightType) => {
    return {
      label: INSIGHT_TYPE_LABELS[insightType],
      value: insightType as string,
    };
  }),
];

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
 * The AI insights inbox: a triage strip of per-status counts (which is also
 * the status filter), one search/type/severity toolbar, and a single aligned
 * list where every finding reads as title-first with its status, detection
 * count and freshness in fixed right-hand columns.
 */
const AIInsightsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const settingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.AI_INSIGHTS_SETTINGS] as Route,
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
    return readFilterParam("type", Object.values(AIInsightType));
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
      search: debouncedSearchText || null,
    });
  }, [statusFilter, severityFilter, typeFilter, debouncedSearchText]);

  // Debounce the title search so typing does not fire a request per key.
  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, 400);
    return () => {
      clearTimeout(timeout);
    };
  }, [searchText]);

  const hasActiveFilters: boolean = Boolean(
    statusFilter !== ALL_FILTER_VALUE ||
      severityFilter !== ALL_FILTER_VALUE ||
      typeFilter !== ALL_FILTER_VALUE ||
      debouncedSearchText,
  );

  type ClearFiltersFunction = () => void;

  const clearFilters: ClearFiltersFunction = (): void => {
    setStatusFilter(ALL_FILTER_VALUE);
    setSeverityFilter(ALL_FILTER_VALUE);
    setTypeFilter(ALL_FILTER_VALUE);
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
      }

      if (debouncedSearchText) {
        (query as Record<string, unknown>)["title"] = new Search(
          debouncedSearchText,
        );
      }

      return query;
    },
    [severityFilter, typeFilter, debouncedSearchText],
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
              severity: true,
              status: true,
              humanVerdict: true,
              firstSeenAt: true,
              lastSeenAt: true,
              occurrenceCount: true,
            },
            sort: {
              lastSeenAt: SortOrder.Descending,
            },
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
    [buildQuery, statusFilter],
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
      <div className="hidden items-center gap-4 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-400 xl:flex">
        <span className="flex-1">Insight</span>
        <span className="w-32 flex-shrink-0">Status</span>
        <span className="w-24 flex-shrink-0 text-right">Detections</span>
        <span className="w-36 flex-shrink-0 text-right">Last seen</span>
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
          <span className="sr-only">Loading insights…</span>
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
          title="No insights yet"
          description={
            <span>
              When AI Insights is enabled, OneUptime AI continuously watches
              this project&apos;s telemetry and files a quiet insight whenever a
              deterministic sensor finds something — without paging anyone or
              opening incidents.
            </span>
          }
          footer={
            <Button
              title="Go to Insights Settings"
              icon={IconProp.Settings}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                Navigation.navigate(settingsRoute);
              }}
            />
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
              No insights match your filters
            </h3>
            <p className="mt-1 max-w-sm text-sm text-gray-500">
              Try a different status or severity, or clear your search to see
              everything OneUptime AI has found.
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
            Could not refresh insights: {error}
          </p>
        ) : (
          <></>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {getListHeader()}

          <ul className="divide-y divide-gray-100">
            {insights.map((item: AIInsight) => {
              return (
                <InsightListItem key={item.id?.toString()} insight={item} />
              );
            })}
          </ul>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row">
            <p className="text-xs text-gray-500">
              Showing{" "}
              <span className="font-medium text-gray-700">
                {insights.length}
              </span>{" "}
              of <span className="font-medium text-gray-700">{totalCount}</span>{" "}
              {totalCount === 1 ? "insight" : "insights"}
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
            Could not load more insights: {loadMoreError}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <AIPlanGate />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-sm leading-6 text-gray-500">
          Proactive findings from OneUptime AI&apos;s deterministic telemetry
          sensors — new or spiking exceptions, error-log spikes, latency
          regressions and metric drift. Insights never page and never open
          incidents.
        </p>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            title="Refresh"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={refresh}
          />
          <Button
            title="Settings"
            icon={IconProp.Settings}
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              Navigation.navigate(settingsRoute);
            }}
          />
        </div>
      </div>

      <InsightStatusSummary
        buckets={statusBuckets}
        selectedValue={statusFilter}
        isLoading={isLoadingCounts}
        onSelect={setStatusFilter}
      />

      <InsightFilterBar
        searchText={searchText}
        onSearchTextChange={setSearchText}
        typeOptions={TYPE_FILTER_OPTIONS}
        typeValue={typeFilter}
        onTypeChange={setTypeFilter}
        severityOptions={SEVERITY_FILTER_OPTIONS}
        severityValue={severityFilter}
        onSeverityChange={setSeverityFilter}
        unfilteredValue={ALL_FILTER_VALUE}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

      {getContent()}
    </div>
  );
};

export default AIInsightsPage;
