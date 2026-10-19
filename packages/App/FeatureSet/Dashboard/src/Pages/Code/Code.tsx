import PageComponentProps from "../PageComponentProps";
import AIPlanGate, {
  isAIAccessibleOnCurrentPlan,
} from "../../Components/AI/AIPlanGate";
import CodeApi, {
  CodeRepositoriesResponse,
  CodeRepositoryListItem,
} from "../../Components/Code/CodeApi";
import CodeTaskList from "../../Components/Code/CodeTaskList";
import {
  ConnectGitHubEmptyState,
  ConnectMoreRepositoriesButton,
  useGitHubConnect,
  UseGitHubConnect,
} from "../../Components/Code/GitHubConnect";
import RepositoryCard, {
  getRepositoryFullName,
} from "../../Components/Code/RepositoryCard";
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
 * opens Code for is usually where work is happening.
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

// Whether a repository's name, or its organization/name, holds the search.
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
 * Code's first page: the project's repositories, each with what matters at
 * a glance, and the way to connect more. With none yet, the page is one
 * thing: what Code is for, and Connect GitHub. Tasks that never found a
 * repository (an exception fix that matched none) are listed under them,
 * so no task is out of reach.
 */
const CodePage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const isPlanAccessible: boolean = isAIAccessibleOnCurrentPlan();

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
    if (!isPlanAccessible) {
      setIsLoading(false);
      return;
    }

    load().catch(() => {
      // handled inside load
    });
  }, [load, isPlanAccessible]);

  const repositories: Array<CodeRepositoryListItem> = sortRepositories(
    data?.repositories || [],
  ).filter((repository: CodeRepositoryListItem): boolean => {
    return matchesRepositorySearch(repository, search);
  });

  const renderBody: () => ReactElement = (): ReactElement => {
    if (!isPlanAccessible) {
      return <></>;
    }

    if (isLoading && !data) {
      return (
        <div
          data-testid="code-repositories-loading"
          role="status"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <span className="sr-only">
            {translator.translateText("Loading…")}
          </span>
          {/* Cards shaped like the ones on their way: a mark, a name, a line of facts. */}
          {[0, 1, 2].map((index: number) => {
            return (
              <div
                key={index}
                aria-hidden="true"
                className="flex h-36 flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 flex-shrink-0 rounded-lg bg-gray-100 motion-safe:animate-pulse" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3.5 w-1/2 rounded bg-gray-100 motion-safe:animate-pulse" />
                    <div className="h-3 w-1/3 rounded bg-gray-100 motion-safe:animate-pulse" />
                  </div>
                </div>
                <div className="mt-auto h-3 w-2/3 rounded bg-gray-100 motion-safe:animate-pulse" />
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
      return (
        <div className="space-y-6">
          <ConnectGitHubEmptyState connection={connection} />
          {data && data.tasksWithoutRepositoryCount > 0 ? (
            <TasksWithoutRepository />
          ) : (
            <></>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <section aria-labelledby="code-repositories-heading">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2
              id="code-repositories-heading"
              className="text-base font-semibold text-gray-900"
            >
              {translator.translateText("Repositories")}
              <span className="ml-2 text-sm font-normal text-gray-500">
                {data.repositories.length}
              </span>
            </h2>
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
                    className="w-56 rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 max-sm:w-full"
                  />
                </div>
              ) : (
                <></>
              )}
              <ConnectMoreRepositoriesButton connection={connection} />
            </div>
          </div>

          {repositories.length > 0 ? (
            <ul
              data-testid="code-repositories"
              className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
            >
              {repositories.map((repository: CodeRepositoryListItem) => {
                return (
                  <li key={repository.id}>
                    <RepositoryCard repository={repository} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p
              data-testid="code-repository-search-empty"
              className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500"
            >
              {translator.translateText("No repository matches your search.")}
            </p>
          )}
        </section>

        {data.tasksWithoutRepositoryCount > 0 ? (
          <TasksWithoutRepository />
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <AIPlanGate />
      {connection.notices}
      {renderBody()}
    </div>
  );
};

/*
 * Tasks with no repository: fixes that never found one, and tasks whose
 * repository was removed. Kept on Code's first page, below the
 * repositories, so their outcome stays readable.
 */
const TasksWithoutRepository: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <section
      data-testid="code-tasks-without-repository"
      aria-labelledby="code-tasks-without-repository-heading"
      className="rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="border-b border-gray-100 px-4 py-3.5 sm:px-5">
        <h2
          id="code-tasks-without-repository-heading"
          className="text-base font-semibold text-gray-900"
        >
          {translator.translateText("Other tasks")}
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          {translator.translateText(
            "Tasks that are not linked to a repository: fixes that found none, and tasks whose repository was removed.",
          )}
        </p>
      </div>
      <CodeTaskList
        repositoryId={null}
        dataTestId="code-other-task-list"
        emptyState={<></>}
      />
    </section>
  );
};

export default CodePage;
