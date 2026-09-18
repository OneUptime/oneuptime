import {
  JwtPayload,
  decodeBase64Url,
  decodeJwtPayload,
  isJwtExpired,
} from "./jwt";
import { describe, expect, test } from "@jest/globals";

/*
 * This module is the only thing standing between a lapsed 30-day SSO token and
 * an opaque 406 from the server. It hand-rolls base64url AND UTF-8 because
 * neither `atob` nor `TextDecoder` is guaranteed on every React Native runtime
 * the app ships on, so there is no platform implementation underneath to catch
 * a mistake - every byte of the decode is this file's responsibility.
 *
 * The failure that matters is not "throws". It is "quietly returns the wrong
 * thing": a mangled `exp` reads as a token that never expires, and the app then
 * keeps a dead token forever and re-sends it on every request instead of
 * sending the user back through the IdP.
 */

/*
 * Encoders local to the test, deliberately written as the INVERSE of the code
 * under test rather than by calling it. Reusing the module's own tables would
 * make a wrong table agree with itself.
 *
 * Node's Buffer is not typed in this project (tsconfig pins `types` to
 * nativewind and jest) and is not present on a device either, so the encoders
 * are plain JS.
 */
const BASE64_CHARS: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(value: string): Array<number> {
  const bytes: Array<number> = [];

  // Iterating a string with for...of yields whole code points, not UTF-16 units.
  for (const char of value) {
    const codePoint: number = char.codePointAt(0)!;

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return bytes;
}

/** Standard base64, `=` padding included. */
function base64Encode(bytes: Array<number>): string {
  let encoded: string = "";

  for (let index: number = 0; index < bytes.length; index += 3) {
    const byte1: number = bytes[index]!;
    const byte2: number | undefined = bytes[index + 1];
    const byte3: number | undefined = bytes[index + 2];

    encoded += BASE64_CHARS[byte1 >> 2];
    encoded += BASE64_CHARS[((byte1 & 0x03) << 4) | ((byte2 ?? 0) >> 4)];
    encoded +=
      byte2 === undefined
        ? "="
        : BASE64_CHARS[((byte2 & 0x0f) << 2) | ((byte3 ?? 0) >> 6)];
    encoded += byte3 === undefined ? "=" : BASE64_CHARS[byte3 & 0x3f];
  }

  return encoded;
}

/** JWT flavour: url-safe alphabet, padding stripped. */
function base64UrlEncode(value: string): string {
  return base64Encode(utf8Bytes(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");
}

/** Standard base64 of a string, padding kept. */
function base64EncodePadded(value: string): string {
  return base64Encode(utf8Bytes(value));
}

const JWT_HEADER: string = base64UrlEncode('{"alg":"HS256","typ":"JWT"}');

/*
 * A signature the module must never look at - it does not verify anything, the
 * server does. Any opaque segment will do.
 */
const JWT_SIGNATURE: string = "c2lnbmF0dXJlLWdvZXMtaGVyZQ";

function makeJwtFromPayloadJson(payloadJson: string): string {
  return `${JWT_HEADER}.${base64UrlEncode(payloadJson)}.${JWT_SIGNATURE}`;
}

function makeJwt(payload: Record<string, unknown>): string {
  return makeJwtFromPayloadJson(JSON.stringify(payload));
}

/*
 * A fixed instant so nothing here depends on the wall clock. Every `exp` below
 * is derived from it, so the leeway assertions mean the same thing on a CI box
 * that is a minute out of sync as on a laptop.
 */
const NOW_MS: number = 1700000000000;
const NOW_SECONDS: number = NOW_MS / 1000;

describe("the test's own encoders match the published base64 vectors", () => {
  /*
   * Everything below trusts these helpers to produce correct input. If the
   * encoders were wrong, a broken decoder could still round-trip and every
   * other test in this file would pass for the wrong reason. These are the
   * RFC 4648 examples, so they pin the helpers to something external.
   */
  test("encodes the three padding cases", () => {
    expect(base64EncodePadded("Man")).toBe("TWFu");
    expect(base64EncodePadded("Ma")).toBe("TWE=");
    expect(base64EncodePadded("M")).toBe("TQ==");
  });

  test("strips padding and swaps the alphabet for the url-safe form", () => {
    expect(base64UrlEncode("Ma")).toBe("TWE");
    expect(base64UrlEncode("ab>")).toBe("YWI-");
    expect(base64UrlEncode("ab?")).toBe("YWI_");
  });
});

describe("decodeBase64Url", () => {
  test("decodes plain ASCII", () => {
    expect(decodeBase64Url(base64UrlEncode("hello world"))).toBe("hello world");
  });

  test("accepts the url-safe alphabet, where - and _ stand in for + and /", () => {
    /*
     * The whole reason the module normalises before decoding. These two
     * literals are standard base64 "YWI+" and "YWI/" rewritten JWT-style; a
     * decoder that never did the substitution would hit a character outside
     * the alphabet and return null for a perfectly good token.
     */
    expect(decodeBase64Url("YWI-")).toBe("ab>");
    expect(decodeBase64Url("YWI_")).toBe("ab?");
  });

  test("decodes with = padding present", () => {
    /*
     * JWTs arrive unpadded, but nothing stops an IdP from padding, and the
     * module is also used on segments copied out of other tooling.
     */
    expect(decodeBase64Url("TWFu")).toBe("Man");
    expect(decodeBase64Url("TWE=")).toBe("Ma");
    expect(decodeBase64Url("TQ==")).toBe("M");
  });

  test("decodes with the padding stripped, as JWTs actually ship it", () => {
    expect(decodeBase64Url("TWE")).toBe("Ma");
    expect(decodeBase64Url("TQ")).toBe("M");
  });

  test("decodes two-byte UTF-8, e.g. an accented name in a claim", () => {
    /*
     * String.fromCharCode over raw bytes - the obvious shortcut - turns "José"
     * into "JosÃ©". Display names and emails in an SSO assertion are full of
     * these.
     */
    const decoded: string | null = decodeBase64Url(
      base64UrlEncode("José Müller"),
    );

    expect(decoded).toBe("José Müller");
  });

  test("decodes three-byte UTF-8, e.g. CJK characters", () => {
    const decoded: string | null = decodeBase64Url(base64UrlEncode("日本語"));

    expect(decoded).toBe("日本語");
    expect(decoded).toHaveLength(3);
  });

  test("decodes four-byte UTF-8 into a correct surrogate pair", () => {
    /*
     * The only branch that has to synthesise TWO UTF-16 units from one code
     * point. Getting the 0x10000 offset or the 10-bit split wrong yields a
     * lone surrogate: a string that still compares unequal, still has length
     * 2, and only looks wrong once something tries to render it.
     */
    const decoded: string | null = decodeBase64Url(base64UrlEncode("😀"));

    expect(decoded).toBe("😀");
    expect(decoded).toHaveLength(2);
    expect(decoded!.charCodeAt(0)).toBe(0xd83d);
    expect(decoded!.charCodeAt(1)).toBe(0xde00);
    expect(decoded!.codePointAt(0)).toBe(0x1f600);
  });

  test("decodes a mixture of all four widths in one string", () => {
    const original: string = "a é 日 😀 z";

    expect(decodeBase64Url(base64UrlEncode(original))).toBe(original);
  });

  test("decodes the empty string to the empty string, not null", () => {
    /*
     * "" is a legitimate encoding of zero bytes. Returning null here would
     * make an empty-but-valid segment indistinguishable from a corrupt one.
     */
    expect(decodeBase64Url("")).toBe("");
  });

  test("returns null - never throws - on a character outside the alphabet", () => {
    /*
     * The contract every caller relies on: an unreadable token is a value to
     * be handled, not an exception to be caught. A throw here surfaces as a
     * redbox on a screen that was only trying to decide whether to refresh.
     */
    expect((): string | null => {
      return decodeBase64Url("YWI!");
    }).not.toThrow();

    expect(decodeBase64Url("YWI!")).toBeNull();
    expect(decodeBase64Url("hello world")).toBeNull();
    expect(decodeBase64Url("YW.I")).toBeNull();
    expect(decodeBase64Url("YW\nI")).toBeNull();
  });

  test("returns null for a truncated multi-byte sequence", () => {
    /*
     * "ww==" is the single byte 0xC3 - the lead byte of a two-byte sequence
     * with its continuation byte missing. Valid base64, invalid UTF-8, and
     * exactly what a token clipped by a bad deep-link parse looks like.
     */
    expect(decodeBase64Url("ww==")).toBeNull();
  });

  test("stops at padding rather than reading past it", () => {
    expect(decodeBase64Url("TWFu")).toBe("Man");
    expect(decodeBase64Url("TWFu=")).toBe("Man");
  });
});

describe("decodeJwtPayload", () => {
  test("reads the claims out of a real three-segment token", () => {
    const token: string = makeJwt({
      userId: "e6f1b8a2-0000-4000-8000-000000000001",
      email: "responder@example.com",
      exp: NOW_SECONDS + 3600,
    });

    const payload: JwtPayload | null = decodeJwtPayload(token);

    expect(payload).not.toBeNull();
    expect(payload!["userId"]).toBe("e6f1b8a2-0000-4000-8000-000000000001");
    expect(payload!["email"]).toBe("responder@example.com");
    expect(payload!.exp).toBe(NOW_SECONDS + 3600);
  });

  test("reads the middle segment, not the header and not the signature", () => {
    /*
     * Off-by-one on the segment index is a silent bug: the header is also
     * valid base64url JSON, so it parses cleanly and simply has no exp - which
     * would make every token look permanently valid.
     */
    const payload: JwtPayload | null = decodeJwtPayload(
      makeJwt({ claim: "payload" }),
    );

    expect(payload!["claim"]).toBe("payload");
    expect(payload!["alg"]).toBeUndefined();
    expect(payload!["typ"]).toBeUndefined();
  });

  test("keeps non-ASCII claims intact", () => {
    const payload: JwtPayload | null = decodeJwtPayload(
      makeJwt({ name: "Zoë 日本 😀" }),
    );

    expect(payload!["name"]).toBe("Zoë 日本 😀");
  });

  test.each([
    ["one segment", JWT_HEADER],
    ["two segments", `${JWT_HEADER}.${base64UrlEncode('{"exp":1}')}`],
    [
      "four segments",
      `${JWT_HEADER}.${base64UrlEncode('{"exp":1}')}.${JWT_SIGNATURE}.extra`,
    ],
  ])(
    "returns null for a token with %s",
    (_label: string, token: string): void => {
      /*
       * A two-segment string is what an unsigned/half-copied token looks like,
       * and a four-segment one is a JWE. Neither is something this reader can
       * make sense of, and guessing at the payload position would be worse
       * than declining.
       */
      expect(decodeJwtPayload(token)).toBeNull();
    },
  );

  test("returns null when the payload segment is not valid base64url", () => {
    expect(decodeJwtPayload(`${JWT_HEADER}.!!!.${JWT_SIGNATURE}`)).toBeNull();
  });

  test("returns null when the payload is not valid JSON", () => {
    expect(
      decodeJwtPayload(makeJwtFromPayloadJson("{not json at all")),
    ).toBeNull();
    expect(decodeJwtPayload(makeJwtFromPayloadJson(""))).toBeNull();
  });

  test.each([
    ["an array", "[1,2,3]"],
    ["a bare number", "42"],
    ["a bare string", '"a-string"'],
    ["a bare boolean", "true"],
    ["null", "null"],
  ])(
    "returns null when the payload is valid JSON but %s",
    (_label: string, payloadJson: string): void => {
      /*
       * Only objects are claim sets. If an array leaked through, `payload.exp`
       * would be undefined and isJwtExpired would report a nonsense token as
       * perfectly valid - the exact failure this module exists to prevent.
       */
      expect(decodeJwtPayload(makeJwtFromPayloadJson(payloadJson))).toBeNull();
    },
  );

  test("returns null for the empty string", () => {
    expect(decodeJwtPayload("")).toBeNull();
  });

  test("returns null - never throws - for arbitrary junk", () => {
    expect((): JwtPayload | null => {
      return decodeJwtPayload("not-a-jwt");
    }).not.toThrow();

    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("...")).toBeNull();
    expect(decodeJwtPayload("   ")).toBeNull();
  });

  test("accepts an empty claim set, which is still an object", () => {
    expect(decodeJwtPayload(makeJwt({}))).toEqual({});
  });
});

describe("isJwtExpired", () => {
  test("a token that expires well in the future is not expired", () => {
    const token: string = makeJwt({ exp: NOW_SECONDS + 30 * 24 * 60 * 60 });

    expect(isJwtExpired(token, NOW_MS)).toBe(false);
  });

  test("a token whose exp has passed is expired", () => {
    const token: string = makeJwt({ exp: NOW_SECONDS - 1000 });

    expect(isJwtExpired(token, NOW_MS)).toBe(true);
  });

  test("exp of 0 is expired, not treated as missing", () => {
    /*
     * 0 is falsy. A truthiness check instead of a typeof check would read this
     * as "no exp claim" and call a token from 1970 valid.
     */
    expect(isJwtExpired(makeJwt({ exp: 0 }), NOW_MS)).toBe(true);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["the empty string", ""],
  ])(
    "treats %s as expired, so an absent token never gets sent",
    (_label: string, token: string | null | undefined): void => {
      expect(isJwtExpired(token, NOW_MS)).toBe(true);
    },
  );

  test.each([
    ["a token with no dots", "not-a-jwt"],
    ["a token with too few segments", "aaa.bbb"],
    ["a token with an undecodable payload", "aaa.!!!.ccc"],
    ["a token whose payload is not JSON", `${JWT_HEADER}.aGVsbG8.sig`],
    ["a token whose payload is an array", makeJwtFromPayloadJson("[1,2,3]")],
  ])(
    "treats %s as expired rather than usable",
    (_label: string, token: string): void => {
      /*
       * Fail closed. An unreadable token is one the server will reject too, so
       * the app should re-authenticate instead of sending it and surfacing a
       * 406 the user cannot act on.
       */
      expect(isJwtExpired(token, NOW_MS)).toBe(true);
    },
  );

  test("a well-formed token with no exp claim is NOT expired", () => {
    /*
     * Deliberate, and the opposite of the malformed cases above. Some IdPs
     * issue non-expiring tokens; the server accepts them, so the client must
     * not lock the user out of one it could have used.
     */
    const token: string = makeJwt({ userId: "user-1" });

    expect(isJwtExpired(token, NOW_MS)).toBe(false);
  });

  test("a token expiring in 10 seconds already reads as expired", () => {
    /*
     * The 30-second leeway. A request that leaves the phone now with 10
     * seconds of validity left can easily arrive after exp on a slow mobile
     * link and come back 401 - so the app refreshes first instead.
     */
    expect(isJwtExpired(makeJwt({ exp: NOW_SECONDS + 10 }), NOW_MS)).toBe(true);
  });

  test("a token expiring in 120 seconds does not", () => {
    /*
     * The other side of the same window: the leeway must not be so wide that
     * it throws away tokens with real life left in them and sends the user
     * back through the IdP for nothing.
     */
    expect(isJwtExpired(makeJwt({ exp: NOW_SECONDS + 120 }), NOW_MS)).toBe(
      false,
    );
  });

  test("the boundary sits exactly at the 30-second leeway", () => {
    // 30s out is still expired (the comparison is <=); 31s out is not.
    expect(isJwtExpired(makeJwt({ exp: NOW_SECONDS + 30 }), NOW_MS)).toBe(true);
    expect(isJwtExpired(makeJwt({ exp: NOW_SECONDS + 31 }), NOW_MS)).toBe(
      false,
    );
  });

  test("a non-numeric exp is treated as no exp at all", () => {
    /*
     * Documenting the fail-open half of the design: exp must be a NumericDate,
     * and anything else is ignored rather than guessed at. The server remains
     * the authority - the worst case is one rejected request, versus locking
     * the user out over a claim the client mis-parsed.
     */
    expect(isJwtExpired(makeJwt({ exp: "1700000000" }), NOW_MS)).toBe(false);
    expect(isJwtExpired(makeJwt({ exp: null }), NOW_MS)).toBe(false);
  });

  test("falls back to the real clock when nowMs is not supplied", () => {
    /*
     * The default argument is what production actually uses; every other test
     * here passes nowMs explicitly, so without this the default path is never
     * executed.
     */
    const longExpired: string = makeJwt({
      exp: Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60,
    });
    const longLived: string = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    });

    expect(isJwtExpired(longExpired)).toBe(true);
    expect(isJwtExpired(longLived)).toBe(false);
  });
});
