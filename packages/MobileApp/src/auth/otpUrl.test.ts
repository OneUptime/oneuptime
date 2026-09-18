import { secretFromOtpUrl } from "./otpUrl";
import { describe, expect, test } from "@jest/globals";

/*
 * Hoisted rather than written inline in the assertion. `wrap-regex` wants a
 * regexp literal in an expression position parenthesised, and prettier removes
 * those parentheses again -- the two rules cannot both be satisfied on one
 * line, so the literal is given a name instead.
 */
const WHITESPACE: RegExp = /\s/;

/*
 * The setup key printed on the enrolment screen.
 *
 * This is the one screen in the app where being wrong strands the user
 * completely: they are already past the password, the server has already
 * decided they must enrol, and the only two ways forward are the tappable
 * otpauth:// link (which needs an authenticator ON THIS HANDSET) and this
 * string typed by hand into a phone the user is holding in their other hand.
 * A wrong string here means enrolment cannot be finished, and enrolment not
 * being finished means sign-in cannot be finished either.
 *
 * The failure that matters most is not "" - the screen hides the block when
 * the secret is empty, and the link still works. It is a string that LOOKS
 * like a key and is not one: the user types it, the authenticator happily
 * accepts any base32 and starts generating codes, and every code is rejected
 * with no explanation either side can act on. So the negative cases below
 * (client_secret, app_secret, a trailing &issuer) are worth more than the
 * happy path.
 */

describe("secretFromOtpUrl reads the key out of a real enrolment URL", () => {
  test("returns the base32 secret and nothing that follows it", () => {
    /*
     * The exact shape OneUptime's server mints. The secret sits FIRST and is
     * followed by four more parameters; a matcher that ran to the end of the
     * string would hand the user
     * "JBSWY3DPEHPK3PXP&issuer=OneUptime&algorithm=SHA1..." to type in.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime&algorithm=SHA1&digits=6&period=30";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("finds the secret when it is the last parameter", () => {
    /*
     * Parameter order is the server's business, not this function's. Pinning
     * only the leading position would let a reordering on the server silently
     * blank the setup key on every phone.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?issuer=OneUptime&algorithm=SHA1&digits=6&period=30&secret=JBSWY3DPEHPK3PXP";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("finds the secret in the middle of the query string", () => {
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?issuer=OneUptime&secret=JBSWY3DPEHPK3PXP&digits=6";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("finds the secret when it is the only parameter", () => {
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DPEHPK3PXP";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("stops at a fragment as well as at a parameter", () => {
    /*
     * `#` ends the query just as `&` does. A key with "#anchor" welded onto
     * the end is the same silent failure as one with "&issuer=..." on it.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DPEHPK3PXP#setup";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });
});

describe("secretFromOtpUrl refuses a parameter that merely ends in secret", () => {
  test("client_secret is not the user's key", () => {
    /*
     * The whole reason this function does not simply search for "secret=".
     * Showing the user an OAuth client secret as their authenticator key is
     * strictly worse than showing nothing: nothing sends them to the link,
     * whereas a plausible-looking base32 string sends them to an authenticator
     * that will generate wrong codes forever without ever reporting an error.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?client_secret=NOTTHEUSERSKEY&issuer=OneUptime";

    expect(secretFromOtpUrl(otpUrl)).toBe("");
  });

  test("app_secret is not the user's key either", () => {
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?app_secret=NOTTHEUSERSKEY";

    expect(secretFromOtpUrl(otpUrl)).toBe("");
  });

  test("a lookalike parameter does not shadow the real one", () => {
    /*
     * Both present, the impostor first. Matching the earliest occurrence of
     * the literal "secret=" would return the wrong one.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?client_secret=NOTTHEUSERSKEY&secret=JBSWY3DPEHPK3PXP&issuer=OneUptime";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("text in the account label is not mistaken for a parameter", () => {
    /*
     * The label carries a user-controlled email address, so it is the one part
     * of the URL an attacker gets to influence. It must not be able to plant a
     * setup key.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:mysecret=NOTTHEUSERSKEY@example.com";

    expect(secretFromOtpUrl(otpUrl)).toBe("");
  });
});

describe("secretFromOtpUrl matches the parameter name case-insensitively", () => {
  test("an upper-case SECRET is still the secret", () => {
    /*
     * Query parameter names are case-sensitive by spec but not by practice;
     * an authenticator-compatible URL from a different mint is not worth
     * blanking the screen over.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?SECRET=JBSWY3DPEHPK3PXP&issuer=OneUptime";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("a capitalised Secret is still the secret", () => {
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?Secret=JBSWY3DPEHPK3PXP";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PXP");
  });

  test("case-insensitivity does not extend to the lookalike parameters", () => {
    /*
     * Loosening the name match must not loosen the delimiter match with it.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?CLIENT_SECRET=NOTTHEUSERSKEY";

    expect(secretFromOtpUrl(otpUrl)).toBe("");
  });
});

describe("secretFromOtpUrl answers empty for anything it cannot read", () => {
  test("empty input", () => {
    /*
     * pendingTwoFactor.enrolment.twoFactorOtpUrl is defaulted to "" by the
     * screen, so this is the value it passes whenever the server omitted the
     * URL. It must not throw on the way to rendering.
     */
    expect(secretFromOtpUrl("")).toBe("");
  });

  test("a URL that carries no secret at all", () => {
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?issuer=OneUptime&digits=6&period=30";

    expect(secretFromOtpUrl(otpUrl)).toBe("");
  });

  test("a secret parameter with an empty value", () => {
    /*
     * "" rather than the next parameter's value. Running past the `&` here is
     * how the user would be handed "issuer=OneUptime" as their key.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=&issuer=OneUptime";

    expect(secretFromOtpUrl(otpUrl)).toBe("");
  });

  test("a secret parameter with an empty value at the end of the URL", () => {
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=";

    expect(secretFromOtpUrl(otpUrl)).toBe("");
  });

  test("a bare string that is not a URL", () => {
    expect(secretFromOtpUrl("not a url at all")).toBe("");
  });
});

describe("secretFromOtpUrl hands the user a string they can type", () => {
  test("decodes a percent-encoded value", () => {
    /*
     * Base32 padding is "=", which a correct encoder writes as %3D. Printed
     * raw, the user types "%3D" into the authenticator and gets a key that is
     * not theirs.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DPEHPK3PX%3D&issuer=OneUptime";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DPEHPK3PX=");
  });

  test("a malformed escape does not throw and still returns the value", () => {
    /*
     * decodeURIComponent throws a URIError on "%ZZ". Unhandled, that error
     * escapes during render and takes the whole enrolment screen down - the
     * link included - which is a far worse outcome than showing a key with a
     * stray percent in it that the user can see and compare.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DP%ZZ&issuer=OneUptime";

    expect((): string => {
      return secretFromOtpUrl(otpUrl);
    }).not.toThrow();
    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DP%ZZ");
  });

  test("stops at whitespace inside the value", () => {
    /*
     * A wrapped or hand-edited URL. Trailing whitespace inside a printed setup
     * key is invisible on screen and is not something the user can debug.
     */
    const otpUrl: string =
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DP JUNK&issuer=OneUptime";

    expect(secretFromOtpUrl(otpUrl)).toBe("JBSWY3DP");
  });

  test("no realistic URL leaks a separator or whitespace into the printed key", () => {
    /*
     * The property behind every case above, asserted once over the whole
     * corpus: whatever comes back is a single query-parameter value. "&", "#"
     * and whitespace are exactly the characters that mean the matcher ran off
     * the end of the value, and they are also exactly the characters a user
     * cannot tell they mistyped.
     */
    const otpUrls: Array<string> = [
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=OneUptime&algorithm=SHA1&digits=6&period=30",
      "otpauth://totp/OneUptime:user%40example.com?issuer=OneUptime&secret=JBSWY3DPEHPK3PXP",
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DPEHPK3PXP#setup",
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DP JUNK&issuer=OneUptime",
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DPEHPK3PX%3D&issuer=OneUptime",
      "otpauth://totp/OneUptime:user%40example.com?secret=JBSWY3DP%ZZ&issuer=OneUptime",
    ];

    for (const otpUrl of otpUrls) {
      const secret: string = secretFromOtpUrl(otpUrl);

      expect(secret).not.toBe("");
      expect(secret).not.toContain("&");
      expect(secret).not.toContain("#");
      expect(WHITESPACE.test(secret)).toBe(false);
    }
  });
});
