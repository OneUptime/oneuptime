import {
  getAvatarTone,
  getInitials,
} from "../AI/InvestigationConversation/InvestigationConversationData";
import CodeTaskChangesView from "./CodeTaskChanges";
import {
  CODE_TASK_CONTEXT_KINDS,
  CODE_TASK_CONTEXT_RECORD_PAGES,
  CODE_TASK_ORIGIN_SENTENCES,
  CODE_TASK_PROFILE_CHIP_LABEL,
  CODE_TURN_FAILED,
} from "./CodeTaskCopy";
import CodeTaskStateBadge from "./CodeTaskStateBadge";
import CodeTaskSteps from "./CodeTaskSteps";
import CodeTimeAgo from "./CodeTimeAgo";
import {
  EventDurationPart,
  formatEventDurationParts,
  getEventDurationParts,
  LESS_THAN_A_MINUTE,
} from "../../Utils/EventDuration";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  ProfilesUrlState,
  buildProfilesRoute,
} from "../../Utils/ProfilesUrlState";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  CodeTaskContextItemJSON,
  CodeTaskContextType,
  CodeTaskOriginJSON,
  CodeTaskOriginType,
  CodeTaskPullRequestJSON,
  CodeTaskState,
  CodeTaskTurnJSON,
} from "Common/Types/AI/CodeTask";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A message is its author's mark, a line saying who and when, and what was
 * said - the AI investigation card's layout, so a conversation with AI
 * reads the same across OneUptime. From sm up the mark stands beside both;
 * on a phone the text takes the full width under it.
 */
const MESSAGE_CLASS_NAME: string =
  "grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3";
const MESSAGE_MARK_CLASS_NAME: string = "self-start sm:row-span-2";
const MESSAGE_BYLINE_CLASS_NAME: string =
  "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 self-center";
const MESSAGE_BODY_CLASS_NAME: string =
  "col-span-2 mt-1.5 min-w-0 sm:col-span-1 sm:col-start-2 sm:mt-0";

// How long a queued turn waits before the page says what to check.
export const SLOW_QUEUE_IN_MINUTES: number = 5;

/*
 * A turn's byline facts - when it was asked, how long AI worked, its Log -
 * in a gray that still reads on the page's gray (gray-400 did not).
 */
const BYLINE_FACT_CLASS_NAME: string = "text-xs text-gray-500";

/*
 * How long a turn has taken, or took, in the reader's words: "8 minutes",
 * "1 hour, 5 minutes", "8 Minuten" - the two largest units, as the
 * Dashboard's other durations say them. Under a minute is "less than a
 * minute".
 */
export const getTurnDurationText: (data: {
  start: Date;
  end: Date;
  translator: Translator;
}) => string = (data: {
  start: Date;
  end: Date;
  translator: Translator;
}): string => {
  const parts: Array<EventDurationPart> = getEventDurationParts(
    data.start,
    data.end,
    { maxUnits: 2 },
  );

  if (parts.length === 0) {
    return (
      data.translator.translateText(LESS_THAN_A_MINUTE) || LESS_THAN_A_MINUTE
    );
  }

  return formatEventDurationParts(parts, data.translator.language);
};

export interface ComponentProps {
  turn: CodeTaskTurnJSON;
  isLatest: boolean;
  // What started the task, for a first turn nobody asked for in Code.
  origin?: CodeTaskOriginJSON | undefined;
  // Show "Try again" on a failed or stopped latest request.
  onRetry?: (() => void) | undefined;
  isRetrying?: boolean | undefined;
  // Link to this turn's full log.
  logRoute?: Route | undefined;
}

// The page a context chip opens, when it names a record.
export const getContextItemRoute: (
  item: CodeTaskContextItemJSON,
) => Route | URL | null = (
  item: CodeTaskContextItemJSON,
): Route | URL | null => {
  if (item.type === CodeTaskContextType.Link && item.url) {
    try {
      return URL.fromString(item.url);
    } catch {
      return null;
    }
  }

  if (item.type === CodeTaskContextType.Trace && item.traceId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.TRACE_VIEW] as Route,
      { modelId: item.traceId },
    );
  }

  // A profile opens the Profiler on the function, in the window it was read.
  if (
    item.type === CodeTaskContextType.Profile &&
    item.serviceId &&
    item.functionName
  ) {
    const state: ProfilesUrlState = {
      serviceId: item.serviceId,
      functionName: item.functionName,
    };

    if (item.fileName) {
      state.fileName = item.fileName;
    }

    if (item.profileType) {
      state.profileType = item.profileType;
    }

    const startTime: Date | null = item.startTime
      ? new Date(item.startTime)
      : null;
    const endTime: Date | null = item.endTime ? new Date(item.endTime) : null;

    if (
      startTime &&
      endTime &&
      !isNaN(startTime.getTime()) &&
      !isNaN(endTime.getTime())
    ) {
      state.startTime = startTime;
      state.endTime = endTime;
    }

    return buildProfilesRoute(state);
  }

  const pageMap: PageMap | undefined =
    CODE_TASK_CONTEXT_RECORD_PAGES[item.type];

  if (pageMap && item.recordId) {
    return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
      modelId: new ObjectID(item.recordId),
    });
  }

  return null;
};

export const ContextChips: FunctionComponent<{
  items: Array<CodeTaskContextItemJSON>;
}> = (props: { items: Array<CodeTaskContextItemJSON> }): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.items.length === 0) {
    return <></>;
  }

  return (
    <ul
      data-testid="code-turn-context"
      aria-label={translator.translateText("Context")}
      className="mt-2 flex flex-wrap gap-1.5"
    >
      {props.items.map((item: CodeTaskContextItemJSON, index: number) => {
        const route: Route | URL | null = getContextItemRoute(item);
        /*
         * The server keeps an English label beside a search or a trace;
         * they are worded here in the reader's language from their own
         * fields. Records keep their own names.
         */
        const label: string =
          item.type === CodeTaskContextType.Logs && item.search
            ? translator.translateTemplate('Logs matching "{{search}}"', {
                search: item.search,
              })
            : item.type === CodeTaskContextType.Trace && item.traceId
              ? translator.translateTemplate("Trace {{traceId}}", {
                  traceId: `${item.traceId.substring(0, 8)}…`,
                })
              : item.type === CodeTaskContextType.Profile && item.functionName
                ? translator.translateTemplate(CODE_TASK_PROFILE_CHIP_LABEL, {
                    function: item.functionName,
                  })
                : item.label;
        const chip: ReactElement = (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
            <Icon
              icon={CODE_TASK_CONTEXT_KINDS[item.type]?.icon || IconProp.Circle}
              className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
            />
            <span
              className={`truncate ${
                item.type === CodeTaskContextType.File ? "font-mono" : ""
              }`}
              title={item.text || label}
            >
              {label}
            </span>
          </span>
        );

        return (
          <li
            key={`${item.type}-${index}`}
            data-testid="code-turn-context-chip"
            data-context-type={item.type}
            className="max-w-full"
          >
            {route ? (
              <Link
                to={route}
                openInNewTab={item.type === CodeTaskContextType.Link}
                className="block max-w-full hover:opacity-80"
              >
                {chip}
              </Link>
            ) : (
              chip
            )}
          </li>
        );
      })}
    </ul>
  );
};

const PersonMark: FunctionComponent<{ name: string; seed: string }> = (props: {
  name: string;
  seed: string;
}): ReactElement => {
  return (
    <div
      aria-hidden="true"
      title={props.name}
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-white ${getAvatarTone(
        props.seed,
      )}`}
    >
      {getInitials(props.name)}
    </div>
  );
};

const AIMark: FunctionComponent = (): ReactElement => {
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white"
    >
      <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
    </div>
  );
};

const OneUptimeMark: FunctionComponent = (): ReactElement => {
  return (
    <div
      aria-hidden="true"
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-white"
    >
      <Icon icon={IconProp.Bolt} className="h-4 w-4" />
    </div>
  );
};

const PullRequestLine: FunctionComponent<{
  pullRequest: CodeTaskPullRequestJSON;
  isUpdate: boolean;
}> = (props: {
  pullRequest: CodeTaskPullRequestJSON;
  isUpdate: boolean;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const pullRequest: CodeTaskPullRequestJSON = props.pullRequest;
  const number: string = pullRequest.number?.toString() || "";

  /*
   * A pull request is open until someone merges or closes it, so only those
   * two are said. (The Dashboard's "Open" is the verb - German "Öffnen".)
   */
  const stateText: string =
    pullRequest.state === "merged"
      ? translator.translateTemplate("Merged")
      : pullRequest.state === "closed"
        ? translator.translateTemplate("Closed")
        : "";

  return (
    <div
      data-testid="code-turn-pull-request"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    >
      <Icon icon={IconProp.GitHub} className="h-4 w-4 text-gray-700" />
      <span className="font-medium text-gray-900">
        {props.isUpdate
          ? translator.translateTemplate("Pushed to pull request #{{number}}", {
              number,
            })
          : translator.translateTemplate("Opened pull request #{{number}}", {
              number,
            })}
      </span>
      {stateText ? (
        <span
          data-testid="code-turn-pull-request-state"
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            pullRequest.state === "merged"
              ? "bg-violet-50 text-violet-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {stateText}
        </span>
      ) : (
        <></>
      )}
      {pullRequest.url ? (
        <Link
          to={URL.fromString(pullRequest.url)}
          openInNewTab={true}
          className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500"
        >
          <>
            {translator.translateText("View on GitHub")}
            <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
          </>
        </Link>
      ) : (
        <></>
      )}
    </div>
  );
};

// How long the turn has taken, or took.
const TurnDuration: FunctionComponent<{ turn: CodeTaskTurnJSON }> = (props: {
  turn: CodeTaskTurnJSON;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.turn.startedAt) {
    return <></>;
  }

  const start: Date = new Date(props.turn.startedAt);
  const end: Date = props.turn.completedAt
    ? new Date(props.turn.completedAt)
    : OneUptimeDate.getCurrentDate();

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return <></>;
  }

  const duration: string = getTurnDurationText({
    start,
    end,
    translator,
  });

  return (
    <span data-testid="code-turn-duration" className={BYLINE_FACT_CLASS_NAME}>
      {props.turn.completedAt
        ? translator.translateTemplate("worked {{duration}}", { duration })
        : translator.translateTemplate("{{duration}} so far", { duration })}
    </span>
  );
};

/*
 * One turn of a task's conversation: what the person asked (or what started
 * the task, for one OneUptime started) and the AI's side of it - how it
 * stands, the steps it is taking or took, its reply, the files it changed
 * and the pull request it opened or added to; why it failed, when it did.
 */
const CodeTaskTurn: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const turn: CodeTaskTurnJSON = props.turn;
  const isWorking: boolean = turn.state === CodeTaskState.Working;
  const isQueued: boolean = turn.status === "Queued";
  const personName: string =
    turn.requestedBy?.name || translator.translateTemplate("Someone");

  const queuedMinutes: number = Math.floor(
    (Date.now() - new Date(turn.createdAt).getTime()) / 60000,
  );

  const renderAsk: () => ReactElement = (): ReactElement => {
    if (turn.request) {
      return (
        <li data-testid="code-turn-request" className={MESSAGE_CLASS_NAME}>
          <div className={MESSAGE_MARK_CLASS_NAME}>
            <PersonMark
              name={personName}
              seed={turn.requestedBy?.id || personName}
            />
          </div>
          <div className={MESSAGE_BYLINE_CLASS_NAME}>
            <span className="text-sm font-semibold text-gray-900">
              {personName}
            </span>
            <CodeTimeAgo
              date={turn.createdAt}
              className={BYLINE_FACT_CLASS_NAME}
            />
          </div>
          <div className={MESSAGE_BODY_CLASS_NAME}>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">
              {turn.request.message}
            </p>
            <ContextChips items={turn.request.context} />
          </div>
        </li>
      );
    }

    if (props.origin) {
      const origin: CodeTaskOriginJSON = props.origin;
      const recordRoute: Route | null =
        origin.recordId &&
        (origin.type === CodeTaskOriginType.Exception ||
          origin.type === CodeTaskOriginType.Incident ||
          origin.type === CodeTaskOriginType.Alert)
          ? RouteUtil.populateRouteParams(
              RouteMap[
                origin.type === CodeTaskOriginType.Exception
                  ? PageMap.EXCEPTIONS_VIEW
                  : origin.type === CodeTaskOriginType.Incident
                    ? PageMap.INCIDENT_VIEW
                    : PageMap.ALERT_VIEW
              ] as Route,
              { modelId: new ObjectID(origin.recordId) },
            )
          : null;

      const label: ReactElement = recordRoute ? (
        <Link
          to={recordRoute}
          className="font-medium text-indigo-600 hover:text-indigo-500"
        >
          <>{origin.label}</>
        </Link>
      ) : origin.url ? (
        <Link
          to={URL.fromString(origin.url)}
          openInNewTab={true}
          className="font-medium text-indigo-600 hover:text-indigo-500"
        >
          <>{origin.label}</>
        </Link>
      ) : (
        <span className="font-medium text-gray-900">{origin.label}</span>
      );

      return (
        <li data-testid="code-turn-origin" className={MESSAGE_CLASS_NAME}>
          <div className={MESSAGE_MARK_CLASS_NAME}>
            <OneUptimeMark />
          </div>
          <div className={MESSAGE_BYLINE_CLASS_NAME}>
            <span className="text-sm font-semibold text-gray-900">
              OneUptime
            </span>
            {/* What kind of task it is, the header already says. */}
            <CodeTimeAgo
              date={turn.createdAt}
              className={BYLINE_FACT_CLASS_NAME}
            />
          </div>
          <div className={MESSAGE_BODY_CLASS_NAME}>
            <p className="mt-0.5 break-words text-sm leading-6 text-gray-700">
              {origin.label ? (
                <TranslatedSentence
                  template={CODE_TASK_ORIGIN_SENTENCES[origin.type]}
                  slots={{ label: label }}
                />
              ) : (
                translator.translateText(
                  CODE_TASK_ORIGIN_SENTENCES[CodeTaskOriginType.Unknown],
                )
              )}
            </p>
          </div>
        </li>
      );
    }

    return <></>;
  };

  const renderReply: () => ReactElement = (): ReactElement => {
    const summary: string = turn.outcome?.summary || "";
    const filesChanged: number = turn.outcome?.filesChanged?.length || 0;

    return (
      <li
        data-testid="code-turn-reply"
        data-turn-state={turn.state}
        className={MESSAGE_CLASS_NAME}
      >
        <div className={MESSAGE_MARK_CLASS_NAME}>
          <AIMark />
        </div>
        <div className={MESSAGE_BYLINE_CLASS_NAME}>
          <span className="text-sm font-semibold text-gray-900">
            OneUptime AI
          </span>
          <CodeTaskStateBadge state={turn.state} isQueued={isQueued} />
          <TurnDuration turn={turn} />
          {props.logRoute && !isQueued ? (
            <Link
              to={props.logRoute}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
            >
              <>{translator.translateText("Log")}</>
            </Link>
          ) : (
            <></>
          )}
        </div>
        <div className={`${MESSAGE_BODY_CLASS_NAME} space-y-3`}>
          {isWorking && (isQueued || turn.steps.length === 0) ? (
            <div
              role="status"
              data-testid="code-turn-working"
              className="mt-1 flex items-start gap-2 text-sm text-gray-600"
            >
              <span className="mt-1 h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
              <span>
                {isQueued
                  ? translator.translateText(
                      "Waiting for a Runner to pick this up…",
                    )
                  : translator.translateText("Working on it…")}
                {isQueued && queuedMinutes >= SLOW_QUEUE_IN_MINUTES ? (
                  <span
                    data-testid="code-turn-slow-queue"
                    className="mt-1 block text-xs text-gray-500"
                  >
                    <TranslatedSentence
                      template="Taking longer than usual? Check that a Runner with Runs AI Code Fixes is online and up to date in {{runners}}."
                      slots={{
                        runners: (
                          <Link
                            to={RouteUtil.populateRouteParams(
                              RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,
                            )}
                            className="font-medium text-indigo-600 hover:text-indigo-500"
                          >
                            <>{translator.translateText("Runners")}</>
                          </Link>
                        ),
                      }}
                    />
                  </span>
                ) : (
                  <></>
                )}
              </span>
            </div>
          ) : (
            <></>
          )}

          {turn.steps.length > 0 ? (
            <CodeTaskSteps steps={turn.steps} isLive={isWorking} />
          ) : (
            <></>
          )}

          {summary ? (
            <div
              data-testid="code-turn-summary"
              className={
                turn.needsInput
                  ? "rounded-r-lg border-l-2 border-amber-400 bg-amber-50 py-2 pl-3 pr-3"
                  : ""
              }
            >
              {turn.needsInput ? (
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                  {translator.translateText("AI asks")}
                </p>
              ) : (
                <></>
              )}
              <div className="text-sm leading-6 text-gray-800">
                <MarkdownViewer text={summary} />
              </div>
            </div>
          ) : (
            <></>
          )}

          {filesChanged > 0 ? (
            <CodeTaskChangesView
              files={turn.outcome?.filesChanged || []}
              changes={turn.changes}
            />
          ) : (
            <></>
          )}

          {turn.pullRequests.map((pullRequest: CodeTaskPullRequestJSON) => {
            return (
              <PullRequestLine
                key={`${pullRequest.number}-${pullRequest.url}`}
                pullRequest={pullRequest}
                isUpdate={false}
              />
            );
          })}

          {turn.pullRequests.length === 0 &&
          turn.outcome?.pullRequestNumber &&
          filesChanged > 0 ? (
            <PullRequestLine
              pullRequest={{
                number: turn.outcome.pullRequestNumber,
                url: turn.outcome.pullRequestUrl,
                state: "open",
              }}
              isUpdate={turn.outcome.openedPullRequest === false}
            />
          ) : (
            <></>
          )}

          {turn.state === CodeTaskState.Done &&
          !summary &&
          filesChanged === 0 &&
          turn.pullRequests.length === 0 ? (
            <p className="text-sm text-gray-600">
              {turn.errorMessage
                ? turn.errorMessage
                : translator.translateText(
                    "Finished without changing any code.",
                  )}
            </p>
          ) : (
            <></>
          )}

          {turn.state === CodeTaskState.Failed ? (
            <div
              data-testid="code-turn-failed"
              className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              <Icon
                icon={IconProp.ExclaimationCircle}
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {translator.translateText(CODE_TURN_FAILED)}
                </p>
                {turn.errorMessage ? (
                  <p className="mt-0.5 break-words text-red-700">
                    {turn.errorMessage}
                  </p>
                ) : (
                  <></>
                )}
              </div>
              {props.isLatest && props.onRetry ? (
                <button
                  type="button"
                  data-testid="code-turn-retry"
                  disabled={props.isRetrying}
                  onClick={props.onRetry}
                  className="flex-shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm ring-1 ring-inset ring-red-200 hover:bg-red-50 disabled:opacity-60"
                >
                  {translator.translateText("Try again")}
                </button>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}

          {turn.state === CodeTaskState.Stopped ? (
            <div
              data-testid="code-turn-stopped"
              className="flex items-center gap-2 text-sm text-gray-500"
            >
              <Icon icon={IconProp.StopCircle} className="h-4 w-4" />
              <span>
                {turn.errorMessage ||
                  translator.translateText("Stopped before it finished.")}
              </span>
              {props.isLatest && props.onRetry ? (
                <button
                  type="button"
                  data-testid="code-turn-retry"
                  disabled={props.isRetrying}
                  onClick={props.onRetry}
                  className="ml-1 font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-60"
                >
                  {translator.translateText("Try again")}
                </button>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      {renderAsk()}
      {renderReply()}
    </>
  );
};

export default CodeTaskTurn;
