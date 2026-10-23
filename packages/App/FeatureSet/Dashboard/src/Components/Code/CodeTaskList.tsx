import FixProductionVerdict from "../AI/FixProductionVerdict";
import CodeApi, { CodeTaskListResponse, CodeTaskListScope } from "./CodeApi";
import {
  PRODUCTION_REVIEW_COPY,
  getProductionReviewGlance,
  getReviewedPullRequestNumber,
} from "./CodeProductionReviewCopy";
import CodeDiffStat from "./CodeDiffStat";
import { GitPullRequestMark } from "./CodeMarks";
import CodeMetaList from "./CodeMetaList";
import { getTaskRoute } from "./CodePaths";
import {
  CODE_TASK_ASKED_BY,
  CODE_TASK_STATE_COPY,
  CODE_TASK_STATE_TEXT_CLASS_NAMES,
  getRecipeLabel,
  QUEUED_LABEL,
} from "./CodeTaskCopy";
import CodeTaskStateMark from "./CodeTaskStateMark";
import CodeTimeAgo from "./CodeTimeAgo";
import CodeHostMark from "./CodeHostMark";
import { getPullRequestCopy } from "./CodeHostCopy";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskListKind,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
} from "Common/Types/AI/CodeTask";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
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
  const onCountRef: React.MutableRefObject<
    ((count: number) => void) | undefined
  > = useRef(props.onCount);
  onCountRef.current = props.onCount;

  // The scope as one value, so a new object for the same scope reads nothing again.
  const scopeKey: string = JSON.stringify(props.scope);
  const kind: CodeTaskListKind = props.kind || CodeTaskListKind.Tasks;

  const load: (limit: number) => Promise<void> = useCallback(
    async (limit: number): Promise<void> => {
      try {
        const response: CodeTaskListResponse = await CodeApi.listTasks({
          scope: JSON.parse(scopeKey) as CodeTaskListScope,
          skip: 0,
          limit: limit,
          ...(kind === CodeTaskListKind.ProductionReviews ? { kind } : {}),
        });

        setTasks(response.tasks);
        setCount(response.count);
        setError(null);
        onCountRef.current?.(response.count);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
      setIsLoadingMore(false);
    },
    [scopeKey, kind],
  );

  useEffect(() => {
    setIsLoading(true);
    load(shown).catch(() => {
      // handled inside load
    });
  }, [load, props.refreshToken]);

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

  if (isLoading && tasks.length === 0) {
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
    );
  }

  if (tasks.length === 0) {
    return props.emptyState;
  }

  return (
    <div data-testid={props.dataTestId || "code-task-list"}>
      <ul className="divide-y divide-gray-100">
        {tasks.map((task: CodeTaskSummaryJSON) => {
          return (
            <CodeTaskRow
              key={task.id}
              task={task}
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
            className="rounded-md px-3 py-1.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
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
export const CodeTaskRow: FunctionComponent<{
  task: CodeTaskSummaryJSON;
  // The task's repository, named on a list across repositories.
  repositoryName?: string | undefined;
  // Where it is hosted: the mark beside its name.
  repositoryHost?: CodeTaskRepositoryHost | undefined;
}> = (props: {
  task: CodeTaskSummaryJSON;
  repositoryName?: string | undefined;
  repositoryHost?: CodeTaskRepositoryHost | undefined;
}): ReactElement => {
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
          PRODUCTION_REVIEW_COPY.pullRequestFallbackTitle,
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
        : ""
      : translator.translateText(getRecipeLabel(task.recipe)) || "";

  const meta: Array<ReactElement> = [];

  // Said in words only while it moves or asks something of someone.
  if (CODE_TASK_STATE_COPY[task.state].isSaidInRow) {
    meta.push(
      <span
        key="state"
        data-testid="code-task-row-state"
        className={`font-medium ${CODE_TASK_STATE_TEXT_CLASS_NAMES[task.state]}`}
      >
        {translator.translateText(
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
        {translator.translateTemplate("PR #{{number}}", {
          number: reviewedNumber.toString(),
        })}
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

  if (task.pullRequest?.number) {
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

  return (
    <li data-testid="code-task-row" data-task-state={task.state}>
      <Link
        to={getTaskRoute(task.id)}
        className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-5"
      >
        <CodeTaskStateMark
          state={task.state}
          isQueued={task.isQueued}
          className="mt-px"
        />
        <div className="min-w-0 flex-1">
          <p
            data-testid="code-task-row-title"
            className="line-clamp-2 break-words text-sm font-medium leading-5 text-gray-900 sm:line-clamp-1"
          >
            {title}
          </p>
          <CodeMetaList
            dataTestId="code-task-row-meta"
            className="mt-1 text-xs text-gray-500"
            items={meta}
          />
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
    </li>
  );
};

export default CodeTaskList;
