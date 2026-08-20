import TotpAuth, {
  DefaultTotpAlgorithm,
  SupportedTotpAlgorithms,
  TotpDigits,
  TotpPeriodInSeconds,
  TotpValidationWindow,
} from "../../../Server/Utils/TotpAuth";
import {
  authenticatorCode,
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  googleAuthenticatorCode,
} from "../TestingUtils/AuthenticatorApp";
import Email from "../../../Types/Email";
import * as OTPAuth from "otpauth";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * TOTP enrolment and verification.
 *
 * The bug these tests exist for (issue #3275): OneUptime built its otpauth://
 * URIs with `algorithm=SHA256`, and Google Authenticator — like Microsoft
 * Authenticator, and like most of the phone-based apps people actually use —
 * parses that URI, ignores the `algorithm` parameter, and computes SHA1
 * regardless. Nothing errors on either side. The app shows six confident
 * digits, the server computes six entirely different digits, and enrolment
 * fails with "Invalid code" forever. Waiting for a fresh code cannot help,
 * because every code in the sequence is wrong.
 *
 * That failure is invisible to any test that generates the expected code with
 * the same library the server verifies with — both sides agree on SHA256 and
 * the test passes while every real user is locked out. So the codes here come
 * from TestingUtils/AuthenticatorApp, which derives them from RFC 4226 / RFC
 * 6238 with Node's crypto primitives and no help from `otpauth`, exactly the
 * way a phone does. If the server's algorithm and the app's algorithm ever
 * diverge again, these tests are what notices.
 *
 * The other half is not breaking anyone already enrolled. SHA256 secrets are
 * in the database and they DO work in the apps that honour the parameter
 * (1Password, Bitwarden, Aegis, FreeOTP). Verification therefore has to keep
 * accepting them, which is why SupportedTotpAlgorithms is a list rather than a
 * constant, and why it is pinned below.
 */

const EMAIL: Email = new Email("jane@example.com");

type QueryParamsOfFunction = (uri: string) => URLSearchParams;

const queryParamsOf: QueryParamsOfFunction = (uri: string): URLSearchParams => {
  return new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
};

/*
 * A time far enough from a step boundary that no test straddles one by
 * accident, and exactly divisible by the period so that "T minus 90 seconds"
 * lands on a whole step rather than somewhere inside one.
 */
const FIXED_NOW_SECONDS: number = 1893456000; // 2030-01-01T00:00:00Z

type FreezeClockAtFunction = (unixSeconds: number) => void;

const freezeClockAt: FreezeClockAtFunction = (unixSeconds: number): void => {
  jest.useFakeTimers();
  jest.setSystemTime(unixSeconds * 1000);
};

afterEach(() => {
  jest.useRealTimers();
});

describe("TotpAuth.generateSecret", () => {
  test("issues a 160-bit secret, the RFC 4226 recommended length", () => {
    const secret: string = TotpAuth.generateSecret();

    expect(base32Decode(secret)).toHaveLength(20);
  });

  test("issues valid base32 so every authenticator app can read the QR", () => {
    const secret: string = TotpAuth.generateSecret();

    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  test("never issues the same secret twice", () => {
    const secrets: Set<string> = new Set<string>();

    for (let i: number = 0; i < 200; i++) {
      secrets.add(TotpAuth.generateSecret());
    }

    expect(secrets.size).toBe(200);
  });
});

describe("the otpauth:// URI handed to the authenticator app", () => {
  test("advertises SHA1 — the algorithm Google Authenticator actually uses", () => {
    const uri: string = TotpAuth.generateUri({
      secret: TotpAuth.generateSecret(),
      userEmail: EMAIL,
    });

    expect(queryParamsOf(uri).get("algorithm")).toBe("SHA1");
  });

  /*
   * The literal regression. An `algorithm=SHA256` URI is not rejected by
   * Google Authenticator — it is silently misread — so this is the assertion
   * that has to fail loudly if anyone reinstates it.
   */
  test("never advertises SHA256, which phone apps silently misread (issue #3275)", () => {
    const uri: string = TotpAuth.generateUri({
      secret: TotpAuth.generateSecret(),
      userEmail: EMAIL,
    });

    expect(uri).not.toContain("SHA256");
    expect(uri).not.toContain("SHA512");
  });

  test("uses the 6 digit / 30 second shape every authenticator assumes", () => {
    const params: URLSearchParams = queryParamsOf(
      TotpAuth.generateUri({
        secret: TotpAuth.generateSecret(),
        userEmail: EMAIL,
      }),
    );

    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });

  test("carries the exact secret it was given", () => {
    const secret: string = TotpAuth.generateSecret();

    const uri: string = TotpAuth.generateUri({
      secret: secret,
      userEmail: EMAIL,
    });

    expect(queryParamsOf(uri).get("secret")).toBe(secret);
  });

  test("names OneUptime and the user so the entry is identifiable in the app", () => {
    const uri: string = TotpAuth.generateUri({
      secret: TotpAuth.generateSecret(),
      userEmail: EMAIL,
    });

    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(queryParamsOf(uri).get("issuer")).toBe("OneUptime");
    expect(decodeURIComponent(uri.split("?")[0]!)).toContain(
      "jane@example.com",
    );
  });

  /*
   * The round trip that the bug broke: parse the URI back exactly as an
   * authenticator app would, generate a code from what it says, and hand that
   * code to the server. Before the fix the parsed TOTP was SHA256 while the
   * server's phone-app users were producing SHA1, and this failed.
   */
  test("round trips — a code built from the URI's own parameters verifies", () => {
    const secret: string = TotpAuth.generateSecret();

    const parsed: OTPAuth.TOTP = OTPAuth.URI.parse(
      TotpAuth.generateUri({ secret: secret, userEmail: EMAIL }),
    ) as OTPAuth.TOTP;

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: parsed.generate(),
        email: EMAIL,
      }),
    ).toBe(true);
  });
});

describe("Google Authenticator compatibility (issue #3275)", () => {
  /*
   * The headline test. The code is computed the way the phone computes it —
   * HMAC-SHA1 over the decoded secret — with no reference to `otpauth` at all.
   */
  test("accepts the code a phone app computes from the QR it was shown", () => {
    const secret: string = TotpAuth.generateSecret();

    const uri: string = TotpAuth.generateUri({
      secret: secret,
      userEmail: EMAIL,
    });

    const scannedSecret: string = queryParamsOf(uri).get("secret")!;

    const codeOnThePhone: string = authenticatorCode({
      secretBase32: scannedSecret,
      algorithm: "SHA1",
    });

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: codeOnThePhone,
        email: EMAIL,
      }),
    ).toBe(true);
  });

  /*
   * Proof that the mismatch was real and not a rounding artefact: for the same
   * secret at the same instant the two algorithms produce different codes, so
   * a server on SHA256 and a phone on SHA1 can never agree.
   */
  test("SHA1 and SHA256 codes genuinely differ, so the mismatch was fatal", () => {
    const secret: string = TotpAuth.generateSecret();
    const at: number = FIXED_NOW_SECONDS;

    const sha1Code: string = authenticatorCode({
      secretBase32: secret,
      algorithm: "SHA1",
      atUnixSeconds: at,
    });

    const sha256Code: string = authenticatorCode({
      secretBase32: secret,
      algorithm: "SHA256",
      atUnixSeconds: at,
    });

    expect(sha1Code).not.toBe(sha256Code);
  });

  /*
   * The other half of the repair, and the reason nobody has to delete and
   * re-create a half-finished enrolment: a QR code issued by the OLD code
   * still says SHA256, but Google Authenticator was never reading that
   * parameter anyway. It emits a SHA1 code, and SHA1 is now the first thing
   * the verifier tries — so the enrolments that were stuck start working the
   * moment this ships, before the migration tidies the stored URL.
   */
  test("unsticks an enrolment whose stored QR code still says SHA256", () => {
    const secret: string = TotpAuth.generateSecret();

    const legacyUri: string = buildOtpauthUri({
      secret: secret,
      label: EMAIL.toString(),
      algorithm: "SHA256",
    });

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: googleAuthenticatorCode(legacyUri),
        email: EMAIL,
      }),
    ).toBe(true);
  });

  test("the verifier's default algorithm is the one it advertises", () => {
    const secret: string = TotpAuth.generateSecret();

    const advertised: string = queryParamsOf(
      TotpAuth.generateUri({ secret: secret, userEmail: EMAIL }),
    ).get("algorithm")!;

    expect(advertised).toBe(DefaultTotpAlgorithm);
    expect(TotpAuth.getTotp({ secret: secret, email: EMAIL }).algorithm).toBe(
      DefaultTotpAlgorithm,
    );
  });
});

/*
 * RFC 6238 Appendix B. The published vectors are 8 digits; a 6 digit code is
 * the same integer reduced modulo 10^6, which is the last 6 characters,
 * because 10^6 divides 10^8.
 */
describe("RFC 6238 published test vectors", () => {
  const SHA1_SEED: Buffer = Buffer.from("12345678901234567890", "ascii");

  const SHA256_SEED: Buffer = Buffer.from(
    "12345678901234567890123456789012",
    "ascii",
  );

  const VECTORS: Array<{
    unixSeconds: number;
    sha1: string;
    sha256: string;
  }> = [
    { unixSeconds: 59, sha1: "94287082", sha256: "46119246" },
    { unixSeconds: 1111111109, sha1: "07081804", sha256: "68084774" },
    { unixSeconds: 1111111111, sha1: "14050471", sha256: "67062674" },
    { unixSeconds: 1234567890, sha1: "89005924", sha256: "91819424" },
    { unixSeconds: 2000000000, sha1: "69279037", sha256: "90698825" },
  ];

  test("the base32 helpers in this file round trip", () => {
    expect(base32Decode(base32Encode(SHA1_SEED))).toEqual(SHA1_SEED);
    expect(base32Encode(SHA1_SEED)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  test.each(VECTORS)(
    "verifies the RFC's SHA1 code at t=$unixSeconds",
    (vector: { unixSeconds: number; sha1: string; sha256: string }) => {
      freezeClockAt(vector.unixSeconds);

      expect(
        TotpAuth.verifyToken({
          secret: base32Encode(SHA1_SEED),
          token: vector.sha1.slice(-TotpDigits),
          email: EMAIL,
        }),
      ).toBe(true);
    },
  );

  test.each(VECTORS)(
    "still verifies the RFC's legacy SHA256 code at t=$unixSeconds",
    (vector: { unixSeconds: number; sha1: string; sha256: string }) => {
      freezeClockAt(vector.unixSeconds);

      expect(
        TotpAuth.verifyToken({
          secret: base32Encode(SHA256_SEED),
          token: vector.sha256.slice(-TotpDigits),
          email: EMAIL,
        }),
      ).toBe(true);
    },
  );
});

describe("legacy SHA256 enrolments keep working", () => {
  test("SHA1 is tried first and SHA256 is still accepted", () => {
    expect(SupportedTotpAlgorithms[0]).toBe("SHA1");
    expect(SupportedTotpAlgorithms).toContain("SHA256");
  });

  /*
   * Someone who enrolled before the fix using 1Password or Bitwarden — apps
   * that DO honour `algorithm` — holds a SHA256 entry. Dropping SHA256 from
   * verification would lock them out of their own account at the next login,
   * which is a worse bug than the one being fixed.
   */
  test("a code from an app that honoured algorithm=SHA256 still logs the user in", () => {
    const secret: string = TotpAuth.generateSecret();

    const legacyCode: string = authenticatorCode({
      secretBase32: secret,
      algorithm: "SHA256",
    });

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: legacyCode,
        email: EMAIL,
      }),
    ).toBe(true);
  });

  test("both supported algorithms verify against the same secret", () => {
    const secret: string = TotpAuth.generateSecret();

    for (const algorithm of SupportedTotpAlgorithms) {
      expect(
        TotpAuth.verifyToken({
          secret: secret,
          token: authenticatorCode({
            secretBase32: secret,
            algorithm: algorithm,
          }),
          email: EMAIL,
        }),
      ).toBe(true);
    }
  });

  test("an unsupported algorithm's code is rejected", () => {
    const secret: string = TotpAuth.generateSecret();

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: authenticatorCode({
          secretBase32: secret,
          algorithm: "SHA512",
        }),
        email: EMAIL,
      }),
    ).toBe(false);
  });
});

describe("TotpAuth.normalizeToken", () => {
  /*
   * Google Authenticator renders a code as "123 456" and both mobile
   * clipboards keep the space. Rejecting the paste is a self-inflicted
   * "Invalid code" for a user holding exactly the right secret.
   */
  test.each([
    ["123 456", "123456"],
    ["123-456", "123456"],
    ["  123456  ", "123456"],
    ["123456\n", "123456"],
    ["1 2 3 4 5 6", "123456"],
    ["", ""],
    ["abcdef", ""],
  ])("normalises %p to %p", (input: string, expected: string) => {
    expect(TotpAuth.normalizeToken(input)).toBe(expected);
  });

  /*
   * The token comes straight off a JSON body, so it is only a string because
   * the client chose to send one. Anything else has to verify as false, not
   * throw out of `.replace` and surface as a 500.
   */
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 123456],
    ["an object", { code: "123456" }],
    ["an array", ["123456"]],
    ["a boolean", true],
  ])(
    "returns nothing for %s rather than throwing",
    (_name: string, token: unknown) => {
      expect(TotpAuth.normalizeToken(token as string)).toBe("");
    },
  );
});

describe("TotpAuth.verifyToken accepts the code the user actually holds", () => {
  test("accepts a correctly typed code", () => {
    const secret: string = TotpAuth.generateSecret();

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: authenticatorCode({ secretBase32: secret }),
        email: EMAIL,
      }),
    ).toBe(true);
  });

  /*
   * The separators the phone and the clipboard insert, applied to a code that
   * is genuinely correct at this instant rather than to a hardcoded literal.
   */
  test.each([
    ["a space, as Google Authenticator displays it", "### ###"],
    ["surrounding whitespace from a trimmed paste", "  ######  "],
    ["a hyphen", "###-###"],
    ["a space between every digit", "# # # # # #"],
  ])("accepts a correct code pasted with %s", (_name: string, mask: string) => {
    const secret: string = TotpAuth.generateSecret();
    const code: string = authenticatorCode({ secretBase32: secret });

    let digitIndex: number = 0;

    const pasted: string = mask.replace(/#/g, (): string => {
      return code[digitIndex++]!;
    });

    expect(digitIndex).toBe(TotpDigits);

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: pasted,
        email: EMAIL,
      }),
    ).toBe(true);
  });

  /*
   * The email is the label on the QR code, not key material. A user who
   * changes their address after enrolling must not be locked out — and
   * verifyToken reads the address back from the User row, which is exactly
   * where that change lands.
   */
  test("still verifies after the user changes their email address", () => {
    const secret: string = TotpAuth.generateSecret();

    const codeFromTheirApp: string = authenticatorCode({
      secretBase32: secret,
    });

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: codeFromTheirApp,
        email: new Email("jane.renamed@example.com"),
      }),
    ).toBe(true);
  });
});

describe("TotpAuth.verifyToken tolerates clock drift", () => {
  test(`accepts a code ${TotpValidationWindow} steps behind the server clock`, () => {
    const secret: string = TotpAuth.generateSecret();

    const staleCode: string = authenticatorCode({
      secretBase32: secret,
      atUnixSeconds:
        FIXED_NOW_SECONDS - TotpValidationWindow * TotpPeriodInSeconds,
    });

    freezeClockAt(FIXED_NOW_SECONDS);

    expect(
      TotpAuth.verifyToken({ secret: secret, token: staleCode, email: EMAIL }),
    ).toBe(true);
  });

  test(`accepts a code ${TotpValidationWindow} steps ahead of the server clock`, () => {
    const secret: string = TotpAuth.generateSecret();

    const futureCode: string = authenticatorCode({
      secretBase32: secret,
      atUnixSeconds:
        FIXED_NOW_SECONDS + TotpValidationWindow * TotpPeriodInSeconds,
    });

    freezeClockAt(FIXED_NOW_SECONDS);

    expect(
      TotpAuth.verifyToken({ secret: secret, token: futureCode, email: EMAIL }),
    ).toBe(true);
  });

  test("rejects a code one step outside the window in either direction", () => {
    const secret: string = TotpAuth.generateSecret();

    const tooOld: string = authenticatorCode({
      secretBase32: secret,
      atUnixSeconds:
        FIXED_NOW_SECONDS - (TotpValidationWindow + 1) * TotpPeriodInSeconds,
    });

    const tooNew: string = authenticatorCode({
      secretBase32: secret,
      atUnixSeconds:
        FIXED_NOW_SECONDS + (TotpValidationWindow + 1) * TotpPeriodInSeconds,
    });

    freezeClockAt(FIXED_NOW_SECONDS);

    expect(
      TotpAuth.verifyToken({ secret: secret, token: tooOld, email: EMAIL }),
    ).toBe(false);

    expect(
      TotpAuth.verifyToken({ secret: secret, token: tooNew, email: EMAIL }),
    ).toBe(false);
  });

  test("the window is not so wide that a whole day of codes is valid", () => {
    const secret: string = TotpAuth.generateSecret();

    const yesterdaysCode: string = authenticatorCode({
      secretBase32: secret,
      atUnixSeconds: FIXED_NOW_SECONDS - 86400,
    });

    freezeClockAt(FIXED_NOW_SECONDS);

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: yesterdaysCode,
        email: EMAIL,
      }),
    ).toBe(false);
  });
});

describe("TotpAuth.verifyToken rejects what it must", () => {
  test("rejects a code generated from a different secret", () => {
    const secret: string = TotpAuth.generateSecret();
    const someoneElsesSecret: string = TotpAuth.generateSecret();

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: authenticatorCode({ secretBase32: someoneElsesSecret }),
        email: EMAIL,
      }),
    ).toBe(false);
  });

  test.each([
    ["nothing at all", ""],
    ["one digit short", "12345"],
    ["one digit too many", "1234567"],
    ["letters", "abcdef"],
    ["a truncated paste", "12 34"],
    ["the six digits of a longer number", "9876543210"],
  ])("rejects %s", (_name: string, token: string) => {
    const secret: string = TotpAuth.generateSecret();

    expect(
      TotpAuth.verifyToken({ secret: secret, token: token, email: EMAIL }),
    ).toBe(false);
  });

  /*
   * A six-digit code of the right shape but the wrong value. Derived from the
   * correct code so it cannot accidentally BE the correct code.
   */
  test("rejects a well-formed code that is off by one digit", () => {
    const secret: string = TotpAuth.generateSecret();
    const correct: string = authenticatorCode({ secretBase32: secret });

    const wrong: string =
      ((parseInt(correct[0]!, 10) + 1) % 10).toString() + correct.slice(1);

    expect(wrong).not.toBe(correct);

    expect(
      TotpAuth.verifyToken({ secret: secret, token: wrong, email: EMAIL }),
    ).toBe(false);
  });

  test("rejects rather than throws when the stored secret is missing", () => {
    expect(
      TotpAuth.verifyToken({ secret: "", token: "123456", email: EMAIL }),
    ).toBe(false);
  });

  test("rejects rather than throws when the stored secret is not base32", () => {
    expect(() => {
      return TotpAuth.verifyToken({
        secret: "this is not base32!!!",
        token: "123456",
        email: EMAIL,
      });
    }).not.toThrow();

    expect(
      TotpAuth.verifyToken({
        secret: "this is not base32!!!",
        token: "123456",
        email: EMAIL,
      }),
    ).toBe(false);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 123456],
    ["an object", { code: "123456" }],
  ])("rejects %s rather than throwing", (_name: string, token: unknown) => {
    const secret: string = TotpAuth.generateSecret();

    expect(() => {
      return TotpAuth.verifyToken({
        secret: secret,
        token: token as string,
        email: EMAIL,
      });
    }).not.toThrow();

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: token as string,
        email: EMAIL,
      }),
    ).toBe(false);
  });

  /*
   * A brute-force bound. Two algorithms across 2*window+1 steps is the total
   * number of six-digit strings this function will accept at any instant; it
   * has to stay a vanishing fraction of the 10^6 code space.
   */
  test("accepts only a tiny fraction of the six-digit code space", () => {
    const acceptedCodes: number =
      SupportedTotpAlgorithms.length * (2 * TotpValidationWindow + 1);

    expect(acceptedCodes).toBeLessThanOrEqual(20);
    expect(acceptedCodes / 10 ** TotpDigits).toBeLessThan(0.00002);
  });
});

describe("TotpAuth.getTotp", () => {
  test("defaults to the Google Authenticator compatible parameters", () => {
    const totp: OTPAuth.TOTP = TotpAuth.getTotp({
      secret: TotpAuth.generateSecret(),
      email: EMAIL,
    });

    expect(totp.algorithm).toBe("SHA1");
    expect(totp.digits).toBe(TotpDigits);
    expect(totp.period).toBe(TotpPeriodInSeconds);
    expect(totp.issuer).toBe("OneUptime");
  });

  test("honours an explicit algorithm so legacy secrets can be checked", () => {
    const totp: OTPAuth.TOTP = TotpAuth.getTotp({
      secret: TotpAuth.generateSecret(),
      email: EMAIL,
      algorithm: "SHA256",
    });

    expect(totp.algorithm).toBe("SHA256");
  });

  test("labels the entry with the user's email", () => {
    expect(TotpAuth.getLabel({ email: EMAIL })).toBe("jane@example.com");
    expect(
      TotpAuth.getTotp({ secret: TotpAuth.generateSecret(), email: EMAIL })
        .label,
    ).toBe("jane@example.com");
  });
});
