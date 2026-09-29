import crypto from "crypto";

/*
 * A stand-in for the authenticator app on the user's phone.
 *
 * Every function here is derived from RFC 4648 (base32), RFC 4226 (HOTP) and
 * RFC 6238 (TOTP) using Node's own crypto primitives. Nothing in this file
 * imports `otpauth`, and that is the entire point: the server verifies with
 * `otpauth`, so a test that also generates its expected codes with `otpauth`
 * proves only that the library agrees with itself. It would have passed
 * happily throughout issue #3275, while every user with Google Authenticator
 * was locked out.
 *
 * The most useful thing in here is `googleAuthenticatorCode`, which models the
 * behaviour that caused that bug: real phone apps parse the otpauth:// URI,
 * IGNORE its `algorithm` parameter, and compute SHA1 regardless.
 */

const BASE32_ALPHABET: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const DEFAULT_DIGITS: number = 6;
export const DEFAULT_PERIOD_IN_SECONDS: number = 30;

/** The algorithm a phone app uses no matter what the QR code claims. */
export const PHONE_APP_ALGORITHM: string = "SHA1";

export type Base32EncodeFunction = (bytes: Buffer) => string;

export const base32Encode: Base32EncodeFunction = (bytes: Buffer): string => {
  let bits: string = "";

  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }

  let output: string = "";

  for (let i: number = 0; i < bits.length; i += 5) {
    const chunk: string = bits.slice(i, i + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }

  return output;
};

export type Base32DecodeFunction = (encoded: string) => Buffer;

export const base32Decode: Base32DecodeFunction = (encoded: string): Buffer => {
  let bits: string = "";

  for (const character of encoded.replace(/[=]+$/, "").toUpperCase()) {
    const value: number = BASE32_ALPHABET.indexOf(character);

    if (value === -1) {
      throw new Error(`Not base32: ${character}`);
    }

    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: Array<number> = [];

  for (let i: number = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
};

/*
 * HOTP, RFC 4226 section 5.3: HMAC the 8-byte big-endian counter under the
 * shared key, take the low nibble of the last byte as an offset, read a
 * big-endian 31-bit integer from there, reduce modulo 10^digits.
 */
export type HotpFunction = (data: {
  key: Buffer;
  counter: number;
  algorithm: string;
  digits: number;
}) => string;

export const hotp: HotpFunction = (data: {
  key: Buffer;
  counter: number;
  algorithm: string;
  digits: number;
}): string => {
  const counterBytes: Buffer = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(data.counter));

  const digest: Buffer = crypto
    .createHmac(data.algorithm.toLowerCase(), data.key)
    .update(counterBytes)
    .digest();

  const offset: number = digest[digest.length - 1]! & 0x0f;

  const binary: number =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return (binary % 10 ** data.digits).toString().padStart(data.digits, "0");
};

/*
 * TOTP: HOTP with the counter derived from the clock (RFC 6238 section 4).
 */
export type AuthenticatorCodeFunction = (data: {
  secretBase32: string;
  algorithm?: string | undefined;
  digits?: number | undefined;
  periodInSeconds?: number | undefined;
  atUnixSeconds?: number | undefined;
}) => string;

export const authenticatorCode: AuthenticatorCodeFunction = (data: {
  secretBase32: string;
  algorithm?: string | undefined;
  digits?: number | undefined;
  periodInSeconds?: number | undefined;
  atUnixSeconds?: number | undefined;
}): string => {
  const period: number = data.periodInSeconds || DEFAULT_PERIOD_IN_SECONDS;

  const seconds: number =
    data.atUnixSeconds === undefined
      ? Math.floor(Date.now() / 1000)
      : data.atUnixSeconds;

  return hotp({
    key: base32Decode(data.secretBase32),
    counter: Math.floor(seconds / period),
    algorithm: data.algorithm || PHONE_APP_ALGORITHM,
    digits: data.digits === undefined ? DEFAULT_DIGITS : data.digits,
  });
};

export type OtpauthUriParams = {
  secret: string;
  algorithm: string;
  digits: number;
  periodInSeconds: number;
  issuer: string | null;
};

export type ParseOtpauthUriFunction = (uri: string) => OtpauthUriParams;

export const parseOtpauthUri: ParseOtpauthUriFunction = (
  uri: string,
): OtpauthUriParams => {
  const params: URLSearchParams = new URLSearchParams(
    uri.slice(uri.indexOf("?") + 1),
  );

  return {
    secret: params.get("secret") || "",
    algorithm: params.get("algorithm") || PHONE_APP_ALGORITHM,
    digits: parseInt(params.get("digits") || String(DEFAULT_DIGITS), 10),
    periodInSeconds: parseInt(
      params.get("period") || String(DEFAULT_PERIOD_IN_SECONDS),
      10,
    ),
    issuer: params.get("issuer"),
  };
};

/*
 * What an app that honours every parameter in the URI shows — 1Password,
 * Bitwarden, Aegis, FreeOTP.
 */
export type CodeFromUriFunction = (
  uri: string,
  atUnixSeconds?: number,
) => string;

export const conformingAppCode: CodeFromUriFunction = (
  uri: string,
  atUnixSeconds?: number,
): string => {
  const params: OtpauthUriParams = parseOtpauthUri(uri);

  return authenticatorCode({
    secretBase32: params.secret,
    algorithm: params.algorithm,
    digits: params.digits,
    periodInSeconds: params.periodInSeconds,
    atUnixSeconds: atUnixSeconds,
  });
};

/*
 * What Google Authenticator shows: the secret from the URI, but SHA1 whatever
 * the URI says. This is the function that reproduces issue #3275 — hand it a
 * SHA256 URI and the code it returns is the one the user typed in and the
 * server rejected.
 */
export const googleAuthenticatorCode: CodeFromUriFunction = (
  uri: string,
  atUnixSeconds?: number,
): string => {
  const params: OtpauthUriParams = parseOtpauthUri(uri);

  return authenticatorCode({
    secretBase32: params.secret,
    algorithm: PHONE_APP_ALGORITHM,
    digits: params.digits,
    periodInSeconds: params.periodInSeconds,
    atUnixSeconds: atUnixSeconds,
  });
};

/*
 * The otpauth:// URI a server hands to a QR code, built by hand so a test can
 * produce the exact shape the OLD OneUptime code used to emit.
 */
export type BuildOtpauthUriFunction = (data: {
  secret: string;
  label: string;
  issuer?: string | undefined;
  algorithm?: string | undefined;
  digits?: number | undefined;
  periodInSeconds?: number | undefined;
}) => string;

export const buildOtpauthUri: BuildOtpauthUriFunction = (data: {
  secret: string;
  label: string;
  issuer?: string | undefined;
  algorithm?: string | undefined;
  digits?: number | undefined;
  periodInSeconds?: number | undefined;
}): string => {
  const issuer: string = data.issuer || "OneUptime";

  const query: string = [
    `issuer=${encodeURIComponent(issuer)}`,
    `secret=${data.secret}`,
    `algorithm=${data.algorithm || PHONE_APP_ALGORITHM}`,
    `digits=${data.digits === undefined ? DEFAULT_DIGITS : data.digits}`,
    `period=${data.periodInSeconds || DEFAULT_PERIOD_IN_SECONDS}`,
  ].join("&");

  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    data.label,
  )}?${query}`;
};
