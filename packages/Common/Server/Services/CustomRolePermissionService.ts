import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CustomRoleSync from "../Utils/CustomRole/CustomRoleSync";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ApiKeyPermissionService from "./ApiKeyPermissionService";
import CustomRoleService from "./CustomRoleService";
import ProjectReferencesService from "./ProjectReferencesService";
import TeamPermissionService from "./TeamPermissionService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  getCustomRoleDuplicatePermissionMessage,
  getCustomRolePermissionProblem,
  UNKNOWN_SCOPE_MESSAGE,
} from "../../Types/Team/CustomRole";
import CustomRole from "../../Models/DatabaseModels/CustomRole";
import Label from "../../Models/DatabaseModels/Label";
import Model from "../../Models/DatabaseModels/CustomRolePermission";

/*
 * THE PERMISSIONS IN A CUSTOM ROLE.
 *
 * Each is checked as a team's own permission is, and more strictly:
 *
 *   - only what a team may be given, never Project Owner, with a scope the
 *     permission takes and labels only with the scope Labels
 *     (Types/Team/CustomRole);
 *   - once per role;
 *   - only by someone who could give the same permission, at the same
 *     scope and labels, to a team directly - the grant ceiling of team
 *     permissions (TeamPermissionService.assertCanGrantPermission), on a
 *     create and on every change. A role is given to teams and API keys, so
 *     putting a permission into one is giving it. The ceiling of a key's
 *     own permissions (ApiKeyPermissionService.assertCallerCanGrantPermission)
 *     is never stricter than the team one for what a key's copy holds - the
 *     role's permission, with its labels - so what passes here could be
 *     given to every key with the role directly too
 *     (Tests/Server/Services/ApiKeyCeilingWithinTeamCeiling holds the two
 *     to that).
 *
 * Every team and every API key given the role holds a copy of each of its
 * permissions (CustomRoleSync) - a key of each that applies to a key:
 *
 *   - added: the copies are made on every team with the role, and the
 *     members' cached permissions rebuilt. If they cannot be made, the
 *     permission is taken out of the role again and the add refused, so
 *     the role never says more than its teams hold;
 *   - changed: the old copies are deleted before the change is written
 *     (onUpdatePermitted) and the new ones made once it is, so no team ever
 *     holds the old scope while the role holds the new - and a change that
 *     fails puts the copies back as the role is;
 *   - removed: the copies go in the same DELETE (ON DELETE CASCADE) and the
 *     members' cached permissions are rebuilt, and the keys' forgotten on
 *     every server.
 *
 * The role's permission count (CustomRole.permissionCount) is counted
 * again after each add and removal.
 */

interface ChangedRolePermissions {
  projectId: ObjectID;
  customRoleIds: Array<ObjectID>;
  rolePermissionIds: Array<ObjectID>;
  teamIds: Array<ObjectID>;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  private getLabelIds(
    labels: Array<Label> | null | undefined,
  ): Array<ObjectID> {
    return (labels || [])
      .map((label: Label): ObjectID | null => {
        return label.id;
      })
      .filter((labelId: ObjectID | null): labelId is ObjectID => {
        return Boolean(labelId);
      });
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
        "Custom roles can only be changed inside the current project.",
      );
    }
  }

  // The permission as written, or the refusal of it.
  private assertPermissionCanBeInRole(data: {
    permission: Permission | undefined;
    scope: PermissionScope | undefined;
    labelIds: Array<ObjectID>;
  }): void {
    const problem: string | null = getCustomRolePermissionProblem({
      permission: data.permission,
      scope: data.scope,
      labelIds: data.labelIds,
    });

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  private async getRole(data: {
    customRoleId: ObjectID;
    projectId: ObjectID;
  }): Promise<CustomRole> {
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

    return role;
  }

  // Refuses a second row of the same permission in a role (`exceptId` aside).
  private async assertNotInRoleAlready(data: {
    role: CustomRole;
    projectId: ObjectID;
    permission: Permission;
    exceptId?: ObjectID | undefined;
  }): Promise<void> {
    const sameRows: Array<Model> = await this.findBy({
      query: {
        customRoleId: data.role.id!,
        projectId: data.projectId,
        permission: data.permission,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: 2,
      props: {
        isRoot: true,
      },
    });

    const clash: Model | undefined = sameRows.find((row: Model): boolean => {
      return !data.exceptId || row.id?.toString() !== data.exceptId.toString();
    });

    if (clash) {
      throw new BadDataException(
        getCustomRoleDuplicatePermissionMessage({
          roleName: data.role.name || "This role",
          permission: data.permission,
        }),
      );
    }
  }

  // Counts a role's permissions again, as the role's own column says it.
  @CaptureSpan()
  public async recountPermissions(data: {
    customRoleId: ObjectID;
    projectId: ObjectID;
  }): Promise<number> {
    const count: number = (
      await this.countBy({
        query: {
          customRoleId: data.customRoleId,
          projectId: data.projectId,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    await CustomRoleService.updateOneBy({
      query: {
        _id: data.customRoleId,
        projectId: data.projectId,
      },
      data: {
        permissionCount: count,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return count;
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
        "Project ID is required to add a permission to a custom role.",
      );
    }

    this.assertProjectMatchesTenant(projectId, createBy.props);

    if (!createBy.data.customRoleId) {
      throw new BadDataException(
        "Custom Role ID is required to add a permission to a custom role.",
      );
    }

    const labelIds: Array<ObjectID> = this.getLabelIds(createBy.data.labels);

    this.assertPermissionCanBeInRole({
      permission: createBy.data.permission,
      scope: createBy.data.scope,
      labelIds: labelIds,
    });

    const role: CustomRole = await this.getRole({
      customRoleId: createBy.data.customRoleId,
      projectId: projectId,
    });

    await this.assertNotInRoleAlready({
      role: role,
      projectId: projectId,
      permission: createBy.data.permission!,
    });

    /*
     * Putting a permission into a role gives it to every team with the
     * role, now and later: only someone who could give it to a team
     * directly may.
     */
    TeamPermissionService.assertCanGrantPermission({
      permission: createBy.data.permission!,
      labelIds: labelIds,
      scope: createBy.data.scope,
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
    const customRoleId: ObjectID = createdItem.customRoleId!;

    try {
      await CustomRoleSync.syncRoles({
        projectId: projectId,
        customRoleIds: [customRoleId],
      });
    } catch (err) {
      /*
       * The teams with the role could not be given the permission: take it
       * out of the role again, so the role never says more than its teams
       * hold, and refuse the add.
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

      // A key's copy made before the sync failed went with it: forget it everywhere.
      await ApiKeyPermissionService.forgetPermissionsOfProjects([projectId]);

      await this.recountPermissions({
        customRoleId: customRoleId,
        projectId: projectId,
      });

      throw err;
    }

    await this.recountPermissions({
      customRoleId: customRoleId,
      projectId: projectId,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        customRoleId: true,
        permission: true,
        scope: true,
        labels: {
          _id: true,
        },
      },
    );

    const rawUpdateData: {
      permission?: unknown;
      labels?: unknown;
      scope?: unknown;
    } = updateBy.data as unknown as {
      permission?: unknown;
      labels?: unknown;
      scope?: unknown;
    };

    if (rawUpdateData.scope === null) {
      throw new BadDataException(UNKNOWN_SCOPE_MESSAGE);
    }

    for (const row of rows) {
      this.assertProjectMatchesTenant(row.projectId!, updateBy.props);

      const requestedPermission: Permission | undefined =
        typeof rawUpdateData.permission === "string"
          ? (rawUpdateData.permission as Permission)
          : rawUpdateData.permission === undefined
            ? row.permission
            : undefined;
      const requestedLabels: Array<Label> =
        rawUpdateData.labels === null
          ? []
          : Array.isArray(rawUpdateData.labels)
            ? (rawUpdateData.labels as Array<Label>)
            : row.labels || [];
      const requestedScope: PermissionScope | undefined =
        typeof rawUpdateData.scope === "string"
          ? (rawUpdateData.scope as PermissionScope)
          : rawUpdateData.scope === undefined
            ? row.scope
            : undefined;
      const requestedLabelIds: Array<ObjectID> =
        this.getLabelIds(requestedLabels);

      this.assertPermissionCanBeInRole({
        permission: requestedPermission,
        scope: requestedScope,
        labelIds: requestedLabelIds,
      });

      if (requestedPermission !== row.permission) {
        await this.assertNotInRoleAlready({
          role: await this.getRole({
            customRoleId: row.customRoleId!,
            projectId: row.projectId!,
          }),
          projectId: row.projectId!,
          permission: requestedPermission!,
          exceptId: row.id!,
        });
      }

      /*
       * What the row will give every team with the role, checked as giving
       * it to a team directly is - whatever the change is.
       */
      TeamPermissionService.assertCanGrantPermission({
        permission: requestedPermission!,
        labelIds: requestedLabelIds,
        scope: requestedScope,
        props: updateBy.props,
      });
    }

    if (
      typeof rawUpdateData.permission === "string" &&
      rows.length > 1 &&
      new Set<string>(
        rows.map((row: Model): string => {
          return row.customRoleId?.toString() || "";
        }),
      ).size < rows.length
    ) {
      // Two rows of one role made the same permission would be one permission twice.
      throw new BadDataException(
        "Change the permission of one row of a role at a time: a role holds each permission once.",
      );
    }

    return { updateBy, carryForward: this.getChangedRolePermissions(rows) };
  }

  /*
   * The change is about to be written: the copies of the rows it changes go
   * first, so that no team holds the old permission while the role holds
   * the new (the copies of the new are made in onUpdateSuccess).
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
      },
    );

    for (const changed of this.getChangedRolePermissions(rows)) {
      await CustomRoleSync.removeCopiesOfRolePermissions({
        projectId: changed.projectId,
        customRolePermissionIds: changed.rolePermissionIds,
      });
    }
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await this.syncChangedRoles(onUpdate.carryForward);

    return onUpdate;
  }

  /*
   * A change that failed after its copies were deleted: the copies are made
   * again as the role now is, so its teams keep what it gives.
   */
  @CaptureSpan()
  protected override async onUpdateError(
    error: Exception,
    onUpdate?: OnUpdate<Model> | undefined,
  ): Promise<Exception> {
    try {
      await this.syncChangedRoles(onUpdate?.carryForward);
    } catch (err) {
      logger.error(err);
    }

    return error;
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
        customRoleId: true,
      },
    );

    for (const row of rows) {
      this.assertProjectMatchesTenant(row.projectId!, deleteBy.props);
    }

    const changed: Array<ChangedRolePermissions> =
      this.getChangedRolePermissions(rows);

    // The teams that lose the copies, read while the role still names them.
    for (const change of changed) {
      change.teamIds = await CustomRoleSync.getTeamIdsGivenRoles({
        projectId: change.projectId,
        customRoleIds: change.customRoleIds,
      });
    }

    return { deleteBy, carryForward: changed };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const changed: Array<ChangedRolePermissions> =
      (onDelete.carryForward as Array<ChangedRolePermissions> | null) || [];

    for (const change of changed) {
      for (const customRoleId of change.customRoleIds) {
        await this.recountPermissions({
          customRoleId: customRoleId,
          projectId: change.projectId,
        });
      }

      await CustomRoleSync.refreshMembersOfTeams({
        projectId: change.projectId,
        teamIds: change.teamIds,
      });
    }

    // The keys' copies went in the same DELETE: every server stops serving them now.
    await ApiKeyPermissionService.forgetPermissionsOfProjects(
      changed.map((change: ChangedRolePermissions): ObjectID => {
        return change.projectId;
      }),
    );

    return onDelete;
  }

  private async syncChangedRoles(carryForward: unknown): Promise<void> {
    const changed: Array<ChangedRolePermissions> =
      (carryForward as Array<ChangedRolePermissions> | null | undefined) || [];

    for (const change of changed) {
      await CustomRoleSync.syncRoles({
        projectId: change.projectId,
        customRoleIds: change.customRoleIds,
      });
    }
  }

  // The rows of a write, by project: their roles and their own ids.
  private getChangedRolePermissions(
    rows: Array<Model>,
  ): Array<ChangedRolePermissions> {
    const byProject: Map<string, ChangedRolePermissions> = new Map<
      string,
      ChangedRolePermissions
    >();

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      const key: string = row.projectId.toString();
      const changed: ChangedRolePermissions = byProject.get(key) || {
        projectId: row.projectId,
        customRoleIds: [],
        rolePermissionIds: [],
        teamIds: [],
      };

      if (
        row.customRoleId &&
        !changed.customRoleIds.some((id: ObjectID): boolean => {
          return id.toString() === row.customRoleId!.toString();
        })
      ) {
        changed.customRoleIds.push(row.customRoleId);
      }

      if (row.id) {
        changed.rolePermissionIds.push(row.id);
      }

      byProject.set(key, changed);
    }

    return Array.from(byProject.values());
  }

  // Every permission of a role, with its scope and labels.
  @CaptureSpan()
  public async findPermissionsOfRole(data: {
    customRoleId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<Model>> {
    return await this.findAllBy({
      query: {
        customRoleId: data.customRoleId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        permission: true,
        scope: true,
        labels: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
