import type { Socket } from "../../Infrastructure/SocketIO";
import type UserMiddlewareType from "../../Middleware/UserAuthorization";
import type { RequestSession } from "../../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "../Express";
import JSONWebToken from "../JsonWebToken";
import type { RealtimeSocketSession } from "./RealtimeSessions";
import Dictionary from "../../../Types/Dictionary";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../../Types/Exception/TenantNotFoundException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";
import CookieParser from "cookie-parser";

/*
 * WHETHER A SOCKET MAY HEAR A PROJECT'S LIVE UPDATES, asked as an API
 * request of the same session is asked.
 *
 * A socket's handshake carries what a request of the same browser does: its
 * cookies (the access token, and any SSO sign-in) and its headers. So the
 * join does not decide anything itself. It hands the handshake to the
 * checks every API request goes through (UserMiddleware):
 *
 *   - readRequestSession: the access token, verified, of a user who is not
 *     blocked;
 *   - getUserTenantAccessPermissionWithTenantId: the project's own access
 *     check - the project's Require SSO rule and the instance-wide one, the
 *     provider a project pins, and the person's permissions in the project.
 *
 * Whatever those refuse, the join refuses, for the same reason. What is
 * left to the caller (Realtime) is what the model's own read asks: whether
 * the person may read that kind of record at all.
 */

export enum RealtimeJoinRefusal {
  // No access token, one that does not verify or has expired, or a blocked user's.
  AuthenticationRequired = "AuthenticationRequired",
  // The project requires an SSO sign-in the handshake does not carry.
  SsoRequired = "SsoRequired",
  // A valid session without access to the project.
  NotAuthorized = "NotAuthorized",
}

export type RealtimeJoinDecision =
  | {
      allowed: true;
      session: RealtimeSocketSession;
      // When the access token was issued, as Date.now() counts.
      issuedAtMs: number;
      // The person's permissions in the project; null for a server admin who is not a member.
      tenantPermission: UserTenantAccessPermission | null;
    }
  | { allowed: false; refusal: RealtimeJoinRefusal };

// When an access token was issued and when it stops being accepted.
export interface RealtimeAccessTokenTimes {
  issuedAtMs: number;
  expiresAtMs: number;
}

export default class RealtimeJoinAccess {
  /*
   * The socket's handshake as the API's checks read a request: its headers,
   * and its cookies parsed by the parser the API's server mounts. Nothing
   * else of a request is read by those checks.
   */
  public static getHandshakeRequest(socket: Socket): OneUptimeRequest {
    const headers: Dictionary<unknown> = {
      ...((socket.handshake?.headers || {}) as Dictionary<unknown>),
    };

    const request: OneUptimeRequest = {
      headers: headers,
    } as unknown as OneUptimeRequest;

    CookieParser()(
      request as ExpressRequest,
      {} as ExpressResponse,
      (): void => {
        // Parsing is synchronous; nothing to wait for.
      },
    );

    return request;
  }

  /*
   * Whether the socket may join the project's rooms, and as whom: the
   * session it may hear with, which ends when its access token does.
   * Throws when a lookup the API's checks make fails (the permission
   * cache, the database): that is an error, not a refusal.
   */
  public static async decide(
    socket: Socket,
    tenantId: string,
  ): Promise<RealtimeJoinDecision> {
    const userMiddleware: typeof UserMiddlewareType =
      RealtimeJoinAccess.getUserMiddleware();
    const request: OneUptimeRequest =
      RealtimeJoinAccess.getHandshakeRequest(socket);

    // The session, read as every API request reads it.
    const requestSession: RequestSession =
      await userMiddleware.readRequestSession(request);

    if (requestSession.kind !== "user" || !requestSession.session.userId) {
      return {
        allowed: false,
        refusal: RealtimeJoinRefusal.AuthenticationRequired,
      };
    }

    const tokenData: JSONWebTokenData = requestSession.session;

    const times: RealtimeAccessTokenTimes | null =
      RealtimeJoinAccess.getAccessTokenTimes(request);

    // Live updates end with the access token; one without an end is not taken.
    if (!times || times.expiresAtMs <= Date.now()) {
      return {
        allowed: false,
        refusal: RealtimeJoinRefusal.AuthenticationRequired,
      };
    }

    const projectId: ObjectID = new ObjectID(tenantId);

    // As the API's request middleware sets them before it asks about the project.
    request.userAuthorization = tokenData;
    request.tenantId = projectId;

    let tenantPermission: UserTenantAccessPermission | null = null;

    try {
      tenantPermission =
        await userMiddleware.getUserTenantAccessPermissionWithTenantId({
          req: request,
          tenantId: projectId,
          userId: tokenData.userId,
        });
    } catch (err) {
      if (err instanceof SsoAuthorizationException) {
        return { allowed: false, refusal: RealtimeJoinRefusal.SsoRequired };
      }

      if (err instanceof TenantNotFoundException) {
        return { allowed: false, refusal: RealtimeJoinRefusal.NotAuthorized };
      }

      throw err;
    }

    const session: RealtimeSocketSession = {
      userId: tokenData.userId.toString(),
      isMasterAdmin: Boolean(tokenData.isMasterAdmin),
      sessionId: tokenData.sessionId?.toString() || undefined,
      expiresAtMs: times.expiresAtMs,
    };

    /*
     * A server admin's requests pass every permission check of a project
     * once its sign-in rules are met, member or not; anyone else needs to
     * be a member.
     */
    if (!session.isMasterAdmin && !tenantPermission) {
      return { allowed: false, refusal: RealtimeJoinRefusal.NotAuthorized };
    }

    return {
      allowed: true,
      session: session,
      issuedAtMs: times.issuedAtMs,
      tenantPermission: tenantPermission,
    };
  }

  /*
   * When the access token the request carries was issued and when it stops
   * being accepted, as Date.now() counts, or null when it does not verify
   * or says neither. The token is the one readRequestSession read.
   */
  public static getAccessTokenTimes(
    request: OneUptimeRequest,
  ): RealtimeAccessTokenTimes | null {
    const accessToken: string | undefined =
      RealtimeJoinAccess.getUserMiddleware().getAccessTokenFromExpressRequest(
        request,
      );

    if (!accessToken) {
      return null;
    }

    let payload: JSONObject;

    try {
      payload = JSONWebToken.decodeJsonPayload(accessToken);
    } catch {
      return null;
    }

    const issuedAtInSeconds: unknown = payload["iat"];
    const expiresAtInSeconds: unknown = payload["exp"];

    if (
      typeof issuedAtInSeconds !== "number" ||
      !Number.isFinite(issuedAtInSeconds) ||
      typeof expiresAtInSeconds !== "number" ||
      !Number.isFinite(expiresAtInSeconds)
    ) {
      return null;
    }

    return {
      issuedAtMs: issuedAtInSeconds * 1000,
      expiresAtMs: expiresAtInSeconds * 1000,
    };
  }

  /*
   * Read when first needed rather than imported at the top: the middleware
   * imports the services, which extend DatabaseService, which imports
   * Realtime, which imports this module. Only its types are imported above.
   */
  private static getUserMiddleware(): typeof UserMiddlewareType {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Middleware/UserAuthorization").default;
  }
}
