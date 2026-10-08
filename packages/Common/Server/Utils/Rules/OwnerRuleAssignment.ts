import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService, { PendingRecord } from "../../Services/DatabaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../Types/Database/Permissions/BasePermission";
import CreatePermission from "../../Types/Database/Permissions/CreatePermission";
import OwnedScopePermission from "../../Types/Database/Permissions/OwnedScopePermission";
import QueryHelper from "../../Types/Database/QueryHelper";
import Query from "../../Types/Database/Query";
import PostgresErrorTranslator from "../Database/PostgresErrorTranslator";
import {
  ProjectScopedReferenceException,
  resolveReferenceIds,
  UnreadableReferenceException,
} from "../Database/ProjectScopedReferenceRefusal";
import logger from "../Logger";

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
 *
 * Those owner sets are saved configuration - rules, templates, criteria -
 * and can name a user who has since left the project. createOwner skips
 * such a user, so a departed member is not made the owner of new work,
 * notified about it, or listed as notified. It skips a team that is not one
 * of the project's teams just the same: the lists are checked when they are
 * saved, but a list saved before that check existed can still name another
 * project's team, whose members must not be made owners of this project's
 * work, or be notified about it. The owner row's own service refuses such a
 * team (every owner service is a ProjectReferencesService, which checks the
 * row's team, user and resource), and createOwner reports it as not added.
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
   * when it was not: the owner was already there - whether the owner
   * service's own check found the existing row, or the unique index rejected
   * a concurrent insert that got past it - or the owner is a user who is not
   * a member of the project, or the owner service refused the row as naming
   * a record that is not the project's (a team of another project). Every
   * other failure is thrown as before - a resource its caller may not read
   * among them (UnreadableReferenceException), or an owner row their
   * permission to add owners does not reach (CreateScopeException): that is
   * the caller's access, not a stale owner, and is not skipped as one.
   *
   * `onCreatorsBehalf`: the owners picked in the form that created the
   * resource, added for the person who just created it, whose permission to
   * add them was asked before the resource was saved
   * (checkOwnersPickedOnCreate). One refusal is then not theirs to fix: an
   * owner row read through the resource needs a read of it, and their read
   * may not reach the resource they made a moment ago. For that refusal
   * alone OneUptime writes the row for them (root, naming them), as it
   * writes a new monitor's first status row, once the row is checked
   * against their own permission to add owners on everything but that read
   * - the permission itself, its labels, its blocks with labels
   * (createOwnerForCreator). Any other refusal stands.
   */
  public static async createOwner<TOwner extends BaseModel>(data: {
    ownerService: DatabaseService<TOwner>;
    owner: TOwner;
    props: DatabaseCommonInteractionProps;
    onCreatorsBehalf?: boolean | undefined;
  }): Promise<boolean> {
    if (!(await OwnerRuleAssignment.isOwnerInProject(data))) {
      return false;
    }

    try {
      await data.ownerService.create({
        data: data.owner,
        props: data.props,
      });

      return true;
    } catch (error) {
      if (
        data.onCreatorsBehalf &&
        !data.props.isRoot &&
        OwnerRuleAssignment.isOutOfReach(error)
      ) {
        return await OwnerRuleAssignment.createOwnerForCreator(data);
      }

      if (
        PostgresErrorTranslator.isUniqueViolation(error) ||
        (error instanceof ProjectScopedReferenceException &&
          !(error instanceof UnreadableReferenceException))
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * Whether a write was refused only because a record it names is one its
   * caller may not read (UnreadableReferenceException) - for a write their
   * creator adds on a record they just made, their read not reaching it -
   * rather than for a permission they lack, or one that does not reach what
   * they write (CreateScopeException), which is never written around.
   */
  public static isOutOfReach(error: unknown): boolean {
    return error instanceof UnreadableReferenceException;
  }

  // See createOwner: the row written by OneUptime, for the resource's creator.
  private static async createOwnerForCreator<TOwner extends BaseModel>(data: {
    ownerService: DatabaseService<TOwner>;
    owner: TOwner;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    // Everything but the creator's read of their new resource still holds.
    CreatePermission.checkCreatePermissions(
      data.ownerService.modelType,
      data.owner,
      data.props,
    );
    await data.ownerService.checkCreateScopeOf({
      row: data.owner,
      props: data.props,
    });

    logger.info(
      `An owner picked when creating ${data.owner.singularName || "a resource"} is added by OneUptime for its creator: the new resource is outside what their own permissions reach.`,
    );

    try {
      await data.ownerService.create({
        data: data.owner,
        props: {
          isRoot: true,
          userId: data.props.userId,
        },
      });

      return true;
    } catch (error) {
      if (
        PostgresErrorTranslator.isUniqueViolation(error) ||
        error instanceof ProjectScopedReferenceException
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * OWNERS PICKED IN A CREATE FORM ARE ASKED ABOUT BEFORE THE RESOURCE IS
   * SAVED.
   *
   * The owners picked in the form that creates a resource go on it once it
   * is saved (addOwners, onCreatorsBehalf). Whether its creator may add them
   * is asked first, on the resource as it will be saved, by the services
   * that take such picks (from their onBeforeCreate, once the caller is
   * known to be allowed to create the resource at all): the permission to
   * create the owner rows and their columns; a permission to read the
   * resource, when the rows are read through it; and the labels, blocks with
   * labels and Owned scope of the permission to create them
   * (DatabaseService.checkCreateScopeOf), by the labels the resource is
   * created with - the resource is theirs once it is saved
   * (autoOwnerOnCreate). A pick that is refused refuses the create, rather
   * than being dropped after it. Root and master admin creates add any
   * owner. Throws; returns nothing.
   */
  public static async checkOwnersPickedOnCreate<
    TOwnerUser extends BaseModel,
    TOwnerTeam extends BaseModel,
  >(data: {
    ownerUserService: DatabaseService<TOwnerUser>;
    ownerTeamService: DatabaseService<TOwnerTeam>;
    // The owner rows' column holding the resource id, e.g. "monitorId".
    resourceIdColumn: string;
    resourceModelType: { new (): BaseModel };
    // The resource as it will be saved.
    resource: BaseModel;
    miscDataProps?: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const props: DatabaseCommonInteractionProps = data.props;

    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    const isPicked: (key: string) => boolean = (key: string): boolean => {
      const value: unknown = data.miscDataProps?.[key];
      return Array.isArray(value) && value.length > 0;
    };

    const ownerKinds: Array<{
      ownerService: DatabaseService<BaseModel>;
      ownerColumn: "userId" | "teamId";
    }> = [];

    if (isPicked("ownerUsers")) {
      ownerKinds.push({
        ownerService:
          data.ownerUserService as unknown as DatabaseService<BaseModel>,
        ownerColumn: "userId",
      });
    }

    if (isPicked("ownerTeams")) {
      ownerKinds.push({
        ownerService:
          data.ownerTeamService as unknown as DatabaseService<BaseModel>,
        ownerColumn: "teamId",
      });
    }

    if (ownerKinds.length === 0) {
      return;
    }

    const tenantColumn: string | null = data.resource.getTenantColumn();
    const tenantValue: unknown = tenantColumn
      ? data.resource.getColumnValue(tenantColumn)
      : undefined;
    const projectId: ObjectID | undefined =
      props.tenantId ||
      (tenantValue ? new ObjectID(tenantValue.toString()) : undefined);

    const labelsColumn: string | null = data.resource.getAccessControlColumn();

    // Not saved yet: the owner rows name it by a placeholder id.
    const pending: PendingRecord = {
      modelType: data.resourceModelType,
      id: ObjectID.generate(),
      labelIds: labelsColumn
        ? resolveReferenceIds(data.resource.getColumnValue(labelsColumn)).map(
            (labelId: ObjectID | string): string => {
              return labelId.toString();
            },
          )
        : [],
      ownedByCreator:
        Boolean(props.userId) &&
        OwnedScopePermission.hasOwnerTables(data.resourceModelType),
    };

    for (const ownerKind of ownerKinds) {
      const owner: BaseModel = new ownerKind.ownerService.modelType();

      owner.setColumnValue(data.resourceIdColumn, pending.id);
      // Any owner checks the same columns: who it is is checked when it is added.
      owner.setColumnValue(ownerKind.ownerColumn, ObjectID.generate());

      if (projectId) {
        owner.setColumnValue("projectId", projectId);
      }

      CreatePermission.checkCreatePermissions(
        ownerKind.ownerService.modelType,
        owner,
        props,
      );

      if (owner.canAccessIfCanReadOn) {
        BasePermission.isHeldToParentRead(
          ownerKind.ownerService.modelType,
          data.resourceModelType,
          props,
          DatabaseRequestType.Create,
        );
      }

      await ownerKind.ownerService.checkCreateScopeOf({
        row: owner,
        props: props,
        pending: pending,
      });
    }
  }

  /*
   * The owners picked in a create form - its misc data's ownerUsers and
   * ownerTeams - copied as they are now, before a service adds owners of its
   * own to them (an incident declared from a template takes the template's).
   */
  public static getOwnersPicked(
    miscDataProps?: JSONObject | undefined,
  ): JSONObject {
    const picked: JSONObject = {};

    for (const key of ["ownerUsers", "ownerTeams"]) {
      const value: unknown = miscDataProps?.[key];

      if (Array.isArray(value)) {
        picked[key] = [...value] as Array<ObjectID>;
      }
    }

    return picked;
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
    // The owners picked when the resource was created. See createOwner.
    onCreatorsBehalf?: boolean | undefined;
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
          onCreatorsBehalf: data.onCreatorsBehalf,
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
          onCreatorsBehalf: data.onCreatorsBehalf,
        })
      ) {
        added.userIds.push(userId);
      }
    }

    return added;
  }

  /*
   * A user owner must be a member of the project, the invitation accepted:
   * see TeamMemberService.isUserMemberOfProject. A team owner is checked by
   * the owner service when the row is written (see createOwner).
   */
  private static async isOwnerInProject<TOwner extends BaseModel>(data: {
    owner: TOwner;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    const userId: string | undefined = data.owner
      .getColumnValue("userId")
      ?.toString();

    const projectId: string | undefined =
      data.owner.getColumnValue("projectId")?.toString() ||
      data.props.tenantId?.toString();

    if (!userId || !projectId) {
      return true;
    }

    return await TeamMemberService.isUserMemberOfProject({
      projectId: new ObjectID(projectId),
      userId: new ObjectID(userId),
    });
  }

  /*
   * One owner row of the resource, for createOwner: the resource, the
   * project and the user or team, and the notified flag and creator when
   * given. Public so a caller that adds owners one at a time, each failure
   * on its own (the grouping rule engines), builds the same rows addOwners
   * does.
   */
  public static buildOwner<TOwner extends BaseModel>(data: {
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
