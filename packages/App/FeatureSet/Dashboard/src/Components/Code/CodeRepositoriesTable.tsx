import { CodeRepositoryListItem } from "./CodeApi";
import { GitPullRequestMark } from "./CodeMarks";
import { getRepositoryFullName, getRepositoryRoute } from "./CodePaths";
import {
  getRepositoriesPage,
  REPOSITORIES_PAGE_SIZE,
} from "./CodeRepositoriesList";
import CodeTimeAgo from "./CodeTimeAgo";
import { GitHubMark } from "./GitHubConnect";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Link from "Common/UI/Components/Link/Link";
import Table from "Common/UI/Components/Table/Table";
import { TableEmptyStateProps } from "Common/UI/Components/Table/TableEmptyState";
import {
  isNewTabClick,
  isRowOpeningClick,
} from "Common/UI/Components/Table/RowClick";
import Columns from "Common/UI/Components/Table/Types/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A list of a project's repositories in Code, drawn as every list in
 * OneUptime is drawn: the shared Table, inside a card - its header row, its
 * rows, a phone's cards, its footer and pages. Each row is one repository:
 *
 *   Repository     the GitHub mark, its name and GitHub's organization/name,
 *                  its description under them;
 *   Tasks          how many, and its open pull requests - with what needs
 *                  someone (AI at work, a question waiting) under them;
 *   Last Activity  when anything last happened in it.
 *
 * A click anywhere on a row opens the repository, as a row opens its record
 * everywhere (RowClick: Cmd/Ctrl/Shift or the middle button in a new tab);
 * its name is a link too, for the keyboard.
 */

export interface ComponentProps {
  id: string;
  // The repositories to list, in order. The table pages through them.
  repositories: Array<CodeRepositoryListItem>;
  // What the table shows with none to list.
  emptyState?: TableEmptyStateProps | undefined;
  // A repository GitHub does not reach is drawn quieter: its mark grey.
  isNotConnected?: boolean | undefined;
  // The list is on its way: the table's own rows in the making.
  isLoading?: boolean | undefined;
}

export const CODE_REPOSITORY_ROW_TEST_ID: string = "code-repository-row";

/*
 * The facts of one repository's Tasks cell, as text: how many tasks, its
 * open pull requests, and what needs someone. React-free words, so the
 * cell and the tests read the same.
 */
export const getRepositoryTaskWords: (
  repository: CodeRepositoryListItem,
  translator: Translator,
) => {
  tasks: string;
  pullRequests: string | null;
  working: string | null;
  waiting: string | null;
} = (
  repository: CodeRepositoryListItem,
  translator: Translator,
): {
  tasks: string;
  pullRequests: string | null;
  working: string | null;
  waiting: string | null;
} => {
  const stats: CodeRepositoryListItem["stats"] = repository.stats;

  return {
    tasks:
      stats.taskCount > 0
        ? translator.translatePlural(
            { one: "{{count}} task", other: "{{count}} tasks" },
            stats.taskCount,
          )
        : translator.translateTemplate("No tasks yet"),
    pullRequests:
      stats.openPullRequests > 0
        ? translator.translatePlural(
            {
              one: "{{count}} open pull request",
              other: "{{count}} open pull requests",
            },
            stats.openPullRequests,
          )
        : null,
    working:
      stats.working > 0
        ? translator.translatePlural(
            { one: "{{count}} working", other: "{{count}} working" },
            stats.working,
          )
        : null,
    waiting:
      stats.waitingForYou > 0
        ? translator.translatePlural(
            {
              one: "{{count}} waiting for you",
              other: "{{count}} waiting for you",
            },
            stats.waitingForYou,
          )
        : null,
  };
};

const CodeRepositoriesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(REPOSITORIES_PAGE_SIZE);

  // A search that changes the list starts it from its first page.
  const listKey: string = props.repositories
    .map((repository: CodeRepositoryListItem): string => {
      return repository.id;
    })
    .join(",");

  useEffect(() => {
    setPageNumber(1);
  }, [listKey]);

  const page: { items: Array<CodeRepositoryListItem>; pageNumber: number } =
    getRepositoriesPage({
      repositories: props.repositories,
      pageNumber,
      pageSize,
    });

  const columns: Columns<CodeRepositoryListItem> = [
    {
      title: "Repository",
      type: FieldType.Element,
      key: "name",
      disableSort: true,
      /*
       * Room for a repository's name with GitHub's organization/name beside
       * it and its description under them; past it, they are cut short.
       */
      contentClassName: "max-w-[28rem]",
      getElement: (repository: CodeRepositoryListItem): ReactElement => {
        const fullName: string = getRepositoryFullName(repository);

        return (
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md ${
                props.isNotConnected
                  ? "bg-gray-100 text-gray-500"
                  : "bg-gray-900 text-white"
              }`}
            >
              <GitHubMark className="h-4 w-4" />
            </span>
            <span className="block min-w-0">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <Link
                  to={getRepositoryRoute(repository.id)}
                  dataTestId="code-repository-name"
                  className="truncate font-medium text-gray-900 hover:text-indigo-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                >
                  <>{repository.name}</>
                </Link>
                {fullName && fullName !== repository.name ? (
                  <span
                    data-testid="code-repository-full-name"
                    className="truncate text-xs text-gray-500"
                  >
                    {fullName}
                  </span>
                ) : (
                  <></>
                )}
              </span>
              {repository.description ? (
                <span
                  data-testid="code-repository-row-description"
                  className="block max-w-md truncate text-sm text-gray-500"
                >
                  {repository.description}
                </span>
              ) : (
                <></>
              )}
            </span>
          </div>
        );
      },
    },
    {
      title: "Tasks",
      type: FieldType.Element,
      key: "stats",
      disableSort: true,
      getElement: (repository: CodeRepositoryListItem): ReactElement => {
        const words: {
          tasks: string;
          pullRequests: string | null;
          working: string | null;
          waiting: string | null;
        } = getRepositoryTaskWords(repository, translator);

        return (
          <div data-testid="code-repository-stats" className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-700">
              <span data-testid="code-repository-task-count">
                {words.tasks}
              </span>
              {words.pullRequests ? (
                <span
                  data-testid="code-repository-pull-requests"
                  className="inline-flex items-center gap-1 text-gray-500"
                >
                  <GitPullRequestMark className="h-3.5 w-3.5 flex-none text-gray-400" />
                  {words.pullRequests}
                </span>
              ) : (
                <></>
              )}
            </span>
            {words.working || words.waiting ? (
              <span
                data-testid="code-repository-attention"
                className="mt-1 flex flex-wrap items-center gap-1.5"
              >
                {words.working ? (
                  <span
                    data-testid="code-repository-working"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                    {words.working}
                  </span>
                ) : (
                  <></>
                )}
                {words.waiting ? (
                  <span
                    data-testid="code-repository-waiting"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    {words.waiting}
                  </span>
                ) : (
                  <></>
                )}
              </span>
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      title: "Last Activity",
      type: FieldType.Element,
      key: "id",
      disableSort: true,
      getElement: (repository: CodeRepositoryListItem): ReactElement => {
        if (!repository.stats.lastActivityAt) {
          // The table's quiet dash: nothing has happened in it yet.
          return <>—</>;
        }

        return (
          <CodeTimeAgo
            date={repository.stats.lastActivityAt}
            className="text-sm text-gray-700"
          />
        );
      },
    },
  ];

  return (
    <Table<CodeRepositoryListItem>
      id={props.id}
      data={page.items}
      columns={columns}
      getRowProps={(
        repository: CodeRepositoryListItem,
      ): React.HTMLAttributes<HTMLElement> => {
        const rowProps: React.HTMLAttributes<HTMLElement> & {
          "data-testid": string;
          "data-repository-id": string;
          "data-row-opens-record": string;
        } = {
          "data-testid": CODE_REPOSITORY_ROW_TEST_ID,
          "data-repository-id": repository.id,
          "data-row-opens-record": "true",
          onClick: (event: React.MouseEvent<HTMLElement>): void => {
            if (!isRowOpeningClick(event)) {
              return;
            }

            Navigation.navigate(getRepositoryRoute(repository.id), {
              openInNewTab: isNewTabClick(event),
            });
          },
          onAuxClick: (event: React.MouseEvent<HTMLElement>): void => {
            if (!isRowOpeningClick(event)) {
              return;
            }

            Navigation.navigate(getRepositoryRoute(repository.id), {
              openInNewTab: true,
            });
          },
        };

        return rowProps;
      }}
      isLoading={Boolean(props.isLoading)}
      error=""
      singularLabel="Repository"
      pluralLabel="Repositories"
      currentPageNumber={page.pageNumber}
      totalItemsCount={props.repositories.length}
      itemsOnPage={pageSize}
      onNavigateToPage={(nextPage: number, itemsOnPage: number): void => {
        setPageNumber(nextPage);

        if (itemsOnPage > 0) {
          setPageSize(itemsOnPage);
        }
      }}
      sortBy={null}
      sortOrder={SortOrder.Descending}
      onSortChanged={(): void => {
        // The most recently active first: there is nothing else to sort by.
      }}
      emptyStateProps={props.emptyState}
    />
  );
};

export default CodeRepositoriesTable;
