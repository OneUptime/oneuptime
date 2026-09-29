import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  getPasswordValidationError,
} from "../../Types/Password";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The password policy, pinned.
 *
 * Before this module existed the only thing enforcing a minimum password
 * length in OneUptime was `minLength: 6` typed inline into each browser form.
 * A password that arrives from anywhere other than that form — the master-admin
 * "set this user's password" endpoint being the obvious one — skipped the check
 * entirely. So the value of this module is not that it is clever; it is that
 * exactly one place decides what "acceptable" means, and both the form and the
 * server ask it.
 *
 * That makes two classes of silent breakage worth guarding:
 *
 *   1. The RULES drifting. Every branch here is a rejection an operator or a
 *      user will read, and the order the branches run in is load-bearing (a
 *      six-space password is long enough and still not a password). Loosening
 *      one by accident is invisible until a bad password is already hashed and
 *      stored.
 *   2. The rules drifting APART. If the Admin Dashboard form goes back to
 *      hardcoding a number, then retuning the policy here silently stops
 *      retuning the form, and the browser starts accepting what the server
 *      rejects — which surfaces to the operator as an opaque failed request.
 *      The last describe block below reads that form's source to pin it.
 *
 * The length cases are derived from the constants rather than written as 6 and
 * 100, so that raising the minimum moves these tests with the policy instead of
 * turning them into a wall of failures that has to be hand-edited (and might be
 * hand-edited wrongly).
 */

describe("getPasswordValidationError rejects a missing password", () => {
  /*
   * undefined, null and "" all mean "the operator submitted the form without
   * typing anything", and each arrives from a different layer: undefined from a
   * JSON body with no `password` key at all, null from a client that sent one
   * explicitly, "" from an empty text input. They have to be one message
   * because to the person reading it they are one mistake.
   */
  test("undefined, null and the empty string all report the password as required", () => {
    const expected: string = "Password is required.";

    expect(getPasswordValidationError(undefined)).toBe(expected);
    expect(getPasswordValidationError(null)).toBe(expected);
    expect(getPasswordValidationError("")).toBe(expected);
  });
});

describe("getPasswordValidationError rejects a blank password", () => {
  test("a single space and a tab/newline run are blank, not passwords", () => {
    expect(getPasswordValidationError(" ")).toBe("Password cannot be blank.");
    expect(getPasswordValidationError("\t\n")).toBe(
      "Password cannot be blank.",
    );
  });

  /*
   * The case the blank check exists for.
   *
   * Six spaces satisfies the length rule on its own — nothing below this line
   * would reject it — so without the blank branch a user could be given a
   * password of pure whitespace that they can neither see nor reliably retype.
   * If the blank check were ever reordered below the length check, or dropped
   * because "the length check covers it", this is the case that would start
   * passing silently, and the shorter whitespace strings above would not catch
   * it because they fail the length rule anyway.
   */
  test("a whitespace-only value long enough to pass the length rule is still rejected", () => {
    const sixSpaces: string = " ".repeat(MINIMUM_PASSWORD_LENGTH);

    expect(sixSpaces.length).toBeGreaterThanOrEqual(MINIMUM_PASSWORD_LENGTH);
    expect(getPasswordValidationError(sixSpaces)).toBe(
      "Password cannot be blank.",
    );
  });

  /*
   * Precedence in the other direction: blankness is reported before length even
   * when the value is also too long. "Password cannot be more than 100
   * characters." would be a baffling thing to show someone who pressed the
   * space bar.
   */
  test("blankness is reported ahead of the maximum-length rule", () => {
    const overlongWhitespace: string = " ".repeat(MAXIMUM_PASSWORD_LENGTH + 1);

    expect(getPasswordValidationError(overlongWhitespace)).toBe(
      "Password cannot be blank.",
    );
  });
});

describe("getPasswordValidationError enforces the length bounds", () => {
  /*
   * The four values either side of the two boundaries. Off-by-one here is the
   * classic way a policy quietly becomes a different policy: a `<=` where a `<`
   * belongs locks out everyone whose existing password is exactly at the
   * minimum, and nothing else in the system would notice.
   */
  test("one character below the minimum is rejected", () => {
    const tooShort: string = "a".repeat(MINIMUM_PASSWORD_LENGTH - 1);

    expect(getPasswordValidationError(tooShort)).toBe(
      `Password cannot be less than ${MINIMUM_PASSWORD_LENGTH} characters.`,
    );
  });

  test("exactly the minimum is accepted", () => {
    const atMinimum: string = "a".repeat(MINIMUM_PASSWORD_LENGTH);

    expect(getPasswordValidationError(atMinimum)).toBeNull();
  });

  test("exactly the maximum is accepted", () => {
    const atMaximum: string = "a".repeat(MAXIMUM_PASSWORD_LENGTH);

    expect(getPasswordValidationError(atMaximum)).toBeNull();
  });

  test("one character above the maximum is rejected", () => {
    const tooLong: string = "a".repeat(MAXIMUM_PASSWORD_LENGTH + 1);

    expect(getPasswordValidationError(tooLong)).toBe(
      `Password cannot be more than ${MAXIMUM_PASSWORD_LENGTH} characters.`,
    );
  });

  /*
   * Length is counted on the RAW value, never a trimmed one.
   *
   * This looks like a bug the first time you read it — "  ab  " is only two
   * real characters — and the temptation is to trim before measuring. Doing so
   * would be worse than lax: whatever the user typed is what gets hashed, so
   * trimming for the length check while hashing the untrimmed value measures
   * one string and stores another, and trimming for BOTH stores a secret the
   * user never typed and then fails to match it when they type it again at
   * login. Leading and trailing spaces in a password are the user's business.
   */
  test("length is measured before trimming, so padded short passwords are accepted", () => {
    const padded: string = "  abcd  ";

    expect(padded.length).toBe(8);
    expect(padded.trim().length).toBe(4);
    expect(padded.trim().length).toBeLessThan(MINIMUM_PASSWORD_LENGTH);

    expect(getPasswordValidationError(padded)).toBeNull();
  });

  /*
   * The mirror of the above: padding does not rescue a value that is genuinely
   * too short in raw characters either. Nothing is trimmed, in either
   * direction.
   */
  test("a padded value that is still short raw is rejected on length", () => {
    const shortEvenPadded: string = " ab ";

    expect(shortEvenPadded.length).toBeLessThan(MINIMUM_PASSWORD_LENGTH);
    expect(getPasswordValidationError(shortEvenPadded)).toBe(
      `Password cannot be less than ${MINIMUM_PASSWORD_LENGTH} characters.`,
    );
  });
});

describe("the rejection messages tell the operator what to do", () => {
  /*
   * These messages are surfaced verbatim — the browser form shows them and the
   * server wraps them in the exception it returns. A message that says only
   * "Password is invalid." forces the operator to guess, and guessing at
   * somebody else's password policy is exactly the loop this feature exists to
   * remove. So each length message must actually contain its own limit, and
   * must not quote the other one.
   */
  test("the too-short message names the minimum and not the maximum", () => {
    const message: string | null = getPasswordValidationError(
      "a".repeat(MINIMUM_PASSWORD_LENGTH - 1),
    );

    expect(message).toContain(String(MINIMUM_PASSWORD_LENGTH));
    expect(message).not.toContain(String(MAXIMUM_PASSWORD_LENGTH));
  });

  test("the too-long message names the maximum", () => {
    const message: string | null = getPasswordValidationError(
      "a".repeat(MAXIMUM_PASSWORD_LENGTH + 1),
    );

    expect(message).toContain(String(MAXIMUM_PASSWORD_LENGTH));
  });

  /*
   * Every rejection is a complete sentence a human can read, not a code. Cheap
   * to assert, and it catches the refactor that starts returning an enum or a
   * key while leaving the `string | null` signature in place.
   */
  test("every rejection is a non-empty sentence", () => {
    const rejected: Array<string | undefined | null> = [
      undefined,
      null,
      "",
      " ",
      "a".repeat(MINIMUM_PASSWORD_LENGTH - 1),
      "a".repeat(MAXIMUM_PASSWORD_LENGTH + 1),
    ];

    rejected.forEach((value: string | undefined | null): void => {
      const message: string | null = getPasswordValidationError(value);

      expect(typeof message).toBe("string");
      expect((message as string).length).toBeGreaterThan(0);
      expect(message as string).toMatch(/\.$/);
    });
  });
});

describe("getPasswordValidationError accepts real passwords", () => {
  test("an ordinary passphrase returns null", () => {
    expect(getPasswordValidationError("correct-horse-battery")).toBeNull();
  });

  /*
   * null specifically, not undefined or false — callers branch on it (`const
   * error = getPasswordValidationError(p); if (error) { throw ... }`), and the
   * server-side guard turns a non-null return straight into a BadDataException.
   */
  test("acceptance is signalled with null, not undefined", () => {
    const result: string | null = getPasswordValidationError(
      "a-perfectly-fine-password",
    );

    expect(result).toBeNull();
    expect(result).not.toBeUndefined();
  });

  test("passwords full of punctuation and symbols are not second-guessed", () => {
    const accepted: Array<string> = [
      "!@#$%^&*()",
      "p@ssw0rd!",
      "  spaces inside are fine  ",
      "Ünïcödé-påsswörd",
    ];

    accepted.forEach((value: string): void => {
      expect(getPasswordValidationError(value)).toBeNull();
    });
  });

  /*
   * Pinning, not endorsing: `.length` is UTF-16 code units, so a password of
   * three astral-plane emoji counts as six and clears the minimum. That is the
   * behaviour every other OneUptime password form has always had (they all used
   * the browser's own minLength, which counts the same way), so this module
   * matching it is the point. Recorded here so that if someone ever switches to
   * grapheme counting it is a deliberate, visible change rather than a silent
   * one.
   */
  test("length counts UTF-16 code units, matching every other password form", () => {
    const threeEmoji: string = "🔐🔐🔐";

    expect(threeEmoji.length).toBe(MINIMUM_PASSWORD_LENGTH);
    expect(getPasswordValidationError(threeEmoji)).toBeNull();
  });
});

describe("the exported constants are usable as a policy", () => {
  test("both bounds are plain numbers", () => {
    expect(typeof MINIMUM_PASSWORD_LENGTH).toBe("number");
    expect(typeof MAXIMUM_PASSWORD_LENGTH).toBe("number");

    expect(Number.isInteger(MINIMUM_PASSWORD_LENGTH)).toBe(true);
    expect(Number.isInteger(MAXIMUM_PASSWORD_LENGTH)).toBe(true);
  });

  /*
   * A minimum at or above the maximum would make every password unacceptable
   * while each individual branch still looked correct in review — the kind of
   * mistake that only shows up when nobody can set a password any more.
   */
  test("the minimum is positive and strictly below the maximum", () => {
    expect(MINIMUM_PASSWORD_LENGTH).toBeGreaterThan(0);
    expect(MINIMUM_PASSWORD_LENGTH).toBeLessThan(MAXIMUM_PASSWORD_LENGTH);
  });
});

/*
 * The whole reason this module sits in Common/Types rather than Common/Server:
 * the browser can import it, so the form and the endpoint cannot disagree.
 *
 * That only holds while the form actually imports it. A form that hardcodes
 * `minLength: 6` again keeps working today and starts lying the moment the
 * policy is retuned here — the browser would go on accepting six characters
 * that the server now rejects, and the operator would see a request fail with
 * no field marked. Nothing in a type-check or a render test catches that, so it
 * is asserted against the form's source text.
 */
describe("the Admin Dashboard set-password form shares this policy", () => {
  const SET_PASSWORD_FORM: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "AdminDashboard",
    "src",
    "Pages",
    "Users",
    "View",
    "Authentication.tsx",
  );

  /*
   * Comments in that file discuss the policy in prose (and the module under
   * test is itself heavily commented), so a bare `toContain` on the raw text
   * could be satisfied by a comment while the code hardcoded a number. Strip
   * comments first and assert only on code. Line comments are only stripped at
   * a line start or after whitespace, so a "//" inside a URL literal survives.
   */
  const readFormCode: () => string = (): string => {
    const raw: string = fs.readFileSync(SET_PASSWORD_FORM, "utf8");

    return raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
  };

  test("the form imports the minimum from this module", () => {
    const code: string = readFormCode();

    expect(code).toMatch(
      /import\s*\{[^}]*MINIMUM_PASSWORD_LENGTH[^}]*\}\s*from\s*["']Common\/Types\/Password["']/,
    );
  });

  test("both password fields validate against the imported constant", () => {
    const code: string = readFormCode();

    const usages: number = (
      code.match(/minLength\s*:\s*MINIMUM_PASSWORD_LENGTH/g) || []
    ).length;

    // The new password field and the confirmation field.
    expect(usages).toBe(2);
  });

  /*
   * The assertion that actually bites: no numeric literal may appear as a
   * minLength anywhere in the form, whatever number it is. Written against the
   * digit rather than against "6" so that re-hardcoding the current value under
   * a future, different policy still fails.
   */
  test("no minLength in the form is a hardcoded number", () => {
    const code: string = readFormCode();

    expect(code).not.toMatch(/minLength\s*:\s*\d/);
  });
});
