import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Query from "../../Types/Database/Query";

/*
 * Owner rows are plain join rows with no unique constraint, so creating one for
 * a user who already owns the resource produces a duplicate owner - shown
 * twice, and notified twice. A resource created a moment ago rarely has owners
 * yet, but the create form can assign some before the owner rules run, and a
 * rule run over existing resources meets owners on almost every one of them.
 * Every owner rule engine filters its owner set through this first.
 */

export interface OwnersToAssign {
  userIds: Array<ObjectID>;
  teamIds: Array<ObjectID>;
}

function uniqueIds(ids: Array<ObjectID | string>): Array<ObjectID> {
  const seen: Set<string> = new Set<string>();
  const result: Array<ObjectID> = [];

  for (const id of ids) {
    const value: string = id?.toString() || "";

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(new ObjectID(value));
  }

  return result;
}

export default class OwnerRuleAssignment {
  /*
   * The users and teams from `userIds` / `teamIds` that do not already own the
   * resource. Duplicates within the input collapse to one.
   */
  public static async getOwnersNotYetAssigned<
    TOwnerUser extends BaseModel,
    TOwnerTeam extends BaseModel,
  >(data: {
    ownerUserService: DatabaseService<TOwnerUser>;
    ownerTeamService: DatabaseService<TOwnerTeam>;
    // The owner rows' column holding the resource id, e.g. "monitorId".
    resourceIdColumn: string;
    resourceId: ObjectID;
    userIds: Array<ObjectID | string>;
    teamIds: Array<ObjectID | string>;
  }): Promise<OwnersToAssign> {
    const userIds: Array<ObjectID> = uniqueIds(data.userIds);
    const teamIds: Array<ObjectID> = uniqueIds(data.teamIds);

    const [existingUsers, existingTeams]: [
      Array<TOwnerUser>,
      Array<TOwnerTeam>,
    ] = await Promise.all([
      userIds.length > 0
        ? data.ownerUserService.findBy({
            query: {
              [data.resourceIdColumn]: data.resourceId,
              userId: QueryHelper.any(userIds),
            } as unknown as Query<TOwnerUser>,
            select: { userId: true } as never,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([] as Array<TOwnerUser>),
      teamIds.length > 0
        ? data.ownerTeamService.findBy({
            query: {
              [data.resourceIdColumn]: data.resourceId,
              teamId: QueryHelper.any(teamIds),
            } as unknown as Query<TOwnerTeam>,
            select: { teamId: true } as never,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : Promise.resolve([] as Array<TOwnerTeam>),
    ]);

    const assignedUserIds: Set<string> = new Set<string>(
      existingUsers.map((row: TOwnerUser): string => {
        return row.getColumnValue("userId")?.toString() || "";
      }),
    );
    const assignedTeamIds: Set<string> = new Set<string>(
      existingTeams.map((row: TOwnerTeam): string => {
        return row.getColumnValue("teamId")?.toString() || "";
      }),
    );

    return {
      userIds: userIds.filter((id: ObjectID): boolean => {
        return !assignedUserIds.has(id.toString());
      }),
      teamIds: teamIds.filter((id: ObjectID): boolean => {
        return !assignedTeamIds.has(id.toString());
      }),
    };
  }
}
