import ModelAPI, { ListResult, RequestOptions } from "./ModelAPI";
import API from "../API/API";
import { APP_API_URL } from "../../Config";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Query from "../../../Types/BaseDatabase/Query";
import Select from "../../../Types/BaseDatabase/Select";
import Sort from "../../../Types/BaseDatabase/Sort";
import GroupBy from "../../../Types/BaseDatabase/GroupBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * A drop-in ModelAPI for tables that list TeamMember but mean to list the
 * PROJECTS one user belongs to - the Admin Dashboard's User > Projects page
 * being the one that does.
 *
 * TeamMember rows are (user, team) pairs, so the plain API pages over
 * memberships: a user on three teams of one project occupies three rows and
 * reads as three projects. This API pages over projects instead, by calling the
 * master-admin endpoint that does the grouping server-side
 * (POST /user/:userId/projects). Grouping there rather than in the browser is
 * what makes `count` a number of projects and every page boundary fall between
 * two projects rather than between two of one project's teams.
 *
 * The endpoint owns the shape of a row, so the caller's `select` and `sort` are
 * NOT forwarded - a row is always a project with its teams, always ordered by
 * project name. Adding a column to the table therefore means adding the field
 * to the endpoint's select and to the row it serializes, not just to the
 * column list. Only `skip`/`limit` and the user in the query are the caller's.
 *
 * Deleting is redefined to match what a row now means - see deleteItem.
 */

export interface UserProjectExtras {
  // Every team this user belongs to in this project, sorted by name.
  teamsForProject: Array<Team>;
  teamCountForProject: number;
  /*
   * How many of those memberships are still unaccepted invitations. A user can
   * be a fully accepted member of one team of a project and a pending invite on
   * another.
   */
  pendingTeamCountForProject: number;
  // The ids of every membership this row was folded from.
  teamMemberIdsForProject: Array<string>;
}

/*
 * The row is still a TeamMember - the table, its columns and its delete action
 * are all typed against the model - it just stands for a project the user is in
 * rather than for one of their memberships.
 */
export type UserProjectRow = TeamMember & UserProjectExtras;

export default class UserProjectsModelAPI extends ModelAPI {
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
      /*
       * Not the model this API exists for - a table's entity filter fetching
       * its dropdown options, say. Behave like the plain one, but through
       * `super` so a subclass's getCommonHeaders still applies.
       */
      return super.getList<TBaseModel>(data);
    }

    const userId: ObjectID | null = this.getUserIdFromQuery(
      data.query as Query<TeamMember>,
    );

    if (!userId) {
      /*
       * Without a user there is no list to fetch - the endpoint is
       * "the projects of THIS user". Failing loudly beats returning an empty
       * list, which would render as "this user is in no projects".
       */
      throw new BadDataException(
        "A user id is required to list the projects a user belongs to.",
      );
    }

    const url: URL = URL.fromString(APP_API_URL.toString())
      .addRoute(new User().getCrudApiPath()!)
      .addRoute(`/${userId.toString()}/projects`);

    const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
      await API.fetch<JSONArray>({
        method: HTTPMethod.POST,
        url: url,
        data: {},
        headers: this.getCommonHeaders(data.requestOptions),
        params: {
          limit: data.limit.toString(),
          skip: data.skip.toString(),
        },
      });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    const rows: Array<UserProjectRow> = (result.data as JSONArray).map(
      (item: JSONObject) => {
        return this.toRow(item);
      },
    );

    return {
      data: rows as unknown as Array<TBaseModel>,
      count: result.count,
      skip: result.skip,
      limit: result.limit,
    };
  }

  /**
   * Removes the user from the project on this row - every one of their team
   * memberships in it, not just the one whose id the row happens to carry.
   *
   * A grouped row stands for a project, so deleting one membership would leave
   * the row on screen (still in the project, via their other teams) and look
   * like the delete silently failed. Removing the user from a single team is
   * done from the memberships table on the same page, where a row is a
   * membership again.
   *
   * This goes through one `remove-from-project` request rather than a DELETE
   * per membership, and that is load-bearing rather than an optimisation. The
   * server refuses to remove the last accepted member of the Owners team, and
   * it refuses per request - so a loop deletes every other membership first and
   * only then reports a failure, leaving the person stripped of the teams the
   * caller was just told they had not lost. The endpoint runs that check across
   * the whole set before deleting anything.
   */
  public static override async deleteItem<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    id: ObjectID;
    requestOptions?: RequestOptions | undefined;
  }): Promise<void> {
    if (!(new data.modelType() instanceof TeamMember)) {
      return super.deleteItem<TBaseModel>(data);
    }

    const rowMembership: TeamMember | null = await this.getItem<TeamMember>({
      modelType: TeamMember,
      id: data.id,
      select: {
        _id: true,
        userId: true,
        projectId: true,
      },
      requestOptions: data.requestOptions,
    });

    const userId: ObjectID | undefined = rowMembership?.userId;
    const projectId: ObjectID | undefined = rowMembership?.projectId;

    if (!userId || !projectId) {
      /*
       * The row is gone, or came back without the user or project it stands
       * for. Fall back to the single delete the table asked for rather than
       * guessing which project to empty.
       */
      return super.deleteItem<TBaseModel>(data);
    }

    const url: URL = URL.fromString(APP_API_URL.toString())
      .addRoute(new User().getCrudApiPath()!)
      .addRoute(`/${userId.toString()}/remove-from-project`);

    const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: url,
        data: {
          projectId: projectId.toString(),
        },
        headers: this.getCommonHeaders(data.requestOptions),
      });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }
  }

  /**
   * The user the table is listing projects for.
   *
   * Accepts the id in the shapes a table query can carry it in: an ObjectID
   * (what the page passes) or a plain string.
   */
  private static getUserIdFromQuery(query: Query<TeamMember>): ObjectID | null {
    const value: unknown = (query as Record<string, unknown>)["userId"];

    if (value instanceof ObjectID) {
      return value;
    }

    if (typeof value === "string" && value) {
      return new ObjectID(value);
    }

    return null;
  }

  /**
   * One row of the response.
   *
   * The base of the row is a TeamMember and hydrates as one. The aggregate
   * fields are not columns of TeamMember, so BaseModel.fromJSON drops them -
   * they are read off the raw JSON and attached here.
   */
  private static toRow(item: JSONObject): UserProjectRow {
    const row: UserProjectRow = BaseModel.fromJSON(
      item,
      TeamMember,
    ) as UserProjectRow;

    row.teamsForProject = BaseModel.fromJSONArray(
      (item["teams"] as Array<JSONObject>) || [],
      Team,
    );
    row.teamCountForProject = row.teamsForProject.length;
    row.pendingTeamCountForProject = this.toCount(item["pendingTeamCount"]);
    row.teamMemberIdsForProject = (
      (item["teamMemberIds"] as Array<unknown>) || []
    )
      .map((id: unknown) => {
        return id?.toString() || "";
      })
      .filter((id: string) => {
        return Boolean(id);
      });

    return row;
  }

  private static toCount(value: unknown): number {
    const count: number = Number(value);

    return Number.isFinite(count) && count > 0 ? count : 0;
  }
}
