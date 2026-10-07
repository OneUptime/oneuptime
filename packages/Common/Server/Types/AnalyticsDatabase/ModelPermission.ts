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
import { EXCEPTION_SPAN_SCOPE_QUERY_KEY } from "../../../Types/Telemetry/ExceptionSpanScope";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Columns from "../../../Types/Database/Columns";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { isAnalyticsPlanGatedColumnDefault } from "../../../Types/Billing/PlanGatedColumnDefault";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../Types/Permission";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";
import CallerPlan from "../../Utils/Billing/CallerPlan";
import PlanGates from "../Database/Permissions/PlanGates";
import ColumnWriteRefusedException from "../Database/Permissions/ColumnWriteRefusedException";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import { OwnedThroughMetadata } from "../../../Types/Database/AccessControl/OwnedThrough";
import type { OwnerTablePair } from "../Database/Permissions/OwnerTableRegistry";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../../Utils/Telemetry/TelemetryReadScope";
import PromiseCache from "../../Utils/PromiseCache";
import ArrayUtil from "../../../Utils/Array";

export interface CheckReadPermissionType<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  select: Select<TBaseModel> | null;
}

/*
 * Per-request cache for scope resolution. Keyed by the `props` object -
 * one HTTP request reuses the same `props` for every analytics query it
 * issues (a dashboard with 20 panels = up to 80 Postgres lookups without
 * this; ~4 with it). The WeakMap entry is released automatically when
 * `props` goes out of scope at request end, so there's no stale data
 * between requests.
 *
 * Caches, per resource type (Service, Host, RumApplication ...), so a read
 * covering some types and a read covering all of them share what either
 * looked up:
 *   - `ownedIds`: the ids of that type the user owns (the inputs are
 *     userId + teamIds + tenantId, all stable for one props).
 *   - `labeledIds`: keyed by the sorted label ids as well, since grants and
 *     blocks can carry different label sets.
 * Each holds the lookup's promise (PromiseCache.lookUpOnce), so reads
 * running at the same time share one lookup rather than racing to make it
 * twice.
 */
interface ScopeResolveCacheEntry {
  ownedIds: Map<string, Promise<Array<string>>>;
  labeledIds: Map<string, Promise<Array<string>>>;
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
    bucket = { ownedIds: new Map(), labeledIds: new Map() };
    scopeResolveCache.set(props, bucket);
  }
  return bucket;
}

/*
 * How many kinds of resource one lookup of a caller's scope reads at the
 * same time. The kinds do not wait on one another, but a scope reaches
 * every telemetry-owning kind (and a read across projects, every project),
 * so they are read a few at a time rather than all at once on the shared
 * database pool.
 */
export const SCOPE_LOOKUP_CONCURRENCY: number = 3;

/*
 * A read of telemetry under a list of permissions (see
 * getReadScopeForPermissions).
 */
export interface ReadGrantRequest {
  props: DatabaseCommonInteractionProps;
  permissions: ReadonlyArray<Permission>;
  wildcard?: Permission | null | undefined;
  includeProjectScope?: boolean | undefined;
  /*
   * The telemetry-owning resource types whose rows the read covers, by
   * model name (OwnerTableRegistry keys): session replays belong to RUM
   * applications only. Absent: every type (a log's primaryEntityId can
   * name a service, a host, a monitor, ...).
   */
  resourceTypes?: ReadonlyArray<string> | undefined;
  // What the refusal names: "read Log", "read session replays".
  recordName?: string | undefined;
  operation?: DatabaseRequestType | undefined;
}

// What a caller's rows say about a read, before any resource is looked up.
interface ReadGrants {
  // The labels a block on one of the permissions takes away.
  blockedLabelIds: Array<ObjectID>;
  // The allow rows that grant the read (for a permission or the wildcard).
  grantingRows: Array<UserPermission>;
  // One of them reaches the whole project.
  isProjectWide: boolean;
  // One of them is Owned: the resources the caller or their teams own.
  hasOwnedGrant: boolean;
  // The labels the rest of them are limited to.
  grantedLabelIds: Array<ObjectID>;
}

export default class ModelPermission {
  /*
   * A DELETE REACHES ONLY WHAT ITS CALLER MAY READ, as on the database
   * models (BasePermission.addRecordScopeToQuery): a caller who may read
   * none of the table's rows deletes none of them
   * (checkModelLevelReadForWrite), and the rows a delete reaches are those
   * of the resources both its own grants and the read's reach - their
   * labels and owners, less what a block with labels on either takes away.
   * A delete is made in one project at a time.
   */
  @CaptureSpan()
  public static async checkDeletePermission<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    // The project's plan, when the delete is one a plan decides (CallerPlan).
    props = await CallerPlan.withAnalyticsPlanFor({
      props: props,
      modelType: modelType,
      type: DatabaseRequestType.Delete,
    });

    if (props.isRoot || props.isMasterAdmin) {
      query = await this.addTenantScopeToQueryAsRoot(modelType, query, props);
    }

    if (!props.isRoot && !props.isMasterAdmin) {
      this.checkWriteIsInOneProject(modelType, props, DatabaseRequestType.Delete);
      this.checkModelLevelPermissions(
        modelType,
        props,
        DatabaseRequestType.Delete,
      );
      this.checkModelLevelReadForWrite(
        modelType,
        props,
        DatabaseRequestType.Delete,
      );
      query = await this.addTenantScopeToQuery(modelType, query, null, props);
      query = await this.addWriteScopeToQuery(
        modelType,
        query,
        props,
        DatabaseRequestType.Delete,
      );
    }

    return query;
  }

  /*
   * The rows an update or a delete reaches, of the resources the caller's
   * grants for the operation and for reading both reach (getReadScope for
   * each): a row of a resource the caller may not read is not one they may
   * change or delete. Root and master admins are left alone.
   */
  private static async addWriteScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType.Update | DatabaseRequestType.Delete,
  ): Promise<Query<TBaseModel>> {
    query = await this.addReadScopeToQuery(
      modelType,
      query,
      props,
      DatabaseRequestType.Read,
    );

    return await this.addReadScopeToQuery(modelType, query, props, type);
  }

  /*
   * A WRITE NEEDS A READ, on the table as on its rows: a caller who holds
   * none of the table's read permissions (nor its read wildcard), or whose
   * block with no labels takes one of them away, changes and deletes none
   * of its rows - the rule TablePermission.checkTableLevelReadForWrite holds
   * the database models to.
   */
  private static checkModelLevelReadForWrite(
    modelType: AnalyticsBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType.Update | DatabaseRequestType.Delete,
  ): void {
    const model: BaseModel = new modelType();
    const readPermissions: Array<Permission> = this.getModelPermissions(
      modelType,
      DatabaseRequestType.Read,
    );
    const held: HeldPermissions = ModelPermission.getHeldPermissions(props);

    const blockedReadPermission: Permission | undefined = readPermissions.find(
      (permission: Permission): boolean => {
        return held.blocked.includes(permission);
      },
    );

    if (blockedReadPermission) {
      throw new NotAuthorizedException(
        `You are not authorized to ${type} ${model.singularName} because you may not read it: ${blockedReadPermission} is in your team's permission block list.`,
      );
    }

    if (
      HeldPermissionsUtil.isGrantedAny(held, readPermissions, {
        wildcard: HeldPermissionsUtil.getModelWildcard({
          isOperationalResource: model.isOperationalResource,
          operation: DatabaseRequestType.Read,
        }),
      })
    ) {
      return;
    }

    const titles: Array<string> =
      PermissionHelper.getPermissionTitles(readPermissions);

    if (titles.length === 0) {
      throw new NotAuthorizedException(
        `${type} on ${model.singularName} is not allowed: nobody may read it.`,
      );
    }

    throw new NotAuthorizedException(
      `You do not have permissions to ${type} ${
        model.singularName
      }: changing or deleting a record needs permission to read it too. You need one of these permissions: ${titles.join(
        ", ",
      )}`,
    );
  }

  /*
   * An update or a delete is made in one project at a time: a request
   * across the caller's projects reads, and never writes.
   */
  private static checkWriteIsInOneProject(
    modelType: AnalyticsBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType.Update | DatabaseRequestType.Delete,
  ): void {
    if (props.isMultiTenantRequest) {
      throw new BadDataException(
        `${new modelType().singularName}: ${type} one project at a time. Send the project's id with the request, not a request across projects.`,
      );
    }
  }

  @CaptureSpan()
  public static async checkUpdatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    data: TBaseModel,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    // The project's plan, when the update is one a plan decides (CallerPlan).
    props = await CallerPlan.withAnalyticsPlanFor({
      props: props,
      modelType: modelType,
      type: DatabaseRequestType.Update,
      data: data,
    });

    this.checkWriteIsInOneProject(modelType, props, DatabaseRequestType.Update);

    this.checkModelLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
    );

    this.checkModelLevelReadForWrite(
      modelType,
      props,
      DatabaseRequestType.Update,
    );

    // The read's checks and scope, which an update keeps to.
    const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
      await this.checkReadPermission(modelType, query, null, props);

    // And the update's own grants: the rows of resources both reach.
    query = await this.addReadScopeToQuery(
      modelType,
      checkReadPermissionType.query,
      props,
      DatabaseRequestType.Update,
    );

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
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);

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
    const permissionColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      ModelPermission.getColumnCheckRows(props),
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

        throw new ColumnWriteRefusedException({
          requestType: requestType,
          columnName: key,
          modelName: model.singularName,
        });
      }

      const billingAccessControl: ColumnBillingAccessControl | null =
        model.getColumnBillingAccessControl(key);

      if (IsBillingEnabled && billingAccessControl) {
        /*
         * A paid feature can always be switched off: a create or update that
         * puts a plan-gated column back to its default needs no plan - the
         * rule the database models' column check (ColumnPermission) applies,
         * so the first plan-gated analytics column behaves the same
         * (PlanGatedColumnDefault). Anything else written to it still does.
         */
        if (
          (requestType === DatabaseRequestType.Create ||
            requestType === DatabaseRequestType.Update) &&
          isAnalyticsPlanGatedColumnDefault(column, (data as any)[key])
        ) {
          continue;
        }

        const requiredPlan: PlanType | undefined = PlanGates.getColumnPlan(
          billingAccessControl,
          requestType,
        );

        if (!requiredPlan) {
          continue;
        }

        /*
         * No plan on props that act in a project is never "any plan": the
         * request is refused (CallerPlan), unless every plan includes the
         * column. OneUptime itself and server admins need no plan.
         */
        if (!props.currentPlan) {
          if (!PlanGates.isMetByEveryPlan(requiredPlan)) {
            CallerPlan.assertPlanKnown(props);
          }

          continue;
        }

        if (
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
            requiredPlan,
            props.currentPlan,
            getAllEnvVars(),
          )
        ) {
          throw new PaymentRequiredException(
            "Please upgrade your plan to " +
              requiredPlan +
              " to access this feature",
          );
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
    // The project's plan, when the read is one a plan decides (CallerPlan).
    props = await CallerPlan.withAnalyticsPlanFor({
      props: props,
      modelType: modelType,
      type: DatabaseRequestType.Read,
    });

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
         * Narrow telemetry reads (Log, Span, Metric, ...) to the resources
         * the caller may read: their label and Owned scope, less what a
         * block with labels takes away (getReadScope).
         */
        query = await this.addReadScopeToQuery(
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
      /*
       * Synthetic query key compiled by StatementGenerator to
       * (hasAny(entityKeys, ...) OR attributes[...] = ...) — not a real
       * column; it only narrows rows on models that have entityKeys and
       * never widens access (authorization stays on primaryEntityId).
       */
      "entityScope",
      /*
       * Synthetic query key compiled by StatementGenerator to an AND of
       * per-resource-facet OR groups (primaryEntityId / entityKeys /
       * resource attribute). Like entityScope it is not a real column and
       * only ever narrows rows — authorization still runs on
       * primaryEntityId. Written by the telemetry services' onBeforeFind
       * from the client-sent `resourceFilters` ids.
       */
      "resourceEntityScopes",
      /*
       * Synthetic query key compiled by StatementGenerator to
       * (traceId, spanId) IN (SELECT ... FROM <exception occurrences> WHERE
       * projectId = <the query's project> AND fingerprint = ...). Not a real
       * column; it only narrows spans to those an exception group was raised
       * in, and the subquery is pinned to the query's own project.
       */
      EXCEPTION_SPAN_SCOPE_QUERY_KEY,
    ];

    return returnArr;
  }

  private static checkQueryPermission<TBaseModel extends BaseModel>(
    modelType: AnalyticsBaseModelType,
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): void {
    const model: BaseModel = new modelType();

    const canReadOnTheseColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      ModelPermission.getColumnCheckRows(props),
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
          /*
           * Each project is read on its own plan (CallerPlan.inProject),
           * which checkReadPermission reads for it.
           */
          const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
            await this.checkReadPermission(
              modelType,
              query,
              select,
              CallerPlan.inProjectWithoutPlan(props, projectId),
            );
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

  /*
   * The caller's permission rows as a column check reads them - the rows the
   * database models' checks weigh (DatabaseCommonInteractionPropsUtil
   * .getPermissionRows).
   */
  private static getColumnCheckRows(
    props: DatabaseCommonInteractionProps,
  ): Array<UserPermission> {
    return DatabaseCommonInteractionPropsUtil.getPermissionRows(props);
  }

  /*
   * The columns the caller's rows may read, create or update, by the rule
   * every permission check follows (HeldPermissionsUtil
   * .holdsColumnPermission) - as the database models' column check reads it
   * (ColumnPermission): an allow row for one of the column's permissions, no
   * block with no labels on any of them, and on an operational resource the
   * table's *AllOperationalResources wildcard for a column that lets in
   * everyone its table does.
   */
  private static getModelColumnsByPermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    userPermissions: Array<UserPermission>,
    requestType: DatabaseRequestType,
  ): Columns {
    const model: BaseModel = new modelType();
    const tableColumns: Array<AnalyticsTableColumn> = model.getTableColumns();

    const columns: Array<string> = [];

    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: userPermissions,
    });

    const tablePermissions: Array<Permission> =
      requestType === DatabaseRequestType.Delete
        ? []
        : this.getModelPermissions(
            modelType as unknown as AnalyticsBaseModelType,
            requestType,
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
        HeldPermissionsUtil.holdsColumnPermission(held, {
          isOperationalResource: model.isOperationalResource,
          operation: requestType,
          tablePermissions: tablePermissions,
          columnPermissions: columnPermissions,
        })
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

    const canReadOnTheseColumns: Columns = this.getModelColumnsByPermissions(
      modelType,
      ModelPermission.getColumnCheckRows(props),
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
          /*
           * tableColumns holds AnalyticsTableColumn objects, so joining them
           * rendered the remediation list as "[object Object], [object
           * Object], ..." - the half of the sentence that tells the caller
           * what to do instead said nothing at all.
           */
          const selectableColumns: string = tableColumns
            .map((tableColumn: AnalyticsTableColumn) => {
              return tableColumn.key;
            })
            .join(", ");

          throw new BadDataException(
            `Invalid select clause. Cannot select on "${key}". This column does not exist on ${
              model.singularName
            }. Here are the columns you can select on instead: ${selectableColumns}`,
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
   * The permissions whose allow rows grant the operation, as the database
   * models' table check counts them (HeldPermissionsUtil
   * .getGrantingPermissions): the model's own list, and the
   * *AllOperationalResources wildcard for @OperationalResource analytics
   * models - unless a block with no labels takes the wildcard away or the
   * list is empty (nobody may do the operation).
   */
  private static getEffectiveModelPermissions(
    modelType: AnalyticsBaseModelType,
    modelPermissions: Array<Permission>,
    type: DatabaseRequestType,
    props: DatabaseCommonInteractionProps,
  ): Array<Permission> {
    return HeldPermissionsUtil.getGrantingPermissions(
      ModelPermission.getHeldPermissions(props),
      {
        modelPermissions: modelPermissions,
        wildcard: HeldPermissionsUtil.getModelWildcard({
          isOperationalResource: new modelType().isOperationalResource,
          operation: type,
        }),
      },
    );
  }

  /*
   * What the caller holds, read as the database models' checks read it
   * (TablePermission.getHeldPermissions).
   */
  private static getHeldPermissions(
    props: DatabaseCommonInteractionProps,
  ): HeldPermissions {
    return HeldPermissionsUtil.fromRows({
      rows: ModelPermission.getColumnCheckRows(props),
    });
  }

  /*
   * WHOSE TELEMETRY THE CALLER MAY READ, for one analytics model and
   * operation: the scope the model reads apply (addReadScopeToQuery) and the
   * one the /telemetry/* routes and the AI tools that build their own SQL
   * apply (Server/Utils/Telemetry/TelemetryReadAccess), worked out in this
   * one place so they cannot drift apart. See TelemetryReadScope for what
   * the scope means.
   *
   * A model whose rows name no owning resource (no @OwnedThrough) has
   * nothing to scope by, so its reads are only the table check's business:
   * the whole project.
   */
  public static async getReadScope<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType = DatabaseRequestType.Read,
  ): Promise<TelemetryReadScope> {
    if (props.isRoot || props.isMasterAdmin) {
      return TelemetryReadScopeUtil.getUnrestrictedScope();
    }

    const model: TBaseModel = new modelType();
    const ownedThrough: OwnedThroughMetadata | undefined =
      ModelPermission.getOwnedThrough(model);

    if (!ownedThrough) {
      return TelemetryReadScopeUtil.getUnrestrictedScope();
    }

    return await this.getReadScopeForPermissions({
      props: props,
      permissions: this.getModelPermissions(
        modelType as unknown as AnalyticsBaseModelType,
        type,
      ),
      wildcard: HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: type,
      }),
      includeProjectScope: ownedThrough.includeProjectScope,
      /*
       * A row that names a record of its parent models alone (a monitor
       * log's monitor) is scoped by those parents only; a telemetry row's
       * resource id can name any telemetry-owning kind.
       */
      resourceTypes: ownedThrough.onlyParentModels
        ? ownedThrough.parentModels.map(
            (parentModel: { name: string }): string => {
              return parentModel.name;
            },
          )
        : undefined,
      recordName: model.singularName,
      operation: type,
    });
  }

  /*
   * The same scope for a list of permissions a route accepts on its own
   * (session replay reads, whose list, payload and identity grants are
   * narrower than the RumSession model's table list), by the rule every
   * permission check follows (HeldPermissionsUtil):
   *
   *   1. A block with no labels on any of `permissions` refuses the read.
   *   2. The rows that grant it are allow rows for one of `permissions`, or
   *      for the wildcard (unless a block with no labels takes the wildcard
   *      away). None: the caller reads no resource at all.
   *   3. A grant that reaches the whole project (HeldPermissionsUtil
   *      .isProjectWideRow) reads every resource. Otherwise the caller reads
   *      the resources their Owned grants own and their label grants'
   *      labels are on (any telemetry-owning resource type, see
   *      OwnerTableRegistry.canOwnTelemetry), and, with includeProjectScope,
   *      an Owned grant also reads the project's unattributed bucket (rows
   *      carrying the project id in place of a resource id).
   *   4. A block with labels on any of `permissions` takes away the
   *      resources carrying those labels, whatever else the caller holds -
   *      as a block with labels leaves out the records carrying them on the
   *      CRUD path (ReadPermission.checkReadBlockPermission). A block with
   *      labels on the wildcard takes away what the wildcard grants: it
   *      counts while the wildcard grants the read and none of
   *      `permissions` reaches the whole project
   *      (HeldPermissionsUtil.getLabelBlockingPermissions). A block with no
   *      labels on the wildcard takes the wildcard away (step 2).
   */
  public static async getReadScopeForPermissions(
    data: ReadGrantRequest,
  ): Promise<TelemetryReadScope> {
    const props: DatabaseCommonInteractionProps = data.props;

    if (props.isRoot || props.isMasterAdmin) {
      return TelemetryReadScopeUtil.getUnrestrictedScope();
    }

    const grants: ReadGrants = ModelPermission.getReadGrants(data);

    // Resources the read is narrowed to, when no grant reaches the whole project.
    const isNarrowed: boolean =
      grants.grantingRows.length > 0 && !grants.isProjectWide;

    const noResources: Promise<Set<string>> = Promise.resolve(
      new Set<string>(),
    );

    // The three lookups do not depend on each other: they run together.
    const [blockedSet, ownedSet, labelledSet]: [
      Set<string>,
      Set<string>,
      Set<string>,
    ] = await Promise.all([
      grants.blockedLabelIds.length > 0
        ? this.resolveLabeledParentIds(
            grants.blockedLabelIds,
            props,
            data.resourceTypes,
          )
        : noResources,
      isNarrowed && grants.hasOwnedGrant
        ? this.resolveOwnedParentIds(props, data.resourceTypes)
        : noResources,
      isNarrowed && grants.grantedLabelIds.length > 0
        ? this.resolveLabeledParentIds(
            grants.grantedLabelIds,
            props,
            data.resourceTypes,
          )
        : noResources,
    ]);

    const blockedIds: Array<string> = Array.from(blockedSet);

    if (grants.grantingRows.length === 0) {
      // Nothing grants the read: the caller reads no resource at all.
      return { readableIds: [], blockedIds: blockedIds };
    }

    if (grants.isProjectWide) {
      return { readableIds: null, blockedIds: blockedIds };
    }

    const readableIds: Set<string> = new Set<string>();

    if (grants.hasOwnedGrant) {
      for (const id of ownedSet) {
        readableIds.add(id);
      }

      /*
       * Telemetry with no owning resource (the unattributed "Unknown"
       * bucket) is tagged with the project id in place of a resource id.
       * It belongs to the project, not any owner, so an Owned grant
       * (project-level catch-all access) reads it. A grant limited to
       * labels asked for label-matching telemetry, and the bucket carries
       * no labels, so it stays out for them.
       */
      if (data.includeProjectScope && props.tenantId) {
        readableIds.add(props.tenantId.toString());
      }
    }

    for (const id of labelledSet) {
      readableIds.add(id);
    }

    return {
      readableIds: Array.from(readableIds).filter((id: string): boolean => {
        return !blockedSet.has(id);
      }),
      blockedIds: blockedIds,
    };
  }

  /*
   * THE SAME RULE FOR ONE RESOURCE, decided from what the resource is - its
   * labels, and (only when an Owned grant has to be weighed) its owners -
   * rather than by looking up every resource the caller may read. For a
   * read that is about one resource at a time, over and over: a session
   * replay's application, on every page of a playback.
   *
   * Refuses (NotAuthorizedException) exactly when getReadScopeForPermissions
   * does: a block with no labels on one of the permissions.
   */
  public static async isResourceReadableForPermissions(
    data: ReadGrantRequest & {
      resource: {
        id: string;
        labelIds: ReadonlyArray<string>;
        // The resource's owner users and teams, asked for only when needed.
        getOwners: () => Promise<{
          userIds: ReadonlyArray<string>;
          teamIds: ReadonlyArray<string>;
        }>;
      };
    },
  ): Promise<boolean> {
    const props: DatabaseCommonInteractionProps = data.props;

    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    const grants: ReadGrants = ModelPermission.getReadGrants(data);

    const resourceLabelIds: Set<string> = new Set<string>(
      data.resource.labelIds.map((id: string): string => {
        return TelemetryReadScopeUtil.normalizeId(id);
      }),
    );

    const carriesOneOf: (labelIds: Array<ObjectID>) => boolean = (
      labelIds: Array<ObjectID>,
    ): boolean => {
      return labelIds.some((labelId: ObjectID): boolean => {
        return resourceLabelIds.has(
          TelemetryReadScopeUtil.normalizeId(labelId.toString()),
        );
      });
    };

    // A block with labels takes the resource away, whatever else holds.
    if (carriesOneOf(grants.blockedLabelIds)) {
      return false;
    }

    if (grants.grantingRows.length === 0) {
      return false;
    }

    if (grants.isProjectWide) {
      return true;
    }

    if (carriesOneOf(grants.grantedLabelIds)) {
      return true;
    }

    if (!grants.hasOwnedGrant) {
      return false;
    }

    const owners: {
      userIds: ReadonlyArray<string>;
      teamIds: ReadonlyArray<string>;
    } = await data.resource.getOwners();

    const userId: string | null = props.userId
      ? TelemetryReadScopeUtil.normalizeId(props.userId.toString())
      : null;

    if (
      userId &&
      owners.userIds.some((ownerId: string): boolean => {
        return TelemetryReadScopeUtil.normalizeId(ownerId) === userId;
      })
    ) {
      return true;
    }

    const callerTeamIds: Set<string> = new Set<string>(
      (props.userTeamIds || []).map((teamId: ObjectID): string => {
        return TelemetryReadScopeUtil.normalizeId(teamId.toString());
      }),
    );

    return owners.teamIds.some((teamId: string): boolean => {
      return callerTeamIds.has(TelemetryReadScopeUtil.normalizeId(teamId));
    });
  }

  /*
   * Whether the caller reads EVERY resource under a list of permissions -
   * a grant over the whole project and no block with labels on any of them
   * - decided without looking anything up. Refuses as
   * getReadScopeForPermissions does.
   */
  public static readsEveryResourceForPermissions(
    data: ReadGrantRequest,
  ): boolean {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return true;
    }

    const grants: ReadGrants = ModelPermission.getReadGrants(data);

    return grants.isProjectWide && grants.blockedLabelIds.length === 0;
  }

  /*
   * What the caller's rows say about a read under a list of permissions,
   * before any resource is looked up - steps 1, 2 and 4 of the rule
   * (getReadScopeForPermissions). Refuses on a block with no labels.
   */
  private static getReadGrants(data: ReadGrantRequest): ReadGrants {
    const props: DatabaseCommonInteractionProps = data.props;
    const held: HeldPermissions = ModelPermission.getHeldPermissions(props);

    const tableWideBlock: Permission | undefined = data.permissions.find(
      (permission: Permission): boolean => {
        return held.blocked.includes(permission);
      },
    );

    if (tableWideBlock) {
      throw new NotAuthorizedException(
        `You are not authorized to ${(
          data.operation || DatabaseRequestType.Read
        ).toLowerCase()} ${
          data.recordName || "this telemetry"
        } because ${tableWideBlock} is in your team's permission block list.`,
      );
    }

    const blockingPermissions: Array<Permission> =
      HeldPermissionsUtil.getLabelBlockingPermissions(held, {
        modelPermissions: [...data.permissions],
        wildcard: data.wildcard,
      });

    const blockedLabelIds: Array<ObjectID> = this.getLabelIdsOfRows(
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      ).filter((row: UserPermission): boolean => {
        return blockingPermissions.includes(row.permission);
      }),
    );

    const grantingPermissions: Array<Permission> =
      HeldPermissionsUtil.getGrantingPermissions(held, {
        modelPermissions: [...data.permissions],
        wildcard: data.wildcard,
      });

    const grantingRows: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).filter((row: UserPermission): boolean => {
        return grantingPermissions.includes(row.permission);
      });

    return {
      blockedLabelIds: blockedLabelIds,
      grantingRows: grantingRows,
      isProjectWide: grantingRows.some((row: UserPermission): boolean => {
        return HeldPermissionsUtil.isProjectWideRow(row);
      }),
      hasOwnedGrant: grantingRows.some((row: UserPermission): boolean => {
        return row.scope === PermissionScope.Owned;
      }),
      grantedLabelIds: this.getLabelIdsOfRows(
        grantingRows.filter((row: UserPermission): boolean => {
          return row.scope !== PermissionScope.Owned;
        }),
      ),
    };
  }

  /*
   * The owner table registry. Read when first needed rather than imported:
   * the registry imports the owner services, which extend DatabaseService,
   * which reaches this module - the same reason OwnedScopePermission and
   * DatabaseService read it this way. Only its type is imported above.
   */
  private static getOwnerTableRegistry(): Map<string, OwnerTablePair> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../Database/Permissions/OwnerTableRegistry").default;
  }

  /*
   * The resource types telemetry can belong to (the registry entries
   * flagged canOwnTelemetry), by model name: Service, Host, KubernetesCluster,
   * RumApplication, ...
   */
  public static getTelemetryResourceTypes(): Array<string> {
    return this.getOwnerTypesOfRead(undefined).map(
      ([resourceType]: [string, OwnerTablePair]): string => {
        return resourceType;
      },
    );
  }

  /*
   * The entries of the owner table registry a read covers, with their model
   * names. A read that names its kinds covers exactly those, telemetry-owning
   * or not: its rows name records of those kinds alone (a monitor log's
   * monitor, an SLO history row's SLO, a RUM application's session
   * replays). A read that names none covers every kind flagged
   * canOwnTelemetry, as a telemetry row's resource id can name any of them.
   */
  private static getOwnerTypesOfRead(
    resourceTypes: ReadonlyArray<string> | undefined,
  ): Array<[string, OwnerTablePair]> {
    return Array.from(this.getOwnerTableRegistry().entries()).filter(
      ([resourceType, entry]: [string, OwnerTablePair]): boolean => {
        return resourceTypes
          ? resourceTypes.includes(resourceType)
          : Boolean(entry.canOwnTelemetry);
      },
    );
  }

  // The distinct label ids on `rows`, in a stable order.
  private static getLabelIdsOfRows(
    rows: Array<UserPermission>,
  ): Array<ObjectID> {
    const labelIds: Set<string> = new Set<string>();

    for (const row of rows) {
      for (const labelId of row.labelIds || []) {
        labelIds.add(labelId.toString());
      }
    }

    return Array.from(labelIds)
      .sort()
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  /*
   * Narrows a model read (or delete) to the caller's scope on the column
   * that names the row's resource (@OwnedThrough). Root, master admins,
   * creates and models without @OwnedThrough are left alone.
   */
  private static async addReadScopeToQuery<TBaseModel extends BaseModel>(
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

    const ownedThrough: OwnedThroughMetadata | undefined =
      ModelPermission.getOwnedThrough(new modelType());

    if (!ownedThrough) {
      return query;
    }

    const scope: TelemetryReadScope = await this.getReadScope(
      modelType,
      props,
      type,
    );

    return TelemetryReadScopeUtil.applyToQuery(
      query,
      ownedThrough.fkColumn,
      scope,
    );
  }

  // The column that names a row's owning resource (@OwnedThrough), if any.
  private static getOwnedThrough(
    model: BaseModel,
  ): OwnedThroughMetadata | undefined {
    return (model as unknown as { ownedThrough?: OwnedThroughMetadata })
      .ownedThrough;
  }

  /*
   * Resolves the IDs of telemetry-owning resources the user owns, through
   * each type's *OwnerUser / *OwnerTeam tables in Postgres. Returns string
   * IDs to make set-union with other resolvers straightforward.
   *
   * Telemetry's primaryEntityId is polymorphic - it can reference any
   * resource type flagged `canOwnTelemetry` in the registry (Service,
   * Monitor, Host, DockerHost, KubernetesCluster, RUM application, ...) -
   * so ownership is resolved across all of them unless the read names the
   * types it covers (session replays: RUM applications). The polymorphic set
   * lives only in the registry (single source of truth).
   *
   * Looked up once per resource type per request (the WeakMap on `props`):
   * the inputs (userId, teamIds, tenantId) are stable for one props object,
   * so every read of the request - whichever types it covers - reuses what
   * an earlier one found, and reads running at the same time share one
   * lookup.
   */
  private static async resolveOwnedParentIds(
    props: DatabaseCommonInteractionProps,
    resourceTypes?: ReadonlyArray<string> | undefined,
  ): Promise<Set<string>> {
    const cache: ScopeResolveCacheEntry = getScopeCacheBucket(props);

    // The kinds of resource are looked up a few at a time.
    const idsByType: Array<Array<string>> = await ArrayUtil.mapWithConcurrency(
      this.getOwnerTypesOfRead(resourceTypes),
      SCOPE_LOOKUP_CONCURRENCY,
      ([resourceType, entry]: [string, OwnerTablePair]): Promise<
        Array<string>
      > => {
        return PromiseCache.lookUpOnce(
          cache.ownedIds,
          resourceType,
          (): Promise<Array<string>> => {
            return this.findOwnedIdsOfType(entry, props);
          },
        );
      },
    );

    return new Set<string>(idsByType.flat());
  }

  // The resources of one type the user, or one of their teams, owns.
  private static async findOwnedIdsOfType(
    entry: OwnerTablePair,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<string>> {
    const tenantFilter: Record<string, ObjectID> = props.tenantId
      ? { projectId: props.tenantId }
      : {};

    const [userOwned, teamOwned]: [Array<string>, Array<string>] =
      await Promise.all([
        props.userId
          ? this.findAllIds({
              service: entry.ownerUserService,
              query: { userId: props.userId, ...tenantFilter },
              column: entry.fkColumn,
            })
          : Promise.resolve([]),
        props.userTeamIds && props.userTeamIds.length > 0
          ? this.findAllIds({
              service: entry.ownerTeamService,
              query: {
                teamId: QueryHelper.any(props.userTeamIds),
                ...tenantFilter,
              },
              column: entry.fkColumn,
            })
          : Promise.resolve([]),
      ]);

    return [...userOwned, ...teamOwned];
  }

  /*
   * The users and teams that own one resource of a kind in the owner table
   * registry (a RUM application ...) - the same owner tables, project filter
   * and paging as resolveOwnedParentIds - for a decision about that one
   * resource (isResourceReadableForPermissions).
   */
  public static async findOwnersOfResource(data: {
    resourceType: string;
    resourceId: ObjectID;
    tenantId?: ObjectID | undefined;
  }): Promise<{ userIds: Array<string>; teamIds: Array<string> }> {
    const entry: OwnerTablePair | undefined = this.getOwnerTypesOfRead([
      data.resourceType,
    ]).map(([, pair]: [string, OwnerTablePair]): OwnerTablePair => {
      return pair;
    })[0];

    if (!entry) {
      return { userIds: [], teamIds: [] };
    }

    const query: Record<string, ObjectID> = {
      [entry.fkColumn]: data.resourceId,
      ...(data.tenantId ? { projectId: data.tenantId } : {}),
    };

    const [userIds, teamIds]: [Array<string>, Array<string>] =
      await Promise.all([
        this.findAllIds({
          service: entry.ownerUserService,
          query: query,
          column: "userId",
        }),
        this.findAllIds({
          service: entry.ownerTeamService,
          query: query,
          column: "teamId",
        }),
      ]);

    return { userIds, teamIds };
  }

  /*
   * Resolves the IDs of telemetry-owning resources whose labels intersect
   * the given labelIds - across every type flagged `canOwnTelemetry` in the
   * registry (each carries labels), or only the types the read names. The
   * Postgres findBy passes labels through QueryUtil, which turns the
   * EntityArray filter into a many-to-many subquery against the join table.
   * Keeping the set of types in the registry means a new telemetry-owning
   * resource is picked up here automatically.
   *
   * Looked up once per resource type and label set per request (the WeakMap
   * on `props`): different permission rows (grants and blocks) can carry
   * different label sets.
   */
  private static async resolveLabeledParentIds(
    labelIds: Array<ObjectID>,
    props: DatabaseCommonInteractionProps,
    resourceTypes?: ReadonlyArray<string> | undefined,
  ): Promise<Set<string>> {
    const result: Set<string> = new Set<string>();

    if (labelIds.length === 0) {
      return result;
    }

    const labelsKey: string = labelIds
      .map((id: ObjectID) => {
        return id.toString();
      })
      .sort()
      .join(",");
    const cache: ScopeResolveCacheEntry = getScopeCacheBucket(props);
    const tenantFilter: Record<string, ObjectID> = props.tenantId
      ? { projectId: props.tenantId }
      : {};

    // The kinds of resource are looked up a few at a time.
    const idsByType: Array<Array<string>> = await ArrayUtil.mapWithConcurrency(
      this.getOwnerTypesOfRead(resourceTypes).filter(
        ([, entry]: [string, OwnerTablePair]): boolean => {
          return Boolean(entry.modelService);
        },
      ),
      SCOPE_LOOKUP_CONCURRENCY,
      ([resourceType, entry]: [string, OwnerTablePair]): Promise<
        Array<string>
      > => {
        const modelService: OwnerTablePair["modelService"] = entry.modelService;

        return PromiseCache.lookUpOnce(
          cache.labeledIds,
          `${resourceType}|${labelsKey}`,
          (): Promise<Array<string>> => {
            return this.findAllIds({
              service: modelService,
              query: { labels: labelIds, ...tenantFilter },
              column: "_id",
            });
          },
        );
      },
    );

    for (const ids of idsByType) {
      for (const id of ids) {
        result.add(id);
      }
    }

    return result;
  }

  /*
   * Every `column` value the rows a lookup matches carry, page by page. A
   * list cut short would read as fewer resources than there are: for a
   * grant, fewer the caller may read; for a block, fewer it takes away.
   */
  private static async findAllIds(data: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service: { findBy: (findBy: any) => Promise<Array<any>> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: Record<string, any>;
    column: string;
  }): Promise<Array<string>> {
    const ids: Array<string> = [];

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: Array<any> = await data.service.findBy({
        query: data.query,
        select: { [data.column]: true },
        sort: { _id: SortOrder.Ascending },
        props: { isRoot: true },
        skip: skip,
        limit: LIMIT_MAX,
      });

      for (const row of rows) {
        const id: ObjectID | string | undefined = row[data.column];
        if (id) {
          ids.push(id.toString());
        }
      }

      if (rows.length < LIMIT_MAX) {
        return ids;
      }
    }
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
      /*
       * An API key or a workflow step: signed in, though not as a person.
       * Its permission rows decide the rest.
       */
      if (
        DatabaseCommonInteractionPropsUtil.isProjectPrincipalWithoutPerson(
          props,
        )
      ) {
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
      this.getEffectiveModelPermissions(
        modelType,
        modelPermissions,
        type,
        props,
      );

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

    /*
     * A block with no labels on any of the model's permissions takes the
     * operation away, whatever else the caller holds - the rule every
     * permission check follows (HeldPermissionsUtil), and the one the
     * database models' table check applies
     * (TablePermission.checkTableLevelBlockPermissions). A block with labels
     * restricts only records carrying them.
     */
    const blocked: Array<Permission> =
      ModelPermission.getHeldPermissions(props).blocked;

    const tableWideBlock: Permission | undefined = modelPermissions.find(
      (permission: Permission): boolean => {
        return blocked.includes(permission);
      },
    );

    if (tableWideBlock) {
      throw new NotAuthorizedException(
        `You are not authorized to ${type} ${
          new modelType().singularName
        } because ${tableWideBlock} is in your team's permission block list.`,
      );
    }

    /// Check billing permissions.

    if (!IsBillingEnabled) {
      return;
    }

    const model: BaseModel = new modelType();

    const requiredPlan: PlanType | undefined = PlanGates.getAnalyticsTablePlan(
      model,
      type,
    );

    /*
     * Props that act in a project but carry no plan are never read as "any
     * plan" (CallerPlan): a table that names a plan for this operation -
     * one not every plan includes - is refused to them. OneUptime itself
     * and server admins need no plan.
     */
    if (!props.currentPlan) {
      if (!PlanGates.isMetByEveryPlan(requiredPlan)) {
        CallerPlan.assertPlanKnown(props);
      }

      return;
    }

    if (
      props.isSubscriptionUnpaid &&
      !model.allowAccessIfSubscriptionIsUnpaid
    ) {
      throw new PaymentRequiredException(
        "Your current subscription is in an unpaid state. Looks like your payment method failed. Please add a new payment method in Project Settings > Invoices to pay unpaid invoices.",
      );
    }

    if (
      requiredPlan &&
      !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        requiredPlan,
        props.currentPlan,
        getAllEnvVars(),
      )
    ) {
      throw new PaymentRequiredException(
        "Please upgrade your plan to " +
          requiredPlan +
          " to access this feature",
      );
    }
  }
}
