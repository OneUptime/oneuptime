import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import FixProductionVerdict from "../AI/FixProductionVerdict";
import CodeApi, {
  CodeTaskListResponse,
  CodeTaskListScope,
  CodeTaskRetryManyResponse,
} from "./CodeApi";
import {
  PRODUCTION_REVIEW_COPY,
  getProductionReviewGlance,
  getReviewedPullRequestNumber,
  inReviewHostWords,
} from "./CodeProductionReviewCopy";
import CodeDiffStat from "./CodeDiffStat";
import { GitPullRequestMark } from "./CodeMarks";
import CodeMetaList from "./CodeMetaList";
import { getTaskRoute } from "./CodePaths";
import {
  CODE_TASK_ASKED_BY,
  CODE_TASK_STARTED_BY_ONEUPTIME,
  CODE_TASK_STATE_COPY,
  CODE_TASK_STATE_TEXT_CLASS_NAMES,
  getRecipeLabel,
  QUEUED_LABEL,
} from "./CodeTaskCopy";
import CodeTaskStateMark from "./CodeTaskStateMark";
import CodeTaskRetryNote from "./CodeTaskRetryNote";
import {
  CODE_TASK_LIST_FILTERS,
  CODE_TASK_ROW_FAILED_AFTER_ATTEMPTS,
} from "./CodeTaskStatusCopy";
import { CodeTaskTurnDuration } from "./CodeTaskWorkTime";
import CodeTimeAgo from "./CodeTimeAgo";
import CodeHostMark from "./CodeHostMark";
import { getPullRequestCopy } from "./CodeHostCopy";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskListCountsJSON,
  CodeTaskListFilter,
  CodeTaskListKind,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import { ReadingDirection } from "Common/Types/ReadingDirection";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import { TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME } from "Common/UI/Components/Table/TableHeaderControls";
import { CLEAR_SEARCH } from "Common/UI/Components/Table/TableEmptyStateBuilders";
import API from "Common/UI/Utils/API/API";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  getLineDirection,
} from "Common/UI/Utils/LineDirection";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";

// How long the search box waits for typing to stop before it reads.
export const CODE_TASK_SEARCH_DELAY_MS: number = 300;

export { getTaskRoute } from "./CodePaths";

export const CODE_TASK_PAGE_SIZE: number = 20;

// How often a list with a task in progress asks again.
export const CODE_TASK_LIST_POLL_MS: number = 8000;

export interface ComponentProps {
  /*
   * Which tasks: a repository's, the ones with no repository, or every
   * task the reader may read (Code's first page).
   */
  scope: CodeTaskListScope;
  /*
   * The tasks (the default), or a repository's pull requests' production
   * reviews, which the tasks leave out.
   */
  kind?: CodeTaskListKind | undefined;
  // Change it to read the list again (a task was just started).
  refreshToken?: number | undefined;
  // What the list says with no task at all.
  emptyState: ReactElement;
  // Told how many tasks there are, once they are read.
  onCount?: ((count: number) => void) | undefined;
  /*
   * The repositories' names by id, for a list across repositories: each
   * row then says which repository it is in.
   */
  repositoryNames?: Map<string, string> | undefined;
  // Where each repository is hosted, by id: the mark beside its name.
  repositoryHosts?: Map<string, CodeTaskRepositoryHost> | undefined;
  /*
   * Where the one repository a list is about is hosted (its own page): how
   * its rows name a pull request - "MR !12" on GitLab, "PR #12" elsewhere.
   */
  repositoryHost?: CodeTaskRepositoryHost | undefined;
  dataTestId?: string | undefined;
  /*
   * The filters (in progress, failed, ...) with how many tasks each shows,
   * and a search: for a list of tasks, not of production reviews.
   */
  showFilters?: boolean | undefined;
  /*
   * The reader may ask AI again here: a failed or stopped task's row has
   * Try again, and failed tasks can be picked and tried again together.
   */
  canRetry?: boolean | undefined;
}

// Where a task's repository is hosted, for the mark beside its name.
export interface CodeTaskRepositoryHost {
  provider?: string | undefined;
  hostProduct?: string | undefined;
}

/*
 * A task list, newest first, the way coding agents list theirs: one row per
 * task - how it stands (its mark, and in words while it is moving or needs
 * someone), what it is about, where and who, when, its pull request, and
 * how much it changed. A row opens the task's conversation. While any task
 * is in progress the list reads itself again every few seconds, so its
 * states stay true without a reload.
 */
const CodeTaskList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [tasks, setTasks] = useState<Array<CodeTaskSummaryJSON>>([]);
  const [count, setCount] = useState<number>(0);
  const [shown, setShown] = useState<number>(CODE_TASK_PAGE_SIZE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CodeTaskListFilter>(
    CodeTaskListFilter.All,
  );
  const [searchInput, setSearchInput] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [counts, setCounts] = useState<CodeTaskListCountsJSON | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [retryResult, setRetryResult] = useState<{
    retried: number;
    failedMessage: string | null;
    failedCount: number;
  } | null>(null);
  const onCountRef: React.MutableRefObject<
    ((count: number) => void) | undefined
  > = useRef(props.onCount);
  onCountRef.current = props.onCount;

  // The scope as one value, so a new object for the same scope reads nothing again.
  const scopeKey: string = JSON.stringify(props.scope);
  const kind: CodeTaskListKind = props.kind || CodeTaskListKind.Tasks;
  const showFilters: boolean = Boolean(
    props.showFilters && kind === CodeTaskListKind.Tasks,
  );

  // The search reads once typing stops.
  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setSearch(searchInput.trim());
    }, CODE_TASK_SEARCH_DELAY_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  const load: (limit: number) => Promise<void> = useCallback(
    async (limit: number): Promise<void> => {
      try {
        const response: CodeTaskListResponse = await CodeApi.listTasks({
          scope: JSON.parse(scopeKey) as CodeTaskListScope,
          skip: 0,
          limit: limit,
          ...(kind === CodeTaskListKind.ProductionReviews ? { kind } : {}),
          ...(showFilters ? { filter, search, withCounts: true } : {}),
        });

        setTasks(response.tasks);
        setCount(response.count);
        setCounts(response.counts || null);
        setError(null);

        /*
         * The page counts every task, whatever the list shows of them. A
         * search's counts are of what it matches, so they are not the
         * page's: one that matched nothing told the page there was no task
         * at all, and the page hid its list - the search with it.
         */
        const total: number | null = response.counts
          ? response.counts[CodeTaskListFilter.All]
          : showFilters && filter !== CodeTaskListFilter.All
            ? null
            : response.count;

        if (!search && total !== null) {
          onCountRef.current?.(total);
        }
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
      setIsLoadingMore(false);
    },
    [scopeKey, kind, showFilters, filter, search],
  );

  useEffect(() => {
    setIsLoading(true);
    load(shown).catch(() => {
      // handled inside load
    });
  }, [load, props.refreshToken]);

  // Another filter or search starts from its first page, with nothing picked.
  useEffect(() => {
    setShown(CODE_TASK_PAGE_SIZE);
    setSelectedIds(new Set());
  }, [filter, search]);

  const canRetryTask: (task: CodeTaskSummaryJSON) => boolean = (
    task: CodeTaskSummaryJSON,
  ): boolean => {
    return Boolean(
      props.canRetry &&
        task.recipe === CodeFixTaskType.CodeRequest &&
        (task.state === CodeTaskState.Failed ||
          task.state === CodeTaskState.Stopped),
    );
  };

  /*
   * Try tasks again: one row's Try again, or the tasks picked. Each is
   * asked as its own page asks it; the list then reads itself again.
   */
  const retryTasks: (taskIds: Array<string>) => Promise<void> = async (
    taskIds: Array<string>,
  ): Promise<void> => {
    setRetryingIds(new Set(taskIds));
    setRetryResult(null);

    try {
      const result: CodeTaskRetryManyResponse =
        await CodeApi.retryMany(taskIds);

      setRetryResult({
        retried: result.retried,
        failedCount: result.failed.length,
        failedMessage: result.failed[0]?.message || null,
      });
    } catch (err) {
      setRetryResult({
        retried: 0,
        failedCount: taskIds.length,
        failedMessage: API.getFriendlyMessage(err),
      });
    }

    setSelectedIds(new Set());
    setRetryingIds(new Set());
    await load(shown);
  };

  const hasWorkingTask: boolean = tasks.some(
    (task: CodeTaskSummaryJSON): boolean => {
      return task.state === CodeTaskState.Working;
    },
  );

  useEffect(() => {
    if (!hasWorkingTask) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      load(shown).catch(() => {
        // handled inside load
      });
    }, CODE_TASK_LIST_POLL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [hasWorkingTask, load, shown]);

  const isFiltered: boolean =
    filter !== CodeTaskListFilter.All || Boolean(search);

  const toolbar: ReactElement = showFilters ? (
    <CodeTaskListToolbar
      filter={filter}
      counts={counts}
      searchInput={searchInput}
      onFilter={(next: CodeTaskListFilter) => {
        setFilter(next);
      }}
      onSearch={(next: string) => {
        setSearchInput(next);
      }}
    />
  ) : (
    <></>
  );

  const retryableShown: Array<CodeTaskSummaryJSON> = tasks.filter(
    (task: CodeTaskSummaryJSON): boolean => {
      return canRetryTask(task);
    },
  );

  // A row of the list has a box to pick it: every row keeps its place.
  const hasSelectColumn: boolean = retryableShown.length > 0;

  /*
   * How many are picked, then what trying them again did. Only these words
   * are the bar's live region, kept while the bar is up, so a screen reader
   * hears the count and the result, and not the buttons beside them.
   */
  const bulkBar: ReactElement =
    selectedIds.size > 0 || retryResult ? (
      <div
        data-testid="code-task-list-bulk"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm sm:px-5"
      >
        <span role="status" className="min-w-0">
          {selectedIds.size > 0 ? (
            <span className="font-medium text-gray-900">
              {translator.translateTemplate("{{count}} selected", {
                count: translator.formatNumber(selectedIds.size),
              })}
            </span>
          ) : (
            <></>
          )}
          {retryResult && selectedIds.size === 0 ? (
            <span
              data-testid="code-task-list-retry-result"
              className={
                retryResult.failedCount > 0 ? "text-red-700" : "text-gray-700"
              }
            >
              {[
                retryResult.retried > 0
                  ? translator.translatePlural(
                      {
                        one: "Trying {{count}} task again.",
                        other: "Trying {{count}} tasks again.",
                      },
                      retryResult.retried,
                    )
                  : "",
                retryResult.failedCount > 0
                  ? translator.translatePlural(
                      {
                        one: "{{count}} task could not be tried again: {{reason}}",
                        other:
                          "{{count}} tasks could not be tried again: {{reason}}",
                      },
                      retryResult.failedCount,
                      { reason: errorInSentence(retryResult.failedMessage) },
                    )
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </span>
          ) : (
            <></>
          )}
        </span>
        {selectedIds.size > 0 ? (
          <>
            <button
              type="button"
              data-testid="code-task-list-retry-selected"
              disabled={retryingIds.size > 0}
              onClick={() => {
                void retryTasks([...selectedIds]);
              }}
              className={`rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm ${getHandDrawnButtonStateClassName(
                {
                  isBusy: retryingIds.size > 0,
                  hoverClassName: "hover:bg-indigo-500",
                },
              )}`}
            >
              {translator.translateText("Retry selected")}
            </button>
            {retryableShown.length > selectedIds.size ? (
              <button
                type="button"
                data-testid="code-task-list-select-all"
                onClick={() => {
                  setSelectedIds(
                    new Set(
                      retryableShown.map((task: CodeTaskSummaryJSON) => {
                        return task.id;
                      }),
                    ),
                  );
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
              >
                {translator.translateText("Select all")}
              </button>
            ) : (
              <></>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              {translator.translateText("Clear")}
            </button>
          </>
        ) : (
          <></>
        )}
      </div>
    ) : (
      <></>
    );

  if (isLoading && tasks.length === 0 && !isFiltered) {
    return (
      <div
        data-testid="code-task-list-loading"
        role="status"
        className="divide-y divide-gray-100"
      >
        <span className="sr-only">{translator.translateText("Loading…")}</span>
        {/* Rows shaped like the ones on their way: a mark, a title, a line of facts. */}
        {[0, 1, 2].map((index: number) => {
          return (
            <div
              key={index}
              aria-hidden="true"
              className="flex items-start gap-3 px-4 py-3.5 sm:px-5"
            >
              <div className="mt-0.5 h-4 w-4 rounded-full bg-gray-100 motion-safe:animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 rounded bg-gray-100 motion-safe:animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-gray-100 motion-safe:animate-pulse" />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (error && tasks.length === 0) {
    return (
      <div data-testid="code-task-list-error">
        {toolbar}
        <div className="p-4">
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              setIsLoading(true);
              load(shown).catch(() => {
                // handled inside load
              });
            }}
          />
        </div>
      </div>
    );
  }

  if (tasks.length === 0 && !isFiltered && !isLoading) {
    return props.emptyState;
  }

  return (
    <div data-testid={props.dataTestId || "code-task-list"}>
      {toolbar}
      {bulkBar}
      {tasks.length === 0 ? (
        <div
          data-testid="code-task-list-no-match"
          className="px-6 py-10 text-center"
        >
          <p className="text-sm text-gray-600">
            {isLoading
              ? translator.translateText("Loading…")
              : translator.translateText("No tasks match.")}
          </p>
          {isLoading ? (
            <></>
          ) : (
            <button
              type="button"
              data-testid="code-task-list-clear-filters"
              onClick={() => {
                setFilter(CodeTaskListFilter.All);
                setSearchInput("");
                setSearch("");
              }}
              className="mt-2 rounded-md px-2.5 py-1 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
            >
              {translator.translateText("Clear filters")}
            </button>
          )}
        </div>
      ) : (
        <></>
      )}
      <ul
        aria-busy={isLoading ? "true" : undefined}
        className={`divide-y divide-gray-100 transition-opacity ${
          isLoading && tasks.length > 0 ? "opacity-60" : ""
        }`}
      >
        {tasks.map((task: CodeTaskSummaryJSON) => {
          const isRetryable: boolean = canRetryTask(task);

          return (
            <CodeTaskRow
              key={task.id}
              task={task}
              hasSelectColumn={hasSelectColumn}
              isSelected={selectedIds.has(task.id)}
              onSelect={
                isRetryable
                  ? (isSelected: boolean) => {
                      setSelectedIds((current: Set<string>) => {
                        const next: Set<string> = new Set(current);

                        if (isSelected) {
                          next.add(task.id);
                        } else {
                          next.delete(task.id);
                        }

                        return next;
                      });
                    }
                  : undefined
              }
              onRetry={
                isRetryable
                  ? () => {
                      void retryTasks([task.id]);
                    }
                  : undefined
              }
              isRetrying={retryingIds.has(task.id)}
              repositoryName={
                props.repositoryNames && task.codeRepositoryId
                  ? props.repositoryNames.get(task.codeRepositoryId)
                  : undefined
              }
              repositoryHost={
                (props.repositoryHosts && task.codeRepositoryId
                  ? props.repositoryHosts.get(task.codeRepositoryId)
                  : undefined) || props.repositoryHost
              }
            />
          );
        })}
      </ul>
      {count > tasks.length ? (
        <div className="border-t border-gray-100 px-4 py-3 text-center">
          <button
            type="button"
            data-testid="code-task-list-more"
            disabled={isLoadingMore}
            onClick={() => {
              const next: number = shown + CODE_TASK_PAGE_SIZE;
              setShown(next);
              setIsLoadingMore(true);
              load(next).catch(() => {
                // handled inside load
              });
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
              {
                isBusy: isLoadingMore,
                hoverClassName: "hover:bg-indigo-50 hover:text-indigo-700",
              },
            )}`}
          >
            {isLoadingMore
              ? translator.translateText("Loading…")
              : kind === CodeTaskListKind.ProductionReviews
                ? translator.translatePlural(
                    {
                      one: "Show {{count}} more review",
                      other: "Show {{count}} more reviews",
                    },
                    Math.min(CODE_TASK_PAGE_SIZE, count - tasks.length),
                  )
                : translator.translatePlural(
                    {
                      one: "Show {{count}} more task",
                      other: "Show {{count}} more tasks",
                    },
                    Math.min(CODE_TASK_PAGE_SIZE, count - tasks.length),
                  )}
          </button>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * One task in a list: its mark at the start (a turning ring while AI works,
 * a clock while it waits for a Runner, a bubble when it waits for you, a
 * check once done), its title, and a quieter line - its state in words
 * while it is moving or needs someone, its repository on a list across
 * repositories, who asked (or what kind of task OneUptime started), when
 * anything last happened, its pull request and what production showed -
 * with how much it changed at the end, "+23 −1".
 */
export interface CodeTaskRowProps {
  task: CodeTaskSummaryJSON;
  // The task's repository, named on a list across repositories.
  repositoryName?: string | undefined;
  // Where it is hosted: the mark beside its name.
  repositoryHost?: CodeTaskRepositoryHost | undefined;
  // A failed or stopped task the reader may try again: picked, or now.
  isSelected?: boolean | undefined;
  onSelect?: ((isSelected: boolean) => void) | undefined;
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean | undefined;
  /*
   * Some row of the list has a box to pick it: a row with none keeps the
   * box's place, so every row's mark and title start in one column.
   */
  hasSelectColumn?: boolean | undefined;
}

/*
 * A row's Try again, under its words on a phone: beside them, it squeezed
 * the title to a few words a line. Its start is the title's: the box's
 * column (1rem + 1rem), the link's start (0.75rem), the mark (1.25rem) and
 * the gap after it (0.75rem) - or, with no box, the link's start (1rem),
 * the mark and the gap.
 */
export const ROW_RETRY_UNDER_TITLE_CLASS_NAME: string =
  "max-sm:-mt-1 max-sm:mb-3 max-sm:basis-full max-sm:pl-[4.75rem]";

export const ROW_RETRY_UNDER_TITLE_NO_BOX_CLASS_NAME: string =
  "max-sm:-mt-1 max-sm:mb-3 max-sm:basis-full max-sm:pl-12";

export const CodeTaskRow: FunctionComponent<CodeTaskRowProps> = (
  props: CodeTaskRowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const task: CodeTaskSummaryJSON = props.task;
  const isRequest: boolean = task.recipe === CodeFixTaskType.CodeRequest;
  /*
   * A pull request's production review: its row is the pull request -
   * its title, its number and what production showed of it.
   */
  const isProductionReview: boolean =
    task.recipe === CodeFixTaskType.GitHubPullRequestProductionReview;
  const reviewedNumber: number | null = isProductionReview
    ? getReviewedPullRequestNumber(task.origin)
    : null;
  const title: string =
    task.title ||
    (isProductionReview && task.origin.label
      ? translator.translateTemplate(
          inReviewHostWords(
            PRODUCTION_REVIEW_COPY.pullRequestFallbackTitle,
            props.repositoryHost?.provider,
          ),
          { label: task.origin.label },
        )
      : translator.translateTemplate(getRecipeLabel(task.recipe)));
  const isQueued: boolean =
    task.state === CodeTaskState.Working && task.isQueued;

  /*
   * Who asked, for a request; for a task OneUptime started, its kind ("Fix
   * Exception") says what started it - its title already names the record.
   * A production review's page lists nothing else: its kind goes unsaid.
   */
  const startedBy: string = isProductionReview
    ? ""
    : isRequest
      ? task.origin.type === CodeTaskOriginType.Request && task.origin.label
        ? translator.translateTemplate(CODE_TASK_ASKED_BY, {
            name: task.origin.label,
          })
        : task.origin.type === CodeTaskOriginType.Insight
          ? translator.translateText(CODE_TASK_STARTED_BY_ONEUPTIME) || ""
          : ""
      : translator.translateText(getRecipeLabel(task.recipe)) || "";

  const meta: Array<ReactElement> = [];

  /*
   * A task AI tries again by itself says which attempt it is on, and while
   * it waits, when the next starts - instead of "Queued".
   */
  const isRetryingByItself: boolean = Boolean(
    task.state === CodeTaskState.Working && task.retry,
  );

  if (isRetryingByItself) {
    meta.push(
      <CodeTaskRetryNote
        key="retry"
        retry={task.retry!}
        isCompact={true}
        dataTestId="code-task-row-retry"
      />,
    );
  }

  /*
   * After how many attempts it failed, when AI tried it again by itself:
   * its state says so - "Failed after 3 attempts" - and the line under its
   * facts says why.
   */
  const isFailed: boolean = task.state === CodeTaskState.Failed;
  const failedAttempts: number =
    isFailed && task.retry && task.retry.attempt > 1 ? task.retry.attempt : 0;

  /*
   * Said in words only while it moves or asks something of someone - and a
   * stopped task whose row offers Try again, so the button has its reason.
   */
  const isStateSaid: boolean =
    !isRetryingByItself &&
    (CODE_TASK_STATE_COPY[task.state].isSaidInRow ||
      (task.state === CodeTaskState.Stopped && Boolean(props.onRetry)));

  if (isStateSaid) {
    meta.push(
      <span
        key="state"
        data-testid="code-task-row-state"
        className={`font-medium ${CODE_TASK_STATE_TEXT_CLASS_NAMES[task.state]}`}
      >
        {failedAttempts
          ? translator.translateTemplate(CODE_TASK_ROW_FAILED_AFTER_ATTEMPTS, {
              count: translator.formatNumber(failedAttempts),
            })
          : translator.translateText(
              isQueued
                ? QUEUED_LABEL
                : isProductionReview && task.state === CodeTaskState.Working
                  ? PRODUCTION_REVIEW_COPY.rowReviewing
                  : CODE_TASK_STATE_COPY[task.state].label,
            )}
      </span>,
    );
  }

  if (reviewedNumber) {
    meta.push(
      <span
        key="reviewed-pull-request"
        data-testid="code-task-row-reviewed-pull-request"
        className="inline-flex items-center gap-1"
      >
        <GitPullRequestMark className="h-3 w-3 flex-shrink-0" />
        {translator.translateTemplate(
          getPullRequestCopy(props.repositoryHost?.provider).short,
          {
            number: reviewedNumber.toString(),
          },
        )}
      </span>,
    );
  }

  // What the latest review found, at a glance: "2 exceptions", "Nothing found".
  if (isProductionReview && task.productionReview) {
    const glance: Array<string> = getProductionReviewGlance(
      task.productionReview,
      translator,
    );

    glance.forEach((part: string, index: number) => {
      meta.push(
        <span
          key={`glance-${index}`}
          data-testid="code-task-row-glance"
          className={
            task.productionReview!.hasSignal
              ? "font-medium text-gray-700"
              : undefined
          }
        >
          {part}
        </span>,
      );
    });
  }

  if (props.repositoryName) {
    meta.push(
      <span
        key="repository"
        data-testid="code-task-row-repository"
        title={props.repositoryName}
        className="inline-flex min-w-0 items-center gap-1 text-gray-600"
      >
        <span className="inline-flex flex-shrink-0 text-gray-400">
          <CodeHostMark
            provider={props.repositoryHost?.provider}
            hostProduct={props.repositoryHost?.hostProduct}
            className="h-3 w-3"
          />
        </span>
        <span className="truncate">{props.repositoryName}</span>
      </span>,
    );
  }

  if (startedBy) {
    meta.push(<span key="started-by">{startedBy}</span>);
  }

  meta.push(<CodeTimeAgo key="time" date={task.lastActivityAt} />);

  // How long its latest turn took, or has so far.
  if (task.startedAt && !isProductionReview) {
    meta.push(
      <CodeTaskTurnDuration
        key="duration"
        startedAt={task.startedAt}
        completedAt={task.completedAt}
      />,
    );
  }

  if (task.pullRequest?.number) {
    const pullRequestState: string = task.pullRequest.state;

    meta.push(
      <span
        key="pull-request"
        data-testid="code-task-row-pull-request"
        className="inline-flex items-center gap-1"
      >
        <GitPullRequestMark className="h-3 w-3 flex-shrink-0" />
        {translator.translateTemplate(
          getPullRequestCopy(props.repositoryHost?.provider).short,
          {
            number: task.pullRequest.number.toString(),
          },
        )}
        {/* Open is the usual state, so it is not said. */}
        {pullRequestState === "merged" || pullRequestState === "closed" ? (
          <span
            data-testid="code-task-row-pull-request-state"
            className={
              pullRequestState === "merged"
                ? "font-medium text-violet-700"
                : "text-gray-500"
            }
          >
            {translator.translateText(
              pullRequestState === "merged" ? "Merged" : "Closed",
            )}
          </span>
        ) : (
          <></>
        )}
      </span>,
    );
  }

  // Merged is not fixed: what production showed once the fix shipped.
  if (task.pullRequest?.production) {
    meta.push(
      <FixProductionVerdict
        key="production"
        production={task.pullRequest.production}
        isCompact={true}
        testId="code-task-row-production"
      />,
    );
  }

  /*
   * Why it failed, under its facts, as it was written: what the reader
   * decides Try again on without opening it.
   */
  const failure: string = isFailed ? task.errorMessage || "" : "";
  const hasBoxColumn: boolean = Boolean(
    props.onSelect || props.hasSelectColumn,
  );

  /*
   * The title and the reason are cut short at their own end: an English
   * title too long for a Persian page's row ends in "..." after its last
   * word, not before its first, and a short one still starts where the
   * page's lines do (LineDirection).
   */
  const titleDirection: ReadingDirection | undefined = getLineDirection(
    title,
    translator.language,
  );
  const failureDirection: ReadingDirection | undefined = getLineDirection(
    failure,
    translator.language,
  );

  return (
    <li
      data-testid="code-task-row"
      data-task-state={task.state}
      className={`flex flex-wrap items-start sm:flex-nowrap ${props.isSelected ? "bg-indigo-50/60" : ""}`}
    >
      {props.onSelect ? (
        <input
          type="checkbox"
          data-testid="code-task-row-select"
          checked={Boolean(props.isSelected)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onSelect?.(event.target.checked);
          }}
          aria-label={translator.translateTemplate("Select {{name}}", {
            name: title,
          })}
          className="ml-4 mt-3.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 sm:ml-5"
        />
      ) : props.hasSelectColumn ? (
        <span
          aria-hidden="true"
          data-testid="code-task-row-select-space"
          className="ml-4 mt-3.5 h-4 w-4 flex-shrink-0 sm:ml-5"
        />
      ) : (
        <></>
      )}
      <Link
        to={getTaskRoute(task.id)}
        className={`group flex min-w-0 flex-1 items-start gap-3 py-3 pr-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:pr-5 ${
          hasBoxColumn ? "pl-3" : "pl-4 sm:pl-5"
        }`}
      >
        <CodeTaskStateMark
          state={task.state}
          isQueued={task.isQueued}
          className="mt-px"
        />
        <div className="min-w-0 flex-1">
          <p
            data-testid="code-task-row-title"
            dir={titleDirection}
            className={`line-clamp-2 break-words text-sm font-medium leading-5 text-gray-900 sm:line-clamp-1${
              titleDirection
                ? ` ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`
                : ""
            }`}
          >
            <IsolatedText text={title} />
          </p>
          <CodeMetaList
            dataTestId="code-task-row-meta"
            className="mt-1 text-xs text-gray-500"
            items={meta}
          />
          {failure ? (
            <p
              data-testid="code-task-row-error"
              dir={failureDirection}
              className={`mt-1 line-clamp-2 break-words text-xs text-red-700${
                failureDirection
                  ? ` ${CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME}`
                  : ""
              }`}
            >
              <IsolatedText text={failure} />
            </p>
          ) : (
            <></>
          )}
        </div>
        {task.changes ? (
          <CodeDiffStat
            changes={task.changes}
            className="mt-0.5 flex-shrink-0"
            dataTestId="code-task-row-changes"
          />
        ) : (
          <></>
        )}
      </Link>
      {props.onRetry ? (
        <div
          data-testid="code-task-row-try-again"
          className={`flex-shrink-0 sm:mr-5 sm:mt-2.5 ${
            hasBoxColumn
              ? ROW_RETRY_UNDER_TITLE_CLASS_NAME
              : ROW_RETRY_UNDER_TITLE_NO_BOX_CLASS_NAME
          }`}
        >
          <button
            type="button"
            data-testid="code-task-row-retry-button"
            disabled={props.isRetrying}
            onClick={props.onRetry}
            className={`rounded-md bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 ${getHandDrawnButtonStateClassName(
              {
                isBusy: props.isRetrying,
                hoverClassName: "hover:bg-gray-50",
              },
            )}`}
          >
            {translator.translateText("Try again")}
          </button>
        </div>
      ) : (
        <></>
      )}
    </li>
  );
};

/*
 * A task list's filters - each with how many tasks it shows - and its
 * search, above its rows. The search sits beside the filters only while
 * they all fit on one line there, and goes under them otherwise - in any
 * language, at any width the list is given - so the filters never wrap
 * beside it.
 */
const CodeTaskListToolbar: FunctionComponent<{
  filter: CodeTaskListFilter;
  counts: CodeTaskListCountsJSON | null;
  searchInput: string;
  onFilter: (filter: CodeTaskListFilter) => void;
  onSearch: (search: string) => void;
}> = (props: {
  filter: CodeTaskListFilter;
  counts: CodeTaskListCountsJSON | null;
  searchInput: string;
  onFilter: (filter: CodeTaskListFilter) => void;
  onSearch: (search: string) => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const inputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  return (
    <div
      data-testid="code-task-list-toolbar"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-gray-100 px-4 py-3 sm:px-5"
    >
      <div
        role="group"
        aria-label={translator.translateText("Filter tasks")}
        className="flex flex-wrap gap-1.5"
      >
        {CODE_TASK_LIST_FILTERS.map(
          (entry: { filter: CodeTaskListFilter; label: string }) => {
            const isActive: boolean = entry.filter === props.filter;
            const count: number | undefined = props.counts?.[entry.filter];

            return (
              <button
                key={entry.filter}
                type="button"
                data-testid={`code-task-filter-${entry.filter}`}
                aria-pressed={isActive}
                onClick={() => {
                  props.onFilter(entry.filter);
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 ring-indigo-600/30"
                    : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
                }`}
              >
                {translator.translateText(entry.label)}
                {count !== undefined ? (
                  <span
                    data-testid="code-task-filter-count"
                    className={`tabular-nums ${
                      isActive ? "text-indigo-600" : "text-gray-400"
                    }`}
                  >
                    {translator.formatNumber(count)}
                  </span>
                ) : (
                  <></>
                )}
              </button>
            );
          },
        )}
      </div>
      {/*
        The search as every table's: a magnifier, and an x that empties it.
        It takes the rest of the filters' line, and a line of its own (the
        list's width) once that rest is narrower than 12rem.
      */}
      <div
        data-testid="code-task-list-search-box"
        role="presentation"
        onClick={() => {
          inputRef.current?.focus();
        }}
        className="flex h-8 min-w-[12rem] flex-1 cursor-text items-center gap-2 rounded-md bg-white px-2.5 shadow-sm ring-1 ring-inset ring-gray-300 focus-within:ring-2 focus-within:ring-indigo-600"
      >
        <Icon
          icon={IconProp.Search}
          className="h-4 w-4 flex-none text-gray-400"
        />
        <input
          ref={inputRef}
          type="search"
          data-testid="code-task-list-search"
          value={props.searchInput}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onSearch(event.target.value);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Escape" && props.searchInput) {
              event.preventDefault();
              props.onSearch("");
            }
          }}
          placeholder={translator.translateText("Search tasks")}
          aria-label={translator.translateText("Search tasks")}
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
        />
        {props.searchInput ? (
          <button
            type="button"
            data-testid="code-task-list-search-clear"
            aria-label={translator.translateText(CLEAR_SEARCH)}
            title={translator.translateText(CLEAR_SEARCH)}
            onMouseDown={(event: React.MouseEvent) => {
              event.preventDefault();
            }}
            onClick={() => {
              props.onSearch("");
              inputRef.current?.focus();
            }}
            className={TABLE_HEADER_SEARCH_CLEAR_BUTTON_CLASS_NAME}
          >
            <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
          </button>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default CodeTaskList;
