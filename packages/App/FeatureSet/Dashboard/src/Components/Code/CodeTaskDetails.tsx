import FixProductionVerdict from "../AI/FixProductionVerdict";
import { CodeTaskResponse } from "./CodeApi";
import CodeDiffStat from "./CodeDiffStat";
import CodeHostMark from "./CodeHostMark";
import {
  CodePullRequestCopy,
  getPullRequestCopy,
  opensPullRequests,
} from "./CodeHostCopy";
import { GitBranchMark } from "./CodeMarks";
import { getRepositoryFullName, getRepositoryRoute } from "./CodePaths";
import { CODE_TASK_ORIGIN_KINDS } from "./CodeTaskCopy";
import { CodeTaskOriginLabel, PersonMark } from "./CodeTaskTurn";
import CodeTaskWorkTime from "./CodeTaskWorkTime";
import CodeTimeAgo from "./CodeTimeAgo";
import URL from "Common/Types/API/URL";
import {
  CodeTaskOriginType,
  CodeTaskPullRequestJSON,
  CodeTaskTurnJSON,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const CODE_TASK_DETAILS_TEST_ID: string = "code-task-details";

/*
 * Beside the conversation on a wide screen, as an issue tracker's side
 * panel is: what a person looks for at a glance, each fact under its name.
 * The header's line of facts says the same on a narrower screen, where
 * there is no room beside the conversation, so each is said once at any
 * width.
 */
export const CODE_TASK_DETAILS_CLASS_NAME: string = "hidden xl:block";

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
 * The facts a task's Details lists, in order, by the name each is listed
 * under: who started it and from what, where it works, what it changed,
 * and when. A fact the task does not have yet is left out, except its pull
 * request, which says "None yet" where one is coming.
 */
export interface CodeTaskDetailFact {
  key: string;
  title: string;
}

export const getCodeTaskDetailFacts: (
  data: Pick<CodeTaskResponse, "task" | "turns" | "repository"> & {
    turnsNotShown?: CodeTaskResponse["turnsNotShown"];
  },
) => Array<CodeTaskDetailFact> = (
  data: Pick<CodeTaskResponse, "task" | "turns" | "repository"> & {
    turnsNotShown?: CodeTaskResponse["turnsNotShown"];
  },
): Array<CodeTaskDetailFact> => {
  const facts: Array<CodeTaskDetailFact> = [
    { key: "startedBy", title: translationKey("Started by") },
  ];

  if (CODE_TASK_ORIGIN_KINDS[data.task.origin.type] && data.task.origin.label) {
    facts.push({ key: "startedFrom", title: translationKey("Started from") });
  }

  if (data.repository) {
    facts.push({ key: "repository", title: translationKey("Repository") });

    if (getTaskBaseBranch(data)) {
      facts.push({ key: "branch", title: translationKey("Branch") });
    }
  }

  if (
    data.task.pullRequest?.url ||
    (data.repository && opensPullRequests(data.repository.provider))
  ) {
    facts.push({
      key: "pullRequest",
      title: getPullRequestCopy(data.repository?.provider).name,
    });
  }

  if (data.task.changes) {
    facts.push({ key: "changes", title: translationKey("Changes") });
  }

  if (
    (data.turnsNotShown?.workMilliseconds || 0) > 0 ||
    data.turns.some((turn: CodeTaskTurnJSON): boolean => {
      return Boolean(turn.startedAt);
    })
  ) {
    facts.push({ key: "timeWorked", title: translationKey("Time worked") });
  }

  facts.push({ key: "created", title: translationKey("Created") });

  if (data.task.lastActivityAt) {
    facts.push({ key: "lastActivity", title: translationKey("Last activity") });
  }

  return facts;
};

export interface ComponentProps {
  data: CodeTaskResponse;
}

const OneUptimeMark: FunctionComponent = (): ReactElement => {
  return (
    <div
      aria-hidden="true"
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-white"
    >
      <Icon icon={IconProp.Bolt} className="h-3 w-3" />
    </div>
  );
};

const CodeTaskDetails: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const data: CodeTaskResponse = props.data;
  const task: CodeTaskResponse["task"] = data.task;
  const provider: string | undefined = data.repository?.provider;
  const hostProduct: string | undefined =
    data.repository?.connection?.hostProduct;
  const pullRequestCopy: CodePullRequestCopy = getPullRequestCopy(provider);
  const pullRequest: CodeTaskPullRequestJSON | undefined = task.pullRequest;

  // Who asked: the person, or OneUptime for a task it started itself.
  const personName: string =
    task.requestedBy?.name ||
    (task.origin.type === CodeTaskOriginType.Request ? task.origin.label : "");

  const renderFact: (key: string) => ReactElement = (
    key: string,
  ): ReactElement => {
    switch (key) {
      case "startedBy":
        return personName ? (
          <span className="flex min-w-0 items-center gap-2">
            <PersonMark
              name={personName}
              seed={task.requestedBy?.id || personName}
            />
            <span className="truncate">{personName}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <OneUptimeMark />
            {translator.translateText("OneUptime")}
          </span>
        );
      case "startedFrom":
        return (
          <span className="block min-w-0">
            <span className="block text-xs text-gray-500">
              {translator.translateText(
                CODE_TASK_ORIGIN_KINDS[task.origin.type],
              )}
            </span>
            <CodeTaskOriginLabel
              origin={task.origin}
              className="line-clamp-3 break-words"
              dataTestId="code-task-details-origin"
            />
          </span>
        );
      case "repository":
        return data.repository ? (
          <Link
            to={getRepositoryRoute(data.repository.id)}
            dataTestId="code-task-details-repository"
            className="flex min-w-0 items-center gap-1.5 hover:text-indigo-600"
          >
            <>
              <span className="inline-flex flex-shrink-0">
                <CodeHostMark
                  provider={provider}
                  hostProduct={hostProduct}
                  className="h-4 w-4"
                />
              </span>
              <span className="truncate">
                {getRepositoryFullName(data.repository) || data.repository.name}
              </span>
            </>
          </Link>
        ) : (
          <></>
        );
      case "branch":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranchMark className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
            <span className="truncate font-mono text-xs">
              {getTaskBaseBranch(data)}
            </span>
          </span>
        );
      case "pullRequest":
        return pullRequest?.url ? (
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to={URL.fromString(pullRequest.url)}
              openInNewTab={true}
              dataTestId="code-task-details-pull-request"
              className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-500"
            >
              <>
                {translator.translateTemplate(pullRequestCopy.title, {
                  number: pullRequest.number?.toString() || "",
                })}
                <Icon
                  icon={IconProp.ExternalLink}
                  className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                />
              </>
            </Link>
            <span
              data-testid="code-task-details-pull-request-state"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                pullRequest.state === "merged"
                  ? "bg-violet-50 text-violet-700"
                  : pullRequest.state === "closed"
                    ? "bg-gray-100 text-gray-600"
                    : "bg-green-50 text-green-700"
              }`}
            >
              {pullRequest.state === "merged"
                ? translator.translateText("Merged")
                : pullRequest.state === "closed"
                  ? translator.translateText("Closed")
                  : translator.translateText("Open")}
            </span>
            {pullRequest.production ? (
              <FixProductionVerdict
                production={pullRequest.production}
                isCompact={true}
                testId="code-task-details-production"
              />
            ) : (
              <></>
            )}
          </span>
        ) : (
          <span className="text-gray-500">
            {translator.translateText("None yet")}
          </span>
        );
      case "changes":
        return task.changes ? (
          <span className="flex flex-wrap items-center gap-2">
            {translator.translatePlural(
              {
                one: "{{count}} file changed",
                other: "{{count}} files changed",
              },
              task.changes.files,
            )}
            <CodeDiffStat
              changes={task.changes}
              dataTestId="code-task-details-changes-stat"
            />
          </span>
        ) : (
          <></>
        );
      case "timeWorked":
        return (
          <CodeTaskWorkTime
            turns={data.turns}
            notShownMilliseconds={data.turnsNotShown?.workMilliseconds}
            isDurationOnly={true}
            dataTestId="code-task-details-work-time"
          />
        );
      case "created":
        return <CodeTimeAgo date={task.createdAt} />;
      case "lastActivity":
        return <CodeTimeAgo date={task.lastActivityAt} />;
      default:
        return <></>;
    }
  };

  return (
    <aside
      data-testid={CODE_TASK_DETAILS_TEST_ID}
      aria-labelledby="code-task-details-title"
      className={CODE_TASK_DETAILS_CLASS_NAME}
    >
      <div className="sticky top-6 rounded-2xl border border-gray-200 bg-white px-5 py-4">
        <h2
          id="code-task-details-title"
          className="text-sm font-semibold text-gray-900"
        >
          {translator.translateText("Details")}
        </h2>
        <dl className="mt-3 space-y-4 text-sm">
          {getCodeTaskDetailFacts(data).map(
            (fact: CodeTaskDetailFact): ReactElement => {
              return (
                <div
                  key={fact.key}
                  data-testid={`code-task-detail-${fact.key}`}
                  className="min-w-0"
                >
                  <dt className="text-xs font-medium text-gray-500">
                    {translator.translateText(fact.title)}
                  </dt>
                  <dd className="mt-1 min-w-0 text-gray-900">
                    {renderFact(fact.key)}
                  </dd>
                </div>
              );
            },
          )}
        </dl>
      </div>
    </aside>
  );
};

export default CodeTaskDetails;
