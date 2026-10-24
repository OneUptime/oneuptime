import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import CustomRoleSync from "../Utils/CustomRole/CustomRoleSync";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ApiKeyPermissionService from "./ApiKeyPermissionService";
import DatabaseService from "./DatabaseService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import {
  getCustomRoleNameKey,
  getCustomRoleNameProblem,
  getCustomRoleNameTakenMessage,
  normalizeCustomRoleName,
} from "../../Types/Team/CustomRole";
import Model from "../../Models/DatabaseModels/CustomRole";

/*
 * A project's custom roles: their names, and what deleting one does.
 *
 *   - A name is given, is not a built-in role's, and is unique in the
 *     project whatever its case or spacing (Types/Team/CustomRole). It is
 *     kept trimmed, with inner runs of space made one.
 *   - Deleting a role takes, in the same DELETE, its permissions, the
 *     teams' and API keys' hold of it and every team's and key's copy of its
 *     permissions (ON DELETE CASCADE); the members of those teams have their
 *     cached permissions rebuilt right after
 *     (CustomRoleSync.refreshMembersOfTeams), and every server forgets the
 *     keys' (ApiKeyPermissionService.forgetPermissionsOfProjects).
 *
 * What a role holds is CustomRolePermissionService's, and who it is given
 * to TeamCustomRoleService's and ApiKeyCustomRoleService's.
 */

interface TeamsOfDeletedRoles {
  projectId: ObjectID;
  teamIds: Array<ObjectID>;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The project a create is for: the request's, or for OneUptime and a
   * master admin, the one the record names.
   */
  private getProjectIdOfCreate(createBy: CreateBy<Model>): ObjectID | null {
    if (
      (createBy.props.isRoot || createBy.props.isMasterAdmin) &&
      createBy.data.projectId
    ) {
      return createBy.data.projectId;
    }

    return createBy.props.tenantId || createBy.data.projectId || null;
  }

  /*
   * Refuses a name that may not be the role's: none at all, a built-in
   * role's, or another role's in the project (`exceptRoleId` aside).
   */
  @CaptureSpan()
  public async assertNameCanBeUsed(data: {
    projectId: ObjectID;
    name: string | undefined;
    exceptRoleId?: ObjectID | undefined;
  }): Promise<void> {
    const problem: string | null = getCustomRoleNameProblem(data.name);

    if (problem) {
      throw new BadDataException(problem);
    }

    const sameName: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(normalizeCustomRoleName(data.name)),
      },
      select: {
        _id: true,
        name: true,
      },
      skip: 0,
      limit: 10,
      props: {
        isRoot: true,
      },
    });

    /*
     * findWithSameText compares trimmed lower case; spacing inside the name
     * is compared here too, so "Incident  Responder" is "Incident
     * Responder".
     */
    const key: string = getCustomRoleNameKey(data.name);

    const clash: Model | undefined = sameName.find((role: Model): boolean => {
      return (
        getCustomRoleNameKey(role.name) === key &&
        (!data.exceptRoleId ||
          role.id?.toString() !== data.exceptRoleId.toString())
      );
    });

    if (clash) {
      throw new BadDataException(getCustomRoleNameTakenMessage(data.name!));
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | null = this.getProjectIdOfCreate(createBy);

    if (!projectId) {
      throw new BadDataException(
        "Project ID is required to create a custom role.",
      );
    }

    await this.assertNameCanBeUsed({
      projectId: projectId,
      name: createBy.data.name,
    });

    createBy.data.name = normalizeCustomRoleName(createBy.data.name);

    return { createBy, carryForward: null };
  }

  /*
   * A new role holds no permission yet: its count is OneUptime's to keep
   * (CustomRolePermissionService), whatever a create sends.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    onCreate.createBy.data.permissionCount = 0;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const rawName: unknown = (updateBy.data as unknown as { name?: unknown })
      .name;

    if (rawName === undefined) {
      return { updateBy, carryForward: null };
    }

    if (rawName !== null && typeof rawName !== "string") {
      throw new BadDataException("A role's name is text.");
    }

    const roles: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
      },
    );

    // Names are unique in a project: one name is never given to two roles at once.
    if (roles.length > 1) {
      throw new BadDataException(
        "Rename one role at a time: two roles can't have the same name.",
      );
    }

    for (const role of roles) {
      this.assertRoleInRequestProject(role, updateBy.props);

      await this.assertNameCanBeUsed({
        projectId: role.projectId!,
        name: (rawName as string | null) || undefined,
        exceptRoleId: role.id!,
      });
    }

    updateBy.data.name = normalizeCustomRoleName(rawName as string | null);

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const roles: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
      },
    );

    /*
     * The teams given these roles, read while the roles are still there:
     * their members' cached permissions are rebuilt once the roles, and
     * every team's copy of their permissions, are gone.
     */
    const teamsOfDeletedRoles: Array<TeamsOfDeletedRoles> = [];

    for (const projectId of this.getProjectIds(roles)) {
      const roleIds: Array<ObjectID> = roles
        .filter((role: Model): boolean => {
          return role.projectId?.toString() === projectId.toString();
        })
        .map((role: Model): ObjectID => {
          return role.id!;
        });

      teamsOfDeletedRoles.push({
        projectId: projectId,
        teamIds: await CustomRoleSync.getTeamIdsGivenRoles({
          projectId: projectId,
          customRoleIds: roleIds,
        }),
      });
    }

    return { deleteBy, carryForward: teamsOfDeletedRoles };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const teamsOfDeletedRoles: Array<TeamsOfDeletedRoles> =
      (onDelete.carryForward as Array<TeamsOfDeletedRoles> | null) || [];

    for (const teams of teamsOfDeletedRoles) {
      await CustomRoleSync.refreshMembersOfTeams({
        projectId: teams.projectId,
        teamIds: teams.teamIds,
      });
    }

    // The keys' copies went with the roles: every server stops serving them now.
    await ApiKeyPermissionService.forgetPermissionsOfProjects(
      teamsOfDeletedRoles.map((teams: TeamsOfDeletedRoles): ObjectID => {
        return teams.projectId;
      }),
    );

    return onDelete;
  }

  private getProjectIds(roles: Array<Model>): Array<ObjectID> {
    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const role of roles) {
      if (role.projectId) {
        projectIds.set(role.projectId.toString(), role.projectId);
      }
    }

    return Array.from(projectIds.values());
  }

  // A role is renamed only in the project of the request.
  private assertRoleInRequestProject(
    role: Model,
    props: DatabaseCommonInteractionProps,
  ): void {
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    if (
      !props.tenantId ||
      role.projectId?.toString() !== props.tenantId.toString()
    ) {
      throw new NotAuthorizedException(
        "Custom roles can only be changed inside the current project.",
      );
    }
  }
}

export default new Service();
