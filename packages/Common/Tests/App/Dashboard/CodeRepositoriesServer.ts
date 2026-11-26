import {
  CodeRepositoriesQuery,
  CodeRepositoriesResponse,
  CodeRepositoriesScope,
  CodeRepositoryListItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import {
  CodeRepositoryListFactsJSON,
  CodeRepositoryListGroup,
  CodeRepositoryListOrder,
  MAX_CODE_REPOSITORIES_PER_PAGE,
} from "../../../Types/AI/CodeTask";
import { CodeHost } from "../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { matchesCodeRepositorySearch } from "../../../Types/CodeRepository/CodeRepositorySearch";

/*
 * CODE'S REPOSITORIES, ANSWERED AS THE SERVER ANSWERS THEM (#10764).
 *
 * POST /code-task/repositories searches, groups, orders and pages every
 * repository the reader may read (CodeTaskRepositoryList), and
 * /code-task/repositories-by-id reads some by id. Component tests of Code's
 * pages and pickers stand CodeApi in with this: the reader's repositories,
 * all of them - 10,050 when a test wants a project past every cap - and each
 * read answered from them by the server's rules (the shared search rule,
 * those AI can work in first when both lists are asked for, by name or by
 * activity, a page at a time, with the facts of all of them). What the
 * server answers to the same reads on migrated Postgres is pinned in
 * Tests/Server/API/CodeRepositorySearchPostgres.
 *
 * A Fix with AI picker's read is held to what its fix accepts (#10921):
 * askableOnly leaves out a repository a test marks `canAsk: false`, and
 * codeReadableOnly one that is not connected or a test marks
 * `isCodeReadable: false` - before anything else is weighed, as the server
 * holds them (CodeTaskRepositoryList.keepHeldTo).
 */

/*
 * A repository as a test gives it: what the server answers, and - for a
 * read held to a scope - whether the reader may ask in it, and whether
 * OneUptime reads its code. Unmarked, both.
 */
export type FakeCodeRepository = CodeRepositoryListItem & {
  canAsk?: boolean | undefined;
  isCodeReadable?: boolean | undefined;
};

// Whether a read held to a scope keeps a repository, as the server judges it.
export const isInScope: (
  repository: FakeCodeRepository,
  scope: CodeRepositoriesScope | undefined,
) => boolean = (
  repository: FakeCodeRepository,
  scope: CodeRepositoriesScope | undefined,
): boolean => {
  if (scope?.askableOnly && repository.canAsk === false) {
    return false;
  }

  if (
    scope?.codeReadableOnly &&
    (!repository.isConnected || repository.isCodeReadable === false)
  ) {
    return false;
  }

  return true;
};

const timeOf: (repository: CodeRepositoryListItem) => number = (
  repository: CodeRepositoryListItem,
): number => {
  const time: number = repository.stats?.lastActivityAt
    ? new Date(repository.stats.lastActivityAt).getTime()
    : 0;

  return Number.isNaN(time) ? 0 : time;
};

const isOnGitHub: (repository: CodeRepositoryListItem) => boolean = (
  repository: CodeRepositoryListItem,
): boolean => {
  return CodeHost.readType(repository.provider) === CodeRepositoryType.GitHub;
};

export const getFactsOf: (
  repositories: Array<CodeRepositoryListItem>,
) => CodeRepositoryListFactsJSON = (
  repositories: Array<CodeRepositoryListItem>,
): CodeRepositoryListFactsJSON => {
  const notConnected: Array<CodeRepositoryListItem> = repositories.filter(
    (repository: CodeRepositoryListItem): boolean => {
      return !repository.isConnected;
    },
  );

  return {
    total: repositories.length,
    connected: repositories.length - notConnected.length,
    notConnected: notConnected.length,
    areAllOnGitHub: repositories.every(isOnGitHub),
    isAnyOnGitHub: repositories.some(isOnGitHub),
    areAllNotConnectedOnGitHub: notConnected.every(isOnGitHub),
    isAnyNotConnectedOnGitHub: notConnected.some(isOnGitHub),
  };
};

// One read of the reader's repositories, answered as the server answers it.
export const answerRepositoriesQuery: (data: {
  repositories: Array<CodeRepositoryListItem>;
  query?: CodeRepositoriesQuery | undefined;
  tasksWithoutRepositoryCount?: number | undefined;
}) => CodeRepositoriesResponse = (data: {
  repositories: Array<CodeRepositoryListItem>;
  query?: CodeRepositoriesQuery | undefined;
  tasksWithoutRepositoryCount?: number | undefined;
}): CodeRepositoriesResponse => {
  const query: CodeRepositoriesQuery = data.query || {};
  const search: string = (query.search || "").trim();
  // Only what the read is held to, before anything else is weighed.
  const held: Array<CodeRepositoryListItem> = data.repositories.filter(
    (repository: CodeRepositoryListItem): boolean => {
      return isInScope(repository, query);
    },
  );
  // The database's order: by name.
  const byName: Array<CodeRepositoryListItem> = [...held].sort(
    (left: CodeRepositoryListItem, right: CodeRepositoryListItem): number => {
      return left.name.localeCompare(right.name);
    },
  );
  const found: Array<CodeRepositoryListItem> = byName.filter(
    (repository: CodeRepositoryListItem): boolean => {
      return matchesCodeRepositorySearch(repository, search);
    },
  );
  const listed: Array<CodeRepositoryListItem> = found.filter(
    (repository: CodeRepositoryListItem): boolean => {
      if (query.group === CodeRepositoryListGroup.Connected) {
        return repository.isConnected;
      }

      if (query.group === CodeRepositoryListGroup.NotConnected) {
        return !repository.isConnected;
      }

      return true;
    },
  );
  const ordered: Array<CodeRepositoryListItem> = listed
    .map((repository: CodeRepositoryListItem, index: number) => {
      return { repository, index };
    })
    .sort(
      (
        left: { repository: CodeRepositoryListItem; index: number },
        right: { repository: CodeRepositoryListItem; index: number },
      ): number => {
        if (
          !query.group &&
          left.repository.isConnected !== right.repository.isConnected
        ) {
          return left.repository.isConnected ? -1 : 1;
        }

        if (query.order === CodeRepositoryListOrder.Activity) {
          const byActivity: number =
            timeOf(right.repository) - timeOf(left.repository);

          if (byActivity !== 0) {
            return byActivity;
          }
        }

        return left.index - right.index;
      },
    )
    .map((item: { repository: CodeRepositoryListItem; index: number }) => {
      return item.repository;
    });
  const skip: number = Math.max(0, query.skip || 0);
  const limit: number = Math.min(
    MAX_CODE_REPOSITORIES_PER_PAGE,
    Math.max(1, query.limit || MAX_CODE_REPOSITORIES_PER_PAGE),
  );
  const connectedFound: number = found.filter(
    (repository: CodeRepositoryListItem): boolean => {
      return repository.isConnected;
    },
  ).length;

  return {
    repositories: ordered.slice(skip, skip + limit),
    count: listed.length,
    facts: getFactsOf(held),
    matches: {
      connected: connectedFound,
      notConnected: found.length - connectedFound,
    },
    tasksWithoutRepositoryCount: data.tasksWithoutRepositoryCount || 0,
  };
};

// Some of the reader's repositories, read by their ids - held to a scope, when one is given.
export const answerRepositoriesById: (data: {
  repositories: Array<CodeRepositoryListItem>;
  ids: Array<string>;
  scope?: CodeRepositoriesScope | undefined;
}) => Array<CodeRepositoryListItem> = (data: {
  repositories: Array<CodeRepositoryListItem>;
  ids: Array<string>;
  scope?: CodeRepositoriesScope | undefined;
}): Array<CodeRepositoryListItem> => {
  const asked: Set<string> = new Set<string>(
    data.ids.map((id: string): string => {
      return id.toLowerCase();
    }),
  );

  return data.repositories.filter(
    (repository: CodeRepositoryListItem): boolean => {
      return (
        asked.has(repository.id.toLowerCase()) &&
        isInScope(repository, data.scope)
      );
    },
  );
};

/*
 * What a stood-in CodeApi.getRepositories answers when a test gave it the
 * reader's repositories whole ({ repositories, tasksWithoutRepositoryCount },
 * the shape Code's pages read before the server paged them): the read
 * answered from them as the server would. An answer that already says its
 * facts is the test's own, answered as it is.
 */
export const asServerAnswer: (
  given: unknown,
  query: CodeRepositoriesQuery | undefined,
) => CodeRepositoriesResponse = (
  given: unknown,
  query: CodeRepositoriesQuery | undefined,
): CodeRepositoriesResponse => {
  const answer: Partial<CodeRepositoriesResponse> =
    (given as Partial<CodeRepositoriesResponse>) || {};

  if (answer.facts) {
    return answer as CodeRepositoriesResponse;
  }

  return answerRepositoriesQuery({
    repositories: answer.repositories || [],
    query,
    tasksWithoutRepositoryCount: answer.tasksWithoutRepositoryCount,
  });
};

/*
 * A project with more repositories than Code ever read: `count`
 * repositories, every one named to sort before a name that starts with "W"
 * ("ap-000001" ...), connected, with nothing happened in them.
 */
export const repositoriesSortingFirst: (
  count: number,
) => Array<CodeRepositoryListItem> = (
  count: number,
): Array<CodeRepositoryListItem> => {
  const repositories: Array<CodeRepositoryListItem> = [];

  for (let index: number = 1; index <= count; index++) {
    const number: string = String(index).padStart(6, "0");

    repositories.push({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `ap-${number}`,
      organizationName: "acme",
      repositoryName: `ap-${number}`,
      isConnected: true,
      provider: CodeRepositoryType.GitHub,
      stats: {
        working: 0,
        waitingForYou: 0,
        openPullRequests: 0,
        taskCount: 0,
      },
    });
  }

  return repositories;
};
