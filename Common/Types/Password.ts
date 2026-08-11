/*
 * The password rules, in one place, so the form that collects a password and
 * the endpoint that stores it cannot disagree about what is acceptable.
 *
 * Every password form in OneUptime has historically carried its own inline
 * `minLength: 6`, and no server-side check existed at all -- the browser was
 * the only thing enforcing it. That is fine right up until a password arrives
 * from somewhere that is not the browser, which is exactly what an admin API
 * is. These constants and `getPasswordValidationError` live in Common/Types
 * (not Common/Server) precisely so the browser can import them too.
 */

/*
 * Six is the number every existing OneUptime password form already enforces
 * (Accounts sign-up, Accounts reset-password, the user profile, the status
 * page). It is stated here rather than raised so that adopting this module
 * cannot lock out anyone whose current password was accepted under the old
 * inline rule.
 */
export const MINIMUM_PASSWORD_LENGTH: number = 6;

/*
 * An upper bound, so a caller cannot hand the hasher an arbitrarily large
 * string. It is not a security property -- scrypt's cost is set by N/r/p, not
 * by input length -- it just keeps a pathological request from becoming work.
 * 100 is far above any password a person types and far below anything that
 * matters.
 */
export const MAXIMUM_PASSWORD_LENGTH: number = 100;

/**
 * Why this password is unacceptable, or null if it is fine.
 *
 * Returns a message rather than throwing so the same function can back a
 * browser-side form validator and a server-side guard -- the server wraps the
 * message in the exception type it wants to return.
 *
 * Length is measured on the raw value, NOT a trimmed one: a password is a
 * secret the user typed, and silently trimming it would store something other
 * than what they entered and then fail to match it at login. A value that is
 * *only* whitespace is rejected outright, though -- that is a mistake, not a
 * password.
 */
export function getPasswordValidationError(
  password: string | undefined | null,
): string | null {
  if (password === undefined || password === null || password === "") {
    return "Password is required.";
  }

  if (password.trim().length === 0) {
    return "Password cannot be blank.";
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Password cannot be less than ${MINIMUM_PASSWORD_LENGTH} characters.`;
  }

  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    return `Password cannot be more than ${MAXIMUM_PASSWORD_LENGTH} characters.`;
  }

  return null;
}
