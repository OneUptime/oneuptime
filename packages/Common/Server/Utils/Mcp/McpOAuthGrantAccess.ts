import McpOAuthConfig from "./McpOAuthConfig";
import McpOAuthSso, { McpOAuthSsoRequirement } from "./McpOAuthSso";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import AccessTokenService from "../../Services/AccessTokenService";
import { McpOAuthGrantSsoEvidence } from "../../Services/McpOAuthGrantService";
import ProjectService from "../../Services/ProjectService";
import UserService from "../../Services/UserService";
import ProjectMembership from "../TeamMember/ProjectMembership";
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
 * from the project, a master admin can block the project itself, an
 * administrator can block their team from connecting clients, the project
 * can start requiring single sign-on, the SSO sign-in the grant was
 * approved under can lapse. None of those but leaving the
 * project touch the grant row (leaving removes it), and none of them can be
 * left to it: each is checked here, on every use.
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

  // A master admin blocked the project (Admin Dashboard > Projects).
  ProjectBlocked = "project-blocked",

  // A team the member is in blocks AuthorizeMcpClient.
  BlockedByPermission = "blocked-by-permission",

  // The project requires SSO and the grant cannot show a current sign-in.
  SsoRequired = "sso-required",
}

// Who a grant's member is: what labels the requests they make (getUser).
export interface McpOAuthGrantMember {
  id: ObjectID;
  email: Email;
  name: string;
}

/*
 * The member a grant acts for, and whether they are a master admin now -
 * read from their account on every use (evaluate), never from the labels.
 */
export interface McpOAuthGrantUser extends McpOAuthGrantMember {
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
}

/*
 * How long a member's name and address are remembered per node. They only
 * label the request (the audit trail) and change rarely. Whether the member
 * is BLOCKED, or a MASTER ADMIN (the instance-wide SSO exemption), is not
 * read from here: UserService.isUserBlocked and isUserMasterAdmin keep their
 * own cache, which a change to either forgets on every server.
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

    const member: McpOAuthGrantMember | null =
      await McpOAuthGrantAccess.getUser(grant.userId);

    if (!member) {
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

    /*
     * Whether the member is a master admin now - which exempts them from the
     * server's Require SSO - read the way every session's request reads it
     * (UserService.isUserMasterAdmin): from the same row read as whether they
     * are blocked, and forgotten on every server the moment another master
     * admin removes the access. Never from the labels getUser keeps for a
     * minute.
     */
    const isMasterAdmin: boolean = await UserService.isUserMasterAdmin(
      grant.userId,
    );

    const ssoRequirement: McpOAuthSsoRequirement =
      await McpOAuthSso.getRequirement({
        projectId: grant.projectId,
        isMasterAdmin: isMasterAdmin,
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
        user: { ...member, isMasterAdmin: isMasterAdmin },
        scopes: McpOAuthScopeUtil.parse(grant.scope).scopes,
      },
    };
  }

  /*
   * The two things about a member's standing in a project that decide
   * whether they may connect a client to it at all, shared by the consent
   * screen (before a grant exists) and by evaluate() (for one that does).
   *
   * Membership is read from the database (ProjectMembership: an accepted
   * membership of a team of the project) on every use, and from the
   * permission set every API request is authorized with. A grant is a
   * standing credential: a permission set cached while the person was a
   * member, and not yet rebuilt, must never stand in for a membership that
   * has gone. Somebody who has left is refused as if there were no grant at
   * all - and leaving removes their grants too (ProjectLeaveAccessCleanup).
   *
   * The block is the governance lever: connecting a client needs no grant of
   * AuthorizeMcpClient - every member may - but a BLOCK row for it on any of
   * the member's teams refuses them, read by the rule every permission check
   * follows (HeldPermissionsUtil). Labels on that row are ignored, because a
   * grant has no labels for them to select.
   *
   * A project a master admin blocked is refused to every member, master
   * admins included: a client acts as the member, never as a master admin
   * (McpDelegationAuthorization). Asked after membership, so somebody who
   * is not a member is told only that.
   */
  public static async getProjectRefusal(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<McpOAuthGrantRefusal | null> {
    if (
      !(await ProjectMembership.isMember({
        projectId: data.projectId,
        userId: data.userId,
      }))
    ) {
      return McpOAuthGrantRefusal.NotAProjectMember;
    }

    if (await ProjectService.isProjectBlocked(data.projectId)) {
      return McpOAuthGrantRefusal.ProjectBlocked;
    }

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
      capturedAt: grant.createdAt ? new Date(grant.createdAt) : undefined,
    };
  }

  /*
   * Who a user id is, or null when there is no such account: the name and
   * address that label their requests. Cached briefly: see
   * USER_CACHE_TTL_MS for what is, and is not, read from the cache.
   */
  public static async getUser(
    userId: ObjectID,
  ): Promise<McpOAuthGrantMember | null> {
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
    };
  }

  private static refuse(
    refusal: McpOAuthGrantRefusal,
  ): McpOAuthGrantAccessResult {
    return { isAllowed: false, refusal };
  }
}
