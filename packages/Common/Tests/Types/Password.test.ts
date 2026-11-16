import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  PASSWORD_RULE_MESSAGES,
  getPasswordLength,
  getPasswordValidationError,
} from "../../Types/Password";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The one password rule, pinned (#9123).
 *
 * OneUptime had three: sign-up asked for 15 characters and no predictable
 * pattern, the reset forms and Admin Dashboard's Set Password took 6, Create
 * User took anything, and the reset routes checked nothing on the server, so a
 * reset quietly undid the rule sign-up set. Now one rule decides, and every
 * form and route asks it. Two kinds of silent breakage are worth guarding:
 *
 *   1. The rule drifting: each branch is a refusal a person reads, and the
 *      order is load-bearing (fifteen spaces are long enough and still not a
 *      password).
 *   2. A form drifting away from it: a form that types its own minLength
 *      accepts what the server refuses, and the person sees a request fail.
 *      The last block reads every form that sets a password to pin that.
 *
 * The predictable-pattern cases are in PasswordPatterns.test.ts.
 */

const PASSPHRASE: string = "violet river lantern";

describe("a missing or blank password", () => {
  test("undefined, null and the empty string are each 'required'", () => {
    expect(getPasswordValidationError(undefined)).toBe(
      PASSWORD_RULE_MESSAGES.required,
    );
    expect(getPasswordValidationError(null)).toBe(
      PASSWORD_RULE_MESSAGES.required,
    );
    expect(getPasswordValidationError("")).toBe(
      PASSWORD_RULE_MESSAGES.required,
    );
  });

  test("a value that is not text is refused, not hashed", () => {
    expect(getPasswordValidationError(12345)).toBe(
      PASSWORD_RULE_MESSAGES.notText,
    );
    expect(getPasswordValidationError({ value: PASSPHRASE })).toBe(
      PASSWORD_RULE_MESSAGES.notText,
    );
  });

  test("whitespace long enough for the length rule is still blank", () => {
    expect(
      getPasswordValidationError(" ".repeat(MINIMUM_PASSWORD_LENGTH)),
    ).toBe(PASSWORD_RULE_MESSAGES.blank);
    expect(
      getPasswordValidationError(" ".repeat(MAXIMUM_PASSWORD_LENGTH + 1)),
    ).toBe(PASSWORD_RULE_MESSAGES.blank);
  });
});

describe("the length bounds", () => {
  test("the minimum is fifteen characters, the maximum one hundred", () => {
    expect(MINIMUM_PASSWORD_LENGTH).toBe(15);
    expect(MAXIMUM_PASSWORD_LENGTH).toBe(100);
  });

  test("the six characters the reset forms used to take are refused", () => {
    expect(getPasswordValidationError("abc123")).toBe(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
    expect(getPasswordValidationError("violet")).toBe(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
  });

  test("one character below the minimum is refused, the minimum accepted", () => {
    const atMinimum: string = "violet river la";

    expect(getPasswordLength(atMinimum)).toBe(MINIMUM_PASSWORD_LENGTH);
    expect(getPasswordValidationError(atMinimum)).toBeNull();
    expect(getPasswordValidationError(atMinimum.slice(0, -1))).toBe(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
  });

  test("the maximum is accepted, one more refused", () => {
    const atMaximum: string = PASSPHRASE.repeat(5);

    expect(getPasswordLength(atMaximum)).toBe(MAXIMUM_PASSWORD_LENGTH);
    expect(getPasswordValidationError(atMaximum)).toBeNull();
    expect(getPasswordValidationError(atMaximum + "!")).toBe(
      PASSWORD_RULE_MESSAGES.tooLong,
    );
  });

  test("length is counted in characters, an emoji once", () => {
    expect(getPasswordLength("🌲 river lantern")).toBe(15);
    expect(getPasswordValidationError("🌲 river lantern")).toBeNull();
    expect(getPasswordValidationError("🌲river lantern")).toBe(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
  });

  test("length is measured on the raw value: nothing is trimmed", () => {
    const padded: string = `  ${"violet river"}  `;

    expect(getPasswordLength(padded)).toBe(16);
    expect(getPasswordValidationError(padded)).toBeNull();
  });
});

describe("the refusals say what to do", () => {
  test("each is a sentence, and the length ones name their limit", () => {
    for (const message of Object.values(PASSWORD_RULE_MESSAGES)) {
      expect(message).toMatch(/^[A-Z].*\.$/);
    }

    expect(PASSWORD_RULE_MESSAGES.tooShort).toContain(
      String(MINIMUM_PASSWORD_LENGTH),
    );
    expect(PASSWORD_RULE_MESSAGES.tooLong).toContain(
      String(MAXIMUM_PASSWORD_LENGTH),
    );
  });

  test("a predictable password is told how to do better", () => {
    expect(getPasswordValidationError("password123456789")).toBe(
      PASSWORD_RULE_MESSAGES.predictable,
    );
    expect(PASSWORD_RULE_MESSAGES.predictable).toContain("unrelated words");
  });

  test("a refusal never repeats the password", () => {
    const secret: string = "secret-value-1";

    expect(getPasswordValidationError(secret)).not.toContain(secret);
  });
});

describe("real passwords are accepted", () => {
  test.each([
    PASSPHRASE,
    "correct-horse-battery-staple",
    "  spaces inside are fine  ",
    "Ünïcödé-påsswörd-lang",
    "p@ssw0rd!-river-lantern",
  ])("%p", (value: string) => {
    expect(getPasswordValidationError(value)).toBeNull();
  });
});

/*
 * The rule only holds while every form asks it. A form that types its own
 * minLength again keeps working today and starts lying the moment the rule
 * changes. So the forms' code is read.
 */
const PACKAGES_DIRECTORY: string = path.join(__dirname, "..", "..", "..");

const readCode: (relativePath: string) => string = (
  relativePath: string,
): string => {
  const raw: string = fs.readFileSync(
    path.join(PACKAGES_DIRECTORY, relativePath),
    "utf8",
  );

  // Code only: comments talk about the rule in prose.
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
};

// Every form that sets a password.
const FORMS_THAT_SET_A_PASSWORD: Array<string> = [
  "App/FeatureSet/Accounts/src/Pages/Register.tsx",
  "App/FeatureSet/Accounts/src/Pages/ResetPassword.tsx",
  "App/FeatureSet/StatusPage/src/Pages/Accounts/ResetPassword.tsx",
  "App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Password.tsx",
  "App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx",
  "App/FeatureSet/AdminDashboard/src/Pages/Users/View/Authentication.tsx",
];

// Every form a person signs in with a password on.
const SIGN_IN_FORMS: Array<string> = [
  "App/FeatureSet/Accounts/src/Pages/Login.tsx",
  "App/FeatureSet/StatusPage/src/Pages/Accounts/Login.tsx",
];

describe("every form that sets a password asks the one rule", () => {
  test.each(FORMS_THAT_SET_A_PASSWORD)(
    "%s draws the shared password fields, checklist and all",
    (form: string) => {
      const code: string = readCode(form);

      expect(code).toMatch(
        /import\s*\{\s*getNewPasswordFields?\s*\}\s*from\s*["']Common\/UI\/Components\/PasswordRequirements\/NewPasswordFields["']/,
      );
      expect(code).toMatch(/getNewPasswordFields?</);
    },
  );

  test.each(FORMS_THAT_SET_A_PASSWORD)(
    "%s types no password length of its own",
    (form: string) => {
      const code: string = readCode(form);

      expect(code).not.toMatch(/minLength\s*:/);
      expect(code).not.toMatch(/MINIMUM_PASSWORD_LENGTH/);
    },
  );

  test("the shared fields validate with the rule and draw its checklist", () => {
    const code: string = readCode(
      "Common/UI/Components/PasswordRequirements/NewPasswordFields.tsx",
    );

    expect(code).toContain("getPasswordValidationError(");
    expect(code).toContain("<PasswordRequirements");
    expect(code).not.toMatch(/minLength\s*:/);
  });
});

describe("no sign-in form checks a password's length", () => {
  /*
   * A password set before the rule is still somebody's password: refusing it
   * at sign-in for its length would lock them out of an account whose
   * password they know (#9123).
   */
  test.each(SIGN_IN_FORMS)("%s", (form: string) => {
    const code: string = readCode(form);

    expect(code).not.toMatch(/minLength\s*:/);
    expect(code).not.toContain("getPasswordValidationError");
    expect(code).not.toContain("getNewPasswordField");
  });
});
