import crypto from "crypto";

/*
 * X-TWILIO-SIGNATURE, COMPUTED THE WAY TWILIO'S DOCUMENTATION SAYS (#11138).
 *
 * The other tests sign requests with Twilio's own SDK
 * (getExpectedTwilioSignature), the library OneUptime checks them with
 * (validateRequest): a fault both shared would pass unseen. This is the
 * algorithm written out from Twilio's security page instead
 * (https://www.twilio.com/docs/usage/security#validating-requests):
 *
 *   1. take the full URL Twilio requested, from the protocol through the
 *      end of the query string - never its fragment, which Twilio leaves
 *      out of the signature (its connection overrides page:
 *      https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides);
 *   2. sort the POST parameters alphabetically, by Unix-style
 *      case-sensitive order;
 *   3. append each parameter's name and value, with no delimiter, to the URL;
 *   4. sign the result with HMAC-SHA1, keyed with the account's auth token;
 *   5. Base64-encode the hash.
 *
 * TWILIO_DOCUMENTED_EXAMPLE is the page's worked example, copied as the page
 * gives it: its auth token, URL, parameters and the signature Twilio says
 * they make. A test holds this function to it.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export function getTwilioDocumentedSignature(data: {
  authToken: string;
  url: string;
  parameters: Record<string, string>;
}): string {
  // Twilio signs the URL it requested: a fragment is never sent, nor signed.
  const url: string = data.url.split("#")[0]!;

  const signed: string = Object.keys(data.parameters)
    // Unix-style, case-sensitive: by UTF-16 code unit, as Array.sort does.
    .sort()
    .reduce((text: string, name: string): string => {
      return `${text}${name}${data.parameters[name]}`;
    }, url);

  return crypto
    .createHmac("sha1", data.authToken)
    .update(Buffer.from(signed, "utf-8"))
    .digest("base64");
}

/*
 * Twilio's worked example, from "Validating requests" on its security page:
 * "Suppose your AuthToken is 12345", the request it posted, and the
 * signature it computes for it.
 */
export const TWILIO_DOCUMENTED_EXAMPLE: {
  authToken: string;
  url: string;
  parameters: Record<string, string>;
  concatenated: string;
  signature: string;
} = {
  authToken: "12345",
  url: "https://example.com/myapp.php?foo=1&bar=2",
  // As the page lists them, before sorting.
  parameters: {
    Digits: "1234",
    To: "+18005551212",
    From: "+14158675310",
    Caller: "+14158675310",
    CallSid: "CA1234567890ABCDE",
  },
  concatenated:
    "https://example.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+18005551212",
  signature: "L/OH5YylLD5NRKLltdqwSvS0BnU=",
};

/*
 * The status callback Twilio's "Track the message status of outbound
 * messages" guide shows for an outbound SMS that moved to sent
 * (https://www.twilio.com/docs/messaging/guides/track-outbound-message-status),
 * parameter for parameter.
 */
export const TWILIO_DOCUMENTED_SENT_CALLBACK: Record<string, string> = {
  AccountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  From: "+15017250604",
  MessageSid: "SM1342fe1b2c904d1ab04f0fc7a58abca9",
  MessageStatus: "sent",
  SmsSid: "SM1342fe1b2c904d1ab04f0fc7a58abca9",
  SmsStatus: "sent",
};

/*
 * The same message's later callbacks, in the shape that guide describes:
 * MessageStatus and SmsStatus move on; a delivery receipt brings the
 * carrier's done date (RawDlrDoneDate, YYMMDDhhmm), and a failure its
 * ErrorCode - 30003 is Twilio's "Unreachable destination handset", 30008
 * "Unknown error" (https://www.twilio.com/docs/api/errors). ApiVersion and
 * To are parameters every callback carries.
 */
export function getTwilioDocumentedCallback(data: {
  status: "sent" | "delivered" | "undelivered" | "failed";
  accountSid?: string | undefined;
  to?: string | undefined;
}): Record<string, string> {
  const callback: Record<string, string> = {
    ...TWILIO_DOCUMENTED_SENT_CALLBACK,
    ...(data.accountSid ? { AccountSid: data.accountSid } : {}),
    ApiVersion: "2010-04-01",
    To: data.to || "+15558675310",
    MessageStatus: data.status,
    SmsStatus: data.status,
  };

  if (data.status === "delivered") {
    callback["RawDlrDoneDate"] = "2611260914";
  }

  if (data.status === "undelivered") {
    callback["RawDlrDoneDate"] = "2611260914";
    callback["ErrorCode"] = "30003";
  }

  if (data.status === "failed") {
    callback["ErrorCode"] = "30008";
  }

  return callback;
}
