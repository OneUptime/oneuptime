import URL from "../API/URL";
import {
  SsoProviderDescriptionFields,
  fillSsoProviderDescription,
  isBlankSsoValue,
} from "./SsoProviderDefaults";

/*
 * WHAT AN OPENID CONNECT PROVIDER IS GIVEN, AND WHAT IS WORKED OUT FROM IT.
 *
 * Adding an OIDC provider - for a project, a status page or the whole
 * instance - asked for eleven things over four steps. Only three come from
 * the identity provider and differ from one setup to the next: the issuer,
 * the client ID and the client secret. The rest has an answer:
 *
 *   - the discovery URL is the issuer followed by
 *     /.well-known/openid-configuration (OpenID Connect Discovery 1.0,
 *     section 4: any trailing "/" of the issuer is dropped first), so it is
 *     worked out from the issuer;
 *   - the scopes, and the claims that hold the email address and the name,
 *     are "openid email profile", "email" and "name" for nearly every
 *     provider;
 *   - the description is "Sign in with <name>" (SsoProviderDefaults).
 *
 * The services (ProjectOidcService, StatusPageOidcService,
 * GlobalOidcService) fill these in when a provider is created without them,
 * before the required-field check runs, so the columns stay required and
 * the API and Terraform keep their contract while a caller may leave them
 * out. The forms show the same values, so what a form shows is what is
 * saved. A provider that already exists keeps what it has.
 *
 * Nothing here fetches anything: the discovery document is read when
 * someone signs in, as before, through the OIDC egress guard.
 *
 * React-free and server-safe: the API, the Dashboard, the Admin Dashboard
 * and their tests all read it.
 */

export const OIDC_DISCOVERY_PATH: string = "/.well-known/openid-configuration";

export const DEFAULT_OIDC_SCOPES: string = "openid email profile";

export const DEFAULT_OIDC_EMAIL_CLAIM_NAME: string = "email";

export const DEFAULT_OIDC_NAME_CLAIM_NAME: string = "name";

// The scope every OpenID Connect sign-in has to ask for.
export const REQUIRED_OIDC_SCOPE: string = "openid";

/*
 * An issuer is an https URL (OpenID Connect Core 1.0, section 1.2); an
 * identity provider on the installation's own network may be plain http.
 */
const ISSUER_SCHEME: RegExp = /^https?:\/\/\S+/i;

/*
 * A discovery URL: something, then /.well-known/openid-configuration, then
 * at most a "/" and a query. Some providers need the query (Azure AD B2C
 * names its sign-in policy in ?p=), so it is kept; a fragment never reaches
 * a server and is dropped.
 */
const DISCOVERY_URL: RegExp =
  /^(.+?)\/\.well-known\/openid-configuration\/?(\?[^#]*)?(#.*)?$/i;

export interface OidcIssuerParts {
  issuerURL: string;
  discoveryURL: string;
}

/**
 * When a value is a discovery URL rather than an issuer (it ends in
 * /.well-known/openid-configuration, perhaps with a query), the issuer in
 * front of it and the URL itself. Null for anything else, an issuer
 * included.
 */
export const splitOidcDiscoveryUrl: (
  value: string | null | undefined,
) => OidcIssuerParts | null = (
  value: string | null | undefined,
): OidcIssuerParts | null => {
  if (typeof value !== "string") {
    return null;
  }

  const match: RegExpMatchArray | null = value.trim().match(DISCOVERY_URL);
  const issuerURL: string = match?.[1] || "";

  if (!match || !issuerURL.replace(/\/+$/, "")) {
    return null;
  }

  return {
    issuerURL,
    discoveryURL: `${issuerURL.replace(/\/+$/, "")}${OIDC_DISCOVERY_PATH}${match[2] || ""}`,
  };
};

/**
 * The issuer a value names: the value itself, trimmed - or, for a discovery
 * URL pasted where the issuer goes, the issuer in front of it.
 */
export const getOidcIssuerFromValue: (
  value: string | null | undefined,
) => string = (value: string | null | undefined): string => {
  const split: OidcIssuerParts | null = splitOidcDiscoveryUrl(value);

  if (split) {
    return split.issuerURL;
  }

  return typeof value === "string" ? value.trim() : "";
};

/**
 * The discovery URL of an issuer: the issuer without a trailing "/", then
 * /.well-known/openid-configuration. Empty for a blank issuer; a discovery
 * URL given as the issuer is its own.
 */
export const getOidcDiscoveryUrl: (
  issuer: string | null | undefined,
) => string = (issuer: string | null | undefined): string => {
  const split: OidcIssuerParts | null = splitOidcDiscoveryUrl(issuer);

  if (split) {
    return split.discoveryURL;
  }

  const trimmed: string = typeof issuer === "string" ? issuer.trim() : "";

  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/\/+$/, "") + OIDC_DISCOVERY_PATH;
};

/**
 * Whether a discovery URL is the one the issuer gives (or none at all): it
 * then follows the issuer when the issuer changes. One set by hand, for a
 * provider that publishes its discovery document somewhere else, stays.
 */
export const isDefaultOidcDiscoveryUrl: (data: {
  discoveryURL: URL | string | null | undefined;
  issuerURL: string | null | undefined;
}) => boolean = (data: {
  discoveryURL: URL | string | null | undefined;
  issuerURL: string | null | undefined;
}): boolean => {
  if (isBlankSsoValue(data.discoveryURL)) {
    return true;
  }

  const derived: string = getOidcDiscoveryUrl(data.issuerURL);

  return (
    Boolean(derived) &&
    normalizeUrlText(String(data.discoveryURL)) === normalizeUrlText(derived)
  );
};

/*
 * The URL type writes a URL back the way it parsed it, which may differ from
 * how it was typed in ways that do not matter here: the case of the scheme
 * and of the host, and a trailing "/".
 */
const normalizeUrlText: (value: string) => string = (value: string): string => {
  const trimmed: string = value.trim().replace(/\/+$/, "");
  const match: RegExpMatchArray | null = trimmed.match(
    /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i,
  );

  if (!match) {
    return trimmed;
  }

  return `${(match[1] || "").toLowerCase()}${(match[2] || "").toLowerCase()}${match[3] || ""}`;
};

// Whether an issuer is written as an http(s) URL.
export const isOidcIssuerUrl: (value: string | null | undefined) => boolean = (
  value: string | null | undefined,
): boolean => {
  return typeof value === "string" && ISSUER_SCHEME.test(value.trim());
};

// The scopes, one by one.
export const getOidcScopeList: (
  scopes: string | null | undefined,
) => Array<string> = (scopes: string | null | undefined): Array<string> => {
  if (typeof scopes !== "string") {
    return [];
  }

  return scopes.split(/\s+/).filter((scope: string): boolean => {
    return scope.length > 0;
  });
};

// Whether the scopes ask for openid, which every OIDC sign-in needs.
export const includesRequiredOidcScope: (
  scopes: string | null | undefined,
) => boolean = (scopes: string | null | undefined): boolean => {
  return getOidcScopeList(scopes).includes(REQUIRED_OIDC_SCOPE);
};

/*
 * A provider about to be created: the columns every OIDC provider has that
 * are filled in here. ProjectOIDC, StatusPageOIDC and GlobalOIDC all fit it.
 */
export interface OidcProviderDefaultFields
  extends SsoProviderDescriptionFields {
  issuerURL?: string | undefined;
  discoveryURL?: URL | undefined;
  scopes?: string | undefined;
  emailClaimName?: string | undefined;
  nameClaimName?: string | undefined;
}

/**
 * What a provider created without them gets, in place:
 *
 *   - an issuer given as a discovery URL becomes the issuer in front of it
 *     (and the URL its discovery URL, unless one was given);
 *   - a missing discovery URL is worked out from the issuer;
 *   - missing scopes and claim names are the usual ones;
 *   - a missing description is "Sign in with <name>".
 *
 * Whatever the caller sent is kept. A value that cannot be worked out (no
 * issuer, or one that is not a URL) is left missing, so the required-field
 * check names it.
 */
export const fillOidcProviderDefaults: (
  provider: OidcProviderDefaultFields,
) => void = (provider: OidcProviderDefaultFields): void => {
  if (typeof provider.issuerURL === "string") {
    const split: OidcIssuerParts | null = splitOidcDiscoveryUrl(
      provider.issuerURL,
    );

    provider.issuerURL = split ? split.issuerURL : provider.issuerURL.trim();

    if (split && isBlankSsoValue(provider.discoveryURL)) {
      provider.discoveryURL = toUrl(split.discoveryURL);
    }
  }

  if (
    isBlankSsoValue(provider.discoveryURL) &&
    isOidcIssuerUrl(provider.issuerURL)
  ) {
    provider.discoveryURL = toUrl(getOidcDiscoveryUrl(provider.issuerURL));
  }

  if (isBlankSsoValue(provider.scopes)) {
    provider.scopes = DEFAULT_OIDC_SCOPES;
  }

  if (isBlankSsoValue(provider.emailClaimName)) {
    provider.emailClaimName = DEFAULT_OIDC_EMAIL_CLAIM_NAME;
  }

  if (isBlankSsoValue(provider.nameClaimName)) {
    provider.nameClaimName = DEFAULT_OIDC_NAME_CLAIM_NAME;
  }

  fillSsoProviderDescription(provider);
};

// A URL the column can hold, or nothing when the text does not parse.
const toUrl: (value: string) => URL | undefined = (
  value: string,
): URL | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    return URL.fromString(value);
  } catch {
    return undefined;
  }
};
