import { describe, expect, test, beforeEach } from "@jest/globals";
import { getUserIdFromToken, loadCurrentUserId } from "./currentUser";
import { getCachedAccessToken, getTokens } from "../storage/keychain";

jest.mock("../storage/keychain", () => {
  return {
    __esModule: true,
    getCachedAccessToken: jest.fn(() => {
      return null;
    }),
    getTokens: jest.fn(async () => {
      return null;
    }),
  };
});

function cachedSpy(): jest.SpyInstance {
  return getCachedAccessToken as unknown as jest.SpyInstance;
}

function storedSpy(): jest.SpyInstance {
  return getTokens as unknown as jest.SpyInstance;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");
}

function tokenFor(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(JSON.stringify(payload)),
    "not-a-real-signature",
  ].join(".");
}

/*
 * Why this exists at all: `useAuth().user` is only set by a login that happened
 * in THIS process, so on every cold start it is null while the session itself
 * is perfectly valid. Every on-call screen compares the signed-in user against
 * a roster, and a null there does not merely degrade the screen - it inverts
 * it, showing "not on call" to the person whose phone is about to ring.
 */

describe("getUserIdFromToken", () => {
  test("reads the userId claim the server puts in the access token", () => {
    expect(getUserIdFromToken(tokenFor({ userId: "user-1" }))).toBe("user-1");
  });

  test("returns null for a token with no userId claim", () => {
    expect(
      getUserIdFromToken(tokenFor({ email: "ada@example.com" })),
    ).toBeNull();
  });

  test("returns null when the claim is not a string", () => {
    /*
     * Never coerce. A numeric or object claim compared against a roster id
     * would never match, and silently returning String(value) would hide that
     * the token is not what this code thinks it is.
     */
    expect(getUserIdFromToken(tokenFor({ userId: 42 }))).toBeNull();
    expect(getUserIdFromToken(tokenFor({ userId: { id: "x" } }))).toBeNull();
  });

  test("returns null for an empty claim", () => {
    expect(getUserIdFromToken(tokenFor({ userId: "" }))).toBeNull();
  });

  test("returns null for anything that is not a JWT", () => {
    expect(getUserIdFromToken(null)).toBeNull();
    expect(getUserIdFromToken(undefined)).toBeNull();
    expect(getUserIdFromToken("")).toBeNull();
    expect(getUserIdFromToken("abc.def")).toBeNull();
    expect(getUserIdFromToken("abc.def.ghi")).toBeNull();
  });
});

describe("loadCurrentUserId", () => {
  beforeEach(() => {
    cachedSpy().mockReset();
    storedSpy().mockReset();
    cachedSpy().mockReturnValue(null);
    storedSpy().mockResolvedValue(null as never);
  });

  test("prefers the in-memory token, without touching storage", async () => {
    cachedSpy().mockReturnValue(tokenFor({ userId: "user-cached" }));

    await expect(loadCurrentUserId()).resolves.toBe("user-cached");
    expect(storedSpy()).not.toHaveBeenCalled();
  });

  test("falls back to stored tokens on a cold start", async () => {
    /*
     * The cache is only populated once something has read the keychain, and on
     * the first render after launch nothing has. Without this fallback the
     * on-call tab would show "not on call" for the first seconds of every
     * launch - or forever, if nothing else happened to read the keychain.
     */
    storedSpy().mockResolvedValue({
      accessToken: tokenFor({ userId: "user-stored" }),
    } as never);

    await expect(loadCurrentUserId()).resolves.toBe("user-stored");
  });

  test("returns null when there is no session at all", async () => {
    await expect(loadCurrentUserId()).resolves.toBeNull();
  });

  test("returns null when the stored token carries no user id", async () => {
    storedSpy().mockResolvedValue({
      accessToken: tokenFor({ email: "ada@example.com" }),
    } as never);

    await expect(loadCurrentUserId()).resolves.toBeNull();
  });
});
