import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import Select from "../Select";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import TablePermission from "./TablePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * Permissions auto-granted to every logged-in tenant user. Holding only these
 * (without an actual role permission) does not signal admin authority and so
 * should not unlock cross-row access on models that scope by user.
 *
 * `Permission.ProjectUser` is auto-granted too (AccessTokenService adds it for
 * every project member) but is deliberately NOT listed here. These three are
 * granted to callers a model never opted into: any logged-in user, anyone at
 * all, anyone mid-SSO. `ProjectUser` is different - a model only sees it if it
 * wrote `Permission.ProjectUser` into its own access list, and that is an
 * explicit statement that the whole project may read the table, rows and all.
 * Treating it as auto-granted would silently re-narrow those tables to the
 * caller's own rows and put the shared owner and label pickers back to empty,
 * which is the bug this permission exists to fix.
 */
const AUTO_GRANTED_TENANT_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.CurrentUser,
  Permission.Public,
  Permission.UnAuthorizedSsoUser,
];

export default class TenantPermission {
  @CaptureSpan()
  public static async addTenantScopeToQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    select: Select<TBaseModel> | null,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Promise<Query<TBaseModel>> {
    const model: BaseModel = new modelType();

    const tenantColumn: string | null = model.getTenantColumn();

    if (props.isMultiTenantRequest && !model.canQueryMultiTenant()) {
      throw new BadDataException(
        `isMultiTenantRequest not allowed on ${model.singularName}`,
      );
    }

    const isAccessGrantedOnlyByCurrentUser: boolean =
      TenantPermission.isAccessGrantedOnlyByCurrentUser(modelType, props, type);
    const userColumn: string | null = model.getUserColumn();

    /*
     * CurrentUser is an auto-granted permission, not a tenant-wide role. A
     * query operation that relies on it must declare an ownership column so
     * the permission can be converted into a row predicate.
     */
    if (
      isAccessGrantedOnlyByCurrentUser &&
      type !== DatabaseRequestType.Create &&
      !userColumn
    ) {
      throw new NotAuthorizedException(
        `Current user scope is not configured for ${model.singularName}.`,
      );
    }

    const shouldScopeQueryByCurrentUser: boolean =
      isAccessGrantedOnlyByCurrentUser && Boolean(userColumn);

    /*
     * API keys and other non-user callers can carry the auto-granted
     * CurrentUser permission without having a userId. Such a grant can never
     * be converted into an ownership filter, so reject it instead of running
     * the caller's query without a user scope.
     */
    if (shouldScopeQueryByCurrentUser && !props.userId) {
      throw new NotAuthorizedException(
        `A user session is required to ${type} ${model.singularName}.`,
      );
    }

    // If this model has a tenantColumn, and request has tenantId, and is multiTenantQuery null then add tenantId to query.
    if (tenantColumn && props.tenantId && !props.isMultiTenantRequest) {
      (query as any)[tenantColumn] = props.tenantId;

      /*
       * If Permission.CurrentUser is the only thing letting the user through
       * for this model+operation, also restrict the query to records they own.
       * Otherwise the tenant filter alone leaves the user able to act on any
       * row in the project (CVE-class issue when CurrentUser appears in a
       * model's delete/update list alongside admin permissions).
       */
      if (shouldScopeQueryByCurrentUser) {
        TenantPermission.addCurrentUserScopeToQuery(
          model,
          query,
          props.userId as ObjectID,
        );
      }
    }
    // if model allows user query without tenant, and user column is present, and userId is present, then add userId to query.
    else if (
      model.isUserQueryWithoutTenantAllowed() &&
      model.getUserColumn() &&
      props.userId
    ) {
      TenantPermission.addCurrentUserScopeToQuery(model, query, props.userId);
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

      /*
       * Check if the query already has a filter on the tenant column (e.g., projectId filter)
       * If so, only iterate through projects that match both the filter AND user's permissions
       */
      const existingTenantFilter: unknown = (query as any)[tenantColumn];
      if (existingTenantFilter && existingTenantFilter instanceof Includes) {
        const filterValues: Array<string> = (
          existingTenantFilter as Includes
        ).values.map((v: string | ObjectID | number) => {
          return v.toString();
        });
        // Filter projectIDs to only include those that are in the filter
        projectIDs = projectIDs.filter((pid: ObjectID) => {
          return filterValues.includes(pid.toString());
        });
        // Remove the tenant filter from query since we're handling it via projectIDs iteration
        delete (query as any)[tenantColumn];
      }

      let lastException: Error | null = null;
      const queryForEachProject: Query<TBaseModel> = { ...query };

      for (const projectId of projectIDs) {
        if (!props.userId) {
          continue;
        }

        try {
          const checkBasePermissions: CheckPermissionBaseInterface<TBaseModel> =
            await BasePermission.checkPermissions(
              modelType,
              { ...queryForEachProject },
              select,
              {
                ...props,
                isMultiTenantRequest: false,
                tenantId: projectId,
                userTenantAccessPermission: props.userTenantAccessPermission,
              },
              type,
            );

          queries.push({
            ...checkBasePermissions.query,
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

    /*
     * A model that relies on CurrentUser must resolve that permission to the
     * requester's exact ownership column. This catches missing decorators and
     * prevents a future model misconfiguration from silently becoming an
     * instance-wide query.
     */
    if (shouldScopeQueryByCurrentUser) {
      const scopedUserId: unknown = (query as any)[userColumn as string];

      if (
        !TenantPermission.isExactUserScope(scopedUserId) ||
        scopedUserId.toString() !== (props.userId as ObjectID).toString()
      ) {
        throw new NotAuthorizedException(
          `Current user scope could not be applied to ${model.singularName}.`,
        );
      }
    }

    return query;
  }

  /**
   * Add the authenticated user's ownership predicate without redirecting an
   * operation that explicitly targeted another user. Rejecting a conflict is
   * important because service hooks run before the final permission check;
   * silently replacing the target would let a hook inspect one row and the
   * database operation mutate a different one.
   */
  private static addCurrentUserScopeToQuery<TBaseModel extends BaseModel>(
    model: BaseModel,
    query: Query<TBaseModel>,
    userId: ObjectID,
  ): void {
    const userColumn: string = model.getUserColumn() as string;
    const existingUserScope: unknown = (query as any)[userColumn];

    if (
      existingUserScope !== undefined &&
      (!TenantPermission.isExactUserScope(existingUserScope) ||
        existingUserScope.toString() !== userId.toString())
    ) {
      throw new NotAuthorizedException(
        `You do not have permission to access another user's ${model.singularName}.`,
      );
    }

    (query as any)[userColumn] = userId;
  }

  /**
   * Ownership filters must be exact scalar ids. Query operators such as
   * NotEqual stringify to their wrapped id as well, so comparing only their
   * string value would allow a broad hook query to masquerade as an exact
   * current-user predicate.
   */
  private static isExactUserScope(value: unknown): value is string | ObjectID {
    return typeof value === "string" || value instanceof ObjectID;
  }

  /**
   * True if the only permission letting this user through the table-level
   * check for this op is Permission.CurrentUser. In that case the query must
   * be restricted to rows the user owns (via the model's user column).
   *
   * Public because CreatePermission needs exactly this predicate. Create never
   * reaches addTenantScopeToQuery (see the `type !== DatabaseRequestType.Create`
   * carve-out above), so it enforces ownership on the DATA rather than on a
   * query — but it must decide "is this caller here purely as some logged-in
   * user, or do they hold a real role permission" identically, or the two paths
   * would disagree about who may act on whose rows.
   */
  public static isAccessGrantedOnlyByCurrentUser<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): boolean {
    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);

    if (!modelPermissions.includes(Permission.CurrentUser)) {
      return false;
    }

    const userPermissions: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).map((up: { permission: Permission }) => {
        return up.permission;
      });

    const intersection: Array<Permission> = userPermissions.filter(
      (p: Permission) => {
        return modelPermissions.includes(p);
      },
    );

    if (!intersection.includes(Permission.CurrentUser)) {
      return false;
    }

    const adminMatch: Array<Permission> = intersection.filter(
      (p: Permission) => {
        return !AUTO_GRANTED_TENANT_PERMISSIONS.includes(p);
      },
    );

    return adminMatch.length === 0;
  }
}
