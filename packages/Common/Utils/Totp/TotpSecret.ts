import Dictionary from "../../Types/Dictionary";
import {
  TOTP_ALGORITHMS,
  TOTP_DEFAULT_ALGORITHM,
  TOTP_DEFAULT_DIGITS,
  TOTP_DEFAULT_PERIOD_IN_SECONDS,
  TOTP_DIGIT_LENGTHS,
  TOTP_MAX_PERIOD_IN_SECONDS,
  TOTP_MAX_SECRET_LENGTH,
  TOTP_MIN_SECRET_LENGTH,
  TotpAlgorithm,
  TotpParameters,
  isTotpParameters,
} from "./TotpParameters";
import * as OTPAuth from "otpauth";

/*
 * A TIME-BASED ONE-TIME PASSWORD (TOTP) SECRET: READ, STORED, AND TURNED
 * INTO THE CODE OF THE MOMENT.
 *
 * A site that asks for a code from an authenticator app at sign-in gives
 * that app a secret once, when two-factor sign-in is set up: a QR code
 * holding an otpauth:// link, with a "setup key" (the same secret, in
 * base32) for whoever cannot scan it. A monitor secret of the TOTP type
 * holds that secret, so a monitor can sign in the way a person does
 * (issue #9703).
 *
 * What is read here is what RFC 6238 and Google's Key URI format define:
 *
 *   - a bare setup key: base32 (RFC 4648), read as the apps read it -
 *     spaces, hyphens and "=" padding dropped, lower case allowed - with
 *     the defaults every app assumes, SHA1, 6 digits, 30 seconds;
 *   - an otpauth://totp/LABEL?secret=...&algorithm=...&digits=...&period=...
 *     link, whose algorithm (SHA1, SHA256 or SHA512), digits (6 or 8) and
 *     period (seconds, 30 when left out) are honoured. Its label, issuer
 *     and any other parameter only name the account, and are not kept.
 *
 * The same reading runs in three places: the server, which refuses a value
 * it cannot read and stores what it read in one canonical form; the
 * Dashboard, which previews the code of a value as it is typed; and the
 * probe, which makes the code at the moment a check uses it.
 *
 * Every problem is an English sentence (a template, with the values it
 * names), so the server can say it in a refusal and the Dashboard can say it
 * in the reader's language.
 */

export {
  TOTP_ALGORITHMS,
  TOTP_DEFAULT_ALGORITHM,
  TOTP_DEFAULT_DIGITS,
  TOTP_DEFAULT_PERIOD_IN_SECONDS,
  TOTP_DIGIT_LENGTHS,
  TOTP_MAX_PERIOD_IN_SECONDS,
  TOTP_MAX_SECRET_LENGTH,
  TOTP_MIN_SECRET_LENGTH,
  TotpAlgorithm,
  isTotpParameters,
};
export type { TotpParameters };

// A link with a long label and issuer still fits many times over.
export const TOTP_MAX_INPUT_LENGTH: number = 8192;

/*
 * The least time a code still has when it is handed out: five seconds, or a
 * third of the period when the period is short. A code with less left could
 * expire between being typed and being checked, so the code of the next
 * period is waited for instead - five seconds at most.
 */
export const TOTP_MINIMUM_VALIDITY_IN_MS: number = 5000;

// What is wrong with a value, as a sentence with the values it names.
export interface TotpSecretProblem {
  template: string;
  values: Dictionary<string>;
}

export type TotpSecretReading =
  | { parameters: TotpParameters; problem?: undefined }
  | { parameters?: undefined; problem: TotpSecretProblem };

export interface TotpCodeWindow {
  code: string;
  // When the code's period started and when it ends, in milliseconds.
  startsAtInMs: number;
  endsAtInMs: number;
}

/*
 * The problems, as English templates. They are Dashboard keys too, so each
 * is written out whole here, where the extractor reads it.
 */
export const TOTP_SECRET_PROBLEMS: {
  empty: string;
  migrationLink: string;
  counterLink: string;
  unreadableLink: string;
  linkWithoutSecret: string;
  badCharacters: string;
  tooShort: string;
  tooLong: string;
  unsupportedAlgorithm: string;
  unsupportedDigits: string;
  unsupportedPeriod: string;
} = {
  empty:
    "Enter the setup key or the otpauth:// link from the site's two-factor setup.",
  migrationLink:
    "This is an authenticator app's export link, which can hold several accounts. Paste the account's own otpauth://totp/ link or its setup key instead.",
  counterLink:
    "This link is for counter-based codes (HOTP). A monitor needs a time-based link, which starts with otpauth://totp/.",
  unreadableLink:
    "This otpauth:// link cannot be read. Paste the whole link, which starts with otpauth://totp/, or only the setup key.",
  linkWithoutSecret:
    "This link has no secret in it. Paste the whole otpauth://totp/ link, or only the setup key.",
  badCharacters:
    "A setup key has only the letters A to Z and the digits 2 to 7, and this one has {{characters}}. Check for a 0 that should be an O, or a 1 or 8 that should be an I or a B.",
  tooShort:
    "This setup key is too short: a setup key has at least {{minimum}} characters. Check that you copied all of it.",
  tooLong:
    "This setup key is longer than {{maximum}} characters, longer than any site's. Check that you pasted only the key.",
  unsupportedAlgorithm:
    "This link asks for the {{algorithm}} algorithm. A monitor can make codes with SHA1, SHA256 or SHA512.",
  unsupportedDigits:
    "This link asks for codes of {{digits}} digits. A monitor can make codes of 6 or 8 digits.",
  unsupportedPeriod:
    "This link asks for a new code every {{period}} seconds. The period must be a whole number of seconds from 1 to 3600.",
};

const BASE32_CHARACTER: RegExp = /^[A-Z2-7]$/;

// What an app drops from a key before reading it: spaces, hyphens, padding.
const KEY_SEPARATORS: RegExp = /[\s-]+/g;
const TRAILING_PADDING: RegExp = /[=]+$/;

const WHOLE_NUMBER: RegExp = /^\d+$/;

/*
 * otpauth://TYPE/LABEL?QUERY#FRAGMENT. The label may hold anything but a
 * "?" or a "#"; it is not read.
 */
const OTPAUTH_LINK: RegExp =
  /^otpauth:\/\/([^/?#]*)(?:\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/i;

// The label the canonical form is stored under. It is never read back.
const STORED_LABEL: string = "OneUptime";

// How many of a key's bad characters a problem names.
const MAX_NAMED_BAD_CHARACTERS: number = 5;

// A setup key as read, or what is wrong with it.
interface SecretReading {
  secret?: string | undefined;
  problem?: TotpSecretProblem | undefined;
}

function problemOf(
  template: string,
  values: Dictionary<string> = {},
): { problem: TotpSecretProblem } {
  return { problem: { template, values } };
}

function problemOrUnreadable(reading: SecretReading): {
  problem: TotpSecretProblem;
} {
  return {
    problem: reading.problem || {
      template: TOTP_SECRET_PROBLEMS.unreadableLink,
      values: {},
    },
  };
}

// A problem's sentence in English, its values filled in: a server's refusal.
export function writeTotpSecretProblem(problem: TotpSecretProblem): string {
  return problem.template.replace(
    /\{\{(\w+)\}\}/g,
    (whole: string, name: string): string => {
      const value: string | undefined = problem.values[name];

      return value === undefined ? whole : value;
    },
  );
}

/*
 * A setup key as an app reads it, or the problem with it. emptyProblem is
 * what an empty key means: a link without one says so, a bare value that is
 * empty asks for a key.
 */
function readSecret(value: string, emptyProblem: string): SecretReading {
  const secret: string = value
    .replace(KEY_SEPARATORS, "")
    .toUpperCase()
    .replace(TRAILING_PADDING, "");

  if (!secret) {
    return problemOf(emptyProblem);
  }

  const badCharacters: Array<string> = [];

  for (const character of Array.from(secret)) {
    if (!BASE32_CHARACTER.test(character)) {
      if (!badCharacters.includes(character)) {
        badCharacters.push(character);
      }
    }
  }

  if (badCharacters.length > 0) {
    return problemOf(TOTP_SECRET_PROBLEMS.badCharacters, {
      characters: badCharacters.slice(0, MAX_NAMED_BAD_CHARACTERS).join(", "),
    });
  }

  if (secret.length < TOTP_MIN_SECRET_LENGTH) {
    return problemOf(TOTP_SECRET_PROBLEMS.tooShort, {
      minimum: String(TOTP_MIN_SECRET_LENGTH),
    });
  }

  if (secret.length > TOTP_MAX_SECRET_LENGTH) {
    return problemOf(TOTP_SECRET_PROBLEMS.tooLong, {
      maximum: String(TOTP_MAX_SECRET_LENGTH),
    });
  }

  return { secret };
}

/*
 * "SHA256", "sha256" and "SHA-256" are the same algorithm; the link names
 * it as its issuer wrote it.
 */
function readAlgorithm(value: string | null): TotpAlgorithm | null {
  if (value === null || value.trim() === "") {
    return TOTP_DEFAULT_ALGORITHM;
  }

  const name: string = value.trim().toUpperCase().replace(/-/g, "");

  return (
    TOTP_ALGORITHMS.find((algorithm: TotpAlgorithm): boolean => {
      return algorithm === name;
    }) || null
  );
}

function readWholeNumber(value: string): number | null {
  const text: string = value.trim();

  if (!WHOLE_NUMBER.test(text)) {
    return null;
  }

  const number: number = Number(text);

  return Number.isSafeInteger(number) ? number : null;
}

function readLink(link: string): TotpSecretReading {
  const match: RegExpExecArray | null = OTPAUTH_LINK.exec(link);

  if (!match) {
    return problemOf(TOTP_SECRET_PROBLEMS.unreadableLink);
  }

  const type: string = (match[1] || "").toLowerCase();

  if (type === "hotp") {
    return problemOf(TOTP_SECRET_PROBLEMS.counterLink);
  }

  if (type !== "totp") {
    return problemOf(TOTP_SECRET_PROBLEMS.unreadableLink);
  }

  let query: URLSearchParams;

  try {
    query = new URLSearchParams(match[2] || "");
  } catch {
    return problemOf(TOTP_SECRET_PROBLEMS.unreadableLink);
  }

  /*
   * The parameter named exactly `secret` - never one that only ends in it -
   * and the first of them, as every app reads a link.
   */
  const secretReading: SecretReading = readSecret(
    query.get("secret") || "",
    TOTP_SECRET_PROBLEMS.linkWithoutSecret,
  );

  if (secretReading.problem || !secretReading.secret) {
    return problemOrUnreadable(secretReading);
  }

  const algorithmParameter: string | null = query.get("algorithm");
  const algorithm: TotpAlgorithm | null = readAlgorithm(algorithmParameter);

  if (!algorithm) {
    return problemOf(TOTP_SECRET_PROBLEMS.unsupportedAlgorithm, {
      algorithm: (algorithmParameter || "").trim(),
    });
  }

  const digitsParameter: string | null = query.get("digits");
  let digits: number = TOTP_DEFAULT_DIGITS;

  if (digitsParameter !== null && digitsParameter.trim() !== "") {
    const read: number | null = readWholeNumber(digitsParameter);

    if (read === null || !TOTP_DIGIT_LENGTHS.includes(read)) {
      return problemOf(TOTP_SECRET_PROBLEMS.unsupportedDigits, {
        digits: digitsParameter.trim(),
      });
    }

    digits = read;
  }

  const periodParameter: string | null = query.get("period");
  let periodInSeconds: number = TOTP_DEFAULT_PERIOD_IN_SECONDS;

  if (periodParameter !== null && periodParameter.trim() !== "") {
    const read: number | null = readWholeNumber(periodParameter);

    if (read === null || read < 1 || read > TOTP_MAX_PERIOD_IN_SECONDS) {
      return problemOf(TOTP_SECRET_PROBLEMS.unsupportedPeriod, {
        period: periodParameter.trim(),
      });
    }

    periodInSeconds = read;
  }

  return {
    parameters: {
      secret: secretReading.secret,
      algorithm,
      digits,
      periodInSeconds,
    },
  };
}

/*
 * A setup key or an otpauth:// link, as a site's two-factor setup gives
 * it, read into the parameters a code is made from - or what is wrong with
 * it.
 */
export function readTotpSecret(value: unknown): TotpSecretReading {
  if (typeof value !== "string" || value.trim() === "") {
    return problemOf(TOTP_SECRET_PROBLEMS.empty);
  }

  const text: string = value.trim();

  if (text.length > TOTP_MAX_INPUT_LENGTH) {
    return problemOf(TOTP_SECRET_PROBLEMS.tooLong, {
      maximum: String(TOTP_MAX_SECRET_LENGTH),
    });
  }

  const lowerCase: string = text.toLowerCase();

  // Google Authenticator's "Transfer accounts" link: many accounts in one.
  if (lowerCase.startsWith("otpauth-migration:")) {
    return problemOf(TOTP_SECRET_PROBLEMS.migrationLink);
  }

  if (lowerCase.startsWith("otpauth:")) {
    return readLink(text);
  }

  const secretReading: SecretReading = readSecret(
    text,
    TOTP_SECRET_PROBLEMS.empty,
  );

  if (secretReading.problem || !secretReading.secret) {
    return problemOrUnreadable(secretReading);
  }

  return {
    parameters: {
      secret: secretReading.secret,
      algorithm: TOTP_DEFAULT_ALGORITHM,
      digits: TOTP_DEFAULT_DIGITS,
      periodInSeconds: TOTP_DEFAULT_PERIOD_IN_SECONDS,
    },
  };
}

/*
 * The one form a TOTP secret is stored in, whatever was pasted: an otpauth
 * link holding exactly the parameters codes are made from. Reading it back
 * gives the same parameters, so what the probe reads never depends on how
 * the secret was first written.
 */
export function writeStoredTotpSecret(parameters: TotpParameters): string {
  return `otpauth://totp/${STORED_LABEL}?secret=${parameters.secret}&algorithm=${parameters.algorithm}&digits=${parameters.digits}&period=${parameters.periodInSeconds}`;
}

// The code of the period a moment falls in (RFC 6238).
export function generateTotpCode(
  parameters: TotpParameters,
  atInMs: number,
): string {
  return OTPAuth.TOTP.generate({
    secret: OTPAuth.Secret.fromBase32(parameters.secret),
    algorithm: parameters.algorithm,
    digits: parameters.digits,
    period: parameters.periodInSeconds,
    timestamp: atInMs,
  });
}

// The code of the period a moment falls in, and when that period runs.
export function getTotpCodeWindow(
  parameters: TotpParameters,
  atInMs: number,
): TotpCodeWindow {
  const periodInMs: number = parameters.periodInSeconds * 1000;
  const startsAtInMs: number = Math.floor(atInMs / periodInMs) * periodInMs;

  return {
    code: generateTotpCode(parameters, atInMs),
    startsAtInMs,
    endsAtInMs: startsAtInMs + periodInMs,
  };
}

// See TOTP_MINIMUM_VALIDITY_IN_MS.
export function getTotpMinimumValidityInMs(periodInSeconds: number): number {
  return Math.min(
    TOTP_MINIMUM_VALIDITY_IN_MS,
    Math.floor((periodInSeconds * 1000) / 3),
  );
}

/*
 * How long to wait, at a moment, before the code handed out would still
 * have its minimum validity left: nothing while the current code has
 * enough time, the rest of its period when it is about to expire.
 */
export function getTotpWaitInMs(
  parameters: TotpParameters,
  atInMs: number,
): number {
  const periodInMs: number = parameters.periodInSeconds * 1000;
  const remainingInMs: number = periodInMs - (atInMs % periodInMs);

  return remainingInMs < getTotpMinimumValidityInMs(parameters.periodInSeconds)
    ? remainingInMs
    : 0;
}
