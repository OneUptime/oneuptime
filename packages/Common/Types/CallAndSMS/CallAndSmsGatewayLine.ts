/*
 * WHAT AN SMS'S OR A CALL'S LOG SAYS ONCE THE SERVER'S OWN GATEWAY TOOK IT.
 *
 * A server that sends its SMS and calls through its own gateway
 * (CallAndSmsProvider.Gateway) writes, on the log of each one its gateway
 * accepted, "Sent to the SMS and call gateway (HTTP 200)." - the gateway
 * named, never its URL (CallAndSmsGatewayService). A gateway never reports
 * what became of a message after that: an SMS it took stays Sent, a call
 * it took stays Success. That is its last status, where an SMS Twilio's
 * carrier accepted - Sent too - is still on its way to Delivered.
 *
 * So the line is written here and read back here: the notification logs
 * tell the two apart by it (NotificationLogStatus), and a test holds the
 * reader to the builder.
 *
 * React-free and server-safe.
 */

// How the gateway is named where people read about a delivery.
export const CALL_AND_SMS_GATEWAY_NAME: string = "the SMS and call gateway";

// "Sent to the SMS and call gateway (HTTP 200)."
export function getSentToCallAndSmsGatewayMessage(statusCode: number): string {
  return `Sent to ${CALL_AND_SMS_GATEWAY_NAME} (HTTP ${statusCode}).`;
}

const SENT_TO_GATEWAY: RegExp =
  /^Sent to the SMS and call gateway \(HTTP (\d{3})\)\.$/;

/*
 * Whether a log's status message says the gateway took the SMS or the call,
 * checked against the builder; false for any other line.
 */
export function isSentToCallAndSmsGatewayMessage(
  statusMessage: string | null | undefined,
): boolean {
  const message: string = (statusMessage || "").trim();
  const match: RegExpMatchArray | null = message.match(SENT_TO_GATEWAY);

  return Boolean(
    match && getSentToCallAndSmsGatewayMessage(Number(match[1])) === message,
  );
}
