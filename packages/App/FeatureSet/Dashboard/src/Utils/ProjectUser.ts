import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";

export interface ProjectUserResult {
  userId: string;
  name: string;
  email: string;
}

export default class ProjectUser {
  // How many team memberships one read lists, and the most pages read.
  public static readonly MEMBERSHIPS_PAGE_SIZE: number = LIMIT_PER_PROJECT;
  public static readonly MAX_MEMBERSHIP_PAGES: number = 100;

  /**
   * Search the project's users by name or email, server-side. Safe to call on
   * every (debounced) keystroke of a picker — only the first `limit` matches
   * are returned. A user is returned once even if they belong to several teams
   * or match on both name and email.
   *
   * `TeamMember` is the only project-scoped link to `User` the dashboard can
   * list (the `User` model itself is only self-readable), so the search runs
   * through it.
   */
  public static async searchProjectUsers(
    projectId: ObjectID,
    searchTerm: string,
    limit: number = 50,
  ): Promise<Array<ProjectUserResult>> {
    const trimmed: string = searchTerm.trim();

    /*
     * There is no OR across two relation fields in a single query, so match the
     * term against the user's name AND email with one query each, then union +
     * dedupe below.
     */
    const queries: Array<Query<TeamMember>> = trimmed
      ? [
          {
            projectId: projectId,
            user: { name: new Search(trimmed) },
          } as unknown as Query<TeamMember>,
          {
            projectId: projectId,
            user: { email: new Search(trimmed) },
          } as unknown as Query<TeamMember>,
        ]
      : [{ projectId: projectId } as Query<TeamMember>];

    const results: Array<ListResult<TeamMember>> = await Promise.all(
      queries.map((query: Query<TeamMember>) => {
        return ModelAPI.getList<TeamMember>({
          modelType: TeamMember,
          query: query,
          limit: limit,
          skip: 0,
          select: {
            _id: true,
            user: {
              _id: true,
              name: true,
              email: true,
            },
          },
          sort: {},
        });
      }),
    );

    const seenUserIds: Set<string> = new Set<string>();
    const users: Array<ProjectUserResult> = [];

    for (const result of results) {
      for (const teamMember of result.data) {
        const userId: string | undefined = teamMember.user?._id?.toString();

        if (!userId || seenUserIds.has(userId)) {
          continue;
        }

        seenUserIds.add(userId);
        users.push({
          userId: userId,
          name: teamMember.user?.name?.toString() || "",
          email: teamMember.user?.email?.toString() || "",
        });
      }
    }

    users.sort((a: ProjectUserResult, b: ProjectUserResult) => {
      return (a.name || a.email).localeCompare(b.name || b.email);
    });

    return users;
  }

  /**
   * Every user of the project (deduped, alphabetical), however many team
   * memberships it has (#10646). A user is in a project through their teams,
   * one TeamMember row each, so the rows are read a page at a time, in the
   * order they were made - never "the first 10,000, unsorted", which kept
   * only the newest memberships: a project of more than that had people
   * no picker offered, and a filter a link restored named them by their
   * ids. Stops at MAX_MEMBERSHIP_PAGES pages, so a read never runs away.
   */
  public static async fetchAllProjectUsers(
    projectId: ObjectID,
  ): Promise<Array<ProjectUserResult>> {
    const seenUserIds: Set<string> = new Set<string>();
    const users: Array<ProjectUserResult> = [];

    for (
      let page: number = 0;
      page < ProjectUser.MAX_MEMBERSHIP_PAGES;
      page++
    ) {
      const result: ListResult<TeamMember> = await ModelAPI.getList<TeamMember>(
        {
          modelType: TeamMember,
          query: { projectId: projectId } as Query<TeamMember>,
          limit: ProjectUser.MEMBERSHIPS_PAGE_SIZE,
          skip: page * ProjectUser.MEMBERSHIPS_PAGE_SIZE,
          select: {
            _id: true,
            user: {
              _id: true,
              name: true,
              email: true,
            },
          },
          /*
           * By the order they were made, and by id among memberships made
           * at the same moment (a team added in one go): pages read by a
           * time alone could leave one out between two of them.
           */
          sort: { createdAt: SortOrder.Ascending, _id: SortOrder.Ascending },
        },
      );

      for (const teamMember of result.data) {
        const userId: string | undefined = teamMember.user?._id?.toString();

        if (!userId || seenUserIds.has(userId)) {
          continue;
        }

        seenUserIds.add(userId);
        users.push({
          userId: userId,
          name: teamMember.user?.name?.toString() || "",
          email: teamMember.user?.email?.toString() || "",
        });
      }

      const readThrough: number =
        (page + 1) * ProjectUser.MEMBERSHIPS_PAGE_SIZE;

      if (
        result.data.length < ProjectUser.MEMBERSHIPS_PAGE_SIZE ||
        readThrough >= (result.count ?? readThrough)
      ) {
        break;
      }
    }

    users.sort((a: ProjectUserResult, b: ProjectUserResult) => {
      return (a.name || a.email).localeCompare(b.name || b.email);
    });

    return users;
  }

  /**
   * All project users as dropdown options (deduped, alphabetical): every one
   * of them (fetchAllProjectUsers), for a client-side searchable dropdown.
   * For very large projects prefer `searchProjectUsers` with an async picker.
   */
  public static async fetchProjectUsersAsDropdownOptions(
    projectId: ObjectID,
  ): Promise<Array<DropdownOption>> {
    const users: Array<ProjectUserResult> =
      await this.fetchAllProjectUsers(projectId);

    return users.map((user: ProjectUserResult) => {
      return {
        value: user.userId,
        label: user.name || user.email || "",
        // A person's name or email, as they gave it.
        isUserContent: true,
      };
    });
  }
}
