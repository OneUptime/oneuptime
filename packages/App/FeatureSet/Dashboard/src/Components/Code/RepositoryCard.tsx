import { CodeRepositoryListItem } from "./CodeApi";
import CodeTimeAgo from "./CodeTimeAgo";
import { GitHubMark } from "./GitHubConnect";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  repository: CodeRepositoryListItem;
}

// The repository's page in Code: its tasks and the request box.
export const getRepositoryRoute: (repositoryId: string) => Route = (
  repositoryId: string,
): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_REPOSITORY_VIEW] as Route,
    { modelId: new ObjectID(repositoryId) },
  );
};

// "acme/checkout-api", or nothing when it only repeats the name.
export const getRepositoryFullName: (
  repository: Pick<
    CodeRepositoryListItem,
    "name" | "organizationName" | "repositoryName"
  >,
) => string = (
  repository: Pick<
    CodeRepositoryListItem,
    "name" | "organizationName" | "repositoryName"
  >,
): string => {
  if (!repository.organizationName || !repository.repositoryName) {
    return "";
  }

  return `${repository.organizationName}/${repository.repositoryName}`;
};

/*
 * One repository on Code's first page: what it is, and what matters about
 * its tasks at a glance - how many AI is working on, how many wait for an
 * answer, its open pull requests from AI, and when anything last happened.
 * The whole card opens the repository.
 */
const RepositoryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const repository: CodeRepositoryListItem = props.repository;
  const fullName: string = getRepositoryFullName(repository);
  const stats: CodeRepositoryListItem["stats"] = repository.stats;

  return (
    <Link
      to={getRepositoryRoute(repository.id)}
      dataTestId="code-repository-card"
      className="group flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
          <GitHubMark className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gray-900 group-hover:text-indigo-700">
            {repository.name}
          </h3>
          {fullName && fullName !== repository.name ? (
            <p className="truncate text-xs text-gray-500">{fullName}</p>
          ) : (
            <></>
          )}
        </div>
        <Icon
          icon={IconProp.ChevronRight}
          className="mt-1 h-4 w-4 flex-shrink-0 text-gray-300 transition group-hover:text-indigo-500"
        />
      </div>

      {repository.description ? (
        <p className="mt-3 line-clamp-2 text-sm leading-5 text-gray-600">
          {repository.description}
        </p>
      ) : (
        <></>
      )}

      {/*
       * What needs someone first - AI at work, a question waiting - then a
       * quieter line: how many tasks, the open pull requests, and when
       * anything last happened. A repository AI cannot reach says so here,
       * where it takes no room from the name.
       */}
      <div className="mt-auto space-y-2 pt-4">
        {!repository.isConnected ||
        stats.working > 0 ||
        stats.waitingForYou > 0 ? (
          <div
            data-testid="code-repository-attention"
            className="flex flex-wrap items-center gap-1.5"
          >
            {repository.isConnected ? (
              <></>
            ) : (
              <span
                data-testid="code-repository-not-connected"
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"
              >
                <Icon icon={IconProp.LinkSlash} className="h-3 w-3" />
                {translator.translateText("Not connected")}
              </span>
            )}
            {stats.working > 0 ? (
              <span
                data-testid="code-repository-working"
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20"
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
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"
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

        <div
          data-testid="code-repository-stats"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500"
        >
          <span className="whitespace-nowrap">
            {stats.taskCount > 0
              ? translator.translatePlural(
                  { one: "{{count}} task", other: "{{count}} tasks" },
                  stats.taskCount,
                )
              : translator.translateText("No tasks yet")}
          </span>
          {stats.openPullRequests > 0 ? (
            <>
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Icon
                  icon={IconProp.GitHub}
                  className="h-3.5 w-3.5 text-gray-400"
                />
                {translator.translatePlural(
                  {
                    one: "{{count}} open pull request",
                    other: "{{count}} open pull requests",
                  },
                  stats.openPullRequests,
                )}
              </span>
            </>
          ) : (
            <></>
          )}
          {stats.lastActivityAt ? (
            <>
              <CodeTimeAgo
                date={stats.lastActivityAt}
                className="whitespace-nowrap"
              />
            </>
          ) : (
            <></>
          )}
        </div>
      </div>
    </Link>
  );
};

export default RepositoryCard;
