import AccessTokenService from "../Services/AccessTokenService";
import ProjectService from "../Services/ProjectService";
import TeamMemberService from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
import QueryHelper from "../Types/Database/QueryHelper";
import CookieUtil from "../Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import JSONWebToken from "../Utils/JsonWebToken";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import Response from "../Utils/Response";
import ProjectMiddleware from "./ProjectAuthorization";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import Exception from "../../Types/Exception/Exception";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import SsoAuthorizationException from "../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../Types/Exception/TenantNotFoundException";
import HashedString from "../../Types/HashedString";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import ObjectID from "../../Types/ObjectID";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import Permission, {
  PermissionHelper,
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import UserType from "../../Types/UserType";
import Project from "../../Models/DatabaseModels/Project";
import UserPermissionUtil from "../Utils/UserPermission/UserPermission";

export default class UserMiddleware {
  /*
   * Description: Checking if user is authorized to access the page and decode jwt to get user data.
   * Params:
   * Param 1: req.headers-> {token}
   * Returns: 401: User is unauthorized since unauthorized token was present.
   */

  @CaptureSpan()
  public static getAccessTokenFromCookie(
    req: ExpressRequest,
  ): string | undefined {
    let accessToken: string | undefined = undefined;

    if (
      CookieUtil.getCookieFromExpressRequest(req, CookieUtil.getUserTokenKey())
    ) {
      accessToken = CookieUtil.getCookieFromExpressRequest(
        req,
        CookieUtil.getUserTokenKey(),
      );
    }

    return accessToken;
  }

  @CaptureSpan()
  public static getAccessTokenFromExpressRequest(
    req: ExpressRequest,
  ): string | undefined {
    // 1. Try cookie (existing web dashboard flow)
    const cookieToken: string | undefined =
      CookieUtil.getCookieFromExpressRequest(req, CookieUtil.getUserTokenKey());

    if (cookieToken) {
      return cookieToken;
    }

    // 2. Fallback: Check Authorization: Bearer <token> header (mobile app flow)
    const authHeader: string | undefined = req.headers["authorization"] as
      | string
      | undefined;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    return undefined;
  }

  @CaptureSpan()
  public static getSsoTokens(req: ExpressRequest): Dictionary<string> {
    const ssoTokens: Dictionary<string> = {};

    // get sso tokens from cookies.

    const cookies: Dictionary<string> = CookieUtil.getAllCookies(req);

    for (const key of Object.keys(cookies)) {
      if (key.startsWith(CookieUtil.getSSOKey())) {
        const value: string | undefined | Array<string> = cookies[key];
        let projectId: string | undefined = undefined;

        try {
          projectId = JSONWebToken.decode(
            value as string,
          ).projectId?.toString();
        } catch (err) {
          logger.error(
            err,
            getLogAttributesFromRequest(req as OneUptimeRequest),
          );
          continue;
        }

        if (
          projectId &&
          value &&
          typeof value === "string" &&
          typeof projectId === "string"
        ) {
          ssoTokens[projectId] = cookies[key] as string;
        }
      }
    }

    /*
     * Also check x-sso-tokens header (mobile app flow).
     * The header value is a JSON-encoded map of { projectId: ssoToken }.
     */
    const ssoTokensHeader: string | undefined = req.headers["x-sso-tokens"] as
      | string
      | undefined;

    if (ssoTokensHeader) {
      try {
        const headerTokens: Record<string, string> =
          JSON.parse(ssoTokensHeader);

        for (const projectId of Object.keys(headerTokens)) {
          const token: string | undefined = headerTokens[projectId];

          if (!token || typeof token !== "string") {
            continue;
          }

          try {
            const decoded: JSONWebTokenData = JSONWebToken.decode(token);

            if (decoded.projectId?.toString() === projectId) {
              ssoTokens[projectId] = token;
            }
          } catch (err) {
            logger.error(
              err,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
            continue;
          }
        }
      } catch (err) {
        logger.error(err, getLogAttributesFromRequest(req as OneUptimeRequest));
      }
    }

    return ssoTokens;
  }

  @CaptureSpan()
  public static doesSsoTokenForProjectExist(
    req: ExpressRequest,
    projectId: ObjectID,
    userId: ObjectID,
  ): boolean {
    const ssoTokens: Dictionary<string> = this.getSsoTokens(req);

    if (ssoTokens && ssoTokens[projectId.toString()]) {
      const decodedData: JSONWebTokenData = JSONWebToken.decode(
        ssoTokens[projectId.toString()] as string,
      );
      if (
        decodedData.projectId?.toString() === projectId.toString() &&
        decodedData.userId.toString() === userId.toString()
      ) {
        return true;
      }
    }

    return false;
  }

  @CaptureSpan()
  public static async getUserMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const tenantId: ObjectID | null = ProjectMiddleware.getProjectId(req);
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    if (tenantId) {
      oneuptimeRequest.tenantId = tenantId;

      /*
       * Fire-and-forget: lastActive write is debounced inside the service
       * (60s in-process cache) and we don't need the result before
       * continuing.
       */
      void ProjectService.updateLastActive(tenantId);
    }

    if (ProjectMiddleware.hasApiKey(req)) {
      return await ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware(
        req,
        res,
        next,
      );
    }

    const accessToken: string | undefined =
      UserMiddleware.getAccessTokenFromExpressRequest(req);

    if (!accessToken) {
      oneuptimeRequest.userType = UserType.Public;
      return next();
    }

    try {
      oneuptimeRequest.userAuthorization = JSONWebToken.decode(accessToken);
    } catch (err) {
      // if the token is invalid or expired, return 401 so clients can refresh the token.
      logger.error(err, getLogAttributesFromRequest(oneuptimeRequest));
      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          "AccessToken is invalid or expired. Please refresh your token.",
        ),
      );
    }

    if (oneuptimeRequest.userAuthorization.isMasterAdmin) {
      oneuptimeRequest.userType = UserType.MasterAdmin;
    } else {
      oneuptimeRequest.userType = UserType.User;
    }

    const userId: string = oneuptimeRequest.userAuthorization.userId.toString();

    // Tag the current span with user and project context for observability
    SpanUtil.addAttributesToCurrentSpan({
      userId: userId,
      userType: oneuptimeRequest.userType,
      ...(tenantId ? { projectId: tenantId.toString() } : {}),
      ...(oneuptimeRequest.requestId
        ? { requestId: oneuptimeRequest.requestId }
        : {}),
    });

    /*
     * Fire-and-forget: lastActive write is debounced inside the service
     * (60s in-process cache) and we don't need the result before continuing.
     */
    void UserService.updateLastActive(new ObjectID(userId));

    /*
     * Resolve global permission, tenant permission, and team membership in
     * parallel. These were previously sequential awaits — each added an
     * extra round-trip latency to every authenticated request. The original
     * code wrapped only the tenant-side calls in try/catch (to convert
     * SsoAuthorizationException etc. into an HTTP error response); we
     * preserve that semantic by routing the rejection through the same
     * catch only when tenantId is present.
     */
    const userGlobalAccessPermissionPromise: Promise<UserGlobalAccessPermission | null> =
      AccessTokenService.getUserGlobalAccessPermission(
        oneuptimeRequest.userAuthorization.userId,
      );

    let userGlobalAccessPermission: UserGlobalAccessPermission | null = null;

    if (tenantId) {
      try {
        const [globalPermission, userTenantAccessPermission, userTeamIds]: [
          UserGlobalAccessPermission | null,
          UserTenantAccessPermission | null,
          Array<ObjectID>,
        ] = await Promise.all([
          userGlobalAccessPermissionPromise,
          UserMiddleware.getUserTenantAccessPermissionWithTenantId({
            req,
            tenantId,
            userId: new ObjectID(userId),
          }),
          TeamMemberService.getTeamIdsForUser(new ObjectID(userId), tenantId),
        ]);

        userGlobalAccessPermission = globalPermission;

        if (userGlobalAccessPermission) {
          oneuptimeRequest.userGlobalAccessPermission =
            userGlobalAccessPermission;
        }

        if (userTenantAccessPermission) {
          oneuptimeRequest.userTenantAccessPermission = {};
          oneuptimeRequest.userTenantAccessPermission[tenantId.toString()] =
            userTenantAccessPermission;
        }

        /*
         * Load the user's team membership for this tenant so that the
         * `Owned` permission scope can evaluate team-based ownership without
         * an extra DB roundtrip on every permission check. Absent for non-user
         * callers (API keys, Probes); `Owned` then evaluates as `All`.
         */
        oneuptimeRequest.userTeamIds = userTeamIds;
      } catch (error) {
        return Response.sendErrorResponse(req, res, error as Exception);
      }
    } else {
      userGlobalAccessPermission = await userGlobalAccessPermissionPromise;

      if (userGlobalAccessPermission) {
        oneuptimeRequest.userGlobalAccessPermission =
          userGlobalAccessPermission;
      }
    }

    if (req.headers["is-multi-tenant-query"]) {
      if (
        userGlobalAccessPermission &&
        userGlobalAccessPermission.projectIds &&
        userGlobalAccessPermission.projectIds.length > 0
      ) {
        const userTenantAccessPermission: Dictionary<UserTenantAccessPermission> | null =
          await UserMiddleware.getUserTenantAccessPermissionForMultiTenant(
            req,
            new ObjectID(userId),
            userGlobalAccessPermission.projectIds,
          );

        if (userTenantAccessPermission) {
          oneuptimeRequest.userTenantAccessPermission =
            userTenantAccessPermission;
        }
      }
    }

    // set permission hash.

    if (oneuptimeRequest.userGlobalAccessPermission) {
      const serializedValue: JSONObject = JSONFunctions.serialize(
        oneuptimeRequest.userGlobalAccessPermission,
      );
      const globalValue: string = JSON.stringify(serializedValue);
      const globalPermissionsHash: string = await HashedString.hashValue(
        globalValue,
        null,
      );
      res.set("global-permissions", globalValue);
      res.set("global-permissions-hash", globalPermissionsHash);
    }

    // set project permissions hash.
    if (
      oneuptimeRequest.userTenantAccessPermission &&
      tenantId &&
      oneuptimeRequest.userTenantAccessPermission[tenantId.toString()]
    ) {
      const projectValue: string = JSON.stringify(
        JSONFunctions.serialize(
          oneuptimeRequest.userTenantAccessPermission[tenantId.toString()]!,
        ),
      );

      const projectPermissionsHash: string = await HashedString.hashValue(
        projectValue,
        null,
      );

      if (
        !(
          req.headers &&
          req.headers["project-permissions-hash"] &&
          req.headers["project-permissions-hash"] === projectPermissionsHash
        )
      ) {
        res.set("project-permissions", projectValue);
        res.set("project-permissions-hash", projectPermissionsHash);
      }
    }

    return next();
  }

  @CaptureSpan()
  public static async requireUserAuthentication(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    if (
      !oneuptimeRequest.userType ||
      oneuptimeRequest.userType === UserType.Public
    ) {
      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          "Authentication required. Please log in to access this resource.",
        ),
      );
    }

    return next();
  }

  public static requirePermission(data: {
    permissions: Array<Permission>;
  }): (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> {
    return async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

      // Master admins bypass permission checks
      if (oneuptimeRequest.userType === UserType.MasterAdmin) {
        return next();
      }

      const tenantId: ObjectID | undefined = oneuptimeRequest.tenantId;

      if (!tenantId) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "Project ID is required to access this resource.",
          ),
        );
      }

      const userTenantPermission: UserTenantAccessPermission | undefined =
        oneuptimeRequest.userTenantAccessPermission?.[tenantId.toString()];

      if (!userTenantPermission) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "You do not have permission to access this project.",
          ),
        );
      }

      const userPermissions: Array<Permission> =
        userTenantPermission.permissions.map((p: UserPermission) => {
          return p.permission;
        });

      if (
        !PermissionHelper.doesPermissionsIntersect(
          userPermissions,
          data.permissions,
        )
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "You do not have the required permission to perform this action.",
          ),
        );
      }

      return next();
    };
  }

  @CaptureSpan()
  public static async getUserTenantAccessPermissionWithTenantId(data: {
    req: ExpressRequest;
    tenantId: ObjectID;
    userId: ObjectID;
  }): Promise<UserTenantAccessPermission | null> {
    const { req, tenantId, userId } = data;

    /*
     * Resolve the SSO requirement and the tenant permission in parallel.
     * `getRequireSsoForLogin` is cached in-process for 60s, so this is
     * usually free; the tenant permission lookup is the expensive call.
     */
    const [requireSsoForLogin, tenantPermission]: [
      boolean,
      UserTenantAccessPermission | null,
    ] = await Promise.all([
      ProjectService.getRequireSsoForLogin(tenantId).catch((err: Error) => {
        /*
         * Preserve the original behavior of throwing a TenantNotFoundException
         * for an unknown project. Any other error re-throws.
         */
        if (err.message === "Project not found") {
          throw new TenantNotFoundException("Invalid tenantId");
        }
        throw err;
      }),
      AccessTokenService.getUserTenantAccessPermission(userId, tenantId),
    ]);

    if (
      requireSsoForLogin &&
      !UserMiddleware.doesSsoTokenForProjectExist(req, tenantId, userId)
    ) {
      throw new SsoAuthorizationException();
    }

    return tenantPermission;
  }

  @CaptureSpan()
  public static async getUserTenantAccessPermissionForMultiTenant(
    req: ExpressRequest,
    userId: ObjectID,
    projectIds: ObjectID[],
  ): Promise<Dictionary<UserTenantAccessPermission> | null> {
    if (!projectIds.length) {
      return null;
    }

    const projects: Array<Project> = await ProjectService.findBy({
      query: {
        _id: QueryHelper.any(
          projectIds.map((i: ObjectID) => {
            return i.toString();
          }) || [],
        ),
      },
      select: {
        requireSsoForLogin: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * Resolve permissions for every project in parallel. With the previous
     * for-await loop this scaled linearly with project count, adding one
     * round-trip per project even on cache hits.
     */
    const resolved: Array<{
      projectId: ObjectID;
      permission: UserTenantAccessPermission | null;
    }> = await Promise.all(
      projectIds.map(async (projectId: ObjectID) => {
        if (
          projects.find((p: Project) => {
            return p._id === projectId.toString() && p.requireSsoForLogin;
          }) &&
          !UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId)
        ) {
          return {
            projectId,
            permission:
              UserPermissionUtil.getDefaultUserTenantAccessPermission(
                projectId,
              ),
          };
        }
        return {
          projectId,
          permission: await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          ),
        };
      }),
    );

    let result: Dictionary<UserTenantAccessPermission> | null = null;
    for (const { projectId, permission } of resolved) {
      if (permission) {
        if (!result) {
          result = {};
        }
        result[projectId.toString()] = permission;
      }
    }

    return result;
  }
}
