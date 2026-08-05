import ModelAPI, { ListResult, RequestOptions } from "./ModelAPI";
import TeamMembersByUser, { ProjectUserRow } from "../TeamMembersByUser";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import Sort from "../../../Types/BaseDatabase/Sort";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

/*
 * A drop-in ModelAPI for tables that list TeamMember but mean to list *people*
 * - the project's Users table being the one that does.
 *
 * TeamMember rows are (user, team) pairs, so the plain API pages over
 * memberships: a user on three teams occupies three rows and reads as three
 * different people with the same name. This API pages over users instead. It
 * reads the project's memberships in one request, folds them into one row per
 * user (see TeamMembersByUser), and then applies the table's skip/limit to
 * *that* list, so `count` is a number of people and every page boundary falls
 * between two people rather than between two of one person's teams.
 *
 * Paging cannot be pushed to the server here: the list endpoint has no DISTINCT
 * or GROUP BY, so there is no way to ask it for the Nth user. Reading the whole
 * membership list up front is what the project user pickers already do, and it
 * is bounded by LIMIT_PER_PROJECT.
 *
 * Deleting is redefined to match what a row now means - see deleteItem.
 */
export default class ProjectUsersModelAPI extends ModelAPI {
  public static override async getList<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>;
    groupBy?: GroupBy<TBaseModel> | undefined;
    limit: number;
    skip: number;
    select: Select<TBaseModel>;
    sort: Sort<TBaseModel>;
    requestOptions?: RequestOptions | undefined;
  }): Promise<ListResult<TBaseModel>> {
    if (!(new data.modelType() instanceof TeamMember)) {
      // Not the model this API exists for. Behave like the plain one.
      return ModelAPI.getList<TBaseModel>(data);
    }

    const query: Query<TeamMember> = data.query as Query<TeamMember>;
    const sort: Sort<TeamMember> = data.sort as Sort<TeamMember>;

    const memberships: ListResult<TeamMember> =
      await ModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: query,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: this.getMembershipSelect(data.select as Select<TeamMember>),
        sort: sort,
        requestOptions: data.requestOptions,
      });

    let rows: Array<ProjectUserRow> = TeamMembersByUser.groupByUser(
      memberships.data,
    );

    /*
     * An explicit sort was already applied by the server and grouping kept it.
     * Without one the server's order is arbitrary, and an arbitrary order that
     * is then sliced into pages is worse here than elsewhere - so fall back to
     * something a reader of a people directory expects, and that pages the same
     * way every time.
     */
    if (Object.keys(sort || {}).length === 0) {
      rows = TeamMembersByUser.sortRowsByUserName(rows);
    }

    const pageRows: Array<ProjectUserRow> = rows.slice(
      data.skip,
      data.skip + data.limit,
    );

    await this.fillInTeamsHiddenByFilters({
      query: query,
      pageRows: pageRows,
      requestOptions: data.requestOptions,
    });

    return {
      data: pageRows as unknown as Array<TBaseModel>,
      count: rows.length,
      skip: data.skip,
      limit: data.limit,
    };
  }

  /**
   * Removes the user on this row from the project - every one of their team
   * memberships, not just the one whose id the row happens to carry.
   *
   * A grouped row stands for a person, so deleting one membership would leave
   * the row on screen (still a member, via their other teams) and look like the
   * delete silently failed. Removing a user from a single team is done from
   * that user's own Teams tab, where a row is a membership again.
   */
  public static override async deleteItem<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    id: ObjectID;
    requestOptions?: RequestOptions | undefined;
  }): Promise<void> {
    if (!(new data.modelType() instanceof TeamMember)) {
      return ModelAPI.deleteItem<TBaseModel>(data);
    }

    const rowMembership: ListResult<TeamMember> =
      await ModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: {
          _id: data.id.toString(),
        } as Query<TeamMember>,
        limit: 1,
        skip: 0,
        select: {
          _id: true,
          userId: true,
          projectId: true,
        },
        sort: {},
        requestOptions: data.requestOptions,
      });

    const userId: ObjectID | undefined = rowMembership.data[0]?.userId;
    const projectId: ObjectID | undefined = rowMembership.data[0]?.projectId;

    if (!userId || !projectId) {
      /*
       * The row is gone, or was returned without the fields needed to find its
       * siblings. Fall back to the single delete the table asked for.
       */
      return ModelAPI.deleteItem<TBaseModel>(data);
    }

    const allMembershipsOfUser: ListResult<TeamMember> =
      await ModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: {
          userId: userId,
          projectId: projectId,
        } as Query<TeamMember>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
        },
        sort: {},
        requestOptions: data.requestOptions,
      });

    for (const membership of allMembershipsOfUser.data) {
      if (!membership.id) {
        continue;
      }

      await ModelAPI.deleteItem<TeamMember>({
        modelType: TeamMember,
        id: membership.id,
        requestOptions: data.requestOptions,
      });
    }
  }

  /**
   * The table's own select plus the fields grouping needs. Columns ask for what
   * they render; grouping also needs to know which user and which team each
   * membership belongs to, and whether it was accepted.
   */
  private static getMembershipSelect(
    select: Select<TeamMember>,
  ): Select<TeamMember> {
    const teamSelect: Record<string, boolean> =
      typeof select?.team === "object" && select.team !== null
        ? { ...(select.team as Record<string, boolean>) }
        : {};

    const userSelect: Record<string, boolean> =
      typeof select?.user === "object" && select.user !== null
        ? { ...(select.user as Record<string, boolean>) }
        : {};

    return {
      ...select,
      _id: true,
      userId: true,
      teamId: true,
      hasAcceptedInvitation: true,
      user: {
        ...userSelect,
        _id: true,
      },
      team: {
        ...teamSelect,
        _id: true,
        name: true,
      },
    } as Select<TeamMember>;
  }

  /**
   * When the table is filtered, the memberships that were read are only the
   * matching ones - filter by a team and every user's Teams column would show
   * that one team and nothing else, which is exactly the "which teams is this
   * person on?" question the grouped row exists to answer.
   *
   * So for the users actually on this page (at most one page's worth), re-read
   * their memberships unfiltered and merge the full team list back in.
   */
  private static async fillInTeamsHiddenByFilters(data: {
    query: Query<TeamMember>;
    pageRows: Array<ProjectUserRow>;
    requestOptions?: RequestOptions | undefined;
  }): Promise<void> {
    const projectId: unknown = (data.query as Record<string, unknown>)[
      "projectId"
    ];

    const isFiltered: boolean = Object.keys(data.query).some((key: string) => {
      return key !== "projectId";
    });

    if (!isFiltered || !projectId || data.pageRows.length === 0) {
      return;
    }

    const userIds: Array<string> = data.pageRows
      .map((row: ProjectUserRow) => {
        return TeamMembersByUser.getGroupKey(row) || "";
      })
      .filter((userId: string) => {
        return Boolean(userId);
      });

    if (userIds.length === 0) {
      return;
    }

    const allMemberships: ListResult<TeamMember> =
      await ModelAPI.getList<TeamMember>({
        modelType: TeamMember,
        query: {
          projectId: projectId,
          userId: new Includes(userIds),
        } as Query<TeamMember>,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          _id: true,
          userId: true,
          teamId: true,
          hasAcceptedInvitation: true,
          team: {
            _id: true,
            name: true,
          },
        } as Select<TeamMember>,
        sort: {},
        requestOptions: data.requestOptions,
      });

    TeamMembersByUser.mergeAllTeamsIntoRows(data.pageRows, allMemberships.data);
  }
}
