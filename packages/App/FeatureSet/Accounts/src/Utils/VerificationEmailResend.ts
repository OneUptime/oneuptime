import { RESEND_VERIFICATION_EMAIL_API_URL } from "./ApiPaths";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";

/*
 * Client half of POST /identity/resend-verification-email.
 *
 * Nobody is signed in when a new verification link is asked for, so the
 * request carries a credential instead of a session -- and deliberately never
 * an email address. An "enter your email and we will mail it" endpoint would
 * let anyone point verification mail at any address; these credentials can
 * only ever name an account the holder just created (the resend token /signup
 * returned) or one whose link reached their inbox (the verification token in
 * that link). The server mails the address the account already holds.
 */
export type VerificationEmailResendCredential =
  | { resendToken: string }
  | { verificationToken: string };

export enum VerificationEmailResendOutcome {
  Sent = "sent",
  CoolingDown = "cooling-down",
  AlreadyVerified = "already-verified",
}

export interface VerificationEmailResendResult {
  outcome: VerificationEmailResendOutcome;
  retryAfterSeconds: number;
}

// What the server enforces between two verification emails for one account.
export const DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS: number = 60;

/*
 * The longest wait this page will ever show. A number past this is not a
 * cooldown the server meant -- it is a broken proxy, a bad header, or a clock
 * that jumped -- and a countdown of days would lock the button for good.
 */
export const MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS: number =
  24 * 60 * 60;

// Retry-After in its delta-seconds form only; an HTTP-date is not trusted here.
const RETRY_AFTER_SECONDS_PATTERN: RegExp = /^\d+$/;

/*
 * Every wait this page shows comes from the network, so none of it is trusted
 * as-is: anything that is not a finite number is no wait at all, fractions
 * round up (showing "0:00" while the server still refuses would invite a
 * pointless click) and the result stays within [0, MAX].
 */
export const clampCooldownSeconds: (value: unknown) => number = (
  value: unknown,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(
    MAX_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
    Math.max(0, Math.ceil(value)),
  );
};

/*
 * Map the route's answer onto what the screen can say. Checked in this order
 * because "already verified" wins over everything else: there is nothing left
 * to send. A shape this page does not recognise throws, so the caller shows a
 * generic failure instead of claiming an email went out.
 */
export const parseVerificationEmailResendResponse: (
  data: unknown,
) => VerificationEmailResendResult = (
  data: unknown,
): VerificationEmailResendResult => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Unexpected response to a verification email request.");
  }

  const body: JSONObject = data as JSONObject;

  if (body["alreadyVerified"] === true) {
    return {
      outcome: VerificationEmailResendOutcome.AlreadyVerified,
      retryAfterSeconds: 0,
    };
  }

  if (body["emailSent"] === true) {
    return {
      outcome: VerificationEmailResendOutcome.Sent,
      retryAfterSeconds:
        clampCooldownSeconds(body["retryAfterSeconds"]) ||
        DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
    };
  }

  if (body["emailSent"] === false) {
    return {
      outcome: VerificationEmailResendOutcome.CoolingDown,
      retryAfterSeconds:
        clampCooldownSeconds(body["retryAfterSeconds"]) ||
        DEFAULT_VERIFICATION_EMAIL_RESEND_COOLDOWN_IN_SECONDS,
    };
  }

  throw new Error("Unexpected response to a verification email request.");
};

/*
 * Ask for a new link. A refusal is thrown as the HTTPErrorResponse itself, so
 * the caller can tell a rate limit (429, with its Retry-After) from a
 * credential the server no longer accepts (400, with the server's curated
 * message) from an outage.
 */
export const requestVerificationEmailResend: (
  credential: VerificationEmailResendCredential,
) => Promise<VerificationEmailResendResult> = async (
  credential: VerificationEmailResendCredential,
): Promise<VerificationEmailResendResult> => {
  /*
   * Rebuilt rather than passed through: the server refuses a body that names
   * both credentials, and whatever object the caller handed in goes nowhere
   * but the one field it is meant to carry.
   */
  const body: JSONObject =
    "resendToken" in credential
      ? { resendToken: credential.resendToken }
      : { verificationToken: credential.verificationToken };

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: RESEND_VERIFICATION_EMAIL_API_URL,
      data: { data: body },
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseVerificationEmailResendResponse(response.data);
};

/*
 * How long a 429 asked us to wait, or 0 when it did not say. Header names are
 * matched case-insensitively: the browser's XHR adapter lower-cases them
 * ("retry-after"), a test or another adapter may not.
 */
export const getRetryAfterSecondsFromError: (error: unknown) => number = (
  error: unknown,
): number => {
  if (!(error instanceof HTTPErrorResponse) || error.statusCode !== 429) {
    return 0;
  }

  const headers: Headers | undefined = error.headers;

  if (!headers || typeof headers !== "object") {
    return 0;
  }

  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() !== "retry-after") {
      continue;
    }

    const rawValue: unknown = headers[name];

    if (typeof rawValue !== "string" && typeof rawValue !== "number") {
      return 0;
    }

    const value: string = rawValue.toString().trim();

    if (!RETRY_AFTER_SECONDS_PATTERN.test(value)) {
      return 0;
    }

    return clampCooldownSeconds(Number(value));
  }

  return 0;
};

/*
 * "m:ss" for the countdown under the button: "0:05", "1:00", "12:05".
 * Digits come from the page's language (Persian and Hindi readers get their
 * own numerals), with grouping off so a long wait never reads "1,234:05". An
 * unknown language tag or a runtime without Intl falls back to ASCII digits
 * rather than breaking the screen.
 */
export const formatCountdown: (
  totalSeconds: number,
  locale?: string | undefined,
) => string = (totalSeconds: number, locale?: string | undefined): string => {
  const seconds: number =
    Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.ceil(totalSeconds)
      : 0;

  const minutesPart: number = Math.floor(seconds / 60);
  const secondsPart: number = seconds % 60;

  try {
    const minutesFormat: Intl.NumberFormat = new Intl.NumberFormat(locale, {
      useGrouping: false,
    });
    const secondsFormat: Intl.NumberFormat = new Intl.NumberFormat(locale, {
      useGrouping: false,
      minimumIntegerDigits: 2,
    });

    return `${minutesFormat.format(minutesPart)}:${secondsFormat.format(secondsPart)}`;
  } catch {
    /* Unknown locale tag or no Intl support: plain ASCII digits instead. */
    return `${minutesPart.toString()}:${secondsPart.toString().padStart(2, "0")}`;
  }
};
