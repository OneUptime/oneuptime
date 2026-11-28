import { translationKey } from "../Translator";

/*
 * WHAT A TWILIO ERROR CODE MEANS (#11417).
 *
 * The SMS log's Error Code column shows the code Twilio gave an SMS it could
 * not send or deliver - 30003, 30005, 21211 and so on - and it was a bare
 * number: someone reading the log had to look it up elsewhere. Each code now
 * links to Twilio's own page for it, and the most common ones say in one
 * plain line what they mean.
 *
 * Each line is taken from Twilio's page for its code, at
 * https://www.twilio.com/docs/api/errors/<code> (each title quoted beside
 * it, as checked on 2026-11-28), and says what happened to the SMS, not why
 * it might have: Twilio's page lists the possible causes, and the link opens
 * it. Each is a key of the Dashboard's locales.
 *
 * Twilio's codes for SMS are five digits (21211, 30003); its newest products'
 * are six. An SMS the server's own SMS and call gateway could not send
 * keeps the HTTP status the gateway answered in the same column (500,
 * CallAndSmsGatewayService), and a request that never reached Twilio keeps
 * the network's own code (ECONNRESET): neither is Twilio's, and neither is
 * linked. React-free and server-safe.
 */

const TWILIO_ERROR_PAGE: string = "https://www.twilio.com/docs/api/errors/";

const TWILIO_ERROR_CODE: RegExp = /^[1-9]\d{4,5}$/;

/*
 * The one-line meanings of the codes an SMS log most often shows, by code:
 * Twilio's title for each beside it.
 */
export const TWILIO_ERROR_CODE_MEANINGS: Readonly<Record<string, string>> = {
  // "Permission Denied": the credentials were incorrect, expired or deleted.
  "20003": translationKey("Twilio did not accept the account's credentials."),
  // "Invalid 'To' Phone Number".
  "21211": translationKey("The number is not a valid phone number."),
  // "Message blocked: permissions disabled for the destination region".
  "21408": translationKey(
    "The Twilio account is not allowed to send SMS to this country.",
  ),
  // "'From' number is not a valid message-capable Twilio number for this account".
  "21606": translationKey(
    "The sending number cannot send SMS for this Twilio account.",
  ),
  // "Upgrade and create an approved primary compliance profile to reach unverified numbers".
  "21608": translationKey(
    "A trial Twilio account can send only to numbers verified in it.",
  ),
  // "Attempt to send to unsubscribed recipient": they replied STOP.
  "21610": translationKey(
    "The recipient replied STOP, so Twilio no longer sends them SMS from this number.",
  ),
  // "Message cannot be sent with the current combination of 'To' and/or 'From' parameters".
  "21612": translationKey("The sending number cannot reach this number."),
  // "'To' number is not a valid mobile number".
  "21614": translationKey(
    "The number is not a mobile number, for example a landline.",
  ),
  // "Queue overflow".
  "30001": translationKey(
    "Too many SMS were sent at once, and Twilio's queue overflowed.",
  ),
  // "Account suspended".
  "30002": translationKey(
    "The Twilio account was suspended before the SMS went out.",
  ),
  // "Unreachable destination handset".
  "30003": translationKey("The phone is off or out of reach."),
  // "Message blocked".
  "30004": translationKey("The number is blocked from receiving the SMS."),
  // "Unknown destination handset": the number may no longer exist.
  "30005": translationKey("The number is unknown and may no longer exist."),
  // "Landline or unreachable carrier".
  "30006": translationKey(
    "The number cannot receive SMS, for example a landline.",
  ),
  // "Message filtered": by Twilio or by the carrier.
  "30007": translationKey("Twilio or the carrier filtered the SMS as spam."),
  // "Unknown error": a generic failure from the carrier.
  "30008": translationKey(
    "The carrier could not deliver the SMS and did not say why.",
  ),
  // "Toll-Free Number Has Not Been Verified".
  "30032": translationKey("The toll-free sending number is not verified yet."),
  // "US A2P 10DLC - Message from an Unregistered Number".
  "30034": translationKey(
    "The sending number is not registered for A2P 10DLC, which US carriers require.",
  ),
};

// The code as the log keeps it, without the space or the line end a write may leave.
function readCode(code: string | null | undefined): string {
  return (code || "").trim();
}

// Whether an SMS log's error code is Twilio's: five or six digits.
export function isTwilioErrorCode(code: string | null | undefined): boolean {
  return TWILIO_ERROR_CODE.test(readCode(code));
}

// Twilio's page for one of its codes, or null for a code that is not Twilio's.
export function getTwilioErrorCodeUrl(
  code: string | null | undefined,
): string | null {
  return isTwilioErrorCode(code)
    ? `${TWILIO_ERROR_PAGE}${readCode(code)}`
    : null;
}

// What a Twilio code means, in one plain line (a key), or null for any other code.
export function getTwilioErrorCodeMeaning(
  code: string | null | undefined,
): string | null {
  if (!isTwilioErrorCode(code)) {
    return null;
  }

  return TWILIO_ERROR_CODE_MEANINGS[readCode(code)] || null;
}
