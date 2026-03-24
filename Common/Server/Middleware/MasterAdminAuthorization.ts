import UserMiddleware from "./UserAuthorization";
import JSONWebToken from "../Utils/JsonWebToken";
import Response from "../Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import JSONWebTokenData from "../../Types/JsonWebTokenData";

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
    } catch (_err) {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthorizedException(
          "Unauthorized: Invalid or expired access token.",
        ),
      );
    }
  }
}
