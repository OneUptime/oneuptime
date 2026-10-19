import CodeApi, { CodeTaskListResponse } from "./CodeApi";
import {
  CODE_TASK_ASKED_BY,
  CODE_TASK_STATE_COPY,
  getRecipeLabel,
} from "./CodeTaskCopy";
import CodeTaskStateBadge from "./CodeTaskStateBadge";
import CodeTimeAgo from "./CodeTimeAgo";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
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

export const CODE_TASK_PAGE_SIZE: number = 20;

// How often a list with a task in progress asks again.
export const CODE_TASK_LIST_POLL_MS: number = 8000;

export interface ComponentProps {
  // The repository's tasks, or (null) the tasks that have no repository.
  repositoryId: string | null;
  // Change it to read the list again (a task was just started).
  refreshToken?: number | undefined;
  // What the list says with no task at all.
  emptyState: ReactElement;
  // Told how many tasks there are, once they are read.
  onCount?: ((count: number) => void) | undefined;
  dataTestId?: string | undefined;
}

// A task's page in Code: its conversation.
export const getTaskRoute: (taskId: string) => Route = (
  taskId: string,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: new ObjectID(taskId) },
  );
};

/*
 * A repository's tasks, newest first: each says what it is about, how it
 * stands (the state badge), who asked or what started it, when, and its
 * pull request. A row opens the task's conversation. While any task is in
 * progress the list reads itself again every few seconds, so its states
 * stay true without a reload.
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

  const load: (limit: number) => Promise<void> = useCallback(
    async (limit: number): Promise<void> => {
      try {
        const response: CodeTaskListResponse = await CodeApi.listTasks({
          repositoryId: props.repositoryId,
          skip: 0,
          limit: limit,
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
    [props.repositoryId],
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
        className="divide-y divide-gray-100"
      >
        {[0, 1, 2].map((index: number) => {
          return (
            <div key={index} className="flex items-center gap-3 px-4 py-4">
              <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
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
          return <CodeTaskRow key={task.id} task={task} />;
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

export const CodeTaskRow: FunctionComponent<{
  task: CodeTaskSummaryJSON;
}> = (props: { task: CodeTaskSummaryJSON }): ReactElement => {
  const translator: Translator = useTranslator();
  const task: CodeTaskSummaryJSON = props.task;
  const isRequest: boolean = task.recipe === CodeFixTaskType.CodeRequest;
  const title: string =
    task.title || translator.translateTemplate(getRecipeLabel(task.recipe));

  /*
   * Who asked, for a request; for a task OneUptime started, its kind ("Fix
   * Exception") says what started it - its title already names the record.
   */
  const startedBy: string = isRequest
    ? task.origin.type === CodeTaskOriginType.Request && task.origin.label
      ? translator.translateTemplate(CODE_TASK_ASKED_BY, {
          name: task.origin.label,
        })
      : ""
    : translator.translateText(getRecipeLabel(task.recipe)) || "";

  const meta: Array<ReactElement> = [];

  if (task.taskNumber) {
    meta.push(<span key="number">#{task.taskNumber}</span>);
  }

  if (startedBy) {
    meta.push(
      <span key="started-by" className={isRequest ? "" : "text-gray-600"}>
        {startedBy}
      </span>,
    );
  }

  meta.push(<CodeTimeAgo key="time" date={task.lastActivityAt} />);

  if (task.pullRequest?.number) {
    meta.push(
      <span key="pull-request" className="inline-flex items-center gap-1">
        <Icon icon={IconProp.GitHub} className="h-3 w-3" />
        {translator.translateTemplate("PR #{{number}}", {
          number: task.pullRequest.number.toString(),
        })}
      </span>,
    );
  }

  return (
    <li data-testid="code-task-row" data-task-state={task.state}>
      <Link
        to={getTaskRoute(task.id)}
        className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:px-5"
      >
        <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <Icon
            icon={
              task.state === CodeTaskState.Working
                ? IconProp.Sparkles
                : CODE_TASK_STATE_COPY[task.state].icon
            }
            className={`h-4 w-4 ${
              task.state === CodeTaskState.Working
                ? "text-indigo-500"
                : task.state === CodeTaskState.WaitingForYou
                  ? "text-amber-500"
                  : task.state === CodeTaskState.Failed
                    ? "text-red-500"
                    : task.state === CodeTaskState.Done
                      ? "text-emerald-500"
                      : "text-gray-400"
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-sm font-medium text-gray-900">
            {title}
          </p>
          <div
            data-testid="code-task-row-meta"
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500"
          >
            {/* On a phone the state leads the line, so the title keeps the width. */}
            <CodeTaskStateBadge
              state={task.state}
              isQueued={task.isQueued}
              className="sm:hidden"
            />
            {meta.map((item: ReactElement, index: number) => {
              return (
                <span
                  key={item.key || index}
                  className="inline-flex items-center whitespace-nowrap"
                >
                  {item}
                </span>
              );
            })}
          </div>
        </div>
        <CodeTaskStateBadge
          state={task.state}
          isQueued={task.isQueued}
          className="mt-0.5 max-sm:hidden"
        />
      </Link>
    </li>
  );
};

export default CodeTaskList;
