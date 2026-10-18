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
import { OwnedThroughMetadata } from "../../../../Types/Database/AccessControl/OwnedThrough";
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
import logger from "../../../Utils/Logger";
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
 *
 * The owners of a resource are owned through it (getOwnedThrough): a grant
 * scoped to Owned adds and removes owners only on the resources the caller
 * or their teams own, however many more they may read.
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
     * nested resources that inherit ownership via @OwnedThrough - or, on a
     * change or a delete, an owner table of a registered root (getOwnedThrough).
     * For everything else (settings / config tables like IncidentState,
     * Label, Team, etc.) the table-level permission check is the only
     * gate — Owned has no resources to scope to, so it's a no-op.
     * Registry membership only enables ownership filtering; operational
     * wildcard grants still require the existing decorator.
     */
    if (
      !model.isOperationalResource &&
      !model.ownedThrough &&
      !this.getOwnerTableRegistry().has(model.constructor.name) &&
      !OwnedScopePermission.isOwnerTableWrite(modelType, type)
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
   * or whose parent they own (@OwnedThrough, or the resource an owner row
   * names: getOwnedThrough) - for a caller whose grants are limited to owned
   * records (isLimitedToOwnedRecords).
   */
  public static async addOwnedRecordsToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.getOwnedThrough(modelType);

    // Resolve allowed resource IDs.
    const allowedIds: Array<ObjectID> =
      await OwnedScopePermission.getAllowedResourceIds(modelType, props);

    if (ownedThrough && ownedThrough.includeUnattributed) {
      /*
       * Nested resource whose rows may name no owning resource: those
       * belong to the project and stay, beside the rows of the parents the
       * user owns - AND-combined with any caller-supplied FK filter.
       */
      const fkColumn: string = ownedThrough.fkColumn;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (query as any)[fkColumn] = combineWithPrivacyClause(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (query as any)[fkColumn],
        QueryHelper.inOrNull(allowedIds),
      );
    } else if (ownedThrough) {
      /*
       * Nested resource: ownership inherits via the parent FK. The allowedIds
       * we computed are the parent's IDs, so filter on the FK column.
       */
      const fkColumn: string = ownedThrough.fkColumn;
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
  public static async addOwnedParentsToQuery<
    TBaseModel extends BaseModel,
  >(data: {
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
     * (@OwnedThrough, or an owner table: getOwnedThrough) has no owner rows
     * to look up here. No model is read through such a parent
     * (Tests/Models/DatabaseModels/ParentOwnedScopeCoverage); one that were
     * would reach none of its rows rather than every one of them.
     */
    const ownedParentIds: Array<ObjectID> =
      OwnedScopePermission.getOwnedThrough(data.parentModelType)
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
        ? QueryUtil.getManyToManyRelationMetadata(data.modelType, data.relation)
        : null;

    /*
     * A parent the rule cannot follow - neither a key column nor a join
     * table - is a misconfigured model (Tests/Models/DatabaseModels
     * /ParentOwnedScopeCoverage holds every model to one the rule follows):
     * it reaches none of its rows, as a caller who owns no parent does,
     * never every one of them - and says so in the log.
     */
    if (!parentLinks) {
      logger.error(
        `${new data.modelType().singularName} is read through ${data.relation}, which the owned scope of ${new data.parentModelType().singularName} cannot follow: no key column or join table. The read reaches no records.`,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.query as any)._id = QueryHelper.equalTo(
        ObjectID.getZeroObjectID().toString(),
      );

      return data.query;
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

  /*
   * Whether a model's records have owner rows of their own (OwnerTableRegistry:
   * the operational resources and the rest that carry owners) - the ones
   * whose creator becomes an owner (DatabaseService.autoOwnerOnCreate).
   */
  public static hasOwnerTables(modelType: { new (): BaseModel }): boolean {
    return this.getOwnerTableRegistry().has(
      (modelType as unknown as { name: string }).name,
    );
  }

  /*
   * The records the caller or one of their teams owns, by id: of the model
   * itself, or - for a model that takes its owners from a parent
   * (@OwnedThrough, or an owner table: getOwnedThrough) - of that parent. In
   * the request's project.
   */
  public static async getOwnedIds(
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<ObjectID>> {
    return await OwnedScopePermission.getAllowedResourceIds(modelType, props);
  }

  /*
   * THE RECORD A MODEL'S ROWS TAKE THEIR OWNERS FROM, for the Owned scope:
   * the parent its @OwnedThrough names - a monitor's status timeline, an
   * incident's notes - or, for an owner table of a kind with owners of its
   * own (OwnerTableRegistry: MonitorOwnerUser and MonitorOwnerTeam, and
   * every other kind's), the resource its rows name. Null for any other
   * model.
   *
   * AN OWNER ROW IS OWNED THROUGH ITS RESOURCE. Who owns a monitor is what
   * the Owned scope reads to decide what a member may manage, so adding or
   * removing an owner is managing the monitor: a grant scoped to Owned adds
   * and removes owners only on the monitors the caller or one of their teams
   * own - however many more they may read - or naming themselves an owner of
   * a monitor they only read would hand them the rest of what their Owned
   * grant keeps to their own. A create is held to it by CreateScopePermission
   * (checkOwnedCreate), a change and a delete by the record rule
   * (isLimitedToOwnedRecords, isOwnerTableWrite). A read of owners is not:
   * who owns a resource is read through the resource
   * (BasePermission.addParentAccessToQuery), by its own read rule and scope.
   *
   * Read off the registry, not declared on each owner table, so a kind that
   * is registered there has its owner tables held to the same rule with no
   * other change; the owner tables of a kind that is not are left as before,
   * as its own records are (isLimitedToOwnedRecords).
   */
  public static getOwnedThrough(modelType: {
    new (): BaseModel;
  }): OwnedThroughMetadata | null {
    const declared: OwnedThroughMetadata | null = new modelType().ownedThrough;

    if (declared) {
      return declared;
    }

    return OwnedScopePermission.getOwnerTableOwnership(modelType);
  }

  /*
   * Whether `modelType` is an owner table of a kind with owners of its own
   * (getOwnedThrough): MonitorOwnerUser, MonitorOwnerTeam and the like.
   */
  public static isOwnerTable(modelType: { new (): BaseModel }): boolean {
    return OwnedScopePermission.getOwnerTableOwnership(modelType) !== null;
  }

  /*
   * Whether `type` on `modelType` is a change or a delete of an owner table's
   * rows - one the Owned scope holds to the resource's owners
   * (getOwnedThrough). A read is not: owners are read through the resource.
   * A create is held to it on the record it makes (CreateScopePermission).
   */
  private static isOwnerTableWrite(
    modelType: { new (): BaseModel },
    type: DatabaseRequestType,
  ): boolean {
    return (
      (type === DatabaseRequestType.Update ||
        type === DatabaseRequestType.Delete) &&
      OwnedScopePermission.isOwnerTable(modelType)
    );
  }

  // The resource each owner table's rows name, worked out once per table.
  private static ownerTableResources: WeakMap<
    OwnerTablePair,
    Map<{ new (): BaseModel }, OwnedThroughMetadata>
  > = new WeakMap();

  /*
   * See getOwnedThrough: the resource an owner table of a registered kind
   * names, as @OwnedThrough would declare it - the key column the registry
   * reads its owners by, and the model of the relation on that column. Null
   * for a model that is no registered kind's owner table. The registry is
   * read on every call, so a kind registered after the first request is held
   * to it too.
   */
  private static getOwnerTableOwnership(modelType: {
    new (): BaseModel;
  }): OwnedThroughMetadata | null {
    for (const [kind, pair] of this.getOwnerTableRegistry().entries()) {
      if (
        pair.ownerUserService?.modelType !== modelType &&
        pair.ownerTeamService?.modelType !== modelType
      ) {
        continue;
      }

      let resources:
        | Map<{ new (): BaseModel }, OwnedThroughMetadata>
        | undefined = OwnedScopePermission.ownerTableResources.get(pair);

      if (!resources) {
        resources = new Map<{ new (): BaseModel }, OwnedThroughMetadata>();
        OwnedScopePermission.ownerTableResources.set(pair, resources);
      }

      let ownedThrough: OwnedThroughMetadata | undefined =
        resources.get(modelType);

      if (!ownedThrough) {
        ownedThrough = {
          fkColumn: pair.fkColumn,
          parentModels: [
            OwnedScopePermission.getOwnedResourceType({
              ownerTableType: modelType,
              fkColumn: pair.fkColumn,
              kind: kind,
            }),
          ],
          includeProjectScope: false,
          onlyParentModels: true,
          includeUnattributed: false,
        };

        resources.set(modelType, ownedThrough);
      }

      return ownedThrough;
    }

    return null;
  }

  /*
   * The model of the resource an owner table names by `fkColumn`: the
   * relation on that column (MonitorOwnerUser.monitor names a Monitor), which
   * must be the registry's kind (Tests/Models/DatabaseModels
   * /OwnerTablesReadThroughResource holds every owner table to it). An owner
   * table that names no such relation is a misconfigured registry entry: it
   * is refused rather than left unscoped.
   */
  private static getOwnedResourceType(data: {
    ownerTableType: { new (): BaseModel };
    fkColumn: string;
    kind: string;
  }): { new (): BaseModel } {
    const ownerTable: BaseModel = new data.ownerTableType();

    for (const column of ownerTable.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        ownerTable.getTableColumnMetadata(column);

      if (
        metadata &&
        metadata.type === TableColumnType.Entity &&
        metadata.manyToOneRelationColumn === data.fkColumn &&
        metadata.modelType &&
        (metadata.modelType as unknown as { name: string }).name === data.kind
      ) {
        return metadata.modelType as { new (): BaseModel };
      }
    }

    throw new BadDataException(
      `${ownerTable.singularName || data.kind} names no ${data.kind} by ${data.fkColumn}, so the Owned scope cannot tell whose it is.`,
    );
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
    const ownedThrough: OwnedThroughMetadata | null =
      OwnedScopePermission.getOwnedThrough(modelType);

    /*
     * Which model(s) owner tables to consult. A nested model can inherit
     * ownership from several parent resource types when its FK is
     * polymorphic (e.g. a telemetry serviceId that may point at a Service,
     * Host, DockerHost or KubernetesCluster) — resolve and union the owned
     * ids across all of them. Top-level operational resources consult
     * their own owner tables, and an owner table its resource's.
     */
    const resolverNames: Array<string> = ownedThrough
      ? ownedThrough.parentModels.map(
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
    if (ownedThrough?.includeProjectScope && props.tenantId) {
      seen.add(props.tenantId.toString());
    }

    const result: Array<ObjectID> = [];
    for (const id of seen) {
      result.push(new ObjectID(id));
    }
    return result;
  }
}
