import { CodeRepositoryListItem } from "./CodeApi";
import { GitPullRequestMark } from "./CodeMarks";
import CodeMetaList from "./CodeMetaList";
import { getRepositoryFullName, getRepositoryRoute } from "./CodePaths";
import CodeTimeAgo from "./CodeTimeAgo";
import { GitHubMark } from "./GitHubConnect";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  repository: CodeRepositoryListItem;
  /*
   * The page already said, once, that GitHub reaches none of the
   * repositories: the row does not say it again.
   */
  isNotConnectedSaid?: boolean | undefined;
}

/*
 * One repository on Code's Repositories page, as a row: the GitHub mark, its
 * name with GitHub's organization/name, its description and, under them, a
 * quieter count of its tasks, its open pull requests and when anything last
 * happened - with what needs someone (AI at work, a question waiting, a
 * repository AI cannot reach) at the end of the row. The whole row opens
 * the repository.
 */
const CodeRepositoryRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const repository: CodeRepositoryListItem = props.repository;
  const fullName: string = getRepositoryFullName(repository);
  const stats: CodeRepositoryListItem["stats"] = repository.stats;
  const showNotConnected: boolean =
    !repository.isConnected && !props.isNotConnectedSaid;

  const facts: Array<ReactElement> = [
    <span key="tasks">
      {stats.taskCount > 0
        ? translator.translatePlural(
            { one: "{{count}} task", other: "{{count}} tasks" },
            stats.taskCount,
          )
        : translator.translateText("No tasks yet")}
    </span>,
  ];

  if (stats.openPullRequests > 0) {
    facts.push(
      <span key="pull-requests" className="inline-flex items-center gap-1">
        <GitPullRequestMark className="h-3 w-3 flex-shrink-0 text-gray-400" />
        {translator.translatePlural(
          {
            one: "{{count}} open pull request",
            other: "{{count}} open pull requests",
          },
          stats.openPullRequests,
        )}
      </span>,
    );
  }

  if (stats.lastActivityAt) {
    facts.push(<CodeTimeAgo key="time" date={stats.lastActivityAt} />);
  }

  const hasAttention: boolean =
    showNotConnected || stats.working > 0 || stats.waitingForYou > 0;

  return (
    <li data-testid="code-repository-row" data-repository-id={repository.id}>
      <Link
        to={getRepositoryRoute(repository.id)}
        dataTestId="code-repository-link"
        className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 sm:items-center sm:px-5"
      >
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
            repository.isConnected
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          <GitHubMark className="h-[18px] w-[18px]" />
        </div>

        {/*
         * The name has the line to itself, so no fact ever cuts it short:
         * its description and its quieter facts under it. What needs
         * someone sits at the end of the row from sm up, and between the
         * name and the facts on a phone.
         */}
        <div
          className={`grid min-w-0 flex-1 gap-y-1 ${
            hasAttention ? "sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4" : ""
          }`}
        >
          <div className="min-w-0">
            <p className="flex min-w-0 items-baseline gap-2">
              <span
                data-testid="code-repository-name"
                className="truncate text-sm font-semibold text-gray-900 group-hover:text-indigo-700"
              >
                {repository.name}
              </span>
              {fullName && fullName !== repository.name ? (
                <span className="truncate text-xs text-gray-500 max-sm:hidden">
                  {fullName}
                </span>
              ) : (
                <></>
              )}
            </p>
            {repository.description ? (
              <p
                data-testid="code-repository-row-description"
                className="mt-0.5 truncate text-sm text-gray-500"
              >
                {repository.description}
              </p>
            ) : (
              <></>
            )}
          </div>

          {hasAttention ? (
            <div
              data-testid="code-repository-attention"
              className="flex flex-wrap items-center gap-1.5 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-end"
            >
              {showNotConnected ? (
                <span
                  data-testid="code-repository-not-connected"
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"
                >
                  <Icon icon={IconProp.LinkSlash} className="h-3 w-3" />
                  {translator.translateText("Not connected")}
                </span>
              ) : (
                <></>
              )}
              {stats.working > 0 ? (
                <span
                  data-testid="code-repository-working"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  {translator.translatePlural(
                    { one: "{{count}} working", other: "{{count}} working" },
                    stats.working,
                  )}
                </span>
              ) : (
                <></>
              )}
              {stats.waitingForYou > 0 ? (
                <span
                  data-testid="code-repository-waiting"
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {translator.translatePlural(
                    {
                      one: "{{count}} waiting for you",
                      other: "{{count}} waiting for you",
                    },
                    stats.waitingForYou,
                  )}
                </span>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}

          <CodeMetaList
            dataTestId="code-repository-stats"
            className="text-xs text-gray-500 sm:col-start-1"
            items={facts}
          />
        </div>

        <Icon
          icon={IconProp.ChevronRight}
          className="mt-2.5 h-4 w-4 flex-shrink-0 text-gray-300 transition group-hover:text-indigo-500 sm:mt-0"
        />
      </Link>
    </li>
  );
};

export default CodeRepositoryRow;
