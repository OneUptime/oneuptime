import AsyncStorage from "@react-native-async-storage/async-storage";
import { createHash } from "node:crypto";
import { fetchServerHandsBackSsoCodes } from "../api/sso";
import { parseQueryString } from "./callbackUrl";
import {
  beginSsoHandOff,
  clearPendingSsoHandOff,
  forgetCachedSsoHandOffForTesting,
  getCachedPendingSsoHandOff,
  readPendingSsoHandOff,
  SSO_HAND_OFF_TTL_MS,
  startSsoHandOff,
  type PendingSsoHandOff,
  type SsoHandOffRequest,
} from "./handOff";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE SIGN-IN THE APP STARTED, AND WAITS FOR (#9989).
 *
 * Every SSO sign-in the app starts carries a state and a PKCE challenge of
 * its own, so that the deep link that ends it - a custom scheme anybody can
 * open, and any Android app can claim - is taken only with that state, and
 * its one-time code redeemed only with the verifier that never left the
 * phone. These hold what is kept, what the server is sent, and that a
 * sign-in survives the OS stopping the app while the person is at their
 * identity provider. Every test runs on iOS and on Android.
 */

jest.mock("expo-crypto", () => {
  const crypto: typeof import("node:crypto") =
    jest.requireActual("node:crypto");

  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    CryptoEncoding: { BASE64: "base64" },
    getRandomBytesAsync: async (length: number): Promise<Uint8Array> => {
      return new Uint8Array(crypto.randomBytes(length));
    },
    digestStringAsync: async (
      _algorithm: string,
      value: string,
    ): Promise<string> => {
      return crypto.createHash("sha256").update(value, "utf8").digest("base64");
    },
  };
});

jest.mock("../api/sso", () => {
  return { fetchServerHandsBackSsoCodes: jest.fn() };
});

// The on-disk contract between one build and the next, as a literal.
const STORAGE_KEY: string = "oneuptime_sso_hand_off";

const SERVER_URL: string = "https://status.acme.com";
const SSO_URL: string = `${SERVER_URL}/identity/sso/project-1/provider-1?mobile=true`;

function capability(): jest.Mock {
  return fetchServerHandsBackSsoCodes as unknown as jest.Mock;
}

async function stored(): Promise<PendingSsoHandOff> {
  return JSON.parse(
    (await AsyncStorage.getItem(STORAGE_KEY)) as string,
  ) as PendingSsoHandOff;
}

// RFC 7636's S256: base64url of the verifier's SHA-256, unpadded.
function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

// Read as the app reads a query: React Native's URLSearchParams is not Node's.
function queryOf(url: string): Record<string, string> {
  return parseQueryString(url.slice(url.indexOf("?") + 1));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearPendingSsoHandOff();
  capability().mockResolvedValue(true);
});

describe("Starting a sign-in's hand-off", () => {
  test("sends the server a state and the S256 challenge of a verifier it keeps", async () => {
    const request: SsoHandOffRequest = await startSsoHandOff({
      serverUrl: SERVER_URL,
      serverHandsBackCodes: true,
    });
    const kept: PendingSsoHandOff = await stored();

    expect(kept.state).toBe(request.state);
    expect(kept.codeVerifier).toMatch(/^[0-9a-f]{64}$/);
    expect(kept.state).toMatch(/^[0-9a-f]{64}$/);
    expect(request.codeChallenge).toBe(s256(kept.codeVerifier));
    expect(request.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The verifier is the one thing the server is never sent.
    expect(JSON.stringify(request)).not.toContain(kept.codeVerifier);
  });

  test("keeps which server it started on, and what that server said", async () => {
    await startSsoHandOff({
      serverUrl: `${SERVER_URL}/`,
      serverHandsBackCodes: false,
    });

    expect(await stored()).toMatchObject({
      serverUrl: SERVER_URL,
      serverHandsBackCodes: false,
    });
  });

  test("makes a new state and verifier each time, the newer replacing the older", async () => {
    const first: SsoHandOffRequest = await startSsoHandOff({
      serverUrl: SERVER_URL,
      serverHandsBackCodes: true,
    });
    const second: SsoHandOffRequest = await startSsoHandOff({
      serverUrl: SERVER_URL,
      serverHandsBackCodes: true,
    });

    expect(second.state).not.toBe(first.state);
    expect(second.codeChallenge).not.toBe(first.codeChallenge);
    expect((await stored()).state).toBe(second.state);
    expect(getCachedPendingSsoHandOff()!.state).toBe(second.state);
  });
});

describe("The address a sign-in opens with", () => {
  test("is the provider's, with the state and the challenge beside ?mobile=true", async () => {
    const url: string = await beginSsoHandOff(SSO_URL);
    const query: Record<string, string> = queryOf(url);
    const kept: PendingSsoHandOff = await stored();

    expect(url.startsWith(`${SSO_URL}&`)).toBe(true);
    expect(query["mobile"]).toBe("true");
    expect(query["state"]).toBe(kept.state);
    expect(query["codeChallenge"]).toBe(s256(kept.codeVerifier));
    expect(query["codeChallengeMethod"]).toBe("S256");
    expect(url).not.toContain(kept.codeVerifier);
  });

  test("asks the server the sign-in starts on whether it hands back codes, and keeps the answer", async () => {
    capability().mockResolvedValue(false);

    await beginSsoHandOff(SSO_URL);

    expect(capability()).toHaveBeenCalledWith(SERVER_URL);
    expect((await stored()).serverHandsBackCodes).toBe(false);
  });

  test("works for each kind of provider's address", async () => {
    for (const path of [
      "/identity/oidc/project-1/provider-2?mobile=true",
      "/identity/global-sso/provider-3?mobile=true",
      "/identity/global-oidc/provider-4?mobile=true",
    ]) {
      const url: string = await beginSsoHandOff(`${SERVER_URL}${path}`);

      expect(queryOf(url)["codeChallengeMethod"]).toBe("S256");
      expect((await stored()).serverUrl).toBe(SERVER_URL);
    }
  });

  test("is refused for an address that is not a provider's sign-in", async () => {
    await expect(
      beginSsoHandOff("https://status.acme.com/dashboard"),
    ).rejects.toThrow();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("The sign-in the app waits for", () => {
  test("is read back from storage after the OS stopped the app", async () => {
    const request: SsoHandOffRequest = await startSsoHandOff({
      serverUrl: SERVER_URL,
      serverHandsBackCodes: true,
    });

    forgetCachedSsoHandOffForTesting();

    expect(getCachedPendingSsoHandOff()).toBeNull();
    expect((await readPendingSsoHandOff())!.state).toBe(request.state);
  });

  test("is none once fifteen minutes have passed, and is forgotten", async () => {
    await startSsoHandOff({
      serverUrl: SERVER_URL,
      serverHandsBackCodes: true,
    });
    forgetCachedSsoHandOffForTesting();

    const later: jest.SpyInstance = jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + SSO_HAND_OFF_TTL_MS + 1);

    try {
      expect(await readPendingSsoHandOff()).toBeNull();
      expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      later.mockRestore();
    }
  });

  test("is none for a stored value that is not one", async () => {
    for (const value of [
      "not json",
      "{}",
      JSON.stringify({ state: "short", codeVerifier: "short" }),
    ]) {
      await AsyncStorage.setItem(STORAGE_KEY, value);
      forgetCachedSsoHandOffForTesting();

      expect(await readPendingSsoHandOff()).toBeNull();
    }
  });

  test("ends when it is cleared", async () => {
    await startSsoHandOff({
      serverUrl: SERVER_URL,
      serverHandsBackCodes: true,
    });
    await clearPendingSsoHandOff();

    expect(getCachedPendingSsoHandOff()).toBeNull();
    expect(await readPendingSsoHandOff()).toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
