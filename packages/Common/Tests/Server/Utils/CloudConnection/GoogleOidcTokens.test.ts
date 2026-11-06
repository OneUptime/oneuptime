import crypto from "crypto";
import http from "http";
import type { SpyInstance } from "jest-mock";
import { AddressInfo } from "net";
import GoogleOidcTokens, {
  GOOGLE_OIDC_MISS_REFRESH_MS,
  GoogleKeysResponse,
  GoogleOidcVerdict,
  readBearerToken,
  readMaxAgeSeconds,
  readUnverifiedJwt,
} from "../../../../Server/Utils/CloudConnection/GoogleOidcTokens";
import logger from "../../../../Server/Utils/Logger";
import { CLOUD_STREAM_MAX_BEARER_TOKEN_LENGTH } from "../../../../Types/CloudConnection/CloudStream";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The OIDC tokens Google signs for a Pub/Sub push, checked against Google's
 * key set as a fake serves it on a real socket: the key set's JSON and its
 * Cache-Control as Google sends them, keys made here. Pinned: a token
 * Google signed is taken and a token anyone else signed is not, whatever
 * its header claims; no algorithm but RS256; Google's issuer, a live token,
 * a verified email; Google's keys read once while they are fresh, again
 * when a token names a key not among them - at most once a minute - and
 * no token taken while they cannot be read.
 */

interface SigningKey {
  kid: string;
  privateKey: crypto.KeyObject;
  jwk: crypto.JsonWebKey;
}

function makeKey(kid: string): SigningKey {
  const pair: crypto.KeyPairKeyObjectResult = crypto.generateKeyPairSync(
    "rsa",
    {
      modulusLength: 2048,
    },
  );

  return {
    kid,
    privateKey: pair.privateKey,
    jwk: pair.publicKey.export({ format: "jwk" }),
  };
}

const GOOGLE: SigningKey = makeKey("google-key-1");
const GOOGLE_NEXT: SigningKey = makeKey("google-key-2");
const ATTACKER: SigningKey = makeKey("google-key-1");

const NOW: Date = new Date("2026-11-06T10:00:00.000Z");
const NOW_SECONDS: number = Math.floor(NOW.getTime() / 1000);
const PUSHER: string =
  "oneuptime-push-6f1c3a2e@acme-prod-1.iam.gserviceaccount.com";

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(data: {
  key?: SigningKey;
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}): string {
  const key: SigningKey = data.key || GOOGLE;
  const header: string = base64Url(
    JSON.stringify(data.header || { alg: "RS256", kid: key.kid, typ: "JWT" }),
  );
  const payload: string = base64Url(
    JSON.stringify({
      aud: "oucs_6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f_" + "a".repeat(64),
      azp: "117283991817362837463",
      email: PUSHER,
      email_verified: true,
      iat: NOW_SECONDS - 60,
      exp: NOW_SECONDS + 3540,
      iss: "https://accounts.google.com",
      sub: "117283991817362837463",
      ...(data.payload || {}),
    }),
  );
  const signature: Buffer = crypto.sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    key.privateKey,
  );

  return `${header}.${payload}.${base64Url(signature)}`;
}

let server: http.Server;
let port: number;
let servedKeys: Array<SigningKey>;
let keyStatus: number;
let keyReads: number;

function jwkOf(key: SigningKey): Record<string, unknown> {
  return { ...key.jwk, kid: key.kid, alg: "RS256", use: "sig" };
}

// The real fetch's shape, over a real socket to the fake.
async function fetchFromFake(): Promise<GoogleKeysResponse> {
  return await new Promise<GoogleKeysResponse>(
    (
      resolve: (value: GoogleKeysResponse) => void,
      reject: (error: Error) => void,
    ) => {
      http
        .get(
          `http://127.0.0.1:${port}/oauth2/v3/certs`,
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];
            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              let body: unknown = undefined;

              try {
                body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              } catch {
                body = undefined;
              }

              resolve({
                status: response.statusCode || 0,
                body,
                cacheControl: response.headers["cache-control"],
              });
            });
          },
        )
        .on("error", reject);
    },
  );
}

beforeAll(async () => {
  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse) => {
      keyReads++;
      response.statusCode = keyStatus;
      response.setHeader("Content-Type", "application/json; charset=UTF-8");
      response.setHeader(
        "Cache-Control",
        "public, max-age=19500, must-revalidate, no-transform",
      );
      response.end(JSON.stringify({ keys: servedKeys.map(jwkOf) }));
    },
  );
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  GoogleOidcTokens.reset();
  servedKeys = [GOOGLE];
  keyStatus = 200;
  keyReads = 0;
  jest.spyOn(GoogleOidcTokens, "fetchKeys").mockImplementation(fetchFromFake);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectRefused(verdict: GoogleOidcVerdict, reason?: string): void {
  expect(verdict.isValid).toBe(false);

  if (!verdict.isValid) {
    expect(verdict.isUnavailable).toBe(false);

    if (reason) {
      expect(verdict.reason).toBe(reason);
    }
  }
}

describe("A token Google signed for a push", () => {
  test("is taken, with what it says", async () => {
    const verdict: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      sign({}),
      NOW,
    );

    expect(verdict).toEqual({
      isValid: true,
      claims: {
        audience: `oucs_6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f_${"a".repeat(64)}`,
        email: PUSHER,
        isEmailVerified: true,
        issuer: "https://accounts.google.com",
        issuedAtSeconds: NOW_SECONDS - 60,
        expiresAtSeconds: NOW_SECONDS + 3540,
        subject: "117283991817362837463",
      },
    });
    expect(keyReads).toBe(1);
  });

  test("Google's issuer is taken written either way it writes it", async () => {
    const verdict: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      sign({ payload: { iss: "accounts.google.com" } }),
      NOW,
    );

    expect(verdict.isValid).toBe(true);
  });

  test("is checked once: the same token pushed again is not verified again, until it expires", async () => {
    const token: string = sign({});
    const verify: SpyInstance<typeof crypto.verify> = jest.spyOn(
      crypto,
      "verify",
    );

    expect((await GoogleOidcTokens.verify(token, NOW)).isValid).toBe(true);
    expect((await GoogleOidcTokens.verify(token, NOW)).isValid).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);

    // An hour on, it has expired: refused, remembered or not.
    expectRefused(
      await GoogleOidcTokens.verify(
        token,
        new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
      ),
    );
  });
});

describe("A token anyone else made", () => {
  test("signed by another key under Google's key id is refused", async () => {
    expectRefused(
      await GoogleOidcTokens.verify(sign({ key: ATTACKER }), NOW),
      "its signature is not Google's",
    );
  });

  test("with no signature algorithm, or a shared-secret one keyed with Google's public key, is refused", async () => {
    const unsigned: string = `${base64Url(JSON.stringify({ alg: "none", kid: GOOGLE.kid }))}.${base64Url(
      JSON.stringify({ aud: "x", email: PUSHER, email_verified: true }),
    )}.`;
    const header: string = base64Url(
      JSON.stringify({ alg: "HS256", kid: GOOGLE.kid, typ: "JWT" }),
    );
    const payload: string = base64Url(
      JSON.stringify({ aud: "x", email: PUSHER, email_verified: true }),
    );
    const confused: string = `${header}.${payload}.${base64Url(
      crypto
        .createHmac("sha256", JSON.stringify(GOOGLE.jwk))
        .update(`${header}.${payload}`)
        .digest(),
    )}`;

    expectRefused(await GoogleOidcTokens.verify(unsigned, NOW));
    expectRefused(
      await GoogleOidcTokens.verify(confused, NOW),
      "not signed with RS256 by a named key",
    );
    expectRefused(
      await GoogleOidcTokens.verify(
        sign({ header: { alg: "RS256", typ: "JWT" } }),
        NOW,
      ),
      "not signed with RS256 by a named key",
    );
    // None of them made OneUptime read Google's keys.
    expect(keyReads).toBe(0);
  });

  test("not issued by Google is refused", async () => {
    expectRefused(
      await GoogleOidcTokens.verify(
        sign({ payload: { iss: "https://evil.example.com" } }),
        NOW,
      ),
      "not issued by Google",
    );
  });

  test("expired, not yet valid, or living longer than Google's do is refused", async () => {
    for (const payload of [
      { iat: NOW_SECONDS - 7200, exp: NOW_SECONDS - 3600 },
      { iat: NOW_SECONDS + 600, exp: NOW_SECONDS + 4200 },
      { iat: NOW_SECONDS - 60, exp: NOW_SECONDS + 3 * 3600 },
      { iat: "yesterday", exp: NOW_SECONDS + 600 },
    ]) {
      expectRefused(
        await GoogleOidcTokens.verify(sign({ payload }), NOW),
        "expired, or not yet valid",
      );
    }

    // A minute's skew either way is allowed.
    expect(
      (
        await GoogleOidcTokens.verify(
          sign({ payload: { iat: NOW_SECONDS + 30, exp: NOW_SECONDS + 3600 } }),
          NOW,
        )
      ).isValid,
    ).toBe(true);
  });

  test("for an email Google has not verified, or for no audience, is refused", async () => {
    for (const payload of [
      { email_verified: false },
      { email_verified: "true" },
      { email: "" },
      { aud: "" },
    ]) {
      expectRefused(
        await GoogleOidcTokens.verify(sign({ payload }), NOW),
        "for no verified email and audience",
      );
    }
  });

  test("that is not a token at all is refused without reading Google's keys", async () => {
    for (const token of [
      "",
      "a.b",
      "a.b.c.d",
      "a+b.c.d",
      `${base64Url("not json")}.${base64Url("{}")}.${base64Url("x")}`,
      `${base64Url(JSON.stringify(["array"]))}.${base64Url("{}")}.x`,
      "a".repeat(CLOUD_STREAM_MAX_BEARER_TOKEN_LENGTH + 1),
    ]) {
      expectRefused(await GoogleOidcTokens.verify(token, NOW));
    }

    expect(keyReads).toBe(0);
  });
});

describe("Google's keys", () => {
  test("are read once while Google says they are fresh", async () => {
    await GoogleOidcTokens.verify(sign({ payload: { sub: "1" } }), NOW);
    await GoogleOidcTokens.verify(
      sign({ payload: { sub: "2" } }),
      new Date(NOW.getTime() + 60 * 60 * 1000),
    );

    expect(keyReads).toBe(1);
  });

  test("are read again when a token names a key Google rotated in - and a key no one publishes, at most once a minute", async () => {
    await GoogleOidcTokens.verify(sign({}), NOW);
    servedKeys = [GOOGLE, GOOGLE_NEXT];

    const rotated: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      sign({ key: GOOGLE_NEXT }),
      new Date(NOW.getTime() + GOOGLE_OIDC_MISS_REFRESH_MS),
    );
    expect(rotated.isValid).toBe(true);
    expect(keyReads).toBe(2);

    // Invented key ids do not make OneUptime read Google's keys on every push.
    const stranger: SigningKey = makeKey("no-such-key");
    for (let index: number = 0; index < 5; index++) {
      expectRefused(
        await GoogleOidcTokens.verify(
          sign({ key: stranger, payload: { sub: String(index) } }),
          new Date(NOW.getTime() + GOOGLE_OIDC_MISS_REFRESH_MS + 1000),
        ),
        "signed by a key Google does not publish",
      );
    }
    expect(keyReads).toBe(2);
  });

  test("while they cannot be read, no token is taken - said as unavailable, so the push is sent again", async () => {
    keyStatus = 503;

    const verdict: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      sign({}),
      NOW,
    );

    expect(verdict.isValid).toBe(false);
    if (!verdict.isValid) {
      expect(verdict.isUnavailable).toBe(true);
    }

    // A Google that cannot be reached at all is the same.
    GoogleOidcTokens.reset();
    jest
      .spyOn(GoogleOidcTokens, "fetchKeys")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const unreachable: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      sign({}),
      NOW,
    );
    expect(unreachable.isValid === false && unreachable.isUnavailable).toBe(
      true,
    );
  });

  test("while Google cannot be reached, it is asked again only every 10 seconds, and the trouble logged once a minute", async () => {
    const fetch: SpyInstance<typeof GoogleOidcTokens.fetchKeys> = jest
      .spyOn(GoogleOidcTokens, "fetchKeys")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});

    for (let second: number = 0; second < 30; second++) {
      const verdict: GoogleOidcVerdict = await GoogleOidcTokens.verify(
        sign({ payload: { sub: String(second) } }),
        new Date(NOW.getTime() + second * 1000),
      );

      expect(verdict.isValid === false && verdict.isUnavailable).toBe(true);
    }

    // Seconds 0, 10 and 20: three reads for thirty pushes, one warning.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("ECONNREFUSED");

    // Once Google answers, pushes are taken again.
    fetch.mockImplementation(fetchFromFake);
    expect(
      (
        await GoogleOidcTokens.verify(
          sign({ payload: { sub: "back" } }),
          new Date(NOW.getTime() + 41 * 1000),
        )
      ).isValid,
    ).toBe(true);
  });

  test("kept, they keep working while Google cannot be asked again", async () => {
    await GoogleOidcTokens.verify(sign({}), NOW);
    keyStatus = 500;

    const later: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      sign({ payload: { sub: "later" } }),
      new Date(NOW.getTime() + 24 * 60 * 60 * 1000 + 1000),
    );

    expect(later.isValid).toBe(false);
    // Expired by its own time: the keys were there to check it.
    expect(!later.isValid && later.isUnavailable).toBe(false);
    expect(keyReads).toBe(2);
  });

  test("a key that is not an RSA signing key is not kept", async () => {
    servedKeys = [];
    jest.spyOn(GoogleOidcTokens, "fetchKeys").mockResolvedValue({
      status: 200,
      body: {
        keys: [
          { ...jwkOf(GOOGLE), use: "enc" },
          { ...jwkOf(GOOGLE), kty: "EC" },
          { ...jwkOf(GOOGLE), alg: "RS512" },
        ],
      },
    });

    const verdict: GoogleOidcVerdict = await GoogleOidcTokens.verify(
      sign({}),
      NOW,
    );
    expect(verdict.isValid === false && verdict.isUnavailable).toBe(true);
  });
});

describe("The pieces of a token and its header", () => {
  test("a bearer token is read from Authorization alone", () => {
    expect(readBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(readBearerToken("bearer   abc.def.ghi  ")).toBe("abc.def.ghi");
    expect(readBearerToken(["Bearer one", "Bearer two"])).toBe("one");
    expect(readBearerToken("Basic abc")).toBe("");
    expect(readBearerToken("abc.def.ghi")).toBe("");
    expect(readBearerToken(undefined)).toBe("");
    expect(
      readBearerToken(
        `Bearer ${"a".repeat(CLOUD_STREAM_MAX_BEARER_TOKEN_LENGTH + 100)}`,
      ),
    ).toBe("");
  });

  test("a token's parts are read without trusting them", () => {
    const parts: ReturnType<typeof readUnverifiedJwt> = readUnverifiedJwt(
      sign({}),
    );

    expect(parts?.header["kid"]).toBe(GOOGLE.kid);
    expect(parts?.payload["email"]).toBe(PUSHER);
    expect(readUnverifiedJwt(42)).toBeNull();
  });

  test("Cache-Control's max-age is read as Google writes it", () => {
    expect(
      readMaxAgeSeconds("public, max-age=19500, must-revalidate, no-transform"),
    ).toBe(19500);
    expect(readMaxAgeSeconds("no-store")).toBeNull();
    expect(readMaxAgeSeconds("max-age=soon")).toBeNull();
    expect(readMaxAgeSeconds(undefined)).toBeNull();
  });
});
