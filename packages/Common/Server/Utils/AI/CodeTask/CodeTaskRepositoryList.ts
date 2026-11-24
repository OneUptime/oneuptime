import CodeTaskAccess from "./CodeTaskAccess";
import CodeTaskStats from "./CodeTaskStats";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../CodeRepository/CodeHost/CodeHostAccess";
import Select from "../../../Types/Database/Select";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CodeRepositoryListFactsJSON,
  CodeRepositoryListGroup,
  CodeRepositoryListMatchesJSON,
  CodeRepositoryListOrder,
} from "../../../../Types/AI/CodeTask";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import { matchesCodeRepositorySearch } from "../../../../Types/CodeRepository/CodeRepositorySearch";
import ObjectID from "../../../../Types/ObjectID";

/*
 * CODE'S REPOSITORIES, AS A LIST OF THEM SHOWS THEM - HOWEVER MANY THE
 * PROJECT HAS (#10764).
 *
 * Code read the first 500 repositories by name and did everything else in
 * the browser: searched them, split them into the two lists the
 * Repositories page draws (those AI can work in, and those OneUptime cannot
 * reach any more), ordered them by activity, and offered them in the
 * request box's picker. A repository past the 500th could not be found,
 * picked, scoped or counted. Here that is the server's to do, over every
 * repository the reader may read, a page at a time:
 *
 *   - the reader's repositories are read through their own permissions,
 *     all of them (CodeTaskAccess.listReadableRepositories), with only the
 *     columns a search and the lists read - a repository they may not read
 *     is never weighed, so it is never counted, found or offered;
 *   - a search keeps those whose name, "organization/name" or description
 *     holds it (CodeRepositorySearch, the rule the pages share);
 *   - each is placed in its list by how it connects (CodeHostAccess), as
 *     Code's pages always placed them;
 *   - ordered by name (a picker) or by when anything last happened in it,
 *     most recent first, then by name (the Repositories page) - those AI
 *     can work in first when both lists are asked for at once;
 *   - and only the page asked for is read whole, by its ids.
 *
 * Every repository of the reader's is weighed for each read, so a page is
 * never a page of a first page.
 */

// What a search, the lists and the order read of every repository.
export const CODE_REPOSITORY_LIST_SELECT: Select<CodeRepository> = {
  _id: true,
  name: true,
  organizationName: true,
  repositoryName: true,
  description: true,
  repositoryHostedAt: true,
};

export interface CodeRepositoryListRequest {
  // "" for every repository.
  search: string;
  // One of the two lists, or both (null) - those AI can work in first.
  group: CodeRepositoryListGroup | null;
  order: CodeRepositoryListOrder;
  skip: number;
  limit: number;
}

// One repository as the list weighs it.
export interface CodeRepositoryListEntry {
  repository: CodeRepository;
  isConnected: boolean;
  provider: CodeRepositoryType;
}

export interface CodeRepositoryListPage {
  // The page, in its order, read whole (CODE_TASK_REPOSITORY_SELECT).
  repositories: Array<CodeRepository>;
  // How each repository on the page connects, by id.
  connections: Map<string, CodeHostConnectionSummary>;
  // How many repositories the search finds in the list asked for.
  count: number;
  facts: CodeRepositoryListFactsJSON;
  matches: CodeRepositoryListMatchesJSON;
}

// An entry's id, lower-cased: how the maps here key a repository.
const keyOf: (repository: CodeRepository) => string = (
  repository: CodeRepository,
): string => {
  return repository.id?.toString().toLowerCase() || "";
};

export default class CodeTaskRepositoryList {
  @CaptureSpan()
  public static async read(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    request: CodeRepositoryListRequest;
  }): Promise<CodeRepositoryListPage> {
    const readable: Array<CodeRepository> =
      await CodeTaskAccess.listReadableRepositories({
        props: data.props,
        projectId: data.projectId,
        select: CODE_REPOSITORY_LIST_SELECT,
      });

    const summaries: Map<string, CodeHostConnectionSummary> =
      await CodeHostAccess.getConnectionSummaries({
        projectId: data.projectId,
        repositoryIds: readable
          .map((repository: CodeRepository): ObjectID | undefined => {
            return repository.id || undefined;
          })
          .filter((id: ObjectID | undefined): id is ObjectID => {
            return Boolean(id);
          }),
      });

    const entries: Array<CodeRepositoryListEntry> =
      CodeTaskRepositoryList.toEntries({ repositories: readable, summaries });

    const found: Array<CodeRepositoryListEntry> = entries.filter(
      (entry: CodeRepositoryListEntry): boolean => {
        return matchesCodeRepositorySearch(
          {
            name: entry.repository.name || "",
            organizationName: entry.repository.organizationName || "",
            repositoryName: entry.repository.repositoryName || "",
            description: entry.repository.description || "",
          },
          data.request.search,
        );
      },
    );

    const listed: Array<CodeRepositoryListEntry> = found.filter(
      (entry: CodeRepositoryListEntry): boolean => {
        return CodeTaskRepositoryList.isInGroup(entry, data.request.group);
      },
    );

    const lastActivity: Map<string, Date> =
      data.request.order === CodeRepositoryListOrder.Activity &&
      listed.length > 0
        ? await CodeTaskStats.getLastActivity({
            projectId: data.projectId,
            repositoryIds: listed.map(
              (entry: CodeRepositoryListEntry): ObjectID => {
                return entry.repository.id!;
              },
            ),
            reader: data.props,
          })
        : new Map<string, Date>();

    const ordered: Array<CodeRepositoryListEntry> =
      CodeTaskRepositoryList.order({
        entries: listed,
        order: data.request.order,
        lastActivity,
        connectedFirst: data.request.group === null,
      });

    const page: Array<CodeRepositoryListEntry> = ordered.slice(
      data.request.skip,
      data.request.skip + data.request.limit,
    );

    const repositories: Array<CodeRepository> =
      await CodeTaskRepositoryList.readPage({
        props: data.props,
        projectId: data.projectId,
        page,
      });

    const connections: Map<string, CodeHostConnectionSummary> = new Map();

    for (const repository of repositories) {
      const summary: CodeHostConnectionSummary | undefined = summaries.get(
        repository.id!.toString(),
      );

      if (summary) {
        connections.set(repository.id!.toString(), summary);
      }
    }

    return {
      repositories,
      connections,
      count: listed.length,
      facts: CodeTaskRepositoryList.getFacts(entries),
      matches: CodeTaskRepositoryList.getMatches(found),
    };
  }

  // Each repository read, with how it connects.
  public static toEntries(data: {
    repositories: Array<CodeRepository>;
    summaries: Map<string, CodeHostConnectionSummary>;
  }): Array<CodeRepositoryListEntry> {
    return data.repositories
      .filter((repository: CodeRepository): boolean => {
        return Boolean(repository.id);
      })
      .map((repository: CodeRepository): CodeRepositoryListEntry => {
        const summary: CodeHostConnectionSummary | undefined =
          data.summaries.get(repository.id!.toString());

        return {
          repository,
          isConnected: summary?.state === CodeHostConnectionState.Connected,
          provider: CodeHost.readType(repository.repositoryHostedAt),
        };
      });
  }

  // Whether an entry is in the list asked for (null: in either).
  public static isInGroup(
    entry: CodeRepositoryListEntry,
    group: CodeRepositoryListGroup | null,
  ): boolean {
    if (group === CodeRepositoryListGroup.Connected) {
      return entry.isConnected;
    }

    if (group === CodeRepositoryListGroup.NotConnected) {
      return !entry.isConnected;
    }

    return true;
  }

  /*
   * The entries in the list's order. They come in by name (the database's
   * order, ties broken by id): by activity, the most recent first and those
   * nothing happened in last, ties kept by name; with `connectedFirst`,
   * those AI can work in before those it cannot, each in that order.
   */
  public static order(data: {
    entries: Array<CodeRepositoryListEntry>;
    order: CodeRepositoryListOrder;
    lastActivity: Map<string, Date>;
    connectedFirst: boolean;
  }): Array<CodeRepositoryListEntry> {
    const activityOf: (entry: CodeRepositoryListEntry) => number = (
      entry: CodeRepositoryListEntry,
    ): number => {
      const time: Date | undefined = data.lastActivity.get(
        keyOf(entry.repository),
      );

      return time ? time.getTime() : 0;
    };

    return data.entries
      .map((entry: CodeRepositoryListEntry, index: number) => {
        return { entry, index };
      })
      .sort(
        (
          left: { entry: CodeRepositoryListEntry; index: number },
          right: { entry: CodeRepositoryListEntry; index: number },
        ): number => {
          if (
            data.connectedFirst &&
            left.entry.isConnected !== right.entry.isConnected
          ) {
            return left.entry.isConnected ? -1 : 1;
          }

          if (data.order === CodeRepositoryListOrder.Activity) {
            const byActivity: number =
              activityOf(right.entry) - activityOf(left.entry);

            if (byActivity !== 0) {
              return byActivity;
            }
          }

          return left.index - right.index;
        },
      )
      .map((item: { entry: CodeRepositoryListEntry; index: number }) => {
        return item.entry;
      });
  }

  // What the page says of all the reader's repositories.
  public static getFacts(
    entries: Array<CodeRepositoryListEntry>,
  ): CodeRepositoryListFactsJSON {
    const notConnected: Array<CodeRepositoryListEntry> = entries.filter(
      (entry: CodeRepositoryListEntry): boolean => {
        return !entry.isConnected;
      },
    );
    const isOnGitHub: (entry: CodeRepositoryListEntry) => boolean = (
      entry: CodeRepositoryListEntry,
    ): boolean => {
      return entry.provider === CodeRepositoryType.GitHub;
    };

    return {
      total: entries.length,
      connected: entries.length - notConnected.length,
      notConnected: notConnected.length,
      areAllOnGitHub: entries.every(isOnGitHub),
      isAnyOnGitHub: entries.some(isOnGitHub),
      areAllNotConnectedOnGitHub: notConnected.every(isOnGitHub),
      isAnyNotConnectedOnGitHub: notConnected.some(isOnGitHub),
    };
  }

  // How many of each list the search found.
  public static getMatches(
    found: Array<CodeRepositoryListEntry>,
  ): CodeRepositoryListMatchesJSON {
    const connected: number = found.filter(
      (entry: CodeRepositoryListEntry): boolean => {
        return entry.isConnected;
      },
    ).length;

    return { connected, notConnected: found.length - connected };
  }

  /*
   * The page's repositories read whole, by their ids and as the reader -
   * in the page's order. One the reader stopped being able to read between
   * the two reads is left out.
   */
  private static async readPage(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    page: Array<CodeRepositoryListEntry>;
  }): Promise<Array<CodeRepository>> {
    if (data.page.length === 0) {
      return [];
    }

    const rows: Array<CodeRepository> =
      await CodeTaskAccess.listReadableRepositoriesByIds({
        props: data.props,
        projectId: data.projectId,
        repositoryIds: data.page.map(
          (entry: CodeRepositoryListEntry): ObjectID => {
            return entry.repository.id!;
          },
        ),
      });

    const byId: Map<string, CodeRepository> = new Map<string, CodeRepository>(
      rows.map((row: CodeRepository): [string, CodeRepository] => {
        return [keyOf(row), row];
      }),
    );

    return data.page
      .map((entry: CodeRepositoryListEntry): CodeRepository | undefined => {
        return byId.get(keyOf(entry.repository));
      })
      .filter((row: CodeRepository | undefined): row is CodeRepository => {
        return Boolean(row);
      });
  }
}
