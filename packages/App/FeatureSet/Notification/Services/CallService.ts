import { getCallIdStatusMessage } from "Common/Types/OnCallDutyPolicy/OnCallSentLine";
import {
  CallDefaultCostInCentsPerMinute,
  CallHighRiskCostInCentsPerMinute,
  getCallAndSmsGateway,
  getTwilioConfig,
} from "../Config";
import CallAndSmsGatewayService, {
  CallAndSmsGatewayResult,
} from "./CallAndSmsGatewayService";
import { CallAndSmsGateway } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import {
  buildCallAndSmsGatewayMessagePayload,
  CallAndSmsGatewayEvent,
  CallAndSmsGatewayInLanguage,
} from "Common/Types/CallAndSMS/CallAndSmsGatewayPayload";
import CustomChannelActionToken from "Common/Server/Utils/OnCall/CustomChannelActionToken";
import CallRequest, {
  CallRequestMessage,
  GatherInput,
  Say,
  isHighRiskPhoneNumber,
} from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import TwilioPhoneNumbers from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import {
  Host,
  HttpProtocol,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectCallVoice from "Common/Types/Call/ProjectCallVoice";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import { recordSendResult } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import OnCallKeypadToken, {
  ON_CALL_KEYPAD_TOKEN_PARAM,
} from "Common/Server/Utils/OnCall/OnCallKeypadToken";
import { ON_CALL_PAGE_LINK_TOKEN_PARAM } from "Common/Server/Utils/OnCall/OnCallPageLinkToken";
import Dictionary from "Common/Types/Dictionary";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import ProjectNotificationChannelOwnerNotice from "Common/Server/Utils/ProjectNotificationChannelOwnerNotice";
import ProjectBalanceOwnerNotice from "Common/Server/Utils/ProjectBalanceOwnerNotice";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import SafeHtml from "Common/Types/SafeHtml";
import {
  getProjectBalanceMessageNotSentReason,
  getProjectBalanceShortfallSentence,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "Common/Utils/Project/NotificationChannels";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryProvider,
  NotificationDispatch,
  NotificationProviderConfig,
} from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import {
  getNoTwilioAccountMessage,
  TwilioMessageKind,
} from "Common/Utils/Project/TwilioAccount";
import TwilioSendError, { TwilioSendKind } from "../Utils/TwilioSendError";
import { withProviderConfig } from "../Utils/StatusCallbackProviderConfig";
import { withRetryOnServerError } from "../Utils/StatusCallbackRetry";
import {
  getVoicemailMessage,
  VOICEMAIL_MACHINE_DETECTION,
  VOICEMAIL_MESSAGE_CALL_DATA_KEY,
  VOICEMAIL_VOICE_CALL_DATA_KEY,
} from "../Utils/AnsweredBy";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import Twilio from "twilio";
import TwilioHttpClient from "../Utils/TwilioHttpClient";
import { CallInstance } from "twilio/lib/rest/api/v2010/account/call";
import Phone from "Common/Types/Phone";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import ServerSendingOutcomes from "Common/Server/Utils/ServerSending/ServerSendingOutcomes";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import {
  fitTextsToBudget,
  MAX_CALL_TWIML_LENGTH,
  TRUNCATED_TEXT_NOTE_PLAIN,
} from "Common/Utils/MessageFit";
import {
  SayRecordNumber,
  getSayRecordNumber,
  getSpeechParts,
  isSsmlVoice,
  renderSpeechAsText,
} from "Common/Utils/Call/CallSpeech";
import { SpokenCall, getSpokenCalls } from "Common/Utils/Call/CallLanguage";
import { getCallTranslator } from "Common/Server/Utils/ServerTranslation";
import {
  DEFAULT_READER_LANGUAGE,
  toReaderLanguage,
} from "Common/Types/ReaderLanguage";
import {
  CALL_KEYPAD_FINISH_ON_KEY,
  CALL_PROMPT_REPEATS,
  CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS,
  CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS,
} from "Common/Utils/Call/CallKeypad";
import {
  CallSpeechOptions,
  SayParent,
  sayInto,
} from "Common/Server/Utils/Call/CallTwimlSpeech";
import {
  SpokenCallVoice,
  getSpokenCallVoice,
  toCallVoiceValue,
  toSpokenCallVoiceValue,
} from "Common/Types/Call/CallVoice";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import NumberPrefixUtil, {
  NUMBER_PREFIX_COLUMNS,
} from "Common/Utils/Project/NumberPrefix";

/*
 * How often a call says its details and prompt again while no key is
 * pressed, and the pause before each time: the keypad route asks again
 * after a wrong key by the same rules (Common/Utils/Call/CallKeypad).
 */
export { CALL_PROMPT_REPEATS, CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS };

/*
 * How long a text is once Twilio's TwiML builder has escaped it: "&", "<"
 * and ">" as references, quotes as they are.
 */
const getTwimlTextLength: (text: string) => number = (text: string): number => {
  if (typeof text !== "string") {
    return 0;
  }

  let length: number = text.length;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code === 0x26) {
      length += 4; // &amp;
    } else if (code === 0x3c || code === 0x3e) {
      length += 3; // &lt; &gt;
    }
  }

  return length;
};

// generateTwimlForCall cuts a call's texts shorter at most this many times.
const MAX_TWIML_FIT_ATTEMPTS: number = 4;

/**
 * Extracts the main sayMessage values from a CallRequest's data array for call summary.
 * Excludes acknowledgment responses, error messages, and other system messages.
 * @param callRequest The call request containing data array with various objects
 * @returns A string containing main call content messages separated by newlines
 */
function extractSayMessagesFromCallRequest(callRequest: CallRequest): string {
  const sayMessages: string[] = [];

  if (callRequest.data && Array.isArray(callRequest.data)) {
    for (const item of callRequest.data) {
      // Check if the item is a Say object with sayMessage
      if ((item as Say).sayMessage) {
        sayMessages.push((item as Say).sayMessage);
      }
      // Check if the item is a GatherInput with introMessage
      if ((item as GatherInput).introMessage) {
        sayMessages.push((item as GatherInput).introMessage);
      }
      /*
       * NOTE: Excluding noInputMessage and onInputCallRequest messages from summary
       * as they contain system responses like "Good bye", "Invalid input", "You have acknowledged"
       * which should not be included in the call summary according to user requirements
       */
    }
  }

  return sayMessages.length > 0
    ? sayMessages.join(" ")
    : "No message content found";
}

/*
 * How a sentence ends: a full stop, a question mark, an exclamation mark - or
 * the "…" of a title cut for speech.
 */
const SENTENCE_END: RegExp = new RegExp("[.!?…]$");

/*
 * What a call says, for a gateway that makes it (CallAndSmsGatewayPayload):
 * its spoken sentences in order. The "press 1" a call asks for is left out -
 * it is Twilio's keypad, and the gateway offers the page's actions its own
 * way - as are the answers to a key press. Of a call request, its English
 * words; of one way of speaking it, those words.
 */
export function getCallGatewayMessage(
  callRequest: CallRequest | CallRequestMessage,
): string {
  const sentences: Array<string> = [];

  for (const item of callRequest.data || []) {
    const sayMessage: unknown = (item as Say).sayMessage;

    if (typeof sayMessage !== "string" || !sayMessage.trim()) {
      continue;
    }

    // Each a sentence of its own, ended as one.
    const sentence: string = sayMessage.trim();
    sentences.push(SENTENCE_END.test(sentence) ? sentence : `${sentence}.`);
  }

  return sentences.join(" ");
}

/*
 * What a call says in the language of the person it calls, for a gateway
 * that makes it (#11459): the language - as OneUptime names it, a BCP 47
 * tag - and the call's sentences in it, as getCallGatewayMessage says the
 * English ones. Every language the call carries words in, Persian among
 * them: the gateway picks its own voice, and may have one that Twilio has
 * not (Utils/Call/CallInLanguage). Undefined for a call in English only, a
 * language OneUptime does not write in, and words that say nothing: the
 * gateway then has the English alone, as it always had.
 */
export function getCallGatewayMessageInLanguage(
  callRequest: CallRequestMessage,
): CallAndSmsGatewayInLanguage | undefined {
  const inLanguage: CallRequestMessage["inLanguage"] = callRequest.inLanguage;

  if (
    !inLanguage ||
    typeof inLanguage !== "object" ||
    !Array.isArray(inLanguage.data) ||
    typeof inLanguage.language !== "string"
  ) {
    return undefined;
  }

  const language: string = toReaderLanguage(inLanguage.language);

  if (language === DEFAULT_READER_LANGUAGE) {
    return undefined;
  }

  const message: string = getCallGatewayMessage({ data: inLanguage.data });

  if (!message) {
    return undefined;
  }

  return { language: language, message: message };
}

/*
 * What a call said, as its voicemail message repeats it: its sentences in
 * order, as a voice says them - a record's number spelled out, "I N C 42",
 * which written ("INC-42") a voice reads "Incorporated 42". The keypad
 * prompt is left out, as for a gateway (getCallGatewayMessage).
 */
export function getCallVoicemailWords(
  // A call request, or the words alone of one way of speaking it (getSpokenCalls).
  callRequest: CallRequest | CallRequestMessage,
  // The project's own number prefixes (CallService.getRecordNumberPrefixes).
  recordNumberPrefixes: ReadonlyArray<string> = [],
  /*
   * The language the words are written in (#11066): "#42" is said in its
   * words - "Nummer 42". English's "number 42" without one.
   */
  language?: string | undefined,
): string {
  const sentences: Array<string> = [];
  const sayNumber: SayRecordNumber | undefined =
    language && language !== DEFAULT_READER_LANGUAGE
      ? getSayRecordNumber(getCallTranslator(language))
      : undefined;

  for (const item of callRequest.data || []) {
    if (typeof (item as Say).sayMessage !== "string") {
      continue;
    }

    const sentence: string = renderSpeechAsText(
      getSpeechParts(item as Say, recordNumberPrefixes, sayNumber),
    ).trim();

    if (sentence) {
      sentences.push(SENTENCE_END.test(sentence) ? sentence : `${sentence}.`);
    }
  }

  return sentences.join(" ");
}

/*
 * The ways one version of a call's TwiML is built, the first that builds:
 * in its voice, its record numbers in SSML where the voice reads it; in its
 * voice, its record numbers in spaced letters; and - for English, which the
 * account's default voice speaks - in that default voice, as every call was
 * before voices could be chosen. A voice never stops a call from being
 * placed (#10948): a call in another language that cannot be built in its
 * voice is built in English (getSpokenCalls), never in the default voice,
 * which would read its words as English (#11066).
 */
const getSpeechAttempts: (
  spoken: SpokenCall,
  recordNumberPrefixes: ReadonlyArray<string>,
) => Array<CallSpeechOptions> = (
  spoken: SpokenCall,
  recordNumberPrefixes: ReadonlyArray<string>,
): Array<CallSpeechOptions> => {
  const attempts: Array<CallSpeechOptions> = [];
  const voice: string | undefined = toSpokenCallVoiceValue(spoken.voice);
  const isEnglish: boolean = spoken.language === DEFAULT_READER_LANGUAGE;

  // "#42" in the words' own language: "number 42", "Nummer 42".
  const sayNumber: CallSpeechOptions["sayNumber"] = isEnglish
    ? undefined
    : getSayRecordNumber(getCallTranslator(spoken.language));

  if (voice && isSsmlVoice(voice)) {
    attempts.push({
      voice: voice,
      recordNumberPrefixes: recordNumberPrefixes,
      isSsmlAllowed: true,
      sayNumber: sayNumber,
    });
  }

  if (voice) {
    attempts.push({
      voice: voice,
      recordNumberPrefixes: recordNumberPrefixes,
      isSsmlAllowed: false,
      sayNumber: sayNumber,
    });
  }

  if (isEnglish) {
    attempts.push({
      voice: undefined,
      recordNumberPrefixes: recordNumberPrefixes,
      isSsmlAllowed: false,
    });
  }

  return attempts;
};

// A call's TwiML, and which of its words it speaks in which voice.
export interface SpokenCallTwiml {
  twiml: string;
  spoken: SpokenCall;
}

export interface GenerateTwimlOptions {
  /*
   * The on-call notification the call is placed for: its keypad token
   * names it (OnCallKeypadToken), and the keypad route takes a key only
   * for that notification.
   */
  userOnCallLogTimelineId?: ObjectID | string | undefined;
  /*
   * The voice the account the call goes out on chose, from OneUptime's
   * list (Types/Call/CallVoice): "Polly.Joanna-Neural", say. None - or one
   * the list does not hold - is the Twilio account's default voice, which
   * may read no SSML (Utils/Call/CallSpeech) and speaks English only. A
   * call in its person's language speaks with that language's voice of
   * the same kind (getSpokenCalls).
   */
  voice?: string | undefined;
  /*
   * The project's own number prefixes ("INC-", "#"): a number written
   * with one is spelled wherever the call says it, a title or an
   * owner's message included (getRecordNumberPrefixes).
   */
  recordNumberPrefixes?: ReadonlyArray<string> | undefined;
}

export default class CallService {
  public static async makeCall(
    callRequest: CallRequest,
    options: {
      projectId?: ObjectID | undefined; // project id for sms log
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID | undefined; // user notification log timeline id
      customTwilioConfig?: TwilioConfig | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      // On-call policy related fields
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
      /*
       * Throw when the call is deliberately not placed - the project was
       * not found, has call notifications turned off, or has too little
       * balance - instead of returning as if it was, as SmsService does for
       * an SMS. The call log and the owners' email are written either way.
       * Send Test Call passes it, so a test that was not placed says why;
       * everyone else keeps the quiet return.
       */
      failIfNotSent?: boolean | undefined;
    },
  ): Promise<void> {
    // How it went, for the platform's operator (NotificationDeliveryMetrics).
    await NotificationDeliveryMetrics.measureDispatch(
      {
        channel: NotificationDeliveryChannel.Call,
        isOnCallPage: Boolean(options.userOnCallLogTimelineId),
      },
      async (dispatch: NotificationDispatch): Promise<void> => {
        const notPlacedReason: string | null = await this.makeCallInternal(
          // The installation's own name in what the call says, when it goes by one.
          ProductBrandingText.brandCallRequest(callRequest),
          options,
          dispatch,
        );

        if (notPlacedReason !== null) {
          dispatch.markNotSent();
        }

        if (notPlacedReason !== null && options.failIfNotSent) {
          // The tenant's settings or balance, not a defect: a user error.
          throw new BadDataException(
            `Call not placed: ${notPlacedReason}`,
          ).asUserError();
        }
      },
    );
  }

  private static async makeCallInternal(
    callRequest: CallRequest,
    options: {
      projectId?: ObjectID | undefined; // project id for sms log
      isSensitive?: boolean; // if true, message will not be logged
      userOnCallLogTimelineId?: ObjectID | undefined; // user notification log timeline id
      customTwilioConfig?: TwilioConfig | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      monitorId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      // On-call policy related fields
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
      failIfNotSent?: boolean | undefined;
    },
    dispatch: NotificationDispatch,
  ): Promise<string | null> {
    /*
     * Returns why the call was deliberately not placed (the project was not
     * found, has calls turned off, or has too little balance), after logging
     * it; null when it was handed to Twilio. A failure to place it throws.
     * `dispatch` is told what it goes out through, and that it went.
     */
    let callError: Error | null = null;
    const callLog: CallLog = new CallLog();
    /*
     * Whether it goes out through the server's own gateway or Twilio
     * account, and whether it was handed to one: how that went is the
     * server's to know (ServerSendingStatus). A project's own account, and
     * a call the project's balance or switch held back, are not.
     */
    let isServersOwnCall: boolean = false;
    let hasReachedProvider: boolean = false;

    try {
      logger.debug("Call Request received.");

      /*
       * The config the caller handed over - the project's default - when it
       * makes calls. One used for SMS only makes none
       * (TwilioPhoneNumbers.canSend, Types/CallAndSMS/TwilioConfigUse): this
       * call then goes as it would without it, through the server's own
       * account, and is paid for as such.
       */
      const customTwilioConfig: TwilioConfig | undefined =
        TwilioPhoneNumbers.canSend(
          options.customTwilioConfig,
          TwilioMessageKind.Call,
        )
          ? options.customTwilioConfig
          : undefined;

      isServersOwnCall = !customTwilioConfig;

      // is no custom twilio config is provided, use default twilio config and charge for call.
      const shouldChargeForCall: boolean =
        IsBillingEnabled && !customTwilioConfig;

      // What a minute costs, in whole cents.
      const callCostInUSDCents: number = shouldChargeForCall
        ? MessagingBalance.getCostInUSDCents({
            costPerPartInUSDCents: isHighRiskPhoneNumber(callRequest.to)
              ? CallHighRiskCostInCentsPerMinute
              : CallDefaultCostInCentsPerMinute,
          })
        : 0;

      logger.debug("Call Cost (cents): " + callCostInUSDCents);

      /*
       * What the call goes out through: the config the caller handed over;
       * else, when the server sends its SMS and calls through its own
       * gateway (CallAndSmsProvider), that gateway; else the server's own
       * Twilio account. A server that sends through its gateway makes no
       * call through Twilio.
       */
      const gateway: CallAndSmsGateway | null = customTwilioConfig
        ? null
        : await getCallAndSmsGateway();

      const twilioConfig: TwilioConfig | null = gateway
        ? null
        : customTwilioConfig || (await getTwilioConfig(TwilioMessageKind.Call));

      if (gateway) {
        dispatch.setProvider(NotificationDeliveryProvider.SmsAndCallGateway);
      } else if (twilioConfig) {
        dispatch.setProvider(
          NotificationDeliveryProvider.Twilio,
          customTwilioConfig
            ? NotificationProviderConfig.Project
            : NotificationProviderConfig.Global,
        );
      }

      if (!gateway && !twilioConfig) {
        /*
         * Nobody has filled in Twilio credentials in Global Settings (or the
         * caller passed a project-level config that is empty, or one used
         * for SMS only). Failing to place the call is the correct behaviour,
         * not a defect. The log, and anyone waiting on this call, are told
         * what is missing and who can add it - and, when the project's own
         * config is used for SMS only, that it is
         * (Utils/Project/TwilioAccount) - not "Twilio Config not found".
         */
        throw new BadDataException(
          getNoTwilioAccountMessage(TwilioMessageKind.Call, {
            projectConfigUse: options.customTwilioConfig?.use,
          }),
        ).asUserError();
      }

      // Through the outbound proxy, as every request of the server (#10721).
      const client: Twilio.Twilio | null = twilioConfig
        ? Twilio(twilioConfig.accountSid, twilioConfig.authToken, {
            httpClient: TwilioHttpClient.create(),
          })
        : null;

      callLog.toNumber = callRequest.to;

      /*
       * One of the numbers the config makes calls from, never an SMS one. A
       * gateway calls from whatever number it calls from, which OneUptime
       * is not told.
       */
      const fromNumber: Phone | null = twilioConfig
        ? TwilioPhoneNumbers.pickSenderNumber({
            config: twilioConfig,
            kind: TwilioMessageKind.Call,
            to: callRequest.to,
          })
        : null;

      if (fromNumber) {
        callLog.fromNumber = fromNumber;
      }
      callLog.callData =
        options && options.isSensitive
          ? ({ message: "This call is sensitive and is not logged" } as any)
          : ({
              message: extractSayMessagesFromCallRequest(callRequest),
            } as any);
      callLog.callCostInUSDCents = 0;

      if (options.projectId) {
        callLog.projectId = options.projectId;
      }

      if (options.incidentId) {
        callLog.incidentId = options.incidentId;
      }

      if (options.alertId) {
        callLog.alertId = options.alertId;
      }

      if (options.monitorId) {
        callLog.monitorId = options.monitorId;
      }

      if (options.scheduledMaintenanceId) {
        callLog.scheduledMaintenanceId = options.scheduledMaintenanceId;
      }

      if (options.statusPageId) {
        callLog.statusPageId = options.statusPageId;
      }

      if (options.statusPageAnnouncementId) {
        callLog.statusPageAnnouncementId = options.statusPageAnnouncementId;
      }

      if (options.userId) {
        callLog.userId = options.userId;
      }

      if (options.teamId) {
        callLog.teamId = options.teamId;
      }

      /*
       * The on-call notification this call is made for: how the call ends -
       * answered, not answered, busy, failed - is written back onto it
       * (API/Call.ts's status callback).
       */
      if (options.userOnCallLogTimelineId) {
        callLog.userOnCallLogTimelineId = options.userOnCallLogTimelineId;
      }

      // Set OnCall-related fields
      if (options.onCallPolicyId) {
        callLog.onCallDutyPolicyId = options.onCallPolicyId;
      }

      if (options.onCallPolicyEscalationRuleId) {
        callLog.onCallDutyPolicyEscalationRuleId =
          options.onCallPolicyEscalationRuleId;
      }

      if (options.onCallScheduleId) {
        callLog.onCallDutyPolicyScheduleId = options.onCallScheduleId;
      }

      let project: Project | null = null;

      // make sure project has enough balance.

      if (options.projectId) {
        project = await ProjectService.findOneById({
          id: options.projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
            enableCallNotifications: true,
            lowCallAndSMSBalanceNotificationSentToOwners: true,
            name: true,
            notEnabledSmsOrCallNotificationSentToOwners: true,
            // Whether an on-call call asks who answered it (#6594).
            detectVoicemailOnCalls: true,
            // The voice it chose for calls through the server's account (#11065).
            callVoice: true,
            /*
             * Its record number prefixes: a number written with one is
             * spelled, wherever a call says it (getRecordNumberPrefixes).
             */
            incidentNumberPrefix: true,
            incidentEpisodeNumberPrefix: true,
            alertNumberPrefix: true,
            alertEpisodeNumberPrefix: true,
            scheduledMaintenanceNumberPrefix: true,
            securityCaseNumberPrefix: true,
          },
          props: {
            isRoot: true,
          },
        });

        logger.debug("Project found.");

        if (!project) {
          callLog.status = CallStatus.Error;
          callLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
          logger.error(callLog.statusMessage);
          await CallLogService.create({
            data: callLog,
            props: {
              isRoot: true,
            },
          });
          await UserOnCallLogTimelineService.markNotSent({
            userOnCallLogTimelineId: options.userOnCallLogTimelineId,
            reason: callLog.statusMessage!,
          });
          return callLog.statusMessage!;
        }

        if (!project.enableCallNotifications) {
          callLog.status = CallStatus.Error;
          callLog.statusMessage = getProjectNotificationChannelOffMessage(
            ProjectNotificationChannel.Call,
          );
          // The project turned calls off. Refusing to dial is the setting working.
          logger.error(callLog.statusMessage, EXTERNAL_FAULT);
          await CallLogService.create({
            data: callLog,
            props: {
              isRoot: true,
            },
          });

          if (!project.notEnabledSmsOrCallNotificationSentToOwners) {
            await ProjectService.updateOneById({
              data: {
                notEnabledSmsOrCallNotificationSentToOwners: true,
              },
              id: project.id!,
              props: {
                isRoot: true,
              },
            });
            await ProjectService.sendEmailToProjectOwners(
              project.id!,
              "Call notifications not enabled for " + (project.name || ""),
              `We tried to make a call to ${callRequest.to.toString()}. <br/> <br/> This call was not made. ${ProjectNotificationChannelOwnerNotice.getHtml(
                {
                  channel: ProjectNotificationChannel.Call,
                  projectId: project.id!,
                },
              )}`,
            );
          }
          await UserOnCallLogTimelineService.markNotSent({
            userOnCallLogTimelineId: options.userOnCallLogTimelineId,
            reason: callLog.statusMessage!,
          });
          return callLog.statusMessage!;
        }

        if (shouldChargeForCall) {
          // check if auto recharge is enabled and current balance is low.
          let updatedBalance: number =
            project.smsOrCallCurrentBalanceInUSDCents!;
          try {
            updatedBalance = await NotificationService.rechargeIfBalanceIsLow(
              project.id!,
            );
          } catch (err) {
            logger.error(err);
          }

          project.smsOrCallCurrentBalanceInUSDCents = updatedBalance;

          /*
           * Nothing left, or less than this call costs. The log (which the
           * project's members read, as they read a person's on-call
           * timeline) says who can add balance and where; the owners, who
           * may, are told to, with a link - once, until the balance is
           * topped up again (Utils/Project/ProjectBalance).
           */
          const balanceInUSDCents: number =
            project.smsOrCallCurrentBalanceInUSDCents || 0;

          if (!balanceInUSDCents || balanceInUSDCents < callCostInUSDCents) {
            const shortfall: {
              channel: ProjectNotificationChannel;
              balanceInUSDCents: number;
              costInUSDCents: number;
            } = {
              channel: ProjectNotificationChannel.Call,
              balanceInUSDCents: balanceInUSDCents,
              costInUSDCents: callCostInUSDCents,
            };

            callLog.status = CallStatus.LowBalance;
            callLog.statusMessage =
              getProjectBalanceMessageNotSentReason(shortfall);
            // Tenant billing state, not a defect — the owners get emailed below.
            logger.error(callLog.statusMessage, EXTERNAL_FAULT);
            await CallLogService.create({
              data: callLog,
              props: {
                isRoot: true,
              },
            });

            // Once each time it runs out, whatever else finds it out too.
            if (
              await MessagingBalance.shouldTellOwnersBalanceIsLow({
                projectId: project.id!,
                alreadyTold:
                  project.lowCallAndSMSBalanceNotificationSentToOwners,
              })
            ) {
              await ProjectService.sendEmailToProjectOwners(
                project.id!,
                "Low SMS and Call Balance for " + (project.name || ""),
                `We tried to make a call to ${callRequest.to.toString()}. <br/> <br/> This call was not made. ${SafeHtml.escape(
                  getProjectBalanceShortfallSentence(shortfall),
                )} ${ProjectBalanceOwnerNotice.getHtml({
                  balance: ProjectBalanceType.SmsOrCall,
                  projectId: project.id!,
                })}`,
              );
            }
            await UserOnCallLogTimelineService.markNotSent({
              userOnCallLogTimelineId: options.userOnCallLogTimelineId,
              reason: callLog.statusMessage!,
            });
            return callLog.statusMessage!;
          }
        }
      }

      logger.debug("Sending Call Request.");

      // Twilio's answer, which says how long the call took; a gateway's does not.
      let twillioCall: CallInstance | null = null;

      if (gateway) {
        /*
         * The gateway is told what the call says, and - for an on-call
         * page - given the links that act on it (CustomChannelActionToken),
         * which it can offer as key presses of its own. What it says is in
         * English, as every gateway has read it, and - for a person who
         * reads another language - in theirs too, with the language's code,
         * for a gateway with a voice of it to speak instead (#11459).
         */
        const payload: ReturnType<typeof buildCallAndSmsGatewayMessagePayload> =
          buildCallAndSmsGatewayMessagePayload({
            event: CallAndSmsGatewayEvent.Call,
            id: ObjectID.generate().toString(),
            sentAt: OneUptimeDate.getCurrentDate(),
            to: callRequest.to.toString(),
            message: getCallGatewayMessage(callRequest),
            isSensitive: Boolean(options.isSensitive),
            project:
              project && project.id
                ? { id: project.id.toString(), name: project.name || "" }
                : undefined,
            actions: options.userOnCallLogTimelineId
              ? await CustomChannelActionToken.getActionLinks(
                  options.userOnCallLogTimelineId,
                )
              : undefined,
            inLanguage: getCallGatewayMessageInLanguage(callRequest),
          });

        // Handed to the gateway from here on.
        hasReachedProvider = true;

        const result: CallAndSmsGatewayResult =
          await CallAndSmsGatewayService.send({
            gateway: gateway,
            event: CallAndSmsGatewayEvent.Call,
            payload: payload,
          });

        if (!result.ok) {
          // The installation's own gateway refused it, or was not reached.
          throw new BadDataException(result.message).asUserError();
        }

        dispatch.markSucceeded();

        // The server's own call went out (ServerSendingStatus).
        await ServerSendingOutcomes.recordSucceeded(ServerSendingChannel.Call);

        callLog.status = CallStatus.Success;
        callLog.statusMessage = result.message;
      } else {
        if (!client || !fromNumber) {
          // Not reached: a call with no gateway was refused above without an account.
          throw new BadDataException(
            getNoTwilioAccountMessage(TwilioMessageKind.Call, {
              projectConfigUse: options.customTwilioConfig?.use,
            }),
          ).asUserError();
        }

        /*
         * How the call ends - answered, not answered, busy, failed - Twilio
         * tells this call's own status callback (API/Call.ts) once it does,
         * for a project's call, whose log is kept, from a server Twilio can
         * reach (HOST). Its address says whose Twilio account the call is
         * made on, for the delivery metrics (StatusCallbackProviderConfig).
         */
        const providerConfig: NotificationProviderConfig = customTwilioConfig
          ? NotificationProviderConfig.Project
          : NotificationProviderConfig.Global;

        const statusCallbackUrl: string | null = options.projectId
          ? this.prepareStatusCallback(callLog, providerConfig)
          : null;

        /*
         * Who answered it - a person, or voicemail - Twilio tells this
         * call's answering machine callback (API/Call.ts), for an on-call
         * page of a project that detects voicemail, whose outcome Twilio can
         * report (#6594): a call voicemail answers then counts as not
         * answered, and leaves the message kept here once the greeting
         * ends. Asked in the background, so a person who picks up hears the
         * page at once; DetectMessageEnd reports a voicemail at the end of
         * its greeting, where a message left is the one it records.
         */
        const voicemailCallbackUrl: string | null =
          statusCallbackUrl &&
          this.shouldDetectVoicemail({
            userOnCallLogTimelineId: options.userOnCallLogTimelineId,
            project: project,
          })
            ? this.getVoicemailCallbackUrl(callLog, providerConfig)
            : null;

        // The project's own number prefixes, which the call spells.
        const recordNumberPrefixes: Array<string> =
          this.getRecordNumberPrefixes(project);

        /*
         * The voice chosen for the Twilio account the call goes out on -
         * the project's own config, or the server's (#10948) - or, through
         * the server's account, the project's own voice while the server
         * lets projects choose one (#11065, getServerAccountCallVoice); or
         * none, the account's default voice, as every call was before
         * voices could be chosen.
         */
        const accountVoice: string | undefined = customTwilioConfig
          ? toCallVoiceValue(twilioConfig?.callVoice)
          : await this.getServerAccountCallVoice({
              serverVoice: twilioConfig?.callVoice,
              project: project,
            });

        /*
         * The call's TwiML: in its person's language, by a voice of that
         * language of the kind the account chose, when the call carries its
         * words in one and the account chose a voice - else in English, as
         * every call was (#11066, getSpokenCalls). A key the person presses
         * is taken only for the notification this call is placed for
         * (OnCallKeypadToken).
         */
        const built: SpokenCallTwiml = this.generateSpokenTwimlForCall(
          callRequest,
          {
            userOnCallLogTimelineId: options.userOnCallLogTimelineId,
            recordNumberPrefixes: recordNumberPrefixes,
            voice: accountVoice,
          },
        );
        const twiml: string = built.twiml;
        const voice: string | undefined = built.spoken.voice;

        // The call's log says what the call says: in the language it speaks.
        if (!options.isSensitive && built.spoken.data !== callRequest.data) {
          callLog.callData = {
            ...((callLog.callData as unknown as Record<string, unknown>) || {}),
            message: extractSayMessagesFromCallRequest({
              ...callRequest,
              data: built.spoken.data,
            }),
          } as any;
        }

        if (voicemailCallbackUrl) {
          callLog.callData = {
            ...((callLog.callData as unknown as Record<string, unknown>) || {}),
            ...(options.isSensitive
              ? {}
              : {
                  /*
                   * What the call said and what to do, in the words and
                   * the language the call spoke (#11066).
                   */
                  [VOICEMAIL_MESSAGE_CALL_DATA_KEY]:
                    ProductBrandingText.brandText(
                      getVoicemailMessage(
                        getCallVoicemailWords(
                          { data: built.spoken.data },
                          recordNumberPrefixes,
                          built.spoken.language,
                        ),
                        built.spoken.language,
                      ),
                    ),
                }),
            // The message left on voicemail is said in the call's voice.
            ...(voice ? { [VOICEMAIL_VOICE_CALL_DATA_KEY]: voice } : {}),
          } as any;
        }

        // Handed to Twilio from here on.
        hasReachedProvider = true;

        twillioCall = await client.calls.create({
          twiml: twiml,
          to: callRequest.to.toString(),
          from: fromNumber.toString(), // From a valid Twilio number
          ...(statusCallbackUrl
            ? {
                statusCallback: statusCallbackUrl,
                statusCallbackEvent: ["completed"],
                statusCallbackMethod: "POST",
              }
            : {}),
          ...(voicemailCallbackUrl
            ? {
                machineDetection: VOICEMAIL_MACHINE_DETECTION,
                asyncAmd: "true",
                asyncAmdStatusCallback: voicemailCallbackUrl,
                asyncAmdStatusCallbackMethod: "POST",
              }
            : {}),
        });

        dispatch.markSucceeded();

        // The server's own Twilio account took it (ServerSendingStatus).
        if (isServersOwnCall) {
          await ServerSendingOutcomes.recordSucceeded(
            ServerSendingChannel.Call,
          );
        }

        /*
         * Placed, and still ringing: Calling, until its status callback
         * says how it ended (#11138) - Success once it is answered, or Missed
         * Call, Busy, Voicemail, Error. A call Twilio cannot tell the end
         * of - this server has no public host to be called back on - is
         * Success already: nothing will move it on.
         */
        callLog.status = statusCallbackUrl
          ? CallStatus.Calling
          : CallStatus.Success;
        callLog.statusMessage = getCallIdStatusMessage(twillioCall.sid);

        logger.debug("Call ID: " + twillioCall.sid);
      }

      logger.debug("Call Request sent successfully.");
      logger.debug(callLog.statusMessage);

      if (shouldChargeForCall && project) {
        logger.debug("Updating Project Balance.");

        callLog.callCostInUSDCents = callCostInUSDCents;

        if (twillioCall && parseInt(twillioCall.duration) > 60) {
          callLog.callCostInUSDCents = Math.ceil(
            Math.ceil(parseInt(twillioCall.duration) / 60) * callCostInUSDCents,
          );
        }

        logger.debug("Call Cost: " + callLog.callCostInUSDCents);

        // Paid in one statement, from whatever the balance is now.
        const balanceInUSDCents: number | null =
          await MessagingBalance.payForSentMessage({
            projectId: project.id!,
            channel: ProjectNotificationChannel.Call,
            costInUSDCents: callLog.callCostInUSDCents,
          });

        logger.debug("Project's current balance updated.");
        logger.debug("Current Balance: " + balanceInUSDCents);
      }
    } catch (e: any) {
      callLog.callCostInUSDCents = 0;
      callLog.status = CallStatus.Error;
      callLog.statusMessage =
        e && e.message ? e.message.toString() : e.toString();

      logger.error("Call Request failed.");
      logger.error(callLog.statusMessage);

      // The server's own gateway or Twilio account refused it, or was not reached.
      if (hasReachedProvider && isServersOwnCall) {
        await ServerSendingOutcomes.recordFailed(
          ServerSendingChannel.Call,
          callLog.statusMessage,
        );
      }

      // Twilio's refusal keeps its words on the way out (TwilioSendError).
      callError = TwilioSendError.toSendError(e, TwilioSendKind.Call) as Error;
    }

    logger.debug("Saving Call Log if project id is provided.");

    if (options.projectId) {
      logger.debug("Saving Call Log.");
      await CallLogService.create({
        data: callLog,
        props: {
          isRoot: true,
        },
      });
      logger.debug("Call Log saved.");
    } else {
      logger.debug("Project Id is not provided. Call Log not saved.");
    }

    if (options.userOnCallLogTimelineId) {
      /*
       * Placed is "Sent" - Calling, or Success where nothing will say how
       * it ended: how the call ended comes later, by its status callback.
       * Written only while the page's timeline entry still says Sending
       * (OnCallNotificationStatus): a call not answered or failed that the
       * callback - which can land first - wrote there, or the person's
       * acknowledgement, stays.
       */
      await recordSendResult({
        userOnCallLogTimelineId: options.userOnCallLogTimelineId,
        isSent:
          callLog.status === CallStatus.Calling ||
          callLog.status === CallStatus.Success,
        statusMessage: callLog.statusMessage!,
      });
    }

    if (callError) {
      throw callError;
    }

    return null;
  }

  /*
   * The URL Twilio tells how a call ended at - its status callback - or
   * null when this server has no public host to be called back on. The
   * call's log is given its id now, as it is written only once the call is
   * placed, and an unguessable token the URL carries: the callback is a
   * public webhook, and the token is what says it is Twilio's (the same as
   * an SMS's delivery status, SmsService). Nginx serves the external
   * /notification path from /api/notification, where the call router is.
   * A call made on a project's own Twilio account says so in the URL's
   * query, for the delivery metrics (StatusCallbackProviderConfig), and the
   * URL asks Twilio to send the callback again when this server could not
   * take it (StatusCallbackRetry).
   */
  public static prepareStatusCallback(
    callLog: CallLog,
    providerConfig: NotificationProviderConfig = NotificationProviderConfig.Global,
  ): string | null {
    if (!Host) {
      return null;
    }

    if (!callLog.id) {
      callLog.id = ObjectID.generate();
    }

    callLog.statusCallbackToken = ObjectID.generate().toString();

    return withRetryOnServerError(
      withProviderConfig(
        `${HttpProtocol}${Host}/notification/call/status-callback/${callLog.id!.toString()}/${callLog.statusCallbackToken}`,
        providerConfig,
      ),
    );
  }

  /*
   * The number prefixes a call spells: the project's own, one for each kind
   * of numbered record it has (NumberPrefix) - "INC-", "ALT-" - and "#", the
   * prefix of a number without one, so "INC-42" anywhere in a call is "I N C
   * 42" and "#42" is "number 42" (#10762). Without a project, none.
   */
  public static getRecordNumberPrefixes(
    project: Project | null | undefined,
  ): Array<string> {
    if (!project) {
      return [];
    }

    const prefixes: Array<string> = [NumberPrefixUtil.DEFAULT_PREFIX];

    for (const info of NUMBER_PREFIX_COLUMNS) {
      const prefix: unknown = (project as unknown as Record<string, unknown>)[
        info.column
      ];

      if (typeof prefix === "string" && prefix.trim()) {
        prefixes.push(prefix.trim());
      }
    }

    return Array.from(new Set(prefixes));
  }

  /*
   * Whether a call asks Twilio who answered it (#6594): an on-call page -
   * a call made for a person's on-call notification, a test page's among
   * them - of a project that detects voicemail, as every project does until
   * it is switched off (Project.detectVoicemailOnCalls; empty reads as on).
   * Any other call - a verification code, Send Test Call, an incoming call
   * policy's - is placed as it always was.
   */
  /*
   * The voice a call through the server's own Twilio account speaks with
   * (#11065, Types/Call/ProjectCallVoice): the project's own, while the
   * server lets projects choose one - its master admin's switch
   * (GlobalConfig.letProjectsChooseCallVoice), or GLOBAL_TWILIO_LET_
   * PROJECTS_CHOOSE_CALL_VOICE once it is set (#11462,
   * GlobalConfigService.canProjectsChooseCallVoice) - never on OneUptime
   * Cloud, whose account OneUptime pays for; else the server's
   * (GLOBAL_TWILIO_CALL_VOICE, or the one chosen in the Admin Dashboard).
   * The switch is read only for a project that chose a voice. A voice never
   * stops a call: should the switch not be read, the call speaks with the
   * server's voice, as it would with the switch off.
   */
  public static async getServerAccountCallVoice(data: {
    serverVoice: unknown;
    project: { callVoice?: string | null | undefined } | null | undefined;
  }): Promise<string | undefined> {
    const projectVoice: string | undefined = toCallVoiceValue(
      data.project?.callVoice,
    );

    if (!projectVoice || IsBillingEnabled) {
      return toCallVoiceValue(data.serverVoice);
    }

    let areOffered: boolean = false;

    try {
      areOffered = await GlobalConfigService.canProjectsChooseCallVoice();
    } catch (err) {
      logger.error(err);
    }

    return ProjectCallVoice.getVoiceOnServerAccount({
      serverVoice: data.serverVoice,
      projectVoice: projectVoice,
      areOffered: areOffered,
    });
  }

  public static shouldDetectVoicemail(data: {
    userOnCallLogTimelineId?: ObjectID | undefined;
    // The project's row as read: its switch, or none - a row from before it.
    project:
      | { detectVoicemailOnCalls?: boolean | null | undefined }
      | null
      | undefined;
  }): boolean {
    return Boolean(
      data.userOnCallLogTimelineId &&
        data.project &&
        data.project.detectVoicemailOnCalls !== false,
    );
  }

  /*
   * The URL Twilio tells who answered a call at - its answering machine
   * callback (API/Call.ts) - next to its status callback: the same log, the
   * same token, which prepareStatusCallback gave it, the same note of whose
   * account the call is on, and the same ask to send it again when this
   * server could not take it. Twilio signs the request too, which the route
   * checks.
   */
  public static getVoicemailCallbackUrl(
    callLog: CallLog,
    providerConfig: NotificationProviderConfig = NotificationProviderConfig.Global,
  ): string | null {
    if (!Host || !callLog.id || !callLog.statusCallbackToken) {
      return null;
    }

    return withRetryOnServerError(
      withProviderConfig(
        `${HttpProtocol}${Host}/notification/call/amd-callback/${callLog.id.toString()}/${callLog.statusCallbackToken}`,
        providerConfig,
      ),
    );
  }

  /*
   * The TwiML a call is turned to once voicemail has answered it and its
   * greeting ended: the message, which the voicemail records, then the
   * call ends - in the voice the call spoke with. Cut to fit as any call's
   * TwiML is (generateTwimlForCall).
   */
  public static generateVoicemailTwiml(
    message: string,
    options?: {
      /*
       * The voice the call was placed with (VOICEMAIL_VOICE_CALL_DATA_KEY):
       * one of another language for a call in its person's language
       * (#11066), whose message is in that language too.
       */
      voice?: string | undefined;
    },
  ): string {
    const voice: SpokenCallVoice | null = getSpokenCallVoice(options?.voice);

    return this.buildFirstSpokenTwiml(
      [
        {
          data: [{ sayMessage: message }],
          voice: voice?.value,
          language: voice?.readerLanguage || DEFAULT_READER_LANGUAGE,
        },
      ],
      {},
    ).twiml;
  }

  /*
   * The TwiML a call is made with. Twilio refuses TwiML of more than
   * MAX_CALL_TWIML_LENGTH characters, and the call is not made: a call whose
   * spoken texts make it longer - a template that placed a description -
   * has them cut, the longest first and all to about the same length, each
   * ending with a note that the rest is in OneUptime (fitTextsToBudget). The
   * TwiML is built again and measured, and the texts cut shorter while it is
   * still over. A call that fits is made whole.
   *
   * In the person's language by a voice of it, when the call carries its
   * words in one and the account chose a voice with one of its kind there
   * (#11066, getSpokenCalls); else in English, in the voice chosen for the
   * account (#10948). Should its SSML, or the voice itself, ever fail to
   * build, it is built in spaced letters, then in English, and English in
   * the account's default voice at last (getSpeechAttempts): a voice never
   * stops a page from being placed.
   */
  public static generateTwimlForCall(
    callRequest: CallRequestMessage,
    options?: GenerateTwimlOptions,
  ): string {
    return this.generateSpokenTwimlForCall(callRequest, options).twiml;
  }

  // The same, with which of the call's words it speaks in which voice.
  public static generateSpokenTwimlForCall(
    callRequest: CallRequestMessage,
    options?: GenerateTwimlOptions,
  ): SpokenCallTwiml {
    return this.buildFirstSpokenTwiml(
      getSpokenCalls(callRequest, options?.voice),
      {
        userOnCallLogTimelineId: options?.userOnCallLogTimelineId,
        recordNumberPrefixes: options?.recordNumberPrefixes,
      },
    );
  }

  /*
   * The TwiML of the first way of speaking a call that builds: each version
   * of its words in turn (getSpokenCalls), each in its ways of speaking
   * (getSpeechAttempts). The last way is the one every call was built with,
   * English in the account's default voice: its error is the call's.
   */
  private static buildFirstSpokenTwiml(
    versions: Array<SpokenCall>,
    options: {
      userOnCallLogTimelineId?: ObjectID | string | undefined;
      recordNumberPrefixes?: ReadonlyArray<string> | undefined;
    },
  ): SpokenCallTwiml {
    const attempts: Array<{ spoken: SpokenCall; speech: CallSpeechOptions }> =
      versions.flatMap(
        (
          spoken: SpokenCall,
        ): Array<{ spoken: SpokenCall; speech: CallSpeechOptions }> => {
          return getSpeechAttempts(
            spoken,
            options.recordNumberPrefixes || [],
          ).map((speech: CallSpeechOptions) => {
            return { spoken: spoken, speech: speech };
          });
        },
      );

    for (let index: number = 0; index < attempts.length; index++) {
      const attempt: { spoken: SpokenCall; speech: CallSpeechOptions } =
        attempts[index]!;

      try {
        return {
          twiml: this.generateFittedTwiml(
            { data: attempt.spoken.data },
            attempt.speech,
            {
              userOnCallLogTimelineId: options.userOnCallLogTimelineId,
            },
          ),
          spoken: attempt.spoken,
        };
      } catch (error) {
        if (index === attempts.length - 1) {
          throw error;
        }

        const next: { spoken: SpokenCall; speech: CallSpeechOptions } =
          attempts[index + 1]!;

        logger.warn(
          `A call's TwiML could not be built in ${
            attempt.speech.voice || "the account's default voice"
          }${attempt.speech.isSsmlAllowed ? " with SSML" : ""}, so it is built ${
            next.spoken !== attempt.spoken
              ? "in English instead"
              : next.speech.voice
                ? "with spaced letters instead"
                : "in the account's default voice instead"
          }: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Not reached: the last attempt returns or throws.
    throw new BadDataException("The call's TwiML could not be built.");
  }

  /*
   * The TwiML of a call, built and fitted (generateTwimlForCall) in one
   * way of speaking.
   */
  private static generateFittedTwiml(
    callRequest: CallRequestMessage,
    speech: CallSpeechOptions,
    options: {
      userOnCallLogTimelineId?: ObjectID | string | undefined;
    },
  ): string {
    const spoken: Array<string> = [];

    /*
     * Signed once, for every build below: a token signed again a second
     * later would make the TwiML measured differ from the TwiML sent. It
     * carries the prompt, so a wrong key is asked again in its words
     * (#10949), and the voice the call speaks with, which every answer to
     * a key is said in (#10948).
     */
    const keypadTokens: Map<GatherInput, string> = new Map();

    const keypadTokenOf: (gather: GatherInput) => string = (
      gather: GatherInput,
    ): string => {
      if (!keypadTokens.has(gather)) {
        keypadTokens.set(
          gather,
          OnCallKeypadToken.sign({
            userOnCallLogTimelineId: options.userOnCallLogTimelineId,
            answers: gather.onInputCallRequest,
            prompt: {
              sayMessage: gather.introMessage,
              noInputMessage: gather.noInputMessage,
              timeoutInSeconds:
                gather.timeoutInSeconds ||
                CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS,
            },
            voice: speech.voice,
          }),
        );
      }

      return keypadTokens.get(gather)!;
    };

    const twiml: string = this.buildTwimlForCall(
      callRequest,
      (text: string): string => {
        spoken.push(text);
        return text;
      },
      keypadTokenOf,
      speech,
    );

    if (twiml.length <= MAX_CALL_TWIML_LENGTH) {
      return twiml;
    }

    // What the TwiML takes besides its texts: each text one character.
    const overhead: number =
      this.buildTwimlForCall(
        callRequest,
        (): string => {
          return "x";
        },
        keypadTokenOf,
        speech,
      ).length - spoken.length;

    let budget: number = MAX_CALL_TWIML_LENGTH - overhead;
    let fittedTwiml: string = twiml;

    for (
      let attempt: number = 0;
      attempt < MAX_TWIML_FIT_ATTEMPTS && budget > 0;
      attempt++
    ) {
      const fitted: Array<string> = fitTextsToBudget(spoken, budget, {
        measure: getTwimlTextLength,
        getNote: (): string => {
          return TRUNCATED_TEXT_NOTE_PLAIN;
        },
      });

      let next: number = 0;

      fittedTwiml = this.buildTwimlForCall(
        callRequest,
        (): string => {
          return fitted[next++] ?? "";
        },
        keypadTokenOf,
        speech,
      );

      if (fittedTwiml.length <= MAX_CALL_TWIML_LENGTH) {
        return fittedTwiml;
      }

      budget -= fittedTwiml.length - MAX_CALL_TWIML_LENGTH;
    }

    return fittedTwiml;
  }

  /*
   * Where Twilio posts a key the person pressed (#10025): the prompt's
   * address with the call's keypad token, which says what each key answers
   * and names the notification the call is for (OnCallKeypadToken) - and
   * without the page's link token the address may carry
   * (OnCallPageLinks.getCallResponseUrl), which escalates the page from a
   * browser too. This address lands in Twilio's request logs and in the
   * call's TwiML in the Twilio console. The prompt's own address is left as
   * it was.
   */
  public static getKeypadAction(responseUrl: URL, keypadToken: string): string {
    const action: URL = URL.fromURL(responseUrl);
    const params: Dictionary<string> = { ...action.params };

    delete params[ON_CALL_PAGE_LINK_TOKEN_PARAM];
    action.params = params;

    return action
      .addQueryParam(ON_CALL_KEYPAD_TOKEN_PARAM, keypadToken)
      .toString();
  }

  /*
   * The TwiML for a call, each text it speaks as `say` has it: in the order
   * the call speaks them.
   *
   * A call that asks for a key (#10762) says everything inside its
   * <Gather input="dtmf">, so a key pressed while it speaks stops it and
   * answers the call at once - Twilio takes no key pressed outside one. It
   * says, once:
   *
   *   1. the sentences before the prompt - who calls, what happened and
   *      which one;
   *   2. the prompt - "Press 1 to acknowledge, or 2 to escalate.";
   *   3. the sentences after it (Say.afterPrompt) - the title, cut short;
   *
   * then, CALL_PROMPT_REPEATS times, a pause and the sentences said again
   * (Say.repeated) with the prompt after them. Twilio waits the prompt's
   * timeout once all of it is said, and a call nobody answered says its
   * no-input words and ends: the page is left as it was, not acknowledged,
   * as before. A key Twilio posts to the prompt's keypad action
   * (getKeypadAction), with the call's keypad token (`keypadTokenOf`) -
   * keys 1 and 2 answer exactly as before, and any other key is asked
   * again (Common/Utils/Call/CallKeypad, #10949). No key ends the prompt
   * early (CALL_KEYPAD_FINISH_ON_KEY): # used to, and the call hung up as
   * if no key had been pressed.
   *
   * Every text goes through the TwiML builder, which escapes it - a title is
   * never TwiML or SSML - in characters it can carry (toTwimlText), and a
   * record's number is spelled (CallTwimlSpeech): with SSML for a voice that
   * reads it, with spaced letters for any other, the account's default
   * among them.
   */
  private static buildTwimlForCall(
    callRequest: CallRequestMessage,
    say: (text: string) => string,
    keypadTokenOf: (gather: GatherInput) => string,
    speech: CallSpeechOptions,
  ): string {
    const response: VoiceResponse = new Twilio.twiml.VoiceResponse();

    // The sentences said so far, which the next prompt says first.
    let sentences: Array<Say> = [];

    for (const item of callRequest.data) {
      if ((item as Say).sayMessage) {
        sentences.push(item as Say);
      }

      if ((item as GatherInput) && (item as GatherInput).numDigits > 0) {
        const prompt: GatherInput = item as GatherInput;

        const gather: VoiceResponse.Gather = response.gather({
          input: ["dtmf"],
          numDigits: prompt.numDigits,
          timeout:
            prompt.timeoutInSeconds || CALL_DEFAULT_PROMPT_TIMEOUT_IN_SECONDS,
          action: this.getKeypadAction(
            prompt.responseUrl,
            keypadTokenOf(prompt),
          ),
          method: "POST",
          finishOnKey: CALL_KEYPAD_FINISH_ON_KEY,
        });

        for (const sentence of sentences) {
          if (!sentence.afterPrompt) {
            this.sayInto(gather, sentence, say, speech);
          }
        }

        this.sayInto(gather, prompt.introMessage, say, speech);

        for (const sentence of sentences) {
          if (sentence.afterPrompt) {
            this.sayInto(gather, sentence, say, speech);
          }
        }

        for (let repeat: number = 0; repeat < CALL_PROMPT_REPEATS; repeat++) {
          gather.pause({ length: CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS });

          for (const sentence of sentences) {
            if (sentence.repeated) {
              this.sayInto(gather, sentence, say, speech);
            }
          }

          this.sayInto(gather, prompt.introMessage, say, speech);
        }

        sentences = [];

        this.sayInto(response, prompt.noInputMessage, say, speech);
      }
    }

    // A call that asks for no key says its sentences, as it always did.
    for (const sentence of sentences) {
      this.sayInto(response, sentence, say, speech);
    }

    response.hangup();

    return response.toString();
  }

  /*
   * One sentence into the TwiML, as `say` has its texts: in the call's
   * voice, its record numbers spelled for it (CallTwimlSpeech, which writes
   * every <Say> of a call - the keypad's answers too).
   */
  private static sayInto(
    parent: SayParent,
    sentence: Say | string,
    say: (text: string) => string,
    speech: CallSpeechOptions,
  ): void {
    sayInto(parent, sentence, speech, say);
  }
}
