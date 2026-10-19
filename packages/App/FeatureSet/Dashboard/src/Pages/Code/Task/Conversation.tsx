import PageComponentProps from "../../PageComponentProps";
import CodeApi, { CodeTaskResponse } from "../../../Components/Code/CodeApi";
import CodeBlockerNotice from "../../../Components/Code/CodeBlockerNotice";
import CodeComposer from "../../../Components/Code/CodeComposer";
import { getRecipeLabel } from "../../../Components/Code/CodeTaskCopy";
import CodeTaskStateBadge from "../../../Components/Code/CodeTaskStateBadge";
import CodeTaskTurn from "../../../Components/Code/CodeTaskTurn";
import {
  getRepositoryFullName,
  getRepositoryRoute,
} from "../../../Components/Code/RepositoryCard";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskBlockerType,
  CodeTaskContextInput,
  CodeTaskState,
  CodeTaskTurnJSON,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import LinkComponent from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// While AI works, the conversation reads itself again this often.
export const CODE_TASK_POLL_MS: number = 3000;

/*
 * A task's page in Code: its conversation, as Claude Code or Codex show
 * one. At the top, what it is and how it stands - working, waiting for you,
 * done, failed or stopped - with its pull request one click away. Then
 * every turn: what was asked and the context added, the AI's steps as it
 * takes them, its reply, the files it changed and their diff, the pull
 * request. At the bottom, the box to reply: an answer, more context, or the
 * next change - each one a new turn of the same task, on the same branch
 * and pull request.
 *
 * While AI works the page reads itself again every few seconds, and the box
 * waits (with Stop beside it); a person who may only read the repository
 * reads, and is told why they cannot reply.
 */
const CodeTaskConversation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const taskId: string = Navigation.getLastParamAsObjectID().toString();

  const [data, setData] = useState<CodeTaskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const bottomRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setData(await CodeApi.getTask(taskId));
      setError(null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  }, [taskId]);

  useEffect(() => {
    load().catch(() => {
      // handled inside load
    });
  }, [load]);

  const isWorking: boolean = data?.task.state === CodeTaskState.Working;

  useEffect(() => {
    if (!isWorking) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      load().catch(() => {
        // handled inside load
      });
    }, CODE_TASK_POLL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [isWorking, load]);

  // Code > the repository > Task #42, once the task's repository is known.
  const breadcrumbs: Array<Link> | null = useMemo(() => {
    if (!data) {
      return null;
    }

    const links: Array<Link> = [
      {
        title: "Project",
        to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
      },
      {
        title: "Code",
        to: RouteUtil.populateRouteParams(RouteMap[PageMap.CODE] as Route),
      },
    ];

    if (data.repository) {
      links.push({
        title: data.repository.name,
        to: getRepositoryRoute(data.repository.id),
        isRecordName: true,
      });
    }

    links.push({
      title: data.task.taskNumber
        ? translator.translateTemplate("Task #{{number}}", {
            number: data.task.taskNumber.toString(),
          })
        : translator.translateTemplate("Task"),
      to: Navigation.getCurrentRoute(),
      isRecordName: true,
    });

    return links;
  }, [data?.repository?.id, data?.task.taskNumber, translator.language]);

  usePageBreadcrumbLinks(breadcrumbs);

  if (error && !data) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          load().catch(() => {
            // handled inside load
          });
        }}
      />
    );
  }

  if (!data) {
    return <PageLoader isVisible={true} />;
  }

  const turns: Array<CodeTaskTurnJSON> = data.turns;
  const latestTurn: CodeTaskTurnJSON | undefined = turns[turns.length - 1];
  const openPullRequest: CodeTaskTurnJSON["pullRequests"][number] | undefined =
    data.task.pullRequest;
  const title: string =
    data.task.title ||
    translator.translateTemplate(getRecipeLabel(data.task.recipe));

  const canRetry: boolean = Boolean(
    data.canAsk &&
      !data.blocker &&
      latestTurn &&
      latestTurn.recipe === CodeFixTaskType.CodeRequest &&
      (latestTurn.state === CodeTaskState.Failed ||
        latestTurn.state === CodeTaskState.Stopped),
  );

  const stop: () => Promise<void> = async (): Promise<void> => {
    setIsStopping(true);
    setActionError(null);

    try {
      await CodeApi.stop(taskId);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsStopping(false);
  };

  const retry: () => Promise<void> = async (): Promise<void> => {
    setIsRetrying(true);
    setActionError(null);

    try {
      await CodeApi.retry(taskId);
      await load();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsRetrying(false);
  };

  const renderFooter: () => ReactElement = (): ReactElement => {
    if (!data.repository) {
      return (
        <p
          data-testid="code-task-no-repository"
          className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600"
        >
          {translator.translateText(
            "This task is not linked to a repository, so AI cannot continue it. Start a new task from a repository.",
          )}
        </p>
      );
    }

    if (data.blocker?.type === CodeTaskBlockerType.NoPermission) {
      return <CodeBlockerNotice blocker={data.blocker} />;
    }

    if (isWorking) {
      return (
        <div
          data-testid="code-task-working-footer"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3"
        >
          <span className="h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
          <p className="min-w-0 flex-1 text-sm text-gray-600">
            {translator.translateText(
              "AI is working on this. You can reply when it finishes.",
            )}
          </p>
          {data.canAsk ? (
            <button
              type="button"
              data-testid="code-task-stop"
              disabled={isStopping}
              onClick={() => {
                void stop();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-60"
            >
              <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
              {isStopping
                ? translator.translateText("Stopping…")
                : translator.translateText("Stop")}
            </button>
          ) : (
            <></>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {data.blocker ? <CodeBlockerNotice blocker={data.blocker} /> : <></>}
        <CodeComposer
          dataTestId="code-task-composer"
          label={translator.translateTemplate("Reply to OneUptime AI")}
          placeholder={
            data.task.state === CodeTaskState.WaitingForYou
              ? translator.translateTemplate(
                  "Answer the question, add context, or ask for changes…",
                )
              : translator.translateTemplate(
                  "Ask for changes, add context, or ask a question…",
                )
          }
          sendLabel={translator.translateTemplate("Send")}
          isDisabled={!data.canAsk || Boolean(data.blocker)}
          autoFocus={data.task.state === CodeTaskState.WaitingForYou}
          onSend={async (reply: {
            message: string;
            context: Array<CodeTaskContextInput>;
          }): Promise<void> => {
            await CodeApi.reply({
              taskId: taskId,
              message: reply.message,
              context: reply.context,
            });
            await load();
            bottomRef.current?.scrollIntoView?.({ block: "end" });
          }}
          footer={
            openPullRequest?.state === "open" ? (
              <p className="text-xs text-gray-500">
                {translator.translateTemplate(
                  "Changes you ask for are pushed to pull request #{{number}}.",
                  { number: openPullRequest.number?.toString() || "" },
                )}
              </p>
            ) : undefined
          }
        />
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <header
        data-testid="code-task-header"
        className="border-b border-gray-200 pb-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <CodeTaskStateBadge
            state={data.task.state}
            isQueued={data.task.isQueued}
          />
          {data.task.taskNumber ? (
            <span className="text-sm text-gray-500">
              #{data.task.taskNumber}
            </span>
          ) : (
            <></>
          )}
          {data.task.recipe !== CodeFixTaskType.CodeRequest ? (
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
              {translator.translateText(getRecipeLabel(data.task.recipe))}
            </span>
          ) : (
            <></>
          )}
        </div>
        <h1
          data-testid="code-task-title"
          className="mt-2 break-words text-xl font-semibold leading-7 text-gray-900"
        >
          {title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500">
          {data.repository ? (
            <LinkComponent
              to={getRepositoryRoute(data.repository.id)}
              className="inline-flex items-center gap-1.5 hover:text-indigo-600"
            >
              <>
                <Icon icon={IconProp.Code} className="h-4 w-4" />
                {getRepositoryFullName(data.repository) || data.repository.name}
              </>
            </LinkComponent>
          ) : (
            <></>
          )}
          {openPullRequest?.url ? (
            <LinkComponent
              to={URL.fromString(openPullRequest.url)}
              openInNewTab={true}
              dataTestId="code-task-pull-request"
              className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:text-indigo-500"
            >
              <>
                <Icon icon={IconProp.GitHub} className="h-4 w-4" />
                {translator.translateTemplate("Pull request #{{number}}", {
                  number: openPullRequest.number?.toString() || "",
                })}
                <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
              </>
            </LinkComponent>
          ) : (
            <></>
          )}
        </div>
      </header>

      {actionError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700"
        >
          {actionError}
        </p>
      ) : (
        <></>
      )}

      <ol
        data-testid="code-task-turns"
        aria-label={translator.translateText("Conversation")}
        className="mt-6 space-y-6"
      >
        {turns.map((turn: CodeTaskTurnJSON, index: number) => {
          return (
            <CodeTaskTurn
              key={turn.runId}
              turn={turn}
              isLatest={index === turns.length - 1}
              origin={index === 0 ? data.task.origin : undefined}
              onRetry={
                canRetry
                  ? () => {
                      void retry();
                    }
                  : undefined
              }
              isRetrying={isRetrying}
              logRoute={new Route(
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.CODE_TASK_VIEW_LOG] as Route,
                  { modelId: new ObjectID(taskId) },
                ).toString(),
              ).addQueryParams({ turn: turn.runId })}
            />
          );
        })}
      </ol>

      <div ref={bottomRef} className="mt-8">
        {renderFooter()}
      </div>
    </div>
  );
};

export default CodeTaskConversation;
