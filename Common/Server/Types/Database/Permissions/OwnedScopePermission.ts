import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import TablePermission from "./TablePermission";
/*
 * Type-only import: keeps the OwnerTablePair shape available without
 * triggering a runtime load of the registry (which imports 20 owner
 * services that extend DatabaseService). The registry is lazy-required
 * inside getAllowedResourceIds to avoid the class-extends-undefined
 * circular-dep crash at module init.
 */
import type { OwnerTablePair } from "./OwnerTableRegistry";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * Implements the `Owned` permission scope (see
 * Internal/Docs/PermissionsSimplification.md). When the requesting user's
 * applicable permission rows are exclusively `Owned`-scoped, this restricts
 * the query to resources where the user is in *OwnerUser or any of the
 * user's teams is in *OwnerTeam.
 *
 * `All` and `Labels` scoped rows are evaluated elsewhere; if any non-Owned
 * row also grants the operation, that broader grant wins and this filter
 * is skipped.
 */
export default class OwnedScopePermission {
  @CaptureSpan()
  public static async addOwnedScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    /*
     * Create has no resource to scope to; auto-owner-on-create lives in the
     * create path itself, not here.
     */
    if (type === DatabaseRequestType.Create) {
      return query;
    }

    const model: BaseModel = new modelType();

    const effectivePermissions: Array<Permission> =
      OwnedScopePermission.getEffectivePermissionsForModel(
        modelType as DatabaseBaseModelType,
        type,
      );

    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const applicableRows: Array<UserPermission> = userPermissions.filter(
      (p: UserPermission) => {
        return effectivePermissions.includes(p.permission);
      },
    );

    if (applicableRows.length === 0) {
      /*
       * No grant applies — the existing table-level check will reject this
       * request. Leave the query untouched.
       */
      return query;
    }

    /*
     * If any applicable row is non-Owned (All / Labels / undefined), it
     * grants broader access than Owned and the Owned constraint is moot.
     * Rows for scope-exempt permissions (e.g. ProjectOwner) are also
     * treated as broader grants regardless of their stored scope, since
     * scoping doesn't apply to them.
     */
    const hasNonOwnedGrant: boolean = applicableRows.some(
      (p: UserPermission) => {
        if (!PermissionHelper.isScopeApplicable(p.permission)) {
          return true;
        }
        return p.scope !== PermissionScope.Owned;
      },
    );
    if (hasNonOwnedGrant) {
      return query;
    }

    // All applicable rows are Owned-scoped. Resolve allowed resource IDs.
    const allowedIds: Array<ObjectID> =
      await OwnedScopePermission.getAllowedResourceIds(modelType, props);

    if (model.ownedThrough) {
      /*
       * Nested resource: ownership inherits via the parent FK. The allowedIds
       * we computed are the parent's IDs, so filter on the FK column.
       */
      const fkColumn: string = model.ownedThrough.fkColumn;
      if (allowedIds.length === 0) {
        // No accessible parents -> match nothing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)._id = QueryHelper.equalTo(
          ObjectID.getZeroObjectID().toString(),
        );
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)[fkColumn] = QueryHelper.any(allowedIds);
      }
    } else if (allowedIds.length === 0) {
      // Top-level operational resource: no accessible IDs -> match nothing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)._id = QueryHelper.equalTo(
        ObjectID.getZeroObjectID().toString(),
      );
    } else {
      // Top-level operational resource: filter on _id.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)._id = QueryHelper.any(allowedIds);
    }

    return query;
  }

  /*
   * Returns the permissions that should be considered to grant access for
   * this op/model — model-enumerated plus operational wildcards plus the
   * ReadAllProjectResources runtime alias. Mirrors the logic in
   * TablePermission.getEffectiveModelPermissions but exposed here because
   * we need to filter user-permission rows by this set.
   */
  private static getEffectivePermissionsForModel(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
  ): Array<Permission> {
    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);
    const effective: Array<Permission> = [...modelPermissions];

    if (
      effective.includes(Permission.ReadAllProjectResources) &&
      !effective.includes(Permission.ReadAllOperationalResources)
    ) {
      effective.push(Permission.ReadAllOperationalResources);
    }

    const model: BaseModel = new modelType();
    if (model.isOperationalResource) {
      const wildcard: Permission | null =
        OwnedScopePermission.getWildcardPermissionForOperation(type);
      if (wildcard && !effective.includes(wildcard)) {
        effective.push(wildcard);
      }
      if (
        type === DatabaseRequestType.Read &&
        !effective.includes(Permission.ReadAllProjectResources)
      ) {
        effective.push(Permission.ReadAllProjectResources);
      }
    }

    return effective;
  }

  private static getWildcardPermissionForOperation(
    type: DatabaseRequestType,
  ): Permission | null {
    switch (type) {
      case DatabaseRequestType.Read:
        return Permission.ReadAllOperationalResources;
      case DatabaseRequestType.Update:
        return Permission.EditAllOperationalResources;
      case DatabaseRequestType.Delete:
        return Permission.DeleteAllOperationalResources;
      case DatabaseRequestType.Create:
        return Permission.CreateAllOperationalResources;
      default:
        return null;
    }
  }

  /*
   * Computes the set of resource IDs the requesting user can access via
   * ownership: those where they personally sit in *OwnerUser OR where any of
   * their teams sits in *OwnerTeam.
   *
   * For nested models the lookup uses the parent's owner tables and returns
   * parent IDs (the caller filters the nested query by the parent FK).
   */
  private static async getAllowedResourceIds<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<ObjectID>> {
    const model: BaseModel = new modelType();

    // Determine which model's owner tables to consult.
    let resolverName: string;
    if (model.ownedThrough) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolverName = (model.ownedThrough.parentModel as any).name;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolverName = (modelType as any).name;
    }

    /*
     * Lazy require to avoid the circular dep cycle: this file is reachable
     * from DatabaseService at module-load time, and the registry imports
     * services that extend DatabaseService.
     */
    const ownerTableRegistry: Map<string, OwnerTablePair> =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("./OwnerTableRegistry").default;

    const registryEntry: OwnerTablePair | undefined =
      ownerTableRegistry.get(resolverName);
    if (!registryEntry) {
      /*
       * No registered owner tables for this model — Owned scope can't
       * resolve, so nothing is accessible.
       */
      return [];
    }

    const seen: Set<string> = new Set<string>();
    const fkColumn: string = registryEntry.fkColumn;

    /*
     * User-ownership lookup. Skipped for non-user callers (API keys, Probes
     * with no userId); those evaluate `Owned` as `All` elsewhere.
     */
    if (props.userId) {
      const userOwnedRows: Array<BaseModel> =
        await registryEntry.ownerUserService.findBy({
          query: {
            userId: props.userId,
            ...(props.tenantId ? { projectId: props.tenantId } : {}),
          },
          select: { [fkColumn]: true },
          props: { isRoot: true },
          skip: 0,
          limit: LIMIT_MAX,
        });
      for (const row of userOwnedRows) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value: ObjectID | undefined = (row as any)[fkColumn];
        if (value) {
          seen.add(value.toString());
        }
      }
    }

    // Team-ownership lookup.
    if (props.userTeamIds && props.userTeamIds.length > 0) {
      const teamOwnedRows: Array<BaseModel> =
        await registryEntry.ownerTeamService.findBy({
          query: {
            teamId: QueryHelper.any(props.userTeamIds),
            ...(props.tenantId ? { projectId: props.tenantId } : {}),
          },
          select: { [fkColumn]: true },
          props: { isRoot: true },
          skip: 0,
          limit: LIMIT_MAX,
        });
      for (const row of teamOwnedRows) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value: ObjectID | undefined = (row as any)[fkColumn];
        if (value) {
          seen.add(value.toString());
        }
      }
    }

    const result: Array<ObjectID> = [];
    for (const id of seen) {
      result.push(new ObjectID(id));
    }
    return result;
  }
}
