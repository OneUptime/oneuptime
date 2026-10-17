import UserMiddleware, {
  RequestSession,
} from "../Middleware/UserAuthorization";
import { ExpressRequest, ExpressResponse } from "./Express";
import logger from "./Logger";
import Response from "./Response";
import Exception from "../../Types/Exception/Exception";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";

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
 *
 * The session is read as every route reads it (readRequestSession), so it
 * is a master admin's only while their account still is one: someone whose
 * master admin access was removed is refused the page with the session they
 * already hold. When that cannot be read, the page is refused with the
 * error, never served on the token's word. A blocked user's session is
 * answered by what it says, as before: the APIs refuse it with a 401, and
 * the app sends them to the login page.
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
  let requestSession: RequestSession;

  try {
    requestSession = await UserMiddleware.readRequestSession(data.req);
  } catch (error) {
    /*
     * Sent here rather than thrown: the page's renderer logs a throw and
     * renders the page anyway.
     */
    logger.error(error, { service: data.service });
    Response.sendErrorResponse(data.req, data.res, error as Exception);
    return {};
  }

  if (requestSession.kind === "none") {
    return {};
  }

  if (requestSession.kind === "invalid") {
    // Expired or unreadable: let the app load and refresh it.
    logger.debug(requestSession.error, { service: data.service });
    return {};
  }

  if (!requestSession.session.isMasterAdmin) {
    Response.sendErrorResponse(
      data.req,
      data.res,
      new NotAuthorizedException(NOT_A_MASTER_ADMIN_MESSAGE),
    );
  }

  return {};
};
