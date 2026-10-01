import AccessTokenService from "../Services/AccessTokenService";
import ProjectService from "../Services/ProjectService";
import TeamMemberService from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import McpDelegationToken, {
  McpDelegationClaims,
} from "../Utils/Mcp/McpDelegationToken";
import McpOAuthConfig from "../Utils/Mcp/McpOAuthConfig";
import Response from "../Utils/Response";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import UserType from "../../Types/UserType";

/*
 * How the API recognises a request the MCP server is making for a member who
 * connected an MCP client with OAuth (see McpDelegationToken for why the
 * client's own access token never reaches the API).
 *
 * The request is authorized AS THE MEMBER, in the one project the grant is
 * for:
 *
 *   - the tenant is the grant's project, whatever `tenantid` or `projectid`
 *     the request happens to carry - the same rule an API key gets, where the
 *     project comes from the credential and never from the caller;
 *   - the permissions are the member's own, read here from their teams on
 *     every request, so a role change or a removal from the project applies
 *     to the very next tool call;
 *   - it is a User request, never a MasterAdmin one, even when the member is
 *     a master admin. An agent acting for an instance administrator gets what
 *     that person's teams grant in the project and nothing more;
 *   - a grant that carries read access only is marked read-only, and the
 *     permission layer then refuses every create, update and delete it makes,
 *     whatever the member's own permissions allow.
 *
 * Everything about the GRANT - that it exists, has not been revoked or
 * expired, still satisfies the project's SSO rules - was checked by the MCP
 * server before it minted the token, a moment ago, and is not asked again
 * here. What is asked again is the little that could matter for an API call
 * and costs nothing to ask: the token verifies, and the member is not blocked.
 */

const MULTI_TENANT_QUERY_HEADER: string = "is-multi-tenant-query";
const API_KEY_HEADER: string = "apikey";

const INVALID_DELEGATION_MESSAGE: string =
  "The MCP delegation token is invalid or has expired.";

export default class McpDelegationAuthorization {
  /*
   * Presence, not validity - the reading ProjectMiddleware.hasApiKey makes of
   * its own header, for the same reason: a request that carries the header is
   * a caller attempting this kind of authentication, and it must be answered
   * as that (a 401 saying so) rather than fall through to another credential
   * or to the anonymous path.
   */
  public static hasDelegationToken(req: ExpressRequest): boolean {
    return req.headers?.[McpDelegationToken.HEADER_NAME] !== undefined;
  }

  public static async authorize(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const oneuptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    try {
      if (!McpOAuthConfig.isEnabled()) {
        throw new NotAuthenticatedException(INVALID_DELEGATION_MESSAGE);
      }

      /*
       * Two credentials on one request is never something the MCP server
       * sends. Refusing it outright means there is no order of precedence to
       * get wrong.
       */
      if (req.headers[API_KEY_HEADER] !== undefined) {
        throw new BadDataException(
          "A request cannot carry both an API key and an MCP delegation token.",
        );
      }

      const rawToken: string | Array<string> | undefined =
        req.headers[McpDelegationToken.HEADER_NAME];

      const claims: McpDelegationClaims | null = McpDelegationToken.verify(
        Array.isArray(rawToken) ? undefined : rawToken,
      );

      if (!claims) {
        throw new NotAuthenticatedException(INVALID_DELEGATION_MESSAGE);
      }

      if (await UserService.isUserBlocked(claims.userId)) {
        throw new NotAuthenticatedException(ExceptionMessages.UserBlocked);
      }

      /*
       * A delegated request is for exactly one project. Dropping the header
       * (rather than merely not setting the flag) keeps every later reader of
       * the raw request from widening it.
       */
      delete req.headers[MULTI_TENANT_QUERY_HEADER];

      oneuptimeRequest.tenantId = claims.projectId;
      oneuptimeRequest.userType = UserType.User;
      oneuptimeRequest.userAuthorization = {
        userId: claims.userId,
        email: claims.userEmail,
        name: new Name(claims.userName),
        isMasterAdmin: false,
        isGlobalLogin: false,
      };
      oneuptimeRequest.mcpOAuth = {
        grantId: claims.grantId,
        clientId: claims.clientId,
        clientName: claims.clientName,
        isReadOnly: !claims.canWrite,
      };

      SpanUtil.addAttributesToCurrentSpan({
        userId: claims.userId.toString(),
        userType: UserType.User,
        projectId: claims.projectId.toString(),
        mcpOAuthGrantId: claims.grantId.toString(),
        ...(oneuptimeRequest.requestId
          ? { requestId: oneuptimeRequest.requestId }
          : {}),
      });

      // Fire-and-forget, debounced inside each service - as for a session.
      void ProjectService.updateLastActive(claims.projectId);
      void UserService.updateLastActive(claims.userId);

      const userGlobalAccessPermissionPromise: Promise<UserGlobalAccessPermission | null> =
        AccessTokenService.getUserGlobalAccessPermission(claims.userId);

      const [
        userGlobalAccessPermission,
        userTenantAccessPermission,
        userTeamIds,
      ]: [
        UserGlobalAccessPermission | null,
        UserTenantAccessPermission | null,
        Array<ObjectID>,
      ] = await Promise.all([
        userGlobalAccessPermissionPromise,
        AccessTokenService.getUserTenantAccessPermission(
          claims.userId,
          claims.projectId,
          { userGlobalAccessPermission: userGlobalAccessPermissionPromise },
        ),
        TeamMemberService.getTeamIdsForUser(claims.userId, claims.projectId),
      ]);

      /*
       * No permission set means the member has left the project since the MCP
       * server looked. Without this the request would carry on with no tenant
       * permissions at all and fail later as a puzzling per-model refusal.
       */
      if (!userTenantAccessPermission) {
        throw new NotAuthenticatedException(
          "You are no longer a member of the project this MCP client is connected to.",
        );
      }

      if (userGlobalAccessPermission) {
        /*
         * The global permission lists every project the member belongs to.
         * This request is for one of them, so that is all it is told about.
         */
        oneuptimeRequest.userGlobalAccessPermission = {
          ...userGlobalAccessPermission,
          projectIds: [claims.projectId],
        };
      }

      oneuptimeRequest.userTenantAccessPermission = {
        [claims.projectId.toString()]: userTenantAccessPermission,
      };
      oneuptimeRequest.userTeamIds = userTeamIds;

      return next();
    } catch (err) {
      SpanUtil.recordExceptionOnCurrentSpan(err);
      return Response.sendErrorResponse(req, res, err as Exception);
    }
  }
}
