import {
  SamlProviderAddresses,
  SamlSignInAgainAdvice,
  getSamlSignInAgainAdvice,
  isKeycloakSamlProvider,
  isOktaSamlProvider,
} from "../../../Types/SSO/SamlSignInAgainAdvice";
import URL from "../../../Types/API/URL";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT SIGN IN AGAIN NEEDS OF A SAML PROVIDER (#10530), read from what its
 * administrator pasted from it - its issuer (entity ID) and its sign-on URL
 * - as each product writes them:
 *
 *   - Keycloak stamps AuthnInstant with the time it answers, so OneUptime
 *     cannot check that it asked the person again: said of a realm's
 *     address (https://<host>/realms/<realm>, under any relative path of
 *     the server's, /auth before Keycloak 17) and of its SAML endpoint;
 *   - Okta honours ForceAuthn only with Honor Force Authentication on: said
 *     of its issuer, http://www.okta.com/<app id>, and of a sign-on URL on
 *     an Okta org's domain.
 *
 * Every other provider, and anything that only looks like one of these,
 * needs nothing said.
 */

const KEYCLOAK: SamlSignInAgainAdvice =
  SamlSignInAgainAdvice.KeycloakCannotBeChecked;
const OKTA: SamlSignInAgainAdvice =
  SamlSignInAgainAdvice.TurnOnOktaHonorForceAuthentication;

function adviceFor(provider: SamlProviderAddresses): {
  provider: SamlProviderAddresses;
  advice: SamlSignInAgainAdvice | null;
} {
  return { provider: provider, advice: getSamlSignInAgainAdvice(provider) };
}

describe("a Keycloak realm over SAML", () => {
  test.each([
    // Keycloak 17 and later, on the Quarkus distribution.
    ["https://keycloak.example.com/realms/acme"],
    ["https://keycloak.example.com/realms/acme/"],
    // Before Keycloak 17, and Red Hat SSO, under /auth.
    ["https://keycloak.example.com/auth/realms/acme"],
    // Under a relative path of the server's own (http-relative-path).
    ["https://sso.example.com/keycloak/realms/acme"],
    ["http://localhost:8080/realms/master"],
    ["https://KEYCLOAK.EXAMPLE.COM/realms/Acme-Production_2"],
    ["https://keycloak.example.com/realms/acme%20corp"],
    ["  https://keycloak.example.com/realms/acme  "],
  ])("is known by its issuer, %s, and cannot be checked", (issuer: string) => {
    expect(adviceFor({ issuerURL: issuer })).toEqual({
      provider: { issuerURL: issuer },
      advice: KEYCLOAK,
    });
    expect(isKeycloakSamlProvider({ issuerURL: issuer })).toBe(true);
  });

  test.each([
    ["https://keycloak.example.com/realms/acme/protocol/saml"],
    ["https://keycloak.example.com/auth/realms/acme/protocol/saml"],
    // A client's IdP-initiated sign-on, under the endpoint.
    [
      "https://keycloak.example.com/realms/acme/protocol/saml/clients/oneuptime",
    ],
    ["https://keycloak.example.com/realms/acme/protocol/saml?SAMLRequest=x"],
  ])(
    "is known by its SAML endpoint, %s, whatever the issuer says",
    (signOn: string) => {
      expect(
        adviceFor({ issuerURL: "urn:acme:idp", signOnURL: signOn }).advice,
      ).toBe(KEYCLOAK);
      expect(adviceFor({ signOnURL: signOn }).advice).toBe(KEYCLOAK);
    },
  );

  test("is known as the page holds its addresses: a URL, or the JSON one is sent as", () => {
    expect(
      getSamlSignInAgainAdvice({
        signOnURL: URL.fromString(
          "https://keycloak.example.com/realms/acme/protocol/saml",
        ),
      }),
    ).toBe(KEYCLOAK);
    expect(
      getSamlSignInAgainAdvice({
        signOnURL: {
          _type: "URL",
          value: "https://keycloak.example.com/realms/acme/protocol/saml",
        },
      }),
    ).toBe(KEYCLOAK);
  });

  test("is said of Keycloak before Okta, should both be named", () => {
    expect(
      getSamlSignInAgainAdvice({
        issuerURL: "https://keycloak.example.com/realms/acme",
        signOnURL: "https://acme.okta.com/app/oneuptime/exk1/sso/saml",
      }),
    ).toBe(KEYCLOAK);
  });

  test("an address that only looks like a realm's is not Keycloak", () => {
    for (const provider of [
      { issuerURL: "https://keycloak.example.com/realms" },
      { issuerURL: "https://keycloak.example.com/realms/" },
      { issuerURL: "https://example.com/myrealms/acme" },
      { issuerURL: "https://example.com/realms/acme/saml/metadata" },
      { issuerURL: "https://example.com/?next=/realms/acme" },
      { issuerURL: "https://example.com/#/realms/acme" },
      { issuerURL: "urn:example:realms/acme" },
      { issuerURL: "ftp://keycloak.example.com/realms/acme" },
      { issuerURL: "realms/acme" },
      {
        signOnURL:
          "https://keycloak.example.com/realms/acme/protocol/openid-connect/auth",
      },
      { signOnURL: "https://keycloak.example.com/realms/acme/protocol/samlx" },
      { signOnURL: "https://example.com/?next=/realms/acme/protocol/saml" },
    ] as Array<SamlProviderAddresses>) {
      expect(adviceFor(provider)).toEqual({ provider, advice: null });
    }
  });
});

describe("an Okta SAML app", () => {
  test.each([
    ["http://www.okta.com/exk1a2b3c4D5E6F7g8h9"],
    ["https://www.okta.com/exk1a2b3c4D5E6F7g8h9"],
    ["http://WWW.OKTA.COM/exk1a2b3c4D5E6F7g8h9"],
  ])(
    "is known by the issuer every Okta SAML app signs with, %s",
    (issuer: string) => {
      expect(adviceFor({ issuerURL: issuer }).advice).toBe(OKTA);
      expect(isOktaSamlProvider({ issuerURL: issuer })).toBe(true);
    },
  );

  test.each([
    [
      "https://acme.okta.com/app/acme_oneuptime_1/exk1a2b3c4D5E6F7g8h9/sso/saml",
    ],
    ["https://dev-12345678.oktapreview.com/app/oneuptime/exk1/sso/saml"],
    ["https://acme.okta-emea.com/app/oneuptime/exk1/sso/saml"],
    ["https://acme.okta-gov.com/app/oneuptime/exk1/sso/saml"],
  ])(
    "is known by a sign-on URL on an Okta org's domain, %s",
    (signOn: string) => {
      expect(
        adviceFor({ issuerURL: "https://idp.example.com", signOnURL: signOn })
          .advice,
      ).toBe(OKTA);
    },
  );

  test("an address that only looks like Okta's is not Okta", () => {
    for (const provider of [
      { issuerURL: "http://www.okta.com.evil.example/exk1" },
      { issuerURL: "http://evil.example/www.okta.com/exk1" },
      { issuerURL: "http://okta.com/exk1" },
      { signOnURL: "https://okta.com/app/oneuptime/exk1/sso/saml" },
      { signOnURL: "https://acme.okta.com.evil.example/app/x/sso/saml" },
      { signOnURL: "https://evil-okta.com/app/x/sso/saml" },
      { signOnURL: "https://acmeokta.com/app/x/sso/saml" },
    ] as Array<SamlProviderAddresses>) {
      expect(adviceFor(provider)).toEqual({ provider, advice: null });
    }
  });
});

describe("every other provider", () => {
  test("needs nothing said: Sign In Again checks it, or the docs say what it takes", () => {
    for (const provider of [
      // Microsoft Entra ID: AuthnInstant is when the person signed in.
      {
        issuerURL:
          "https://sts.windows.net/72f988bf-86f1-41af-91ab-2d7cd011db47/",
        signOnURL:
          "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/saml2",
      },
      // Google Workspace.
      {
        issuerURL: "https://accounts.google.com/o/saml2?idpid=C01abcdef",
        signOnURL: "https://accounts.google.com/o/saml2/idp?idpid=C01abcdef",
      },
      // OneLogin, JumpCloud, Auth0.
      {
        issuerURL: "https://app.onelogin.com/saml/metadata/0a1b2c3d",
        signOnURL: "https://acme.onelogin.com/trust/saml2/http-post/sso/0a1b",
      },
      {
        issuerURL: "JumpCloud",
        signOnURL: "https://sso.jumpcloud.com/saml2/oneuptime",
      },
      {
        issuerURL: "urn:acme.eu.auth0.com",
        signOnURL: "https://acme.eu.auth0.com/samlp/AbCdEf123",
      },
    ] as Array<SamlProviderAddresses>) {
      expect(adviceFor(provider)).toEqual({ provider, advice: null });
    }
  });

  test("nor does a provider whose addresses are not read yet, or are no address", () => {
    for (const provider of [
      {},
      { issuerURL: "", signOnURL: "" },
      { issuerURL: null, signOnURL: undefined },
      { issuerURL: 42, signOnURL: true },
      { issuerURL: {}, signOnURL: [] },
      { issuerURL: "not an address at all" },
    ] as Array<SamlProviderAddresses>) {
      expect(adviceFor(provider)).toEqual({ provider, advice: null });
    }

    expect(getSamlSignInAgainAdvice(null)).toBeNull();
    expect(getSamlSignInAgainAdvice(undefined)).toBeNull();
  });
});
