import {
  IsBillingEnabled,
  getAllEnvVars,
} from "../../../Server/EnvironmentConfig";
import DatabaseRequestType from "../BaseDatabase/DatabaseRequestType";
import Query from "./Query";
import Select from "./Select";
import QueryHelper from "../Database/QueryHelper";
import BaseModel, {
  AnalyticsBaseModelType,
} from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Includes from "../../../Types/BaseDatabase/Includes";
import SubscriptionPlan from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Columns from "../../../Types/Database/Columns";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

export interface CheckReadPermissionType<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  select: Select<TBaseModel> | null;
}

/*
 * Per-request cache for scope resolution. Keyed by the `props` object —
 * one HTTP request reuses the same `props` for every analytics query it
 * issues (a dashboard with 20 panels = up to 80 Postgres lookups without
 * this; ~4 with it). The WeakMap entry is released automatically when
 * `props` goes out of scope at request end, so there's no stale data
 * between requests.
 *
 * Caches two things:
 *   - `ownedIds`: Service IDs the user owns (one set per request — the
 *     inputs are userId + teamIds + tenantId, all stable for one props).
 *   - `labeledIds`: a map keyed by the sorted-label-IDs string, since
 *     different model permission rows may carry different label sets.
 */
interface ScopeResolveCacheEntry {
  ownedIds?: Set<string>;
  labeledIds: Map<string, Set<string>>;
}

const scopeResolveCache: WeakMap<
  DatabaseCommonInteractionProps,
  ScopeResolveCacheEntry
> = new WeakMap();

function getScopeCacheBucket(
  props: DatabaseCommonInteractionProps,
): ScopeResolveCacheEntry {
  let bucket: ScopeResolveCacheEntry | undefined = scopeResolveCache.get(props);
  if (!bucket) {
    bucket = { labeledIds: new Map() };
    scopeResolveCache.set(props, bucket);
  }
  return bucket;
}

export default class ModelPermission {
  @CaptureSpan()
  public static async checkDeletePermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      query = await this.addTenantScopeToQueryAsRoot(modelType, query, props);
    }

    if (!props.isRoot && !props.isMasterAdmin) {
      this.checkModelLevelPermissions(
        modelType,
        props,
        DatabaseRequestType.Delete,
      );
      query = await this.addTenantScopeToQuery(modelType, query, null, props);
      // Owned scope: restrict deletes to telemetry from accessible services.
      query = await this.addOwnedScopeToQuery(
        modelType,
        query,
        props,
        DatabaseRequestType.Delete,
      );
    }

    return query;
  }

  @CaptureSpan()
  public static async checkUpdatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    this.checkModelLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
    );

    const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
      await this.checkReadPermission(modelType, query, null, props);

    query = checkReadPermissionType.query;

    this.checkDataColumnPermissions(
      modelType,
      data as any,
      props,
      DatabaseRequestType.Update,
    );

    return query;
  }

  @CaptureSpan()
  public static checkCreatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): void {
    // If system is making this query then let the query run!
    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    this.checkModelLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Create,
    );

    this.checkDataColumnPermissions(
      modelType,
      data,
      props,
      DatabaseRequestType.Create,
    );
  }

  private static checkDataColumnPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
    requestType: DatabaseRequestType,
  ): void {
    const model: BaseModel = new modelType();
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const permissionColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      userPermissions,
      requestType,
    );

    const excludedColumnNames: Array<string> =
      ModelPermission.getExcludedColumnNames();

    const tableColumns: Array<AnalyticsTableColumn> = model.getTableColumns();

    for (const column of tableColumns) {
      const key: string = column.key;
      if ((data as any)[key] === undefined) {
        continue;
      }

      if (excludedColumnNames.includes(key)) {
        continue;
      }

      if (!permissionColumns.columns.includes(key)) {
        if (
          requestType === DatabaseRequestType.Create &&
          column.forceGetDefaultValueOnCreate
        ) {
          continue; // this is a special case where we want to force the default value on create.
        }

        throw new BadDataException(
          `User is not allowed to ${requestType} on ${key} column of ${model.singularName}`,
        );
      }

      const billingAccessControl: ColumnBillingAccessControl | null =
        model.getColumnBillingAccessControl(key);

      if (IsBillingEnabled && props.currentPlan && billingAccessControl) {
        if (
          requestType === DatabaseRequestType.Create &&
          billingAccessControl.create
        ) {
          if (
            !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
              billingAccessControl.create,
              props.currentPlan,
              getAllEnvVars(),
            )
          ) {
            throw new PaymentRequiredException(
              "Please upgrade your plan to " +
                billingAccessControl.create +
                " to access this feature",
            );
          }
        }

        if (
          requestType === DatabaseRequestType.Read &&
          billingAccessControl.read
        ) {
          if (
            !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
              billingAccessControl.read,
              props.currentPlan,
              getAllEnvVars(),
            )
          ) {
            throw new PaymentRequiredException(
              "Please upgrade your plan to " +
                billingAccessControl.read +
                " to access this feature",
            );
          }
        }

        if (
          requestType === DatabaseRequestType.Update &&
          billingAccessControl.update
        ) {
          if (
            !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
              billingAccessControl.update,
              props.currentPlan,
              getAllEnvVars(),
            )
          ) {
            throw new PaymentRequiredException(
              "Please upgrade your plan to " +
                billingAccessControl.update +
                " to access this feature",
            );
          }
        }
      }
    }
  }

  @CaptureSpan()
  public static async checkReadPermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<CheckReadPermissionType<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      query = await this.addTenantScopeToQueryAsRoot(modelType, query, props);
    }

    if (!props.isRoot && !props.isMasterAdmin) {
      //check if the user is logged in.
      this.checkIfUserIsLoggedIn(modelType, props, DatabaseRequestType.Read);

      // add tenant scope.
      query = await this.addTenantScopeToQuery(modelType, query, select, props);

      if (!props.isMultiTenantRequest) {
        // We will check for this permission in recursive function.

        // check model level permissions.
        this.checkModelLevelPermissions(
          modelType,
          props,
          DatabaseRequestType.Read,
        );

        /*
         * Apply the `Owned` permission scope filter for telemetry models
         * (Log/Span/Metric). Resolves the user's accessible Service IDs
         * once and constrains the ClickHouse query with `serviceId IN (...)`.
         * See Internal/Docs/PermissionsSimplification.md.
         */
        query = await this.addOwnedScopeToQuery(
          modelType,
          query,
          props,
          DatabaseRequestType.Read,
        );

        /*
         * We will check for this permission in recursive function.
         * check query permissions.
         */
        this.checkQueryPermission(modelType, query, props);

        if (select) {
          // check query permission.
          this.checkSelectPermission(modelType, select, props);
        }
      }
    }

    query = this.serializeQuery(query);

    if (select) {
      const result: {
        select: Select<TBaseModel>;
      } = this.sanitizeSelect(select);
      select = result.select;
    }

    return { query, select };
  }

  private static serializeQuery<TBaseModel extends BaseModel>(
    query: Query<TBaseModel>,
  ): Query<TBaseModel> {
    query = query as Query<TBaseModel>;

    return query;
  }

  private static sanitizeSelect<TBaseModel extends BaseModel>(
    select: Select<TBaseModel>,
  ): {
    select: Select<TBaseModel>;
  } {
    return { select };
  }

  private static getExcludedColumnNames(): string[] {
    const returnArr: Array<string> = [
      "_id",
      "createdAt",
      "deletedAt",
      "updatedAt",
      "version",
    ];

    return returnArr;
  }

  private static checkQueryPermission<TBaseModel extends BaseModel>(
    modelType: AnalyticsBaseModelType,
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();

    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const canReadOnTheseColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      userPermissions || [],
      DatabaseRequestType.Read,
    );

    const tableColumns: Array<AnalyticsTableColumn> = model.getTableColumns();

    const excludedColumnNames: Array<string> =
      ModelPermission.getExcludedColumnNames();

    // Now we need to check all columns.

    for (const key in query) {
      if (excludedColumnNames.includes(key)) {
        continue;
      }

      if (!canReadOnTheseColumns.columns.includes(key)) {
        const column: AnalyticsTableColumn | undefined = tableColumns.find(
          (item: AnalyticsTableColumn) => {
            return item.key === key;
          },
        );

        if (!column) {
          throw new BadDataException(
            `Invalid column on ${model.singularName} - ${key}. Column does not exist.`,
          );
        }

        throw new NotAuthorizedException(
          `You do not have permissions to query on - ${key}. You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
            column.accessControl?.read || [],
          ).join(", ")}`,
        );
      }
    }
  }

  private static async addTenantScopeToQueryAsRoot<
    TBaseModel extends BaseModel,
  >(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    const tenantColumn: string | null = model.getTenantColumn()?.key || null;

    // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
    if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
      (query as any)[tenantColumn] = props.tenantId;
    }

    return query;
  }

  private static async addTenantScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    const tenantColumn: string | null = model.getTenantColumn()?.key || null;

    // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
    if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
      (query as any)[tenantColumn] = props.tenantId;
    } else if (
      tenantColumn &&
      props.userGlobalAccessPermission &&
      (!props.tenantId || props.isMultiTenantRequest)
    ) {
      /*
       * for each of these projectIds,
       * check if they have valid permissions for these projects
       * and if they do, include them in the query.
       */

      const queries: Array<Query<TBaseModel>> = [];

      let projectIDs: Array<ObjectID> = [];

      if (
        props.userGlobalAccessPermission &&
        props.userGlobalAccessPermission.projectIds
      ) {
        projectIDs = props.userGlobalAccessPermission?.projectIds;
      }

      let lastException: Error | null = null;

      for (const projectId of projectIDs) {
        if (!props.userId) {
          continue;
        }

        try {
          const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
            await this.checkReadPermission(modelType, query, select, {
              ...props,
              isMultiTenantRequest: false,
              tenantId: projectId,
              userTenantAccessPermission: props.userTenantAccessPermission,
            });
          queries.push({
            ...(checkReadPermissionType.query as Query<TBaseModel>),
          });
        } catch (e) {
          // do nothing here. Ignore.
          lastException = e as Error;
        }
      }

      if (queries.length === 0) {
        throw new NotAuthorizedException(
          lastException?.message ||
            "Does not have permission to read " + model.singularName,
        );
      }

      return queries as any;
    }

    return query;
  }

  private static getModelColumnsByPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    userPermissions: Array<UserPermission>,
    requestType: DatabaseRequestType,
  ): Columns {
    const model: BaseModel = new modelType();
    const tableColumns: Array<AnalyticsTableColumn> = model.getTableColumns();

    const columns: Array<string> = [];

    const permissions: Array<Permission> = userPermissions.map(
      (item: UserPermission) => {
        return item.permission;
      },
    );

    for (const column of tableColumns) {
      let columnPermissions: Array<Permission> = [];

      if (requestType === DatabaseRequestType.Read) {
        columnPermissions = column.accessControl?.read || [];
      }

      if (requestType === DatabaseRequestType.Create) {
        columnPermissions = column.accessControl?.create || [];
      }

      if (requestType === DatabaseRequestType.Update) {
        columnPermissions = column.accessControl?.update || [];
      }

      if (requestType === DatabaseRequestType.Delete) {
        throw new BadDataException("Invalid request type delete");
      }

      if (
        columnPermissions &&
        PermissionHelper.doesPermissionsIntersect(
          permissions,
          columnPermissions,
        )
      ) {
        columns.push(column.key);
      }
    }

    return new Columns(columns);
  }

  private static checkSelectPermission<TBaseModel extends BaseModel>(
    modelType: AnalyticsBaseModelType,
    select: Select<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();

    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const canReadOnTheseColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      userPermissions || [],
      DatabaseRequestType.Read,
    );

    const tableColumns: Array<AnalyticsTableColumn> = model.getTableColumns();

    const excludedColumnNames: Array<string> =
      ModelPermission.getExcludedColumnNames();

    for (const key in select) {
      if (excludedColumnNames.includes(key)) {
        continue;
      }

      if (!canReadOnTheseColumns.columns.includes(key)) {
        const column: AnalyticsTableColumn | undefined = tableColumns.find(
          (column: AnalyticsTableColumn) => {
            return column.key === key;
          },
        );
        if (!column) {
          throw new BadDataException(
            `Invalid select clause. Cannot select on "${key}". This column does not exist on ${
              model.singularName
            }. Here are the columns you can select on instead: ${tableColumns.join(
              ", ",
            )}`,
          );
        }

        throw new NotAuthorizedException(
          `You do not have permissions to select on - ${key}.
                    You need any one of these permissions: ${PermissionHelper.getPermissionTitles(
                      column.accessControl?.read || [],
                    ).join(", ")}`,
        );
      }
    }
  }

  private static getModelPermissions(
    modelType: AnalyticsBaseModelType,
    type: DatabaseRequestType,
  ): Array<Permission> {
    let modelPermissions: Array<Permission> = [];
    const model: BaseModel = new modelType();

    if (type === DatabaseRequestType.Create) {
      modelPermissions = model.accessControl?.create || [];
    }

    if (type === DatabaseRequestType.Update) {
      modelPermissions = model.accessControl?.update || [];
    }

    if (type === DatabaseRequestType.Delete) {
      modelPermissions = model.accessControl?.delete || [];
    }

    if (type === DatabaseRequestType.Read) {
      modelPermissions = model.accessControl?.read || [];
    }

    return modelPermissions;
  }

  /*
   * Mirror of TablePermission.getEffectiveModelPermissions. Adds the
   * *AllOperationalResources wildcard for @OperationalResource analytics models. See
   * Internal/Docs/PermissionsSimplification.md.
   */
  private static getEffectiveModelPermissions(
    modelType: AnalyticsBaseModelType,
    modelPermissions: Array<Permission>,
    type: DatabaseRequestType,
  ): Array<Permission> {
    const effective: Array<Permission> = [...modelPermissions];

    const model: any = new modelType();
    if (model.isOperationalResource) {
      const wildcard: Permission | null =
        this.getWildcardPermissionForOperation(type);
      if (wildcard && !effective.includes(wildcard)) {
        effective.push(wildcard);
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
   * Scope filter for analytics models (Log, Span, Metric, ...). For each
   * applicable user permission row we resolve allowed parent resource IDs
   * based on its scope (`Owned` → ServiceOwner* tables; `Labels` → parent
   * resources matching the user's labels), union them, and inject
   * `serviceId IN (...)` into the ClickHouse query.
   *
   * Telemetry's serviceId is polymorphic — comment in Metric.ts says it
   * "can be the monitor id or the telemetry service id" — so Labels-scope
   * resolution walks both Service.labels (ServiceLabel join) and
   * Monitor.labels (MonitorLabel join). Owned-scope keeps the original
   * single-source ServiceOwner* lookup since that's what's wired today.
   *
   * The operational per-row owner-join from the Postgres path doesn't
   * scale to telemetry volume; one Postgres roundtrip + one indexed
   * predicate does. See Internal/Docs/PermissionsSimplification.md.
   */
  private static async addOwnedScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    if (type === DatabaseRequestType.Create) {
      return query;
    }

    /*
     * Only applies to analytics models that declare @OwnedThrough — today
     * Log, Span, Metric all do (to Service via serviceId). Anything without
     * it can't have ownership filtering applied, so we leave the query alone.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model: any = new modelType();
    if (!model.ownedThrough) {
      return query;
    }

    const modelPermissions: Array<Permission> = this.getModelPermissions(
      modelType,
      type,
    );
    const effectivePermissions: Array<Permission> =
      this.getEffectiveModelPermissions(modelType, modelPermissions, type);

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
      return query;
    }

    /*
     * If any applicable row grants unrestricted access (scope=All, or the
     * legacy Labels/unset scope with no labelIds), the broader grant wins
     * and no filter is applied. Owned and label-restricted rows narrow
     * access; an unrestricted row coexisting with them widens it back to
     * full access.
     */
    const hasUnrestrictedGrant: boolean = applicableRows.some(
      (p: UserPermission) => {
        if (p.scope === PermissionScope.All) {
          return true;
        }
        if (p.scope === PermissionScope.Owned) {
          return false;
        }
        // scope === Labels or undefined (legacy default)
        return !p.labelIds || p.labelIds.length === 0;
      },
    );
    if (hasUnrestrictedGrant) {
      return query;
    }

    const allowedResourceIds: Set<string> = new Set<string>();

    const hasOwnedGrant: boolean = applicableRows.some((p: UserPermission) => {
      return p.scope === PermissionScope.Owned;
    });
    if (hasOwnedGrant) {
      const ownedIds: Set<string> = await this.resolveOwnedParentIds(props);
      for (const id of ownedIds) {
        allowedResourceIds.add(id);
      }
    }

    const labelScopedRows: Array<UserPermission> = applicableRows.filter(
      (p: UserPermission) => {
        const isLabelsScope: boolean =
          p.scope === PermissionScope.Labels || p.scope === undefined;
        return isLabelsScope && Boolean(p.labelIds && p.labelIds.length > 0);
      },
    );
    if (labelScopedRows.length > 0) {
      const labelIdSet: Set<string> = new Set<string>();
      for (const row of labelScopedRows) {
        for (const labelId of row.labelIds) {
          labelIdSet.add(labelId.toString());
        }
      }
      const labelIds: Array<ObjectID> = Array.from(labelIdSet).map(
        (id: string) => {
          return new ObjectID(id);
        },
      );
      const labeledIds: Set<string> = await this.resolveLabeledParentIds(
        labelIds,
        props,
      );
      for (const id of labeledIds) {
        allowedResourceIds.add(id);
      }
    }

    /*
     * Telemetry with no owning resource (the unattributed "Unknown"
     * bucket) is tagged with the projectId in place of a resource id. It
     * belongs to the project, not any owner, so an Owned-scoped user
     * (project-level catch-all access) sees it. Gated on hasOwnedGrant:
     * a purely Labels-scoped user asked for label-matching telemetry, and
     * the unattributed bucket carries no labels, so it stays excluded for
     * them.
     */
    if (
      hasOwnedGrant &&
      model.ownedThrough.includeProjectScope &&
      props.tenantId
    ) {
      allowedResourceIds.add(props.tenantId.toString());
    }

    const fkColumn: string = model.ownedThrough.fkColumn;
    const idList: Array<string> =
      allowedResourceIds.size > 0
        ? Array.from(allowedResourceIds)
        : [ObjectID.getZeroObjectID().toString()]; // sentinel: match nothing

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (query as any)[fkColumn] = new Includes(idList);

    return query;
  }

  /*
   * Resolves Service IDs the user owns via ServiceOwnerUser /
   * ServiceOwnerTeam in Postgres. Lazy-required to avoid circular deps
   * with services that extend DatabaseService. Returns string IDs to
   * make set-union with other resolvers straightforward.
   *
   * Cached per request via the WeakMap on `props` — the inputs (userId,
   * teamIds, tenantId) are stable for the lifetime of one props object,
   * so repeated calls within the same request reuse the first result.
   */
  private static async resolveOwnedParentIds(
    props: DatabaseCommonInteractionProps,
  ): Promise<Set<string>> {
    const cache: ScopeResolveCacheEntry = getScopeCacheBucket(props);
    if (cache.ownedIds) {
      return cache.ownedIds;
    }

    const result: Set<string> = new Set<string>();

    const ownerTableRegistry: Map<
      string,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ownerUserService: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ownerTeamService: any;
        fkColumn: string;
        canOwnTelemetry?: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        modelService?: any;
      }
    > =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../Database/Permissions/OwnerTableRegistry").default;

    /*
     * Telemetry serviceId is polymorphic — it can reference any resource
     * type flagged `canOwnTelemetry` in the registry (Service, Monitor,
     * Host, DockerHost, KubernetesCluster). Resolve ownership across all of
     * them so a user who owns any such resource sees its telemetry, not
     * just owned Services. The polymorphic set lives only in the registry
     * (single source of truth); the resolved union is the same for every
     * telemetry analytics model, so the single per-request `ownedIds`
     * cache slot still holds it.
     */
    for (const entry of ownerTableRegistry.values()) {
      if (!entry.canOwnTelemetry) {
        continue;
      }
      const fkColumn: string = entry.fkColumn;

      if (props.userId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userOwnedRows: Array<any> = await entry.ownerUserService.findBy({
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
          const id: ObjectID | undefined = row[fkColumn];
          if (id) {
            result.add(id.toString());
          }
        }
      }

      if (props.userTeamIds && props.userTeamIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teamOwnedRows: Array<any> = await entry.ownerTeamService.findBy({
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
          const id: ObjectID | undefined = row[fkColumn];
          if (id) {
            result.add(id.toString());
          }
        }
      }
    }

    cache.ownedIds = result;
    return result;
  }

  /*
   * Resolves parent IDs whose labels intersect the given labelIds. Walks
   * both TelemetryService (`ServiceLabel`) and Monitor (`MonitorLabel`)
   * because telemetry's serviceId is polymorphic between the two. The
   * Postgres findBy passes labels through QueryUtil, which turns the
   * EntityArray filter into a many-to-many subquery against the join
   * table — see QueryUtil.ts ~line 528.
   *
   * Cached per request via the WeakMap on `props`, keyed by the sorted
   * label IDs joined into a string. Different model permission rows can
   * carry different label sets, so we key by the actual labelIds rather
   * than a single per-request slot.
   */
  private static async resolveLabeledParentIds(
    labelIds: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Set<string>> {
    const result: Set<string> = new Set<string>();

    if (labelIds.length === 0) {
      return result;
    }

    const cacheKey: string = labelIds
      .map((id: ObjectID) => {
        return id.toString();
      })
      .sort()
      .join(",");
    const cache: ScopeResolveCacheEntry = getScopeCacheBucket(props);
    const cached: Set<string> | undefined = cache.labeledIds.get(cacheKey);
    if (cached) {
      return cached;
    }

    const tenantFilter: Record<string, ObjectID> = props.tenantId
      ? { projectId: props.tenantId }
      : {};

    const ownerTableRegistry: Map<
      string,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ownerUserService: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ownerTeamService: any;
        fkColumn: string;
        canOwnTelemetry?: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        modelService?: any;
      }
    > =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../Database/Permissions/OwnerTableRegistry").default;

    /*
     * Telemetry serviceId is polymorphic across every resource type
     * flagged `canOwnTelemetry` in the registry (Service, Monitor, Host,
     * DockerHost, KubernetesCluster), each of which carries labels. Find
     * rows of each whose labels intersect the user's. Keeping this set in
     * the registry (single source of truth) means a new telemetry-owning
     * resource is picked up here automatically — no edits needed.
     */
    for (const entry of ownerTableRegistry.values()) {
      if (!entry.canOwnTelemetry || !entry.modelService) {
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: Array<any> = await entry.modelService.findBy({
        query: {
          labels: labelIds,
          ...tenantFilter,
        },
        select: { _id: true },
        props: { isRoot: true },
        skip: 0,
        limit: LIMIT_MAX,
      });
      for (const row of rows) {
        const id: ObjectID | string | undefined = row._id;
        if (id) {
          result.add(id.toString());
        }
      }
    }

    cache.labeledIds.set(cacheKey, result);
    return result;
  }

  private static isPublicPermissionAllowed(
    modelType: AnalyticsBaseModelType,
    type: DatabaseRequestType,
  ): boolean {
    let isPublicAllowed: boolean = false;
    isPublicAllowed = this.getModelPermissions(modelType, type).includes(
      Permission.Public,
    );
    return isPublicAllowed;
  }

  @CaptureSpan()
  public static checkIfUserIsLoggedIn(
    modelType: AnalyticsBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.

    if (!this.isPublicPermissionAllowed(modelType, type) && !props.userId) {
      if (props.userType === UserType.API) {
        // if its an API request then continue.
        return;
      }

      // this means the record is not publicly createable and the user is not logged in.
      throw new NotAuthenticatedException(
        `Authenticated user or a valid API key is needed to ${type} record of ${
          new modelType().singularName
        }.`,
      );
    }
  }

  private static checkModelLevelPermissions(
    modelType: AnalyticsBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    this.checkIfUserIsLoggedIn(modelType, props, type);

    // 2nd CHECK: Does user have access to CRUD data on this model.
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );
    const modelPermissions: Array<Permission> = this.getModelPermissions(
      modelType,
      type,
    );

    /*
     * Mirror of TablePermission's wildcard short-circuit so the analytics
     * path (ClickHouse-backed Log/Span/Metric) honors the same *AllOperationalResources
     * permissions. See Internal/Docs/PermissionsSimplification.md.
     */
    const effectiveModelPermissions: Array<Permission> =
      this.getEffectiveModelPermissions(modelType, modelPermissions, type);

    if (
      !PermissionHelper.doesPermissionsIntersect(
        userPermissions.map((userPermission: UserPermission) => {
          return userPermission.permission;
        }) || [],
        effectiveModelPermissions,
      )
    ) {
      const permissions: Array<string> =
        PermissionHelper.getPermissionTitles(modelPermissions);

      if (permissions.length === 0) {
        throw new NotAuthorizedException(
          `${type} on ${new modelType().singularName} is not allowed.`,
        );
      }

      throw new NotAuthorizedException(
        `You do not have permissions to ${type} ${
          new modelType().singularName
        }. You need one of these permissions: ${permissions.join(", ")}`,
      );
    }

    /// Check billing permissions.

    if (IsBillingEnabled && props.currentPlan) {
      const model: BaseModel = new modelType();

      if (
        props.isSubscriptionUnpaid &&
        !model.allowAccessIfSubscriptionIsUnpaid
      ) {
        throw new PaymentRequiredException(
          "Your current subscription is in an unpaid state. Looks like your payment method failed. Please add a new payment method in Project Settings > Invoices to pay unpaid invoices.",
        );
      }

      if (
        type === DatabaseRequestType.Create &&
        model.tableBillingAccessControl?.create
      ) {
        if (
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
            model.tableBillingAccessControl.create,
            props.currentPlan,
            getAllEnvVars(),
          )
        ) {
          throw new PaymentRequiredException(
            "Please upgrade your plan to " +
              model.tableBillingAccessControl.create +
              " to access this feature",
          );
        }
      }

      if (
        type === DatabaseRequestType.Update &&
        model.tableBillingAccessControl?.update
      ) {
        if (
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
            model.tableBillingAccessControl.update,
            props.currentPlan,
            getAllEnvVars(),
          )
        ) {
          throw new PaymentRequiredException(
            "Please upgrade your plan to " +
              model.tableBillingAccessControl.create +
              " to access this feature",
          );
        }
      }

      if (
        type === DatabaseRequestType.Delete &&
        model.tableBillingAccessControl?.delete
      ) {
        if (
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
            model.tableBillingAccessControl.delete,
            props.currentPlan,
            getAllEnvVars(),
          )
        ) {
          throw new PaymentRequiredException(
            "Please upgrade your plan to " +
              model.tableBillingAccessControl.create +
              " to access this feature",
          );
        }
      }

      if (
        type === DatabaseRequestType.Read &&
        model.tableBillingAccessControl?.read
      ) {
        if (
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
            model.tableBillingAccessControl?.read,
            props.currentPlan,
            getAllEnvVars(),
          )
        ) {
          throw new PaymentRequiredException(
            "Please upgrade your plan to " +
              model.tableBillingAccessControl?.read +
              " to access this feature",
          );
        }
      }
    }
  }
}
