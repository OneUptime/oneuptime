import { AccountsRoute } from "../../ServiceRoute";
import SsoProviderType from "./SsoProviderType";

/*
 * SIGNING OUT OF THE IDENTITY PROVIDER TOO (#9535, #9603).
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
 * (signOutOfIdentityProvider), a browser sign-in keeps, server-side only,
 * what the provider's own sign-out needs (UserSession.identityProviderSignOut,
 * its secrets encrypted at rest, never sent to the browser while the session
 * lives):
 *
 *   - an OpenID Connect sign-in (Global OIDC, Project OIDC), what OpenID
 *     Connect RP-Initiated Logout 1.0 needs: where the provider ends its
 *     sessions (its discovery document's end_session_endpoint) and the
 *     sign-in's ID token, its id_token_hint;
 *   - a SAML sign-in (Global SSO, Project SSO), what a SAML 2.0
 *     <LogoutRequest> names (SAML 2.0 Core 3.7.1): the person, as the
 *     assertion's <NameID> named them - its text, its Format and its two
 *     qualifiers - and their session at the identity provider, the
 *     assertion's SessionIndex. Where the provider signs people out is the
 *     provider's Sign Out URL (singleLogoutURL), read at the sign-out.
 *
 * Once POST /identity/logout has ended the OneUptime session, it answers
 * where the browser goes next: the provider's end_session_endpoint (OIDC),
 * or its SingleLogoutService with a signed LogoutRequest (SAML) - and the
 * provider sends the browser back to OneUptime: the sign-in page, which an
 * OIDC provider must have registered as a post_logout_redirect_uri, or
 * OneUptime's Single Logout URL, which a SAML provider must know.
 *
 * React-free and server-safe: the server, the dashboards and their tests
 * read it.
 */

// What a session keeps to sign its person out of their OpenID Connect provider too.
export interface OidcIdentityProviderSignOutRecord {
  // The provider the person signed in through.
  providerType: SsoProviderType.GlobalOIDC | SsoProviderType.ProjectOIDC;
  providerId: string;
  // Where the provider ends its sessions: its discovery's end_session_endpoint.
  endSessionEndpoint: string;
  // The sign-in's ID token: the logout request's id_token_hint.
  idToken: string;
}

/*
 * What a session keeps to sign its person out of their SAML identity
 * provider too: what the assertion that signed them in named them by, which
 * a LogoutRequest has to name them by again, exactly (SAML 2.0 Core 3.7.1).
 */
export interface SamlIdentityProviderSignOutRecord {
  // The provider the person signed in through.
  providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO;
  providerId: string;
  // The assertion's <NameID>, as its text.
  nameId: string;
  // Its Format, NameQualifier and SPNameQualifier attributes, when it had them.
  nameIdFormat?: string | undefined;
  nameIdNameQualifier?: string | undefined;
  nameIdSpNameQualifier?: string | undefined;
  // The <AuthnStatement>'s SessionIndex: the person's session at the provider.
  sessionIndex?: string | undefined;
}

export type IdentityProviderSignOutRecord =
  | OidcIdentityProviderSignOutRecord
  | SamlIdentityProviderSignOutRecord;

/*
 * The field of POST /identity/logout's answer that holds where the browser
 * goes next to be signed out of the provider too. Absent when it goes to the
 * sign-in page, as every sign-out did before.
 */
export const IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD: string =
  "identityProviderSignOutUrl";

/*
 * The record's fields kept encrypted at rest (UserSession.
 * identityProviderSignOut): an OIDC sign-in's ID token, and the person and
 * the session a SAML sign-in names. A field the record has not is left
 * alone, so each kind encrypts its own.
 */
export const IDENTITY_PROVIDER_SIGN_OUT_ENCRYPTED_FIELDS: Array<string> = [
  "idToken",
  "nameId",
  "sessionIndex",
];

/*
 * The longest end_session_endpoint and ID token kept: an address a browser
 * is sent to, and a JWT, each far shorter in practice. Anything longer is no
 * provider's, and nothing is kept.
 */
export const MAX_END_SESSION_ENDPOINT_LENGTH: number = 2048;
export const MAX_ID_TOKEN_LENGTH: number = 16 * 1024;

/*
 * The longest of a SAML assertion's values a session keeps: a Name ID, its
 * Format and qualifiers, a SessionIndex. Each is an address, a URN or an
 * identifier, far shorter in practice.
 */
export const MAX_SAML_SIGN_OUT_VALUE_LENGTH: number = 1024;

/*
 * The longest address the browser is sent to, to sign out at the provider:
 * an end_session_endpoint with an ID token as its id_token_hint, or a SAML
 * provider's sign-out with its signed LogoutRequest. Either is longer than
 * the endpoint alone - a provider whose ID tokens carry many claims makes
 * one of several kilobytes - and far shorter than this.
 */
export const MAX_IDENTITY_PROVIDER_SIGN_OUT_URL_LENGTH: number = 32 * 1024;

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
 * Whether `value` is an absolute http(s) address with a host, no user name
 * or password in it, no fragment, no space around it, and no longer than
 * `maxLength`. Anything else - a javascript: address, a relative path - is
 * no provider's, and nobody is sent there.
 */
const isHttpAddress: (value: unknown, maxLength: number) => value is string = (
  value: unknown,
  maxLength: number,
): value is string => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
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
 * Whether a provider's end_session_endpoint is one a browser may be sent to:
 * an absolute http(s) address with a host, no user name or password in it,
 * no fragment, and of a sane length.
 */
export const isUsableEndSessionEndpoint: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return isHttpAddress(value, MAX_END_SESSION_ENDPOINT_LENGTH);
};

/*
 * Whether a SAML provider's Sign Out URL (its SingleLogoutService) is one a
 * browser may be sent to, by the same rules as an end_session_endpoint. A
 * query it has is kept: the signed LogoutRequest is added to it.
 */
export const isUsableSingleLogoutUrl: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return isHttpAddress(value, MAX_END_SESSION_ENDPOINT_LENGTH);
};

/*
 * Whether the address POST /identity/logout answers is one the sign-out
 * page may send the browser to: an http(s) address as above, as long as an
 * ID token or a signed LogoutRequest makes it, and no longer.
 */
export const isUsableIdentityProviderSignOutUrl: (
  value: unknown,
) => value is string = (value: unknown): value is string => {
  return isHttpAddress(value, MAX_IDENTITY_PROVIDER_SIGN_OUT_URL_LENGTH);
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

/*
 * Characters XML 1.0 cannot carry at all (C0 controls other than tab, line
 * feed and carriage return), and the two noncharacters at the end of the
 * Basic Multilingual Plane. A value that holds one is no assertion's.
 */
// eslint-disable-next-line no-control-regex
const NOT_IN_XML: RegExp = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

/*
 * Whether a SAML value a session keeps - a Name ID, its Format or a
 * qualifier, a SessionIndex - is one to keep: text, not empty, with no space
 * around it, of a sane length, that XML can carry back to the provider.
 */
export const isUsableSamlSignOutValue: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SAML_SIGN_OUT_VALUE_LENGTH &&
    value === value.trim() &&
    !NOT_IN_XML.test(value)
  );
};

const OIDC_PROVIDER_TYPES: ReadonlyArray<string> = [
  SsoProviderType.GlobalOIDC,
  SsoProviderType.ProjectOIDC,
];

const SAML_PROVIDER_TYPES: ReadonlyArray<string> = [
  SsoProviderType.GlobalSSO,
  SsoProviderType.ProjectSSO,
];

// Whether a record is a SAML sign-in's.
export const isSamlIdentityProviderSignOutRecord: (
  record: IdentityProviderSignOutRecord,
) => record is SamlIdentityProviderSignOutRecord = (
  record: IdentityProviderSignOutRecord,
): record is SamlIdentityProviderSignOutRecord => {
  return SAML_PROVIDER_TYPES.includes(record.providerType);
};

// The SAML record's optional values, read as kept: absent, or one to keep.
const SAML_OPTIONAL_FIELDS: ReadonlyArray<
  keyof Pick<
    SamlIdentityProviderSignOutRecord,
    | "nameIdFormat"
    | "nameIdNameQualifier"
    | "nameIdSpNameQualifier"
    | "sessionIndex"
  >
> = [
  "nameIdFormat",
  "nameIdNameQualifier",
  "nameIdSpNameQualifier",
  "sessionIndex",
];

const readSamlRecord: (
  record: Record<string, unknown>,
) => SamlIdentityProviderSignOutRecord | null = (
  record: Record<string, unknown>,
): SamlIdentityProviderSignOutRecord | null => {
  if (!isUsableSamlSignOutValue(record["nameId"])) {
    return null;
  }

  const read: SamlIdentityProviderSignOutRecord = {
    providerType: record["providerType"] as
      | SsoProviderType.GlobalSSO
      | SsoProviderType.ProjectSSO,
    providerId: record["providerId"] as string,
    nameId: record["nameId"],
  };

  for (const field of SAML_OPTIONAL_FIELDS) {
    const value: unknown = record[field];

    if (value === undefined || value === null) {
      continue;
    }

    if (!isUsableSamlSignOutValue(value)) {
      return null;
    }

    read[field] = value;
  }

  return read;
};

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
    typeof record["providerId"] !== "string" ||
    !record["providerId"]
  ) {
    return null;
  }

  if (SAML_PROVIDER_TYPES.includes(record["providerType"])) {
    return readSamlRecord(record);
  }

  if (
    !OIDC_PROVIDER_TYPES.includes(record["providerType"]) ||
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
