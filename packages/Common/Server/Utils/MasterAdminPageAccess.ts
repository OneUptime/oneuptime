import UserMiddleware from "../Middleware/UserAuthorization";
import { ExpressRequest, ExpressResponse } from "./Express";
import JSONWebToken from "./JsonWebToken";
import logger from "./Logger";
import Response from "./Response";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import JSONWebTokenData from "../../Types/JsonWebTokenData";

export const NOT_A_MASTER_ADMIN_MESSAGE: string =
  "Unauthorized: Only master admins can access the admin dashboard.";

/*
 * Gate for the Admin Dashboard's index page (the HTML shell, not its APIs).
 *
 * It refuses only a caller it can positively identify as NOT a master admin.
 * A missing access token, or one that no longer decodes, is served the shell:
 * the access-token cookie expires with the JWT inside it, so an admin who
 * reloads a tab left open past the token lifetime arrives here with no token
 * at all, and answering that with a 422 JSON page meant the app never loaded
 * and so never got to refresh the session. The shell holds nothing the public
 * static bundle does not; once it loads, the SPA sends a signed-out visitor to
 * the login page, and every admin API it calls refreshes an expired session
 * (or answers 401) on its own.
 */
export const ensureMasterAdminPageAccess: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  service: string;
}) => Promise<JSONObject> = async (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  service: string;
}): Promise<JSONObject> => {
  const accessToken: string | undefined =
    UserMiddleware.getAccessTokenFromExpressRequest(data.req);

  if (!accessToken) {
    return {};
  }

  let authData: JSONWebTokenData;

  try {
    authData = JSONWebToken.decode(accessToken);
  } catch (error) {
    // Expired or unreadable: let the app load and refresh it.
    logger.debug(error, { service: data.service });
    return {};
  }

  if (!authData.isMasterAdmin) {
    Response.sendErrorResponse(
      data.req,
      data.res,
      new NotAuthorizedException(NOT_A_MASTER_ADMIN_MESSAGE),
    );
  }

  return {};
};
