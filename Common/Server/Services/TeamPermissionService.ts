import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import AccessTokenService from "./AccessTokenService";
import DatabaseService from "./DatabaseService";
import TeamMemberService from "./TeamMemberService";
import TeamService from "./TeamService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Model from "Common/Models/DatabaseModels/TeamPermission";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

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

    // get team.
    const team: Team | null = await TeamService.findOneById({
      id: createBy.data.teamId!,
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

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const createBy: CreateBy<Model> = onCreate.createBy;

    const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        teamId: createBy.data.teamId!,
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

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const teamPermissions: Array<Model> = await this.findBy({
      query: updateBy.query,
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
          "Permissions for this team is not updateable. You can create a new team and add permissions to that team instead.",
        );
      }
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

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    for (const permission of onUpdate.carryForward) {
      const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          teamId: permission.teamId!,
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
