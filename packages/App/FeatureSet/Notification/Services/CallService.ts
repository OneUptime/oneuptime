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
  getSpeechParts,
  isSsmlVoice,
  renderSpeechAsText,
  SpeechPart,
  toSpokenText,
  toTwimlText,
} from "Common/Utils/Call/CallSpeech";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse";

/*
 * A call that asks for a key says its details and prompt this many times
 * more while no key is pressed: twice in all, as the issue that asked for it
 * suggested (#10762). A key pressed at any moment answers it, and a call
 * that goes unanswered still ends inside its first minute - a call is
 * billed by the minute.
 */
export const CALL_PROMPT_REPEATS: number = 1;

// The silence before each time it says them again, listening for a key all the while.
export const CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS: number = 5;

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
 * way - as are the answers to a key press.
 */
export function getCallGatewayMessage(callRequest: CallRequest): string {
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
 * What a call said, as its voicemail message repeats it: its sentences in
 * order, as a voice says them - a record's number spelled out, "I N C 42",
 * which written ("INC-42") a voice reads "Incorporated 42". The keypad
 * prompt is left out, as for a gateway (getCallGatewayMessage).
 */
export function getCallVoicemailWords(callRequest: CallRequest): string {
  const sentences: Array<string> = [];

  for (const item of callRequest.data || []) {
    if (typeof (item as Say).sayMessage !== "string") {
      continue;
    }

    const sentence: string = renderSpeechAsText(
      getSpeechParts(item as Say),
    ).trim();

    if (sentence) {
      sentences.push(SENTENCE_END.test(sentence) ? sentence : `${sentence}.`);
    }
  }

  return sentences.join(" ");
}

// Where a call's sentences go: the call itself, or its prompt for a key.
type SayParent = VoiceResponse | VoiceResponse.Gather;

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
         * which it can offer as key presses of its own.
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

        if (voicemailCallbackUrl && !options.isSensitive) {
          callLog.callData = {
            ...((callLog.callData as unknown as Record<string, unknown>) || {}),
            [VOICEMAIL_MESSAGE_CALL_DATA_KEY]: ProductBrandingText.brandText(
              getVoicemailMessage(getCallVoicemailWords(callRequest)),
            ),
          } as any;
        }

        /*
         * A key the person presses is taken only for the notification this
         * call is placed for (OnCallKeypadToken).
         */
        const twiml: string = this.generateTwimlForCall(callRequest, {
          userOnCallLogTimelineId: options.userOnCallLogTimelineId,
        });

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

        callLog.status = CallStatus.Success;
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
       * Placed is "Sent": how the call ended comes later, by its status
       * callback. Written only while the page's timeline entry still says
       * Sending (OnCallNotificationStatus): a call not answered or failed
       * that the callback - which can land first - wrote there, or the
       * person's acknowledgement, stays.
       */
      await recordSendResult({
        userOnCallLogTimelineId: options.userOnCallLogTimelineId,
        isSent: callLog.status === CallStatus.Success,
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
   * Whether a call asks Twilio who answered it (#6594): an on-call page -
   * a call made for a person's on-call notification, a test page's among
   * them - of a project that detects voicemail, as every project does until
   * it is switched off (Project.detectVoicemailOnCalls; empty reads as on).
   * Any other call - a verification code, Send Test Call, an incoming call
   * policy's - is placed as it always was.
   */
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
   * call ends. Cut to fit as any call's TwiML is (generateTwimlForCall).
   */
  public static generateVoicemailTwiml(message: string): string {
    return this.generateTwimlForCall({
      data: [{ sayMessage: message }],
    });
  }

  /*
   * The TwiML a call is made with. Twilio refuses TwiML of more than
   * MAX_CALL_TWIML_LENGTH characters, and the call is not made: a call whose
   * spoken texts make it longer - a template that placed a description -
   * has them cut, the longest first and all to about the same length, each
   * ending with a note that the rest is in OneUptime (fitTextsToBudget). The
   * TwiML is built again and measured, and the texts cut shorter while it is
   * still over. A call that fits is made whole.
   */
  public static generateTwimlForCall(
    callRequest: CallRequestMessage,
    options?: {
      /*
       * The on-call notification the call is placed for: its keypad token
       * names it (OnCallKeypadToken), and the keypad route takes a key only
       * for that notification.
       */
      userOnCallLogTimelineId?: ObjectID | string | undefined;
      /*
       * The Twilio voice the call speaks with: "Polly.Joanna", say. None -
       * as every call OneUptime places - is the Twilio account's default
       * voice, which may read no SSML (Utils/Call/CallSpeech).
       */
      voice?: string | undefined;
    },
  ): string {
    const spoken: Array<string> = [];

    /*
     * Signed once, for every build below: a token signed again a second
     * later would make the TwiML measured differ from the TwiML sent.
     */
    const keypadTokens: Map<GatherInput, string> = new Map();

    const keypadTokenOf: (gather: GatherInput) => string = (
      gather: GatherInput,
    ): string => {
      if (!keypadTokens.has(gather)) {
        keypadTokens.set(
          gather,
          OnCallKeypadToken.sign({
            userOnCallLogTimelineId: options?.userOnCallLogTimelineId,
            answers: gather.onInputCallRequest,
          }),
        );
      }

      return keypadTokens.get(gather)!;
    };

    const voice: string | undefined = options?.voice;

    const twiml: string = this.buildTwimlForCall(
      callRequest,
      (text: string): string => {
        spoken.push(text);
        return text;
      },
      keypadTokenOf,
      voice,
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
        voice,
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
        voice,
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
   * keys 1 and 2 answer exactly as before.
   *
   * Every text goes through the TwiML builder, which escapes it - a title is
   * never TwiML or SSML - in characters it can carry (toTwimlText), and a
   * record's number is spelled (CallSpeech): with SSML for a voice that reads
   * it, with spaced letters for any other, the account's default among them.
   */
  private static buildTwimlForCall(
    callRequest: CallRequestMessage,
    say: (text: string) => string,
    keypadTokenOf: (gather: GatherInput) => string,
    voice?: string | undefined,
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
          timeout: prompt.timeoutInSeconds || 5,
          action: this.getKeypadAction(
            prompt.responseUrl,
            keypadTokenOf(prompt),
          ),
          method: "POST",
        });

        for (const sentence of sentences) {
          if (!sentence.afterPrompt) {
            this.sayInto(gather, sentence, say, voice);
          }
        }

        this.sayInto(gather, prompt.introMessage, say, voice);

        for (const sentence of sentences) {
          if (sentence.afterPrompt) {
            this.sayInto(gather, sentence, say, voice);
          }
        }

        for (let repeat: number = 0; repeat < CALL_PROMPT_REPEATS; repeat++) {
          gather.pause({ length: CALL_PROMPT_REPEAT_PAUSE_IN_SECONDS });

          for (const sentence of sentences) {
            if (sentence.repeated) {
              this.sayInto(gather, sentence, say, voice);
            }
          }

          this.sayInto(gather, prompt.introMessage, say, voice);
        }

        sentences = [];

        this.sayInto(response, prompt.noInputMessage, say, voice);
      }
    }

    // A call that asks for no key says its sentences, as it always did.
    for (const sentence of sentences) {
      this.sayInto(response, sentence, say, voice);
    }

    response.hangup();

    return response.toString();
  }

  /*
   * One sentence into the TwiML, as `say` has its texts: a <Say> - or
   * nothing, for a sentence with no words. For a voice that reads SSML, its
   * record's number is a <say-as interpret-as="characters">; for any other -
   * the account's default voice among them - it is spelled with spaces.
   * Every text is put in characters TwiML can carry, and the builder escapes
   * it.
   */
  private static sayInto(
    parent: SayParent,
    sentence: Say | string,
    say: (text: string) => string,
    voice: string | undefined,
  ): void {
    const parts: Array<SpeechPart> =
      typeof sentence === "string"
        ? [{ text: sentence }]
        : getSpeechParts(sentence);

    const attributes: VoiceResponse.SayAttributes = voice
      ? { voice: voice as NonNullable<VoiceResponse.SayAttributes["voice"]> }
      : {};

    if (!isSsmlVoice(voice)) {
      const text: string = renderSpeechAsText(
        parts.map((part: SpeechPart): SpeechPart => {
          return "characters" in part
            ? { characters: toTwimlText(part.characters) }
            : { text: toSpokenText(part.text) };
        }),
      );

      if (!text.trim()) {
        return;
      }

      parent.say(attributes, say(text));
      return;
    }

    const spoken: Array<SpeechPart> = parts
      .map((part: SpeechPart): SpeechPart => {
        return "characters" in part
          ? { characters: toTwimlText(part.characters).trim() }
          : { text: toSpokenText(part.text) };
      })
      .filter((part: SpeechPart): boolean => {
        return "characters" in part ? part.characters !== "" : part.text !== "";
      });

    const hasWords: boolean = spoken.some((part: SpeechPart): boolean => {
      return "characters" in part || part.text.trim() !== "";
    });

    if (!hasWords) {
      return;
    }

    const node: VoiceResponse.Say = parent.say(attributes, "");

    for (const part of spoken) {
      if ("characters" in part) {
        node.sayAs({ "interpret-as": "characters" }, part.characters);
      } else {
        node.addText(say(part.text));
      }
    }
  }
}
