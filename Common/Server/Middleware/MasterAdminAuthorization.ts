import UserMiddleware from "./UserAuthorization";
import ProjectMiddleware from "./ProjectAuthorization";
import JSONWebToken from "../Utils/JsonWebToken";
import Response from "../Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import ObjectID from "../../Types/ObjectID";

export default class MasterAdminAuthorization {
  public static async isAuthorizedMasterAdminMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const accessToken: string | undefined =
        UserMiddleware.getAccessTokenFromExpressRequest(req);

      if (!accessToken) {
        Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException("Unauthorized: Access token is required."),
        );
        return;
      }

      const authData: JSONWebTokenData = JSONWebToken.decode(accessToken);

      if (!authData.isMasterAdmin) {
        Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "Unauthorized: Only master admins can perform this action.",
          ),
        );
        return;
      }

      next();
    } catch {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthorizedException(
          "Unauthorized: Invalid or expired access token.",
        ),
      );
    }
  }

  /*
   * Same as isAuthorizedMasterAdminMiddleware, but ALSO accepts the instance-wide
   * master API key (Admin Dashboard → Settings → API Key) supplied in the
   * `apikey` header. The master key has root/master-admin access, so this lets
   * automated callers reach master-admin endpoints with the key instead of a
   * logged-in master-admin session.
   *
   * Deliberately scoped to READ-ONLY routes: the OneUptime Health / diagnostics
   * endpoints, and the cross-tenant read of one user's projects
   * (POST /user/:userId/projects). It is NOT used on master-admin routes that
   * change anything — the read/write query console, broadcast email, removing a
   * user from a project, setting a password — which stay on the JWT-only
   * middleware above so that a leaked static key cannot trigger them headlessly.
   *
   * Read-only is the line to hold when adding a route here. A key that can read
   * discloses; a key that can write takes over.
   */
  public static async isAuthorizedMasterAdminOrMasterApiKeyMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const apiKey: ObjectID | null = ProjectMiddleware.getApiKey(req);

      if (apiKey && (await ProjectMiddleware.isMasterApiKey(apiKey))) {
        next();
        return;
      }
    } catch {
      // Fall through to the master-admin session (JWT) check below.
    }

    return MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware(
      req,
      res,
      next,
    );
  }
}
