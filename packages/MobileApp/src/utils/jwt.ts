/*
 * Minimal, dependency-free JWT payload reader.
 *
 * The app never verifies signatures - the server does that on every request.
 * All the client needs is the `exp` claim, so it can stop sending a token it
 * already knows the server will reject and re-authenticate instead of showing
 * the user a screen full of 4xx errors.
 *
 * `atob` is not guaranteed to exist across every React Native runtime the app
 * ships on (and Hermes has historically shipped without it), so the base64url
 * decode is written out by hand rather than delegated.
 */

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decodes a base64url string (JWT flavour: `-`/`_` instead of `+`/`/`, and
 * padding omitted) into its raw bytes, interpreted as UTF-8.
 *
 * Returns null rather than throwing on malformed input - callers treat an
 * unreadable token exactly the same as an expired one.
 */
export function decodeBase64Url(value: string): string | null {
  const normalized: string = value.replace(/-/g, "+").replace(/_/g, "/");

  const bytes: Array<number> = [];
  let buffer: number = 0;
  let bitsInBuffer: number = 0;

  for (const char of normalized) {
    if (char === "=") {
      break;
    }

    const charIndex: number = BASE64_ALPHABET.indexOf(char);

    if (charIndex === -1) {
      // Any character outside the alphabet means this is not base64url.
      return null;
    }

    buffer = (buffer << 6) | charIndex;
    bitsInBuffer += 6;

    if (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      bytes.push((buffer >> bitsInBuffer) & 0xff);
    }
  }

  return decodeUtf8(bytes);
}

/*
 * Hand-rolled UTF-8 decode. TextDecoder is not universally available in React
 * Native either, and String.fromCharCode alone would mangle any non-ASCII
 * character in a name or email claim.
 */
function decodeUtf8(bytes: Array<number>): string | null {
  let result: string = "";
  let index: number = 0;

  while (index < bytes.length) {
    const byte1: number = bytes[index]!;

    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
      index += 1;
      continue;
    }

    if (byte1 >= 0xc0 && byte1 < 0xe0 && index + 1 < bytes.length) {
      result += String.fromCharCode(
        ((byte1 & 0x1f) << 6) | (bytes[index + 1]! & 0x3f),
      );
      index += 2;
      continue;
    }

    if (byte1 >= 0xe0 && byte1 < 0xf0 && index + 2 < bytes.length) {
      result += String.fromCharCode(
        ((byte1 & 0x0f) << 12) |
          ((bytes[index + 1]! & 0x3f) << 6) |
          (bytes[index + 2]! & 0x3f),
      );
      index += 3;
      continue;
    }

    if (byte1 >= 0xf0 && index + 3 < bytes.length) {
      const codePoint: number =
        ((byte1 & 0x07) << 18) |
        ((bytes[index + 1]! & 0x3f) << 12) |
        ((bytes[index + 2]! & 0x3f) << 6) |
        (bytes[index + 3]! & 0x3f);

      // Outside the BMP - encode as a surrogate pair.
      const offset: number = codePoint - 0x10000;
      result += String.fromCharCode(
        0xd800 + (offset >> 10),
        0xdc00 + (offset & 0x3ff),
      );
      index += 4;
      continue;
    }

    return null;
  }

  return result;
}

export interface JwtPayload {
  // Seconds since the epoch, per RFC 7519. Absent on tokens that never expire.
  exp?: number;
  [claim: string]: unknown;
}

/**
 * Reads the payload of a JWT without verifying it. Returns null for anything
 * that is not a well-formed three-segment JWT with a JSON payload.
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  if (!token) {
    return null;
  }

  const segments: Array<string> = token.split(".");

  if (segments.length !== 3) {
    return null;
  }

  const decoded: string | null = decodeBase64Url(segments[1]!);

  if (decoded === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(decoded);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as JwtPayload;
  } catch {
    return null;
  }
}

/*
 * Treat a token as expired slightly before the server does, so a request that
 * is in flight when the clock ticks past `exp` does not come back 401.
 */
const EXPIRY_LEEWAY_SECONDS: number = 30;

/**
 * True when the token is expired, malformed, or empty - i.e. whenever the app
 * should stop relying on it. A well-formed token with no `exp` claim is
 * treated as still valid, matching how the server reads it.
 */
export function isJwtExpired(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!token) {
    return true;
  }

  const payload: JwtPayload | null = decodeJwtPayload(token);

  if (!payload) {
    return true;
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return false;
  }

  return payload.exp * 1000 <= nowMs + EXPIRY_LEEWAY_SECONDS * 1000;
}
