import {
  getPasswordValidationError,
  getSignupPasswordValidationError,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_SIGNUP_PASSWORD_LENGTH,
} from "../../Types/Password";
import { describe, expect, test } from "@jest/globals";

describe("signup password policy", () => {
  test.each([undefined, null, ""])(
    "requires a password (%p)",
    (value: unknown) => {
      expect(getSignupPasswordValidationError(value)).toBe(
        "Password is required.",
      );
    },
  );

  test.each([
    false,
    true,
    123456789012345,
    [],
    ["a long enough password"],
    {},
    { value: "a long enough password" },
  ])("rejects non-string input (%p)", (value: unknown) => {
    expect(getSignupPasswordValidationError(value)).toBe(
      "Password must be a string.",
    );
  });

  test.each([" ", "\t\n", " ".repeat(15), " ".repeat(101)])(
    "rejects whitespace-only input (%p)",
    (value: string) => {
      expect(getSignupPasswordValidationError(value)).toBe(
        "Password cannot be blank.",
      );
    },
  );

  test.each(["a", "sample", "password", "Password123!", "birch lake sun"])(
    "rejects short passwords (%p)",
    (value: string) => {
      expect(getSignupPasswordValidationError(value)).toBe(
        `Password must be at least ${MINIMUM_SIGNUP_PASSWORD_LENGTH} characters.`,
      );
    },
  );

  test("accepts exactly 15 characters without requiring mixed character types", () => {
    const value: string = "birch lake suns";
    expect(Array.from(value)).toHaveLength(MINIMUM_SIGNUP_PASSWORD_LENGTH);
    expect(getSignupPasswordValidationError(value)).toBeNull();
  });

  test("accepts exactly the maximum and rejects the next character", () => {
    const value: string = "violet river lantern".repeat(5);
    expect(value).toHaveLength(MAXIMUM_PASSWORD_LENGTH);
    expect(getSignupPasswordValidationError(value)).toBeNull();
    expect(getSignupPasswordValidationError(value + "!")).toBe(
      `Password cannot be more than ${MAXIMUM_PASSWORD_LENGTH} characters.`,
    );
  });

  test.each([
    "aaaaaaaaaaaaaaa",
    "111111111111111",
    "!!!!!!!!!!!!!!!!",
    "!\n".repeat(8),
    "$\r\n".repeat(6),
    "abcabcabcabcabc",
    "PasswordPassword",
    "password password",
    "PASSWORD-PASSWORD!",
    "password123456789",
    "Password123456789!",
    "OneUptime123456789!",
    "OneUptimeOneUptime",
    "LetMeIn123456789!",
    "Welcome123456789!",
    "Admin12345678901!",
    "ChangeMe12345678!",
    "123456789012345",
    "987654321098765",
    "abcdefghijklmnop",
    "ponmlkjihgfedcba",
    "qwertyuiopasdfghjkl",
    "qwertyuiopqwertyuiop",
    "lkjhgfdsapoiuytrewq",
    "    password    ",
    "🔒".repeat(15),
  ])("rejects obvious predictable patterns (%p)", (value: string) => {
    expect(getSignupPasswordValidationError(value)).toBe(
      "Choose a less predictable password. Try a few unrelated words.",
    );
  });

  test.each([
    "violet river lantern",
    "unrelatedwordstogether",
    "N7#pR2!vK9@wQ4$x",
    " space matters here ",
    "雨の中で踊る小さな青い鳥たちの歌",
    "café rivière forêt tranquille",
    "🎈 violet river 🌿 lantern",
    "🌍🍋🎈🐢🌊🍂🪁🦉🚲🎸🍄🧭🐬🌻a",
    "a password manager picked this phrase",
  ])("accepts long passwords and passphrases (%p)", (value: string) => {
    expect(getSignupPasswordValidationError(value)).toBeNull();
  });

  test("counts emoji as single characters at both length boundaries", () => {
    const short: string = "🎈birch lake su";
    expect(short.length).toBe(15);
    expect(Array.from(short)).toHaveLength(14);
    expect(getSignupPasswordValidationError(short)).toBe(
      "Password must be at least 15 characters.",
    );
    expect(getSignupPasswordValidationError(short + "n")).toBeNull();
    const maximum: string =
      "🎈" + "violet river lantern ".repeat(5).slice(0, 99);
    expect(Array.from(maximum)).toHaveLength(100);
    expect(getSignupPasswordValidationError(maximum)).toBeNull();
    expect(getSignupPasswordValidationError(maximum + "🌿")).toBe(
      "Password cannot be more than 100 characters.",
    );
  });

  test("does not include the submitted password in error messages", () => {
    const secret: string = "Password123!";
    expect(getSignupPasswordValidationError(secret)).not.toContain(secret);
  });

  test("preserves the existing policy for other password flows", () => {
    expect(getPasswordValidationError("sample")).toBeNull();
    expect(getSignupPasswordValidationError("sample")).not.toBeNull();
  });
});
