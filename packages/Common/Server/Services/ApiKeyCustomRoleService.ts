import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import CustomRoleSync from "../Utils/CustomRole/CustomRoleSync";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ApiKeyPermissionService from "./ApiKeyPermissionService";
import ApiKeyService from "./ApiKeyService";
import CustomRolePermissionService from "./CustomRolePermissionService";
import CustomRoleService from "./CustomRoleService";
import ProjectReferencesService from "./ProjectReferencesService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import {
  CUSTOM_ROLE_NOT_READABLE_MESSAGE,
  getCustomRoleGrantRefusedMessage,
} from "../../Types/Team/CustomRole";
import { getApiKeyCopyLabels } from "../../Types/Team/CustomRoleCopyPlan";
import ApiKey from "../../Models/DatabaseModels/ApiKey";
import CustomRole from "../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../Models/DatabaseModels/Label";
import Model from "../../Models/DatabaseModels/ApiKeyCustomRole";

/*
 * CUSTOM ROLES GIVEN TO API KEYS.
 *
 * Giving a key a role gives it every permission of the role that applies to
 * a key (all but those the role limits to what its holder owns: a key owns
 * nothing - Types/Team/CustomRoleCopyPlan), so it is checked as giving the
 * key those permissions one by one would be:
 *
 *   - the key and the role are the request's project's;
 *   - the giver may read the project's custom roles: the role is read with
 *     their own read of it, so someone who may change what a key can do but
 *     not see the roles gives none of them;
 *   - the giver could give the key each of those permissions directly, with
 *     its labels (ApiKeyPermissionService.assertCallerCanGrantPermission) -
 *     the grant ceiling a key's own permissions are held to, so a key never
 *     holds through a role what its giver could not give it.
 *
 * Once given, the key holds a copy of each of those permissions
 * (CustomRoleSync), and every server stops serving what it read of the key
 * before. If the copies cannot be made the role is taken from the key again
 * and the give refused. Taking a role away takes the copies in the same
 * DELETE (ON DELETE CASCADE), and every server stops serving them at once.
 */

interface ApiKeysLosingRoles {
  projectIds: Array<ObjectID>;
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
        "Custom roles can only be given to API keys inside the current project.",
      );
    }
  }

  /*
   * The role, read as the giver may read it: a giver who may not read the
   * project's custom roles is refused, in words that say so. OneUptime and a
   * master admin read it as OneUptime.
   */
  private async readRoleAsGiver(data: {
    customRoleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CustomRole> {
    const isOneUptime: boolean = Boolean(
      data.props.isRoot || data.props.isMasterAdmin,
    );

    let role: CustomRole | null = null;

    try {
      role = await CustomRoleService.findOneBy({
        query: {
          _id: data.customRoleId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        props: isOneUptime
          ? {
              isRoot: true,
            }
          : {
              ...data.props,
              tenantId: data.projectId,
            },
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(CUSTOM_ROLE_NOT_READABLE_MESSAGE);
      }

      throw err;
    }

    if (!role) {
      throw new BadDataException("Invalid Custom Role ID");
    }

    return role;
  }

  /*
   * Refuses someone who could not give `apiKey` every permission of `role`
   * it would hold, or who may not read the role. Nothing is refused to
   * OneUptime or a master admin, as on a key's own permissions.
   */
  @CaptureSpan()
  public async assertCanGiveRole(data: {
    customRoleId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const role: CustomRole = await this.readRoleAsGiver(data);

    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const permissions: Array<CustomRolePermission> =
      await CustomRolePermissionService.findPermissionsOfRole({
        customRoleId: data.customRoleId,
        projectId: data.projectId,
      });

    for (const permission of permissions) {
      const labelIds: Array<string> | null = getApiKeyCopyLabels({
        id: permission.id?.toString() || "",
        customRoleId: data.customRoleId.toString(),
        permission: permission.permission!,
        scope: permission.scope,
        labelIds: (permission.labels || [])
          .map((label: Label): string => {
            return label.id?.toString() || "";
          })
          .filter((labelId: string): boolean => {
            return Boolean(labelId);
          }),
      });

      // Limited to what its holder owns: the key is given nothing of it.
      if (labelIds === null) {
        continue;
      }

      try {
        ApiKeyPermissionService.assertCallerCanGrantPermission({
          permission: permission.permission!,
          labels: labelIds.map((labelId: string): Label => {
            return new Label(new ObjectID(labelId));
          }),
          projectId: data.projectId,
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
        "Project ID is required to give a custom role to an API key.",
      );
    }

    this.assertProjectMatchesTenant(projectId, createBy.props);

    if (!createBy.data.apiKeyId) {
      throw new BadDataException(
        "API Key ID is required to give a custom role to an API key.",
      );
    }

    if (!createBy.data.customRoleId) {
      throw new BadDataException(
        "Custom Role ID is required to give a custom role to an API key.",
      );
    }

    /*
     * The key and the role are read together with the project: an id from
     * another project is never enough to give anything.
     */
    const apiKey: ApiKey | null = await ApiKeyService.findOneBy({
      query: {
        _id: createBy.data.apiKeyId,
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!apiKey) {
      throw new BadDataException("Invalid API Key ID for this project");
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
       * The key could not be given the role's permissions: take the role
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

      await ApiKeyPermissionService.forgetPermissionsOfProjects([projectId]);

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
        apiKeyId: true,
      },
    );

    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      this.assertProjectMatchesTenant(row.projectId, deleteBy.props);
      projectIds.set(row.projectId.toString().toLowerCase(), row.projectId);
    }

    const losing: ApiKeysLosingRoles = {
      projectIds: Array.from(projectIds.values()),
    };

    return { deleteBy, carryForward: losing };
  }

  /*
   * The copies went with the roles (ON DELETE CASCADE): every server stops
   * serving them now.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const losing: ApiKeysLosingRoles | null =
      (onDelete.carryForward as ApiKeysLosingRoles | null) || null;

    await ApiKeyPermissionService.forgetPermissionsOfProjects(
      losing?.projectIds || [],
    );

    return onDelete;
  }
}

export default new Service();
