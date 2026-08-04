import { IsBillingEnabled } from "../EnvironmentConfig";
import ProjectService from "../Services/ProjectService";
import { ExpressRequest, OneUptimeRequest } from "../Utils/Express";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import UserType from "../../Types/UserType";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";

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
   * This deliberately checks the tenant only, not the user: API-key callers
   * are authenticated by ProjectMiddleware and carry tenant permissions
   * without ever setting `userId`. Use assertAuthenticatedProjectMember when
   * an endpoint must additionally be a logged-in human member.
   */
  public static assertTenantScoped(
    databaseProps: DatabaseCommonInteractionProps,
  ): ObjectID {
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

    if ((req as OneUptimeRequest).tenantId) {
      props.tenantId = (req as OneUptimeRequest).tenantId || undefined;
    }

    if (req.headers["is-multi-tenant-query"]) {
      props.isMultiTenantRequest = true;
    }

    if (IsBillingEnabled && props.tenantId) {
      const plan: {
        plan: PlanType | null;
        isSubscriptionUnpaid: boolean;
      } = await ProjectService.getCurrentPlan(props.tenantId!);
      props.currentPlan = plan.plan || undefined;
      props.isSubscriptionUnpaid = plan.isSubscriptionUnpaid;
    }

    // check for root permissions.

    if (props.userType === UserType.MasterAdmin) {
      props.isMasterAdmin = true;
    }

    // Add context attributes to the current span for observability
    SpanUtil.addAttributesToCurrentSpan({
      ...(props.tenantId ? { projectId: props.tenantId.toString() } : {}),
      ...(props.userId ? { userId: props.userId.toString() } : {}),
      ...(props.userType ? { userType: props.userType } : {}),
      ...((req as OneUptimeRequest).requestId
        ? { requestId: (req as OneUptimeRequest).requestId }
        : {}),
    });

    return props;
  }
}
