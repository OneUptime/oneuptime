import * as Crypto from "expo-crypto";

export const PASSKEY_CALLBACK_URL: string = "oneuptime://passkey";
const CODE_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

export interface PasskeyRequest {
  serverOrigin: string;
  state: string;
  codeVerifier: string;
  url: string;
}

/*
 * React Native's URL implementation differs from the browser implementation.
 * Accept only an HTTPS origin, never credentials, paths, queries or fragments.
 */
export function passkeyServerOrigin(serverUrl: string): string {
  const match: RegExpMatchArray | null = serverUrl.match(
    /^https:\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i,
  );
  const port: number | undefined = match?.[2] ? Number(match[2]) : undefined;

  if (
    !match ||
    match[0] !== serverUrl ||
    (port !== undefined && (port < 1 || port > 65535))
  ) {
    throw new Error(
      "Passkeys need a secure HTTPS server address. Change Server to update it.",
    );
  }

  return `https://${match[1]!.toLowerCase()}${port && port !== 443 ? `:${port}` : ""}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte: number): string => {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

export async function createPasskeyRequest(
  serverUrl: string,
): Promise<PasskeyRequest> {
  const serverOrigin: string = passkeyServerOrigin(serverUrl);
  const [verifierBytes, stateBytes]: [Uint8Array, Uint8Array] =
    await Promise.all([
      Crypto.getRandomBytesAsync(32),
      Crypto.getRandomBytesAsync(32),
    ]);
  const codeVerifier: string = hex(verifierBytes);
  const state: string = hex(stateBytes);
  const digest: string = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const codeChallenge: string = digest
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");

  return {
    serverOrigin,
    state,
    codeVerifier,
    url: `${serverOrigin}/accounts/mobile-passkey?state=${state}&codeChallenge=${codeChallenge}&codeChallengeMethod=S256`,
  };
}

export type PasskeyCallback =
  | { status: "success"; code: string }
  | { status: "cancelled" };

/** Strictly bind a callback to the app request that opened the browser. */
export function parsePasskeyCallback(
  url: string,
  request: PasskeyRequest,
): PasskeyCallback {
  const match: RegExpMatchArray | null = url.match(
    /^oneuptime:\/\/passkey\/?\?([^#]+)$/,
  );
  const params: Map<string, string> = new Map<string, string>();

  if (!match || match[0] !== url || url.trim() !== url) {
    throw new Error(
      "This passkey sign-in could not be verified. Please try again.",
    );
  }

  try {
    for (const pair of match[1]!.split("&")) {
      const separator: number = pair.indexOf("=");
      if (separator < 1) {
        throw new Error("Invalid callback");
      }
      const key: string = decodeURIComponent(pair.slice(0, separator));
      const value: string = decodeURIComponent(pair.slice(separator + 1));
      if (
        params.has(key) ||
        !["code", "state", "serverOrigin", "error"].includes(key)
      ) {
        throw new Error("Invalid callback");
      }
      params.set(key, value);
    }

    if (
      params.get("state") !== request.state ||
      params.get("serverOrigin") !== request.serverOrigin
    ) {
      throw new Error("Invalid callback");
    }

    if (params.get("error") === "access_denied" && !params.has("code")) {
      return { status: "cancelled" };
    }

    const code: string = params.get("code") || "";
    if (params.has("error") || code.length !== 43 || !CODE_PATTERN.test(code)) {
      throw new Error("Invalid callback");
    }
    return { status: "success", code };
  } catch {
    throw new Error(
      "This passkey sign-in could not be verified. Please try again.",
    );
  }
}
