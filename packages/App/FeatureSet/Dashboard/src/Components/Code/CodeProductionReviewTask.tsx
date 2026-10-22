import { CodeTaskResponse } from "./CodeApi";
import { GitBranchMark } from "./CodeMarks";
import { getRepositoryFullName, getRepositoryRoute } from "./CodePaths";
import CodeProductionReview from "./CodeProductionReview";
import {
  PRODUCTION_REVIEW_COPY,
  getProductionReviewPostingSentence,
  getReviewedPullRequestNumber,
} from "./CodeProductionReviewCopy";
import CodeTaskStateBadge from "./CodeTaskStateBadge";
import CodeTimeAgo from "./CodeTimeAgo";
import { GitHubMark } from "./GitHubConnect";
import { CodeTaskState, CodeTaskTurnJSON } from "Common/Types/AI/CodeTask";
import URL from "Common/Types/API/URL";
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
  const title: string =
    data.task.title ||
    report?.pullRequest.title ||
    translator.translateTemplate(
      PRODUCTION_REVIEW_COPY.pullRequestFallbackTitle,
      {
        label: data.task.origin.label || "",
      },
    );

  const text: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
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
          <div className="min-w-0">
            <p className="font-medium">
              {text(PRODUCTION_REVIEW_COPY.failedTitle)}
            </p>
            {turn?.errorMessage ? (
              <p className="mt-0.5 break-words text-red-700">
                {turn.errorMessage}
              </p>
            ) : (
              <></>
            )}
          </div>
        </div>
      );
    }

    // Not reviewed this time, and why: closed, a draft, turned off.
    if (turn?.errorMessage) {
      return (
        <p
          data-testid="production-review-skipped"
          className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 sm:px-5"
        >
          <Icon
            icon={IconProp.InformationCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <span className="break-words">{turn.errorMessage}</span>
        </p>
      );
    }

    return <></>;
  };

  const renderFooter: () => ReactElement = (): ReactElement => {
    if (!data.repository || !data.repository.isConnected) {
      return (
        <p
          data-testid="production-review-not-connected"
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600"
        >
          {text(PRODUCTION_REVIEW_COPY.notConnected)}
        </p>
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

    return (
      <div
        data-testid="production-review-footer-bar"
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
      >
        <p className="min-w-0 flex-1 basis-56 text-sm text-gray-600">
          {data.repository.isProductionReviewEnabled
            ? text(PRODUCTION_REVIEW_COPY.updatesOnChange)
            : text(PRODUCTION_REVIEW_COPY.updatesWhenAsked)}
        </p>
        <button
          type="button"
          data-testid="production-review-again"
          disabled={isWorking || props.isAskingAgain}
          onClick={props.onReviewAgain}
          className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
        >
          <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
          {isWorking || props.isAskingAgain
            ? text(PRODUCTION_REVIEW_COPY.rowReviewing)
            : text(PRODUCTION_REVIEW_COPY.reviewAgain)}
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
                <GitHubMark className="h-4 w-4 flex-shrink-0" />
                {translator.translateTemplate("Pull request #{{number}}", {
                  number: pullRequestNumber.toString(),
                })}
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
                <GitHubMark className="h-4 w-4 flex-shrink-0" />
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
              className="font-mono text-xs"
            >
              {translator.translateTemplate(
                PRODUCTION_REVIEW_COPY.commitLabel,
                {
                  sha: ProductionReviewUtil.shortSha(
                    report.pullRequest.headSha,
                  ),
                },
              )}
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

        {report ? (
          <p
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
            <span>{text(getProductionReviewPostingSentence(report))}</span>
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
          </p>
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
        {report ? <CodeProductionReview report={report} /> : <></>}
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
