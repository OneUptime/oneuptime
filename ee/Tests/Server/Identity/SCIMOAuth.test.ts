import { describe, expect, test } from "@jest/globals";
import {
  generateScimClientSecret,
  getScimClientSecretExpiry,
  getScimClientSecretFingerprint,
  hashScimClientSecret,
  isLiveScimClientSecretFingerprint,
  isSignedTokenShaped,
  matchScimClientSecret,
  readScimAccessToken,
  SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
  SCIM_ACCESS_TOKEN_PURPOSE,
  SCIM_CLIENT_SECRET_LIFETIME_IN_DAYS,
  ScimAccessTokenClaims,
  ScimClientSecrets,
  signScimAccessToken,
} from "../../../Server/Identity/Utils/SCIMOAuth";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import JsonWebTokenPurpose from "Common/Types/JsonWebTokenPurpose";
import { JSONObject } from "Common/Types/JSON";
import { createHmac } from "crypto";

/*
 * A SCIM connection's OAuth 2.0 client credentials: secrets made and kept
 * as hashes, matched only while they live, and access tokens that name
 * their connection and the secret they were issued with - so replacing,
 * deleting or the expiry of that secret ends them - and that are never any
 * other kind of token.
 */

// Decoding a token signed for another use logs why it was refused.
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

const CONNECTION_ID: string = "3f000000-0000-4000-8000-000000000001";
const OTHER_CONNECTION_ID: string = "3f000000-0000-4000-8000-000000000002";
const NOW: Date = new Date("2026-10-18T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const SECRET: string = generateScimClientSecret();
const PREVIOUS_SECRET: string = generateScimClientSecret();

// A token as OneUptime signs them (HS256), but with a key that is not OneUptime's.
const signWithAnotherKey: (payload: JSONObject) => string = (
  payload: JSONObject,
): string => {
  const encode: (value: JSONObject) => string = (value: JSONObject): string => {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  };
  const issuedAt: number = Math.floor(Date.now() / 1000);
  const unsigned: string = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    ...payload,
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`;

  return `${unsigned}.${createHmac("sha256", "some-other-key")
    .update(unsigned)
    .digest("base64url")}`;
};

const connectionWith: (
  overrides?: Partial<ScimClientSecrets>,
) => ScimClientSecrets = (
  overrides: Partial<ScimClientSecrets> = {},
): ScimClientSecrets => {
  return {
    oauthClientSecretHash: hashScimClientSecret(SECRET),
    oauthClientSecretExpiresAt: new Date(NOW.getTime() + 30 * DAY_IN_MS),
    oauthPreviousClientSecretHash: hashScimClientSecret(PREVIOUS_SECRET),
    oauthPreviousClientSecretExpiresAt: new Date(NOW.getTime() + DAY_IN_MS),
    ...overrides,
  };
};

describe("client secrets", () => {
  test("are 32 random bytes, as 64 hex characters, never the same twice", () => {
    const secrets: Set<string> = new Set<string>();

    for (let i: number = 0; i < 50; i++) {
      const secret: string = generateScimClientSecret();

      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      secrets.add(secret);
    }

    expect(secrets.size).toBe(50);
  });

  test("are kept as their SHA-256", () => {
    expect(hashScimClientSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashScimClientSecret(SECRET)).not.toContain(SECRET);
  });

  test("work for a year, inside the one to three years Microsoft Entra ID requires", () => {
    const expiry: Date = getScimClientSecretExpiry(NOW);

    expect(SCIM_CLIENT_SECRET_LIFETIME_IN_DAYS).toBe(365);
    expect(expiry.getTime() - NOW.getTime()).toBe(365 * DAY_IN_MS);
  });
});

describe("matchScimClientSecret", () => {
  test("the current secret matches, as its hash", () => {
    expect(
      matchScimClientSecret({
        secret: SECRET,
        connection: connectionWith(),
        now: NOW,
      }),
    ).toBe(hashScimClientSecret(SECRET));
  });

  test("the previous secret still matches while it lives", () => {
    expect(
      matchScimClientSecret({
        secret: PREVIOUS_SECRET,
        connection: connectionWith(),
        now: NOW,
      }),
    ).toBe(hashScimClientSecret(PREVIOUS_SECRET));
  });

  test("an expired secret matches nothing: no token on expired credentials", () => {
    expect(
      matchScimClientSecret({
        secret: SECRET,
        connection: connectionWith({
          oauthClientSecretExpiresAt: new Date(NOW.getTime() - 1),
        }),
        now: NOW,
      }),
    ).toBe(null);
    expect(
      matchScimClientSecret({
        secret: PREVIOUS_SECRET,
        connection: connectionWith({
          oauthPreviousClientSecretExpiresAt: NOW,
        }),
        now: NOW,
      }),
    ).toBe(null);
  });

  test("a secret with no expiry, a deleted one, a wrong one and an empty one match nothing", () => {
    expect(
      matchScimClientSecret({
        secret: SECRET,
        connection: connectionWith({ oauthClientSecretExpiresAt: undefined }),
        now: NOW,
      }),
    ).toBe(null);
    expect(
      matchScimClientSecret({
        secret: PREVIOUS_SECRET,
        connection: connectionWith({
          oauthPreviousClientSecretHash: undefined,
        }),
        now: NOW,
      }),
    ).toBe(null);
    expect(
      matchScimClientSecret({
        secret: generateScimClientSecret(),
        connection: connectionWith(),
        now: NOW,
      }),
    ).toBe(null);
    expect(
      matchScimClientSecret({
        secret: "",
        connection: connectionWith(),
        now: NOW,
      }),
    ).toBe(null);
  });

  test("the hash itself is not the secret", () => {
    expect(
      matchScimClientSecret({
        secret: hashScimClientSecret(SECRET),
        connection: connectionWith(),
        now: NOW,
      }),
    ).toBe(null);
  });
});

describe("access tokens", () => {
  const token: string = signScimAccessToken({
    connectionId: CONNECTION_ID.toUpperCase(),
    connectionType: "project",
    secretHash: hashScimClientSecret(SECRET),
  });

  test("are signed tokens that say what they are, for an hour", () => {
    const claims: JSONObject = JSONWebToken.decodeJsonPayload(token);

    expect(claims["purpose"]).toBe(SCIM_ACCESS_TOKEN_PURPOSE);
    expect(claims["scimConnectionId"]).toBe(CONNECTION_ID);
    expect(claims["scimConnectionType"]).toBe("project");
    expect((claims["exp"] as number) - (claims["iat"] as number)).toBe(
      SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    );
    expect(SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS).toBeGreaterThanOrEqual(3600);
    expect(SCIM_ACCESS_TOKEN_EXPIRES_IN_SECONDS).toBeLessThanOrEqual(21600);
  });

  test("carry neither the secret nor its hash", () => {
    const payload: string = JSON.stringify(
      JSONWebToken.decodeJsonPayload(token),
    );

    expect(payload).not.toContain(SECRET);
    expect(payload).not.toContain(hashScimClientSecret(SECRET));
  });

  test("are read for their own connection, whatever the case of its id", () => {
    const claims: ScimAccessTokenClaims | null = readScimAccessToken({
      token: token,
      connectionId: CONNECTION_ID.toUpperCase(),
    });

    expect(claims).toEqual({
      connectionType: "project",
      secretFingerprint: getScimClientSecretFingerprint(
        hashScimClientSecret(SECRET),
      ),
    });
  });

  test("are nothing for another connection", () => {
    expect(
      readScimAccessToken({ token: token, connectionId: OTHER_CONNECTION_ID }),
    ).toBe(null);
  });

  test("an edited token, an expired one, and a bearer token are no access token", () => {
    const parts: Array<string> = token.split(".");
    const edited: string = `${parts[0]}.${parts[1]}x.${parts[2]}`;

    expect(
      readScimAccessToken({ token: edited, connectionId: CONNECTION_ID }),
    ).toBe(null);

    const expired: string = JSONWebToken.signJsonPayload(
      {
        purpose: SCIM_ACCESS_TOKEN_PURPOSE,
        scimConnectionId: CONNECTION_ID,
        scimConnectionType: "project",
        secret: "x",
      },
      -10,
    );

    expect(
      readScimAccessToken({ token: expired, connectionId: CONNECTION_ID }),
    ).toBe(null);
    expect(
      readScimAccessToken({
        token: generateScimClientSecret(),
        connectionId: CONNECTION_ID,
      }),
    ).toBe(null);
  });

  test("a token signed with another key is no access token", () => {
    const forged: string = signWithAnotherKey({
      purpose: SCIM_ACCESS_TOKEN_PURPOSE,
      scimConnectionId: CONNECTION_ID,
      scimConnectionType: "project",
      secret: getScimClientSecretFingerprint(hashScimClientSecret(SECRET)),
    });

    expect(
      readScimAccessToken({ token: forged, connectionId: CONNECTION_ID }),
    ).toBe(null);
  });

  test("no other token OneUptime signs is one, and an access token is no other token", () => {
    const session: string = JSONWebToken.signJsonPayload(
      {
        userId: CONNECTION_ID,
        sessionId: OTHER_CONNECTION_ID,
        purpose: JsonWebTokenPurpose.UserSession,
      },
      3600,
    );

    expect(
      readScimAccessToken({ token: session, connectionId: CONNECTION_ID }),
    ).toBe(null);

    for (const purpose of Object.values(JsonWebTokenPurpose)) {
      expect(() => {
        JSONWebToken.decode(token, purpose);
      }).toThrow();
    }
  });

  test("a token of an unknown connection type is no access token", () => {
    const odd: string = JSONWebToken.signJsonPayload(
      {
        purpose: SCIM_ACCESS_TOKEN_PURPOSE,
        scimConnectionId: CONNECTION_ID,
        scimConnectionType: "global",
        secret: "x",
      },
      3600,
    );

    expect(
      readScimAccessToken({ token: odd, connectionId: CONNECTION_ID }),
    ).toBe(null);
  });
});

describe("an access token lives only while the secret it was issued with does", () => {
  const fingerprint: string = getScimClientSecretFingerprint(
    hashScimClientSecret(SECRET),
  );

  test("while it is the current secret, or the previous one", () => {
    expect(
      isLiveScimClientSecretFingerprint({
        secretFingerprint: fingerprint,
        connection: connectionWith(),
        now: NOW,
      }),
    ).toBe(true);

    // Replaced: it is the previous secret now, and still lives.
    expect(
      isLiveScimClientSecretFingerprint({
        secretFingerprint: fingerprint,
        connection: connectionWith({
          oauthClientSecretHash: hashScimClientSecret(
            generateScimClientSecret(),
          ),
          oauthPreviousClientSecretHash: hashScimClientSecret(SECRET),
        }),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("not once it is deleted, or has expired", () => {
    expect(
      isLiveScimClientSecretFingerprint({
        secretFingerprint: fingerprint,
        connection: connectionWith({
          oauthClientSecretHash: hashScimClientSecret(
            generateScimClientSecret(),
          ),
          oauthPreviousClientSecretHash: undefined,
        }),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isLiveScimClientSecretFingerprint({
        secretFingerprint: fingerprint,
        connection: connectionWith({
          oauthClientSecretExpiresAt: new Date(NOW.getTime() - 1),
        }),
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("isSignedTokenShaped", () => {
  test("three dot-separated parts, as a signed token has", () => {
    expect(isSignedTokenShaped("a.b.c")).toBe(true);
    expect(isSignedTokenShaped(generateScimClientSecret())).toBe(false);
    expect(isSignedTokenShaped("a.b")).toBe(false);
    expect(isSignedTokenShaped(`${"a".repeat(5000)}.b.c`)).toBe(false);
  });
});
