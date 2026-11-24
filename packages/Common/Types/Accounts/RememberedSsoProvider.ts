import ObjectID from "../ObjectID";
import SsoProviderType from "../SSO/SsoProviderType";

/*
 * THE PROJECT SSO PROVIDER THIS BROWSER LAST SIGNED IN WITH (#9986).
 *
 * "Sign in with SSO" (/accounts/sso) finds a project's providers by the
 * typed address's verified domain alone (#9824), so somebody whose address
 * is on another domain - a contractor at gmail.com in Acme's project - finds
 * nothing there, and comes in through the project's SSO sign-in link
 * (/accounts/sso/<project id>, #9918) every time. So when a person picks a
 * project's provider on either page, the Accounts app remembers which one,
 * in this browser alone, and "Sign in with SSO" offers it first, one click
 * to its sign-in, with a way to forget it.
 *
 * What is kept, and nothing more: the provider's kind (a project's SAML or
 * OIDC), its id and its project's id. Never the address typed, never a
 * name, never anything the server said about an account: the ids are the
 * ones in the project's public SSO sign-in link and in the provider URLs its
 * identity provider is given. The provider's name and description are read
 * from the server each time the page offers it (GET /identity/
 * project-sign-in-methods/<project id>, which asks no address), so the page
 * offers only a provider that is still there and still on, under its
 * current name: one removed, turned off, or no longer offered to the
 * project's people (a project that requires one provider) is forgotten
 * instead.
 *
 * Kept after sign-out (UI/Utils/KeptAfterSignOut.ts): the sign-in page reads
 * it when nobody is signed in - after a sign-out or a session that lapsed is
 * exactly when it is for - and it names nobody. Whoever uses the browser
 * next sees which organization's provider it last signed in with, and
 * forgets it in a click.
 */

// The browser's local storage key. Names nobody: no user, project or id in it.
export const REMEMBERED_SSO_PROVIDER_KEY: string =
  "oneuptime-sign-in-sso-last-used";

// The shape's version, so a later release can read an older value or drop it.
const STORED_VERSION: number = 1;

export type RememberedSsoProviderType =
  | SsoProviderType.ProjectSSO
  | SsoProviderType.ProjectOIDC;

export interface RememberedSsoProvider {
  type: RememberedSsoProviderType;
  providerId: string;
  projectId: string;
}

const STORED_KEYS: Array<string> = ["v", "type", "providerId", "projectId"];

// The longest value read back: a well-formed one is about 130 characters.
const MAX_STORED_LENGTH: number = 512;

export default class RememberedSsoProviderUtil {
  // Whether a provider of this kind is one this page remembers: a project's.
  public static isRememberedType(
    type: unknown,
  ): type is RememberedSsoProviderType {
    return (
      type === SsoProviderType.ProjectSSO ||
      type === SsoProviderType.ProjectOIDC
    );
  }

  /*
   * What is written to the browser for a provider picked for a project, or
   * null for anything the page does not remember: an instance-wide provider
   * (the page lists those anyway), or ids that are not ids.
   */
  public static toStoredValue(data: {
    type: unknown;
    providerId: string;
    projectId: string | undefined;
  }): string | null {
    if (
      !RememberedSsoProviderUtil.isRememberedType(data.type) ||
      !data.projectId ||
      !ObjectID.isValidUUID(data.providerId) ||
      !ObjectID.isValidUUID(data.projectId)
    ) {
      return null;
    }

    return JSON.stringify({
      v: STORED_VERSION,
      type: data.type,
      providerId: data.providerId.toLowerCase(),
      projectId: data.projectId.toLowerCase(),
    });
  }

  /*
   * The provider a stored value names, or null when it is anything else: a
   * value an older or newer release wrote, one edited by hand, one with a
   * field more or less. Nothing found in the browser is trusted further
   * than that: the page asks the server about the project before it offers
   * anything.
   */
  public static fromStoredValue(value: unknown): RememberedSsoProvider | null {
    if (typeof value !== "string" || value.length > MAX_STORED_LENGTH) {
      return null;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const stored: Record<string, unknown> = parsed as Record<string, unknown>;
    const keys: Array<string> = Object.keys(stored).sort();

    if (keys.join(",") !== [...STORED_KEYS].sort().join(",")) {
      return null;
    }

    const providerId: unknown = stored["providerId"];
    const projectId: unknown = stored["projectId"];

    if (
      stored["v"] !== STORED_VERSION ||
      !RememberedSsoProviderUtil.isRememberedType(stored["type"]) ||
      typeof providerId !== "string" ||
      typeof projectId !== "string" ||
      !ObjectID.isValidUUID(providerId) ||
      !ObjectID.isValidUUID(projectId)
    ) {
      return null;
    }

    return {
      type: stored["type"],
      providerId: providerId.toLowerCase(),
      projectId: projectId.toLowerCase(),
    };
  }
}
