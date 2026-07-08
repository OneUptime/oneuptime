import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
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
   * All project users as dropdown options (deduped, alphabetical). Loads the
   * whole list at once — fine for a client-side searchable dropdown. For very
   * large projects prefer `searchProjectUsers` with an async picker.
   */
  public static async fetchProjectUsersAsDropdownOptions(
    projectId: ObjectID,
  ): Promise<Array<DropdownOption>> {
    const users: Array<ProjectUserResult> = await this.searchProjectUsers(
      projectId,
      "",
      LIMIT_PER_PROJECT,
    );

    return users.map((user: ProjectUserResult) => {
      return {
        value: user.userId,
        label: user.name || user.email || "",
      };
    });
  }
}
