import { CodeTaskResponse } from "./CodeApi";
import { getCodeHostName, getPullRequestCopy } from "./CodeHostCopy";
import CodeHostMark from "./CodeHostMark";
import { GitBranchMark } from "./CodeMarks";
import {
  getRepositoryFullName,
  getRepositoryRoute,
  getRepositorySettingsRoute,
} from "./CodePaths";
import { CodeRepositorySetting } from "./CodeRepositorySettingsCopy";
import CodeProductionReview from "./CodeProductionReview";
import {
  PRODUCTION_REVIEW_COPY,
  ProductionReviewReconnect,
  getProductionReviewPostingSentence,
  getProductionReviewReconnect,
  getReviewedPullRequestNumber,
  inReviewHostWords,
} from "./CodeProductionReviewCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import CodeTaskStateBadge from "./CodeTaskStateBadge";
import CodeTimeAgo from "./CodeTimeAgo";
import { CodeTaskState, CodeTaskTurnJSON } from "Common/Types/AI/CodeTask";
import URL from "Common/Types/API/URL";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import {
  ProductionReviewPosting,
  ProductionReviewReport,
  ProductionReviewUtil,
} from "Common/Types/CodeRepository/ProductionReview";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A pull request's production review, on its page in Code. A review is not
 * a conversation: OneUptime reviews the pull request again in place when it
 * changes (or when someone asks), so the page is the latest review - what
 * it is of and where it was posted at the top, the review itself, and
 * Review again at the bottom, where a task's reply box would be.
 *
 * While a review runs, the one before it stays on screen under a line that
 * says it is being reviewed again. A review that could not finish says why;
 * one that was not done (the pull request was closed, or a draft) says so.
 *
 * Every word is the repository's host's: a GitLab merge request is "Merge
 * request !12", with GitLab's mark, and so on (inReviewHostWords).
 */

export interface ComponentProps {
  data: CodeTaskResponse;
  onReviewAgain: () => void;
  // A Review again on its way to the server.
  isAskingAgain: boolean;
  // Why the last Review again was refused.
  actionError?: string | null | undefined;
  // Drawn under the footer's box: where the page keeps it sticky.
  footerStyle?: React.CSSProperties | undefined;
  fadeStyle?: React.CSSProperties | undefined;
}

/*
 * When the pull request is reviewed again, as its comment says it: on every
 * change while the repository's switch is on and its author can write to
 * the repository - otherwise only when someone asks. Null before its first
 * review is in: whether its author can write is what the review reads, and
 * a pull request asked for from a fork (Review a pull request) is not
 * reviewed again on its own - so nothing is promised until it is known.
 */
export function getProductionReviewUpdatesSentence(data: {
  data: Pick<CodeTaskResponse, "repository">;
  report: ProductionReviewReport | null;
}): string | null {
  if (!data.data.repository?.isProductionReviewEnabled) {
    return PRODUCTION_REVIEW_COPY.updatesWhenAsked;
  }

  if (!data.report) {
    return null;
  }

  if (data.report.pullRequest.isAuthorTrusted === false) {
    return PRODUCTION_REVIEW_COPY.updatesWhenAskedForAuthor;
  }

  return PRODUCTION_REVIEW_COPY.updatesOnChange;
}

// The latest review the task holds, from its own turn.
export function getLatestProductionReview(
  turns: Array<CodeTaskTurnJSON>,
): ProductionReviewReport | null {
  for (let index: number = turns.length - 1; index >= 0; index--) {
    const review: ProductionReviewReport | undefined =
      turns[index]?.outcome?.productionReview;

    if (review) {
      return review;
    }
  }

  return null;
}

const CodeProductionReviewTask: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const data: CodeTaskResponse = props.data;
  const turn: CodeTaskTurnJSON | undefined = data.turns[data.turns.length - 1];
  const report: ProductionReviewReport | null = getLatestProductionReview(
    data.turns,
  );
  const isWorking: boolean = data.task.state === CodeTaskState.Working;
  const isQueued: boolean = isWorking && data.task.isQueued;
  const reviewedNumber: number | null = getReviewedPullRequestNumber(
    data.task.origin,
  );
  const pullRequestUrl: string =
    report?.pullRequest.url || data.task.origin.url || "";
  const pullRequestNumber: number | null =
    report?.pullRequest.number || reviewedNumber;
  // Where the repository is hosted: its mark, and its words.
  const provider: string | undefined = data.repository?.provider;
  const hostProduct: string | undefined =
    data.repository?.connection?.hostProduct;
  const isOnGitHub: boolean =
    CodeHost.readType(provider) === CodeRepositoryType.GitHub;
  const hostName: string = getCodeHostName({ provider, hostProduct });
  const title: string =
    data.task.title ||
    report?.pullRequest.title ||
    translator.translateTemplate(
      inReviewHostWords(
        PRODUCTION_REVIEW_COPY.pullRequestFallbackTitle,
        provider,
      ),
      {
        label: data.task.origin.label || "",
      },
    );

  const text: (key: string) => string = (key: string): string => {
    const sentence: string = inReviewHostWords(key, provider);

    return translator.translateText(sentence) || sentence;
  };

  const renderStatus: () => ReactElement = (): ReactElement => {
    if (isWorking) {
      return (
        <div
          role="status"
          data-testid="production-review-working"
          className="flex items-start gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm sm:px-5"
        >
          <span className="mt-1 h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 motion-safe:animate-spin" />
          <span>
            {isQueued
              ? text(PRODUCTION_REVIEW_COPY.queued)
              : report
                ? text(PRODUCTION_REVIEW_COPY.reviewingAgain)
                : text(PRODUCTION_REVIEW_COPY.reviewing)}
          </span>
        </div>
      );
    }

    /*
     * Failed: the server's sentence says it all - that it could not finish
     * and what starts a new one - so it is the only line; one with no
     * sentence says that it could not finish.
     */
    if (data.task.state === CodeTaskState.Failed) {
      return (
        <div
          data-testid="production-review-failed"
          className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 sm:px-5"
        >
          <Icon
            icon={IconProp.ExclaimationCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600"
          />
          <p className="min-w-0 break-words">
            {turn?.errorMessage || text(PRODUCTION_REVIEW_COPY.failedTitle)}
          </p>
        </div>
      );
    }

    // Not reviewed this time, and why: closed, a draft, turned off.
    if (turn?.errorMessage) {
      return (
        <div
          data-testid="production-review-skipped"
          className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 sm:px-5"
        >
          <Icon
            icon={IconProp.InformationCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <p className="min-w-0 break-words">{turn.errorMessage}</p>
        </div>
      );
    }

    return <></>;
  };

  const renderFooter: () => ReactElement = (): ReactElement => {
    if (!data.repository || !data.repository.isConnected) {
      /*
       * With the one fix beside it, as the repository's Production Reviews
       * say it: Connect GitHub, Replace access token or Go to Settings.
       */
      const reconnect: ProductionReviewReconnect | null = data.repository
        ? getProductionReviewReconnect(data.repository)
        : null;
      const reconnectRoute: Route | null =
        data.repository && reconnect
          ? reconnect.place === "repositories"
            ? RouteUtil.populateRouteParams(
                RouteMap[PageMap.CODE_REPOSITORIES] as Route,
              )
            : getRepositorySettingsRoute(data.repository.id)
          : null;

      return (
        <div
          data-testid="production-review-not-connected"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600"
        >
          <p className="min-w-0 flex-1 basis-56">
            {data.repository && !isOnGitHub
              ? translator.translateTemplate(
                  inReviewHostWords(
                    PRODUCTION_REVIEW_COPY.notConnectedHost,
                    provider,
                  ),
                  { host: hostName },
                )
              : text(PRODUCTION_REVIEW_COPY.notConnected)}
          </p>
          {reconnect && reconnectRoute ? (
            <Link
              to={reconnectRoute}
              dataTestId="production-review-reconnect"
              className="flex-shrink-0 font-medium text-indigo-600 hover:text-indigo-500"
            >
              <>{translator.translateText(reconnect.title)}</>
            </Link>
          ) : (
            <></>
          )}
        </div>
      );
    }

    if (!data.canAsk) {
      return (
        <p
          data-testid="production-review-read-only"
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600"
        >
          {text(PRODUCTION_REVIEW_COPY.cannotReviewAgain)}
        </p>
      );
    }

    /*
     * A first review on its way - just asked for, from Review a pull
     * request - has nothing to ask again yet: the line above says when it
     * starts, and the bar comes with the review.
     */
    if (!report && isWorking) {
      return <></>;
    }

    const updates: string | null = getProductionReviewUpdatesSentence({
      data,
      report,
    });

    return (
      <div
        data-testid="production-review-footer-bar"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
      >
        {updates ? (
          <p
            data-testid="production-review-updates"
            className="min-w-0 flex-1 basis-56 text-sm text-gray-600"
          >
            {text(updates)}
          </p>
        ) : (
          <></>
        )}
        {/*
         * Waits while a review is asked for or runs - the line above the
         * review says which - so it is never pressed twice for one push.
         * Alone in the bar (a first review that could not finish), at its
         * end, where it sits beside the sentence.
         */}
        <button
          type="button"
          data-testid="production-review-again"
          disabled={isWorking || props.isAskingAgain}
          onClick={props.onReviewAgain}
          className={`${
            updates ? "" : "ml-auto "
          }inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          {text(PRODUCTION_REVIEW_COPY.reviewAgain)}
        </button>
      </div>
    );
  };

  return (
    <>
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
              <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                {text(PRODUCTION_REVIEW_COPY.recipeLabel)}
              </span>
            </div>
            <h1
              data-testid="code-task-title"
              className="mt-2 break-words text-xl font-semibold leading-7 text-gray-900"
            >
              {title}
            </h1>
          </div>

          {pullRequestUrl && pullRequestNumber ? (
            <Link
              to={URL.fromString(pullRequestUrl)}
              openInNewTab={true}
              dataTestId="production-review-pull-request"
              className="inline-flex h-9 flex-shrink-0 items-center gap-2 rounded-lg bg-white px-3 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <>
                <CodeHostMark
                  provider={provider}
                  hostProduct={hostProduct}
                  className="h-4 w-4 flex-shrink-0"
                />
                {translator.translateTemplate(
                  getPullRequestCopy(provider).title,
                  {
                    number: pullRequestNumber.toString(),
                  },
                )}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                />
              </>
            </Link>
          ) : (
            <></>
          )}
        </div>

        {/*
         * What was reviewed: the repository, the branch the pull request
         * goes into, the commit, and when - then what the pull request
         * shows of the review.
         */}
        <div
          data-testid="code-task-facts"
          className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-gray-500"
        >
          {data.repository ? (
            <Link
              to={getRepositoryRoute(data.repository.id)}
              dataTestId="code-task-repository"
              className="inline-flex min-w-0 items-center gap-1.5 hover:text-indigo-600"
            >
              <>
                <CodeHostMark
                  provider={provider}
                  hostProduct={hostProduct}
                  className="h-4 w-4 flex-shrink-0"
                />
                <span className="truncate">
                  {getRepositoryFullName(data.repository) ||
                    data.repository.name}
                </span>
              </>
            </Link>
          ) : (
            <></>
          )}
          {report?.pullRequest.baseRefName ? (
            <span
              data-testid="production-review-base-branch"
              className="inline-flex min-w-0 items-center gap-1"
            >
              <GitBranchMark className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <span className="truncate font-mono text-xs">
                {report.pullRequest.baseRefName}
              </span>
            </span>
          ) : (
            <></>
          )}
          {report?.pullRequest.headSha ? (
            <span
              data-testid="production-review-commit"
              title={report.pullRequest.headSha}
            >
              <TranslatedSentence
                template={PRODUCTION_REVIEW_COPY.commitLabel}
                slots={{
                  sha: (
                    <span className="font-mono text-xs">
                      {ProductionReviewUtil.shortSha(
                        report.pullRequest.headSha,
                      )}
                    </span>
                  ),
                }}
              />
            </span>
          ) : (
            <></>
          )}
          {report ? (
            <span data-testid="production-review-reviewed-at">
              <TranslatedSentence
                template={PRODUCTION_REVIEW_COPY.reviewedAt}
                slots={{ time: <CodeTimeAgo date={report.reviewedAt} /> }}
              />
            </span>
          ) : (
            <></>
          )}
        </div>

        {/*
         * The host would not let the access token comment (a Forgejo or
         * Gitea token without write access to issues, a locked
         * discussion): the review is only here - said in place of where it
         * was posted, with what lets it comment and where that is done.
         */}
        {report?.isCommentRefused ? (
          <div
            data-testid="production-review-comment-refused"
            className="mt-3 flex items-start gap-2 text-sm text-amber-800"
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
            />
            <p className="min-w-0 break-words">
              {translator.translateTemplate(
                inReviewHostWords(
                  PRODUCTION_REVIEW_COPY.commentRefused,
                  provider,
                ),
                { host: hostName },
              )}
              {CodeHost.readType(provider) === CodeRepositoryType.Forgejo ? (
                <> {text(PRODUCTION_REVIEW_COPY.commentRefusedIssues)}</>
              ) : (
                <></>
              )}
              {data.repository && data.canAsk ? (
                <>
                  {" "}
                  <Link
                    to={getRepositorySettingsRoute(data.repository.id)}
                    dataTestId="production-review-comment-refused-settings"
                    className="font-medium text-amber-900 underline hover:text-amber-700"
                  >
                    <>{text(PRODUCTION_REVIEW_COPY.goToSettings)}</>
                  </Link>
                </>
              ) : (
                <></>
              )}
            </p>
          </div>
        ) : report ? (
          <div
            data-testid="production-review-posting"
            data-posting={report.posting}
            className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600"
          >
            <Icon
              icon={
                report.posting === ProductionReviewPosting.None
                  ? IconProp.EyeSlash
                  : IconProp.ChatBubbleLeft
              }
              className="h-4 w-4 flex-shrink-0 text-gray-400"
            />
            <span>
              {text(getProductionReviewPostingSentence(report, provider))}
            </span>
            {report.commentUrl &&
            report.posting !== ProductionReviewPosting.None ? (
              <Link
                to={URL.fromString(report.commentUrl)}
                openInNewTab={true}
                dataTestId="production-review-comment"
                className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500"
              >
                <>
                  {text(PRODUCTION_REVIEW_COPY.viewComment)}
                  <Icon icon={IconProp.ExternalLink} className="h-3.5 w-3.5" />
                </>
              </Link>
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}
      </header>

      {props.actionError ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700"
        >
          {props.actionError}
        </p>
      ) : (
        <></>
      )}

      <div className="mt-6 space-y-4">
        {renderStatus()}
        {report ? (
          <CodeProductionReview
            report={report}
            provider={provider}
            hostName={hostName}
            {...(data.repository && data.canAsk
              ? {
                  llmProviderSettingsRoute: getRepositorySettingsRoute(
                    data.repository.id,
                    CodeRepositorySetting.ProductionReviewLlmProvider,
                  ),
                }
              : {})}
          />
        ) : (
          <></>
        )}
      </div>

      <div
        data-testid="code-task-footer"
        className="sticky bottom-0 z-10 mt-8 pb-4"
        style={props.footerStyle}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-6 h-6"
          style={props.fadeStyle}
        />
        {renderFooter()}
      </div>
    </>
  );
};

export default CodeProductionReviewTask;
