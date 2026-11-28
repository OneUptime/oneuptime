import { JSONObject } from "../JSON";
import {
  CustomChannelAction,
  CustomChannelActionLinks,
  CustomChannelReference,
} from "../CustomNotificationChannel/CustomNotificationChannelPayload";
import {
  fitTextToLength,
  TRUNCATED_TEXT_NOTE_PLAIN,
} from "../../Utils/MessageFit";

/*
 * WHAT AN SMS AND CALL GATEWAY RECEIVES.
 *
 * A server that sends its SMS and calls through its own gateway
 * (CallAndSmsProvider.Gateway) posts each of them to the gateway's URL as
 * one JSON request, signed with the gateway's secret and naming its event,
 * in the same headers a custom channel's requests carry
 * (X-OneUptime-Signature: sha256=<hex HMAC-SHA256 of the body>,
 * X-OneUptime-Event: sms, call or test) - so one verifier serves both.
 *
 * A call is described, not scripted: what it says, and - when it pages
 * somebody on call - the links that acknowledge, escalate or resolve what
 * it is about, which the gateway can offer as key presses. Twilio's "press
 * 1" is left out of what it says: it is Twilio's keypad, and the gateway
 * has its own.
 *
 * A CALL IN THE PERSON'S LANGUAGE (#11459). A call to a person who reads
 * OneUptime in another language says it in theirs (#11066, #11461), but a
 * gateway speaks with a voice of its own choosing, which OneUptime does not
 * know. So `message` stays the call's English, as every gateway has read
 * it - one that reads nothing else speaks English, as before, and never
 * another language's words in its English voice - and `inLanguage` carries
 * the same call in the person's language, with the language's code (BCP
 * 47, as OneUptime names its languages: "de", "pt", "zh-TW"), for a
 * gateway with a voice of that language to speak instead. Every language
 * OneUptime writes in, Persian included, which Twilio has no voice for: the
 * gateway's voices are its own. Null for a person who reads English, for an
 * SMS - written in the person's language already - and for a test.
 *
 * The shape is a contract with services OneUptime does not own, so it carries
 * a version, fields are only ever added to it, and the docs
 * (self-hosted/sms-and-call-gateway) describe every one of them.
 *
 * Pure, with no Node or browser APIs.
 */

export const CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION: number = 1;

/*
 * The longest message a request carries, in characters. An SMS is held to
 * what an SMS can be before it gets here (MAX_SMS_LENGTH); this bounds what
 * a call says - a template can place a description of any length in it.
 */
export const MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH: number = 16384;

export enum CallAndSmsGatewayEvent {
  Sms = "sms",
  Call = "call",
  Test = "test",
}

/*
 * What a call says in the language of the person it calls (#11459): the
 * language as OneUptime names it, and the call's words in it, as `message`
 * has them in English.
 */
export interface CallAndSmsGatewayInLanguage {
  // A BCP 47 tag, as OneUptime names its languages: "de", "pt", "zh-TW".
  language: string;
  message: string;
}

export interface CallAndSmsGatewayMessageInput {
  event: CallAndSmsGatewayEvent.Sms | CallAndSmsGatewayEvent.Call;
  /*
   * Unique to this message, and the same in every attempt to deliver it, so
   * a gateway that got it twice - an attempt that timed out after it
   * arrived - can tell.
   */
  id: string;
  sentAt: Date;
  // The number it goes to, in E.164 form.
  to: string;
  // The SMS, or what the call says.
  message: string;
  /*
   * A verification code, or anything else OneUptime keeps out of its own
   * logs: the gateway should keep it out of its own too.
   */
  isSensitive: boolean;
  project?: CustomChannelReference | undefined;
  // When the message pages somebody on call (CustomChannelActionToken).
  actions?: CustomChannelActionLinks | undefined;
  /*
   * A call to a person who reads another language: what it says in theirs.
   * `message` stays the English.
   */
  inLanguage?: CallAndSmsGatewayInLanguage | undefined;
}

export interface CallAndSmsGatewayTestInput {
  id: string;
  sentAt: Date;
}

const toActionsJson: (
  actions: CustomChannelActionLinks | undefined,
) => JSONObject | null = (
  actions: CustomChannelActionLinks | undefined,
): JSONObject | null => {
  if (!actions) {
    return null;
  }

  return {
    [CustomChannelAction.Acknowledge]: actions[CustomChannelAction.Acknowledge],
    [CustomChannelAction.Escalate]: actions[CustomChannelAction.Escalate],
    [CustomChannelAction.Resolve]: actions[CustomChannelAction.Resolve],
  };
};

// A message as a request carries it: held to what a request carries.
const fitMessage: (message: string | undefined) => string = (
  message: string | undefined,
): string => {
  return fitTextToLength(
    message || "",
    MAX_CALL_AND_SMS_GATEWAY_MESSAGE_LENGTH,
    TRUNCATED_TEXT_NOTE_PLAIN,
  );
};

/*
 * The call in its person's language, as a request carries it: null for
 * none, for a language with no code, and for words that say nothing.
 */
const toInLanguageJson: (
  inLanguage: CallAndSmsGatewayInLanguage | undefined,
) => JSONObject | null = (
  inLanguage: CallAndSmsGatewayInLanguage | undefined,
): JSONObject | null => {
  if (
    !inLanguage ||
    typeof inLanguage.language !== "string" ||
    !inLanguage.language.trim() ||
    typeof inLanguage.message !== "string" ||
    !inLanguage.message.trim()
  ) {
    return null;
  }

  return {
    language: inLanguage.language.trim(),
    message: fitMessage(inLanguage.message),
  };
};

// The body of a request that carries an SMS or a call.
export const buildCallAndSmsGatewayMessagePayload: (
  input: CallAndSmsGatewayMessageInput,
) => JSONObject = (input: CallAndSmsGatewayMessageInput): JSONObject => {
  return {
    version: CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION,
    event: input.event,
    id: input.id,
    sentAt: input.sentAt.toISOString(),
    to: input.to,
    message: fitMessage(input.message),
    isSensitive: input.isSensitive,
    project: input.project
      ? { id: input.project.id, name: input.project.name }
      : null,
    actions: toActionsJson(input.actions),
    // Last: fields are only ever added to the shape.
    inLanguage:
      input.event === CallAndSmsGatewayEvent.Call
        ? toInLanguageJson(input.inLanguage)
        : null,
  };
};

/*
 * The body of Send test: the same shape, to nobody, so a gateway can be
 * tried before a real SMS or call goes through it. It should answer 2xx
 * and send nothing.
 */
export const buildCallAndSmsGatewayTestPayload: (
  input: CallAndSmsGatewayTestInput,
) => JSONObject = (input: CallAndSmsGatewayTestInput): JSONObject => {
  return {
    version: CALL_AND_SMS_GATEWAY_PAYLOAD_VERSION,
    event: CallAndSmsGatewayEvent.Test,
    id: input.id,
    sentAt: input.sentAt.toISOString(),
    to: null,
    message:
      "This is a test of your SMS and call gateway from OneUptime. Answer 2xx and send nothing.",
    isSensitive: false,
    project: null,
    actions: null,
    inLanguage: null,
  };
};
