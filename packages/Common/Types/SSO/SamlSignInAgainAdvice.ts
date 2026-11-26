/*
 * WHAT SIGN IN AGAIN NEEDS OF A SAML PROVIDER, SAID BESIDE IT (#10530).
 *
 * Sign In Again counts a SAML sign-in only when the signed assertion's
 * AuthnInstant is at or after the moment OneUptime sent the person to the
 * provider with ForceAuthn="true" (Types/Accounts/Reauthentication's
 * judgeSignInAgain). That check rests on AuthnInstant being when the person
 * authenticated, and two providers need the administrator told what it
 * takes, on the provider's row of Settings > SSO and on a server
 * provider's page:
 *
 *   - Keycloak stamps AuthnInstant with the time it builds the response,
 *     whether the person typed a password or was signed in from Keycloak's
 *     own session: SAML2LoginResponseBuilder passes
 *     XMLTimeUtil.getIssueInstant() to StatementUtil.createAuthnStatement,
 *     and keycloak/keycloak#31197 was closed as working as expected. So
 *     the check passes whatever happened, and all that holds is Keycloak
 *     honouring ForceAuthn - which 26.8.2 and earlier skip when the
 *     sign-in is restarted with skip_logout=true (keycloak/keycloak#54339,
 *     fixed in 26.8.3 and 27.0.0). Over OpenID Connect, Keycloak's
 *     auth_time is when the person signed in (the basic client scope), and
 *     OneUptime checks it itself: the advice is the same realm, as an OIDC
 *     provider.
 *   - Okta does not document its AuthnInstant (a community thread reports
 *     the current time while Honor Force Authentication is off), and
 *     honours ForceAuthn only with the app's Honor Force Authentication set
 *     to Yes: the setting the docs ask for, said where it is needed.
 *
 * A provider is known by what its administrator pasted from it, its issuer
 * (entity ID) and its sign-on URL, as each product writes them:
 *
 *   - Keycloak: the realm's address, https://<host>/realms/<realm>, under
 *     a relative path of the server's own (/auth before Keycloak 17), and
 *     its SAML endpoint, .../realms/<realm>/protocol/saml;
 *   - Okta: the issuer http://www.okta.com/<app id> every Okta SAML app
 *     signs with, or a sign-on URL on an Okta org's own domain.
 *
 * Nothing is said of any other provider, nor of a value that is no
 * address. Pure, so the Dashboard's and the Admin Dashboard's pages, and
 * their tests, read the same answer (Common/UI/Components/Sso/
 * SamlSignInAgainNote).
 */

export enum SamlSignInAgainAdvice {
  // Its AuthnInstant is when it answers: OneUptime cannot check Keycloak.
  KeycloakCannotBeChecked = "KeycloakCannotBeChecked",
  // Okta honours ForceAuthn only with Honor Force Authentication on.
  TurnOnOktaHonorForceAuthentication = "TurnOnOktaHonorForceAuthentication",
}

// What a SAML provider's record holds, as a page reads it.
export interface SamlProviderAddresses {
  issuerURL?: unknown;
  signOnURL?: unknown;
}

// A realm's address: a path that ends in /realms/<realm>.
const KEYCLOAK_REALM_PATH: RegExp = /(?:^|\/)realms\/[^/]+\/?$/;

// A realm's SAML endpoint, and the IdP-initiated ones under it.
const KEYCLOAK_SAML_ENDPOINT_PATH: RegExp =
  /\/realms\/[^/]+\/protocol\/saml(?:\/|$)/;

// The issuer of every Okta SAML app: http://www.okta.com/<app id>.
const OKTA_SAML_ISSUER_HOSTNAME: string = "www.okta.com";

// The domains Okta's orgs are served on: <org>.okta.com and its cells'.
const OKTA_ORG_DOMAINS: ReadonlyArray<string> = [
  "okta.com",
  "oktapreview.com",
  "okta-emea.com",
  "okta-gov.com",
];

/*
 * A value as its words: a page may hold an address as a string, a URL
 * (Types/API/URL), or the JSON one is sent as ({ _type, value }).
 */
const textOf: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object") {
    const inner: unknown = (value as { value?: unknown }).value;

    if (typeof inner === "string") {
      return inner.trim();
    }

    const text: string = String(value);

    return text === "[object Object]" ? "" : text.trim();
  }

  return "";
};

// The value read as an address, or null when it is none.
const addressOf: (value: unknown) => globalThis.URL | null = (
  value: unknown,
): globalThis.URL | null => {
  const text: string = textOf(value);

  if (!text) {
    return null;
  }

  try {
    const address: globalThis.URL = new globalThis.URL(text);

    return address.protocol === "http:" || address.protocol === "https:"
      ? address
      : null;
  } catch {
    return null;
  }
};

// Whether the provider is a Keycloak realm, by its issuer or its SAML endpoint.
export const isKeycloakSamlProvider: (
  provider: SamlProviderAddresses,
) => boolean = (provider: SamlProviderAddresses): boolean => {
  const issuer: globalThis.URL | null = addressOf(provider.issuerURL);
  const signOn: globalThis.URL | null = addressOf(provider.signOnURL);

  return (
    (issuer !== null && KEYCLOAK_REALM_PATH.test(issuer.pathname)) ||
    (signOn !== null && KEYCLOAK_SAML_ENDPOINT_PATH.test(signOn.pathname))
  );
};

// Whether the provider is an Okta SAML app, by its issuer or its org's domain.
export const isOktaSamlProvider: (
  provider: SamlProviderAddresses,
) => boolean = (provider: SamlProviderAddresses): boolean => {
  const issuer: globalThis.URL | null = addressOf(provider.issuerURL);
  const signOn: globalThis.URL | null = addressOf(provider.signOnURL);

  if (issuer !== null && issuer.hostname === OKTA_SAML_ISSUER_HOSTNAME) {
    return true;
  }

  return (
    signOn !== null &&
    OKTA_ORG_DOMAINS.some((domain: string): boolean => {
      return signOn.hostname.endsWith(`.${domain}`);
    })
  );
};

/*
 * What to say beside the provider about Sign In Again, or null for a
 * provider it needs nothing more of.
 */
export const getSamlSignInAgainAdvice: (
  provider: SamlProviderAddresses | null | undefined,
) => SamlSignInAgainAdvice | null = (
  provider: SamlProviderAddresses | null | undefined,
): SamlSignInAgainAdvice | null => {
  if (!provider) {
    return null;
  }

  if (isKeycloakSamlProvider(provider)) {
    return SamlSignInAgainAdvice.KeycloakCannotBeChecked;
  }

  if (isOktaSamlProvider(provider)) {
    return SamlSignInAgainAdvice.TurnOnOktaHonorForceAuthentication;
  }

  return null;
};
