/*
 * The one password rule, in one place, so a form that collects a password and
 * the endpoint that stores it cannot disagree about what is acceptable.
 *
 * Every form that sets a password - sign up, Reset Password (OneUptime's and a
 * status page's), the Dashboard's Update Password, and Admin Dashboard's
 * Create User and Set Password - checks it as the person types and shows its
 * checklist (UI/Components/PasswordRequirements). The server checks it again
 * wherever a password is written: UserService and StatusPagePrivateUserService
 * refuse a new password that breaks it (Server/Utils/NewPasswordRule), however
 * it arrived. Sign-up, the reset routes and Set Password ask it first, to
 * answer before anything else happens.
 *
 * It is a rule for a NEW password only. Signing in never checks it, so a
 * password set before the rule existed keeps working until its owner changes
 * it (#9123). A sign-in form never checks a password's length either.
 *
 * It lives in Common/Types (not Common/Server) so the browser can import it.
 */

// Long enough to be a passphrase: a few unrelated words.
export const MINIMUM_PASSWORD_LENGTH: number = 15;

/*
 * An upper bound, so a caller cannot hand the hasher an arbitrarily large
 * string. It is not a security property -- scrypt's cost is set by N/r/p, not
 * by input length -- it just keeps a pathological request from becoming work.
 * 100 is far above any password a person types and far below anything that
 * matters.
 */
export const MAXIMUM_PASSWORD_LENGTH: number = 100;

const COMMON_PASSWORDS: Set<string> = new Set([
  "password",
  "oneuptime",
  "letmein",
  "iloveyou",
  "welcome",
  "admin",
  "changeme",
]);

const REPEATED_PASSWORD_PATTERN: RegExp = /^(.{1,14})\1+$/u;

/*
 * The rule's refusals. Each is a sentence that says what to do, and each is a
 * key in the locales of every app with a form that sets a password, so a form
 * shows the server's refusal in the reader's language.
 */
export const PASSWORD_RULE_MESSAGES: {
  required: string;
  notText: string;
  blank: string;
  tooShort: string;
  tooLong: string;
  predictable: string;
} = {
  required: "Password is required.",
  notText: "Password must be a string.",
  blank: "Password cannot be blank.",
  tooShort: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.`,
  tooLong: `Password cannot be more than ${MAXIMUM_PASSWORD_LENGTH} characters.`,
  predictable: "Choose a less predictable password. Try a few unrelated words.",
};

// A password's length as a person counts it: an emoji is one character.
export function getPasswordLength(password: string): number {
  return Array.from(password).length;
}

/**
 * Check obvious patterns independently of length so a form can show each
 * requirement as the person types. Blank input returns true so an empty form
 * cannot complete this requirement.
 * Passing this check alone does not mean the password is valid or strong.
 */
export function isPredictablePassword(password: string): boolean {
  if (password.trim().length === 0) {
    return true;
  }

  // Comparison only: padding, punctuation and casing do not rescue an obvious pattern.
  const comparable: string =
    password.toLowerCase().replace(/[\s\p{P}\p{Sc}\p{Sm}\p{Sk}]/gu, "") ||
    password.toLowerCase().replace(/\s/gu, "");
  const sequences: Array<string> = [
    "0123456789",
    "abcdefghijklmnopqrstuvwxyz",
    "qwertyuiopasdfghjklzxcvbnm",
  ];
  const isSequence: boolean = sequences.some((sequence: string): boolean => {
    return (
      sequence.repeat(10).includes(comparable) ||
      Array.from(sequence).reverse().join("").repeat(10).includes(comparable)
    );
  });

  return (
    REPEATED_PASSWORD_PATTERN.test(comparable) ||
    COMMON_PASSWORDS.has(comparable.replace(/\d+$/u, "")) ||
    isSequence
  );
}

/**
 * Why this new password is unacceptable, or null if it is fine.
 *
 * Returns a message rather than throwing so the same function can back a
 * browser-side form validator and a server-side guard -- the server wraps the
 * message in the exception type it wants to return.
 *
 * Length is measured on the raw value, NOT a trimmed one: a password is a
 * secret the person typed, and silently trimming it would store something
 * other than what they entered and then fail to match it at sign-in. A value
 * that is *only* whitespace is rejected outright, though -- that is a mistake,
 * not a password.
 */
export function getPasswordValidationError(password: unknown): string | null {
  if (password === undefined || password === null || password === "") {
    return PASSWORD_RULE_MESSAGES.required;
  }

  if (typeof password !== "string") {
    return PASSWORD_RULE_MESSAGES.notText;
  }

  if (password.trim().length === 0) {
    return PASSWORD_RULE_MESSAGES.blank;
  }

  // Count Unicode characters, including emoji, once each. Never alter the secret.
  const length: number = getPasswordLength(password);

  if (length < MINIMUM_PASSWORD_LENGTH) {
    return PASSWORD_RULE_MESSAGES.tooShort;
  }

  if (length > MAXIMUM_PASSWORD_LENGTH) {
    return PASSWORD_RULE_MESSAGES.tooLong;
  }

  if (isPredictablePassword(password)) {
    return PASSWORD_RULE_MESSAGES.predictable;
  }

  return null;
}
