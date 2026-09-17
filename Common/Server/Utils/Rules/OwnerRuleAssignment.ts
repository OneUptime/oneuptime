import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Query from "../../Types/Database/Query";
import PostgresErrorTranslator from "../Database/PostgresErrorTranslator";

/*
 * An owner row is unique per (resource, user or team, project): every
 * <Resource>OwnerUser / <Resource>OwnerTeam model declares that both as a
 * unique index and through @UniqueColumnsTogether, so a second row for the
 * same owner is rejected rather than stored (issue #3394). Before that, a
 * duplicate was shown twice and notified twice.
 *
 * A rejected insert is an error, though, and the callers here - owner rules,
 * create forms, monitor criteria, grouping rules - add owners in bulk and
 * cannot let one owner who is already there stop the rest from being added.
 * They filter their owner set through getOwnersNotYetAssigned first, and
 * insert through createOwner, which treats "already an owner" as done.
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

  /*
   * Inserts one owner row. Resolves true when the row was written and false
   * when the owner was already there - whether the owner service's own check
   * found the existing row, or the unique index rejected a concurrent insert
   * that got past it. Every other failure is thrown as before.
   */
  public static async createOwner<TOwner extends BaseModel>(data: {
    ownerService: DatabaseService<TOwner>;
    owner: TOwner;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    try {
      await data.ownerService.create({
        data: data.owner,
        props: data.props,
      });

      return true;
    } catch (error) {
      if (PostgresErrorTranslator.isUniqueViolation(error)) {
        return false;
      }

      throw error;
    }
  }

  /*
   * Makes every user in `userIds` and team in `teamIds` an owner of the
   * resource, skipping the ones that already are. Safe to call again with the
   * same input: a retried workflow, a template that lists a team twice, or two
   * paths adding the same owner each leave exactly one row, and so exactly one
   * feed item and one notification.
   *
   * Resolves to the owners this call actually added.
   */
  public static async addOwners<
    TOwnerUser extends BaseModel,
    TOwnerTeam extends BaseModel,
  >(data: {
    ownerUserService: DatabaseService<TOwnerUser>;
    ownerTeamService: DatabaseService<TOwnerTeam>;
    // The owner rows' column holding the resource id, e.g. "incidentId".
    resourceIdColumn: string;
    resourceId: ObjectID;
    projectId: ObjectID;
    userIds: Array<ObjectID | string>;
    teamIds: Array<ObjectID | string>;
    /*
     * Written to every added row's isOwnerNotified. Leave it out for owner
     * tables that have no such column.
     */
    isOwnerNotified?: boolean | undefined;
    createdByUserId?: ObjectID | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<OwnersToAssign> {
    const ownersToAdd: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: data.ownerUserService,
        ownerTeamService: data.ownerTeamService,
        resourceIdColumn: data.resourceIdColumn,
        resourceId: data.resourceId,
        userIds: data.userIds,
        teamIds: data.teamIds,
      });

    const added: OwnersToAssign = { userIds: [], teamIds: [] };

    for (const teamId of ownersToAdd.teamIds) {
      const owner: TOwnerTeam = OwnerRuleAssignment.buildOwner({
        ownerService: data.ownerTeamService,
        ownerColumn: "teamId",
        ownerId: teamId,
        resourceIdColumn: data.resourceIdColumn,
        resourceId: data.resourceId,
        projectId: data.projectId,
        isOwnerNotified: data.isOwnerNotified,
        createdByUserId: data.createdByUserId,
      });

      if (
        await OwnerRuleAssignment.createOwner({
          ownerService: data.ownerTeamService,
          owner: owner,
          props: data.props,
        })
      ) {
        added.teamIds.push(teamId);
      }
    }

    for (const userId of ownersToAdd.userIds) {
      const owner: TOwnerUser = OwnerRuleAssignment.buildOwner({
        ownerService: data.ownerUserService,
        ownerColumn: "userId",
        ownerId: userId,
        resourceIdColumn: data.resourceIdColumn,
        resourceId: data.resourceId,
        projectId: data.projectId,
        isOwnerNotified: data.isOwnerNotified,
        createdByUserId: data.createdByUserId,
      });

      if (
        await OwnerRuleAssignment.createOwner({
          ownerService: data.ownerUserService,
          owner: owner,
          props: data.props,
        })
      ) {
        added.userIds.push(userId);
      }
    }

    return added;
  }

  private static buildOwner<TOwner extends BaseModel>(data: {
    ownerService: DatabaseService<TOwner>;
    ownerColumn: "userId" | "teamId";
    ownerId: ObjectID;
    resourceIdColumn: string;
    resourceId: ObjectID;
    projectId: ObjectID;
    isOwnerNotified?: boolean | undefined;
    createdByUserId?: ObjectID | undefined;
  }): TOwner {
    const owner: TOwner = new data.ownerService.modelType();

    owner.setColumnValue(data.resourceIdColumn, data.resourceId);
    owner.setColumnValue("projectId", data.projectId);
    owner.setColumnValue(data.ownerColumn, data.ownerId);

    if (data.isOwnerNotified !== undefined) {
      owner.setColumnValue("isOwnerNotified", data.isOwnerNotified);
    }

    if (data.createdByUserId) {
      owner.setColumnValue("createdByUserId", data.createdByUserId);
    }

    return owner;
  }
}
