import FixProductionVerdict from "../../../Components/AI/FixProductionVerdict";
import PageComponentProps from "../../PageComponentProps";
import CodeApi, { CodeTaskResponse } from "../../../Components/Code/CodeApi";
import { CODE_COLUMN_CLASS_NAME } from "../../../Components/Code/CodeAskBox";
import CodeBlockerNotice from "../../../Components/Code/CodeBlockerNotice";
import CodeComposer from "../../../Components/Code/CodeComposer";
import CodeDiffStat from "../../../Components/Code/CodeDiffStat";
import CodeProductionReviewTask from "../../../Components/Code/CodeProductionReviewTask";
import { GitBranchMark } from "../../../Components/Code/CodeMarks";
import {
  getRepositoryFullName,
  getRepositoryRoute,
  getRepositorySettingsRoute,
} from "../../../Components/Code/CodePaths";
import { CodeRepositorySetting } from "../../../Components/Code/CodeRepositorySettingsCopy";
import { getRecipeLabel } from "../../../Components/Code/CodeTaskCopy";
import CodeTaskStateBadge from "../../../Components/Code/CodeTaskStateBadge";
import { getCodeTaskTrail } from "../../../Components/Code/CodeTaskTrail";
import CodeTaskTurn from "../../../Components/Code/CodeTaskTurn";
import { GitHubMark } from "../../../Components/Code/GitHubConnect";
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
 * The branch a task works from: the one picked when it was asked (kept on
 * its first turn), or the repository's main branch.
 */
export const getTaskBaseBranch: (
  data: Pick<CodeTaskResponse, "turns" | "repository">,
) => string = (
  data: Pick<CodeTaskResponse, "turns" | "repository">,
): string => {
  return (
    data.turns[0]?.request?.baseBranch || data.repository?.mainBranchName || ""
  );
};

/*
 * The box that stays at the bottom of the window as the conversation
 * scrolls, on the page's own ground (the theme's canvas, light or dark), so
 * the turns pass under it rather than show through it.
 */
export const STICKY_FOOTER_STYLE: React.CSSProperties = {
  backgroundColor: "var(--ou-background-primary)",
};

const STICKY_FADE_STYLE: React.CSSProperties = {
  background:
    "linear-gradient(to top, var(--ou-background-primary), transparent)",
};

/*
 * A task's page in Code: its conversation, as Claude Code or Codex show
 * one. At the top, what it is and how it stands - working, waiting for you,
 * done, failed or stopped - where it works (its repository and branch), how
 * much it changed, and its pull request one click away. Then the
 * conversation: each request as the person's message, and AI's side of it -
 * the steps it takes as it takes them, its reply, the files it changed and
 * their diff, the pull request. At the bottom, held at the bottom of the
 * window, the box to reply: an answer, more context, or the next change -
 * each one a new turn of the same task, on the same branch and pull
 * request.
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
  const [isAskingAgain, setIsAskingAgain] = useState<boolean>(false);
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

    return getCodeTaskTrail({
      taskId: taskId,
      response: data,
      translator: translator,
    });
  }, [
    data?.repository?.id,
    data?.repository?.name,
    data?.task.taskNumber,
    translator.language,
  ]);

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

  /*
   * A pull request's production review is not a conversation: its page is
   * the latest review, with Review again where the reply box would be.
   */
  if (data.task.recipe === CodeFixTaskType.GitHubPullRequestProductionReview) {
    const reviewAgain: () => Promise<void> = async (): Promise<void> => {
      setIsAskingAgain(true);
      setActionError(null);

      try {
        await CodeApi.reviewAgain(taskId);
        await load();
      } catch (err) {
        setActionError(API.getFriendlyMessage(err));
      }

      setIsAskingAgain(false);
    };

    return (
      <div className={CODE_COLUMN_CLASS_NAME}>
        <CodeProductionReviewTask
          data={data}
          isAskingAgain={isAskingAgain}
          actionError={actionError}
          onReviewAgain={() => {
            void reviewAgain();
          }}
          footerStyle={STICKY_FOOTER_STYLE}
          fadeStyle={STICKY_FADE_STYLE}
        />
      </div>
    );
  }

  const turns: Array<CodeTaskTurnJSON> = data.turns;
  const latestTurn: CodeTaskTurnJSON | undefined = turns[turns.length - 1];
  // The task's pull request: open, or merged or closed since.
  const pullRequest: CodeTaskTurnJSON["pullRequests"][number] | undefined =
    data.task.pullRequest;
  const isPullRequestOpen: boolean = pullRequest?.state === "open";
  const title: string =
    data.task.title ||
    translator.translateTemplate(getRecipeLabel(data.task.recipe));
  const baseBranch: string = getTaskBaseBranch(data);

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
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600"
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
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
        >
          {/* The turn above already shows AI at work; this says what it means for the reader. */}
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
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-60"
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
        notice={
          data.blocker ? (
            <div className="rounded-t-2xl bg-amber-50 px-4 py-3">
              <CodeBlockerNotice
                blocker={data.blocker}
                repositoryId={data.repository?.id}
                isInline={true}
              />
            </div>
          ) : undefined
        }
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
          /*
           * Where a change goes: the open pull request, or - none open,
           * or it was merged or closed - a new branch and pull request.
           */
          <p
            data-testid="code-task-composer-footer"
            className="text-xs leading-5 text-gray-500"
          >
            {isPullRequestOpen
              ? translator.translateTemplate(
                  "Changes you ask for are pushed to pull request #{{number}}.",
                  { number: pullRequest?.number?.toString() || "" },
                )
              : translator.translateText(
                  "AI works on a new branch and opens a pull request for you to review when it changes code. Nothing is merged on its own.",
                )}
          </p>
        }
      />
    );
  };

  return (
    <div className={CODE_COLUMN_CLASS_NAME}>
      <header
        data-testid="code-task-header"
        className="border-b border-gray-200 pb-5"
      >
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-80">
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
          </div>

          {pullRequest?.url ? (
            <LinkComponent
              to={URL.fromString(pullRequest.url)}
              openInNewTab={true}
              dataTestId="code-task-pull-request"
              className="inline-flex h-9 flex-shrink-0 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <>
                <GitHubMark className="h-4 w-4 flex-shrink-0" />
                {translator.translateTemplate("Pull request #{{number}}", {
                  number: pullRequest.number?.toString() || "",
                })}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                />
              </>
            </LinkComponent>
          ) : (
            <></>
          )}
        </div>

        {/*
         * Where the task works and what it changed: its repository, the
         * branch it works from, its lines added and removed, and - once its
         * pull request is merged or closed - that, with what production
         * showed. Open is the usual state, so it is not said.
         */}
        <div
          data-testid="code-task-facts"
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500"
        >
          {data.repository ? (
            <LinkComponent
              to={getRepositoryRoute(data.repository.id)}
              dataTestId="code-task-repository"
              className="inline-flex min-w-0 items-center gap-1.5 hover:text-indigo-600"
            >
              <>
                <GitHubMark className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">
                  {getRepositoryFullName(data.repository) ||
                    data.repository.name}
                </span>
              </>
            </LinkComponent>
          ) : (
            <></>
          )}
          {data.repository && baseBranch ? (
            <span
              data-testid="code-task-branch"
              className="inline-flex min-w-0 items-center gap-1"
            >
              <GitBranchMark className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <span className="truncate font-mono text-xs">{baseBranch}</span>
            </span>
          ) : (
            <></>
          )}
          {data.task.changes ? (
            <CodeDiffStat
              changes={data.task.changes}
              dataTestId="code-task-changes-stat"
            />
          ) : (
            <></>
          )}
          {pullRequest &&
          (pullRequest.state === "merged" || pullRequest.state === "closed") ? (
            <span
              data-testid="code-task-pull-request-state"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                pullRequest.state === "merged"
                  ? "bg-violet-50 text-violet-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {pullRequest.state === "merged"
                ? translator.translateText("Merged")
                : translator.translateText("Closed")}
            </span>
          ) : (
            <></>
          )}
          {/* What production showed once it shipped; the turn says why. */}
          {pullRequest?.production ? (
            <FixProductionVerdict
              production={pullRequest.production}
              isCompact={true}
              testId="code-task-pull-request-production"
            />
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
              repositorySettingsRoute={
                /*
                 * A slow queue points at the repository's Runner: its
                 * settings open there, with More settings open.
                 */
                data.repository
                  ? getRepositorySettingsRoute(
                      data.repository.id,
                      CodeRepositorySetting.Runner,
                    )
                  : undefined
              }
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

      {/*
       * The reply box, held at the bottom of the window as the
       * conversation scrolls - its ground is the page's, faded above it.
       */}
      <div
        ref={bottomRef}
        data-testid="code-task-footer"
        className="sticky bottom-0 z-10 mt-8 pb-4"
        style={STICKY_FOOTER_STYLE}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-6 h-6"
          style={STICKY_FADE_STYLE}
        />
        {renderFooter()}
      </div>
    </div>
  );
};

export default CodeTaskConversation;
