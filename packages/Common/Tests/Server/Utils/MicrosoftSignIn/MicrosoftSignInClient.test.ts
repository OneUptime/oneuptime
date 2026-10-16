import crypto from "crypto";
import MicrosoftSignInClient, {
  MICROSOFT_CONSUMER_TENANT_ID,
  MicrosoftIdentity,
  MicrosoftSignInError,
  MicrosoftSignInRequest,
} from "../../../../Server/Utils/MicrosoftSignIn/MicrosoftSignInClient";
import { MarketplaceHttpRequest } from "../../../../Server/Utils/Marketplace/MarketplaceHttp";
import {
  FakeHttpClient,
  TestSigningKey,
  createFakeHttpClient,
  createSigningKey,
  jwksDocument,
  signToken,
} from "../Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * Sign in with Microsoft: the OpenID Connect code flow with PKCE against
 * Entra ID's multi-tenant endpoint. A Microsoft account is matched to a
 * OneUptime user by email address, so the address must be one Microsoft
 * vouches for - a personal account's, or one whose domain the organization
 * has verified (xms_edov). Anything else is the "nOAuth" account takeover,
 * and is refused.
 */

const CLIENT_ID: string = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLIENT_SECRET: string = "sign-in-client-secret-for-tests";
const REDIRECT_URI: string =
  "https://oneuptime.com/identity/microsoft/callback";
const WORK_TENANT_ID: string = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const NONCE: string = "nonce-from-the-sign-in-cookie";

const entraKey: TestSigningKey = createSigningKey("entra-signing-key");
const strangerKey: TestSigningKey = createSigningKey("entra-signing-key");

const claimsFor: (
  tenantId: string,
  overrides?: Record<string, unknown>,
) => Record<string, unknown> = (
  tenantId: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    aud: CLIENT_ID,
    tid: tenantId,
    oid: "00000000-0000-0000-66f3-3332eca7ea81",
    nonce: NONCE,
    email: "Ada.Lovelace@Contoso.com",
    name: "  Ada Lovelace  ",
    ver: "2.0",
    ...overrides,
  };
};

const createClient: (http: FakeHttpClient) => MicrosoftSignInClient = (
  http: FakeHttpClient,
): MicrosoftSignInClient => {
  return new MicrosoftSignInClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    httpClient: http.client,
  });
};

const expectRefused: (
  claims: Record<string, unknown>,
  pattern?: RegExp,
) => MicrosoftSignInError = (
  claims: Record<string, unknown>,
  pattern?: RegExp,
): MicrosoftSignInError => {
  let error: unknown = null;

  try {
    MicrosoftSignInClient.readIdentity(claims, NONCE);
  } catch (err) {
    error = err;
  }

  expect(error).toBeInstanceOf(MicrosoftSignInError);

  if (pattern) {
    expect((error as Error).message).toMatch(pattern);
  }

  return error as MicrosoftSignInError;
};

describe("MicrosoftSignInClient.createSignInRequest", () => {
  it("sends the browser to Entra's common endpoint with PKCE, state and nonce", () => {
    const request: MicrosoftSignInRequest = createClient(
      createFakeHttpClient([]),
    ).createSignInRequest();

    const url: URL = new URL(request.authorizationUrl);

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      response_mode: "query",
      scope: "openid profile email",
      state: request.state,
      nonce: request.nonce,
      code_challenge: crypto
        .createHash("sha256")
        .update(request.codeVerifier, "ascii")
        .digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  });

  it("uses fresh, unguessable values for every sign-in", () => {
    const client: MicrosoftSignInClient = createClient(
      createFakeHttpClient([]),
    );
    const first: MicrosoftSignInRequest = client.createSignInRequest();
    const second: MicrosoftSignInRequest = client.createSignInRequest();

    for (const key of ["state", "nonce", "codeVerifier"] as const) {
      expect(first[key]).not.toBe(second[key]);
      expect(first[key]).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(first[key].length).toBeGreaterThanOrEqual(43);
    }

    // RFC 7636: a code verifier is 43 to 128 characters.
    expect(first.codeVerifier.length).toBeLessThanOrEqual(128);
  });
});

describe("MicrosoftSignInClient.readIdentity", () => {
  it("signs in a personal Microsoft account by its email address", () => {
    const identity: MicrosoftIdentity = MicrosoftSignInClient.readIdentity(
      claimsFor(MICROSOFT_CONSUMER_TENANT_ID),
      NONCE,
    );

    expect(identity.email.toString().toLowerCase()).toBe(
      "ada.lovelace@contoso.com",
    );
    expect(identity.name).toBe("Ada Lovelace");
    expect(identity.tenantId).toBe(MICROSOFT_CONSUMER_TENANT_ID);
    expect(identity.objectId).toBe("00000000-0000-0000-66f3-3332eca7ea81");
  });

  it("signs in a work account only when its organization owns the email's domain", () => {
    for (const verified of [true, 1, "1", "true"]) {
      expect(
        MicrosoftSignInClient.readIdentity(
          claimsFor(WORK_TENANT_ID, { xms_edov: verified }),
          NONCE,
        ).tenantId,
      ).toBe(WORK_TENANT_ID);
    }

    for (const unverified of [undefined, false, 0, "0", "false", "yes"]) {
      const error: MicrosoftSignInError = expectRefused(
        claimsFor(WORK_TENANT_ID, { xms_edov: unverified }),
        /xms_edov/,
      );

      // The person is told to use their password, not shown the internals.
      expect(error.userMessage).toMatch(/email and password/);
      expect(error.userMessage).not.toMatch(/xms_edov/);
    }
  });

  it("refuses a token issued by any tenant but the one it names", () => {
    expectRefused(
      claimsFor(WORK_TENANT_ID, {
        xms_edov: true,
        iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT_ID}/v2.0`,
      }),
      /not issued by the tenant it names/,
    );
    expectRefused(
      claimsFor(MICROSOFT_CONSUMER_TENANT_ID, {
        iss: `https://sts.windows.net/${MICROSOFT_CONSUMER_TENANT_ID}/`,
      }),
    );
    expectRefused(claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { tid: undefined }));
  });

  it("refuses a token from another sign-in", () => {
    expectRefused(
      claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { nonce: "someone-elses-nonce" }),
      /does not belong to this sign-in/,
    );
    expectRefused(
      claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { nonce: undefined }),
      /does not belong to this sign-in/,
    );
  });

  it("refuses a token without a user or a usable email address", () => {
    expectRefused(
      claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { oid: undefined }),
      /names no user/,
    );

    for (const email of [undefined, "", "not-an-email", 42]) {
      expect(
        expectRefused(claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { email: email }))
          .userMessage,
      ).toMatch(/did not share an email address/);
    }
  });

  it("leaves the name empty when Microsoft sends none", () => {
    expect(
      MicrosoftSignInClient.readIdentity(
        claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { name: "   " }),
        NONCE,
      ).name,
    ).toBeNull();
  });
});

describe("MicrosoftSignInClient.completeSignIn", () => {
  it("trades the code (with its PKCE verifier) for an ID token and verifies it", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          token_type: "Bearer",
          id_token: signToken({
            key: entraKey,
            claims: claimsFor(MICROSOFT_CONSUMER_TENANT_ID),
            expiresInSeconds: 600,
          }),
        },
      },
      { status: 200, body: jwksDocument([entraKey]) },
    ]);

    const identity: MicrosoftIdentity = await createClient(http).completeSignIn(
      {
        code: "authorization-code",
        codeVerifier: "code-verifier",
        nonce: NONCE,
      },
    );

    expect(identity.tenantId).toBe(MICROSOFT_CONSUMER_TENANT_ID);

    const tokenRequest: MarketplaceHttpRequest = http.requests[0]!;

    expect(tokenRequest.url).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    );
    expect(
      Object.fromEntries(new URLSearchParams(tokenRequest.body).entries()),
    ).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: REDIRECT_URI,
      code_verifier: "code-verifier",
      scope: "openid profile email",
    });
    expect(http.requests[1]!.url).toBe(
      "https://login.microsoftonline.com/common/discovery/v2.0/keys",
    );
  });

  it("refuses an ID token for another app, or signed by anyone but Microsoft", async () => {
    for (const idToken of [
      signToken({
        key: entraKey,
        claims: claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { aud: "another-app" }),
        expiresInSeconds: 600,
      }),
      signToken({
        key: strangerKey,
        claims: claimsFor(MICROSOFT_CONSUMER_TENANT_ID),
        expiresInSeconds: 600,
      }),
    ]) {
      const http: FakeHttpClient = createFakeHttpClient([
        { status: 200, body: { id_token: idToken } },
        { status: 200, body: jwksDocument([entraKey]) },
      ]);

      await expect(
        createClient(http).completeSignIn({
          code: "c",
          codeVerifier: "v",
          nonce: NONCE,
        }),
      ).rejects.toBeInstanceOf(MicrosoftSignInError);
    }
  });

  it("says so when Microsoft refuses the code, or cannot be reached", async () => {
    const refused: FakeHttpClient = createFakeHttpClient([
      {
        status: 400,
        body: {
          error: "invalid_grant",
          error_description:
            "AADSTS54005: OAuth2 Authorization code was already redeemed.",
        },
      },
    ]);

    await expect(
      createClient(refused).completeSignIn({
        code: "c",
        codeVerifier: "v",
        nonce: NONCE,
      }),
    ).rejects.toThrow(/invalid_grant/);

    const unreachable: FakeHttpClient = createFakeHttpClient([
      new Error("ECONNRESET"),
    ]);

    await expect(
      createClient(unreachable).completeSignIn({
        code: "c",
        codeVerifier: "v",
        nonce: NONCE,
      }),
    ).rejects.toBeInstanceOf(MicrosoftSignInError);
  });
});
