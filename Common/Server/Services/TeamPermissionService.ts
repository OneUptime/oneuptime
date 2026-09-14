import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import AccessTokenService from "./AccessTokenService";
import DatabaseService from "./DatabaseService";
import TeamMemberService from "./TeamMemberService";
import TeamService from "./TeamService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserPermission } from "../../Types/Permission";
import Label from "../../Models/DatabaseModels/Label";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import Model from "../../Models/DatabaseModels/TeamPermission";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  private assertProjectMatchesTenant(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    if (!props.tenantId || props.tenantId.toString() !== projectId.toString()) {
      throw new NotAuthorizedException(
        "Team permissions can only be managed inside the current project.",
      );
    }
  }

  private getLabelIds(labels: Array<Label> | undefined): Array<ObjectID> {
    return (labels || [])
      .map((label: Label) => {
        return label.id;
      })
      .filter((labelId: ObjectID | null): labelId is ObjectID => {
        return Boolean(labelId);
      });
  }

  private permissionCoversGrant(
    callerPermission: UserPermission,
    targetScope: PermissionScope | undefined,
    targetLabelIds: Array<ObjectID>,
  ): boolean {
    const callerLabelIds: Array<ObjectID> = callerPermission.labelIds || [];
    const callerHasAllScope: boolean =
      callerPermission.scope === PermissionScope.All ||
      (!callerPermission.scope && callerLabelIds.length === 0) ||
      (callerPermission.scope === PermissionScope.Labels &&
        callerLabelIds.length === 0);

    if (callerHasAllScope) {
      return true;
    }

    const targetHasLabelScope: boolean =
      targetLabelIds.length > 0 &&
      targetScope !== PermissionScope.All &&
      targetScope !== PermissionScope.Owned;

    if (
      !targetHasLabelScope ||
      callerPermission.scope === PermissionScope.Owned
    ) {
      return false;
    }

    const callerLabelIdStrings: Set<string> = new Set<string>(
      callerLabelIds.map((labelId: ObjectID) => {
        return labelId.toString();
      }),
    );

    return targetLabelIds.every((labelId: ObjectID) => {
      return callerLabelIdStrings.has(labelId.toString());
    });
  }

  /**
   * A permission editor may only delegate authority they already hold. This
   * is deliberately stricter than the table-level "may edit team
   * permissions" check: that capability grants access to the editor, not a
   * path to mint ProjectOwner (or any unrelated role) for their own team.
   */
  public assertCanGrantPermission(data: {
    permission: Permission;
    labelIds?: Array<ObjectID> | undefined;
    scope?: PermissionScope | undefined;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const callerPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        data.props,
        PermissionType.Allow,
      );

    /*
     * ProjectOwner is the sole tenant-level delegation override. In
     * particular, ProjectAdmin is not a synonym for every project
     * permission: destructive and billing capabilities such as
     * DeleteProject and ManageProjectBilling are intentionally withheld from
     * it. Every non-owner therefore falls through to the exact permission and
     * scope comparison below, including ProjectAdmin.
     */
    if (
      callerPermissions.some((permission: UserPermission) => {
        return permission.permission === Permission.ProjectOwner;
      })
    ) {
      return;
    }

    const targetLabelIds: Array<ObjectID> = data.labelIds || [];
    const canDelegate: boolean = callerPermissions
      .filter((permission: UserPermission) => {
        return permission.permission === data.permission;
      })
      .some((permission: UserPermission) => {
        return this.permissionCoversGrant(
          permission,
          data.scope,
          targetLabelIds,
        );
      });

    if (!canDelegate) {
      throw new NotAuthorizedException(
        `You cannot grant ${data.permission} because your own access does not include that permission at an equal or broader scope.`,
      );
    }
  }

  /**
   * Adding a user to a team delegates every allow and block row on that team.
   * Apply the same grant ceiling used when rows are created so an inviter
   * cannot join (or invite an accomplice to) a more privileged team.
   */
  @CaptureSpan()
  public async assertCanGrantTeamPermissions(data: {
    teamId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    this.assertProjectMatchesTenant(data.projectId, data.props);

    const permissions: Array<Model> = await this.findBy({
      query: {
        teamId: data.teamId,
        projectId: data.projectId,
      },
      select: {
        permission: true,
        labels: {
          _id: true,
        },
        scope: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const permission of permissions) {
      this.assertCanGrantPermission({
        permission: permission.permission!,
        labelIds: this.getLabelIds(permission.labels),
        scope: permission.scope,
        props: data.props,
      });
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.teamId) {
      throw new BadDataException("Team Id is required to create permission");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Project Id is required to create permission");
    }

    if (!createBy.data.permission) {
      throw new BadDataException("Permission is required to create permission");
    }

    this.assertProjectMatchesTenant(createBy.data.projectId, createBy.props);

    /*
     * Resolve the team and project together. A globally valid team ID from a
     * different tenant must never be enough to attach a permission row.
     */
    const team: Team | null = await TeamService.findOneBy({
      query: {
        _id: createBy.data.teamId,
        projectId: createBy.data.projectId,
      },
      select: {
        isPermissionsEditable: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!team) {
      throw new BadDataException("Invalid Team ID");
    }

    if (!team.isPermissionsEditable) {
      throw new BadDataException(
        "You cannot create new permissions for this team because this team is not editable",
      );
    }

    this.assertCanGrantPermission({
      permission: createBy.data.permission,
      labelIds: this.getLabelIds(createBy.data.labels),
      scope: createBy.data.scope,
      props: createBy.props,
    });

    // check if this permission is already assigned to this team and if yes then throw error.

    const isBlockPermission: boolean = createBy.data.isBlockPermission || false;

    const existingPermission: Model | null = await this.findOneBy({
      query: {
        teamId: createBy.data.teamId,
        projectId: createBy.data.projectId,
        permission: createBy.data.permission,
        isBlockPermission: isBlockPermission,
      },
      select: {
        _id: true,
        isBlockPermission: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingPermission) {
      throw new BadDataException(
        "This permission is already assigned to this team.",
      );
    }

    if (createBy.data.labels && createBy.data.labels.length > 0) {
      // check if the

      const existingPermission: Model | null = await this.findOneBy({
        query: {
          teamId: createBy.data.teamId,
          projectId: createBy.data.projectId,
          permission: createBy.data.permission,
          isBlockPermission: !isBlockPermission,
        },
        select: {
          _id: true,
          isBlockPermission: true,
          labels: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (existingPermission && (existingPermission.labels?.length || 0) > 0) {
        // if the permission in another block has labels, this permission cannot have labels.

        const blockName: string = existingPermission.isBlockPermission
          ? "block"
          : "allow";

        throw new BadDataException(
          `Restriction labels are already assigned to this permission in the ${blockName} permission list. To assign restriction labels to this permission, remove the restriction labels from the ${blockName} permission`,
        );
      }
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const createBy: CreateBy<Model> = onCreate.createBy;

    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        teamId: createBy.data.teamId!,
        projectId: createBy.data.projectId!,
      },
      select: {
        userId: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    for (const member of teamMembers) {
      /// Refresh tokens.
      await AccessTokenService.refreshUserGlobalAccessPermission(
        member.userId!,
      );
      await AccessTokenService.refreshUserTenantAccessPermission(
        member.userId!,
        createBy.data.projectId!,
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const teamPermissions: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        teamId: true,
        projectId: true,
        permission: true,
        labels: {
          _id: true,
        },
        scope: true,
        team: {
          isPermissionsEditable: true,
        },
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const permission of teamPermissions) {
      this.assertProjectMatchesTenant(permission.projectId!, updateBy.props);

      if (!permission.team?.isPermissionsEditable) {
        throw new BadDataException(
          "Permissions for this team is not updateable. You can create a new team and add permissions to that team instead.",
        );
      }

      const rawUpdateData: {
        permission?: unknown;
        labels?: unknown;
        scope?: unknown;
      } = updateBy.data as unknown as {
        permission?: unknown;
        labels?: unknown;
        scope?: unknown;
      };
      const requestedPermission: Permission =
        typeof rawUpdateData.permission === "string"
          ? (rawUpdateData.permission as Permission)
          : permission.permission!;
      const requestedLabels: Array<Label> =
        rawUpdateData.labels === null
          ? []
          : Array.isArray(rawUpdateData.labels)
            ? (rawUpdateData.labels as Array<Label>)
            : permission.labels || [];
      const requestedScope: PermissionScope | undefined =
        typeof rawUpdateData.scope === "string"
          ? (rawUpdateData.scope as PermissionScope)
          : permission.scope;

      this.assertCanGrantPermission({
        permission: requestedPermission,
        labelIds: this.getLabelIds(requestedLabels),
        scope: requestedScope,
        props: updateBy.props,
      });
    }

    if (updateBy.data.labels && updateBy.data.labels.length > 0) {
      const existingPermissions: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          labels: true,
          isBlockPermission: true,
          projectId: true,
          teamId: true,
          permission: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const alreadySavedPermission of existingPermissions) {
        // check if the

        const isBlockPermission: boolean =
          alreadySavedPermission.isBlockPermission || false;

        const existingPermission: Model | null = await this.findOneBy({
          query: {
            teamId: alreadySavedPermission.teamId!,
            projectId: alreadySavedPermission.projectId!,
            permission: alreadySavedPermission.permission!,
            isBlockPermission: !isBlockPermission,
          },
          select: {
            _id: true,
            isBlockPermission: true,
            labels: true,
            permission: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (
          existingPermission &&
          (existingPermission.labels?.length || 0) > 0
        ) {
          // if the permission in another block has labels, this permission cannot have labels.

          const blockName: string = existingPermission.isBlockPermission
            ? "block"
            : "allow";

          throw new BadDataException(
            `Restriction labels are already assigned to ${existingPermission.permission} in the ${blockName} permission list. To assign restriction labels to this permission, remove the restriction labels from the ${blockName} list.`,
          );
        }
      }
    }

    return { updateBy, carryForward: teamPermissions };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    for (const permission of onUpdate.carryForward) {
      const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          teamId: permission.teamId!,
          projectId: permission.projectId!,
        },
        select: {
          userId: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const member of teamMembers) {
        if (!member.userId) {
          throw new BadDataException("Invalid User ID");
        }

        if (!member.projectId) {
          throw new BadDataException("Invalid Project ID");
        }

        /// Refresh tokens.
        await AccessTokenService.refreshUserGlobalAccessPermission(
          member.userId,
        );
        await AccessTokenService.refreshUserTenantAccessPermission(
          member.userId,
          member.projectId,
        );
      }
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const teamPermissions: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        teamId: true,
        projectId: true,
        team: {
          isPermissionsEditable: true,
        },
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const permission of teamPermissions) {
      if (!permission.team?.isPermissionsEditable) {
        throw new BadDataException(
          "Permissions for this team is not deleteable. You can create a new team and add permissions to that team instead.",
        );
      }
    }

    let teamMembers: Array<TeamMember> = [];

    for (const permission of teamPermissions) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          teamId: permission.teamId!,
          projectId: permission.projectId!,
        },
        select: {
          userId: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      teamMembers = teamMembers.concat(members);
    }

    return { deleteBy, carryForward: teamMembers };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    for (const member of onDelete.carryForward) {
      const teamMember: TeamMember = member as TeamMember;

      if (!teamMember.userId) {
        throw new BadDataException("Invalid User ID");
      }

      if (!teamMember.projectId) {
        throw new BadDataException("Invalid Project ID");
      }

      /// Refresh tokens.
      await AccessTokenService.refreshUserGlobalAccessPermission(
        teamMember.userId,
      );
      await AccessTokenService.refreshUserTenantAccessPermission(
        teamMember.userId,
        teamMember.projectId,
      );
    }

    return onDelete;
  }
}
export default new Service();
