import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/ApiKeyPermission";
import Label from "../../Models/DatabaseModels/Label";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import InMemoryTTLCache from "../Infrastructure/InMemoryTTLCache";

/*
 * 60s is the worst-case staleness on any single API node after a key's
 * permissions are edited. We invalidate in-process immediately on
 * create/update/delete; this TTL is the upper bound for *other* processes
 * (same bound the ApiKeyService key cache accepted).
 */
const PERMISSIONS_TTL_MS: number = 60 * 1000;

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
   * Cache of `apiKeyId -> permission rows`. The API-key auth path builds the
   * request's tenant permissions from these rows on every request; without it
   * that's a Postgres findBy (with a labels join) per request.
   */
  private permissionCache: InMemoryTTLCache<Array<CachedApiKeyPermissionRow>> =
    new InMemoryTTLCache(10_000);

  public constructor() {
    super(Model);
  }

  public clearCache(): void {
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
  ): Promise<Array<ApiKeyPermissionRow>> {
    const cacheKey: string = apiKeyId.toString();

    let cachedRows: Array<CachedApiKeyPermissionRow> | undefined =
      this.permissionCache.get(cacheKey);

    if (cachedRows === undefined) {
      const rows: Array<Model> = await this.findBy({
        query: {
          apiKeyId: apiKeyId,
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

      this.permissionCache.set(cacheKey, cachedRows, PERMISSIONS_TTL_MS);
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    this.clearCache();

    if (!createBy.data.apiKeyId) {
      throw new BadDataException("API Key ID is required to create permission");
    }

    if (!createBy.data.projectId) {
      throw new BadDataException("Project Id is required to create permission");
    }

    if (!createBy.data.permission) {
      throw new BadDataException("Permission is required to create permission");
    }

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

    if (updateBy.data.labels && updateBy.data.labels.length > 0) {
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
}

export default new Service();
