import RemoteJwtVerifier from "Common/Server/Utils/Marketplace/RemoteJwtVerifier";
import VercelMarketplaceAuth, {
  VERCEL_MARKETPLACE_ISSUER,
  VERCEL_MARKETPLACE_JWKS_URL,
  VercelAuthError,
  VercelMarketplaceCaller,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAuth";
import {
  FakeHttpClient,
  TestSigningKey,
  createFakeHttpClient,
  createSigningKey,
  jwksDocument,
  signToken,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { beforeAll, describe, expect, it } from "@jest/globals";

/*
 * Every call Vercel makes to the provider API carries an OIDC token Vercel
 * signed with a key from https://marketplace.vercel.com/.well-known/jwks,
 * issued by https://marketplace.vercel.com for the integration's client ID.
 */

const CLIENT_ID: string = "oac_onEuPtImEcLiEnTiD";
const INSTALLATION_ID: string = "icfg_7BsYazjxsiKpsDTXiAUcOJmP";

let key: TestSigningKey;
let otherKey: TestSigningKey;

beforeAll(() => {
  key = createSigningKey("mrk-test-key");
  otherKey = createSigningKey("mrk-other-key");
});

const authWith: (
  http: FakeHttpClient,
  clientId?: string | null,
) => VercelMarketplaceAuth = (
  http: FakeHttpClient,
  clientId?: string | null,
): VercelMarketplaceAuth => {
  return new VercelMarketplaceAuth({
    verifier: new RemoteJwtVerifier({ httpClient: http.client }),
    clientId: clientId === undefined ? CLIENT_ID : clientId,
  });
};

const jwks: () => FakeHttpClient = (): FakeHttpClient => {
  return createFakeHttpClient([
    { status: 200, body: jwksDocument([key]) },
    { status: 200, body: jwksDocument([key]) },
  ]);
};

const userClaims: (
  overrides?: Record<string, unknown>,
) => Record<string, unknown> = (
  overrides?: Record<string, unknown>,
): Record<string, unknown> => {
  return {
    iss: VERCEL_MARKETPLACE_ISSUER,
    aud: CLIENT_ID,
    type: "access_token",
    sub: "account:0a1b2c:user:3d4e5f",
    account_id: "team_acme",
    installation_id: INSTALLATION_ID,
    user_id: "user_ada",
    user_role: "ADMIN",
    user_email: "Ada@Example.com",
    user_email_verified: true,
    user_name: "Ada Lovelace",
    ...overrides,
  };
};

describe("VercelMarketplaceAuth", () => {
  it("reads the person a user token names, from Vercel's published keys", async () => {
    const http: FakeHttpClient = jwks();

    const caller: VercelMarketplaceCaller = await authWith(
      http,
    ).verifyAuthorizationHeader(
      `Bearer ${signToken({ key: key, claims: userClaims(), expiresInSeconds: 300 })}`,
    );

    expect(caller).toEqual({
      kind: "user",
      accountId: "team_acme",
      installationId: INSTALLATION_ID,
      userId: "user_ada",
      userRole: "ADMIN",
      userEmail: "ada@example.com",
      isUserEmailVerified: true,
      userName: "Ada Lovelace",
    });

    expect(http.requests[0]!.url).toBe(VERCEL_MARKETPLACE_JWKS_URL);
  });

  it("reads a system token as Vercel itself, with no person", async () => {
    const caller: VercelMarketplaceCaller = await authWith(
      jwks(),
    ).verifyAuthorizationHeader(
      `bearer ${signToken({
        key: key,
        claims: {
          iss: VERCEL_MARKETPLACE_ISSUER,
          aud: CLIENT_ID,
          type: "access_token",
          sub: "account:0a1b2c",
          account_id: "team_acme",
          installation_id: INSTALLATION_ID,
        },
        expiresInSeconds: 300,
      })}`,
    );

    expect(caller).toEqual({
      kind: "system",
      accountId: "team_acme",
      installationId: INSTALLATION_ID,
    });
  });

  it("takes email_verified where a token carries it instead of user_email_verified", async () => {
    const claims: Record<string, unknown> = userClaims({
      email_verified: true,
    });
    delete claims["user_email_verified"];

    const caller: VercelMarketplaceCaller = await authWith(
      jwks(),
    ).verifyAuthorizationHeader(
      `Bearer ${signToken({ key: key, claims: claims, expiresInSeconds: 300 })}`,
    );

    expect(caller.isUserEmailVerified).toBe(true);
  });

  it("does not take an email address as verified unless Vercel says so", async () => {
    const claims: Record<string, unknown> = userClaims({
      user_email_verified: "true",
    });

    const caller: VercelMarketplaceCaller = await authWith(
      jwks(),
    ).verifyAuthorizationHeader(
      `Bearer ${signToken({ key: key, claims: claims, expiresInSeconds: 300 })}`,
    );

    expect(caller.isUserEmailVerified).toBe(false);
  });

  it("refuses a token for another integration, from another issuer, or expired", async () => {
    for (const token of [
      signToken({
        key: key,
        claims: userClaims({ aud: "oac_someone_else" }),
        expiresInSeconds: 300,
      }),
      signToken({
        key: key,
        claims: userClaims({ iss: "https://evil.example.com" }),
        expiresInSeconds: 300,
      }),
      signToken({ key: key, claims: userClaims(), expiresInSeconds: -3600 }),
      // Signed with a key Vercel does not publish.
      signToken({
        key: otherKey,
        claims: userClaims(),
        expiresInSeconds: 300,
        keyIdOverride: key.keyId,
      }),
    ]) {
      await expect(
        authWith(jwks()).verifyAuthorizationHeader(`Bearer ${token}`),
      ).rejects.toBeInstanceOf(VercelAuthError);
    }
  });

  it("refuses a token signed with the public key as an HMAC secret", async () => {
    const forged: string = signToken({
      key: { ...key, privateKeyPem: key.publicKeyPem },
      claims: userClaims(),
      expiresInSeconds: 300,
      algorithm: "HS256",
    });

    await expect(
      authWith(jwks()).verifyAuthorizationHeader(`Bearer ${forged}`),
    ).rejects.toBeInstanceOf(VercelAuthError);
  });

  it("refuses an ID token where an access token is due, and the other way round", async () => {
    const idToken: string = signToken({
      key: key,
      claims: userClaims({ type: "id_token" }),
      expiresInSeconds: 300,
    });

    await expect(
      authWith(jwks()).verifyAuthorizationHeader(`Bearer ${idToken}`),
    ).rejects.toThrow("not access_token");

    await expect(
      authWith(jwks()).verifyToken(
        signToken({ key: key, claims: userClaims(), expiresInSeconds: 300 }),
        "id_token",
      ),
    ).rejects.toThrow("not id_token");

    const caller: VercelMarketplaceCaller = await authWith(jwks()).verifyToken(
      idToken,
      "id_token",
    );
    expect(caller.kind).toBe("user");
  });

  it("refuses a token that names a person but no role, rather than read it as Vercel's own", async () => {
    const noRole: Record<string, unknown> = userClaims();
    delete noRole["user_role"];

    await expect(
      authWith(jwks()).verifyAuthorizationHeader(
        `Bearer ${signToken({ key: key, claims: noRole, expiresInSeconds: 300 })}`,
      ),
    ).rejects.toThrow("no role");

    await expect(
      authWith(jwks()).verifyAuthorizationHeader(
        `Bearer ${signToken({
          key: key,
          claims: userClaims({ user_role: "OWNER" }),
          expiresInSeconds: 300,
        })}`,
      ),
    ).rejects.toThrow("no role");

    const subjectOnly: Record<string, unknown> = userClaims();
    delete subjectOnly["user_id"];

    await expect(
      authWith(jwks()).verifyAuthorizationHeader(
        `Bearer ${signToken({ key: key, claims: subjectOnly, expiresInSeconds: 300 })}`,
      ),
    ).rejects.toThrow("no Vercel user");
  });

  it("reads a system token sent before anything is installed, which names no team", async () => {
    const caller: VercelMarketplaceCaller = await authWith(
      jwks(),
    ).verifyAuthorizationHeader(
      `Bearer ${signToken({
        key: key,
        claims: {
          iss: VERCEL_MARKETPLACE_ISSUER,
          aud: CLIENT_ID,
          type: "access_token",
          sub: null,
          installation_id: null,
        },
        expiresInSeconds: 300,
      })}`,
    );

    expect(caller).toEqual({
      kind: "system",
      accountId: null,
      installationId: null,
    });
  });

  it("refuses a user token that names no account", async () => {
    const claims: Record<string, unknown> = userClaims();
    delete claims["account_id"];

    await expect(
      authWith(jwks()).verifyAuthorizationHeader(
        `Bearer ${signToken({ key: key, claims: claims, expiresInSeconds: 300 })}`,
      ),
    ).rejects.toThrow("no Vercel account");
  });

  it("refuses a request with no bearer token, without fetching any key", async () => {
    const http: FakeHttpClient = createFakeHttpClient([]);

    for (const header of [undefined, "", "Basic abc", "Bearer", ["Basic x"]]) {
      await expect(
        authWith(http).verifyAuthorizationHeader(header),
      ).rejects.toBeInstanceOf(VercelAuthError);
    }

    expect(http.requests).toHaveLength(0);
  });

  it("refuses everything on a server with no Vercel integration", async () => {
    await expect(
      authWith(jwks(), null).verifyAuthorizationHeader(
        `Bearer ${signToken({ key: key, claims: userClaims(), expiresInSeconds: 300 })}`,
      ),
    ).rejects.toThrow("not set up");
  });
});
