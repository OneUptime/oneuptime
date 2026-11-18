import { AccountsRoute } from "../../ServiceRoute";
import SsoProviderType from "./SsoProviderType";

/*
 * SIGNING OUT OF THE IDENTITY PROVIDER TOO (#9535).
 *
 * Signing out of OneUptime ends the OneUptime session and clears its
 * cookies. The person's session at the identity provider (Okta, Microsoft
 * Entra ID, Keycloak, ...) stays: on a shared computer, the next person who
 * clicks "Sign in with <provider>" was signed in as the last one, without a
 * password. Whether a sign-out should end the provider's session too is the
 * administrator's choice, per provider: on for shared computers (a NOC
 * screen, a kiosk); off on single-user laptops, where it would sign the
 * person out of every other app that uses the provider.
 *
 * With the provider's "Sign out of the identity provider too" switch on
 * (signOutOfIdentityProvider, on Global OIDC and Project OIDC providers), an
 * OpenID Connect sign-in keeps, server-side only, what OpenID Connect
 * RP-Initiated Logout 1.0 needs: where the provider ends its sessions (its
 * discovery document's end_session_endpoint) and the sign-in's ID token, its
 * id_token_hint (UserSession.identityProviderSignOut, the ID token encrypted
 * at rest, never sent to the browser while the session lives). Once
 * POST /identity/logout has ended the OneUptime session, it answers where
 * the browser goes next: the provider's end_session_endpoint, with the
 * id_token_hint, the client_id and the post_logout_redirect_uri - always
 * OneUptime's own sign-in page, which the provider must have registered.
 *
 * React-free and server-safe: the server, the dashboards and their tests
 * read it.
 */

// What a session keeps to sign its person out of their OpenID Connect provider too.
export interface IdentityProviderSignOutRecord {
  // The provider the person signed in through.
  providerType: SsoProviderType.GlobalOIDC | SsoProviderType.ProjectOIDC;
  providerId: string;
  // Where the provider ends its sessions: its discovery's end_session_endpoint.
  endSessionEndpoint: string;
  // The sign-in's ID token: the logout request's id_token_hint.
  idToken: string;
}

/*
 * The field of POST /identity/logout's answer that holds where the browser
 * goes next to be signed out of the provider too. Absent when it goes to the
 * sign-in page, as every sign-out did before.
 */
export const IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD: string =
  "identityProviderSignOutUrl";

// The record's field kept encrypted at rest (UserSession.identityProviderSignOut).
export const IDENTITY_PROVIDER_SIGN_OUT_ENCRYPTED_FIELDS: Array<string> = [
  "idToken",
];

/*
 * The longest end_session_endpoint and ID token kept: an address a browser
 * is sent to, and a JWT, each far shorter in practice. Anything longer is no
 * provider's, and nothing is kept.
 */
export const MAX_END_SESSION_ENDPOINT_LENGTH: number = 2048;
export const MAX_ID_TOKEN_LENGTH: number = 16 * 1024;

/*
 * The page a provider sends the browser back to once it has signed the
 * person out (post_logout_redirect_uri): OneUptime's sign-in page, where a
 * sign-out has always ended. The provider must have it registered.
 */
export const getPostLogoutRedirectUri: (data: {
  httpProtocol: string;
  host: string;
}) => string = (data: { httpProtocol: string; host: string }): string => {
  return `${data.httpProtocol}${data.host}${AccountsRoute.toString()}`;
};

/*
 * Whether a provider's end_session_endpoint is one a browser may be sent to:
 * an absolute http(s) address with a host, no user name or password in it,
 * no fragment, and of a sane length. Anything else - a javascript: address,
 * a relative path - is no provider's, and nobody is sent there.
 */
export const isUsableEndSessionEndpoint: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_END_SESSION_ENDPOINT_LENGTH ||
    value !== value.trim()
  ) {
    return false;
  }

  let url: globalThis.URL;

  try {
    url = new globalThis.URL(value);
  } catch {
    return false;
  }

  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    Boolean(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.hash
  );
};

/*
 * Whether an ID token is one to keep: a JWT's three dot-separated parts (a
 * signed token), or five (an encrypted one), of a sane length.
 */
const ID_TOKEN_SHAPE: RegExp =
  /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*){2}$|^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*){4}$/;

export const isUsableIdToken: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_TOKEN_LENGTH &&
    ID_TOKEN_SHAPE.test(value)
  );
};

const PROVIDER_TYPES: ReadonlyArray<string> = [
  SsoProviderType.GlobalOIDC,
  SsoProviderType.ProjectOIDC,
];

/*
 * The record a session keeps, or null when what it holds is not one: never
 * kept, or of another shape. Read field by field, so nothing else rides
 * along.
 */
export const readIdentityProviderSignOutRecord: (
  value: unknown,
) => IdentityProviderSignOutRecord | null = (
  value: unknown,
): IdentityProviderSignOutRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (
    typeof record["providerType"] !== "string" ||
    !PROVIDER_TYPES.includes(record["providerType"]) ||
    typeof record["providerId"] !== "string" ||
    !record["providerId"] ||
    !isUsableEndSessionEndpoint(record["endSessionEndpoint"]) ||
    !isUsableIdToken(record["idToken"])
  ) {
    return null;
  }

  return {
    providerType: record["providerType"] as
      | SsoProviderType.GlobalOIDC
      | SsoProviderType.ProjectOIDC,
    providerId: record["providerId"],
    endSessionEndpoint: record["endSessionEndpoint"],
    idToken: record["idToken"],
  };
};

/*
 * Where the browser goes to be signed out of the provider (OpenID Connect
 * RP-Initiated Logout 1.0, section 2): its end_session_endpoint, keeping any
 * query it has (Azure AD B2C names its policy there), with the ID token as
 * id_token_hint, OneUptime's client_id, and the page to come back to. Null
 * when the endpoint or the token is not one to use.
 */
export const buildIdentityProviderSignOutUrl: (data: {
  endSessionEndpoint: string;
  idToken: string;
  clientId: string;
  postLogoutRedirectUri: string;
}) => string | null = (data: {
  endSessionEndpoint: string;
  idToken: string;
  clientId: string;
  postLogoutRedirectUri: string;
}): string | null => {
  if (
    !isUsableEndSessionEndpoint(data.endSessionEndpoint) ||
    !isUsableIdToken(data.idToken) ||
    !data.clientId ||
    !data.postLogoutRedirectUri
  ) {
    return null;
  }

  const url: globalThis.URL = new globalThis.URL(data.endSessionEndpoint);

  url.searchParams.set("id_token_hint", data.idToken);
  url.searchParams.set("client_id", data.clientId);
  url.searchParams.set("post_logout_redirect_uri", data.postLogoutRedirectUri);

  return url.toString();
};
