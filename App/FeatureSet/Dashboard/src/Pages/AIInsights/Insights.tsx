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
import OneUptimeDate from "Common/Types/Date";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AIInsightHumanVerdict from "Common/Types/AI/AIInsightHumanVerdict";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightStatus from "Common/Types/AI/AIInsightStatus";
import AIInsightType from "Common/Types/AI/AIInsightType";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import AIPlanGate from "../../Components/AI/AIPlanGate";

// Human labels for the wire-contract enum values (e.g. "NewException").
const INSIGHT_TYPE_LABELS: Record<AIInsightType, string> = {
  [AIInsightType.NewException]: "New Exception",
  [AIInsightType.ExceptionSpike]: "Exception Spike",
  [AIInsightType.ErrorLogSpike]: "Error Log Spike",
  [AIInsightType.TraceLatencyRegression]: "Latency Regression",
  [AIInsightType.MetricDrift]: "Metric Drift",
};

// Human labels for the wire-contract status values (e.g. "ActionRequired").
const STATUS_LABELS: Record<AIInsightStatus, string> = {
  [AIInsightStatus.Detected]: "Detected",
  [AIInsightStatus.ActionRequired]: "Needs Attention",
  [AIInsightStatus.FixOpened]: "Fix Opened",
  [AIInsightStatus.Resolved]: "Resolved",
  [AIInsightStatus.Dismissed]: "Dismissed",
};

const SEVERITY_BADGE_CLASSES: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: "bg-red-50 text-red-700 ring-red-600/20",
  [AIInsightSeverity.Medium]: "bg-amber-50 text-amber-700 ring-amber-600/20",
  [AIInsightSeverity.Low]: "bg-blue-50 text-blue-700 ring-blue-600/20",
};

const SEVERITY_DOT_CLASSES: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: "bg-red-500",
  [AIInsightSeverity.Medium]: "bg-amber-500",
  [AIInsightSeverity.Low]: "bg-blue-500",
};

// The severity-tinted icon tile shown on each insight card.
const SEVERITY_TILE_CLASSES: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: "bg-red-50 text-red-600",
  [AIInsightSeverity.Medium]: "bg-amber-50 text-amber-600",
  [AIInsightSeverity.Low]: "bg-blue-50 text-blue-600",
};

/*
 * ActionRequired is the attention state, FixOpened means the AI agent is on
 * it, the terminal human states are calm (green/gray), and Detected — a
 * transient state the scanner routes out of in the same tick — stays gray.
 */
const STATUS_BADGE_CLASSES: Record<AIInsightStatus, string> = {
  [AIInsightStatus.Detected]: "bg-gray-100 text-gray-600 ring-gray-500/20",
  [AIInsightStatus.ActionRequired]:
    "bg-orange-50 text-orange-700 ring-orange-600/20",
  [AIInsightStatus.FixOpened]:
    "bg-purple-50 text-purple-700 ring-purple-600/20",
  [AIInsightStatus.Resolved]: "bg-green-50 text-green-700 ring-green-600/20",
  [AIInsightStatus.Dismissed]: "bg-gray-100 text-gray-600 ring-gray-500/20",
};

const STATUS_DOT_CLASSES: Record<AIInsightStatus, string> = {
  [AIInsightStatus.Detected]: "bg-gray-400",
  [AIInsightStatus.ActionRequired]: "bg-orange-500",
  [AIInsightStatus.FixOpened]: "bg-purple-500",
  [AIInsightStatus.Resolved]: "bg-green-500",
  [AIInsightStatus.Dismissed]: "bg-gray-400",
};

// Each detector gets its own glyph so a card is recognizable at a glance.
const INSIGHT_TYPE_ICONS: Record<AIInsightType, IconProp> = {
  [AIInsightType.NewException]: IconProp.Bug,
  [AIInsightType.ExceptionSpike]: IconProp.Fire,
  [AIInsightType.ErrorLogSpike]: IconProp.Logs,
  [AIInsightType.TraceLatencyRegression]: IconProp.Clock,
  [AIInsightType.MetricDrift]: IconProp.ArrowTrendingUp,
};

export function getInsightTypeLabel(
  insightType: AIInsightType | undefined,
): string {
  if (!insightType) {
    return "-";
  }
  return INSIGHT_TYPE_LABELS[insightType] || insightType;
}

export function getStatusLabel(status: AIInsightStatus | undefined): string {
  if (!status) {
    return "-";
  }
  return STATUS_LABELS[status] || status;
}

export function getInsightTypeIcon(
  insightType: AIInsightType | undefined,
): IconProp {
  if (!insightType) {
    return IconProp.LightBulb;
  }
  return INSIGHT_TYPE_ICONS[insightType] || IconProp.LightBulb;
}

export function getSeverityTileClasses(
  severity: AIInsightSeverity | undefined,
): string {
  if (!severity) {
    return "bg-gray-100 text-gray-500";
  }
  return SEVERITY_TILE_CLASSES[severity] || "bg-gray-100 text-gray-500";
}

export function getInsightTypeElement(
  insightType: AIInsightType | undefined,
): ReactElement {
  if (!insightType) {
    return <></>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
      {getInsightTypeLabel(insightType)}
    </span>
  );
}

export function getSeverityElement(
  severity: AIInsightSeverity | undefined,
): ReactElement {
  if (!severity) {
    return <></>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        SEVERITY_BADGE_CLASSES[severity] ||
        "bg-gray-100 text-gray-600 ring-gray-500/20"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          SEVERITY_DOT_CLASSES[severity] || "bg-gray-400"
        }`}
      />
      {severity}
    </span>
  );
}

export function getStatusElement(
  status: AIInsightStatus | undefined,
): ReactElement {
  if (!status) {
    return <></>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STATUS_BADGE_CLASSES[status] ||
        "bg-gray-100 text-gray-600 ring-gray-500/20"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          STATUS_DOT_CLASSES[status] || "bg-gray-400"
        }`}
      />
      {getStatusLabel(status)}
    </span>
  );
}

export function getHumanVerdictElement(
  verdict: AIInsightHumanVerdict | undefined | null,
): ReactElement {
  if (verdict === AIInsightHumanVerdict.Confirmed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
        <Icon icon={IconProp.Check} className="h-3 w-3" />
        Confirmed
      </span>
    );
  }
  if (verdict === AIInsightHumanVerdict.Dismissed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/20">
        <Icon icon={IconProp.Close} className="h-3 w-3" />
        Dismissed
      </span>
    );
  }
  return <></>;
}

const INSIGHTS_PER_PAGE: number = 20;

const ALL_FILTER_VALUE: string = "All";

const STATUS_FILTER_OPTIONS: Array<FilterButtonOption> = [
  { label: "All", value: ALL_FILTER_VALUE },
  {
    label: STATUS_LABELS[AIInsightStatus.ActionRequired],
    value: AIInsightStatus.ActionRequired,
  },
  {
    label: STATUS_LABELS[AIInsightStatus.FixOpened],
    value: AIInsightStatus.FixOpened,
  },
  {
    label: STATUS_LABELS[AIInsightStatus.Resolved],
    value: AIInsightStatus.Resolved,
  },
  {
    label: STATUS_LABELS[AIInsightStatus.Dismissed],
    value: AIInsightStatus.Dismissed,
  },
];

const SEVERITY_FILTER_OPTIONS: Array<FilterButtonOption> = [
  { label: "Any Severity", value: ALL_FILTER_VALUE },
  { label: "High", value: AIInsightSeverity.High },
  { label: "Medium", value: AIInsightSeverity.Medium },
  { label: "Low", value: AIInsightSeverity.Low },
];

const TYPE_FILTER_OPTIONS: Array<FilterButtonOption> = [
  { label: "All Types", value: ALL_FILTER_VALUE },
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
 * The AI insights inbox, rendered as cards instead of a table: each finding
 * reads like an inbox item — severity-tinted detector icon, badges, title
 * and the freshness/occurrence meta — with status and severity chip filters
 * and a title search on top.
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
   * More never unmounts the cards that already loaded.
   */
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

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

  /*
   * Guards against out-of-order responses: a Load More issued just before a
   * filter change could otherwise land after the filter's fresh page and
   * append rows from the previous query onto the new list. Every fetch takes
   * a ticket; only the latest ticket may write state.
   */
  const fetchGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

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
        const query: Query<AIInsight> = {};

        if (statusFilter !== ALL_FILTER_VALUE) {
          (query as Record<string, unknown>)["status"] = statusFilter;
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

        const result: ListResult<AIInsight> = await ModelAPI.getList<AIInsight>(
          {
            modelType: AIInsight,
            query: query,
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
           * the same card renders twice (with a duplicate React key).
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
    [statusFilter, severityFilter, typeFilter, debouncedSearchText],
  );

  useEffect(() => {
    fetchInsights({ skip: 0, append: false }).catch(() => {
      // handled inside fetchInsights
    });
  }, [fetchInsights]);

  type GetInsightCardFunction = (item: AIInsight) => ReactElement;

  const getInsightCard: GetInsightCardFunction = (
    item: AIInsight,
  ): ReactElement => {
    const viewRoute: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.AI_INSIGHT_VIEW] as Route,
      { modelId: item.id! },
    );

    return (
      <Link
        key={item.id?.toString()}
        to={viewRoute}
        className="group block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-all duration-150 group-hover:border-indigo-300 group-hover:shadow-md sm:p-5">
          <div className="flex items-start gap-4">
            <div
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${getSeverityTileClasses(
                item.severity,
              )}`}
            >
              <Icon
                icon={getInsightTypeIcon(item.insightType)}
                className="h-5 w-5"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {getInsightTypeElement(item.insightType)}
                {getSeverityElement(item.severity)}
                {getStatusElement(item.status)}
                {getHumanVerdictElement(item.humanVerdict)}
              </div>

              <h3 className="mt-2 truncate text-sm font-semibold text-gray-900 group-hover:text-indigo-600">
                {item.title}
              </h3>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                {item.serviceName ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon icon={IconProp.Cube} className="h-3.5 w-3.5" />
                    {item.serviceName}
                  </span>
                ) : (
                  <></>
                )}
                {item.lastSeenAt ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon icon={IconProp.Clock} className="h-3.5 w-3.5" />
                    Last seen {OneUptimeDate.fromNow(item.lastSeenAt)}
                  </span>
                ) : (
                  <></>
                )}
                {item.occurrenceCount ? (
                  <span className="inline-flex items-center gap-1">
                    <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
                    {item.occurrenceCount === 1
                      ? "Detected once"
                      : `Detected ${item.occurrenceCount} times`}
                  </span>
                ) : (
                  <></>
                )}
              </div>
            </div>

            <Icon
              icon={IconProp.ChevronRight}
              className="mt-1 h-5 w-5 flex-shrink-0 text-gray-300 transition-colors group-hover:text-indigo-500"
            />
          </div>
        </div>
      </Link>
    );
  };

  type GetContentFunction = () => ReactElement;

  const getContent: GetContentFunction = (): ReactElement => {
    // Full-page error only when there is nothing loaded to keep on screen.
    if (error && insights.length === 0) {
      return (
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            fetchInsights({ skip: 0, append: false }).catch(() => {
              // handled inside fetchInsights
            });
          }}
        />
      );
    }

    if (isLoading) {
      return <ComponentLoader />;
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

    if (insights.length === 0) {
      return (
        <EmptyState
          id="ai-insights-no-match"
          icon={IconProp.Search}
          showSolidBackground={true}
          title="No insights match your filters"
          description="Try changing the status or severity filters, or clearing your search."
          footer={
            <Button
              title="Clear Filters"
              icon={IconProp.Close}
              buttonStyle={ButtonStyleType.OUTLINE}
              onClick={() => {
                setStatusFilter(ALL_FILTER_VALUE);
                setSeverityFilter(ALL_FILTER_VALUE);
                setTypeFilter(ALL_FILTER_VALUE);
                setSearchText("");
                setDebouncedSearchText("");
              }}
            />
          }
        />
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

        {insights.map((item: AIInsight) => {
          return getInsightCard(item);
        })}

        <div className="flex flex-col items-center gap-2 pt-2">
          {loadMoreError ? (
            <p className="text-sm text-red-500">
              Could not load more insights: {loadMoreError}
            </p>
          ) : (
            <></>
          )}
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
          <p className="text-xs text-gray-400">
            Showing {insights.length} of {totalCount}{" "}
            {totalCount === 1 ? "insight" : "insights"}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <AIPlanGate />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-gray-500">
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
            onClick={() => {
              fetchInsights({ skip: 0, append: false }).catch(() => {
                // handled inside fetchInsights
              });
            }}
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

      <div className="space-y-2">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <FilterButtons
            className="flex-wrap"
            options={STATUS_FILTER_OPTIONS}
            selectedValue={statusFilter}
            onSelect={(value: string) => {
              setStatusFilter(value);
            }}
          />
          <div className="w-full sm:w-64">
            <Input
              placeholder="Search insights..."
              value={searchText}
              onChange={(value: string) => {
                setSearchText(value);
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <FilterButtons
            className="flex-wrap"
            options={TYPE_FILTER_OPTIONS}
            selectedValue={typeFilter}
            onSelect={(value: string) => {
              setTypeFilter(value);
            }}
          />
          <FilterButtons
            className="flex-wrap"
            options={SEVERITY_FILTER_OPTIONS}
            selectedValue={severityFilter}
            onSelect={(value: string) => {
              setSeverityFilter(value);
            }}
          />
        </div>
      </div>

      {getContent()}
    </div>
  );
};

export default AIInsightsPage;
