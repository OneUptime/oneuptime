import { describe, expect, test } from "@jest/globals";
import URL from "../../../Types/API/URL";
import {
  DEFAULT_OIDC_EMAIL_CLAIM_NAME,
  DEFAULT_OIDC_NAME_CLAIM_NAME,
  DEFAULT_OIDC_SCOPES,
  OIDC_DISCOVERY_PATH,
  OidcProviderDefaultFields,
  REQUIRED_OIDC_SCOPE,
  fillOidcProviderDefaults,
  getOidcDiscoveryUrl,
  getOidcIssuerFromValue,
  getOidcScopeList,
  includesRequiredOidcScope,
  isDefaultOidcDiscoveryUrl,
  isOidcIssuerUrl,
  splitOidcDiscoveryUrl,
} from "../../../Types/SSO/OidcProviderDefaults";

/*
 * What an OpenID Connect provider is given, and what is worked out from it
 * (Types/SSO/OidcProviderDefaults): the discovery URL from the issuer
 * (OpenID Connect Discovery 1.0, section 4), the usual scopes and claim
 * names, and "Sign in with <name>". The services fill these in for a
 * provider created without them; the forms show the same values.
 *
 * The issuers below are the ones real providers use, including the shapes
 * that trip a naive join: Auth0's trailing "/", Entra ID's /v2.0 path,
 * Keycloak's realm path on plain http inside a private network.
 */

describe("the usual values", () => {
  test("are the ones nearly every provider uses", () => {
    expect(DEFAULT_OIDC_SCOPES).toBe("openid email profile");
    expect(DEFAULT_OIDC_EMAIL_CLAIM_NAME).toBe("email");
    expect(DEFAULT_OIDC_NAME_CLAIM_NAME).toBe("name");
    expect(REQUIRED_OIDC_SCOPE).toBe("openid");
    expect(OIDC_DISCOVERY_PATH).toBe("/.well-known/openid-configuration");
  });

  test("the default scopes ask for openid", () => {
    expect(includesRequiredOidcScope(DEFAULT_OIDC_SCOPES)).toBe(true);
  });
});

describe("getOidcDiscoveryUrl", () => {
  test.each([
    [
      "Google",
      "https://accounts.google.com",
      "https://accounts.google.com/.well-known/openid-configuration",
    ],
    [
      "Okta",
      "https://dev-123456.okta.com/oauth2/default",
      "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
    ],
    [
      "Auth0, whose issuer ends in a slash",
      "https://acme.us.auth0.com/",
      "https://acme.us.auth0.com/.well-known/openid-configuration",
    ],
    [
      "Microsoft Entra ID",
      "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0/.well-known/openid-configuration",
    ],
    [
      "Keycloak on a private network",
      "http://172.17.0.2:8080/realms/acme",
      "http://172.17.0.2:8080/realms/acme/.well-known/openid-configuration",
    ],
  ])(
    "%s: the issuer, then /.well-known/openid-configuration",
    (_provider: string, issuer: string, discoveryUrl: string) => {
      expect(getOidcDiscoveryUrl(issuer)).toBe(discoveryUrl);
    },
  );

  test("drops spaces around the issuer and every trailing slash", () => {
    expect(getOidcDiscoveryUrl("  https://accounts.example.com//  ")).toBe(
      "https://accounts.example.com/.well-known/openid-configuration",
    );
  });

  test.each([undefined, null, "", "   "])(
    "is empty without an issuer (%p)",
    (issuer: string | null | undefined) => {
      expect(getOidcDiscoveryUrl(issuer)).toBe("");
    },
  );

  test("a discovery URL given as the issuer is its own discovery URL, never doubled", () => {
    expect(
      getOidcDiscoveryUrl(
        "https://accounts.google.com/.well-known/openid-configuration",
      ),
    ).toBe("https://accounts.google.com/.well-known/openid-configuration");
  });
});

describe("splitOidcDiscoveryUrl", () => {
  test("splits a discovery URL into the issuer in front of it and the URL", () => {
    expect(
      splitOidcDiscoveryUrl(
        "https://accounts.google.com/.well-known/openid-configuration",
      ),
    ).toEqual({
      issuerURL: "https://accounts.google.com",
      discoveryURL:
        "https://accounts.google.com/.well-known/openid-configuration",
    });

    expect(
      splitOidcDiscoveryUrl(
        "http://172.17.0.2:8080/realms/acme/.well-known/openid-configuration",
      ),
    ).toEqual({
      issuerURL: "http://172.17.0.2:8080/realms/acme",
      discoveryURL:
        "http://172.17.0.2:8080/realms/acme/.well-known/openid-configuration",
    });
  });

  test("reads it pasted with spaces, a trailing slash or other casing", () => {
    expect(
      splitOidcDiscoveryUrl(
        "  https://accounts.example.com/.Well-Known/OpenID-Configuration/ ",
      ),
    ).toEqual({
      issuerURL: "https://accounts.example.com",
      discoveryURL:
        "https://accounts.example.com/.well-known/openid-configuration",
    });
  });

  test("keeps the query a provider needs (Azure AD B2C names its policy in it), and drops a fragment", () => {
    expect(
      splitOidcDiscoveryUrl(
        "https://acme.b2clogin.com/acme.onmicrosoft.com/v2.0/.well-known/openid-configuration?p=B2C_1_signin#top",
      ),
    ).toEqual({
      issuerURL: "https://acme.b2clogin.com/acme.onmicrosoft.com/v2.0",
      discoveryURL:
        "https://acme.b2clogin.com/acme.onmicrosoft.com/v2.0/.well-known/openid-configuration?p=B2C_1_signin",
    });
  });

  test.each([
    ["an issuer", "https://accounts.google.com"],
    ["an issuer ending in a slash", "https://acme.us.auth0.com/"],
    [
      "the path with nothing in front of it",
      "/.well-known/openid-configuration",
    ],
    [
      "a URL that only mentions the path",
      "https://example.com/.well-known/openid-configuration/extra",
    ],
    [
      "another well-known document",
      "https://example.com/.well-known/jwks.json",
    ],
    ["nothing", ""],
  ])("is null for %s", (_label: string, value: string) => {
    expect(splitOidcDiscoveryUrl(value)).toBeNull();
  });

  test("is null for anything that is not text", () => {
    expect(splitOidcDiscoveryUrl(undefined)).toBeNull();
    expect(splitOidcDiscoveryUrl(null)).toBeNull();
  });
});

describe("getOidcIssuerFromValue", () => {
  test("is the issuer in front of a pasted discovery URL", () => {
    expect(
      getOidcIssuerFromValue(
        "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
      ),
    ).toBe("https://dev-123456.okta.com/oauth2/default");
  });

  test("is an issuer itself, trimmed, kept exactly otherwise - the iss claim is compared exactly", () => {
    expect(getOidcIssuerFromValue(" https://acme.us.auth0.com/ ")).toBe(
      "https://acme.us.auth0.com/",
    );
    expect(getOidcIssuerFromValue("https://Accounts.Example.com")).toBe(
      "https://Accounts.Example.com",
    );
    expect(getOidcIssuerFromValue(undefined)).toBe("");
  });
});

describe("isDefaultOidcDiscoveryUrl", () => {
  test("no discovery URL yet follows the issuer", () => {
    for (const discoveryURL of [undefined, null, "", "  "]) {
      expect(
        isDefaultOidcDiscoveryUrl({
          discoveryURL,
          issuerURL: "https://accounts.example.com",
        }),
      ).toBe(true);
    }
  });

  test("the issuer's own discovery URL follows it", () => {
    expect(
      isDefaultOidcDiscoveryUrl({
        discoveryURL:
          "https://accounts.example.com/.well-known/openid-configuration",
        issuerURL: "https://accounts.example.com",
      }),
    ).toBe(true);
  });

  test("so does the same URL as the database writes it back (a URL object, another case, a trailing slash)", () => {
    expect(
      isDefaultOidcDiscoveryUrl({
        discoveryURL: URL.fromString(
          "https://accounts.example.com/.well-known/openid-configuration",
        ),
        issuerURL: "https://accounts.example.com",
      }),
    ).toBe(true);

    expect(
      isDefaultOidcDiscoveryUrl({
        discoveryURL:
          "HTTPS://ACCOUNTS.EXAMPLE.COM/.well-known/openid-configuration/",
        issuerURL: "https://accounts.example.com/",
      }),
    ).toBe(true);
  });

  test("one set by hand, for a provider that publishes it elsewhere, does not", () => {
    expect(
      isDefaultOidcDiscoveryUrl({
        discoveryURL: "https://sso.example.com/metadata/openid-configuration",
        issuerURL: "https://accounts.example.com",
      }),
    ).toBe(false);
  });

  test("another issuer's discovery URL does not, and a path's case matters", () => {
    expect(
      isDefaultOidcDiscoveryUrl({
        discoveryURL:
          "https://accounts.google.com/.well-known/openid-configuration",
        issuerURL: "https://accounts.example.com",
      }),
    ).toBe(false);

    expect(
      isDefaultOidcDiscoveryUrl({
        discoveryURL:
          "https://accounts.example.com/Realms/.well-known/openid-configuration",
        issuerURL: "https://accounts.example.com/realms",
      }),
    ).toBe(false);
  });

  test("a discovery URL with no issuer to give one is set by hand", () => {
    expect(
      isDefaultOidcDiscoveryUrl({
        discoveryURL:
          "https://accounts.example.com/.well-known/openid-configuration",
        issuerURL: "",
      }),
    ).toBe(false);
  });
});

describe("isOidcIssuerUrl", () => {
  test.each([
    "https://accounts.google.com",
    "http://172.17.0.2:8080/realms/acme",
    "  HTTPS://Accounts.Example.com/  ",
  ])("accepts %p", (issuer: string) => {
    expect(isOidcIssuerUrl(issuer)).toBe(true);
  });

  test.each([
    "accounts.google.com",
    "https://",
    "ftp://accounts.example.com",
    "javascript:alert(1)",
    "",
  ])("refuses %p", (issuer: string) => {
    expect(isOidcIssuerUrl(issuer)).toBe(false);
  });

  test("refuses anything that is not text", () => {
    expect(isOidcIssuerUrl(undefined)).toBe(false);
    expect(isOidcIssuerUrl(null)).toBe(false);
  });
});

describe("scopes", () => {
  test("are read one by one, whatever the spacing", () => {
    expect(getOidcScopeList("  openid   email\tprofile\n")).toEqual([
      "openid",
      "email",
      "profile",
    ]);
    expect(getOidcScopeList("")).toEqual([]);
    expect(getOidcScopeList(undefined)).toEqual([]);
  });

  test("must ask for openid, as a scope of its own", () => {
    expect(includesRequiredOidcScope("email openid")).toBe(true);
    expect(includesRequiredOidcScope("email profile")).toBe(false);
    expect(includesRequiredOidcScope("openidx email")).toBe(false);
    expect(includesRequiredOidcScope("OPENID email")).toBe(false);
    expect(includesRequiredOidcScope(null)).toBe(false);
  });
});

describe("fillOidcProviderDefaults: a provider created with only what the identity provider gives", () => {
  const essentials: () => OidcProviderDefaultFields = () => {
    return {
      name: "Okta",
      issuerURL: "https://dev-123456.okta.com/oauth2/default",
    };
  };

  test("gets the discovery URL, the usual scopes and claim names, and a description", () => {
    const provider: OidcProviderDefaultFields = essentials();

    fillOidcProviderDefaults(provider);

    expect(provider.discoveryURL).toBeInstanceOf(URL);
    expect(provider.discoveryURL?.toString()).toBe(
      "https://dev-123456.okta.com/oauth2/default/.well-known/openid-configuration",
    );
    expect(provider.scopes).toBe("openid email profile");
    expect(provider.emailClaimName).toBe("email");
    expect(provider.nameClaimName).toBe("name");
    expect(provider.description).toBe("Sign in with Okta");
    expect(provider.issuerURL).toBe(
      "https://dev-123456.okta.com/oauth2/default",
    );
  });

  test("keeps every value the caller sent", () => {
    const provider: OidcProviderDefaultFields = {
      name: "Okta",
      description: "Staff only",
      issuerURL: "https://dev-123456.okta.com/oauth2/default",
      discoveryURL: URL.fromString(
        "https://sso.example.com/metadata/openid-configuration",
      ),
      scopes: "openid email",
      emailClaimName: "upn",
      nameClaimName: "preferred_username",
    };

    fillOidcProviderDefaults(provider);

    expect(provider.description).toBe("Staff only");
    expect(provider.discoveryURL?.toString()).toBe(
      "https://sso.example.com/metadata/openid-configuration",
    );
    expect(provider.scopes).toBe("openid email");
    expect(provider.emailClaimName).toBe("upn");
    expect(provider.nameClaimName).toBe("preferred_username");
  });

  test("keeps a discovery URL an API caller sent as text", () => {
    const provider: OidcProviderDefaultFields = {
      ...essentials(),
      discoveryURL:
        "https://sso.example.com/metadata/openid-configuration" as unknown as URL,
    };

    fillOidcProviderDefaults(provider);

    expect(String(provider.discoveryURL)).toBe(
      "https://sso.example.com/metadata/openid-configuration",
    );
  });

  test("reads blank values as left out", () => {
    const provider: OidcProviderDefaultFields = {
      ...essentials(),
      description: " ",
      scopes: "",
      emailClaimName: "  ",
      nameClaimName: "",
    };

    fillOidcProviderDefaults(provider);

    expect(provider).toMatchObject({
      description: "Sign in with Okta",
      scopes: DEFAULT_OIDC_SCOPES,
      emailClaimName: DEFAULT_OIDC_EMAIL_CLAIM_NAME,
      nameClaimName: DEFAULT_OIDC_NAME_CLAIM_NAME,
    });
  });

  test("splits a discovery URL sent as the issuer into the issuer and its discovery URL", () => {
    const provider: OidcProviderDefaultFields = {
      name: "Google",
      issuerURL:
        " https://accounts.google.com/.well-known/openid-configuration ",
    };

    fillOidcProviderDefaults(provider);

    expect(provider.issuerURL).toBe("https://accounts.google.com");
    expect(provider.discoveryURL?.toString()).toBe(
      "https://accounts.google.com/.well-known/openid-configuration",
    );
  });

  test("when it splits one, a discovery URL the caller sent still wins", () => {
    const provider: OidcProviderDefaultFields = {
      name: "Google",
      issuerURL: "https://accounts.google.com/.well-known/openid-configuration",
      discoveryURL: URL.fromString(
        "https://sso.example.com/metadata/openid-configuration",
      ),
    };

    fillOidcProviderDefaults(provider);

    expect(provider.issuerURL).toBe("https://accounts.google.com");
    expect(provider.discoveryURL?.toString()).toBe(
      "https://sso.example.com/metadata/openid-configuration",
    );
  });

  test("keeps an issuer's trailing slash (Auth0 issues tokens with it) and drops only the spaces around it", () => {
    const provider: OidcProviderDefaultFields = {
      name: "Auth0",
      issuerURL: "  https://acme.us.auth0.com/  ",
    };

    fillOidcProviderDefaults(provider);

    expect(provider.issuerURL).toBe("https://acme.us.auth0.com/");
    expect(provider.discoveryURL?.toString()).toBe(
      "https://acme.us.auth0.com/.well-known/openid-configuration",
    );
  });

  test("works no discovery URL out of an issuer that is not a URL, so the required-field check names it", () => {
    const provider: OidcProviderDefaultFields = {
      name: "Okta",
      issuerURL: "dev-123456.okta.com",
    };

    fillOidcProviderDefaults(provider);

    expect(provider.discoveryURL).toBeUndefined();
    // Everything that does not depend on the issuer is still filled in.
    expect(provider.scopes).toBe(DEFAULT_OIDC_SCOPES);
    expect(provider.description).toBe("Sign in with Okta");
  });

  test("works nothing out of a missing issuer or name", () => {
    const provider: OidcProviderDefaultFields = {};

    fillOidcProviderDefaults(provider);

    expect(provider.issuerURL).toBeUndefined();
    expect(provider.discoveryURL).toBeUndefined();
    expect(provider.description).toBeUndefined();
    expect(provider.scopes).toBe(DEFAULT_OIDC_SCOPES);
    expect(provider.emailClaimName).toBe(DEFAULT_OIDC_EMAIL_CLAIM_NAME);
    expect(provider.nameClaimName).toBe(DEFAULT_OIDC_NAME_CLAIM_NAME);
  });
});
