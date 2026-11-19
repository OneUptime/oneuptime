/*
 * TWILIO SENDS A STATUS CALLBACK AGAIN WHEN OUR SERVER COULD NOT TAKE IT.
 *
 * By default Twilio sends a webhook again only when it could not connect to
 * it, and only once (its connection overrides: rc=1, rp=ct). So a status
 * callback this server answered with a 5xx - the database failed reading
 * the log, writing it, or correcting the on-call page - was never sent
 * again, and the status was lost: the SMS log kept saying it was sent, the
 * call's said it was placed, the delivery was never counted, and a page
 * that did not reach the person kept saying Sent (issue #6874).
 *
 * So every SMS's and call's status callback address asks Twilio, in its
 * fragment, to send it again on a 5xx too, a few times, within Twilio's own
 * 15 seconds for a webhook:
 * https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides.
 * A browser or a proxy never sends a fragment, and Twilio leaves it out of
 * its signature, so the callback reaches the same route with the same
 * token. Never on a 4xx: the callback was refused - its token or Twilio's
 * signature is wrong (TwilioWebhookSignature) - and sending it again
 * changes nothing.
 *
 * A callback sent again is safe: every write it makes is a compare-and-set,
 * a message is counted once, and a page is corrected only while it still
 * says Sent or Sending (API/SMS.ts, API/Call.ts).
 */

// The most times Twilio sends a callback again: 0 to 5 (Twilio's range).
export const STATUS_CALLBACK_RETRY_COUNT: number = 3;

// What Twilio sends it again on: a connection that failed, as by default, and our 5xx.
export const STATUS_CALLBACK_RETRY_POLICY: ReadonlyArray<string> = [
  "ct",
  "5xx",
];

// The status callback's address, asking Twilio to send it again on a 5xx.
export function withRetryOnServerError(url: string): string {
  return `${url}#rc=${STATUS_CALLBACK_RETRY_COUNT}&rp=${STATUS_CALLBACK_RETRY_POLICY.join(",")}`;
}
