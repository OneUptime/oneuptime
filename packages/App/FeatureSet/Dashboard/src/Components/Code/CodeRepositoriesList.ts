import { CodeRepositoryListItem } from "./CodeApi";
import { getRepositoryFullName } from "./CodePaths";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How Code's Repositories page lists a project's repositories, as plain
 * rules - React-free, so the page, the request box's picker and App's tests
 * read the same ones.
 *
 * The repositories AI can work in come first, and alone: a project whose
 * GitHub App reaches one repository while fourteen others were imported by
 * an installation it has since left saw the one it uses at the end of a
 * list of "Not connected" ones. The others are listed apart, folded, with
 * what connects them again.
 */

// A search box once there are more repositories than fit at a glance.
export const REPOSITORY_SEARCH_THRESHOLD: number = 6;

// How many repositories a page of the list holds.
export const REPOSITORIES_PAGE_SIZE: number = 10;

export const CODE_REPOSITORIES_COPY: {
  cardTitle: string;
  cardDescription: string;
  notConnectedTitle: string;
  notConnectedSummary: string;
  notConnectedExplanation: string;
  notConnectedSummaryAnyHost: string;
  notConnectedExplanationAnyHost: string;
  noneConnectedTitle: string;
  noMatchTitle: string;
  searchPlaceholder: string;
} = {
  cardTitle: translationKey("Repositories"),
  cardDescription: translationKey(
    "Open a repository to ask AI to work in it, read its tasks or change its settings.",
  ),
  notConnectedTitle: translationKey("Not connected"),
  // The folded line under the title.
  notConnectedSummary: translationKey(
    "GitHub does not give OneUptime access to these repositories any more, so AI cannot work in them.",
  ),
  // Open: what that means, and what to do.
  notConnectedExplanation: translationKey(
    "Their tasks stay readable. Connect GitHub with access to them to use them again, or open one to delete it.",
  ),
  /*
   * The same, when some of them are not on GitHub (GitLab, Forgejo, Gitea,
   * a Git server): their server refused the access token, or their
   * connection is gone.
   */
  notConnectedSummaryAnyHost: translationKey(
    "OneUptime cannot reach these repositories any more, so AI cannot work in them.",
  ),
  notConnectedExplanationAnyHost: translationKey(
    "Their tasks stay readable. Open a repository to replace its refused access token, or to delete it. Connect GitHub again for those on GitHub.",
  ),
  noneConnectedTitle: translationKey("No connected repositories"),
  noMatchTitle: translationKey("No repository matches your search."),
  searchPlaceholder: translationKey("Find a repository"),
};

export interface CodeRepositoryGroups {
  // The repositories AI can work in: the project's GitHub App reaches them.
  connected: Array<CodeRepositoryListItem>;
  // The ones it does not reach any more.
  notConnected: Array<CodeRepositoryListItem>;
}

// When anything last happened in a repository, as a number to sort by.
const getActivityTime: (repository: CodeRepositoryListItem) => number = (
  repository: CodeRepositoryListItem,
): number => {
  const time: number = repository.stats.lastActivityAt
    ? new Date(repository.stats.lastActivityAt).getTime()
    : 0;

  return Number.isNaN(time) ? 0 : time;
};

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
      const byActivity: number = getActivityTime(b) - getActivityTime(a);

      if (byActivity !== 0) {
        return byActivity;
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
 * The repositories the page lists, those AI can work in apart from those
 * it cannot, each most recently active first - narrowed to a search.
 */
export const groupRepositories: (
  repositories: Array<CodeRepositoryListItem>,
  search?: string | undefined,
) => CodeRepositoryGroups = (
  repositories: Array<CodeRepositoryListItem>,
  search?: string | undefined,
): CodeRepositoryGroups => {
  const sorted: Array<CodeRepositoryListItem> = sortRepositories(
    repositories,
  ).filter((repository: CodeRepositoryListItem): boolean => {
    return matchesRepositorySearch(repository, search || "");
  });

  return {
    connected: sorted.filter((repository: CodeRepositoryListItem): boolean => {
      return repository.isConnected;
    }),
    notConnected: sorted.filter(
      (repository: CodeRepositoryListItem): boolean => {
        return !repository.isConnected;
      },
    ),
  };
};

/*
 * Whether a search found repositories only under Not connected: none among
 * those AI can work in, some among those it cannot. The page then opens Not
 * connected, so what was found is in sight - not a count behind a fold.
 */
export const isFoundOnlyUnderNotConnected: (
  groups: CodeRepositoryGroups,
  search: string,
) => boolean = (groups: CodeRepositoryGroups, search: string): boolean => {
  return (
    search.trim().length > 0 &&
    groups.connected.length === 0 &&
    groups.notConnected.length > 0
  );
};

/*
 * Whether a repository is on GitHub, as the server says (a server older than
 * the other hosts says nothing: GitHub).
 */
export const isGitHubRepository: (
  repository: Pick<CodeRepositoryListItem, "provider">,
) => boolean = (
  repository: Pick<CodeRepositoryListItem, "provider">,
): boolean => {
  return CodeHost.readType(repository.provider) === CodeRepositoryType.GitHub;
};

/*
 * Whether every repository listed is on GitHub: the page's words for the
 * repositories it cannot reach then name GitHub, as they always did.
 */
export const areAllOnGitHub: (
  repositories: Array<CodeRepositoryListItem>,
) => boolean = (repositories: Array<CodeRepositoryListItem>): boolean => {
  return repositories.every((repository: CodeRepositoryListItem): boolean => {
    return isGitHubRepository(repository);
  });
};

/*
 * Whether GitHub reaches none of the repositories - the project's GitHub
 * connection is gone: the list of those AI can work in is empty, and says
 * how to connect GitHub again.
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
 * The repositories a picker offers, in the order it lists them: those AI
 * can work in first, then those it cannot - each by name, as the server
 * reads them.
 */
export const orderRepositoriesForPicker: (
  repositories: Array<CodeRepositoryListItem>,
) => Array<CodeRepositoryListItem> = (
  repositories: Array<CodeRepositoryListItem>,
): Array<CodeRepositoryListItem> => {
  return [
    ...repositories.filter((repository: CodeRepositoryListItem): boolean => {
      return repository.isConnected;
    }),
    ...repositories.filter((repository: CodeRepositoryListItem): boolean => {
      return !repository.isConnected;
    }),
  ];
};

// The page of a list a page number shows, and the page it really is.
export const getRepositoriesPage: (data: {
  repositories: Array<CodeRepositoryListItem>;
  pageNumber: number;
  pageSize: number;
}) => { items: Array<CodeRepositoryListItem>; pageNumber: number } = (data: {
  repositories: Array<CodeRepositoryListItem>;
  pageNumber: number;
  pageSize: number;
}): { items: Array<CodeRepositoryListItem>; pageNumber: number } => {
  const pageSize: number = Math.max(1, data.pageSize);
  const pageCount: number = Math.max(
    1,
    Math.ceil(data.repositories.length / pageSize),
  );
  // A search that shrank the list takes the reader back to a page it has.
  const pageNumber: number = Math.min(
    Math.max(1, Math.floor(data.pageNumber) || 1),
    pageCount,
  );
  const start: number = (pageNumber - 1) * pageSize;

  return {
    items: data.repositories.slice(start, start + pageSize),
    pageNumber,
  };
};
