import crypto from "crypto";
import jwt from "jsonwebtoken";
import RemoteJwtVerifier, {
  JwtVerificationError,
} from "../../../../Server/Utils/Marketplace/RemoteJwtVerifier";
import {
  FakeHttpClient,
  PUBLIC_TEST_CERTIFICATE,
  TestSigningKey,
  createFakeHttpClient,
  createSigningKey,
  jwksDocument,
  signToken,
  x509Document,
} from "./MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * Tokens other parties sign - Microsoft's webhook bearer token, Google's
 * sign-up JWT and Pub/Sub's push token - are accepted only when signed with
 * RS256 by a key the issuer publishes, chosen by the token's kid, and with
 * the audience and issuer each caller requires. Everything else is refused.
 */

const JWKS_URL: string = "https://issuer.example.com/keys";
const X509_URL: string = "https://issuer.example.com/certs";

const keyA: TestSigningKey = createSigningKey("key-a");
const keyB: TestSigningKey = createSigningKey("key-b");
const stranger: TestSigningKey = createSigningKey("key-a");

const validClaims: Record<string, unknown> = {
  iss: "https://issuer.example.com",
  aud: "oneuptime.com",
  sub: "account-1",
};

describe("RemoteJwtVerifier", () => {
  it("accepts a token signed by a published JWKS key, with its audience and issuer", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: jwksDocument([keyA, keyB]) },
    ]);
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: http.client,
    });

    const claims: Record<string, unknown> = await verifier.verify(
      signToken({ key: keyB, claims: validClaims, expiresInSeconds: 300 }),
      {
        keySource: { kind: "jwks", url: JWKS_URL },
        audience: "oneuptime.com",
        issuer: "https://issuer.example.com",
      },
    );

    expect(claims["sub"]).toBe("account-1");
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0]).toMatchObject({ method: "GET", url: JWKS_URL });
  });

  it("accepts a token signed by a key in an X.509 key map", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: x509Document([keyA]) },
    ]);
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: http.client,
    });

    await expect(
      verifier.verify(
        signToken({ key: keyA, claims: validClaims, expiresInSeconds: 300 }),
        {
          keySource: { kind: "x509", url: X509_URL },
          audience: "oneuptime.com",
        },
      ),
    ).resolves.toMatchObject({ sub: "account-1" });
  });

  it("reads real X.509 certificates out of a key map", () => {
    const keys: Map<string, crypto.KeyObject> =
      RemoteJwtVerifier.keysFromX509Map({
        "cert-1": PUBLIC_TEST_CERTIFICATE,
        "not-a-cert": "hello",
        "not-a-string": 42 as unknown as string,
      });

    expect([...keys.keys()]).toEqual(["cert-1"]);
    expect(keys.get("cert-1")?.asymmetricKeyType).toBe("rsa");
  });

  it("refuses a token signed by a key that is not the one its kid names", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: jwksDocument([keyA]) },
    ]);
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: http.client,
    });

    // Same kid as keyA, different key.
    await expect(
      verifier.verify(
        signToken({
          key: stranger,
          claims: validClaims,
          expiresInSeconds: 300,
        }),
        { keySource: { kind: "jwks", url: JWKS_URL } },
      ),
    ).rejects.toBeInstanceOf(JwtVerificationError);
  });

  it("refuses the wrong audience and the wrong issuer", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: jwksDocument([keyA]) },
    ]);
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: http.client,
    });
    const token: string = signToken({
      key: keyA,
      claims: validClaims,
      expiresInSeconds: 300,
    });

    await expect(
      verifier.verify(token, {
        keySource: { kind: "jwks", url: JWKS_URL },
        audience: "evil.example.com",
      }),
    ).rejects.toThrow(JwtVerificationError);

    await expect(
      verifier.verify(token, {
        keySource: { kind: "jwks", url: JWKS_URL },
        issuer: "https://someone-else.example.com",
      }),
    ).rejects.toThrow(JwtVerificationError);
  });

  it("refuses an expired token, and one that never expires", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: jwksDocument([keyA]) },
    ]);
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: http.client,
    });

    await expect(
      verifier.verify(
        signToken({
          key: keyA,
          claims: {
            ...validClaims,
            exp: Math.floor(Date.now() / 1000) - 3600,
          },
        }),
        { keySource: { kind: "jwks", url: JWKS_URL } },
      ),
    ).rejects.toThrow(/not valid/);

    await expect(
      verifier.verify(signToken({ key: keyA, claims: validClaims }), {
        keySource: { kind: "jwks", url: JWKS_URL },
      }),
    ).rejects.toThrow(/does not expire/);
  });

  it("refuses alg none and HMAC tokens without fetching any key", async () => {
    const http: FakeHttpClient = createFakeHttpClient([]);
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: http.client,
    });

    const unsigned: string = jwt.sign(validClaims, "", {
      algorithm: "none",
      keyid: "key-a",
    } as jwt.SignOptions);
    const hmac: string = jwt.sign(validClaims, keyA.publicKeyPem, {
      algorithm: "HS256",
      keyid: "key-a",
    });

    for (const token of [unsigned, hmac]) {
      await expect(
        verifier.verify(token, { keySource: { kind: "jwks", url: JWKS_URL } }),
      ).rejects.toThrow(/RS256/);
    }

    expect(http.requests).toHaveLength(0);
  });

  it("refuses a token with no kid, garbage, and oversized input", async () => {
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: createFakeHttpClient([]).client,
    });

    const noKid: string = jwt.sign(validClaims, keyA.privateKeyPem, {
      algorithm: "RS256",
      expiresIn: 300,
    });

    await expect(
      verifier.verify(noKid, { keySource: { kind: "jwks", url: JWKS_URL } }),
    ).rejects.toThrow(/name its key/);

    for (const token of ["", "not-a-jwt", "x".repeat(20_000)]) {
      await expect(
        verifier.verify(token, { keySource: { kind: "jwks", url: JWKS_URL } }),
      ).rejects.toBeInstanceOf(JwtVerificationError);
    }
  });

  it("caches the keys, and refetches when a token names a key it has not seen", async () => {
    let nowInMs: number = Date.now();
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: jwksDocument([keyA]) },
      { status: 200, body: jwksDocument([keyA, keyB]) },
    ]);
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: http.client,
      now: (): number => {
        return nowInMs;
      },
    });

    const options: { keySource: { kind: "jwks"; url: string } } = {
      keySource: { kind: "jwks", url: JWKS_URL },
    };

    await verifier.verify(
      signToken({ key: keyA, claims: validClaims, expiresInSeconds: 3600 }),
      options,
    );
    await verifier.verify(
      signToken({ key: keyA, claims: validClaims, expiresInSeconds: 3600 }),
      options,
    );
    expect(http.requests).toHaveLength(1);

    // A rotated key, within five minutes of the last fetch: refused without fetching.
    await expect(
      verifier.verify(
        signToken({ key: keyB, claims: validClaims, expiresInSeconds: 3600 }),
        options,
      ),
    ).rejects.toThrow(/unknown key/);
    expect(http.requests).toHaveLength(1);

    // Six minutes later it is fetched once more, and found.
    nowInMs += 6 * 60 * 1000;
    await expect(
      verifier.verify(
        signToken({ key: keyB, claims: validClaims, expiresInSeconds: 3600 }),
        options,
      ),
    ).resolves.toMatchObject({ sub: "account-1" });
    expect(http.requests).toHaveLength(2);
  });

  it("says so when the keys cannot be fetched", async () => {
    const verifier: RemoteJwtVerifier = new RemoteJwtVerifier({
      httpClient: createFakeHttpClient([
        { status: 503, body: "unavailable" },
        new Error("socket hang up"),
        { status: 200, body: "<html>" },
      ]).client,
    });
    const token: string = signToken({
      key: keyA,
      claims: validClaims,
      expiresInSeconds: 300,
    });

    for (let attempt: number = 0; attempt < 3; attempt++) {
      await expect(
        verifier.verify(token, {
          keySource: { kind: "jwks", url: `${JWKS_URL}/${attempt}` },
        }),
      ).rejects.toBeInstanceOf(JwtVerificationError);
    }
  });

  it("only reads RSA signing keys from a JWKS document", () => {
    const keys: Map<string, crypto.KeyObject> = RemoteJwtVerifier.keysFromJwks({
      keys: [
        keyA.jwk,
        { ...keyB.jwk, use: "enc" },
        { kty: "EC", kid: "ec", crv: "P-256", x: "a", y: "b" },
        { kty: "RSA", kid: "no-exponent", n: keyA.jwk["n"] },
        { kty: "RSA", n: keyA.jwk["n"], e: "AQAB" },
        "not-an-object",
      ],
    });

    expect([...keys.keys()]).toEqual(["key-a"]);
    expect(RemoteJwtVerifier.keysFromJwks({}).size).toBe(0);
  });
});
