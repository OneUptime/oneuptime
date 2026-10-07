import UserMiddleware, {
  ProjectScopedSsoSignIn,
} from "../../Middleware/UserAuthorization";
import GlobalConfigService from "../../Services/GlobalConfigService";
import { McpOAuthGrantSsoEvidence } from "../../Services/McpOAuthGrantService";
import ProjectService from "../../Services/ProjectService";
import CookieUtil from "../Cookie";
import { ExpressRequest } from "../Express";
import JSONWebToken from "../JsonWebToken";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";

/*
 * Single sign-on enforcement for MCP clients that signed in with OAuth.
 *
 * A project (or the whole instance) can require SSO. In a browser that is
 * enforced on every request: the session must also carry an SSO token for the
 * project, and when that token lapses, is for the wrong provider, or names a
 * provider that has since been turned off or deleted, the project stops
 * loading.
 *
 * An MCP client has no browser and no cookies, so the same rules are applied
 * to a copy. When a member approves a client, whatever SSO token let their
 * browser into the project at that moment is summarised onto the grant - the
 * kind of provider, which provider, and when the sign-in lapses - and every
 * later request the client makes is held to that summary exactly as a browser
 * request is held to the token. A grant therefore never outlives the SSO
 * sign-in it was approved under, and the fix is the same as in a browser: sign
 * in again.
 *
 * The decisions themselves are not re-implemented here. Whether a browser
 * request satisfies SSO is asked of UserMiddleware, the one place that rule
 * lives; this file only reads the expiry and the provider off the token that
 * satisfied it, and replays the provider checks against the stored copy.
 */

export interface McpOAuthSsoRequirement {
  isRequired: boolean;

  // Set when the project accepts one specific provider only.
  requiredSsoProviderId: ObjectID | null;
}

const GLOBAL_SSO_TOKEN_HEADER: string = "x-global-sso-token";

export default class McpOAuthSso {
  /*
   * Whether this project needs SSO from this member right now.
   *
   * The same reading UserMiddleware.getUserTenantAccessPermissionWithTenantId
   * makes: the project's own switch, else the instance-wide one - from which
   * master admins are exempt, so a misconfigured instance SSO cannot lock
   * them out. A project that does not exist throws, as it does there.
   */
  public static async getRequirement(data: {
    projectId: ObjectID;
    isMasterAdmin: boolean;
  }): Promise<McpOAuthSsoRequirement> {
    let isRequired: boolean = await ProjectService.getRequireSsoForLogin(
      data.projectId,
    );

    if (!isRequired && !data.isMasterAdmin) {
      isRequired = await GlobalConfigService.getRequireSsoForLogin().catch(
        () => {
          return false;
        },
      );
    }

    if (!isRequired) {
      return { isRequired: false, requiredSsoProviderId: null };
    }

    const requiredSsoProviderId: ObjectID | null =
      await ProjectService.getRequireSsoWithSsoProviderId(data.projectId).catch(
        () => {
          return null;
        },
      );

    return { isRequired: true, requiredSsoProviderId };
  }

  /*
   * What this browser request can show for SSO in this project, or null if it
   * does not satisfy the requirement.
   *
   * Asked in the same order as UserMiddleware.isSsoSatisfiedForProject: the
   * project's own token first (which also has to be vouched for, still, by
   * the provider that gave it), then the instance's Global one (which also
   * has to pass the provider-trust and project-governance checks).
   */
  public static async captureEvidence(data: {
    req: ExpressRequest;
    projectId: ObjectID;
    userId: ObjectID;
    requiredSsoProviderId: ObjectID | null;
  }): Promise<McpOAuthGrantSsoEvidence | null> {
    const requiredSsoProviderId: ObjectID | undefined =
      data.requiredSsoProviderId ?? undefined;

    const projectSsoSignIn: ProjectScopedSsoSignIn | null =
      UserMiddleware.getStatelessValidProjectScopedSsoSignIn(
        data.req,
        data.projectId,
        data.userId,
        requiredSsoProviderId,
      );

    if (
      projectSsoSignIn &&
      (await UserMiddleware.isProjectScopedSsoSignInAuthorizedForProject({
        ssoProviderType: projectSsoSignIn.tokenData.ssoProviderType,
        ssoProviderId: projectSsoSignIn.tokenData.ssoProviderId,
        issuedAtMs: projectSsoSignIn.issuedAtMs,
        projectId: data.projectId,
      }))
    ) {
      const rawToken: string | undefined = UserMiddleware.getSsoTokens(
        data.req,
      )[data.projectId.toString()];

      return McpOAuthSso.toEvidence(rawToken);
    }

    const globalSsoTokenData: JSONWebTokenData | null =
      UserMiddleware.getStatelessValidGlobalSsoTokenData(
        data.req,
        data.userId,
        requiredSsoProviderId,
      );

    if (!globalSsoTokenData) {
      return null;
    }

    if (
      !(await UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
        globalSsoTokenData,
        projectId: data.projectId,
      }))
    ) {
      return null;
    }

    return McpOAuthSso.toEvidence(McpOAuthSso.getRawGlobalSsoToken(data.req));
  }

  /*
   * Whether a grant's stored evidence still satisfies the project's SSO
   * requirement. No evidence never does.
   *
   * THROWS when a provider's standing cannot be looked up, for the reason
   * isGlobalSsoTokenAuthorizedForProject does: "this provider is not
   * allowed here" and "we could not find out" are different answers, and a
   * database blip must not read as a permission decision.
   */
  public static async isEvidenceSatisfied(data: {
    evidence: McpOAuthGrantSsoEvidence | null;
    projectId: ObjectID;
    requiredSsoProviderId: ObjectID | null;
    now?: Date | undefined;
  }): Promise<boolean> {
    const evidence: McpOAuthGrantSsoEvidence | null = data.evidence;

    if (!evidence) {
      return false;
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    if (new Date(evidence.expiresAt).getTime() <= now.getTime()) {
      return false;
    }

    if (data.requiredSsoProviderId) {
      if (
        !evidence.ssoProviderId ||
        evidence.ssoProviderId.toString() !==
          data.requiredSsoProviderId.toString()
      ) {
        return false;
      }
    }

    const isGlobalProvider: boolean =
      evidence.ssoProviderType === SsoProviderType.GlobalSSO ||
      evidence.ssoProviderType === SsoProviderType.GlobalOIDC;

    if (!isGlobalProvider) {
      /*
       * A project's own provider has to vouch for the sign-in still, as it
       * does for a browser's token: still there, still the project's, on,
       * and turned off no later than the sign-in was copied onto the grant -
       * the sign-in was given before then
       * (UserMiddleware.isProjectScopedSsoSignInAuthorizedForProject).
       */
      return await UserMiddleware.isProjectScopedSsoSignInAuthorizedForProject(
        {
          ssoProviderType: evidence.ssoProviderType,
          ssoProviderId: evidence.ssoProviderId,
          issuedAtMs: evidence.capturedAt
            ? new Date(evidence.capturedAt).getTime()
            : null,
          projectId: data.projectId,
        },
      );
    }

    /*
     * A Global sign-in is only as good as its provider is today: still
     * present, still enabled, and - if the instance restricts it - still
     * governing this project. The check reads only the two provider fields.
     */
    return await UserMiddleware.isGlobalSsoTokenAuthorizedForProject({
      globalSsoTokenData: {
        ssoProviderType: evidence.ssoProviderType,
        ssoProviderId: evidence.ssoProviderId ?? undefined,
      } as unknown as JSONWebTokenData,
      projectId: data.projectId,
    });
  }

  /*
   * The provider fields and the expiry of a raw SSO token. null if the token
   * is missing, no longer verifies, or carries no expiry - evidence that
   * cannot say when it lapses is no evidence.
   */
  private static toEvidence(
    rawToken: string | undefined,
  ): McpOAuthGrantSsoEvidence | null {
    if (!rawToken) {
      return null;
    }

    let payload: JSONObject;

    try {
      payload = JSONWebToken.decodeJsonPayload(rawToken);
    } catch {
      return null;
    }

    const expiresAtSeconds: unknown = payload["exp"];

    if (typeof expiresAtSeconds !== "number" || !isFinite(expiresAtSeconds)) {
      return null;
    }

    const ssoProviderType: SsoProviderType | undefined = payload[
      "ssoProviderType"
    ] as SsoProviderType | undefined;

    if (
      !ssoProviderType ||
      !Object.values(SsoProviderType).includes(ssoProviderType)
    ) {
      return null;
    }

    const ssoProviderId: unknown = payload["ssoProviderId"];

    return {
      ssoProviderType,
      ssoProviderId:
        typeof ssoProviderId === "string" && ObjectID.isValidUUID(ssoProviderId)
          ? new ObjectID(ssoProviderId)
          : null,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  // The cookie (web) or header (mobile) UserMiddleware reads the token from.
  private static getRawGlobalSsoToken(req: ExpressRequest): string | undefined {
    const cookieToken: string | undefined =
      CookieUtil.getCookieFromExpressRequest(req, CookieUtil.getGlobalSSOKey());

    if (cookieToken) {
      return cookieToken;
    }

    const headerToken: unknown = req.headers[GLOBAL_SSO_TOKEN_HEADER];

    return typeof headerToken === "string" && headerToken
      ? headerToken
      : undefined;
  }
}
