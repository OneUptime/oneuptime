import crypto from "crypto";
import MicrosoftSignInClient, {
  MICROSOFT_CONSUMER_TENANT_ID,
  MicrosoftIdentity,
  MicrosoftSignInError,
  MicrosoftSignInRequest,
} from "../../../../Server/Utils/MicrosoftSignIn/MicrosoftSignInClient";
import { MarketplaceHttpRequest } from "../../../../Server/Utils/Marketplace/MarketplaceHttp";
import RemoteJwtVerifier from "../../../../Server/Utils/Marketplace/RemoteJwtVerifier";
import {
  SignInAgainRefusal,
  judgeSignInAgain,
} from "../../../../Types/Accounts/Reauthentication";
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

/*
 * Sign In Again (#10217): Microsoft is asked to have the person sign in
 * again (prompt=login), and the ID token's auth_time says when they did.
 * Microsoft Entra ID puts auth_time in the ID token only once the server's
 * app has it as an optional claim (Marketplace/RELEASING.md).
 *
 * No max_age (#10529): Microsoft documents prompt=login and no max_age,
 * and two reports on Microsoft Q&A found max_age=0 made Entra ID answer
 * with an ID token that had already expired. Fixed from Microsoft's docs
 * and those reports; no live tenant was asked.
 */
describe("MicrosoftSignInClient, for Sign In Again", () => {
  it("asks Microsoft to have the person sign in again, in place of choosing an account, and sends no max_age", () => {
    const request: MicrosoftSignInRequest = createClient(
      createFakeHttpClient([]),
    ).createSignInRequest({ isSignInAgain: true });

    const url: URL = new URL(request.authorizationUrl);

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    // Everything a sign-in sends, with prompt=login, and nothing more.
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
      prompt: "login",
    });
    expect(url.searchParams.has("max_age")).toBe(false);
    expect(url.searchParams.getAll("prompt")).toEqual(["login"]);
  });

  it("any other sign-in chooses an account, as it did", () => {
    for (const request of [
      createClient(createFakeHttpClient([])).createSignInRequest(),
      createClient(createFakeHttpClient([])).createSignInRequest({
        isSignInAgain: false,
      }),
    ]) {
      const params: URLSearchParams = new URL(request.authorizationUrl)
        .searchParams;

      expect(params.get("prompt")).toBe("select_account");
      expect(params.has("max_age")).toBe(false);
    }
  });

  it("reads when Microsoft says the person signed in, and nothing without the optional claim", () => {
    expect(
      MicrosoftSignInClient.readIdentity(
        claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { auth_time: 1795168800 }),
        NONCE,
      ).authenticatedAt,
    ).toEqual(new Date(1795168800 * 1000));

    expect(
      MicrosoftSignInClient.readIdentity(
        claimsFor(MICROSOFT_CONSUMER_TENANT_ID),
        NONCE,
      ).authenticatedAt,
    ).toBeNull();

    for (const authTime of ["1795168800", 0, -1, null]) {
      expect(
        MicrosoftSignInClient.readIdentity(
          claimsFor(MICROSOFT_CONSUMER_TENANT_ID, { auth_time: authTime }),
          NONCE,
        ).authenticatedAt,
      ).toBeNull();
    }
  });
});

/*
 * THE ID TOKEN max_age=0 WAS REPORTED TO BRING (#10529), to the second, as
 * Microsoft Q&A quotes it: iat and nbf 1695209618, exp 1695209918,
 * auth_time 1695209915, received at 1695209919 - issued, by its iat, five
 * minutes before the person signed in, expiring three seconds after, and
 * read a second after it expired. Sign In Again no longer sends max_age, so
 * Entra ID should not send one; one that comes anyway is verified as the
 * callback verifies it (RemoteJwtVerifier, its clock injected here), with
 * the minute either way it allows the two clocks, and Sign In Again holds
 * its auth_time to the request - never its iat.
 */
describe("MicrosoftSignInClient, given the ID token max_age=0 was reported to bring", () => {
  const AUTH_TIME: number = 1695209915;
  const REPORTED_TIMES: Record<string, number> = {
    iat: 1695209618,
    nbf: 1695209618,
    exp: 1695209918,
    auth_time: AUTH_TIME,
  };
  const RECEIVED_AT: number = 1695209919;
  const EXP: number = REPORTED_TIMES["exp"]!;

  // The token endpoint answers with `claims`, and the callback reads it at `nowInSeconds`.
  const completeAt: (
    nowInSeconds: number,
    claims: Record<string, unknown>,
  ) => Promise<MicrosoftIdentity> = async (
    nowInSeconds: number,
    claims: Record<string, unknown>,
  ): Promise<MicrosoftIdentity> => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          token_type: "Bearer",
          // The claims' own iat, nbf and exp: no lifetime of the signer's.
          id_token: signToken({ key: entraKey, claims: claims }),
        },
      },
      { status: 200, body: jwksDocument([entraKey]) },
    ]);

    return await new MicrosoftSignInClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      httpClient: http.client,
      verifier: new RemoteJwtVerifier({
        httpClient: http.client,
        now: (): number => {
          return nowInSeconds * 1000;
        },
      }),
    }).completeSignIn({
      code: "authorization-code",
      codeVerifier: "code-verifier",
      nonce: NONCE,
    });
  };

  const reported: Record<string, unknown> = claimsFor(
    MICROSOFT_CONSUMER_TENANT_ID,
    REPORTED_TIMES,
  );

  it("signs the person in when read a second after its exp, as the report read it, and says when they signed in", async () => {
    const identity: MicrosoftIdentity = await completeAt(RECEIVED_AT, reported);

    expect(identity.tenantId).toBe(MICROSOFT_CONSUMER_TENANT_ID);
    expect(identity.authenticatedAt).toEqual(new Date(AUTH_TIME * 1000));
  });

  it("confirms a Sign In Again by its auth_time, never by its iat from five minutes before", async () => {
    const identity: MicrosoftIdentity = await completeAt(RECEIVED_AT, reported);
    // Sent to Microsoft twenty seconds before they signed in.
    const requestedAt: Date = new Date((AUTH_TIME - 20) * 1000);
    const now: Date = new Date(RECEIVED_AT * 1000);

    expect(
      judgeSignInAgain({
        requestedAt: requestedAt,
        authenticatedAt: identity.authenticatedAt,
        now: now,
      }),
    ).toEqual({ reauthenticatedAt: new Date(AUTH_TIME * 1000) });

    // Its iat, read as when they signed in, would be a session from before.
    expect(
      judgeSignInAgain({
        requestedAt: requestedAt,
        authenticatedAt: new Date(REPORTED_TIMES["iat"]! * 1000),
        now: now,
      }),
    ).toEqual({ refusal: SignInAgainRefusal.ReusedSession });
  });

  it("is still read inside the minute the two clocks are allowed, and refused from the minute's end", async () => {
    await expect(completeAt(EXP + 59, reported)).resolves.toMatchObject({
      authenticatedAt: new Date(AUTH_TIME * 1000),
    });

    for (const late of [EXP + 60, EXP + 61, EXP + 60 * 60]) {
      await expect(completeAt(late, reported)).rejects.toThrow(
        /The Microsoft ID token is not valid: The token is not valid: jwt expired/,
      );
    }
  });

  it("a Sign In Again Microsoft answered with a session from before it was sent is still refused, however fresh the token", async () => {
    const now: number = RECEIVED_AT;
    // Issued just now, for its usual hour, by a session ten minutes old.
    const identity: MicrosoftIdentity = await completeAt(
      now,
      claimsFor(MICROSOFT_CONSUMER_TENANT_ID, {
        iat: now - 300,
        nbf: now - 300,
        exp: now + 3600,
        auth_time: now - 600,
      }),
    );

    expect(
      judgeSignInAgain({
        requestedAt: new Date((now - 30) * 1000),
        authenticatedAt: identity.authenticatedAt,
        now: new Date(now * 1000),
      }),
    ).toEqual({ refusal: SignInAgainRefusal.ReusedSession });
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
