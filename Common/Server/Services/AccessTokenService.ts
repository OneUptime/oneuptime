import GlobalCache from "../Infrastructure/GlobalCache";
import QueryHelper from "../Types/Database/QueryHelper";
import BaseService from "./BaseService";
import TeamMemberService from "./TeamMemberService";
import TeamPermissionService from "./TeamPermissionService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import Label from "../../Models/DatabaseModels/Label";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../Models/DatabaseModels/TeamPermission";
import UserPermissionUtil from "../Utils/UserPermission/UserPermission";
import PermissionNamespace from "../Types/Permission/PermissionNamespace";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class AccessTokenService extends BaseService {
  public constructor() {
    super();
  }

  @CaptureSpan()
  public async refreshUserAllPermissions(userId: ObjectID): Promise<void> {
    await this.refreshUserGlobalAccessPermission(userId);

    // query for all projects user belongs to.
    let teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: userId,
        hasAcceptedInvitation: true,
      },
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (!teamMembers) {
      teamMembers = [];
    }

    if (teamMembers.length === 0) {
      return;
    }

    const projectIds: Array<ObjectID> = teamMembers.map(
      (teamMember: TeamMember) => {
        return teamMember.projectId!;
      },
    );

    for (const projectId of projectIds) {
      await this.refreshUserTenantAccessPermission(userId, projectId);
    }
  }

  @CaptureSpan()
  public async refreshUserGlobalAccessPermission(
    userId: ObjectID,
  ): Promise<UserGlobalAccessPermission> {
    // query for all projects user belongs to.
    let teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: userId,
        hasAcceptedInvitation: true,
      },
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (!teamMembers) {
      teamMembers = [];
    }

    const projectIds: Array<ObjectID> = teamMembers.map(
      (teamMember: TeamMember) => {
        return teamMember.projectId!;
      },
    );

    const permissionToStore: UserGlobalAccessPermission = {
      projectIds,
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ],
      _type: "UserGlobalAccessPermission",
    };

    await GlobalCache.setJSON("user", userId.toString(), permissionToStore);

    return permissionToStore;
  }

  @CaptureSpan()
  public async getUserGlobalAccessPermission(
    userId: ObjectID,
  ): Promise<UserGlobalAccessPermission | null> {
    const json: UserGlobalAccessPermission | null =
      await UserPermissionUtil.getUserGlobalAccessPermissionFromCache(userId);

    if (!json) {
      return await this.refreshUserGlobalAccessPermission(userId);
    }

    return json;
  }

  @CaptureSpan()
  public async refreshUserTenantAccessPermission(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<UserTenantAccessPermission | null> {
    // query for all projects user belongs to.
    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        hasAcceptedInvitation: true,
      },
      select: {
        teamId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const teamIds: Array<ObjectID> = teamMembers.map(
      (teamMember: TeamMember) => {
        return teamMember.teamId!;
      },
    );

    if (teamIds.length === 0) {
      return null;
    }

    // get team permissions.
    const teamPermissions: Array<TeamPermission> =
      await TeamPermissionService.findBy({
        query: {
          teamId: QueryHelper.any(teamIds),
        },
        select: {
          permission: true,
          labels: {
            _id: true,
          },
          isBlockPermission: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const userPermissions: Array<UserPermission> = [];

    for (const teamPermission of teamPermissions) {
      if (!teamPermission.labels) {
        teamPermission.labels = [];
      }

      userPermissions.push({
        permission: teamPermission.permission!,
        labelIds: teamPermission.labels.map((label: Label) => {
          return label.id!;
        }),
        isBlockPermission: teamPermission.isBlockPermission,
        _type: "UserPermission",
      });
    }

    const permission: UserTenantAccessPermission =
      UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId);

    permission.permissions = permission.permissions.concat(userPermissions);

    await GlobalCache.setJSON(
      PermissionNamespace.ProjectPermission,
      userId.toString() + projectId.toString(),
      permission,
    );

    return permission;
  }

  @CaptureSpan()
  public async getDatabaseCommonInteractionPropsByUserAndProject(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<DatabaseCommonInteractionProps> {
    const { userId, projectId } = data;

    return {
      userId: userId,
      userGlobalAccessPermission:
        (await this.getUserGlobalAccessPermission(userId)) || undefined,
      userTenantAccessPermission: {
        [projectId.toString()]: (await this.getUserTenantAccessPermission(
          userId,
          projectId,
        ))!,
      },
      tenantId: projectId,
    };
  }

  @CaptureSpan()
  public async getUserTenantAccessPermission(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<UserTenantAccessPermission | null> {
    const json: UserTenantAccessPermission | null =
      await UserPermissionUtil.getUserTenantAccessPermissionFromCache(
        userId,
        projectId,
      );

    if (!json) {
      return await this.refreshUserTenantAccessPermission(userId, projectId);
    }

    return json;
  }
}

export default new AccessTokenService();
