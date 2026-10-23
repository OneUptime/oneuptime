/*
 * WHERE MICROSOFT SIGNS PEOPLE IN FOR MICROSOFT TEAMS.
 *
 * A Microsoft sign-in URL names an authority: one tenant
 * (login.microsoftonline.com/<tenant>/...), or an endpoint for every
 * organization - `organizations` (any work or school account) and `common`
 * (personal accounts too), which Microsoft documents for multitenant apps.
 * An app registered for one organization - "Accounts in this organizational
 * directory only (Single tenant)", what the self-hosted guide asks for - is
 * refused at `common` with AADSTS50194 ("Usage of the /common endpoint is
 * not supported for such applications").
 *
 * "Connect my account with Microsoft Teams", and the Connect button the bot
 * answers an unconnected account with, used to sign in at `common`. So on a
 * server set up the way the guide says, admin consent worked (it signs in at
 * the tenant) and nobody could connect their own account: issue #5202, and
 * #3114 before it.
 *
 * The account a person connects has to be the one the bot sees when they
 * write to it in the project's Microsoft Teams: their account in the
 * project's organization. For a guest, that is the guest account the
 * organization holds for them, whose object id is not their home
 * organization's - and `common` signs a guest in to their home organization.
 * So the sign-in goes to the project's organization, in this order:
 *
 *  1. The tenant the project is connected to: the one admin consent proved
 *     with an ID token and bound to it (WorkspaceProjectAuthToken
 *     .workspaceProjectId). With a single-tenant app it is the tenant the app
 *     is registered in, the only one consent succeeds in; with a multitenant
 *     app (OneUptime Cloud) it is each customer's own. Its members and
 *     guests sign in; anybody else is refused by Microsoft.
 *  2. A project not connected yet has no tenant of its own: the tenant the
 *     app is registered in (MICROSOFT_TEAMS_APP_TENANT_ID), the only tenant a
 *     single-tenant app takes. The Dashboard only offers the sign-in once
 *     the project is connected, so this is for a sign-in started some other
 *     way.
 *  3. Nothing names a tenant: Microsoft's endpoint for a work or school
 *     account of any organization, which is for multitenant apps.
 *
 * The authority is chosen once, when the sign-in starts, and pinned to its
 * state (WorkspaceOAuthState.tenantId): the callback exchanges the code at
 * the authority that issued it, and never chooses again.
 *
 * Admin consent has its own authorities (MicrosoftTeamsAPI): consent at the
 * project's tenant or `organizations`, then a sign-in at the tenant consent
 * named, which its ID token must prove.
 */

export const MICROSOFT_LOGIN_ORIGIN: string =
  "https://login.microsoftonline.com";

// Microsoft's endpoint for a work or school account of any organization.
export const MICROSOFT_ANY_ORGANIZATION: string = "organizations";

// A Microsoft Entra tenant id is a GUID.
const ENTRA_TENANT_ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * A tenant may also be named by one of its domains (contoso.onmicrosoft.com),
 * which Microsoft's authorities take as well: labels of letters, digits and
 * hyphens, at least two of them. The dot that separates two labels is not in
 * a label's class, so the pattern is linear.
 */
const TENANT_DOMAIN_PATTERN: RegExp = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

// Longer than any domain name can be (253 characters).
const MAX_TENANT_LENGTH: number = 253;

// What named the tenant a sign-in goes to.
export enum MicrosoftTeamsSignInAuthoritySource {
  // The tenant admin consent connected the project to.
  ProjectTenant = "ProjectTenant",
  // MICROSOFT_TEAMS_APP_TENANT_ID: the tenant the app is registered in.
  AppTenant = "AppTenant",
  // Nothing: Microsoft's endpoint for any organization.
  AnyOrganization = "AnyOrganization",
}

export interface MicrosoftTeamsSignInAuthority {
  /*
   * The tenant the sign-in is pinned to, in lower case; undefined when it
   * goes to Microsoft's endpoint for any organization.
   */
  tenantId: string | undefined;
  source: MicrosoftTeamsSignInAuthoritySource;
}

export default class MicrosoftTeamsSignInAuthorityUtil {
  // Whether `value` is a Microsoft Entra tenant id (a GUID).
  public static isTenantId(value: unknown): value is string {
    return typeof value === "string" && ENTRA_TENANT_ID_PATTERN.test(value);
  }

  /*
   * The tenant `value` names - a tenant id, or one of the tenant's domain
   * names - in lower case and trimmed. Null for anything else: nothing, the
   * words for Microsoft's endpoints for every organization (`common`,
   * `organizations`, `consumers`, none of which is a tenant), or text that
   * could not be a tenant at all.
   */
  public static readTenant(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const tenant: string = value.trim().toLowerCase();

    if (!tenant || tenant.length > MAX_TENANT_LENGTH) {
      return null;
    }

    if (
      MicrosoftTeamsSignInAuthorityUtil.isTenantId(tenant) ||
      TENANT_DOMAIN_PATTERN.test(tenant)
    ) {
      return tenant;
    }

    return null;
  }

  /*
   * Where "Connect my account with Microsoft Teams" signs a member of a
   * project in: the tenant the project is connected to, else the tenant the
   * app is registered in, else Microsoft's endpoint for any organization.
   */
  public static choose(data: {
    // The project's Microsoft Teams connection's tenant, if it has one.
    projectTenantId: unknown;
    // MICROSOFT_TEAMS_APP_TENANT_ID.
    appTenantId: unknown;
  }): MicrosoftTeamsSignInAuthority {
    const projectTenantId: string | null =
      MicrosoftTeamsSignInAuthorityUtil.readTenant(data.projectTenantId);

    if (projectTenantId) {
      return {
        tenantId: projectTenantId,
        source: MicrosoftTeamsSignInAuthoritySource.ProjectTenant,
      };
    }

    const appTenantId: string | null =
      MicrosoftTeamsSignInAuthorityUtil.readTenant(data.appTenantId);

    if (appTenantId) {
      return {
        tenantId: appTenantId,
        source: MicrosoftTeamsSignInAuthoritySource.AppTenant,
      };
    }

    return {
      tenantId: undefined,
      source: MicrosoftTeamsSignInAuthoritySource.AnyOrganization,
    };
  }

  /*
   * The authority's path segment: the tenant a sign-in is pinned to, or
   * Microsoft's endpoint for any organization when it is pinned to none. A
   * value that is not a tenant never becomes a path.
   */
  public static getAuthority(tenantId: string | undefined): string {
    return (
      MicrosoftTeamsSignInAuthorityUtil.readTenant(tenantId) ||
      MICROSOFT_ANY_ORGANIZATION
    );
  }

  // Microsoft's authorize endpoint at that authority.
  public static getAuthorizeUrl(tenantId: string | undefined): string {
    return `${MicrosoftTeamsSignInAuthorityUtil.getAuthorityUrl(tenantId)}/oauth2/v2.0/authorize`;
  }

  /*
   * Microsoft's token endpoint at that authority: where a code from its
   * authorize endpoint is exchanged, and only there.
   */
  public static getTokenUrl(tenantId: string | undefined): string {
    return `${MicrosoftTeamsSignInAuthorityUtil.getAuthorityUrl(tenantId)}/oauth2/v2.0/token`;
  }

  // Who signs an ID token issued by `tenantId` (Microsoft identity platform v2.0).
  public static getIssuer(tenantId: string): string {
    return `${MICROSOFT_LOGIN_ORIGIN}/${tenantId}/v2.0`;
  }

  /*
   * Whether a sign-in pinned to `signedInTo` is for another tenant than the
   * one the project is connected to now: the project was disconnected and
   * connected to another organization while the person was signing in.
   * Only two tenant ids can be told apart: a sign-in pinned to no tenant, or
   * to a domain name (which may well be the same tenant's), and a project
   * with no tenant, are not.
   */
  public static isOtherTenant(data: {
    signedInTo: string | undefined;
    projectTenantId: unknown;
  }): boolean {
    const signedInTo: string | null =
      MicrosoftTeamsSignInAuthorityUtil.readTenant(data.signedInTo);
    const projectTenantId: string | null =
      MicrosoftTeamsSignInAuthorityUtil.readTenant(data.projectTenantId);

    return (
      MicrosoftTeamsSignInAuthorityUtil.isTenantId(signedInTo) &&
      MicrosoftTeamsSignInAuthorityUtil.isTenantId(projectTenantId) &&
      signedInTo !== projectTenantId
    );
  }

  private static getAuthorityUrl(tenantId: string | undefined): string {
    return `${MICROSOFT_LOGIN_ORIGIN}/${encodeURIComponent(
      MicrosoftTeamsSignInAuthorityUtil.getAuthority(tenantId),
    )}`;
  }
}
