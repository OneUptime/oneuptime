import { getTwilioConfig } from "../Config";
import CallProviderFactory from "../Providers/CallProviderFactory";
import CallService from "../Services/CallService";
import {
  getVoicemailMessage,
  VOICEMAIL_MESSAGE_CALL_DATA_KEY,
} from "./AnsweredBy";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import { WebhookRequest } from "Common/Types/Call/CallProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import { PROJECT_TWILIO_CONFIG_SELECT } from "Common/Server/Utils/TwilioConfigSelect";
import logger from "Common/Server/Utils/Logger";
import Twilio from "twilio";

/*
 * WHAT THE ANSWERING MACHINE CALLBACK OF AN ON-CALL CALL NEEDS OF THE
 * TWILIO ACCOUNT THAT PLACED IT (#6594, API/Call.ts).
 *
 * The callback is a public webhook. Its URL carries the call's own token,
 * as the status callback's does, and Twilio signs the request with the
 * auth token of the account the call went out on (X-Twilio-Signature), as
 * it signs the calls to an incoming call policy's number. The route checks
 * both. The account is the project's own Twilio config, or the OneUptime
 * server's; the request says which (AccountSid), and the signature proves
 * it. Only an account that could have placed the call is tried: one of the
 * call's project's configs, or the server's own. The same account then
 * leaves the message on voicemail, through Twilio's API.
 *
 * Nothing here writes an auth token or a whole account SID to the log.
 */

export const TWILIO_SIGNATURE_HEADER: string = "x-twilio-signature";

// A value Twilio posted, as text, without the whitespace around it.
function postedText(body: unknown, key: string): string {
  const value: unknown =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)[key]
      : undefined;

  return typeof value === "string" ? value.trim() : "";
}

/*
 * The accounts that may have placed a call of this project on the account
 * the request names: the project's configs on it - a project can hold two
 * for one account, with other numbers - and the server's own. A config
 * that cannot be read as an account is passed over: no call went out on it.
 */
async function getCandidateAccounts(data: {
  accountSid: string;
  projectId: ObjectID | undefined;
}): Promise<Array<TwilioConfig>> {
  const candidates: Array<TwilioConfig> = [];

  if (data.projectId) {
    const configs: Array<ProjectCallSMSConfig> =
      await ProjectCallSMSConfigService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: PROJECT_TWILIO_CONFIG_SELECT,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const config of configs) {
      if ((config.twilioAccountSID || "").trim() !== data.accountSid) {
        continue;
      }

      try {
        const account: TwilioConfig | undefined =
          ProjectCallSMSConfigService.toTwilioConfig(config);

        if (account) {
          candidates.push(account);
        }
      } catch {
        // Without its account's credentials: no call went out on it.
      }
    }
  }

  const serverAccount: TwilioConfig | null = await getTwilioConfig();

  if (serverAccount && serverAccount.accountSid === data.accountSid) {
    candidates.push(serverAccount);
  }

  return candidates;
}

/*
 * The account that signed a Twilio callback about one of a project's calls,
 * or null: the request names no account, carries no signature, or the
 * signature is not one any account that may have placed the call makes -
 * a request that is not Twilio's, or one a proxy changed on the way (its
 * host, its protocol, its path or its body).
 */
export async function findTwilioAccountThatSigned(data: {
  request: WebhookRequest;
  projectId: ObjectID | undefined;
}): Promise<TwilioConfig | null> {
  const accountSid: string = postedText(data.request.body, "AccountSid");
  const signatureHeader: unknown =
    data.request.headers[TWILIO_SIGNATURE_HEADER];
  const signature: string =
    typeof signatureHeader === "string" ? signatureHeader : "";

  if (!accountSid || !signature) {
    return null;
  }

  const candidates: Array<TwilioConfig> = await getCandidateAccounts({
    accountSid: accountSid,
    projectId: data.projectId,
  });

  for (const candidate of candidates) {
    if (
      CallProviderFactory.getProviderWithConfig(
        candidate,
      ).validateWebhookSignature(data.request, signature)
    ) {
      return candidate;
    }
  }

  return null;
}

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
    const client: Twilio.Twilio = Twilio(
      data.account.accountSid,
      data.account.authToken,
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
