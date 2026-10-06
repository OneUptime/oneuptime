import McpOAuthConfig from "./McpOAuthConfig";
import McpOAuthSso, { McpOAuthSsoRequirement } from "./McpOAuthSso";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import AccessTokenService from "../../Services/AccessTokenService";
import { McpOAuthGrantSsoEvidence } from "../../Services/McpOAuthGrantService";
import UserService from "../../Services/UserService";
import McpOAuthGrant from "../../../Models/DatabaseModels/McpOAuthGrant";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "../../../Types/Mcp/McpOAuthScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";

/*
 * "May this grant be used right now, and as whom?"
 *
 * Asked on every MCP request a connected client makes and on every token it
 * exchanges, because a grant is a standing permission and everything it
 * rests on can change while it stands: the member can be blocked or removed
 * from the project, an administrator can block their team from connecting
 * clients, the project can start requiring single sign-on, the SSO sign-in
 * the grant was approved under can lapse. None of those touch the grant row,
 * so none of them can be left to it.
 *
 * Every refusal is a reason rather than a boolean, because the two callers
 * answer them differently (an MCP request gets a challenge, a token exchange
 * gets `invalid_grant`) and because the consent screen has to be able to tell
 * a member WHY a project cannot be chosen.
 */

export enum McpOAuthGrantRefusal {
  // The instance has OAuth for the MCP server turned off.
  OAuthDisabled = "oauth-disabled",

  // The member approved, but the client never collected its tokens.
  NotActivated = "not-activated",

  // Unused for longer than a refresh token lasts.
  Expired = "expired",

  // Issued for a different MCP endpoint than the one it is presented at.
  WrongResource = "wrong-resource",

  // The account is gone or has been blocked.
  UserUnavailable = "user-unavailable",

  // The member no longer belongs to the project.
  NotAProjectMember = "not-a-project-member",

  // A team the member is in blocks AuthorizeMcpClient.
  BlockedByPermission = "blocked-by-permission",

  // The project requires SSO and the grant cannot show a current sign-in.
  SsoRequired = "sso-required",
}

export interface McpOAuthGrantUser {
  id: ObjectID;
  email: Email;
  name: string;
  isMasterAdmin: boolean;
}

export interface McpOAuthPrincipal {
  grant: McpOAuthGrant;
  user: McpOAuthGrantUser;
  scopes: Array<McpOAuthScope>;
}

export type McpOAuthGrantAccessResult =
  | { isAllowed: true; principal: McpOAuthPrincipal }
  | { isAllowed: false; refusal: McpOAuthGrantRefusal };

interface CachedUser {
  email: string;
  name: string;
  isMasterAdmin: boolean;
}

/*
 * How long a member's name, address and master-admin flag are remembered per
 * node. They only label the request (audit trail, the instance-wide SSO
 * exemption) and change rarely; whether the member is BLOCKED is not read
 * from here - UserService.isUserBlocked keeps its own, invalidated, cache.
 */
const USER_CACHE_TTL_MS: number = 60 * 1000;

export default class McpOAuthGrantAccess {
  private static userCache: InMemoryTTLCache<CachedUser | null> =
    new InMemoryTTLCache(10_000);

  public static clearCache(): void {
    McpOAuthGrantAccess.userCache.clear();
  }

  /*
   * The whole decision for a grant the caller has already looked up.
   *
   * `requireActivated` is false only for the one caller that exists to
   * activate a grant: the exchange of its authorization code.
   */
  public static async evaluate(data: {
    grant: McpOAuthGrant;
    requireActivated?: boolean | undefined;
    now?: Date | undefined;
  }): Promise<McpOAuthGrantAccessResult> {
    const grant: McpOAuthGrant = data.grant;

    if (!McpOAuthConfig.isEnabled()) {
      return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.OAuthDisabled);
    }

    if (!grant.id || !grant.userId || !grant.projectId) {
      return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.NotActivated);
    }

    if (data.requireActivated !== false && !grant.activatedAt) {
      return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.NotActivated);
    }

    if (
      !grant.expiresAt ||
      new Date(grant.expiresAt).getTime() <= (data.now || new Date()).getTime()
    ) {
      return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.Expired);
    }

    /*
     * A token is only good at the endpoint it was issued for. The resource is
     * derived from HOST, so this fails when an instance is moved to a new
     * hostname - and it should: those grants were made out to the old one.
     */
    if (!McpOAuthConfig.isThisResource(grant.resource)) {
      return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.WrongResource);
    }

    const user: McpOAuthGrantUser | null = await McpOAuthGrantAccess.getUser(
      grant.userId,
    );

    if (!user) {
      return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.UserUnavailable);
    }

    if (await UserService.isUserBlocked(grant.userId)) {
      return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.UserUnavailable);
    }

    const refusal: McpOAuthGrantRefusal | null =
      await McpOAuthGrantAccess.getProjectRefusal({
        userId: grant.userId,
        projectId: grant.projectId,
      });

    if (refusal) {
      return McpOAuthGrantAccess.refuse(refusal);
    }

    const ssoRequirement: McpOAuthSsoRequirement =
      await McpOAuthSso.getRequirement({
        projectId: grant.projectId,
        isMasterAdmin: user.isMasterAdmin,
      });

    if (ssoRequirement.isRequired) {
      const isSatisfied: boolean = await McpOAuthSso.isEvidenceSatisfied({
        evidence: McpOAuthGrantAccess.getSsoEvidence(grant),
        projectId: grant.projectId,
        requiredSsoProviderId: ssoRequirement.requiredSsoProviderId,
        now: data.now,
      });

      if (!isSatisfied) {
        return McpOAuthGrantAccess.refuse(McpOAuthGrantRefusal.SsoRequired);
      }
    }

    return {
      isAllowed: true,
      principal: {
        grant,
        user,
        scopes: McpOAuthScopeUtil.parse(grant.scope).scopes,
      },
    };
  }

  /*
   * The two things about a member's standing in a project that decide
   * whether they may connect a client to it at all, shared by the consent
   * screen (before a grant exists) and by evaluate() (for one that does).
   *
   * Membership is read from the same permission set every API request is
   * authorized with. The block is the governance lever: connecting a client
   * needs no grant of AuthorizeMcpClient - every member may - but a BLOCK row
   * for it on any of the member's teams refuses them, read by the rule every
   * permission check follows (HeldPermissionsUtil). Labels on that row are
   * ignored, because a grant has no labels for them to select.
   */
  public static async getProjectRefusal(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<McpOAuthGrantRefusal | null> {
    const tenantPermission: UserTenantAccessPermission | null =
      await AccessTokenService.getUserTenantAccessPermission(
        data.userId,
        data.projectId,
      );

    if (!tenantPermission) {
      return McpOAuthGrantRefusal.NotAProjectMember;
    }

    const isBlocked: boolean = HeldPermissionsUtil.isBlockedFromAny(
      HeldPermissionsUtil.fromRows({ rows: tenantPermission.permissions }),
      [Permission.AuthorizeMcpClient],
      { labelledBlocksRefuse: true },
    );

    if (isBlocked) {
      return McpOAuthGrantRefusal.BlockedByPermission;
    }

    return null;
  }

  public static getSsoEvidence(
    grant: McpOAuthGrant,
  ): McpOAuthGrantSsoEvidence | null {
    if (!grant.ssoProviderType || !grant.ssoExpiresAt) {
      return null;
    }

    return {
      ssoProviderType: grant.ssoProviderType,
      ssoProviderId: grant.ssoProviderId || null,
      expiresAt: new Date(grant.ssoExpiresAt),
    };
  }

  /*
   * Who a user id is, or null when there is no such account. Cached briefly:
   * see USER_CACHE_TTL_MS for what is, and is not, read from the cache.
   */
  public static async getUser(
    userId: ObjectID,
  ): Promise<McpOAuthGrantUser | null> {
    const key: string = userId.toString();

    let cached: CachedUser | null | undefined =
      McpOAuthGrantAccess.userCache.get(key);

    if (cached === undefined) {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          _id: true,
          email: true,
          name: true,
          isMasterAdmin: true,
        },
        props: {
          isRoot: true,
        },
      });

      cached =
        user && user.email
          ? {
              email: user.email.toString(),
              name: user.name?.toString() || "",
              isMasterAdmin: Boolean(user.isMasterAdmin),
            }
          : null;

      McpOAuthGrantAccess.userCache.set(key, cached, USER_CACHE_TTL_MS);
    }

    if (!cached) {
      return null;
    }

    return {
      id: userId,
      email: new Email(cached.email),
      name: cached.name,
      isMasterAdmin: cached.isMasterAdmin,
    };
  }

  private static refuse(
    refusal: McpOAuthGrantRefusal,
  ): McpOAuthGrantAccessResult {
    return { isAllowed: false, refusal };
  }
}
