import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import CodeApi from "../Code/CodeApi";
import CodeDiffStat from "../Code/CodeDiffStat";
import { GitPullRequestMark } from "../Code/CodeMarks";
import CodeMetaList from "../Code/CodeMetaList";
import CodeTaskRetryNote, {
  RETRY_NOTE_CONTAINER_CLASS_NAME,
  WIDE_NOTE_ROW_CLASS_NAME,
} from "../Code/CodeTaskRetryNote";
import CodeTaskStageBadge from "../Code/CodeTaskStageBadge";
import {
  getFailedTurnTitle,
  INSIGHT_FIX_TASK_VIEW,
} from "../Code/CodeTaskStatusCopy";
import { CodeTaskTurnDuration } from "../Code/CodeTaskWorkTime";
import CodeTimeAgo from "../Code/CodeTimeAgo";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import { CodeTaskState, CodeTaskSummaryJSON } from "Common/Types/AI/CodeTask";
import CodeTaskStageUtil, {
  CodeTaskStage,
} from "Common/Types/AI/CodeTaskStage";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  taskId: string;
  // The task, once read; undefined while it is read, or when it cannot be.
  task?: CodeTaskSummaryJSON | undefined;
  isLoaded: boolean;
  // Read the task again: after Try again or Retry now.
  onChanged?: (() => void) | undefined;
}

/*
 * An insight's fix task, where the insight is read: where it stands in
 * words from its real state ("Task in progress" until there is a pull
 * request, "Task failed" when there will be none) with how long AI has
 * worked on it, its title, what AI last said, its pull request and how
 * much it changed - and, when it failed, why and after how many attempts,
 * with Try again; when AI tries it again by itself, which attempt it is
 * on and when the next starts, with Retry now. A task the reader may not
 * read still links to it.
 */
const InsightFixTask: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const task: CodeTaskSummaryJSON | undefined = props.task;
  const stage: CodeTaskStage | null = task
    ? CodeTaskStageUtil.fromSummary(task)
    : null;

  const retry: () => Promise<void> = async (): Promise<void> => {
    setIsRetrying(true);
    setActionError(null);

    try {
      await CodeApi.retry(props.taskId);
      props.onChanged?.();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsRetrying(false);
  };

  // The server asks again only what someone asked in Code.
  const isRequest: boolean = task?.recipe === CodeFixTaskType.CodeRequest;
  const isFailed: boolean = task?.state === CodeTaskState.Failed;
  const canTryAgain: boolean = Boolean(
    task && isRequest && (isFailed || task.state === CodeTaskState.Stopped),
  );

  const tryAgainButton: ReactElement = (
    <button
      type="button"
      data-testid="ai-insight-fix-try-again"
      disabled={isRetrying}
      onClick={() => {
        void retry();
      }}
      className={`flex-shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-inset ${
        isFailed ? "text-red-700 ring-red-200" : "text-gray-700 ring-gray-300"
      } ${getHandDrawnButtonStateClassName({
        isBusy: isRetrying,
        hoverClassName: isFailed ? "hover:bg-red-50" : "hover:bg-gray-50",
      })}`}
    >
      {translator.translateText("Try again")}
    </button>
  );

  // Its number, when anything last happened, and how long AI worked on it.
  const facts: Array<ReactElement> = [];

  if (task?.taskNumber) {
    facts.push(<span key="number">#{task.taskNumber}</span>);
  }

  if (task) {
    facts.push(<CodeTimeAgo key="time" date={task.lastActivityAt} />);
  }

  if (task?.startedAt) {
    facts.push(
      <CodeTaskTurnDuration
        key="duration"
        startedAt={task.startedAt}
        completedAt={task.completedAt}
        dataTestId="ai-insight-fix-duration"
      />,
    );
  }

  return (
    <div data-testid="ai-insight-fix-task" className="space-y-3">
      {task ? (
        <>
          <CodeMetaList
            dataTestId="ai-insight-fix-facts"
            className="text-xs text-gray-500"
            leading={
              <span className="ml-3 inline-flex max-w-full">
                <CodeTaskStageBadge
                  stage={stage}
                  dataTestId="ai-insight-fix-stage"
                />
              </span>
            }
            items={facts}
          />

          {task.title ? (
            <p
              data-testid="ai-insight-fix-title"
              className="break-words text-sm font-medium text-gray-900"
            >
              <IsolatedText text={task.title} />
            </p>
          ) : (
            <></>
          )}

          {task.state === CodeTaskState.Working && task.retry ? (
            <CodeTaskRetryNote
              retry={task.retry}
              onRetryNow={() => {
                void retry();
              }}
              isRetryingNow={isRetrying}
              dataTestId="ai-insight-fix-retry"
            />
          ) : (
            <></>
          )}

          {isFailed ? (
            <div
              data-testid="ai-insight-fix-failed"
              className={RETRY_NOTE_CONTAINER_CLASS_NAME}
            >
              <div
                className={`flex flex-col items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ${WIDE_NOTE_ROW_CLASS_NAME}`}
              >
                <div className="min-w-0 max-w-full flex-1">
                  {/* After how many attempts, when AI tried it again by itself. */}
                  <p
                    data-testid="ai-insight-fix-failed-title"
                    className="font-medium"
                  >
                    {getFailedTurnTitle({ retry: task.retry, translator })}
                  </p>
                  {task.errorMessage ? (
                    <p className="mt-0.5 break-words text-red-700">
                      <IsolatedText text={task.errorMessage} />
                    </p>
                  ) : (
                    <></>
                  )}
                </div>
                {canTryAgain ? tryAgainButton : <></>}
              </div>
            </div>
          ) : (
            <></>
          )}

          {task.latestReply ? (
            <p
              data-testid="ai-insight-fix-reply"
              className="line-clamp-4 whitespace-pre-line break-words text-sm text-gray-600"
            >
              <IsolatedText text={task.latestReply} />
            </p>
          ) : (
            <></>
          )}

          {task.pullRequest?.url || task.changes ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
              {task.pullRequest?.url ? (
                <Link
                  to={URL.fromString(task.pullRequest.url)}
                  openInNewTab={true}
                  dataTestId="ai-insight-fix-pull-request"
                  className="inline-flex items-center gap-1 font-medium text-gray-900 hover:text-indigo-600 hover:underline"
                >
                  <>
                    <GitPullRequestMark className="h-3.5 w-3.5 flex-shrink-0" />
                    {task.pullRequest.number
                      ? `#${task.pullRequest.number}`
                      : translator.translateText("Pull request")}
                    <Icon
                      icon={IconProp.ExternalLink}
                      className="h-3 w-3 flex-shrink-0 text-gray-400"
                    />
                  </>
                </Link>
              ) : (
                <></>
              )}
              {task.changes ? (
                <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs">
                  {translator.translatePlural(
                    {
                      one: "{{count}} file changed",
                      other: "{{count}} files changed",
                    },
                    task.changes.files,
                  )}
                  <CodeDiffStat changes={task.changes} />
                </span>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </>
      ) : props.isLoaded ? (
        <></>
      ) : (
        <p
          role="status"
          data-testid="ai-insight-fix-loading"
          className="text-sm text-gray-500"
        >
          {translator.translateText("Loading…")}
        </p>
      )}

      {actionError ? (
        <p role="alert" className="text-sm text-red-700">
          {actionError}
        </p>
      ) : (
        <></>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {/* A failed task's Try again is beside why it failed, above. */}
        {canTryAgain && !isFailed ? tryAgainButton : <></>}
        {/*
         * A real anchor (not a Button) so cmd/ctrl-click, middle-click and
         * "open in new tab" work — Link always sets href. Its pull request
         * has a link of its own, above.
         */}
        <Link
          to={RouteUtil.populateRouteParams(
            RouteMap[PageMap.CODE_TASK_VIEW] as Route,
            { modelId: new ObjectID(props.taskId) },
          )}
          dataTestId="ai-insight-fix-view-task"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          <span>{translator.translateText(INSIGHT_FIX_TASK_VIEW)}</span>
          <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
};

export default InsightFixTask;
