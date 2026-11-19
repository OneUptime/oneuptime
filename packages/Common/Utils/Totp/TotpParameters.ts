import Dictionary from "../../Types/Dictionary";

/*
 * What a time-based one-time code (RFC 6238) is made from, and the guards
 * that hold it as it travels. Kept apart from the reading and the making of
 * codes (TotpSecret), and free of the HMAC library they need, so a monitor
 * step can carry TOTP parameters (MonitorStep.totpSecrets) without every
 * page that reads a monitor loading that library.
 */

export enum TotpAlgorithm {
  SHA1 = "SHA1",
  SHA256 = "SHA256",
  SHA512 = "SHA512",
}

export const TOTP_ALGORITHMS: ReadonlyArray<TotpAlgorithm> = [
  TotpAlgorithm.SHA1,
  TotpAlgorithm.SHA256,
  TotpAlgorithm.SHA512,
];

// The code lengths RFC 6238's reference implementation and the apps make.
export const TOTP_DIGIT_LENGTHS: ReadonlyArray<number> = [6, 8];

export const TOTP_DEFAULT_ALGORITHM: TotpAlgorithm = TotpAlgorithm.SHA1;
export const TOTP_DEFAULT_DIGITS: number = 6;
export const TOTP_DEFAULT_PERIOD_IN_SECONDS: number = 30;

// A code that changes less often than hourly is no one-time code.
export const TOTP_MAX_PERIOD_IN_SECONDS: number = 3600;

/*
 * Sixteen base32 characters are 80 bits, the shortest key sites hand out
 * (GitHub's and Microsoft's are that long). Anything shorter is a key that
 * was not copied whole, and would make codes that never match.
 */
export const TOTP_MIN_SECRET_LENGTH: number = 16;

/*
 * A SHA512 key of RFC 6238's 64 bytes is 103 characters. Five times that
 * is room for any real key, and a bound on what is read.
 */
export const TOTP_MAX_SECRET_LENGTH: number = 512;

// The most TOTP secrets one monitor step is handed, and the longest name.
export const MAX_TOTP_SECRETS_PER_STEP: number = 50;
export const MAX_TOTP_SECRET_NAME_LENGTH: number = 200;

export interface TotpParameters {
  // Base32 (A-Z and 2-7), upper case, no padding.
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  periodInSeconds: number;
}

// TOTP parameters by the name of the monitor secret they came from.
export type TotpSecrets = Dictionary<TotpParameters>;

const BASE32_SECRET: RegExp = /^[A-Z2-7]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

// Whether a value is parameters a code can be made from, as they travel.
export function isTotpParameters(value: unknown): value is TotpParameters {
  if (!isPlainObject(value)) {
    return false;
  }

  const secret: unknown = value["secret"];
  const periodInSeconds: unknown = value["periodInSeconds"];

  return (
    typeof secret === "string" &&
    secret.length >= TOTP_MIN_SECRET_LENGTH &&
    secret.length <= TOTP_MAX_SECRET_LENGTH &&
    BASE32_SECRET.test(secret) &&
    TOTP_ALGORITHMS.includes(value["algorithm"] as TotpAlgorithm) &&
    TOTP_DIGIT_LENGTHS.includes(value["digits"] as number) &&
    typeof periodInSeconds === "number" &&
    Number.isSafeInteger(periodInSeconds) &&
    periodInSeconds >= 1 &&
    periodInSeconds <= TOTP_MAX_PERIOD_IN_SECONDS
  );
}

/*
 * TOTP secrets as a monitor step carries them to the probe: only names and
 * parameters that can make a code, copied field by field, and no more than
 * a step may hold. Anything else is dropped rather than trusted.
 */
export function readTotpSecrets(value: unknown): TotpSecrets {
  const secrets: TotpSecrets = {};

  if (!isPlainObject(value)) {
    return secrets;
  }

  for (const name of Object.keys(value)) {
    if (Object.keys(secrets).length >= MAX_TOTP_SECRETS_PER_STEP) {
      break;
    }

    const parameters: unknown = value[name];

    if (
      !name ||
      name.length > MAX_TOTP_SECRET_NAME_LENGTH ||
      !isTotpParameters(parameters)
    ) {
      continue;
    }

    secrets[name] = {
      secret: parameters.secret,
      algorithm: parameters.algorithm,
      digits: parameters.digits,
      periodInSeconds: parameters.periodInSeconds,
    };
  }

  return secrets;
}
