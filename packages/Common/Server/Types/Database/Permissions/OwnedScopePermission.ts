import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import QueryHelper from "../QueryHelper";
import QueryUtil from "../QueryUtil";
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
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import { combineWithPrivacyClause } from "../../../Utils/PrivacyFilterUtil";
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
 *
 * addOwnedScopeToQuery is the rule for one operation. The record rule
 * narrows a write by its read's scope as well, and so asks the two halves
 * itself (BasePermission.addRecordScopeToQuery: isLimitedToOwnedRecords
 * per operation, then addOwnedRecordsToQuery once).
 */
export default class OwnedScopePermission {
  @CaptureSpan()
  public static async addOwnedScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    if (!OwnedScopePermission.isLimitedToOwnedRecords(modelType, props, type)) {
      return query;
    }

    return await OwnedScopePermission.addOwnedRecordsToQuery(
      modelType,
      query,
      props,
    );
  }

  /*
   * Whether the caller's grants for `type` on this model reach only the
   * records they or their teams own: every row that grants it is
   * Owned-scoped. Decided without a lookup. The records are the same for
   * every operation (addOwnedRecordsToQuery), so a write limited to owned
   * records for itself or for its read is narrowed to them once.
   */
  public static isLimitedToOwnedRecords<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return false;
    }

    /*
     * Create has no resource to scope to; auto-owner-on-create lives in the
     * create path itself, not here.
     */
    if (type === DatabaseRequestType.Create) {
      return false;
    }

    const model: BaseModel = new modelType();

    /*
     * Owned scope only restricts resources that can carry ownership:
     * operational resources, explicitly registered ownership roots, or
     * nested resources that inherit ownership via @OwnedThrough. For
     * everything else (settings / config tables like IncidentState,
     * Label, Team, etc.) the table-level permission check is the only
     * gate — Owned has no resources to scope to, so it's a no-op.
     * Registry membership only enables ownership filtering; operational
     * wildcard grants still require the existing decorator.
     */
    if (
      !model.isOperationalResource &&
      !model.ownedThrough &&
      !this.getOwnerTableRegistry().has(model.constructor.name)
    ) {
      return false;
    }

    /*
     * The permissions whose rows grant this operation, as the table check
     * reads them: the model's own, and its operational-resource wildcard
     * unless a block with no labels takes the wildcard away.
     */
    const effectivePermissions: Array<Permission> =
      TablePermission.getGrantingPermissions(
        modelType as DatabaseBaseModelType,
        type,
        props,
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
      return false;
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
    // All applicable rows are Owned-scoped.
    return !hasNonOwnedGrant;
  }

  /*
   * Narrows `query` to the records the caller or one of their teams owns,
   * or whose parent they own (@OwnedThrough) - for a caller whose grants
   * are limited to owned records (isLimitedToOwnedRecords).
   */
  public static async addOwnedRecordsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    // Resolve allowed resource IDs.
    const allowedIds: Array<ObjectID> =
      await OwnedScopePermission.getAllowedResourceIds(modelType, props);

    if (model.ownedThrough && model.ownedThrough.includeUnattributed) {
      /*
       * Nested resource whose rows may name no owning resource: those
       * belong to the project and stay, beside the rows of the parents the
       * user owns - AND-combined with any caller-supplied FK filter.
       */
      const fkColumn: string = model.ownedThrough.fkColumn;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)[fkColumn] = combineWithPrivacyClause(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)[fkColumn],
        QueryHelper.inOrNull(allowedIds),
      );
    } else if (model.ownedThrough) {
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
        /*
         * AND-combine with any caller-supplied FK filter (e.g. the
         * dashboard's `incidentId: <this incident>`) — overwriting it would
         * widen the query to every owned parent.
         */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)[fkColumn] = combineWithPrivacyClause(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (query as any)[fkColumn],
          QueryHelper.any(allowedIds),
        );
      }
    } else if (allowedIds.length === 0) {
      // Top-level operational resource: no accessible IDs -> match nothing.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)._id = QueryHelper.equalTo(
        ObjectID.getZeroObjectID().toString(),
      );
    } else {
      /*
       * Top-level operational resource: filter on _id, AND-combined with any
       * caller-supplied _id (get/update of a specific record) — overwriting
       * it would resolve the request against a different owned record.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)._id = combineWithPrivacyClause(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)._id,
        QueryHelper.any(allowedIds),
      );
    }

    return query;
  }

  /*
   * Narrows the records of a model read through another one
   * (@CanAccessIfCanReadOn - an incident's notes, a status page's
   * announcements) to those of the parents the caller or one of their teams
   * owns: for a caller whose grants on the parent reach only the records
   * they own (isLimitedToOwnedRecords on the parent). A parent named by a
   * key column keeps the rows whose key names an owned parent; parents
   * through a join table keep the rows linked to at least one owned parent.
   * A row with no parent, or with none the caller owns, is left out - as it
   * is when the parent's read is limited to labels. The caller's own
   * filters stay as sent.
   */
  public static async addOwnedParentsToQuery<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>;
    props: DatabaseCommonInteractionProps;
    parentModelType: { new (): BaseModel };
    // The @CanAccessIfCanReadOn relation, and its column.
    relation: string;
    relationColumn: TableColumnMetadata;
  }): Promise<Query<TBaseModel>> {
    /*
     * A parent that takes its owners from a record of its own
     * (@OwnedThrough) has no owner rows to look up here. No model is read
     * through such a parent (Tests/Models/DatabaseModels
     * /ParentOwnedScopeCoverage); one that were would reach none of its
     * rows rather than every one of them.
     */
    const ownedParentIds: Array<ObjectID> = new data.parentModelType()
      .ownedThrough
      ? []
      : await OwnedScopePermission.getAllowedResourceIds(
          data.parentModelType,
          data.props,
        );

    if (ownedParentIds.length === 0) {
      // No owned parent: no record of theirs is reached.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)._id = QueryHelper.equalTo(
        ObjectID.getZeroObjectID().toString(),
      );

      return data.query;
    }

    if (
      data.relationColumn.type === TableColumnType.Entity &&
      data.relationColumn.manyToOneRelationColumn
    ) {
      const parentKey: string = data.relationColumn.manyToOneRelationColumn;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)[parentKey] = combineWithPrivacyClause(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.query as any)[parentKey],
        QueryHelper.any(ownedParentIds),
      );

      return data.query;
    }

    const parentLinks: ReturnType<
      typeof QueryUtil.getManyToManyRelationMetadata
    > =
      data.relationColumn.type === TableColumnType.EntityArray
        ? QueryUtil.getManyToManyRelationMetadata(
            data.modelType,
            data.relation,
          )
        : null;

    /*
     * A parent the rule cannot follow - neither a key column nor a join
     * table - is a misconfigured model: refused, never read without the
     * scope.
     */
    if (!parentLinks) {
      throw new BadDataException(
        "Cannot apply the owned scope without the relation to the record this is read through.",
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data.query as any)._id = combineWithPrivacyClause(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)._id,
      QueryHelper.anyOfEntitiesInManyToMany({
        values: ownedParentIds,
        joinTableName: parentLinks.joinTableName,
        ownerColumnName: parentLinks.ownerColumnName,
        relationColumnName: parentLinks.relationColumnName,
      }),
    );

    return data.query;
  }

  private static getOwnerTableRegistry(): Map<string, OwnerTablePair> {
    /*
     * Services in this registry extend DatabaseService, which imports this
     * permission class. Resolve at request time after both classes exist.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("./OwnerTableRegistry").default;
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

    /*
     * Which model(s) owner tables to consult. A nested model can inherit
     * ownership from several parent resource types when its FK is
     * polymorphic (e.g. a telemetry serviceId that may point at a Service,
     * Host, DockerHost or KubernetesCluster) — resolve and union the owned
     * ids across all of them. Top-level operational resources consult
     * their own owner tables.
     */
    const resolverNames: Array<string> = model.ownedThrough
      ? model.ownedThrough.parentModels.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (parentModel: any) => {
            return parentModel.name;
          },
        )
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [(modelType as any).name];

    const ownerTableRegistry: Map<string, OwnerTablePair> =
      this.getOwnerTableRegistry();

    const seen: Set<string> = new Set<string>();

    for (const resolverName of resolverNames) {
      const registryEntry: OwnerTablePair | undefined =
        ownerTableRegistry.get(resolverName);
      if (!registryEntry) {
        /*
         * No registered owner tables for this parent — skip it. Other
         * parents (or includeProjectScope below) may still resolve.
         */
        continue;
      }

      const fkColumn: string = registryEntry.fkColumn;

      /*
       * User-ownership lookup. Skipped for non-user callers (API keys,
       * Probes with no userId); those evaluate `Owned` as `All` elsewhere.
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
    }

    /*
     * Polymorphic FK rows with no owning resource (the unattributed
     * "Unknown" telemetry bucket) carry the projectId in the FK column.
     * They belong to the project, not any single owner, so include the
     * tenant id when the model opts in via includeProjectScope.
     */
    if (model.ownedThrough?.includeProjectScope && props.tenantId) {
      seen.add(props.tenantId.toString());
    }

    const result: Array<ObjectID> = [];
    for (const id of seen) {
      result.push(new ObjectID(id));
    }
    return result;
  }
}
