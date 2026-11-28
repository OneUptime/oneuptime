import {
  CALL_AND_SMS_GATEWAY_NAME,
  getSentToCallAndSmsGatewayMessage,
  isSentToCallAndSmsGatewayMessage,
} from "../../../Types/CallAndSMS/CallAndSmsGatewayLine";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A LOG SAYS OF AN SMS OR A CALL THE SERVER'S OWN GATEWAY TOOK (#11138).
 *
 * The gateway reports nothing after it takes a message, so an SMS it took
 * stays Sent for good - its last status - where an SMS Twilio's carrier
 * accepted, Sent too, is still on its way to Delivered. The notification
 * logs tell the two apart by the line the sender writes, so the reader is
 * held to the builder here: every line it writes is read back, and no
 * other line - Twilio's, a refusal, one a person could type - is taken
 * for it.
 */

describe("the gateway's sent line", () => {
  test("names the gateway and the HTTP status, never its URL", () => {
    expect(CALL_AND_SMS_GATEWAY_NAME).toBe("the SMS and call gateway");
    expect(getSentToCallAndSmsGatewayMessage(200)).toBe(
      "Sent to the SMS and call gateway (HTTP 200).",
    );
    expect(getSentToCallAndSmsGatewayMessage(204)).toBe(
      "Sent to the SMS and call gateway (HTTP 204).",
    );
  });

  test("is read back, for every status a gateway takes a request with", () => {
    for (let status: number = 200; status < 300; status++) {
      expect({
        status,
        isRead: isSentToCallAndSmsGatewayMessage(
          getSentToCallAndSmsGatewayMessage(status),
        ),
      }).toEqual({ status, isRead: true });
    }
  });

  test("is read back with the whitespace a stored line may carry around it", () => {
    expect(
      isSentToCallAndSmsGatewayMessage(
        `  ${getSentToCallAndSmsGatewayMessage(200)}\n`,
      ),
    ).toBe(true);
  });

  test("is not any other line an SMS or a call log holds", () => {
    for (const line of [
      // Twilio's lines: the message's or the call's id, its delivery report.
      "Message ID: SM5c5c0000000000000000000000000001",
      "Delivery status: Sent. Message ID: SM5c5c0000000000000000000000000001.",
      "Call ID: CA5c5c0000000000000000000000000001",
      // The gateway's refusals, which are errors.
      "Not delivered: the SMS and call gateway answered HTTP 500 (tried 3 times).",
      "Not delivered: the SMS and call gateway could not be reached.",
      "Not delivered: the URL of the SMS and call gateway is not allowed. Your administrator can see why in the server's log.",
      // Near misses: another gateway, no status, a status that is no HTTP status, more words.
      "Sent to the SMS gateway (HTTP 200).",
      "Sent to the SMS and call gateway.",
      "Sent to the SMS and call gateway (HTTP 2000).",
      "Sent to the SMS and call gateway (HTTP abc).",
      "Sent to the SMS and call gateway (HTTP 200). And more.",
      "sent to the sms and call gateway (http 200).",
      "",
    ]) {
      expect({ line, isRead: isSentToCallAndSmsGatewayMessage(line) }).toEqual({
        line,
        isRead: false,
      });
    }

    expect(isSentToCallAndSmsGatewayMessage(undefined)).toBe(false);
    expect(isSentToCallAndSmsGatewayMessage(null)).toBe(false);
  });
});
