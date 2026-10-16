import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import CustomRoleSync from "../Utils/CustomRole/CustomRoleSync";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import CustomRolePermissionService from "./CustomRolePermissionService";
import CustomRoleService from "./CustomRoleService";
import ProjectReferencesService from "./ProjectReferencesService";
import TeamPermissionService from "./TeamPermissionService";
import TeamService from "./TeamService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import {
  getCustomRoleGrantRefusedMessage,
  TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE,
} from "../../Types/Team/CustomRole";
import CustomRole from "../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../Models/DatabaseModels/Label";
import Team from "../../Models/DatabaseModels/Team";
import Model from "../../Models/DatabaseModels/TeamCustomRole";

/*
 * CUSTOM ROLES GIVEN TO TEAMS.
 *
 * Giving a team a role gives its members every permission in the role, so
 * it is checked as giving the team those permissions one by one would be:
 *
 *   - the team and the role are the request's project's;
 *   - the team's permissions can be changed (Owners and Admin cannot);
 *   - the giver could give the team each permission in the role, at its
 *     scope and labels (TeamPermissionService.assertCanGrantPermission) -
 *     the grant ceiling a team's own permissions are held to.
 *
 * Once given, the team holds a copy of each of the role's permissions
 * (CustomRoleSync), and its members' cached permissions are rebuilt. If the
 * copies cannot be made the role is taken from the team again and the give
 * refused. Taking a role away takes the copies in the same DELETE (ON
 * DELETE CASCADE), and the members' cached permissions are rebuilt after.
 */

interface TeamsLosingRoles {
  projectId: ObjectID;
  teamIds: Array<ObjectID>;
}

export class Service extends ProjectReferencesService<Model> {
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
        "Custom roles can only be given to teams inside the current project.",
      );
    }
  }

  /*
   * Refuses someone who could not give `team` every permission of `role`
   * directly. Nothing is refused to OneUptime or a master admin, as on a
   * team's own permissions.
   */
  @CaptureSpan()
  public async assertCanGiveRole(data: {
    customRoleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (TeamPermissionService.canGrantEveryPermission(data.props)) {
      return;
    }

    const role: CustomRole | null = await CustomRoleService.findOneBy({
      query: {
        _id: data.customRoleId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!role) {
      throw new BadDataException("Invalid Custom Role ID");
    }

    const permissions: Array<CustomRolePermission> =
      await CustomRolePermissionService.findPermissionsOfRole({
        customRoleId: data.customRoleId,
        projectId: data.projectId,
      });

    for (const permission of permissions) {
      try {
        TeamPermissionService.assertCanGrantPermission({
          permission: permission.permission!,
          labelIds: (permission.labels || [])
            .map((label: Label): ObjectID | null => {
              return label.id;
            })
            .filter((labelId: ObjectID | null): labelId is ObjectID => {
              return Boolean(labelId);
            }),
          scope: permission.scope,
          props: data.props,
        });
      } catch (err) {
        if (err instanceof NotAuthorizedException) {
          throw new NotAuthorizedException(
            getCustomRoleGrantRefusedMessage({
              roleName: role.name || "this role",
              permission: permission.permission!,
            }),
          );
        }

        throw err;
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const projectId: ObjectID | undefined =
      createBy.props.isRoot || createBy.props.isMasterAdmin
        ? createBy.data.projectId || createBy.props.tenantId
        : createBy.props.tenantId || createBy.data.projectId;

    if (!projectId) {
      throw new BadDataException(
        "Project ID is required to give a custom role to a team.",
      );
    }

    this.assertProjectMatchesTenant(projectId, createBy.props);

    if (!createBy.data.teamId) {
      throw new BadDataException(
        "Team ID is required to give a custom role to a team.",
      );
    }

    if (!createBy.data.customRoleId) {
      throw new BadDataException(
        "Custom Role ID is required to give a custom role to a team.",
      );
    }

    /*
     * The team and the role are read together with the project: an id from
     * another project is never enough to give anything.
     */
    const team: Team | null = await TeamService.findOneBy({
      query: {
        _id: createBy.data.teamId,
        projectId: projectId,
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
      throw new BadDataException(TEAM_NOT_EDITABLE_FOR_ROLES_MESSAGE);
    }

    await this.assertCanGiveRole({
      customRoleId: createBy.data.customRoleId,
      projectId: projectId,
      props: createBy.props,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const projectId: ObjectID = createdItem.projectId!;

    try {
      await CustomRoleSync.syncRoles({
        projectId: projectId,
        customRoleIds: [createdItem.customRoleId!],
      });
    } catch (err) {
      /*
       * The team could not be given the role's permissions: take the role
       * from it again (its copies go with it), and refuse the give.
       */
      logger.error(err, {
        projectId: projectId.toString(),
      } as LogAttributes);

      await this.deleteBy({
        query: {
          _id: createdItem.id!,
          projectId: projectId,
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      await CustomRoleSync.refreshMembersOfTeams({
        projectId: projectId,
        teamIds: [createdItem.teamId!],
      });

      throw err;
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        teamId: true,
      },
    );

    const byProject: Map<string, TeamsLosingRoles> = new Map<
      string,
      TeamsLosingRoles
    >();

    for (const row of rows) {
      if (!row.projectId || !row.teamId) {
        continue;
      }

      this.assertProjectMatchesTenant(row.projectId, deleteBy.props);

      const teams: TeamsLosingRoles = byProject.get(
        row.projectId.toString(),
      ) || {
        projectId: row.projectId,
        teamIds: [],
      };

      teams.teamIds.push(row.teamId);
      byProject.set(row.projectId.toString(), teams);
    }

    return { deleteBy, carryForward: Array.from(byProject.values()) };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const teamsLosingRoles: Array<TeamsLosingRoles> =
      (onDelete.carryForward as Array<TeamsLosingRoles> | null) || [];

    for (const teams of teamsLosingRoles) {
      await CustomRoleSync.refreshMembersOfTeams({
        projectId: teams.projectId,
        teamIds: teams.teamIds,
      });
    }

    return onDelete;
  }
}

export default new Service();
