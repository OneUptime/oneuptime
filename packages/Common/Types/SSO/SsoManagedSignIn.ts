/*
 * SIGN-IN YOUR ORGANIZATION MANAGES, AND THE LOCAL SETTINGS IT TAKES OFF
 * USER PROFILE > SECURITY (issue #9688).
 *
 * While the whole server requires single sign-on (Admin Dashboard > Settings >
 * Single Sign-On > Require SSO to Sign In, GlobalConfig.requireSsoForLogin),
 * the server refuses every sign-in that is not SSO for everyone but master
 * admins (Common/Server/Utils/SsoRequiredSignIn): a password and the second
 * steps after it, an emailed link, a passkey, Sign in with Google or
 * Microsoft. For those people sign-in is managed by their organization's
 * identity provider, and the settings under User Profile > Security do
 * nothing for them:
 *
 *   - a password, a passkey or a security key never signs them in. Set now,
 *     it would lie there until the requirement was turned off, then work: a
 *     way in that the identity provider - which may since have removed the
 *     person - knows nothing about;
 *   - two-factor authentication, its authenticator apps and its backup codes
 *     only ever guard a password or an emailed link.
 *
 * So OneUptime does not offer them those settings (User Profile shows who
 * manages their sign-in instead, and its side menu has no Security section),
 * and the server refuses to set any of them, however it is asked: a new
 * password from the profile, a passkey or a security key, an authenticator
 * app, turning two-factor authentication on, and new backup codes. Forgot
 * password mails them no link. Taking something away stays allowed:
 * removing what can only lie dormant does no harm.
 *
 * WHO IT COVERS, EXACTLY: everyone who is not a master admin, while the
 * server requires SSO - the people the server already refuses every other
 * sign-in for. Nobody else:
 *
 *   - master admins are exempt, as they are at sign-in: their password at
 *     /accounts/admin-login is how a server whose identity provider stops
 *     working gets its requirement turned off. Their own settings, and the
 *     Admin Dashboard's (Set Password, a password link, Require or Reset
 *     two-factor authentication), are theirs to use for anyone;
 *   - a project's own Require SSO to Sign In is not enough. A password or a
 *     passkey still signs its members in to OneUptime - only that project
 *     asks for its SSO - so it is a working credential they must be able to
 *     change, or remove when it leaks; and they may be in, or create,
 *     projects that let them in without SSO;
 *   - how an account was made is not a rule. Single sign-on and SCIM make an
 *     account with a random password nobody knows, as an invitation makes
 *     one with none, and nothing records which made it.
 *
 * WHAT IT DOES NOT CHANGE: what someone set before the server required SSO
 * stays as it is, and no sign-in changes. It already signs nobody in while
 * the requirement is on (SsoRequiredSignIn), and works again if a master
 * admin turns the requirement off - the documented way back in when the
 * identity provider is down. Deleting it instead would make that way back
 * a lockout.
 *
 * React-free and server-safe: the API, the Dashboard and their tests read it.
 */

// What GET /user/sign-in-management answers for the signed-in person.
export interface SignInManagement {
  // Their organization manages how they sign in (see above).
  isManagedBySso: boolean;
  /*
   * The names of the server's single sign-on providers that are on, as the
   * sign-in page lists them, when isManagedBySso: the providers the profile
   * names. Empty otherwise, and when none is on.
   */
  ssoProviderNames: Array<string>;
}

// Under the API's address (APP_API_URL), for the signed-in person.
export const SIGN_IN_MANAGEMENT_API_ROUTE: string = "/user/sign-in-management";

/*
 * What a write the rule refuses is told: a new password, a passkey or a
 * security key, an authenticator app, turning two-factor authentication on,
 * new backup codes. The pages do not offer them, so it is read by somebody
 * who asked the API, or whose server turned the requirement on while their
 * page was open.
 */
export const SSO_MANAGED_SIGN_IN_MESSAGE: string =
  "This server signs you in with single sign-on (SSO), so your password, passkeys and two factor authentication are managed by your identity provider, not by OneUptime.";

/*
 * The most names an answer carries, and the most of each: the sign-in page
 * lists a handful of providers, and a name is a few words. Only keeps a
 * broken or forged answer from drawing a wall of text.
 */
export const MAX_SSO_PROVIDER_NAMES: number = 10;
export const MAX_SSO_PROVIDER_NAME_LENGTH: number = 100;

export default class SignInManagementUtil {
  /*
   * A provider's name as the profile draws it: trimmed and cut to length,
   * or "" when it is not one.
   */
  public static readProviderName(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    return value.trim().slice(0, MAX_SSO_PROVIDER_NAME_LENGTH);
  }

  /*
   * The providers' names an answer may carry: each one once, none empty, at
   * most MAX_SSO_PROVIDER_NAMES, in the order given.
   */
  public static readProviderNames(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const names: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      const name: string = SignInManagementUtil.readProviderName(item);

      if (!name || seen.has(name.toLowerCase())) {
        continue;
      }

      seen.add(name.toLowerCase());
      names.push(name);

      if (names.length >= MAX_SSO_PROVIDER_NAMES) {
        break;
      }
    }

    return names;
  }

  /*
   * The answer of GET /user/sign-in-management, or null when it is not one
   * (a failed read, a proxy's page). The profile then shows the settings,
   * as it does for everyone who is not covered: the server still refuses
   * what it must.
   */
  public static parse(value: unknown): SignInManagement | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const answer: Record<string, unknown> = value as Record<string, unknown>;

    if (typeof answer["isManagedBySso"] !== "boolean") {
      return null;
    }

    const isManagedBySso: boolean = answer["isManagedBySso"];

    return {
      isManagedBySso: isManagedBySso,
      ssoProviderNames: isManagedBySso
        ? SignInManagementUtil.readProviderNames(answer["ssoProviderNames"])
        : [],
    };
  }
}
