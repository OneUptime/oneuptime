import ObjectID from "../ObjectID";
import { isDefaultSsoProviderDescription } from "./SsoProviderDefaults";
import SsoProviderType from "./SsoProviderType";

/*
 * HOW THIS SERVER SIGNS PEOPLE IN, as its sign-in pages read it.
 *
 * GET /identity/sign-in-methods (App/FeatureSet/Identity/API/SignInMethods.ts)
 * answers the Accounts pages: whether the whole server requires single
 * sign-on (Admin Dashboard > Settings > Single Sign-On > Require SSO for
 * Login, GlobalConfig.requireSsoForLogin), the instance-wide SSO providers
 * that are on, and - only while SSO is required - whether any project has a
 * provider of its own that is on.
 *
 * While SSO is required, the sign-in pages offer only SSO: a button for each
 * instance-wide provider, and the "your organization's email" lookup only
 * when some project has a provider of its own to find. A password, a passkey,
 * Sign in with Microsoft and sign-up are gone from the page, and the server
 * refuses them (Common/Server/Utils/SsoRequiredSignIn.ts) - for everyone but
 * master admins, who sign in with their password at /accounts/admin-login.
 *
 * GET /identity/project-sign-in-methods/:projectId answers the page a project
 * that requires SSO sends people to (Dashboard, /dashboard/<project>/sso): the
 * project's own providers and the instance-wide ones that sign people in to
 * it, or only the one it requires.
 *
 * React-free and server-safe: the API, the Accounts pages, the Dashboard and
 * their tests all read it.
 */

// One SSO provider a person can sign in with.
export interface SsoSignInProvider {
  type: SsoProviderType;
  id: string;
  name: string;
  // Empty when the provider has none.
  description: string;
}

export interface SignInMethods {
  // The whole server requires SSO: the sign-in pages offer nothing else.
  isSsoRequired: boolean;
  // The instance-wide providers that are on, by name.
  ssoProviders: Array<SsoSignInProvider>;
  /*
   * Only while SSO is required: some project has a provider of its own that
   * is on, so the pages keep the email lookup that finds it. Always false
   * otherwise - the pages keep the lookup anyway, and the server does not say.
   */
  hasProjectSsoProviders: boolean;
}

// What the answer for a project holds: the providers that sign people in to it.
export interface ProjectSignInMethods {
  ssoProviders: Array<SsoSignInProvider>;
}

/*
 * What a sign-in that is not SSO is told while the server requires SSO: a
 * password (and the second steps that finish one), a passkey, Sign in with
 * Microsoft. Only someone who has already proved the account - a correct
 * password, a passkey - is told; a wrong password is answered as always.
 */
export const SSO_REQUIRED_SIGN_IN_MESSAGE: string =
  "This server requires single sign-on (SSO). Sign in with SSO instead.";

// What a sign-up is told while the server requires SSO.
export const SSO_REQUIRED_SIGN_UP_MESSAGE: string =
  "This server requires single sign-on (SSO), so accounts are not created with a password. Sign in with SSO instead.";

// The address master admins sign in at with their password while SSO is required.
export const MASTER_ADMIN_SIGN_IN_PATH: string = "/accounts/admin-login";

export const GLOBAL_SSO_PROVIDER_TYPES: ReadonlyArray<SsoProviderType> = [
  SsoProviderType.GlobalSSO,
  SsoProviderType.GlobalOIDC,
];

export const PROJECT_SSO_PROVIDER_TYPES: ReadonlyArray<SsoProviderType> = [
  SsoProviderType.ProjectSSO,
  SsoProviderType.ProjectOIDC,
];

const ALL_SSO_PROVIDER_TYPES: ReadonlyArray<SsoProviderType> = [
  ...GLOBAL_SSO_PROVIDER_TYPES,
  ...PROJECT_SSO_PROVIDER_TYPES,
];

/*
 * The longest name or description a sign-in page draws from an answer. The
 * columns hold far less; this only keeps a forged or broken answer from
 * drawing a wall of text.
 */
const MAX_PROVIDER_TEXT_LENGTH: number = 500;

type ReadTextFunction = (value: unknown) => string;

const readText: ReadTextFunction = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, MAX_PROVIDER_TEXT_LENGTH);
};

export default class SignInMethodsUtil {
  /*
   * The providers in an answer, of the kinds asked for: each with a real id,
   * a known kind and a name. Anything else in the list - a row with no name,
   * an id that is not one, a kind this page does not start - is left out,
   * never drawn as a button that cannot work.
   */
  public static parseProviders(
    value: unknown,
    allowedTypes: ReadonlyArray<SsoProviderType> = ALL_SSO_PROVIDER_TYPES,
  ): Array<SsoSignInProvider> {
    if (!Array.isArray(value)) {
      return [];
    }

    const providers: Array<SsoSignInProvider> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const row: Record<string, unknown> = item as Record<string, unknown>;
      const type: unknown = row["type"];
      const id: string = readText(row["id"]);
      const name: string = readText(row["name"]);

      if (
        typeof type !== "string" ||
        !allowedTypes.includes(type as SsoProviderType) ||
        !ObjectID.isValidUUID(id) ||
        !name
      ) {
        continue;
      }

      const key: string = `${type}:${id.toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      providers.push({
        type: type as SsoProviderType,
        id: id,
        name: name,
        description: readText(row["description"]),
      });
    }

    return providers;
  }

  /*
   * The answer of GET /identity/sign-in-methods, or null when it is not one
   * (a failed read, a proxy's page): the page then shows what it shows when
   * nothing is known, and the server still refuses what it must.
   */
  public static parse(value: unknown): SignInMethods | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const answer: Record<string, unknown> = value as Record<string, unknown>;

    if (typeof answer["isSsoRequired"] !== "boolean") {
      return null;
    }

    const isSsoRequired: boolean = answer["isSsoRequired"];

    return {
      isSsoRequired: isSsoRequired,
      ssoProviders: SignInMethodsUtil.parseProviders(
        answer["ssoProviders"],
        GLOBAL_SSO_PROVIDER_TYPES,
      ),
      hasProjectSsoProviders:
        isSsoRequired && answer["hasProjectSsoProviders"] === true,
    };
  }

  // The answer of GET /identity/project-sign-in-methods/:projectId.
  public static parseProjectMethods(value: unknown): ProjectSignInMethods {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ssoProviders: [] };
    }

    return {
      ssoProviders: SignInMethodsUtil.parseProviders(
        (value as Record<string, unknown>)["ssoProviders"],
      ),
    };
  }

  /*
   * Where a provider's sign-in starts, under the identity server's address
   * (IDENTITY_URL): the instance-wide ones by their id, a project's by the
   * project's and theirs. Null for a project's provider without a project.
   */
  public static getSignInRoute(data: {
    provider: SsoSignInProvider;
    projectId?: string | undefined;
  }): string | null {
    const providerId: string = encodeURIComponent(data.provider.id);

    switch (data.provider.type) {
      case SsoProviderType.GlobalSSO:
        return `/global-sso/${providerId}`;
      case SsoProviderType.GlobalOIDC:
        return `/global-oidc/${providerId}`;
      case SsoProviderType.ProjectSSO:
      case SsoProviderType.ProjectOIDC: {
        if (!data.projectId || !ObjectID.isValidUUID(data.projectId)) {
          return null;
        }

        const projectId: string = encodeURIComponent(data.projectId);

        return data.provider.type === SsoProviderType.ProjectSSO
          ? `/sso/${projectId}/${providerId}`
          : `/oidc/${projectId}/${providerId}`;
      }
      default:
        return null;
    }
  }

  /*
   * Whether a provider's description is only "Sign in with <name>", the one
   * it gets when nobody writes one (SsoProviderDefaults), or none: the page
   * then says "Sign in with <name>" in the visitor's language instead of
   * drawing the English one under the name.
   */
  public static hasOwnDescription(provider: SsoSignInProvider): boolean {
    return !isDefaultSsoProviderDescription({
      description: provider.description,
      name: provider.name,
    });
  }
}
