import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import ApiKeyService from "./ApiKeyService";
import DatabaseService from "./DatabaseService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import Model from "../../Models/DatabaseModels/ApiKeyPermission";
import Label from "../../Models/DatabaseModels/Label";
import ObjectID from "../../Types/ObjectID";
import Permission, { UserPermission } from "../../Types/Permission";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";

/*
 * 60s is the worst-case staleness on any single API node after a key's
 * permissions are edited. We invalidate in-process immediately on
 * create/update/delete; this TTL is the upper bound for *other* processes
 * (same bound the ApiKeyService key cache accepted).
 */
const PERMISSIONS_TTL_MS: number = 60 * 1000;

const API_KEY_REFERENCE_KEYS: Array<string> = ["apiKeyId", "apiKey"];
const PROJECT_REFERENCE_KEYS: Array<string> = ["projectId", "project"];

interface CachedApiKeyPermissionRow {
  permission: Permission;
  labelIds: Array<string>;
  isBlockPermission: boolean | undefined;
}

export interface ApiKeyPermissionRow {
  permission: Permission;
  labelIds: Array<ObjectID>;
  isBlockPermission: boolean | undefined;
}

export class Service extends DatabaseService<Model> {
  /*
   * Cache of `(projectId, apiKeyId) -> permission rows`. Project is part of
   * the key and the database query deliberately: even a malformed legacy row
   * that points at another project's API key must never become authority in
   * the project currently being authenticated.
   */
  private permissionCache: InMemoryTTLCache<Array<CachedApiKeyPermissionRow>> =
    new InMemoryTTLCache(10_000);
  private permissionCacheGeneration: number = 0;

  public constructor() {
    super(Model);
  }

  public clearCache(): void {
    this.permissionCacheGeneration++;
    this.permissionCache.clear();
  }

  /**
   * Resolves the permission rows granted to an API key, with a short-lived
   * in-process cache. Returns freshly built objects on every call (hit or
   * miss), so callers never share mutable state with the cache. Use this from
   * the auth hot path instead of calling `findBy` directly.
   */
  @CaptureSpan()
  public async findPermissionsByApiKeyId(
    apiKeyId: ObjectID,
    projectId: ObjectID,
  ): Promise<Array<ApiKeyPermissionRow>> {
    const cacheKey: string = `${projectId.toString()}:${apiKeyId.toString()}`;

    let cachedRows: Array<CachedApiKeyPermissionRow> | undefined =
      this.permissionCache.get(cacheKey);

    if (cachedRows === undefined) {
      const queryGeneration: number = this.permissionCacheGeneration;
      const rows: Array<Model> = await this.findBy({
        query: {
          apiKeyId: apiKeyId,
          projectId: projectId,
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

      cachedRows = rows.map((row: Model): CachedApiKeyPermissionRow => {
        return {
          permission: row.permission!,
          labelIds: (row.labels ?? []).map((label: Label) => {
            return label.id!.toString();
          }),
          isBlockPermission: row.isBlockPermission,
        };
      });

      /*
       * A permission mutation can commit while this database read is in
       * flight. The success hook increments the generation after commit; do
       * not let a pre-commit result repopulate the cache after that clear.
       */
      if (queryGeneration === this.permissionCacheGeneration) {
        this.permissionCache.set(cacheKey, cachedRows, PERMISSIONS_TTL_MS);
      }
    }

    return cachedRows.map(
      (row: CachedApiKeyPermissionRow): ApiKeyPermissionRow => {
        return {
          permission: row.permission,
          labelIds: row.labelIds.map((id: string) => {
            return new ObjectID(id);
          }),
          isBlockPermission: row.isBlockPermission,
        };
      },
    );
  }

  /**
   * A request tenant is authoritative. Normalize both scalar and relation
   * spellings before any lookup so the IDs we validate are exactly the IDs
   * TypeORM can persist.
   */
  private normalizeReferencesForCreate(createBy: CreateBy<Model>): {
    apiKeyId: ObjectID;
    projectId: ObjectID;
  } {
    const createData: Record<string, unknown> =
      createBy.data as unknown as Record<string, unknown>;
    const requestProjectId: ObjectID | undefined = createBy.props.tenantId;
    const dataProjectId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      PROJECT_REFERENCE_KEYS,
      "Project",
    );
    const projectId: ObjectID | undefined =
      requestProjectId || dataProjectId || undefined;
    const apiKeyId: ObjectID | null = RelationIdUtil.readConsistent(
      createData,
      API_KEY_REFERENCE_KEYS,
      "API Key",
    );

    if (!apiKeyId) {
      throw new BadDataException("API Key ID is required to create permission");
    }

    if (!projectId) {
      throw new BadDataException("Project Id is required to create permission");
    }

    if (
      requestProjectId &&
      dataProjectId &&
      requestProjectId.toString() !== dataProjectId.toString()
    ) {
      throw new BadDataException("Invalid API Key ID for this project");
    }

    /*
     * Both relation properties map to the same database columns as their ID
     * siblings. TypeORM gives the relation object persistence significance of
     * its own, so validation of only the scalar IDs is not sufficient: two
     * conflicting values can otherwise pass the hook and the relation can win
     * during save. From here onward the validated scalar IDs are the only
     * persistence source of truth.
     */
    createBy.data.apiKeyId = apiKeyId;
    createBy.data.projectId = projectId;
    delete createBy.data.apiKey;
    delete createBy.data.project;

    return { apiKeyId, projectId };
  }

  /**
   * Resolve the relation by both id and tenant in one root query. Looking up
   * the id alone and trusting the permission row's projectId creates a
   * cross-tenant foreign-key confused-deputy: the database FK proves the key
   * exists, but not that the key belongs to this project.
   */
  private async assertApiKeyBelongsToProject(
    apiKeyId: ObjectID,
    projectId: ObjectID,
  ): Promise<void> {
    const apiKey: unknown = await ApiKeyService.findOneBy({
      query: {
        _id: apiKeyId,
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
  }

  private getLabelIds(labels: Array<Label> | undefined): Array<ObjectID> {
    const labelIds: Array<ObjectID> = [];

    for (const label of labels || []) {
      const labelReference: Label & {
        _id?: string | ObjectID | undefined;
      } = label;
      const labelId: string | ObjectID | undefined =
        labelReference.id || labelReference._id;

      if (!labelId) {
        throw new BadDataException(
          "Every API key permission label must have an ID",
        );
      }

      labelIds.push(
        labelId instanceof ObjectID ? labelId : new ObjectID(labelId),
      );
    }

    return labelIds;
  }

  private hasUnrestrictedPermission(
    permissions: Array<UserPermission>,
  ): boolean {
    return permissions.some((permission: UserPermission): boolean => {
      return (
        permission.scope === PermissionScope.All ||
        (permission.scope !== PermissionScope.Owned &&
          permission.labelIds.length === 0)
      );
    });
  }

  /**
   * Return true only if the caller holds the requested permission over the
   * entire scope they are trying to delegate. Label-scoped authority can be
   * delegated only to a subset of those labels; an Owned scope cannot be
   * transferred to an API key because API keys have no user/team ownership
   * identity.
   */
  private isPermissionWithinCallerAuthority(data: {
    allowPermissions: Array<UserPermission>;
    blockPermissions: Array<UserPermission>;
    permission: Permission;
    requestedLabelIds: Array<ObjectID>;
  }): boolean {
    const matchingAllows: Array<UserPermission> = data.allowPermissions.filter(
      (permission: UserPermission): boolean => {
        return (
          permission.permission === data.permission &&
          permission.scope !== PermissionScope.Owned
        );
      },
    );
    const matchingBlocks: Array<UserPermission> = data.blockPermissions.filter(
      (permission: UserPermission): boolean => {
        return permission.permission === data.permission;
      },
    );

    const requestedLabels: Array<string> = data.requestedLabelIds.map(
      (labelId: ObjectID): string => {
        return labelId.toString();
      },
    );

    let isAllowed: boolean = this.hasUnrestrictedPermission(matchingAllows);

    if (!isAllowed && requestedLabels.length > 0) {
      const allowedLabelIds: Set<string> = new Set<string>();
      for (const permission of matchingAllows) {
        for (const labelId of permission.labelIds) {
          allowedLabelIds.add(labelId.toString());
        }
      }
      isAllowed = requestedLabels.every((labelId: string): boolean => {
        return allowedLabelIds.has(labelId);
      });
    }

    if (!isAllowed) {
      return false;
    }

    if (matchingBlocks.length === 0) {
      return true;
    }

    if (
      this.hasUnrestrictedPermission(matchingBlocks) ||
      matchingBlocks.some((permission: UserPermission): boolean => {
        return permission.scope === PermissionScope.Owned;
      })
    ) {
      return false;
    }

    /*
     * An unscoped API-key grant includes every label, including any scope the
     * caller is blocked from, so even one scoped block makes it too broad.
     */
    if (requestedLabels.length === 0) {
      return false;
    }

    const blockedLabelIds: Set<string> = new Set<string>();
    for (const permission of matchingBlocks) {
      for (const labelId of permission.labelIds) {
        blockedLabelIds.add(labelId.toString());
      }
    }

    return requestedLabels.every((labelId: string): boolean => {
      return !blockedLabelIds.has(labelId);
    });
  }

  /**
   * Permission-management is delegation, not a role minting primitive.
   * Owners may delegate anything. Every other editor, including a project
   * admin, must themselves hold the exact permission and every label scope
   * they place on the API key. ProjectAdmin is not an implication of every
   * permission: destructive and billing permissions intentionally exclude it
   * in their model ACLs.
   */
  private assertCallerCanGrantPermission(data: {
    permission: Permission;
    labels: Array<Label> | undefined;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const scopedProps: DatabaseCommonInteractionProps = {
      ...data.props,
      tenantId: data.projectId,
    };
    const allowPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        scopedProps,
        PermissionType.Allow,
      );
    const blockPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        scopedProps,
        PermissionType.Block,
      );

    const hasProjectOwner: boolean = this.isPermissionWithinCallerAuthority({
      allowPermissions,
      blockPermissions,
      permission: Permission.ProjectOwner,
      requestedLabelIds: [],
    });

    if (hasProjectOwner) {
      return;
    }

    if (
      !this.isPermissionWithinCallerAuthority({
        allowPermissions,
        blockPermissions,
        permission: data.permission,
        requestedLabelIds: this.getLabelIds(data.labels),
      })
    ) {
      throw new NotAuthorizedException(
        "You cannot grant an API key permission beyond your own authority",
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.clearCache();

    if (!createBy.data.permission) {
      throw new BadDataException("Permission is required to create permission");
    }

    const references: { apiKeyId: ObjectID; projectId: ObjectID } =
      this.normalizeReferencesForCreate(createBy);

    await this.assertApiKeyBelongsToProject(
      references.apiKeyId,
      references.projectId,
    );
    this.assertCallerCanGrantPermission({
      permission: createBy.data.permission,
      labels: createBy.data.labels,
      projectId: references.projectId,
      props: createBy.props,
    });

    // check if this permission is already assigned to this team and if yes then throw error.

    const isBlockPermission: boolean = createBy.data.isBlockPermission || false;

    const existingPermission: Model | null = await this.findOneBy({
      query: {
        apiKeyId: createBy.data.apiKeyId,
        projectId: createBy.data.projectId,
        permission: createBy.data.permission,
        isBlockPermission: isBlockPermission,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingPermission) {
      throw new BadDataException(
        "This permission is already assigned to this API Key",
      );
    }

    if (createBy.data.labels && createBy.data.labels.length > 0) {
      // check if the

      const existingPermission: Model | null = await this.findOneBy({
        query: {
          apiKeyId: createBy.data.apiKeyId,
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
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * We don't know which keys are being updated without a query; updates
     * are rare so clearing is cheap.
     */
    this.clearCache();

    const existingPermissions: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        _id: true,
        labels: true,
        isBlockPermission: true,
        projectId: true,
        apiKeyId: true,
        permission: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const rawUpdatedPermission: unknown = updateBy.data.permission;
    if (
      rawUpdatedPermission !== undefined &&
      typeof rawUpdatedPermission !== "string"
    ) {
      throw new BadDataException("Invalid API Key permission");
    }
    const updatedPermission: Permission | undefined = rawUpdatedPermission as
      | Permission
      | undefined;

    const isLabelsUpdateRequested: boolean = updateBy.data.labels !== undefined;
    if (
      isLabelsUpdateRequested &&
      updateBy.data.labels !== null &&
      !Array.isArray(updateBy.data.labels)
    ) {
      throw new BadDataException("Invalid API Key permission labels");
    }
    const updatedLabels: Array<Label> | undefined =
      updateBy.data.labels === null
        ? []
        : Array.isArray(updateBy.data.labels)
          ? (updateBy.data.labels as unknown as Array<Label>)
          : undefined;

    const rawUpdatedIsBlockPermission: unknown =
      updateBy.data.isBlockPermission;
    if (
      rawUpdatedIsBlockPermission !== undefined &&
      typeof rawUpdatedIsBlockPermission !== "boolean"
    ) {
      throw new BadDataException("Invalid API Key block permission value");
    }
    const updatedIsBlockPermission: boolean | undefined =
      rawUpdatedIsBlockPermission as boolean | undefined;

    for (const existingPermission of existingPermissions) {
      const projectId: ObjectID | undefined = existingPermission.projectId;
      const apiKeyId: ObjectID | undefined = existingPermission.apiKeyId;
      const permission: Permission | undefined =
        updatedPermission || existingPermission.permission;

      if (!projectId || !apiKeyId || !permission) {
        throw new BadDataException("Invalid API Key permission");
      }

      if (
        updateBy.props.tenantId &&
        updateBy.props.tenantId.toString() !== projectId.toString()
      ) {
        throw new BadDataException("Invalid API Key ID for this project");
      }

      await this.assertApiKeyBelongsToProject(apiKeyId, projectId);
      this.assertCallerCanGrantPermission({
        permission,
        labels: isLabelsUpdateRequested
          ? updatedLabels
          : existingPermission.labels,
        projectId,
        props: updateBy.props,
      });

      if (
        updatedPermission !== undefined ||
        updatedIsBlockPermission !== undefined
      ) {
        const duplicatePermission: Model | null = await this.findOneBy({
          query: {
            _id: QueryHelper.notEquals(existingPermission.id!),
            apiKeyId,
            projectId,
            permission,
            isBlockPermission:
              updatedIsBlockPermission === undefined
                ? existingPermission.isBlockPermission || false
                : updatedIsBlockPermission,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (duplicatePermission) {
          throw new BadDataException(
            "This permission is already assigned to this API Key",
          );
        }
      }
    }

    if (updateBy.data.labels && updateBy.data.labels.length > 0) {
      for (const alreadySavedPermission of existingPermissions) {
        // check if the

        const isBlockPermission: boolean =
          alreadySavedPermission.isBlockPermission || false;

        const existingPermission: Model | null = await this.findOneBy({
          query: {
            apiKeyId: alreadySavedPermission.apiKeyId!,
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

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    this.clearCache();
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    this.clearCache();
    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    this.clearCache();
    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    this.clearCache();
    return onDelete;
  }

  protected override async onCreateError(error: Exception): Promise<Exception> {
    this.clearCache();
    return error;
  }

  protected override async onUpdateError(error: Exception): Promise<Exception> {
    this.clearCache();
    return error;
  }

  protected override async onDeleteError(error: Exception): Promise<Exception> {
    this.clearCache();
    return error;
  }
}

export default new Service();
