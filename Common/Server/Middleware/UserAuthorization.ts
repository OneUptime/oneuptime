import AccessTokenService from "../Services/AccessTokenService";
import ProjectService from "../Services/ProjectService";
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
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import ProjectMiddleware from "./ProjectAuthorization";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
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
import {
  UserGlobalAccessPermission,
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
          logger.error(err);
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
            logger.error(err);
            continue;
          }
        }
      } catch (err) {
        logger.error(err);
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

      // update last active of project
      await ProjectService.updateLastActive(tenantId);
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
      logger.error(err);
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

    await UserService.updateOneBy({
      query: {
        _id: userId,
      },
      props: { isRoot: true },
      data: { lastActive: OneUptimeDate.getCurrentDate() },
    });

    const userGlobalAccessPermission: UserGlobalAccessPermission | null =
      await AccessTokenService.getUserGlobalAccessPermission(
        oneuptimeRequest.userAuthorization.userId,
      );

    if (userGlobalAccessPermission) {
      oneuptimeRequest.userGlobalAccessPermission = userGlobalAccessPermission;
    }

    if (tenantId) {
      try {
        const userTenantAccessPermission: UserTenantAccessPermission | null =
          await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
            req,
            tenantId,
            userId: new ObjectID(userId),
            isGlobalLogin: oneuptimeRequest.userAuthorization.isGlobalLogin,
          });

        if (userTenantAccessPermission) {
          oneuptimeRequest.userTenantAccessPermission = {};
          oneuptimeRequest.userTenantAccessPermission[tenantId.toString()] =
            userTenantAccessPermission;
        }
      } catch (error) {
        return Response.sendErrorResponse(req, res, error as Exception);
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
  public static async getUserTenantAccessPermissionWithTenantId(data: {
    req: ExpressRequest;
    tenantId: ObjectID;
    userId: ObjectID;
    isGlobalLogin: boolean;
  }): Promise<UserTenantAccessPermission | null> {
    const { req, tenantId, userId, isGlobalLogin } = data;

    const project: Project | null = await ProjectService.findOneById({
      id: tenantId,
      select: {
        requireSsoForLogin: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new TenantNotFoundException("Invalid tenantId");
    }

    if (!isGlobalLogin) {
      if (!UserMiddleware.doesSsoTokenForProjectExist(req, tenantId, userId)) {
        throw new NotAuthenticatedException(
          "This project requires OneUptime authentication. Please login to access this project.",
        );
      }
    }

    if (
      project.requireSsoForLogin &&
      !UserMiddleware.doesSsoTokenForProjectExist(req, tenantId, userId)
    ) {
      throw new SsoAuthorizationException();
    }

    // get project level permissions if projectid exists in request.
    return await AccessTokenService.getUserTenantAccessPermission(
      userId,
      tenantId,
    );
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

    let result: Dictionary<UserTenantAccessPermission> | null = null;
    for (const projectId of projectIds) {
      // check if the force sso login is required. and if it is, then check then token.

      let userTenantAccessPermission: UserTenantAccessPermission | null;
      if (
        projects.find((p: Project) => {
          return p._id === projectId.toString() && p.requireSsoForLogin;
        }) &&
        !UserMiddleware.doesSsoTokenForProjectExist(req, projectId, userId)
      ) {
        // Add default permissions.
        userTenantAccessPermission =
          UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId);
      } else {
        // get project level permissions if projectid exists in request.
        userTenantAccessPermission =
          await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
          );
      }

      if (userTenantAccessPermission) {
        if (!result) {
          result = {};
        }
        result[projectId.toString()] = userTenantAccessPermission;
      }
    }

    return result;
  }
}
