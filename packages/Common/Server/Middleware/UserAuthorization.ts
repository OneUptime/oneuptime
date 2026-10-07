import AccessTokenService from "../Services/AccessTokenService";
import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectService from "../Services/ProjectService";
import TeamMemberService from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
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
import McpDelegationAuthorization from "./McpDelegationAuthorization";
import ProjectMiddleware from "./ProjectAuthorization";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import Dictionary from "../../Types/Dictionary";
import Exception from "../../Types/Exception/Exception";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import SsoAuthorizationException from "../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../Types/Exception/TenantNotFoundException";
import HashedString from "../../Types/HashedString";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import JSONWebTokenData from "../../Types/JsonWebTokenData";
import ObjectID from "../../Types/ObjectID";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import GlobalSsoService from "../Services/GlobalSsoService";
import { GlobalProviderTrust } from "../Utils/GlobalSsoAuthorization";
import GlobalOidcService from "../Services/GlobalOidcService";
import GlobalSsoProjectService from "../Services/GlobalSsoProjectService";
import GlobalOidcProjectService from "../Services/GlobalOidcProjectService";
import ProjectOidcService from "../Services/ProjectOidcService";
import ProjectSsoService from "../Services/ProjectSsoService";
import ProjectSsoProviderStanding, {
  ProjectSsoProviderStandingValue,
  isProjectSsoProviderType,
} from "../Utils/ProjectSsoProviderStanding";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import UserType from "../../Types/UserType";
import UserPermissionUtil from "../Utils/UserPermission/UserPermission";
import CallerPermission from "../Utils/Permission/CallerPermission";

/*
 * What a request's session is, as every route reads it (readRequestSession):
 * no session at all, a token that does not verify or has expired, a blocked
 * user's, or a user's.
 */
export type RequestSession =
  | { kind: "none" }
  | { kind: "invalid"; error: unknown }
  | { kind: "blocked"; session: JSONWebTokenData }
  | { kind: "user"; session: JSONWebTokenData };

/*
 * A project's own SSO sign-in on a request (a Project SSO/OIDC login): the
 * token it left, and when it was given (its `iat`, in milliseconds), or null
 * when the token does not say.
 */
export interface ProjectScopedSsoSignIn {
  tokenData: JSONWebTokenData;
  issuedAtMs: number | null;
}

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

  /**
   * The session a request carries, read the one way every route reads it:
   * the access token (cookie or bearer), verified, of a user who is not
   * blocked. resolveRequestUser answers each kind for the API; routes that
   * only need to know who is asking use getSessionUser. Throws when whether
   * the user is blocked cannot be looked up: a lookup that fails is an
   * error, not a pass.
   */
  @CaptureSpan()
  public static async readRequestSession(
    req: ExpressRequest,
  ): Promise<RequestSession> {
    const accessToken: string | undefined =
      UserMiddleware.getAccessTokenFromExpressRequest(req);

    if (!accessToken) {
      return { kind: "none" };
    }

    let session: JSONWebTokenData;

    try {
      session = JSONWebToken.decode(accessToken);
    } catch (error) {
      return { kind: "invalid", error: error };
    }

    /*
     * The access token is a stateless JWT that lives for 15 minutes, and
     * blocking a user revokes their sessions but cannot recall a token already
     * issued. Without this check a blocked user keeps full access until it
     * expires. The answer is cached per node (UserService.isUserBlocked), so
     * this is one primary-key lookup per user per minute, not per request.
     */
    if (await UserService.isUserBlocked(session.userId)) {
      return { kind: "blocked", session: session };
    }

    return { kind: "user", session: session };
  }

  /**
   * The signed-in user a request's session belongs to, decided exactly as
   * the API decides it (readRequestSession), or null: no session, one that
   * does not verify or has expired, or a blocked user's. For routes that
   * answer someone who is not signed in the same way as someone who may not
   * see what they asked for - the image routes (FileViewerAccess) - so an
   * expired session is no one, rather than a 401. Throws when the
   * blocked-user lookup fails.
   */
  @CaptureSpan()
  public static async getSessionUser(
    req: ExpressRequest,
  ): Promise<JSONWebTokenData | null> {
    const requestSession: RequestSession =
      await UserMiddleware.readRequestSession(req);

    return requestSession.kind === "user" ? requestSession.session : null;
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

  /*
   * Specific-IdP enforcement: when the project requires a specific SSO provider,
   * the token must carry a matching `ssoProviderId` discriminator. Tokens issued
   * before this field existed (no discriminator) do not satisfy a
   * specific-provider requirement. When no specific provider is required, any
   * trusted SSO token satisfies enforcement.
   */
  private static isSsoProviderSatisfied(
    decodedData: JSONWebTokenData,
    requiredSsoProviderId?: ObjectID | undefined,
  ): boolean {
    if (!requiredSsoProviderId) {
      return true;
    }

    const tokenProviderId: string | undefined = decodedData.ssoProviderId
      ? decodedData.ssoProviderId.toString()
      : undefined;

    return Boolean(
      tokenProviderId && tokenProviderId === requiredSsoProviderId.toString(),
    );
  }

  /*
   * Reads the single Global SSO token, if present. It is minted by a Global
   * SSO/OIDC login and is NOT bound to a project, so it satisfies SSO
   * enforcement for any project the user belongs to. Sourced from the
   * `global-sso-token` cookie (web) or the `x-global-sso-token` header (mobile).
   * Only tokens carrying a Global provider type are accepted here.
   */
  @CaptureSpan()
  public static getGlobalSsoTokenData(
    req: ExpressRequest,
  ): JSONWebTokenData | null {
    let rawToken: string | undefined = CookieUtil.getCookieFromExpressRequest(
      req,
      CookieUtil.getGlobalSSOKey(),
    );

    if (!rawToken) {
      const headerToken: string | undefined = req.headers[
        "x-global-sso-token"
      ] as string | undefined;
      if (headerToken && typeof headerToken === "string") {
        rawToken = headerToken;
      }
    }

    if (!rawToken) {
      return null;
    }

    try {
      const decodedData: JSONWebTokenData = JSONWebToken.decode(rawToken);

      if (
        decodedData.ssoProviderType === SsoProviderType.GlobalSSO ||
        decodedData.ssoProviderType === SsoProviderType.GlobalOIDC
      ) {
        return decodedData;
      }

      return null;
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as OneUptimeRequest));
      return null;
    }
  }

  /**
   * The per-project SSO sign-in on this request (Project SSO/OIDC login), if
   * it is stateless-valid for this project and user, or null: signature,
   * expiry, project, user, a project provider type, and the optional
   * pinned-provider discriminator.
   *
   * "Stateless-valid" says nothing about whether the provider that gave it
   * still vouches for it - whether the provider is still there, still the
   * project's and still on, and whether the sign-in came after it was last
   * turned off. That needs the database, and lives in
   * `isProjectScopedSsoSignInAuthorizedForProject`.
   */
  @CaptureSpan()
  public static getStatelessValidProjectScopedSsoSignIn(
    req: ExpressRequest,
    projectId: ObjectID,
    userId: ObjectID,
    requiredSsoProviderId?: ObjectID | undefined,
  ): ProjectScopedSsoSignIn | null {
    const ssoTokens: Dictionary<string> = this.getSsoTokens(req);
    const rawToken: string | undefined = ssoTokens
      ? ssoTokens[projectId.toString()]
      : undefined;

    if (!rawToken) {
      return null;
    }

    try {
      const decodedData: JSONWebTokenData = JSONWebToken.decode(rawToken);

      /*
       * A Global-typed credential is NEVER accepted here, whichever slot it
       * arrived in. Before the single-token redesign the Global SSO router
       * minted one per-project token per project, typed GlobalSSO, signed for
       * 30 days - and those are still sitting in browsers as `sso-<projectId>`
       * cookies and in the mobile app's AsyncStorage, replayed on every
       * request. Accepting them here would let a Global credential short-
       * circuit past the provider-trust check, so disabling a provider would
       * still not revoke them. Route every Global token through the stateful
       * path instead.
       */
      if (
        decodedData.ssoProviderType === SsoProviderType.GlobalSSO ||
        decodedData.ssoProviderType === SsoProviderType.GlobalOIDC
      ) {
        return null;
      }

      if (
        decodedData.projectId?.toString() !== projectId.toString() ||
        decodedData.userId.toString() !== userId.toString() ||
        !this.isSsoProviderSatisfied(decodedData, requiredSsoProviderId)
      ) {
        return null;
      }

      return {
        tokenData: decodedData,
        // When it was given, read by the signature check above.
        issuedAtMs: decodedData.issuedAtMs ?? null,
      };
    } catch {
      /*
       * A token that expires between `getSsoTokens` decoding it and this call
       * throws out of `decode`. Swallowing it here means the request falls
       * through to the Global SSO token instead of 500-ing, which is what a
       * user with both kinds would expect.
       */
      return null;
    }
  }

  /**
   * The stateless half of the per-project SSO check, as a yes or no: is
   * there a per-project SSO sign-in on this request that is stateless-valid
   * for this project and user (getStatelessValidProjectScopedSsoSignIn).
   *
   * NOTE: this is NOT the enforcement entry point - the provider that gave
   * the sign-in may have been turned off or deleted since. Enforcement calls
   * `isSsoSatisfiedForProject`.
   */
  @CaptureSpan()
  public static doesProjectScopedSsoTokenExist(
    req: ExpressRequest,
    projectId: ObjectID,
    userId: ObjectID,
    requiredSsoProviderId?: ObjectID | undefined,
  ): boolean {
    return Boolean(
      this.getStatelessValidProjectScopedSsoSignIn(
        req,
        projectId,
        userId,
        requiredSsoProviderId,
      ),
    );
  }

  /**
   * Whether the project's own SSO provider that gave a sign-in still vouches
   * for it: the provider the sign-in names, by kind and id, is still there,
   * is still this project's and is on, and the sign-in was given after the
   * provider was last turned off (ProjectSsoProviderStanding). So turning a
   * provider off, or deleting it, ends every sign-in it gave at the next
   * request - and turning it on again does not bring them back - while a
   * new certificate or client secret changes nothing for anyone signed in.
   *
   * A sign-in that does not name its provider cannot be checked, so it does
   * not count: every project SSO sign-in names it, and one that does not was
   * made by an old version and is answered like an expired one - signing in
   * again gives one that does.
   *
   * Answers are cached per server for a minute, and forgotten on every
   * server when a provider is turned off or on or deleted
   * (ProjectSsoProviderChanges).
   *
   * THROWS rather than refusing when the lookup itself fails, for the reason
   * isGlobalSsoTokenAuthorizedForProject does: "this provider no longer
   * vouches for you" and "we could not find out" are different answers.
   */
  @CaptureSpan()
  public static async isProjectScopedSsoSignInAuthorizedForProject(data: {
    ssoProviderType?: SsoProviderType | string | null | undefined;
    ssoProviderId?: ObjectID | string | null | undefined;
    issuedAtMs: number | null;
    projectId: ObjectID;
  }): Promise<boolean> {
    const providerIdValue: string | undefined = data.ssoProviderId
      ? data.ssoProviderId.toString()
      : undefined;

    if (!providerIdValue || !ObjectID.isValidUUID(providerIdValue)) {
      return false;
    }

    if (!isProjectSsoProviderType(data.ssoProviderType)) {
      return false;
    }

    const providerId: ObjectID = new ObjectID(providerIdValue);

    const standing: ProjectSsoProviderStandingValue =
      data.ssoProviderType === SsoProviderType.ProjectOIDC
        ? await ProjectOidcService.getSignInStanding({
            providerId: providerId,
            projectId: data.projectId,
          })
        : await ProjectSsoService.getSignInStanding({
            providerId: providerId,
            projectId: data.projectId,
          });

    return ProjectSsoProviderStanding.doesVouchFor(standing, data.issuedAtMs);
  }

  /**
   * The Global SSO token, if one is present and stateless-valid for this user.
   *
   * "Stateless-valid" means signature, expiry, Global provider type, matching
   * user, and the project's pinned-provider discriminator. It deliberately
   * says nothing about whether the provider still exists, is still enabled, or
   * governs the project in question - those need the database, and live in
   * `isGlobalSsoTokenAuthorizedForProject`.
   */
  @CaptureSpan()
  public static getStatelessValidGlobalSsoTokenData(
    req: ExpressRequest,
    userId: ObjectID,
    requiredSsoProviderId?: ObjectID | undefined,
  ): JSONWebTokenData | null {
    const globalSsoTokenData: JSONWebTokenData | null =
      this.getGlobalSsoTokenData(req);

    if (!globalSsoTokenData) {
      return null;
    }

    if (globalSsoTokenData.userId.toString() !== userId.toString()) {
      return null;
    }

    if (
      !this.isSsoProviderSatisfied(globalSsoTokenData, requiredSsoProviderId)
    ) {
      return null;
    }

    return globalSsoTokenData;
  }

  /**
   * The stateless half of the whole decision, kept as one call because it is
   * the part that can be reasoned about without a database.
   *
   * NOTE: this is NOT the enforcement entry point. A Global SSO token that
   * passes here can still be refused by `isSsoSatisfiedForProject`, which also
   * asks whether the provider is still trusted and whether it governs this
   * project. Enforcement must call that.
   */
  @CaptureSpan()
  public static doesSsoTokenForProjectExist(
    req: ExpressRequest,
    projectId: ObjectID,
    userId: ObjectID,
    requiredSsoProviderId?: ObjectID | undefined,
  ): boolean {
    if (
      this.doesProjectScopedSsoTokenExist(
        req,
        projectId,
        userId,
        requiredSsoProviderId,
      )
    ) {
      return true;
    }

    return Boolean(
      this.getStatelessValidGlobalSsoTokenData(
        req,
        userId,
        requiredSsoProviderId,
      ),
    );
  }

  /**
   * Whether a stateless-valid Global SSO token is STILL authorized for this
   * project right now.
   *
   * Two questions the token itself cannot answer:
   *
   *   1. IS THE PROVIDER STILL TRUSTED? Always checked. A Global SSO token
   *      lives for 30 days and carries no revocation, so without this an admin
   *      turning a provider off - or deleting it outright - changes nothing
   *      for anyone already signed in, for up to a month.
   *
   *   2. DOES THE PROVIDER GOVERN THIS PROJECT? Only checked when the admin
   *      turned on `restrictToAttachedProjects` for that provider. The
   *      attachment rows are the PROVISIONING allow-list by default, and the
   *      login routers grant a session on membership of ANY project - so
   *      treating attachments as an access boundary unasked would deny users
   *      projects they legitimately reach today, with nothing in the product
   *      to recover with.
   *
   * Answers are cached in-process for 60s and concurrent misses share one
   * query (Common/Server/Utils/GlobalSsoAuthorization.ts).
   *
   * THROWS rather than denying when the lookup itself fails. "This provider is
   * not allowed here" and "we could not find out" are different answers, and
   * conflating them lets a database blip look like a permission decision - on
   * the multi-tenant path that would silently hand back a 200 with no
   * permissions rather than an error anyone would notice.
   */
  @CaptureSpan()
  public static async isGlobalSsoTokenAuthorizedForProject(data: {
    globalSsoTokenData: JSONWebTokenData;
    projectId: ObjectID;
  }): Promise<boolean> {
    const { globalSsoTokenData, projectId } = data;

    const providerIdValue: string | undefined =
      globalSsoTokenData.ssoProviderId?.toString();

    if (!providerIdValue) {
      /*
       * A Global-typed token with no provider id cannot be checked against
       * either question, so it cannot be trusted for a project. This is a
       * decision, not a failure - do not throw.
       */
      return false;
    }

    const providerId: ObjectID = new ObjectID(providerIdValue);

    const isOidc: boolean =
      globalSsoTokenData.ssoProviderType === SsoProviderType.GlobalOIDC;

    const trust: GlobalProviderTrust = isOidc
      ? await GlobalOidcService.getProviderTrust(providerId)
      : await GlobalSsoService.getProviderTrust(providerId);

    if (!trust.isUsable) {
      return false;
    }

    if (!trust.restrictToAttachedProjects) {
      /*
       * The default, and what every existing installation gets: a global login
       * satisfies enforcement for every project the user belongs to.
       */
      return true;
    }

    return isOidc
      ? GlobalOidcProjectService.doesProviderGovernProject({
          globalOidcId: providerId,
          projectId,
        })
      : GlobalSsoProjectService.doesProviderGovernProject({
          globalSsoId: providerId,
          projectId,
        });
  }

  /**
   * THE enforcement entry point: is this request's SSO requirement satisfied
   * for this project?
   *
   * A per-project sign-in has to be stateless-valid and still vouched for by
   * the provider that gave it (isProjectScopedSsoSignInAuthorizedForProject).
   * A Global SSO token has to survive the provider-trust and
   * project-governance checks above. Either one satisfies the requirement.
   */
  @CaptureSpan()
  public static async isSsoSatisfiedForProject(data: {
    req: ExpressRequest;
    projectId: ObjectID;
    userId: ObjectID;
    requiredSsoProviderId?: ObjectID | undefined;
  }): Promise<boolean> {
    const { req, projectId, userId, requiredSsoProviderId } = data;

    const projectSsoSignIn: ProjectScopedSsoSignIn | null =
      this.getStatelessValidProjectScopedSsoSignIn(
        req,
        projectId,
        userId,
        requiredSsoProviderId,
      );

    /*
     * A lookup of the project's provider that fails is an error, not a
     * refusal - unless a Global SSO sign-in, asked next, satisfies the
     * requirement on its own.
     */
    let projectSignInLookup: { error: unknown } | null = null;

    if (projectSsoSignIn) {
      try {
        if (
          await this.isProjectScopedSsoSignInAuthorizedForProject({
            ssoProviderType: projectSsoSignIn.tokenData.ssoProviderType,
            ssoProviderId: projectSsoSignIn.tokenData.ssoProviderId,
            issuedAtMs: projectSsoSignIn.issuedAtMs,
            projectId,
          })
        ) {
          return true;
        }
      } catch (err) {
        projectSignInLookup = { error: err };
      }
    }

    const globalSsoTokenData: JSONWebTokenData | null =
      this.getStatelessValidGlobalSsoTokenData(
        req,
        userId,
        requiredSsoProviderId,
      );

    if (
      globalSsoTokenData &&
      (await this.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData,
        projectId,
      }))
    ) {
      return true;
    }

    if (projectSignInLookup) {
      throw projectSignInLookup.error;
    }

    return false;
  }

  @CaptureSpan()
  public static async getUserMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    return await UserMiddleware.resolveRequestUser(req, res, next, {
      treatInvalidAccessTokenAsAnonymous: false,
    });
  }

  /*
   * getUserMiddleware for the anonymous surfaces: the public dashboard and
   * public status page routes. Their handlers decide access themselves
   * (DashboardService / StatusPageService.hasReadAccess: public flag, IP
   * allowlist, master-password cookie, the page's own session cookie) and
   * never read the caller's user identity.
   *
   * The one difference: an access token that is present but cannot be decoded
   * makes the request anonymous (UserType.Public) instead of answering 401.
   * The host-wide dashboard access-token cookie reaches these routes whenever
   * the page is served from the dashboard's host (the preview routes), and it
   * can stay in the browser after it stops decoding - an encryption-secret
   * rotation, say. The public clients cannot refresh a dashboard session, so
   * that 401 only ever meant "sent back to the login route": a reload loop on
   * the preview route, and a password prompt for a master password the viewer
   * already entered.
   *
   * A token that does decode is still resolved exactly as getUserMiddleware
   * resolves it, and an API key is still validated. Never mount this on a
   * route that needs to know who the caller is.
   */
  @CaptureSpan()
  public static async getPublicRouteUserMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    return await UserMiddleware.resolveRequestUser(req, res, next, {
      treatInvalidAccessTokenAsAnonymous: true,
    });
  }

  private static async resolveRequestUser(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
    options: { treatInvalidAccessTokenAsAnonymous: boolean },
  ): Promise<void> {
    /*
     * A request the MCP server makes for a member who connected a client with
     * OAuth. Claimed before anything else is read: its project comes from the
     * credential, so not even the tenant header below is to be trusted, and a
     * request that presents this credential must be answered as that - never
     * quietly authenticated some other way, or as nobody.
     */
    if (McpDelegationAuthorization.hasDelegationToken(req)) {
      return await McpDelegationAuthorization.authorize(req, res, next);
    }

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

    // The session, read as every route reads it. A failed lookup is an error.
    let requestSession: RequestSession;

    try {
      requestSession = await UserMiddleware.readRequestSession(req);
    } catch (err) {
      return Response.sendErrorResponse(req, res, err as Exception);
    }

    if (requestSession.kind === "none") {
      oneuptimeRequest.userType = UserType.Public;
      return next();
    }

    if (requestSession.kind === "invalid") {
      if (options.treatInvalidAccessTokenAsAnonymous) {
        // decode() has already logged why the token was refused.
        oneuptimeRequest.userType = UserType.Public;
        return next();
      }

      // if the token is invalid or expired, return 401 so clients can refresh the token.
      logger.error(
        requestSession.error,
        getLogAttributesFromRequest(oneuptimeRequest),
      );
      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          "AccessToken is invalid or expired. Please refresh your token.",
        ),
      );
    }

    /*
     * A blocked user's token: a 401, like an expired token. The client asks
     * /refresh-token for a new one, which is refused for a blocked user, and
     * signs them out.
     */
    if (requestSession.kind === "blocked") {
      if (options.treatInvalidAccessTokenAsAnonymous) {
        // As for a token that does not decode: the public routes never read who is asking.
        oneuptimeRequest.userType = UserType.Public;
        return next();
      }

      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(ExceptionMessages.UserBlocked),
      );
    }

    oneuptimeRequest.userAuthorization = requestSession.session;

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
            userGlobalAccessPermission: userGlobalAccessPermissionPromise,
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
            userGlobalAccessPermission,
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

      if (
        !(
          req.headers &&
          req.headers["global-permissions-hash"] &&
          req.headers["global-permissions-hash"] === globalPermissionsHash
        )
      ) {
        res.set("global-permissions", globalValue);
        res.set("global-permissions-hash", globalPermissionsHash);
      }
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

    if (UserMiddleware.isAnonymousRequest(oneuptimeRequest)) {
      return Response.sendErrorResponse(
        req,
        res,
        new NotAuthenticatedException(
          UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
        ),
      );
    }

    return next();
  }

  // Same wording as CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE.
  public static readonly AUTHENTICATION_REQUIRED_MESSAGE: string =
    "Authentication required. Please log in to access this resource.";

  /*
   * The request-level twin of CommonAPI.isAnonymous: getUserMiddleware found
   * no access token and no API key. Usually an expired session, since the
   * access-token cookie expires with the JWT inside it.
   */
  public static isAnonymousRequest(req: OneUptimeRequest): boolean {
    return !req.userType || req.userType === UserType.Public;
  }

  /*
   * A route guard: the caller must hold one of `permissions` in the project
   * the request is for, by the rule every permission check follows
   * (CallerPermission): only an allow row grants, and a block with no labels
   * on any of them refuses. Pass `wildcard` when the list is an operational
   * resource's own list for the operation, as the model-backed API accepts
   * the *AllOperationalResources wildcard for it too.
   */
  public static requirePermission(data: {
    permissions: Array<Permission>;
    wildcard?: Permission | undefined;
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

      /*
       * An anonymous caller has no permissions to compare, and telling it so
       * with a 422 would stop the browser client from refreshing an expired
       * session. Ask who it is first.
       */
      if (UserMiddleware.isAnonymousRequest(oneuptimeRequest)) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
          ),
        );
      }

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

      /*
       * Only allow rows grant: a block row names a permission in order to
       * deny it, so holding one never counts as holding the permission. A
       * block with no labels on any of these takes the route away, whatever
       * else the caller holds, as it takes away the tables these routes
       * stand in for.
       */
      if (
        !CallerPermission.holdsAnyOf(oneuptimeRequest, data.permissions, {
          projectId: tenantId,
          wildcard: data.wildcard,
        })
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
    /*
     * The user's global permission, when the caller is already resolving it.
     * AccessTokenService checks the project against it before serving a cached
     * permission set.
     */
    userGlobalAccessPermission?:
      | Promise<UserGlobalAccessPermission | null>
      | UserGlobalAccessPermission
      | null
      | undefined;
  }): Promise<UserTenantAccessPermission | null> {
    const { req, tenantId, userId, userGlobalAccessPermission } = data;

    const isMasterAdmin: boolean =
      (req as OneUptimeRequest).userAuthorization?.isMasterAdmin === true;

    /*
     * Resolve the SSO requirement and the tenant permission in parallel.
     * `getRequireSsoForLogin` is cached in-process for 60s, so this is
     * usually free; the tenant permission lookup is the expensive call.
     */
    const [projectRequireSsoForLogin, tenantPermission]: [
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
      AccessTokenService.getUserTenantAccessPermission(userId, tenantId, {
        userGlobalAccessPermission,
      }),
    ]);

    /*
     * The instance-wide "Require SSO for Login" flag (GlobalConfig) forces SSO
     * on every project. Master admins are exempt so a misconfigured global SSO
     * can't lock them out — a project's own requireSsoForLogin still applies to
     * them. Only checked when the project doesn't already enforce SSO.
     */
    let requireSsoForLogin: boolean = projectRequireSsoForLogin;
    if (!requireSsoForLogin && !isMasterAdmin) {
      requireSsoForLogin =
        await GlobalConfigService.getRequireSsoForLogin().catch(() => {
          return false;
        });
    }

    if (requireSsoForLogin) {
      /*
       * Only resolve the specific-provider requirement when SSO is enforced.
       * The provider-id cache is already warm from getRequireSsoForLogin above.
       */
      const requiredSsoProviderId: ObjectID | null =
        await ProjectService.getRequireSsoWithSsoProviderId(tenantId).catch(
          () => {
            return null;
          },
        );

      if (
        !(await UserMiddleware.isSsoSatisfiedForProject({
          req,
          projectId: tenantId,
          userId,
          requiredSsoProviderId: requiredSsoProviderId ?? undefined,
        }))
      ) {
        throw new SsoAuthorizationException();
      }
    }

    return tenantPermission;
  }

  @CaptureSpan()
  public static async getUserTenantAccessPermissionForMultiTenant(
    req: ExpressRequest,
    userId: ObjectID,
    projectIds: ObjectID[],
    // The global permission projectIds came from, so each project skips re-reading it.
    userGlobalAccessPermission?: UserGlobalAccessPermission | null | undefined,
  ): Promise<Dictionary<UserTenantAccessPermission> | null> {
    if (!projectIds.length) {
      return null;
    }

    const isMasterAdmin: boolean =
      (req as OneUptimeRequest).userAuthorization?.isMasterAdmin === true;

    /*
     * Instance-wide "Require SSO for Login" forces SSO on every project. Master
     * admins are exempt. Resolved once (cached) rather than per project.
     */
    const globalRequireSsoForLogin: boolean = isMasterAdmin
      ? false
      : await GlobalConfigService.getRequireSsoForLogin().catch(() => {
          return false;
        });

    /*
     * Resolve permissions for every project in parallel. A project's own
     * requireSsoForLogin is read through the cached getter; the global flag is
     * OR'd in so enforcement matches the single-tenant path.
     */
    const resolved: Array<{
      projectId: ObjectID;
      permission: UserTenantAccessPermission | null;
    }> = await Promise.all(
      projectIds.map(async (projectId: ObjectID) => {
        const projectRequireSsoForLogin: boolean =
          await ProjectService.getRequireSsoForLogin(projectId).catch(() => {
            /*
             * Unknown/inaccessible project: do not enforce SSO here. Actual
             * access is still gated by AccessTokenService below.
             */
            return false;
          });

        const requireSsoForLogin: boolean =
          projectRequireSsoForLogin || globalRequireSsoForLogin;

        if (requireSsoForLogin) {
          const requiredSsoProviderId: ObjectID | null =
            await ProjectService.getRequireSsoWithSsoProviderId(
              projectId,
            ).catch(() => {
              return null;
            });

          if (
            !(await UserMiddleware.isSsoSatisfiedForProject({
              req,
              projectId,
              userId,
              requiredSsoProviderId: requiredSsoProviderId ?? undefined,
            }))
          ) {
            return {
              projectId,
              permission:
                UserPermissionUtil.getDefaultUserTenantAccessPermission(
                  projectId,
                ),
            };
          }
        }

        return {
          projectId,
          permission: await AccessTokenService.getUserTenantAccessPermission(
            userId,
            projectId,
            { userGlobalAccessPermission },
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
