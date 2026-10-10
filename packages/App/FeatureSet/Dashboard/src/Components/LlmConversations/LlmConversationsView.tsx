import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Route from "Common/Types/API/Route";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import TimeRangePickerDropdown from "Common/UI/Components/Date/TimeRangePickerDropdown";
import TableEmptyState, {
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import {
  LLM_CONVERSATION_PAGE_SIZE,
  LlmConversationIssueFilter,
  LlmConversationListItem,
  LlmConversationListResponse,
  LlmConversationSort,
  LlmConversationSummary,
} from "Common/Types/Telemetry/LlmConversationApi";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "Common/Types/Telemetry/LlmAnswerIssue";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import AppLink from "../AppLink/AppLink";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import PageMap from "../../Utils/PageMap";
import LlmSummaryTiles from "./LlmSummaryTiles";
import LlmConversationRow from "./LlmConversationRow";
import {
  LLM_CONVERSATION_SORT_OPTIONS,
  LLM_ISSUE_STYLES,
  LlmSortOption,
} from "./LlmConversationCopy";
import {
  LlmConversationListView,
  isLlmConversationListFiltered,
  readLlmConversationListView,
  toLlmConversationListUrlParams,
} from "./LlmConversationListUrlState";
import { fetchLlmConversations } from "./LlmConversationsApi";
import { getLlmConversationRoute, getLlmPageRoute } from "./LlmConversationRoutes";
import { formatLlmCount } from "./LlmConversationFormat";
import {
  LlmServiceNames,
  LlmServiceOption,
  useLlmServiceNames,
} from "./useLlmServiceNames";

/*
 * THE HOME OF AI / LLM OBSERVABILITY: every conversation your AI had.
 *
 * Above the list, five numbers - conversations, answers, how many need
 * attention, cost, how long an answer takes. Under them, chips that narrow
 * the list to the conversations that matter (everything that went wrong, or
 * one kind of problem), a sort (newest, most expensive, slowest, longest),
 * and a search over what people asked, who asked it, the model and the
 * conversation id. Each row opens the conversation, ready to read or to
 * replay.
 *
 * The view lives in the URL, so coming back from a conversation lands on
 * the same list.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; response: LlmConversationListResponse }
  | { kind: "error"; message: string };

const SEARCH_DEBOUNCE_MS: number = 400;

function readViewFromUrl(): LlmConversationListView {
  return readLlmConversationListView((name: string): string | null => {
    return Navigation.getQueryStringByName(name);
  });
}

// The part of the view the summary describes: not the chip, sort or page.
function summaryKeyOf(view: LlmConversationListView): string {
  return JSON.stringify({
    range: view.range.range,
    start: view.range.startAndEndDate?.startValue?.toString() || "",
    end: view.range.startAndEndDate?.endValue?.toString() || "",
    search: view.search,
    serviceId: view.serviceId,
  });
}

interface ChipProps {
  label: string;
  count: number | null;
  isSelected: boolean;
  dotClassName?: string | undefined;
  dataTestId: string;
  onClick: () => void;
}

const Chip: FunctionComponent<ChipProps> = (props: ChipProps): ReactElement => {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.isSelected}
      data-testid={props.dataTestId}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        props.isSelected
          ? "bg-gray-900 text-white"
          : "bg-white text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
      }`}
    >
      {props.dotClassName ? (
        <span
          className={`h-2 w-2 rounded-full ${props.dotClassName}`}
          aria-hidden="true"
        />
      ) : (
        <></>
      )}
      <span>{props.label}</span>
      {props.count !== null ? (
        <span
          className={props.isSelected ? "text-gray-300" : "text-gray-500"}
          data-testid={`${props.dataTestId}-count`}
        >
          {formatLlmCount(props.count)}
        </span>
      ) : (
        <></>
      )}
    </button>
  );
};

const LlmConversationsView: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const services: LlmServiceNames = useLlmServiceNames();

  const [view, setViewState] = useState<LlmConversationListView>(() => {
    return readViewFromUrl();
  });
  const [searchText, setSearchText] = useState<string>(view.search);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [summary, setSummary] = useState<LlmConversationSummary | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const summaryKeyRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  const setView: (next: LlmConversationListView) => void = (
    next: LlmConversationListView,
  ): void => {
    setViewState(next);
    Navigation.setQueryString(toLlmConversationListUrlParams(next));
  };

  // Typing searches after a short pause; Enter searches at once.
  useEffect(() => {
    if (searchText.trim() === view.search) {
      return;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setView({ ...view, search: searchText.trim(), page: 0 });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [searchText]);

  useEffect(() => {
    let cancelled: boolean = false;
    const timeWindow: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(view.range);
    const summaryKey: string = summaryKeyOf(view);
    const includeSummary: boolean =
      summaryKey !== summaryKeyRef.current || reloadToken > 0;

    setState({ kind: "loading" });

    if (includeSummary) {
      setSummary(null);
    }

    fetchLlmConversations({
      startTime: timeWindow.startValue,
      endTime: timeWindow.endValue,
      serviceIds: view.serviceId ? [view.serviceId] : undefined,
      search: view.search,
      issue: view.issue,
      sort: view.sort,
      page: view.page,
      includeSummary: includeSummary,
    })
      .then((response: LlmConversationListResponse) => {
        if (cancelled) {
          return;
        }

        if (includeSummary) {
          summaryKeyRef.current = summaryKey;
          setSummary(response.summary);
        }

        setState({ kind: "loaded", response: response });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setState({
          kind: "error",
          message: API.getFriendlyMessage(error as Error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    summaryKeyOf(view),
    view.issue,
    view.sort,
    view.page,
    reloadToken,
  ]);

  const isFiltered: boolean = isLlmConversationListFiltered(view);

  /*
   * Nothing at all in the time range, and nothing narrowing it: a row of
   * zeros and a row of empty chips say nothing a first-time reader needs.
   * The empty state, with how to send conversations, is the whole page.
   */
  const isFirstRun: boolean =
    !isFiltered &&
    summary !== null &&
    summary.conversationCount === 0 &&
    state.kind === "loaded" &&
    state.response.conversations.length === 0;

  const totalForFilter: number | null = useMemo(() => {
    if (!summary) {
      return null;
    }

    if (!view.issue) {
      return summary.conversationCount;
    }

    if (view.issue === "any") {
      return summary.problemConversationCount;
    }

    return summary.issueConversationCounts[view.issue] || 0;
  }, [summary, view.issue]);

  const selectIssue: (issue: LlmConversationIssueFilter | undefined) => void =
    (issue: LlmConversationIssueFilter | undefined): void => {
      setView({ ...view, issue: issue, page: 0 });
    };

  const clearFilters: () => void = (): void => {
    setSearchText("");
    setView({ ...view, search: "", serviceId: "", issue: undefined, page: 0 });
  };

  const setupRoute: Route = getLlmPageRoute(PageMap.LLM_DOCUMENTATION);
  const usageRoute: Route = getLlmPageRoute(PageMap.LLM_USAGE);

  const conversations: Array<LlmConversationListItem> =
    state.kind === "loaded" ? state.response.conversations : [];
  const hasMore: boolean =
    state.kind === "loaded" ? state.response.hasMore : false;

  const visibleIssueChips: Array<LlmAnswerIssue> =
    LlmAnswerIssueUtil.getAllIssues().filter((issue: LlmAnswerIssue): boolean => {
      return (
        view.issue === issue ||
        (summary ? (summary.issueConversationCounts[issue] || 0) > 0 : false)
      );
    });

  const firstShown: number = view.page * LLM_CONVERSATION_PAGE_SIZE + 1;
  const lastShown: number = view.page * LLM_CONVERSATION_PAGE_SIZE + conversations.length;

  const renderList: () => ReactElement = (): ReactElement => {
    if (state.kind === "error") {
      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Error}
          title="Couldn't load conversations."
          description={state.message}
          actions={[
            {
              title: "Try again",
              icon: IconProp.Refresh,
              dataTestId: "refresh-button",
              onClick: () => {
                setReloadToken(reloadToken + 1);
              },
            },
          ]}
        />
      );
    }

    if (state.kind === "loading") {
      return (
        <div className="divide-y divide-gray-100" data-testid="llm-conversations-loading">
          {[0, 1, 2, 3, 4].map((index: number) => {
            return (
              <div key={index} className="flex items-start gap-3 px-4 py-4 sm:px-6">
                <div className="mt-1.5 h-2.5 w-2.5 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (conversations.length === 0) {
      if (isFiltered) {
        return (
          <TableEmptyState
            kind={TableEmptyStateKind.Filtered}
            title="No conversations match."
            description="Try another search, or show every conversation in this time range."
            actions={[
              {
                title: "Clear Filters",
                icon: IconProp.Close,
                dataTestId: "llm-conversations-clear-filters",
                onClick: clearFilters,
              },
            ]}
          />
        );
      }

      const isWholeMonth: boolean =
        view.range.range === TimeRange.PAST_ONE_MONTH ||
        view.range.range === TimeRange.PAST_THREE_MONTHS;

      return (
        <TableEmptyState
          kind={TableEmptyStateKind.Empty}
          icon={IconProp.ChatBubbleLeftRight}
          dataTestId="llm-conversations-empty"
          title="No AI conversations here yet."
          description="Conversations appear as your app's AI calls arrive: what people asked, what the AI answered, the tools it used and what went wrong. Send them with any OpenTelemetry GenAI instrumentation, such as OpenLLMetry, OpenInference, the Vercel AI SDK, or the OpenTelemetry instrumentations for OpenAI, Anthropic and Gemini."
          actions={[
            {
              title: "Set up AI observability",
              icon: IconProp.Book,
              dataTestId: "llm-conversations-setup",
              onClick: () => {
                Navigation.navigate(setupRoute);
              },
            },
            ...(isWholeMonth
              ? []
              : [
                  {
                    title: "Show the past month",
                    icon: IconProp.Calendar,
                    style: TableEmptyStateActionStyle.Link,
                    dataTestId: "llm-conversations-widen-range",
                    onClick: () => {
                      setView({
                        ...view,
                        range: { range: TimeRange.PAST_ONE_MONTH },
                        page: 0,
                      });
                    },
                  },
                ]),
          ]}
          note={
            <TranslatedSentence
              template="Using Claude Code, Cursor or Codex? They send usage, not conversations: see who uses what on the {{usageTab}}."
              slots={{
                usageTab: (
                  <AppLink
                    to={usageRoute}
                    className="font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    {translator.translateText("Usage tab") || ""}
                  </AppLink>
                ),
              }}
            />
          }
        />
      );
    }

    return (
      <div className="divide-y divide-gray-100" data-testid="llm-conversations-list">
        {conversations.map((conversation: LlmConversationListItem) => {
          const route: Route | null = getLlmConversationRoute({
            key: conversation.key,
            startedAt: conversation.startedAt,
            endedAt: conversation.endedAt,
          });

          if (!route) {
            return <React.Fragment key={conversation.key} />;
          }

          return (
            <LlmConversationRow
              key={conversation.key}
              conversation={conversation}
              route={route}
              serviceNames={services.names}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="llm-conversations-view">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="search"
            value={searchText}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSearchText(event.target.value);
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                setView({ ...view, search: searchText.trim(), page: 0 });
              }
            }}
            placeholder={translator.translateText(
              "Search what people asked, a person, a model or a conversation id",
            )}
            aria-label={translator.translateText("Search conversations")}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            data-testid="llm-conversations-search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {services.options.length > 0 ? (
            <select
              value={view.serviceId}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                setView({ ...view, serviceId: event.target.value, page: 0 });
              }}
              aria-label={translator.translateText("App")}
              className="block rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid="llm-conversations-app"
            >
              <option value="">{translator.translateText("All apps")}</option>
              {services.options.map((option: LlmServiceOption) => {
                return (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                );
              })}
            </select>
          ) : (
            <></>
          )}
          <TimeRangePickerDropdown
            value={view.range}
            onChange={(range: RangeStartAndEndDateTime) => {
              setView({ ...view, range: range, page: 0 });
            }}
            dataTestIdPrefix="llm-conversations-time-range"
            dropdownWidthInPx={288}
          />
        </div>
      </div>

      {isFirstRun ? (
        <></>
      ) : (
        <LlmSummaryTiles
          summary={summary}
          isLoading={state.kind === "loading"}
          onShowProblems={() => {
            selectIssue("any");
          }}
        />
      )}

      <div className="rounded-lg bg-white shadow" data-testid="llm-conversations-card">
        <div
          className={`flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${
            isFirstRun ? "hidden" : "flex"
          }`}
        >
          <div className="flex flex-wrap gap-2" data-testid="llm-conversations-chips">
            <Chip
              label={translator.translateText("All") || ""}
              count={summary ? summary.conversationCount : null}
              isSelected={!view.issue}
              dataTestId="llm-chip-all"
              onClick={() => {
                selectIssue(undefined);
              }}
            />
            <Chip
              label={translator.translateText("Need attention") || ""}
              count={summary ? summary.problemConversationCount : null}
              isSelected={view.issue === "any"}
              dotClassName="bg-amber-500"
              dataTestId="llm-chip-any"
              onClick={() => {
                selectIssue("any");
              }}
            />
            {visibleIssueChips.map((issue: LlmAnswerIssue) => {
              return (
                <Chip
                  key={issue}
                  label={translator.translateText(LLM_ISSUE_STYLES[issue].title) || ""}
                  count={summary ? summary.issueConversationCounts[issue] || 0 : null}
                  isSelected={view.issue === issue}
                  dotClassName={LLM_ISSUE_STYLES[issue].dotClassName}
                  dataTestId={`llm-chip-${issue}`}
                  onClick={() => {
                    selectIssue(issue);
                  }}
                />
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span>{translator.translateText("Sort")}</span>
            <select
              value={view.sort}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                setView({
                  ...view,
                  sort: event.target.value as LlmConversationSort,
                  page: 0,
                });
              }}
              className="rounded-md border border-gray-300 bg-white py-1.5 pl-2.5 pr-8 text-xs text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              data-testid="llm-conversations-sort"
            >
              {LLM_CONVERSATION_SORT_OPTIONS.map((option: LlmSortOption) => {
                return (
                  <option key={option.sort} value={option.sort}>
                    {translator.translateText(option.label)}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        {renderList()}

        {state.kind === "loaded" &&
        conversations.length > 0 &&
        (view.page > 0 || hasMore) ? (
          <div
            className="flex flex-col gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
            data-testid="llm-conversations-pagination"
          >
            <div className="text-xs text-gray-500">
              {totalForFilter !== null
                ? translator.translateTemplate(
                    "Showing {{first}}–{{last}} of {{total}}",
                    {
                      first: formatLlmCount(firstShown),
                      last: formatLlmCount(lastShown),
                      total: formatLlmCount(Math.max(totalForFilter, lastShown)),
                    },
                  )
                : translator.translateTemplate("Showing {{first}}–{{last}}", {
                    first: formatLlmCount(firstShown),
                    last: formatLlmCount(lastShown),
                  })}
            </div>
            <div className="flex gap-2">
              <Button
                title="Previous"
                icon={IconProp.ChevronLeft}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                disabled={view.page === 0}
                dataTestId="llm-conversations-previous"
                onClick={() => {
                  setView({ ...view, page: Math.max(0, view.page - 1) });
                }}
              />
              <Button
                title="Next"
                icon={IconProp.ChevronRight}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                disabled={!hasMore}
                dataTestId="llm-conversations-next"
                onClick={() => {
                  setView({ ...view, page: view.page + 1 });
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default LlmConversationsView;
