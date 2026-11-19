import {
  buildIdentityProviderSignOutUrl,
  getPostLogoutRedirectUri,
  IDENTITY_PROVIDER_SIGN_OUT_ENCRYPTED_FIELDS,
  IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD,
  IdentityProviderSignOutRecord,
  isSamlIdentityProviderSignOutRecord,
  isUsableEndSessionEndpoint,
  isUsableIdentityProviderSignOutUrl,
  isUsableIdToken,
  isUsableSamlSignOutValue,
  isUsableSingleLogoutUrl,
  MAX_END_SESSION_ENDPOINT_LENGTH,
  MAX_ID_TOKEN_LENGTH,
  MAX_IDENTITY_PROVIDER_SIGN_OUT_URL_LENGTH,
  MAX_SAML_SIGN_OUT_VALUE_LENGTH,
  readIdentityProviderSignOutRecord,
  SamlIdentityProviderSignOutRecord,
} from "../../../Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { describe, expect, test } from "@jest/globals";

/*
 * What a sign-out at the identity provider is built from (#9535): the
 * address a browser may be sent to, the ID token it may carry, the record a
 * session keeps, and the logout request OneUptime sends the browser with
 * (OpenID Connect RP-Initiated Logout 1.0). Pure functions, read by the
 * server and the dashboards alike.
 */

// A signed ID token's shape: three base64url parts.
const ID_TOKEN: string =
  "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJhdWQiOiJvbmV1cHRpbWUifQ.c2lnbmF0dXJl";

const RECORD: IdentityProviderSignOutRecord = {
  providerType: SsoProviderType.GlobalOIDC,
  providerId: "8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a",
  endSessionEndpoint: "https://idp.example.com/oauth2/v1/logout",
  idToken: ID_TOKEN,
};

describe("getPostLogoutRedirectUri", () => {
  test("is OneUptime's own sign-in page, where every sign-out has ended", () => {
    expect(
      getPostLogoutRedirectUri({
        httpProtocol: "https://",
        host: "oneuptime.example.com",
      }),
    ).toBe("https://oneuptime.example.com/accounts");
  });

  test("keeps a self-hosted server's port and plain http", () => {
    expect(
      getPostLogoutRedirectUri({
        httpProtocol: "http://",
        host: "localhost:8080",
      }),
    ).toBe("http://localhost:8080/accounts");
  });
});

describe("isUsableEndSessionEndpoint", () => {
  test.each([
    "https://idp.example.com/oauth2/v1/logout",
    "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/logout",
    "https://idp.example.com/realms/acme/protocol/openid-connect/logout",
    // An identity provider on the installation's own network.
    "http://keycloak.internal:8080/realms/acme/protocol/openid-connect/logout",
    // Azure AD B2C names its sign-in policy in the query.
    "https://acme.b2clogin.com/acme.onmicrosoft.com/oauth2/v2.0/logout?p=b2c_1_signin",
  ])("takes %s", (endpoint: string) => {
    expect(isUsableEndSessionEndpoint(endpoint)).toBe(true);
  });

  test.each([
    ["a javascript: address", "javascript:alert(document.cookie)"],
    ["a data: address", "data:text/html,<script>alert(1)</script>"],
    ["a relative path", "/oauth2/v1/logout"],
    ["an address with a user name", "https://user:pass@idp.example.com/logout"],
    ["an address with a fragment", "https://idp.example.com/logout#x"],
    ["spaces around it", " https://idp.example.com/logout "],
    ["an empty text", ""],
    ["no text at all", undefined],
    ["a number", 42],
    [
      "an address longer than any provider's",
      `https://idp.example.com/${"a".repeat(MAX_END_SESSION_ENDPOINT_LENGTH)}`,
    ],
  ])("refuses %s", (_: string, endpoint: unknown) => {
    expect(isUsableEndSessionEndpoint(endpoint)).toBe(false);
  });
});

describe("isUsableIdToken", () => {
  test("takes a signed token's three parts and an encrypted token's five", () => {
    expect(isUsableIdToken(ID_TOKEN)).toBe(true);
    expect(isUsableIdToken("aGVhZGVy.a2V5.aXY.Y2lwaGVy.dGFn")).toBe(true);
  });

  test.each([
    ["no text", undefined],
    ["an empty text", ""],
    ["a single part", "not-a-jwt"],
    ["four parts", "a.b.c.d"],
    ["characters no JWT has", "a.b.c<script>"],
    [
      "a token longer than any provider's",
      `a.${"b".repeat(MAX_ID_TOKEN_LENGTH)}.c`,
    ],
  ])("refuses %s", (_: string, token: unknown) => {
    expect(isUsableIdToken(token)).toBe(false);
  });
});

describe("readIdentityProviderSignOutRecord", () => {
  test("reads a whole record back", () => {
    expect(readIdentityProviderSignOutRecord({ ...RECORD })).toEqual(RECORD);
  });

  test("reads a project provider's record", () => {
    expect(
      readIdentityProviderSignOutRecord({
        ...RECORD,
        providerType: SsoProviderType.ProjectOIDC,
      }),
    ).toEqual({ ...RECORD, providerType: SsoProviderType.ProjectOIDC });
  });

  test("takes nothing else along", () => {
    expect(
      readIdentityProviderSignOutRecord({
        ...RECORD,
        refreshToken: "should-never-ride-along",
      }),
    ).toEqual(RECORD);
  });

  test.each([
    ["nothing", null],
    ["a list", [RECORD]],
    ["text", "a record"],
    [
      "a SAML provider's",
      { ...RECORD, providerType: SsoProviderType.GlobalSSO },
    ],
    ["no provider", { ...RECORD, providerId: "" }],
    [
      "an endpoint nobody may be sent to",
      { ...RECORD, endSessionEndpoint: "javascript:alert(1)" },
    ],
    ["no ID token", { ...RECORD, idToken: undefined }],
  ])("is null for %s", (_: string, value: unknown) => {
    expect(readIdentityProviderSignOutRecord(value)).toBeNull();
  });
});

describe("buildIdentityProviderSignOutUrl", () => {
  const POST_LOGOUT_REDIRECT_URI: string =
    "https://oneuptime.example.com/accounts";

  function build(
    overrides: Partial<{
      endSessionEndpoint: string;
      idToken: string;
      clientId: string;
    }> = {},
  ): string | null {
    return buildIdentityProviderSignOutUrl({
      endSessionEndpoint: RECORD.endSessionEndpoint,
      idToken: RECORD.idToken,
      clientId: "oneuptime-client",
      postLogoutRedirectUri: POST_LOGOUT_REDIRECT_URI,
      ...overrides,
    });
  }

  test("sends the browser to the provider's end_session_endpoint with the hint, the client and the way back", () => {
    const url: globalThis.URL = new globalThis.URL(build()!);

    expect(`${url.origin}${url.pathname}`).toBe(RECORD.endSessionEndpoint);
    expect(url.searchParams.get("id_token_hint")).toBe(ID_TOKEN);
    expect(url.searchParams.get("client_id")).toBe("oneuptime-client");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
      POST_LOGOUT_REDIRECT_URI,
    );
  });

  test("encodes what it carries, so the way back is one parameter", () => {
    expect(build()).toContain(
      `post_logout_redirect_uri=${encodeURIComponent(POST_LOGOUT_REDIRECT_URI)}`,
    );
  });

  test("keeps the query the endpoint already has", () => {
    const url: globalThis.URL = new globalThis.URL(
      build({
        endSessionEndpoint:
          "https://acme.b2clogin.com/acme.onmicrosoft.com/oauth2/v2.0/logout?p=b2c_1_signin",
      })!,
    );

    expect(url.searchParams.get("p")).toBe("b2c_1_signin");
    expect(url.searchParams.get("id_token_hint")).toBe(ID_TOKEN);
  });

  test("a parameter the endpoint already names is OneUptime's, once", () => {
    const url: globalThis.URL = new globalThis.URL(
      build({
        endSessionEndpoint:
          "https://idp.example.com/logout?post_logout_redirect_uri=https://evil.example.com",
      })!,
    );

    expect(url.searchParams.getAll("post_logout_redirect_uri")).toEqual([
      POST_LOGOUT_REDIRECT_URI,
    ]);
  });

  test.each([
    [
      "an endpoint nobody may be sent to",
      { endSessionEndpoint: "javascript:alert(1)" },
    ],
    ["an ID token that is not one", { idToken: "not-a-jwt" }],
    ["no client ID", { clientId: "" }],
  ])("is null for %s", (_: string, overrides: Record<string, string>) => {
    expect(build(overrides)).toBeNull();
  });
});

describe("what the server and the dashboards agree on", () => {
  test("the sign-out's answer names the address in one field", () => {
    expect(IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD).toBe(
      "identityProviderSignOutUrl",
    );
  });

  /*
   * An OIDC sign-in's ID token, and the person and the session a SAML
   * sign-in names (#9603): each kind encrypts its own.
   */
  test("the ID token, the Name ID and the session index are the secrets a session keeps encrypted", () => {
    expect(IDENTITY_PROVIDER_SIGN_OUT_ENCRYPTED_FIELDS).toEqual([
      "idToken",
      "nameId",
      "sessionIndex",
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A SAML SIGN-IN'S RECORD (#9603): WHAT A LOGOUTREQUEST NAMES THE PERSON AND
 * THEIR SESSION BY.
 * ---------------------------------------------------------------------------
 */

const SAML_RECORD: SamlIdentityProviderSignOutRecord = {
  providerType: SsoProviderType.ProjectSSO,
  providerId: "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a",
  nameId: "dana.scully@example.com",
  nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  nameIdNameQualifier: "https://idp.example.com/realms/acme",
  nameIdSpNameQualifier: "https://oneuptime.example.com/sp",
  sessionIndex: "_be9967abd904ddcae3c0eb4189adbe3f71e327cf93",
};

describe("readIdentityProviderSignOutRecord, for a SAML sign-in", () => {
  test("reads a whole record back", () => {
    expect(readIdentityProviderSignOutRecord({ ...SAML_RECORD })).toEqual(
      SAML_RECORD,
    );
  });

  test("reads a Global provider's record", () => {
    expect(
      readIdentityProviderSignOutRecord({
        ...SAML_RECORD,
        providerType: SsoProviderType.GlobalSSO,
      }),
    ).toEqual({ ...SAML_RECORD, providerType: SsoProviderType.GlobalSSO });
  });

  test("reads one with the Name ID alone, as an assertion without a Format, qualifiers or SessionIndex gives it", () => {
    const bare: SamlIdentityProviderSignOutRecord = {
      providerType: SsoProviderType.GlobalSSO,
      providerId: SAML_RECORD.providerId,
      nameId: SAML_RECORD.nameId,
    };

    expect(readIdentityProviderSignOutRecord(bare)).toEqual(bare);
    expect(
      readIdentityProviderSignOutRecord({
        ...bare,
        nameIdFormat: null,
        sessionIndex: undefined,
      }),
    ).toEqual(bare);
  });

  test("takes nothing else along: not an OIDC record's fields, nor anything else", () => {
    expect(
      readIdentityProviderSignOutRecord({
        ...SAML_RECORD,
        idToken: ID_TOKEN,
        endSessionEndpoint: "https://idp.example.com/logout",
        refreshToken: "should-never-ride-along",
      }),
    ).toEqual(SAML_RECORD);
  });

  test.each([
    ["no Name ID", { nameId: undefined }],
    ["an empty Name ID", { nameId: "" }],
    ["a Name ID with space around it", { nameId: " dana.scully@example.com" }],
    [
      "a Name ID longer than any",
      { nameId: `${"a".repeat(MAX_SAML_SIGN_OUT_VALUE_LENGTH)}@example.com` },
    ],
    ["a Name ID XML cannot carry", { nameId: "dana\u0000@example.com" }],
    ["a Name ID that is not text", { nameId: 42 }],
    ["a Format that is not text", { nameIdFormat: 42 }],
    ["an empty session index", { sessionIndex: "" }],
    [
      "a session index longer than any",
      { sessionIndex: "_".repeat(MAX_SAML_SIGN_OUT_VALUE_LENGTH + 1) },
    ],
    ["no provider", { providerId: "" }],
    ["a provider type of no kind", { providerType: "StatusPageSSO" }],
  ])("is null for %s", (_: string, change: Record<string, unknown>) => {
    expect(
      readIdentityProviderSignOutRecord({ ...SAML_RECORD, ...change }),
    ).toBeNull();
  });

  test("an OIDC provider's type with a SAML record's fields is no record", () => {
    expect(
      readIdentityProviderSignOutRecord({
        ...SAML_RECORD,
        providerType: SsoProviderType.GlobalOIDC,
      }),
    ).toBeNull();
  });

  test("tells the two kinds apart", () => {
    expect(isSamlIdentityProviderSignOutRecord(SAML_RECORD)).toBe(true);
    expect(
      isSamlIdentityProviderSignOutRecord({
        ...SAML_RECORD,
        providerType: SsoProviderType.GlobalSSO,
      }),
    ).toBe(true);
    expect(isSamlIdentityProviderSignOutRecord(RECORD)).toBe(false);
  });
});

describe("isUsableSamlSignOutValue", () => {
  test.each([
    "dana.scully@example.com",
    "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
    "_be9967abd904ddcae3c0eb4189adbe3f71e327cf93",
    // Text an assertion may carry, which a LogoutRequest escapes again.
    `a&b<c>"d'@example.com`,
    "x".repeat(MAX_SAML_SIGN_OUT_VALUE_LENGTH),
  ])("takes %s", (value: string) => {
    expect(isUsableSamlSignOutValue(value)).toBe(true);
  });

  test.each([
    ["no text", undefined],
    ["an empty text", ""],
    ["space around it", " x "],
    ["a control character", "x\u0007y"],
    ["a noncharacter", "x\uFFFEy"],
    ["a value longer than any", "x".repeat(MAX_SAML_SIGN_OUT_VALUE_LENGTH + 1)],
  ])("refuses %s", (_: string, value: unknown) => {
    expect(isUsableSamlSignOutValue(value)).toBe(false);
  });
});

describe("isUsableSingleLogoutUrl", () => {
  test.each([
    "https://login.microsoftonline.com/aaaabbbb-0000-cccc-1111-dddd2222eeee/saml2",
    "https://acme.okta.com/app/acme_oneuptime_1/exk1fcia6d6EMsf331d8/slo/saml",
    "http://keycloak.internal:8080/realms/acme/protocol/saml",
    "https://adfs.example.com/adfs/ls/?wa=wsignout1.0",
  ])("takes %s", (address: string) => {
    expect(isUsableSingleLogoutUrl(address)).toBe(true);
  });

  test.each([
    ["a javascript: address", "javascript:alert(document.cookie)"],
    ["a relative path", "/adfs/ls/"],
    ["an address with a user name", "https://user:pass@idp.example.com/slo"],
    ["an address with a fragment", "https://idp.example.com/slo#x"],
    ["no text", null],
    [
      "an address longer than any provider's",
      `https://idp.example.com/${"a".repeat(MAX_END_SESSION_ENDPOINT_LENGTH)}`,
    ],
  ])("refuses %s", (_: string, address: unknown) => {
    expect(isUsableSingleLogoutUrl(address)).toBe(false);
  });
});

/*
 * The address the sign-out page is sent to carries a whole ID token, or a
 * whole signed LogoutRequest: an ID token with many claims made it longer
 * than an endpoint's 2048 characters, and the page refused it - the person
 * was signed out of OneUptime alone (#9603).
 */
describe("isUsableIdentityProviderSignOutUrl", () => {
  test("takes the address a provider whose ID tokens carry many claims makes", () => {
    const longIdToken: string = `eyJhbGciOiJSUzI1NiJ9.${"a".repeat(6000)}.c2lnbmF0dXJl`;

    const address: string = buildIdentityProviderSignOutUrl({
      endSessionEndpoint: RECORD.endSessionEndpoint,
      idToken: longIdToken,
      clientId: "oneuptime-client",
      postLogoutRedirectUri: "https://oneuptime.example.com/accounts",
    })!;

    expect(address.length).toBeGreaterThan(MAX_END_SESSION_ENDPOINT_LENGTH);
    expect(isUsableEndSessionEndpoint(address)).toBe(false);
    expect(isUsableIdentityProviderSignOutUrl(address)).toBe(true);
  });

  test.each([
    ["a javascript: address", "javascript:alert(document.cookie)"],
    ["a data: address", "data:text/html,<script>alert(1)</script>"],
    ["an address with a user name", "https://user:pass@idp.example.com/slo"],
    [
      "an address longer than any sign-out's",
      `https://idp.example.com/${"a".repeat(MAX_IDENTITY_PROVIDER_SIGN_OUT_URL_LENGTH)}`,
    ],
  ])("refuses %s", (_: string, address: string) => {
    expect(isUsableIdentityProviderSignOutUrl(address)).toBe(false);
  });
});
