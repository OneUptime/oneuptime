import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";

/*
 * Twilio's own refusal of an SMS or a call, as the Notification service
 * answers it.
 *
 * The Twilio SDK throws a RestException - not one of our Exceptions - so the
 * route's error handler answered every one of them with a bare 500 "Server
 * Error". Twilio had said exactly what was wrong ("Permission to send an SMS
 * has not been enabled for the region indicated by the 'To' number", error
 * 21408), the SMS log recorded it, and the caller - a person waiting for a
 * verification code - was told nothing it could act on. This keeps Twilio's
 * words and its error code, which is what Twilio's documentation is indexed
 * by.
 *
 * Twilio refusing the request (a 4xx: a number it will not reach, an account
 * that may not, credentials it does not accept) is the account's setup, not
 * a defect of ours, so it is a user error. Twilio failing (a 5xx) keeps its
 * words, but is not.
 */

export enum TwilioSendKind {
  SMS = "SMS",
  Call = "Call",
}

const WHAT_TWILIO_COULD_NOT_DO: Readonly<Record<TwilioSendKind, string>> = {
  [TwilioSendKind.SMS]: "send this SMS",
  [TwilioSendKind.Call]: "place this call",
};

interface TwilioRestError {
  status: number;
  message?: string | undefined;
  code?: number | undefined;
}

export default class TwilioSendError {
  // The shape of the SDK's RestException: an Error with Twilio's HTTP status.
  public static isTwilioRestError(error: unknown): error is TwilioRestError {
    return (
      error instanceof Error &&
      !(error instanceof Exception) &&
      typeof (error as unknown as TwilioRestError).status === "number"
    );
  }

  /*
   * What to throw for a failed send: Twilio's refusal in words the caller
   * can act on, or whatever was thrown, untouched - our own Exceptions
   * (no Twilio account, the project's settings) already say what they mean.
   */
  public static toSendError(error: unknown, kind: TwilioSendKind): unknown {
    if (!TwilioSendError.isTwilioRestError(error)) {
      return error;
    }

    // Twilio's sentence without its full stop, so the code can follow it.
    const twilioMessage: string = (error.message || "")
      .trim()
      .replace(/[.\s]+$/, "");
    const code: string =
      error.code || error.code === 0 ? ` (Twilio error ${error.code})` : "";

    const exception: BadDataException = new BadDataException(
      `Twilio could not ${WHAT_TWILIO_COULD_NOT_DO[kind]}: ${
        twilioMessage || `HTTP ${error.status}`
      }${code}.`,
    );

    return error.status < 500 ? exception.asUserError() : exception;
  }
}
