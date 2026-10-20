import PageComponentProps from "../PageComponentProps";
import CodeApi, {
  CodeRepositoriesResponse,
  CodeRepositoryListItem,
} from "../../Components/Code/CodeApi";
import { getRepositoryFullName } from "../../Components/Code/CodePaths";
import CodeRepositoryRow from "../../Components/Code/CodeRepositoryRow";
import { CODE_GITHUB_NOT_CONNECTED } from "../../Components/Code/CodeTaskCopy";
import {
  ConnectGitHubEmptyState,
  ConnectMoreRepositoriesButton,
  GitHubMark,
  useGitHubConnect,
  UseGitHubConnect,
} from "../../Components/Code/GitHubConnect";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

// A search box appears once there are more repositories than fit at a glance.
export const REPOSITORY_SEARCH_THRESHOLD: number = 6;

/*
 * The most recently active repositories first, then by name: what a person
 * opens a repository for is usually where work is happening.
 */
export const sortRepositories: (
  repositories: Array<CodeRepositoryListItem>,
) => Array<CodeRepositoryListItem> = (
  repositories: Array<CodeRepositoryListItem>,
): Array<CodeRepositoryListItem> => {
  return [...repositories].sort(
    (a: CodeRepositoryListItem, b: CodeRepositoryListItem): number => {
      const activityA: number = a.stats.lastActivityAt
        ? new Date(a.stats.lastActivityAt).getTime()
        : 0;
      const activityB: number = b.stats.lastActivityAt
        ? new Date(b.stats.lastActivityAt).getTime()
        : 0;

      if (activityA !== activityB) {
        return activityB - activityA;
      }

      return a.name.localeCompare(b.name);
    },
  );
};

// Whether a repository's name, organization/name or description holds the search.
export const matchesRepositorySearch: (
  repository: CodeRepositoryListItem,
  search: string,
) => boolean = (
  repository: CodeRepositoryListItem,
  search: string,
): boolean => {
  const needle: string = search.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return (
    repository.name.toLowerCase().includes(needle) ||
    getRepositoryFullName(repository).toLowerCase().includes(needle) ||
    (repository.description || "").toLowerCase().includes(needle)
  );
};

/*
 * Whether GitHub reaches none of the repositories - the project's GitHub
 * connection is gone: said once over the list, with Connect GitHub, rather
 * than on every row.
 */
export const isGitHubDisconnected: (
  repositories: Array<CodeRepositoryListItem>,
) => boolean = (repositories: Array<CodeRepositoryListItem>): boolean => {
  return (
    repositories.length > 0 &&
    repositories.every((repository: CodeRepositoryListItem): boolean => {
      return !repository.isConnected;
    })
  );
};

/*
 * Code's Repositories: the GitHub repositories connected to the project, as
 * a list - each with what needs someone, its tasks and when anything last
 * happened - and Connect repositories for more. A search box once there are
 * more than fit at a glance. With none yet, what Code is for and Connect
 * GitHub. Asking AI happens on Code's first page and on each repository's
 * page; this one is for finding a repository.
 */
const CodeRepositoriesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  const [data, setData] = useState<CodeRepositoriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>("");

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsLoading(true);

    try {
      setData(await CodeApi.getRepositories());
      setError(null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, []);

  const connection: UseGitHubConnect = useGitHubConnect({
    onConnected: () => {
      load().catch(() => {
        // handled inside load
      });
    },
  });

  useEffect(() => {
    load().catch(() => {
      // handled inside load
    });
  }, [load]);

  const renderBody: () => ReactElement = (): ReactElement => {
    if (isLoading && !data) {
      return (
        <div
          data-testid="code-repositories-loading"
          role="status"
          className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm"
        >
          <span className="sr-only">
            {translator.translateText("Loading…")}
          </span>
          {/* Rows in the making: a mark, a name, a line of facts. */}
          {[0, 1, 2].map((index: number) => {
            return (
              <div
                key={index}
                aria-hidden="true"
                className="flex items-center gap-3 px-4 py-3.5 sm:px-5"
              >
                <div className="h-9 w-9 flex-shrink-0 rounded-lg bg-gray-100 motion-safe:animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 rounded bg-gray-100 motion-safe:animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-gray-100 motion-safe:animate-pulse" />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

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

    if (!data || data.repositories.length === 0) {
      return <ConnectGitHubEmptyState connection={connection} />;
    }

    const isDisconnected: boolean = isGitHubDisconnected(data.repositories);
    const repositories: Array<CodeRepositoryListItem> = sortRepositories(
      data.repositories,
    ).filter((repository: CodeRepositoryListItem): boolean => {
      return matchesRepositorySearch(repository, search);
    });

    return (
      <div className="space-y-4">
        {isDisconnected ? (
          <div
            data-testid="code-github-disconnected"
            className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20"
          >
            <Icon
              icon={IconProp.LinkSlash}
              className="h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <p className="min-w-0 flex-1 leading-6">
              {translator.translateText(CODE_GITHUB_NOT_CONNECTED)}
            </p>
            {connection.isGitHubAppConfigured ? (
              connection.connectLock.isLocked ? (
                <p
                  data-testid="code-github-disconnected-lock"
                  className="w-full leading-6 text-amber-800"
                >
                  {connection.connectLock.reason}
                </p>
              ) : (
                <button
                  type="button"
                  data-testid="code-github-reconnect"
                  onClick={() => {
                    connection.connect();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <GitHubMark className="h-4 w-4" />
                  {translator.translateText("Connect GitHub")}
                </button>
              )
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <p
            data-testid="code-repositories-count"
            className="text-sm text-gray-500"
          >
            {translator.translatePlural(
              { one: "{{count}} repository", other: "{{count}} repositories" },
              data.repositories.length,
            )}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:w-full">
            {data.repositories.length > REPOSITORY_SEARCH_THRESHOLD ? (
              <div className="relative max-sm:w-full">
                <Icon
                  icon={IconProp.Search}
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="search"
                  data-testid="code-repository-search"
                  aria-label={translator.translateText("Find a repository")}
                  placeholder={translator.translateText("Find a repository")}
                  value={search}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    setSearch(event.target.value);
                  }}
                  className="w-56 rounded-md border border-gray-300 bg-white py-1 pl-8 pr-3 text-sm leading-5 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 max-sm:w-full"
                />
              </div>
            ) : (
              <></>
            )}
            {isDisconnected ? (
              <></>
            ) : (
              <ConnectMoreRepositoriesButton connection={connection} />
            )}
          </div>
        </div>

        {repositories.length > 0 ? (
          <ul
            data-testid="code-repositories"
            className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
          >
            {repositories.map((repository: CodeRepositoryListItem) => {
              return (
                <CodeRepositoryRow
                  key={repository.id}
                  repository={repository}
                  isNotConnectedSaid={isDisconnected}
                />
              );
            })}
          </ul>
        ) : (
          <p
            data-testid="code-repository-search-empty"
            className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500"
          >
            {translator.translateText("No repository matches your search.")}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {connection.notices}
      {renderBody()}
    </div>
  );
};

export default CodeRepositoriesPage;
