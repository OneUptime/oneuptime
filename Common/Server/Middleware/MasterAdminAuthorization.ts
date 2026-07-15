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
   * automated callers reach the master-admin OneUptime Health endpoints with the
   * key instead of a logged-in master-admin session.
   *
   * Deliberately scoped to the read-only health / diagnostics routes only. It is
   * NOT used on higher-risk master-admin actions (e.g. the read/write query
   * console or broadcast email), which stay on the JWT-only middleware above so
   * that a leaked static key cannot trigger them headlessly.
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
