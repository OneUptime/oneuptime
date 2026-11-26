import CallService from "../Services/CallService";
import {
  getVoicemailMessage,
  VOICEMAIL_MESSAGE_CALL_DATA_KEY,
} from "./AnsweredBy";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import logger from "Common/Server/Utils/Logger";
import Twilio from "twilio";
import TwilioHttpClient from "./TwilioHttpClient";

/*
 * WHAT THE ANSWERING MACHINE CALLBACK OF AN ON-CALL CALL DOES WITH THE
 * TWILIO ACCOUNT THAT PLACED IT (#6594, API/Call.ts).
 *
 * The callback is a public webhook, held to the call's own token in its URL
 * and to Twilio's signature (X-Twilio-Signature), made with the auth token
 * of the account the call went out on: the project's own Twilio config, or
 * the OneUptime server's (Common/Server/Utils/TwilioWebhookSignature, which
 * every route Twilio calls checks with). The same account then leaves the
 * message on voicemail, through Twilio's API.
 *
 * Nothing here writes an auth token or a whole account SID to the log.
 */

/*
 * The message to leave on a call's voicemail: the one kept with its words
 * as it was placed (CallService), or - for a call whose words are not
 * logged - who called and what to do, in the installation's own name.
 */
export function getVoicemailMessageOfCall(callData: unknown): string {
  const kept: unknown =
    callData && typeof callData === "object"
      ? (callData as Record<string, unknown>)[VOICEMAIL_MESSAGE_CALL_DATA_KEY]
      : undefined;

  if (typeof kept === "string" && kept.trim()) {
    return kept.trim();
  }

  return ProductBrandingText.brandText(getVoicemailMessage(null));
}

/*
 * Leaves the message on voicemail: the live call is turned to it, through
 * the account that placed it, and ends once it is said. Whether it was:
 * not when the call had ended already - the voicemail hung up, its mailbox
 * is full - or Twilio refused. Never throws: how the call ended is written
 * either way, saying whether a message was left.
 */
export async function leaveVoicemailMessage(data: {
  account: TwilioConfig;
  callSid: string;
  message: string;
  callLogId: ObjectID | string;
}): Promise<boolean> {
  try {
    // Through the outbound proxy, as every request of the server (#10721).
    const client: Twilio.Twilio = Twilio(
      data.account.accountSid,
      data.account.authToken,
      { httpClient: TwilioHttpClient.create() },
    );

    await client.calls(data.callSid).update({
      twiml: CallService.generateVoicemailTwiml(data.message),
    });

    return true;
  } catch (err) {
    /*
     * Twilio's code and HTTP status only: its message names the request's
     * path, which holds the account SID.
     */
    const error: { code?: unknown; status?: unknown } =
      err && typeof err === "object"
        ? (err as { code?: unknown; status?: unknown })
        : {};

    logger.warn(
      `No message was left on voicemail for call log ${data.callLogId.toString()}: Twilio answered with status ${String(error.status ?? "unknown")}, code ${String(error.code ?? "unknown")}.`,
    );

    return false;
  }
}
