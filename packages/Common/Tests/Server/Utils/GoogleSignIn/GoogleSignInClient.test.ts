import crypto from "crypto";
import GoogleSignInClient, {
  GoogleIdentity,
  GoogleSignInError,
  GoogleSignInRequest,
} from "../../../../Server/Utils/GoogleSignIn/GoogleSignInClient";
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
 * Continue with Google: the OpenID Connect code flow with PKCE against
 * Google's accounts. A Google account is matched to a OneUptime user by
 * email address, so the address must be one Google not only verified but is
 * authoritative for - a Gmail address, or a Google Workspace account's (the
 * hd claim). A Google account made with another provider's address may no
 * longer belong to its owner, and is refused.
 */

const CLIENT_ID: string = "1234567890-abcdefg.apps.googleusercontent.com";
const CLIENT_SECRET: string = "sign-in-client-secret-for-tests";
const REDIRECT_URI: string = "https://oneuptime.com/identity/google/callback";
const NONCE: string = "nonce-from-the-sign-in-cookie";

const googleKey: TestSigningKey = createSigningKey("google-signing-key");
const strangerKey: TestSigningKey = createSigningKey("google-signing-key");

// A Google Workspace account's claims.
const claimsFor: (
  overrides?: Record<string, unknown>,
) => Record<string, unknown> = (
  overrides?: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    sub: "110169484474386276334",
    nonce: NONCE,
    email: "Ada.Lovelace@Contoso.com",
    email_verified: true,
    hd: "contoso.com",
    name: "  Ada Lovelace  ",
    ...overrides,
  };
};

// A Gmail account's claims: Google is the address's own provider, so no hd.
const gmailClaims: (
  overrides?: Record<string, unknown>,
) => Record<string, unknown> = (
  overrides?: Record<string, unknown>,
): Record<string, unknown> => {
  return claimsFor({
    email: "ada.lovelace@gmail.com",
    hd: undefined,
    ...overrides,
  });
};

const createClient: (http: FakeHttpClient) => GoogleSignInClient = (
  http: FakeHttpClient,
): GoogleSignInClient => {
  return new GoogleSignInClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    httpClient: http.client,
  });
};

const expectRefused: (
  claims: Record<string, unknown>,
  pattern?: RegExp,
) => GoogleSignInError = (
  claims: Record<string, unknown>,
  pattern?: RegExp,
): GoogleSignInError => {
  let error: unknown = null;

  try {
    GoogleSignInClient.readIdentity(claims, NONCE);
  } catch (err) {
    error = err;
  }

  expect(error).toBeInstanceOf(GoogleSignInError);

  if (pattern) {
    expect((error as Error).message).toMatch(pattern);
  }

  return error as GoogleSignInError;
};

describe("GoogleSignInClient.createSignInRequest", () => {
  it("sends the browser to Google's authorization endpoint with PKCE, state and nonce", () => {
    const request: GoogleSignInRequest = createClient(
      createFakeHttpClient([]),
    ).createSignInRequest();

    const url: URL = new URL(request.authorizationUrl);

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "openid email profile",
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
    const client: GoogleSignInClient = createClient(createFakeHttpClient([]));
    const first: GoogleSignInRequest = client.createSignInRequest();
    const second: GoogleSignInRequest = client.createSignInRequest();

    for (const key of ["state", "nonce", "codeVerifier"] as const) {
      expect(first[key]).not.toBe(second[key]);
      expect(first[key]).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(first[key].length).toBeGreaterThanOrEqual(43);
    }

    // RFC 7636: a code verifier is 43 to 128 characters.
    expect(first.codeVerifier.length).toBeLessThanOrEqual(128);
  });
});

describe("GoogleSignInClient.readIdentity", () => {
  it("signs in a Google Workspace account by its email address", () => {
    const identity: GoogleIdentity = GoogleSignInClient.readIdentity(
      claimsFor(),
      NONCE,
    );

    expect(identity.email.toString().toLowerCase()).toBe(
      "ada.lovelace@contoso.com",
    );
    expect(identity.name).toBe("Ada Lovelace");
    expect(identity.subject).toBe("110169484474386276334");
    expect(identity.hostedDomain).toBe("contoso.com");
  });

  it("signs in a Gmail account, which names no hosted domain", () => {
    for (const email of [
      "ada.lovelace@gmail.com",
      "Ada.Lovelace@GMAIL.COM",
      "ada.lovelace@googlemail.com",
    ]) {
      const identity: GoogleIdentity = GoogleSignInClient.readIdentity(
        gmailClaims({ email: email }),
        NONCE,
      );

      expect(identity.email.toString().toLowerCase()).toBe(email.toLowerCase());
      expect(identity.hostedDomain).toBeNull();
    }
  });

  it("takes Google's word that an address is verified only when it says so", () => {
    for (const verified of [true, "true"]) {
      expect(
        GoogleSignInClient.readIdentity(
          claimsFor({ email_verified: verified }),
          NONCE,
        ).hostedDomain,
      ).toBe("contoso.com");
    }

    for (const unverified of [undefined, false, "false", 1, "1", "yes", null]) {
      for (const claims of [
        claimsFor({ email_verified: unverified }),
        gmailClaims({ email_verified: unverified }),
      ]) {
        const error: GoogleSignInError = expectRefused(
          claims,
          /email_verified/,
        );

        // The person is told to use their password, not shown the internals.
        expect(error.userMessage).toMatch(/email and password/);
        expect(error.userMessage).not.toMatch(/email_verified/);
      }
    }
  });

  /*
   * Anyone can make a Google account with an address at another provider,
   * and Google verified it only once, when the account was made: Google does
   * not vouch that its user still owns it.
   */
  it("refuses a verified address Google is not the provider of", () => {
    for (const hd of [undefined, "", "   ", 42, null]) {
      const error: GoogleSignInError = expectRefused(
        claimsFor({ hd: hd, email: "ada@contoso.com" }),
        /not authoritative/,
      );

      expect(error.userMessage).toMatch(/email and password/);
      expect(error.userMessage).not.toMatch(/authoritative|\bhd\b/);
    }

    // A lookalike of Gmail's domain is not Gmail.
    for (const email of [
      "ada@gmail.com.contoso.com",
      "ada@notgmail.com",
      "ada@gmail.co",
      "gmail.com@contoso.com",
    ]) {
      expectRefused(gmailClaims({ email: email }), /not authoritative/);
    }
  });

  it("refuses a token issued by anyone but Google", () => {
    for (const iss of [
      "https://accounts.google.com.evil.example",
      "https://login.microsoftonline.com/common/v2.0",
      "http://accounts.google.com",
      undefined,
    ]) {
      expectRefused(claimsFor({ iss: iss }), /not issued by Google/);
    }

    // Google writes its issuer both ways.
    expect(
      GoogleSignInClient.readIdentity(
        claimsFor({ iss: "accounts.google.com" }),
        NONCE,
      ).subject,
    ).toBe("110169484474386276334");
  });

  it("refuses a token from another sign-in", () => {
    expectRefused(
      claimsFor({ nonce: "someone-elses-nonce" }),
      /does not belong to this sign-in/,
    );
    expectRefused(
      claimsFor({ nonce: undefined }),
      /does not belong to this sign-in/,
    );
  });

  it("refuses a token without a user or a usable email address", () => {
    expectRefused(claimsFor({ sub: undefined }), /names no user/);
    expectRefused(claimsFor({ sub: "" }), /names no user/);

    for (const email of [undefined, "", "not-an-email", 42]) {
      expect(expectRefused(claimsFor({ email: email })).userMessage).toMatch(
        /did not share an email address/,
      );
    }
  });

  it("leaves the name empty when Google sends none", () => {
    for (const name of ["   ", undefined, 42]) {
      expect(
        GoogleSignInClient.readIdentity(claimsFor({ name: name }), NONCE).name,
      ).toBeNull();
    }
  });
});

describe("GoogleSignInClient.completeSignIn", () => {
  it("trades the code (with its PKCE verifier) for an ID token and verifies it", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          token_type: "Bearer",
          access_token: "ya29.access-token",
          id_token: signToken({
            key: googleKey,
            claims: claimsFor(),
            expiresInSeconds: 600,
          }),
        },
      },
      { status: 200, body: jwksDocument([googleKey]) },
    ]);

    const identity: GoogleIdentity = await createClient(http).completeSignIn({
      code: "authorization-code",
      codeVerifier: "code-verifier",
      nonce: NONCE,
    });

    expect(identity.hostedDomain).toBe("contoso.com");

    const tokenRequest: MarketplaceHttpRequest = http.requests[0]!;

    expect(tokenRequest.url).toBe("https://oauth2.googleapis.com/token");
    expect(tokenRequest.method).toBe("POST");
    expect(
      Object.fromEntries(new URLSearchParams(tokenRequest.body).entries()),
    ).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: REDIRECT_URI,
      code_verifier: "code-verifier",
    });
    expect(http.requests[1]!.url).toBe(
      "https://www.googleapis.com/oauth2/v3/certs",
    );
  });

  it("refuses an ID token for another app, or signed by anyone but Google", async () => {
    for (const idToken of [
      signToken({
        key: googleKey,
        claims: claimsFor({ aud: "another-app.apps.googleusercontent.com" }),
        expiresInSeconds: 600,
      }),
      signToken({
        key: strangerKey,
        claims: claimsFor(),
        expiresInSeconds: 600,
      }),
      signToken({
        key: googleKey,
        claims: claimsFor(),
        expiresInSeconds: -3600,
      }),
    ]) {
      const http: FakeHttpClient = createFakeHttpClient([
        { status: 200, body: { id_token: idToken } },
        { status: 200, body: jwksDocument([googleKey]) },
      ]);

      await expect(
        createClient(http).completeSignIn({
          code: "c",
          codeVerifier: "v",
          nonce: NONCE,
        }),
      ).rejects.toBeInstanceOf(GoogleSignInError);
    }
  });

  it("says so when Google refuses the code, or cannot be reached", async () => {
    const refused: FakeHttpClient = createFakeHttpClient([
      {
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "Bad Request",
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

    const noIdToken: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: { access_token: "ya29.only-an-access-token" } },
    ]);

    await expect(
      createClient(noIdToken).completeSignIn({
        code: "c",
        codeVerifier: "v",
        nonce: NONCE,
      }),
    ).rejects.toBeInstanceOf(GoogleSignInError);

    const unreachable: FakeHttpClient = createFakeHttpClient([
      new Error("ECONNRESET"),
    ]);

    await expect(
      createClient(unreachable).completeSignIn({
        code: "c",
        codeVerifier: "v",
        nonce: NONCE,
      }),
    ).rejects.toBeInstanceOf(GoogleSignInError);
  });
});
