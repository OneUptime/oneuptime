import UserMiddleware, { RequestSession } from "./UserAuthorization";
import ProjectMiddleware from "./ProjectAuthorization";
import Response from "../Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Exception from "../../Types/Exception/Exception";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ObjectID from "../../Types/ObjectID";

export default class MasterAdminAuthorization {
  public static async isAuthorizedMasterAdminMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    /*
     * The session, read as every route reads it (readRequestSession): a
     * session's own access token, and nothing else OneUptime signs, of a
     * user who is not blocked - and a master admin's only while their
     * account still is one. The token says what its person was when it was
     * signed, up to 15 minutes ago; another master admin may have removed
     * the access since, and these routes set anyone's password and two
     * factor auth, and give the access back. A lookup that fails is
     * reported as what it is, never answered with the token's word.
     */
    let requestSession: RequestSession;

    try {
      requestSession = await UserMiddleware.readRequestSession(req);
    } catch (err) {
      Response.sendErrorResponse(req, res, err as Exception);
      return;
    }

    /*
     * No token and an undecodable one are both 401, not 422: the access-token
     * cookie expires with the JWT inside it, so an Admin Dashboard tab left
     * idle past the token lifetime arrives here with no token at all. Only a
     * 401 makes the browser client refresh the session and replay the
     * request; a 422 left the admin looking at "Unauthorized" until a reload.
     * A valid session that simply is not a master admin stays 422 - one
     * whose master admin access was removed too: a renewed session would be
     * the same person, no master admin either.
     */
    if (requestSession.kind === "none") {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          "Unauthorized: Access token is required.",
        ),
      );
      return;
    }

    if (requestSession.kind === "invalid") {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          "Unauthorized: Invalid or expired access token.",
        ),
      );
      return;
    }

    // A blocked user's access token is still valid for up to 15 minutes.
    if (requestSession.kind === "blocked") {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(ExceptionMessages.UserBlocked),
      );
      return;
    }

    if (!requestSession.session.isMasterAdmin) {
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
