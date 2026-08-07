/*
 * End-to-end tests for the OIDC login path (OIDCUtil).
 *
 * These run against a real OpenID Provider served on a loopback socket
 * (Tests/Identity/OidcTestIdp.ts) rather than a stubbed openid-client. That
 * distinction matters: almost everything protecting an OIDC login happens
 * inside the library and the network exchange — the ID token signature is
 * verified against the JWKS the discovery document advertises, `aud` is matched
 * to the client, `exp` is enforced, the nonce is compared with the one the
 * authorization request carried, and the PKCE `code_verifier` is presented at
 * the token endpoint. Stubbing the client would assert the stub instead.
 *
 * The claim sets under "real provider payloads" are transcribed from ID tokens
 * those providers actually issue, with tenant ids, subject ids and names
 * replaced. They are the reason this file exists: `email` and `name` differ
 * enough between vendors — Entra ID puts the address in `preferred_username`
 * and may send no `email` at all, Google sends `email_verified` as a string,
 * Auth0 sets `name` to the address when there is no profile — that a single
 * generic happy path proves very little about whether a given customer can sign
 * in.
 */
import OIDCUtil, {
  OidcCallbackResult,
} from "../../FeatureSet/Identity/Utils/OIDC";
import {
  IdpKeyPair,
  IdpOptions,
  TestIdp,
  TokenRequest,
  computeAtHash,
  generateIdpKeyPair,
  startTestIdp,
} from "./OidcTestIdp";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";
import { Client } from "openid-client";

const CLIENT_ID: string = "0oa1b2c3d4E5F6G7h8i9";
const CLIENT_SECRET: string = "sUpErSeCrEtClientValue-0123456789";
const REDIRECT_URI: string =
  "https://oneuptime.example.com/identity/oidc-callback/6570b1d3e2f4a5c6d7e8f901/6570b1d3e2f4a5c6d7e8f902";
const DEFAULT_SCOPES: string = "openid email profile";

// The nonce the provider echoes into the ID token on the happy path.
const NONCE: string = "n-0S6_WzA2Mj-nonce-value";

let runningIdps: Array<TestIdp> = [];

afterEach(async () => {
  const idps: Array<TestIdp> = runningIdps;
  runningIdps = [];

  for (const idp of idps) {
    await idp.close();
  }
});

type StartIdpOptions = Omit<IdpOptions, "clientId"> & {
  clientId?: string | undefined;
};

async function startIdp(options: StartIdpOptions = {}): Promise<TestIdp> {
  const idp: TestIdp = await startTestIdp({
    ...options,
    clientId: options.clientId ?? CLIENT_ID,
  });

  runningIdps.push(idp);

  return idp;
}

async function createClientFor(idp: TestIdp): Promise<Client> {
  return OIDCUtil.createClient({
    discoveryURL: URL.fromString(idp.issuerUrl),
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: URL.fromString(REDIRECT_URI),
    scopes: DEFAULT_SCOPES,
  });
}

interface CallbackOverrides {
  expectedIssuer?: string | undefined;
  expectedNonce?: string | undefined;
  expectedState?: string | undefined;
  codeVerifier?: string | undefined;
  callbackParams?: Record<string, string> | undefined;
  emailClaimName?: string | undefined;
  nameClaimName?: string | undefined;
  phoneClaimName?: string | undefined;
}

/*
 * Drive the callback exactly as the /oidc-callback route does: the state,
 * nonce and code verifier stand in for the ones the authorization request
 * stashed in the signed state cookie.
 */
async function runCallback(
  idp: TestIdp,
  overrides: CallbackOverrides = {},
): Promise<OidcCallbackResult> {
  const client: Client = await createClientFor(idp);
  const state: string = overrides.expectedState ?? OIDCUtil.generateState();

  return OIDCUtil.exchangeCodeAndValidate({
    client,
    redirectUri: URL.fromString(REDIRECT_URI),
    expectedIssuer: overrides.expectedIssuer ?? idp.issuerUrl,
    expectedNonce: overrides.expectedNonce ?? NONCE,
    expectedState: state,
    codeVerifier: overrides.codeVerifier ?? OIDCUtil.generateCodeVerifier(),
    callbackParams: overrides.callbackParams ?? {
      code: "authorization-code-from-idp",
      state,
    },
    emailClaimName: overrides.emailClaimName ?? "email",
    nameClaimName: overrides.nameClaimName ?? "name",
    phoneClaimName: overrides.phoneClaimName,
  });
}

describe("OIDCUtil - PKCE and random value generation", () => {
  /*
   * RFC 7636 Appendix B. Pinned to the spec's own vector rather than to our
   * output: if this stops being base64url(SHA256(verifier)) every provider
   * rejects the token request, and a self-referential test would not notice.
   */
  test("code challenge matches the RFC 7636 Appendix B test vector", () => {
    expect(
      OIDCUtil.generateCodeChallenge(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      ),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("code challenge is unpadded base64url", () => {
    const challenge: string = OIDCUtil.generateCodeChallenge(
      OIDCUtil.generateCodeVerifier(),
    );

    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toContain("=");
  });

  test("code verifier satisfies the RFC 7636 length and alphabet rules", () => {
    const verifier: string = OIDCUtil.generateCodeVerifier();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  test("state, nonce and verifier are unpredictable across calls", () => {
    const states: Set<string> = new Set<string>();
    const nonces: Set<string> = new Set<string>();
    const verifiers: Set<string> = new Set<string>();

    for (let i: number = 0; i < 50; i++) {
      states.add(OIDCUtil.generateState());
      nonces.add(OIDCUtil.generateNonce());
      verifiers.add(OIDCUtil.generateCodeVerifier());
    }

    expect(states.size).toBe(50);
    expect(nonces.size).toBe(50);
    expect(verifiers.size).toBe(50);
  });

  test("state and nonce carry enough entropy to be replay guards", () => {
    expect(OIDCUtil.generateState().length).toBeGreaterThanOrEqual(32);
    expect(OIDCUtil.generateNonce().length).toBeGreaterThanOrEqual(32);
  });
});

describe("OIDCUtil - discovery and the authorization request", () => {
  test("discovers a provider and builds a client against its endpoints", async () => {
    const idp: TestIdp = await startIdp({});
    const client: Client = await createClientFor(idp);

    expect(client.issuer.metadata["issuer"]).toBe(idp.issuerUrl);
    expect(client.issuer.metadata["authorization_endpoint"]).toBe(
      `${idp.issuerUrl}/authorize`,
    );
    expect(client.issuer.metadata["token_endpoint"]).toBe(
      `${idp.issuerUrl}/token`,
    );
    expect(client.issuer.metadata["jwks_uri"]).toBe(`${idp.issuerUrl}/jwks`);
  });

  test("the authorization URL carries every parameter the flow depends on", async () => {
    const idp: TestIdp = await startIdp({});
    const client: Client = await createClientFor(idp);

    const verifier: string = OIDCUtil.generateCodeVerifier();
    const challenge: string = OIDCUtil.generateCodeChallenge(verifier);

    const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
      client,
      scopes: DEFAULT_SCOPES,
      state: "state-abc",
      nonce: "nonce-xyz",
      codeChallenge: challenge,
    });

    const params: URLSearchParams = new URLSearchParams(
      authorizationUrl.toString().split("?")[1] || "",
    );

    expect(authorizationUrl.toString()).toContain(`${idp.issuerUrl}/authorize`);
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(params.get("scope")).toBe(DEFAULT_SCOPES);
    expect(params.get("state")).toBe("state-abc");
    expect(params.get("nonce")).toBe("nonce-xyz");
    expect(params.get("code_challenge")).toBe(challenge);
    expect(params.get("code_challenge_method")).toBe("S256");
  });

  /*
   * The client secret is a credential; it belongs in the back-channel token
   * request, never in a URL the browser (and its history, and any referrer)
   * gets to see.
   */
  test("the authorization URL never carries the client secret", async () => {
    const idp: TestIdp = await startIdp({});
    const client: Client = await createClientFor(idp);

    const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
      client,
      scopes: DEFAULT_SCOPES,
      state: "state-abc",
      nonce: "nonce-xyz",
      codeChallenge: OIDCUtil.generateCodeChallenge(
        OIDCUtil.generateCodeVerifier(),
      ),
    });

    expect(authorizationUrl.toString()).not.toContain(CLIENT_SECRET);
  });

  test("requested scopes are passed through verbatim", async () => {
    const idp: TestIdp = await startIdp({});
    const client: Client = await createClientFor(idp);

    const authorizationUrl: URL = OIDCUtil.generateAuthorizationUrl({
      client,
      scopes: "openid email profile groups offline_access",
      state: "s",
      nonce: "n",
      codeChallenge: "c",
    });

    const params: URLSearchParams = new URLSearchParams(
      authorizationUrl.toString().split("?")[1] || "",
    );

    expect(params.get("scope")).toBe(
      "openid email profile groups offline_access",
    );
  });
});

describe("OIDCUtil - the token exchange", () => {
  test("exchanges the code for tokens and returns the identity", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "alice@example.com",
        email_verified: true,
        name: "Alice Anderson",
      },
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.name?.toString()).toBe("Alice Anderson");
    expect(result.issuer).toBe(idp.issuerUrl);
    expect(result.rawClaims["sub"]).toBe("00u1a2b3c4D5E6F7g8h9");
  });

  /*
   * PKCE is worthless if the verifier never reaches the token endpoint — an
   * intercepted code would be redeemable by anyone. Assert the wire, not the
   * intent.
   */
  test("sends the PKCE code verifier and the authorization code grant", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
    });

    const verifier: string = OIDCUtil.generateCodeVerifier();

    await runCallback(idp, {
      codeVerifier: verifier,
      callbackParams: { code: "code-xyz", state: "state-1" },
      expectedState: "state-1",
    });

    expect(idp.tokenRequests).toHaveLength(1);

    const tokenRequest: TokenRequest = idp.tokenRequests[0]!;

    expect(tokenRequest.grantType).toBe("authorization_code");
    expect(tokenRequest.code).toBe("code-xyz");
    expect(tokenRequest.codeVerifier).toBe(verifier);
    expect(tokenRequest.redirectUri).toBe(REDIRECT_URI);
  });

  test("authenticates to the token endpoint rather than sending the secret in the clear query", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
    });

    await runCallback(idp);

    const tokenRequest: TokenRequest = idp.tokenRequests[0]!;

    /*
     * openid-client defaults to client_secret_basic, so the credential rides
     * in the Authorization header. Either that or a form-encoded secret is
     * acceptable; what matters is that the provider is given proof of client
     * identity at all.
     */
    const authenticated: boolean =
      Boolean(tokenRequest.authorizationHeader) ||
      tokenRequest.clientSecretSent;

    expect(authenticated).toBe(true);
  });

  test("surfaces an OAuth error returned by the token endpoint", async () => {
    const idp: TestIdp = await startIdp({
      tokenError: {
        error: "invalid_grant",
        description: "The authorization code is invalid or has expired",
      },
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });
});

describe("OIDCUtil - real provider payloads", () => {
  /*
   * Each case advertises the vendor's real issuer string in both the discovery
   * document and the ID token, so the issuer comparison runs against the value
   * a customer would actually paste into the OIDC config — while everything is
   * still served from the loopback provider.
   */
  interface ProviderCase {
    vendor: string;
    issuer: string;
    claims: JSONObject;
    emailClaimName?: string | undefined;
    nameClaimName?: string | undefined;
    expectedEmail: string;
    expectedName: string | null;
  }

  const providers: Array<ProviderCase> = [
    {
      vendor: "Okta (custom authorization server)",
      issuer: "https://dev-12345678.okta.com/oauth2/default",
      claims: {
        nonce: NONCE,
        ver: 1,
        jti: "ID.4eKxdU4XKUZmTQKuLnDrHPn1Zc8dpQ0nYfKmDrPqRsE",
        amr: ["pwd"],
        idp: "00o8fou7sRaGGwdn4696",
        auth_time: 1735689600,
        at_hash: computeAtHash(),
        preferred_username: "isaac.brock@example.com",
        email: "isaac.brock@example.com",
        email_verified: true,
        name: "Isaac Brock",
      },
      expectedEmail: "isaac.brock@example.com",
      expectedName: "Isaac Brock",
    },
    {
      vendor: "Microsoft Entra ID (v2.0)",
      issuer:
        "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      claims: {
        nonce: NONCE,
        nbf: 1735689600,
        oid: "00000000-0000-0000-66f3-3332eca7ea81",
        preferred_username: "abe.lincoln@contoso.onmicrosoft.com",
        rh: "0.ARoAv4j5cvGGr0GRqy180BHbR",
        tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
        uti: "fqiBqXLPj0eQa82S-IYFAA",
        ver: "2.0",
        name: "Abe Lincoln",
        email: "abe.lincoln@contoso.com",
      },
      expectedEmail: "abe.lincoln@contoso.com",
      expectedName: "Abe Lincoln",
    },
    {
      /*
       * Entra ID omits `email` unless the optional claim is configured; the
       * address then only exists as `preferred_username`. This is the single
       * most common reason an Entra OIDC config "does not work", and the
       * emailClaimName setting is what fixes it.
       */
      vendor: "Microsoft Entra ID (no email claim configured)",
      issuer:
        "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0",
      claims: {
        nonce: NONCE,
        oid: "00000000-0000-0000-66f3-3332eca7ea81",
        preferred_username: "abe.lincoln@contoso.onmicrosoft.com",
        tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
        ver: "2.0",
        name: "Abe Lincoln",
      },
      emailClaimName: "preferred_username",
      expectedEmail: "abe.lincoln@contoso.onmicrosoft.com",
      expectedName: "Abe Lincoln",
    },
    {
      /*
       * Google sends email_verified as the STRING "true" on some flows. It is
       * carried through into rawClaims untouched; nothing may coerce it.
       */
      vendor: "Google Workspace",
      issuer: "https://accounts.google.com",
      claims: {
        nonce: NONCE,
        // Google's azp is the client that requested the token — us.
        azp: CLIENT_ID,
        at_hash: computeAtHash(),
        hd: "example.com",
        email: "jane.smith@example.com",
        email_verified: "true",
        name: "Jane Smith",
        picture: "https://lh3.googleusercontent.com/a/default-user",
        given_name: "Jane",
        family_name: "Smith",
        locale: "en",
      },
      expectedEmail: "jane.smith@example.com",
      expectedName: "Jane Smith",
    },
    {
      vendor: "Auth0",
      issuer: "https://oneuptime.us.auth0.com/",
      claims: {
        nonce: NONCE,
        nickname: "jane",
        name: "Jane Smith",
        picture: "https://s.gravatar.com/avatar/placeholder.png",
        updated_at: "2026-01-01T00:00:00.000Z",
        email: "jane@example.com",
        email_verified: false,
        sid: "s7Uo0Y1MFQ7iCLPqhDXwXpFPvKNPqjLh",
      },
      expectedEmail: "jane@example.com",
      expectedName: "Jane Smith",
    },
    {
      vendor: "Keycloak",
      issuer: "https://keycloak.example.com/realms/oneuptime",
      claims: {
        nonce: NONCE,
        typ: "ID",
        azp: CLIENT_ID,
        auth_time: 1735689600,
        session_state: "b1f0a1a4-3f2b-4f0e-9c1a-2b3c4d5e6f70",
        acr: "1",
        sid: "b1f0a1a4-3f2b-4f0e-9c1a-2b3c4d5e6f70",
        email_verified: true,
        name: "John Doe",
        preferred_username: "jdoe",
        given_name: "John",
        family_name: "Doe",
        email: "jdoe@example.com",
      },
      expectedEmail: "jdoe@example.com",
      expectedName: "John Doe",
    },
    {
      /*
       * ADFS 2016+ as an OIDC provider: the address arrives as `upn` and there
       * is no `name` claim at all, so the display name must come back null
       * rather than throwing.
       */
      vendor: "ADFS (upn, no name claim)",
      issuer: "https://adfs.example.com/adfs",
      claims: {
        nonce: NONCE,
        upn: "sam.carter@example.com",
        unique_name: "EXAMPLE\\sam.carter",
        auth_time: 1735689600,
        apptype: "Confidential",
        authmethod:
          "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport",
      },
      emailClaimName: "upn",
      expectedEmail: "sam.carter@example.com",
      expectedName: null,
    },
  ];

  test.each(providers)(
    "signs a user in from a $vendor ID token",
    async (providerCase: ProviderCase) => {
      const idp: TestIdp = await startIdp({
        issuerOverride: providerCase.issuer,
        idTokenClaims: providerCase.claims,
        // Nothing to fall back to: the claims above are the whole identity.
        omitUserInfoEndpoint: true,
      });

      const result: OidcCallbackResult = await runCallback(idp, {
        expectedIssuer: providerCase.issuer,
        emailClaimName: providerCase.emailClaimName ?? "email",
        nameClaimName: providerCase.nameClaimName ?? "name",
      });

      expect(result.email.toString()).toBe(providerCase.expectedEmail);
      expect(result.issuer).toBe(providerCase.issuer);

      if (providerCase.expectedName === null) {
        expect(result.name).toBeNull();
      } else {
        expect(result.name?.toString()).toBe(providerCase.expectedName);
      }
    },
  );

  test("carries the provider's full claim set through to rawClaims", async () => {
    const idp: TestIdp = await startIdp({
      issuerOverride: "https://accounts.google.com",
      idTokenClaims: {
        nonce: NONCE,
        email: "jane.smith@example.com",
        email_verified: "true",
        hd: "example.com",
        name: "Jane Smith",
        given_name: "Jane",
        family_name: "Smith",
      },
      omitUserInfoEndpoint: true,
    });

    const result: OidcCallbackResult = await runCallback(idp, {
      expectedIssuer: "https://accounts.google.com",
    });

    // Untouched, including Google's string-valued email_verified.
    expect(result.rawClaims["email_verified"]).toBe("true");
    expect(result.rawClaims["hd"]).toBe("example.com");
    expect(result.rawClaims["given_name"]).toBe("Jane");
    expect(result.rawClaims["family_name"]).toBe("Smith");
  });
});

describe("OIDCUtil - token validation rejects forged and mismatched tokens", () => {
  test("rejects an ID token whose issuer is not the configured one", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
    });

    /*
     * openid-client is satisfied — the token's `iss` matches what discovery
     * advertised. The mismatch is against the issuer the OIDC config pins,
     * which is the check OIDCUtil adds on top.
     */
    await expect(
      runCallback(idp, { expectedIssuer: "https://attacker.example.com" }),
    ).rejects.toThrow("OIDC issuer mismatch");
  });

  test("rejects an ID token signed by a key the JWKS does not publish", async () => {
    const attackerKey: IdpKeyPair = generateIdpKeyPair("test-signing-key-1");

    const idp: TestIdp = await startIdp({
      signingKeyOverride: attackerKey,
      idTokenClaims: { nonce: NONCE, email: "attacker@example.com" },
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });

  test("rejects an expired ID token", async () => {
    const nowSeconds: number = Math.floor(Date.now() / 1000);

    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "alice@example.com",
        iat: nowSeconds - 7200,
        exp: nowSeconds - 3600,
      },
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });

  test("rejects an ID token minted for a different client", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "alice@example.com",
        aud: "some-other-client-id",
      },
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });

  /*
   * The nonce binds the ID token to this browser's authorization request.
   * Without the check, a token captured from another session could be replayed
   * into this one.
   */
  test("rejects an ID token carrying a different nonce", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: "nonce-from-a-different-session",
        email: "a@b.com",
      },
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });

  test("rejects an ID token with no nonce when one was requested", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: undefined, email: "alice@example.com" },
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });

  /*
   * The state returned by the provider must be the state we sent, or the
   * callback is someone else's login being replayed into this session (CSRF).
   */
  test("rejects a callback whose state is not the one that was issued", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
    });

    await expect(
      runCallback(idp, {
        expectedState: "the-state-we-issued",
        callbackParams: {
          code: "code-1",
          state: "a-state-we-never-issued",
        },
      }),
    ).rejects.toThrow();
  });

  test("rejects a structurally invalid ID token", async () => {
    const idp: TestIdp = await startIdp({
      rawIdToken: "not.a.jwt",
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });

  /*
   * alg=none is the oldest JWT attack there is: strip the signature and claim
   * the token needs none.
   */
  test("rejects an unsigned (alg=none) ID token", async () => {
    const header: string = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/[=]+$/, "");

    const nowSeconds: number = Math.floor(Date.now() / 1000);
    const idpPlaceholder: TestIdp = await startIdp({});

    const payload: string = Buffer.from(
      JSON.stringify({
        iss: idpPlaceholder.issuerUrl,
        sub: "attacker",
        aud: CLIENT_ID,
        exp: nowSeconds + 3600,
        iat: nowSeconds,
        nonce: NONCE,
        email: "attacker@example.com",
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/[=]+$/, "");

    await idpPlaceholder.close();
    runningIdps = runningIdps.filter((i: TestIdp) => {
      return i !== idpPlaceholder;
    });

    const idp: TestIdp = await startIdp({
      rawIdToken: `${header}.${payload}.`,
    });

    await expect(runCallback(idp)).rejects.toThrow();
  });
});

describe("OIDCUtil - claim extraction", () => {
  test("fails with a message naming the claim when email is absent", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, name: "No Email" },
      omitUserInfoEndpoint: true,
    });

    await expect(runCallback(idp)).rejects.toThrow(
      "OIDC response did not include a usable 'email' claim",
    );
  });

  test("names the configured claim, not 'email', when a custom one is set", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, name: "No Upn" },
      omitUserInfoEndpoint: true,
    });

    await expect(runCallback(idp, { emailClaimName: "upn" })).rejects.toThrow(
      "OIDC response did not include a usable 'upn' claim",
    );
  });

  /*
   * A non-string email must be refused rather than stringified — `new
   * Email(["a@b.com"])` would otherwise produce something that is not an
   * address but still gets looked up and, on miss, created as a user.
   */
  test.each([
    ["an array", ["alice@example.com"]],
    ["a number", 12345],
    ["an object", { address: "alice@example.com" }],
    ["a boolean", true],
  ] as Array<[string, unknown]>)(
    "refuses an email claim that is %s",
    async (_label: string, value: unknown) => {
      const idp: TestIdp = await startIdp({
        idTokenClaims: { nonce: NONCE, email: value as never },
        omitUserInfoEndpoint: true,
      });

      await expect(runCallback(idp)).rejects.toThrow(
        "did not include a usable 'email' claim",
      );
    },
  );

  test("returns a null name when the name claim is absent", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
      omitUserInfoEndpoint: true,
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.name).toBeNull();
  });

  test("returns a null name when the name claim is not a string", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "alice@example.com",
        name: { given: "Alice" } as never,
      },
      omitUserInfoEndpoint: true,
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.name).toBeNull();
  });

  test("reads the identity from custom claim names", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        upn: "sam.carter@example.com",
        display_name: "Sam Carter",
      },
      omitUserInfoEndpoint: true,
    });

    const result: OidcCallbackResult = await runCallback(idp, {
      emailClaimName: "upn",
      nameClaimName: "display_name",
    });

    expect(result.email.toString()).toBe("sam.carter@example.com");
    expect(result.name?.toString()).toBe("Sam Carter");
  });

  test("returns a null phone when no phoneClaimName is configured", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "alice@example.com",
        phone_number: "+15551234567",
      },
      omitUserInfoEndpoint: true,
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.phone).toBeNull();
  });

  test("reads the phone number from the configured claim name", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "alice@example.com",
        phone_number: "+15551234567",
      },
      omitUserInfoEndpoint: true,
    });

    const result: OidcCallbackResult = await runCallback(idp, {
      phoneClaimName: "phone_number",
    });

    expect(result.phone?.toString()).toBe("+15551234567");
  });

  test("returns a null phone, without failing the login, when the claim is not in a format Phone accepts", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "alice@example.com",
        phone_number: "not-a-phone-number",
      },
      omitUserInfoEndpoint: true,
    });

    const result: OidcCallbackResult = await runCallback(idp, {
      phoneClaimName: "phone_number",
    });

    expect(result.phone).toBeNull();
    expect(result.email.toString()).toBe("alice@example.com");
  });
});

describe("OIDCUtil - userinfo fallback", () => {
  test("falls back to userinfo when the ID token carries no email", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, name: "Alice Anderson" },
      userInfo: {
        sub: "00u1a2b3c4D5E6F7g8h9",
        email: "alice@example.com",
        email_verified: true,
      },
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.name?.toString()).toBe("Alice Anderson");
  });

  test("falls back to userinfo for the name alone", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
      userInfo: { sub: "00u1a2b3c4D5E6F7g8h9", name: "Alice From Userinfo" },
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.name?.toString()).toBe("Alice From Userinfo");
  });

  test("takes both email and name from userinfo when the ID token has neither", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE },
      userInfo: {
        sub: "00u1a2b3c4D5E6F7g8h9",
        email: "bob@example.com",
        name: "Bob Brown",
      },
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.email.toString()).toBe("bob@example.com");
    expect(result.name?.toString()).toBe("Bob Brown");
  });

  test("falls back to userinfo for the phone number when a phoneClaimName is configured", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
      userInfo: {
        sub: "00u1a2b3c4D5E6F7g8h9",
        phone_number: "+15551234567",
      },
    });

    const result: OidcCallbackResult = await runCallback(idp, {
      phoneClaimName: "phone_number",
    });

    expect(result.phone?.toString()).toBe("+15551234567");
  });

  /*
   * A provider that 500s on /userinfo must not break a login whose ID token
   * already carried the identity — the fallback is an enrichment, not a
   * dependency.
   */
  test("a failing userinfo endpoint is not fatal when the ID token has the email", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE, email: "alice@example.com" },
      failUserInfo: true,
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.email.toString()).toBe("alice@example.com");
    expect(result.name).toBeNull();
  });

  test("a failing userinfo endpoint IS fatal when the email is only there", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: { nonce: NONCE },
      failUserInfo: true,
    });

    await expect(runCallback(idp)).rejects.toThrow(
      "did not include a usable 'email' claim",
    );
  });

  test("the ID token wins when it and userinfo disagree", async () => {
    const idp: TestIdp = await startIdp({
      idTokenClaims: {
        nonce: NONCE,
        email: "from-id-token@example.com",
        name: "From ID Token",
      },
      userInfo: {
        sub: "00u1a2b3c4D5E6F7g8h9",
        email: "from-userinfo@example.com",
        name: "From Userinfo",
      },
    });

    const result: OidcCallbackResult = await runCallback(idp);

    expect(result.email.toString()).toBe("from-id-token@example.com");
    expect(result.name?.toString()).toBe("From ID Token");
  });
});
