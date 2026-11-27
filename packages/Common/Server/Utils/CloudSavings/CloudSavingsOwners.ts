import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeam from "../../../Models/DatabaseModels/CloudResourceOwnerTeam";
import CloudResourceOwnerUser from "../../../Models/DatabaseModels/CloudResourceOwnerUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CloudSavingsPerson,
  CloudSavingsTeam,
} from "../../../Types/Cloud/CloudSavingsApiTypes";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import CloudResourceOwnerTeamService from "../../Services/CloudResourceOwnerTeamService";
import CloudResourceService from "../../Services/CloudResourceService";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";
import CloudResourceOwnerUserService from "../../Services/CloudResourceOwnerUserService";
import TeamMemberService from "../../Services/TeamMemberService";
import CallerPermission from "../Permission/CallerPermission";

/*
 * WHO MAY APPROVE A CHANGE FOR A SAVING (#11010).
 *
 * An owner of the resource: a person named as one of its owners, or a
 * member of a team that is - who knows what it is for and whether it may
 * stop. A resource nobody owns is the project's: its owners and admins
 * approve. Who may ask for one is anyone who may change the project's
 * cloud resources (the Cloud Resource permissions, as an account's are);
 * the change still waits for an approver.
 *
 * The same rule for production and for everything else: no AI rule makes
 * a change to production (CloudSavingsAi), so a production change is
 * always a person's - and that person is its owner.
 *
 * And an approver must be allowed to edit the resource itself - its edit
 * permissions, label-scoped as a CRUD update of it is - as an AI fix's
 * approver must for every resource the fix changes: the change is made as
 * OneUptime, so owning a resource one may only view approves nothing.
 */

export const CLOUD_SAVINGS_MAY_NOT_EDIT_RESOURCE: string =
  "You may not edit this cloud resource, so you cannot approve or undo a change to it. Ask someone who may edit it.";

// At most this many owners are named on a dialog or a card.
export const CLOUD_SAVINGS_MAX_OWNERS_NAMED: number = 50;

// Those who may ask OneUptime to act on a saving: who may edit cloud resources.
export const CLOUD_SAVINGS_REQUEST_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditCloudResource,
];

// Who approves a change to a resource nobody owns.
export const CLOUD_SAVINGS_UNOWNED_APPROVER_PERMISSIONS: ReadonlyArray<Permission> =
  [Permission.ProjectOwner, Permission.ProjectAdmin];

export interface CloudResourceOwners {
  // Everyone who owns it, directly or through a team.
  userIds: Set<string>;
  // Named on the dialog: the people named as owners, and the teams.
  users: Array<CloudSavingsPerson>;
  teams: Array<CloudSavingsTeam>;
}

export default class CloudSavingsOwners {
  // The owners of a resource: none for a saving about a resource OneUptime does not hold.
  public static async getOwners(data: {
    projectId: ObjectID;
    cloudResourceId?: ObjectID | undefined;
  }): Promise<CloudResourceOwners> {
    const owners: CloudResourceOwners = {
      userIds: new Set<string>(),
      users: [],
      teams: [],
    };

    if (!data.cloudResourceId) {
      return owners;
    }

    const userRows: Array<CloudResourceOwnerUser> =
      await CloudResourceOwnerUserService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: data.cloudResourceId,
        },
        select: { userId: true, user: { name: true, email: true } },
        skip: 0,
        limit: CLOUD_SAVINGS_MAX_OWNERS_NAMED,
        props: { isRoot: true },
      });

    for (const row of userRows) {
      if (!row.userId) {
        continue;
      }

      owners.userIds.add(row.userId.toString());
      owners.users.push({
        userId: row.userId.toString(),
        name: row.user?.name?.toString() || row.user?.email?.toString() || "",
      });
    }

    const teamRows: Array<CloudResourceOwnerTeam> =
      await CloudResourceOwnerTeamService.findBy({
        query: {
          projectId: data.projectId,
          cloudResourceId: data.cloudResourceId,
        },
        select: { teamId: true, team: { name: true } },
        skip: 0,
        limit: CLOUD_SAVINGS_MAX_OWNERS_NAMED,
        props: { isRoot: true },
      });
    const teamIds: Array<ObjectID> = [];

    for (const row of teamRows) {
      if (!row.teamId) {
        continue;
      }

      teamIds.push(row.teamId);
      owners.teams.push({
        teamId: row.teamId.toString(),
        name: row.team?.name || "",
      });
    }

    if (teamIds.length > 0) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          teamId: new Includes(teamIds),
          hasAcceptedInvitation: true,
        },
        select: { userId: true },
        skip: 0,
        limit: CLOUD_SAVINGS_MAX_OWNERS_NAMED * 20,
        props: { isRoot: true },
      });

      for (const member of members) {
        if (member.userId) {
          owners.userIds.add(member.userId.toString());
        }
      }
    }

    return owners;
  }

  // Whether a resource has owners: its owners approve, else the project's admins.
  public static hasOwners(owners: CloudResourceOwners): boolean {
    return owners.userIds.size > 0 || owners.teams.length > 0;
  }

  /*
   * Whether the person may approve a change to the resource: one of its
   * owners, or - for a resource nobody owns - a project owner or admin.
   */
  public static canApprove(data: {
    props: DatabaseCommonInteractionProps;
    owners: CloudResourceOwners;
    projectId: ObjectID;
  }): boolean {
    const userId: string = data.props.userId?.toString() || "";

    if (!userId) {
      return false;
    }

    if (CloudSavingsOwners.hasOwners(data.owners)) {
      return data.owners.userIds.has(userId);
    }

    return CallerPermission.holdsAnyOf(
      data.props,
      CLOUD_SAVINGS_UNOWNED_APPROVER_PERMISSIONS,
      { projectId: data.projectId },
    );
  }

  /*
   * Throws unless the person may edit the resource, as a CRUD update of it
   * would check: its edit permissions, label-scoped, and their Owned scope.
   * A saving about a resource OneUptime does not hold takes the edit
   * permissions alone.
   */
  public static async assertMayChangeResource(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    cloudResourceId?: ObjectID | undefined;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    if (!CloudSavingsOwners.canRequest(data)) {
      throw new NotAuthorizedException(CLOUD_SAVINGS_MAY_NOT_EDIT_RESOURCE);
    }

    if (!data.cloudResourceId) {
      return;
    }

    try {
      const permitted: Query<CloudResource> =
        await ModelPermission.checkUpdateQueryPermissions(
          CloudResource,
          { _id: data.cloudResourceId.toString(), projectId: data.projectId },
          {},
          {
            ...data.props,
            tenantId: data.projectId,
            isMultiTenantRequest: false,
          },
        );
      const resource: CloudResource | null =
        await CloudResourceService.findOneBy({
          query: permitted,
          select: { _id: true },
          props: { isRoot: true },
        });

      if (!resource) {
        throw new NotAuthorizedException(CLOUD_SAVINGS_MAY_NOT_EDIT_RESOURCE);
      }
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof NotAuthenticatedException ||
        error instanceof NotFoundException
      ) {
        throw new NotAuthorizedException(CLOUD_SAVINGS_MAY_NOT_EDIT_RESOURCE);
      }

      throw error;
    }
  }

  // Whether the person may edit the resource (assertMayChangeResource).
  public static async mayChangeResource(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    cloudResourceId?: ObjectID | undefined;
  }): Promise<boolean> {
    try {
      await CloudSavingsOwners.assertMayChangeResource(data);
      return true;
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return false;
      }

      throw error;
    }
  }

  /*
   * Whether the person approves a change to the resource: one who may
   * approve it (canApprove) and may edit it (assertMayChangeResource).
   */
  public static async isApprover(data: {
    props: DatabaseCommonInteractionProps;
    owners: CloudResourceOwners;
    projectId: ObjectID;
    cloudResourceId?: ObjectID | undefined;
  }): Promise<boolean> {
    return (
      CloudSavingsOwners.canApprove(data) &&
      (await CloudSavingsOwners.mayChangeResource(data))
    );
  }

  // Whether the person may ask for a change at all.
  public static canRequest(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): boolean {
    return (
      Boolean(data.props.userId) &&
      CallerPermission.holdsAnyOf(
        data.props,
        CLOUD_SAVINGS_REQUEST_PERMISSIONS,
        { projectId: data.projectId },
      )
    );
  }
}
