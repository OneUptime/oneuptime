import { ExpressRequest, OneUptimeRequest } from "../Utils/Express";
import CallerPlan from "../Utils/Billing/CallerPlan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import UserType from "../../Types/UserType";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../Types/Database/Permissions/TablePermission";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import HeldPermissionsUtil from "../../Types/HeldPermissions";
import CallerPermission from "../Utils/Permission/CallerPermission";

export default class CommonAPI {
  /*
   * Custom (non-CRUD) endpoints whose path carries only a resource id give
   * getUserMiddleware no way to learn the project except the `tenantid`
   * header. ModelAPI attaches that header to every request it makes, but a
   * custom route reached with a raw API.post/API.get gets none unless the call
   * site adds ModelAPI.getCommonHeaders() itself. When a caller forgets it,
   * the request still reaches the handler — just with no tenant permissions —
   * and the eventual tenant-scoped read fails as "You do not have permissions
   * to read <model>", which reads like a missing role when it is really a
   * missing header. Assert the scope up front so the caller gets the real
   * cause.
   *
   * This deliberately checks the tenant, not the user: API-key callers are
   * authenticated by ProjectMiddleware and carry tenant permissions without
   * ever setting `userId`. It does refuse a caller with no credentials at all
   * (401, see assertCredentialsPresent), because a tenant header on its own
   * proves nothing and usually means an expired session. Use
   * assertAuthenticatedProjectMember when an endpoint must additionally be a
   * logged-in human member.
   */
  public static assertTenantScoped(
    databaseProps: DatabaseCommonInteractionProps,
  ): ObjectID {
    CommonAPI.assertCredentialsPresent(databaseProps);

    const projectId: ObjectID | undefined = databaseProps.tenantId;

    if (!projectId) {
      throw new BadDataException(
        "Project ID is required. Please pass the project ID in the 'tenantid' header.",
      );
    }

    return projectId;
  }

  /*
   * Like assertAuthenticatedProjectMember, but also admits a project API key.
   *
   * An API key request carries no userId, so the member check rejects it —
   * yet it is neither anonymous nor unscoped: ProjectMiddleware resolves the
   * project from the KEY ITSELF (never the caller-supplied `tenantid` header,
   * which it overwrites) and attaches the permissions granted to that key.
   * Endpoints meant to be automatable should use this and then check whatever
   * permission the action needs; that permission check is what separates a
   * read-only key from one allowed to act.
   */
  public static assertAuthenticatedProjectPrincipal(
    databaseProps: DatabaseCommonInteractionProps,
  ): ObjectID {
    CommonAPI.assertCredentialsPresent(databaseProps);

    const projectId: ObjectID | undefined = databaseProps.tenantId;

    if (!projectId) {
      throw new BadDataException("Project ID is required");
    }

    const isApiKey: boolean = databaseProps.userType === UserType.API;

    if (
      (!databaseProps.userId && !isApiKey) ||
      !databaseProps.userTenantAccessPermission ||
      !databaseProps.userTenantAccessPermission[projectId.toString()]
    ) {
      throw new NotAuthorizedException(
        "You are not authorized to access this project's data.",
      );
    }

    return projectId;
  }

  public static readonly AUTHENTICATION_REQUIRED_MESSAGE: string =
    DatabaseCommonInteractionPropsUtil.AUTHENTICATION_REQUIRED_MESSAGE;

  // See DatabaseCommonInteractionPropsUtil.isAnonymous.
  public static isAnonymous(
    databaseProps: DatabaseCommonInteractionProps,
  ): boolean {
    return DatabaseCommonInteractionPropsUtil.isAnonymous(databaseProps);
  }

  /*
   * "Who are you?" comes before "may you?".
   *
   * An anonymous caller has to get 401, never 422 or 400. The browser client
   * (Common/UI/Utils/API/API.ts) refreshes the session and replays the request
   * on a 401 and on nothing else, so answering an expired session with "you
   * are not authorized to access this project's data" leaves a signed-in user
   * looking at an authorization error until something else happens to trigger
   * a 401. Every guard below calls this first, and so should any custom route
   * that checks its caller by hand.
   *
   * Callers that ARE authenticated but lack access keep whatever refusal the
   * route already gives them.
   */
  public static assertCredentialsPresent(
    databaseProps: DatabaseCommonInteractionProps,
  ): void {
    DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(databaseProps);
  }

  /*
   * For routes that act as a person (they record who approved, who asked,
   * whose settings changed) and so cannot run on an API key.
   *
   * No credentials is 401, as above. A project API key IS authenticated, so it
   * gets the route's own refusal (422) rather than a 401 its client would
   * answer by trying to refresh a session it never had.
   */
  public static assertAuthenticatedUser(
    databaseProps: DatabaseCommonInteractionProps,
    notAUserMessage?: string,
  ): ObjectID {
    CommonAPI.assertCredentialsPresent(databaseProps);

    if (!databaseProps.userId) {
      throw new NotAuthorizedException(
        notAUserMessage || "A logged-in user session is required.",
      );
    }

    return databaseProps.userId;
  }

  /*
   * getUserMiddleware lets unauthenticated requests through as "public" and
   * takes the tenant id from a caller-supplied header — custom endpoints
   * that disclose project data must require an authenticated member of the
   * project themselves. Returns the project id when authorized, throws
   * otherwise.
   */
  public static assertAuthenticatedProjectMember(
    databaseProps: DatabaseCommonInteractionProps,
  ): ObjectID {
    CommonAPI.assertCredentialsPresent(databaseProps);

    const projectId: ObjectID | undefined = databaseProps.tenantId;

    if (!projectId) {
      throw new BadDataException("Project ID is required");
    }

    if (
      !databaseProps.userId ||
      !databaseProps.userTenantAccessPermission ||
      !databaseProps.userTenantAccessPermission[projectId.toString()]
    ) {
      throw new NotAuthorizedException(
        "You are not authorized to access this project's data.",
      );
    }

    return projectId;
  }

  /*
   * assertAuthenticatedProjectMember only proves the caller belongs to the
   * project it *claimed* in the `tenantid` header — it never looks at the
   * resource the path names. A custom route that then reads or mutates that
   * resource as root must also confirm the resource's own projectId is the
   * project the caller was authorized for, otherwise a member of project A
   * reaches project B's resource id just by sending their own header.
   *
   * A resource that does not exist (or carries no projectId) is rejected the
   * same way, so the endpoint cannot be used to confirm which ids exist in
   * other projects.
   */
  public static assertResourceBelongsToProject(data: {
    resourceProjectId: ObjectID | undefined | null;
    projectId: ObjectID;
  }): void {
    if (
      !data.resourceProjectId ||
      data.resourceProjectId.toString() !== data.projectId.toString()
    ) {
      throw new NotAuthorizedException(
        "You are not authorized to access this project's data.",
      );
    }
  }

  /*
   * Membership is not read authorisation.
   *
   * assertAuthenticatedProjectMember proves the caller belongs to the project
   * they named in the `tenantid` header; it says nothing about WHICH of that
   * project's data they may see. A custom route that then reads with
   * `isRoot: true` has skipped the permission check the equivalent CRUD read
   * would have run, so the route has to make that check itself - otherwise a
   * member whose teams grant nothing but, say, ReadProjectIncident still reads
   * everything else the route happens to touch.
   *
   * The permissions consulted are the caller's grants in props.tenantId, so
   * this must be called after assertAuthenticatedProjectMember has confirmed
   * that tenant is one the caller actually belongs to.
   *
   * `allowedPermissions` is normally the model's own declared list, e.g.
   * `new LlmProvider().getReadPermissions()`, so the custom route stays in
   * step with the CRUD endpoint for the same data instead of inventing a
   * second, quietly diverging rule.
   *
   * Permissions that are never assigned INSIDE a project are stripped from
   * that list first. This matters: getUserPermissions merges the caller's
   * global permissions in, and every caller - including an anonymous one -
   * carries Permission.Public, which a model's read list very often contains
   * (LlmProvider has it so the shared global providers stay readable). Left
   * in, it would make this guard pass for anyone. What remains is the
   * tenant-assignable subset, which is exactly what a team can grant.
   *
   * Stripping can empty the list, and an empty list denies everyone rather
   * than admitting them - a model whose read access is purely public has no
   * business behind this guard, and failing closed is the safe direction.
   *
   * The caller's rows are read the way every permission check reads them
   * (CallerPermission): only an allow row grants, so a team's explicit BLOCK
   * row for one of these is never a grant of it, and a block with no labels
   * on any of them refuses, whatever else the caller holds.
   *
   * Master admins bypass, matching every other permission gate in the API.
   */
  public static assertPermittedInProject(data: {
    databaseProps: DatabaseCommonInteractionProps;
    allowedPermissions: Array<Permission>;
    errorMessage?: string | undefined;
  }): void {
    CommonAPI.assertCredentialsPresent(data.databaseProps);

    if (data.databaseProps.isMasterAdmin) {
      return;
    }

    if (
      !CallerPermission.holdsAnyOf(
        data.databaseProps,
        CommonAPI.getTenantAssignablePermissions(data.allowedPermissions),
      )
    ) {
      throw new NotAuthorizedException(
        data.errorMessage ||
          "You do not have permission to access this project's data.",
      );
    }
  }

  // The permissions of `permissions` a team can be granted in a project.
  private static getTenantAssignablePermissions(
    permissions: Array<Permission>,
  ): Array<Permission> {
    const tenantAssignablePermissions: Array<Permission> =
      PermissionHelper.getTenantPermissionProps().map(
        (permissionProps: PermissionProps) => {
          return permissionProps.permission;
        },
      );

    return permissions.filter((permission: Permission) => {
      return tenantAssignablePermissions.includes(permission);
    });
  }

  /*
   * The two halves of what the CRUD path asks before an operation on a
   * model, in its order: an Allow grant from the model's list for the
   * operation - or, for an operational resource, the *AllOperationalResources
   * wildcard, as TablePermission accepts it - and then no unlabelled team
   * BLOCK row on any permission in that list, refused with the message that
   * names the block (checkTableLevelBlockPermissions).
   */
  private static assertCanOperateOnTable(data: {
    modelType: DatabaseBaseModelType;
    props: DatabaseCommonInteractionProps;
    operation: DatabaseRequestType.Read | DatabaseRequestType.Create;
    errorMessage?: string | undefined;
  }): void {
    CommonAPI.assertCredentialsPresent(data.props);

    if (data.props.isMasterAdmin) {
      return;
    }

    const model: DatabaseBaseModel = new data.modelType();

    const permissions: Array<Permission> =
      data.operation === DatabaseRequestType.Create
        ? model.getCreatePermissions()
        : model.getReadPermissions();

    if (
      !CallerPermission.isGrantedAny(
        data.props,
        CommonAPI.getTenantAssignablePermissions(permissions),
        {
          wildcard: HeldPermissionsUtil.getModelWildcard({
            isOperationalResource: model.isOperationalResource,
            operation: data.operation,
          }),
        },
      )
    ) {
      throw new NotAuthorizedException(
        data.errorMessage ||
          "You do not have permission to access this project's data.",
      );
    }

    TablePermission.checkTableLevelBlockPermissions(
      data.modelType,
      data.props,
      data.operation,
    );
  }

  /*
   * Throws unless the caller could read `modelType` through its CRUD
   * endpoint. That read has two halves and both are applied here: an Allow
   * grant from the model's read list (the wildcard included, for an
   * operational resource), and no unlabelled team BLOCK row on any
   * permission in that list (checkTableLevelBlockPermissions) - a block
   * overrides every Allow the team holds. Master admins bypass both, as they
   * do in ReadPermission.
   *
   * This is the table half only. Label and owned-scope rules are row rules,
   * so a route that must honour them still has to read the rows with the
   * caller's props. Like assertPermittedInProject, it must be called after
   * assertAuthenticatedProjectMember has confirmed the tenant.
   */
  public static assertCanReadTable(data: {
    modelType: DatabaseBaseModelType;
    props: DatabaseCommonInteractionProps;
    errorMessage?: string | undefined;
  }): void {
    CommonAPI.assertCanOperateOnTable({
      ...data,
      operation: DatabaseRequestType.Read,
    });
  }

  /*
   * Throws unless the caller could create `modelType` through its CRUD
   * endpoint. That create has two halves and both are applied here: an Allow
   * grant from the model's create list (the wildcard included, for an
   * operational resource), and no unlabelled team BLOCK row on any
   * permission in that list (checkTableLevelBlockPermissions) - a block
   * overrides every Allow the team holds. Master admins bypass both, as they
   * do in CreatePermission.
   *
   * Use it for a custom route whose side effect is only acceptable from
   * someone who could create that model anyway, so the route cannot be used
   * to get around a team block the CRUD endpoint honours. Like
   * assertPermittedInProject, it must be called after
   * assertAuthenticatedProjectMember has confirmed the tenant.
   *
   * A credential issued for reading only (an MCP client connected
   * read-only) is refused first, whatever its member may do, as that create
   * refuses it.
   */
  public static assertCanCreateTable(data: {
    modelType: DatabaseBaseModelType;
    props: DatabaseCommonInteractionProps;
    errorMessage?: string | undefined;
  }): void {
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(data.props);

    CommonAPI.assertCanOperateOnTable({
      ...data,
      operation: DatabaseRequestType.Create,
    });
  }

  @CaptureSpan()
  public static async getDatabaseCommonInteractionProps(
    req: ExpressRequest,
  ): Promise<DatabaseCommonInteractionProps> {
    const props: DatabaseCommonInteractionProps = {
      tenantId: undefined,
      userGlobalAccessPermission: undefined,
      userTenantAccessPermission: undefined,
      userId: undefined,
      userType: (req as OneUptimeRequest).userType,
      isMultiTenantRequest: undefined,
    };

    if (
      (req as OneUptimeRequest).userAuthorization &&
      (req as OneUptimeRequest).userAuthorization?.userId
    ) {
      props.userId = (req as OneUptimeRequest).userAuthorization!.userId;
    }

    if ((req as OneUptimeRequest).userGlobalAccessPermission) {
      props.userGlobalAccessPermission = (
        req as OneUptimeRequest
      ).userGlobalAccessPermission;
    }

    if ((req as OneUptimeRequest).userTenantAccessPermission) {
      props.userTenantAccessPermission = (
        req as OneUptimeRequest
      ).userTenantAccessPermission;
    }

    if ((req as OneUptimeRequest).userTeamIds) {
      props.userTeamIds = (req as OneUptimeRequest).userTeamIds;
    }

    // Which credential made the request; read only by the audit trail.
    if ((req as OneUptimeRequest).apiKeyId) {
      props.apiKeyId = (req as OneUptimeRequest).apiKeyId;
    }

    if ((req as OneUptimeRequest).apiKeyName) {
      props.apiKeyName = (req as OneUptimeRequest).apiKeyName;
    }

    if ((req as OneUptimeRequest).mcpOAuth) {
      props.mcpOAuthGrantId = (req as OneUptimeRequest).mcpOAuth!.grantId;
      props.mcpClientName = (req as OneUptimeRequest).mcpOAuth!.clientName;

      // Not audit-only: a read-only client's writes are refused (see props).
      if ((req as OneUptimeRequest).mcpOAuth!.isReadOnly) {
        props.isReadOnlyCredential = true;
      }
    }

    if ((req as OneUptimeRequest).tenantId) {
      props.tenantId = (req as OneUptimeRequest).tenantId || undefined;
    }

    if (req.headers["is-multi-tenant-query"]) {
      props.isMultiTenantRequest = true;
    }

    // check for root permissions.

    if (props.userType === UserType.MasterAdmin) {
      props.isMasterAdmin = true;
    }

    /*
     * The plan the request is held to, by the one rule every path follows
     * (CallerPlan): its project's, read here for everyone a plan holds - and
     * never for a server admin, whom no plan holds, so an operator can always
     * fix a project. Billing off: nothing is read.
     */
    const heldProps: DatabaseCommonInteractionProps =
      await CallerPlan.withPlan(props);

    // Add context attributes to the current span for observability
    SpanUtil.addAttributesToCurrentSpan({
      ...(props.tenantId ? { projectId: props.tenantId.toString() } : {}),
      ...(props.userId ? { userId: props.userId.toString() } : {}),
      ...(props.userType ? { userType: props.userType } : {}),
      ...((req as OneUptimeRequest).requestId
        ? { requestId: (req as OneUptimeRequest).requestId }
        : {}),
    });

    return heldProps;
  }
}
