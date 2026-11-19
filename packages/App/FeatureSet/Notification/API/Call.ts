import CallService from "../Services/CallService";
import {
  CallOutcome,
  getCallOutcome,
  getCallOutcomeStatusMessage,
  getTimeToCallOutcomeInMs,
  isTwilioCallSid,
} from "../Utils/CallOutcome";
import {
  AnsweredByOutcome,
  getAnsweredByOutcome,
  getMachineAnsweredCallOutcome,
} from "../Utils/AnsweredBy";
import {
  findTwilioAccountThatSigned,
  getVoicemailMessageOfCall,
  leaveVoicemailMessage,
} from "../Utils/VoicemailCallback";
import { isStatusCallbackTokenValid } from "../Utils/StatusCallbackToken";
import { getProviderConfigOfCallback } from "../Utils/StatusCallbackProviderConfig";
import { recordProviderReport } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { WebhookRequest } from "Common/Types/Call/CallProvider";
import {
  CallOutcomeLine,
  isMachineAnsweredCallOutcome,
  readCallOutcomeMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallSentLine";
import NotificationDeliveryMetrics, {
  NotificationDeliveryChannel,
  NotificationDeliveryProvider,
} from "Common/Server/Utils/Telemetry/NotificationDeliveryMetrics";
import CallStatus from "Common/Types/Call/CallStatus";
import CallLogService from "Common/Server/Services/CallLogService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import TwilioConfigJSON from "Common/Types/CallAndSMS/TwilioConfigJSON";
import TwilioPhoneNumbers, {
  TEST_SEND_FROM_PHONE_NUMBER_FIELD,
} from "Common/Types/CallAndSMS/TwilioPhoneNumbers";
import { TwilioMessageKind } from "Common/Utils/Project/TwilioAccount";
import TwilioConfigUses, {
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import { PROJECT_TWILIO_CONFIG_SELECT } from "Common/Server/Utils/TwilioConfigSelect";
import TwilioSendError from "../Utils/TwilioSendError";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import TestSendAccess, {
  TestSendCaller,
} from "Common/Server/API/TestSendAccess";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";

const router: ExpressRouter = Express.getRouter();

router.post(
  "/make-call",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = JSONFunctions.deserialize(req.body);

      await CallService.makeCall(body["callRequest"] as CallRequest, {
        projectId: body["projectId"] as ObjectID,
        isSensitive: (body["isSensitive"] as boolean) || false,
        userOnCallLogTimelineId:
          (body["userOnCallLogTimelineId"] as ObjectID) || undefined,
        // Read back with its numbers as lists (TwilioConfigJSON).
        customTwilioConfig: TwilioConfigJSON.fromJSON(
          body["customTwilioConfig"],
        ),
        incidentId: (body["incidentId"] as ObjectID) || undefined,
        alertId: (body["alertId"] as ObjectID) || undefined,
        scheduledMaintenanceId:
          (body["scheduledMaintenanceId"] as ObjectID) || undefined,
        statusPageId: (body["statusPageId"] as ObjectID) || undefined,
        statusPageAnnouncementId:
          (body["statusPageAnnouncementId"] as ObjectID) || undefined,
        userId: (body["userId"] as ObjectID) || undefined,
        onCallPolicyId: (body["onCallPolicyId"] as ObjectID) || undefined,
        onCallPolicyEscalationRuleId:
          (body["onCallPolicyEscalationRuleId"] as ObjectID) || undefined,
        onCallDutyPolicyExecutionLogTimelineId:
          (body["onCallDutyPolicyExecutionLogTimelineId"] as ObjectID) ||
          undefined,
        onCallScheduleId: (body["onCallScheduleId"] as ObjectID) || undefined,
        teamId: (body["teamId"] as ObjectID) || undefined,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Twilio's call status callback: how a call ended. Set as the
 * `statusCallback` URL of every call CallService places through Twilio for
 * a project (CallService.prepareStatusCallback). A public webhook - Twilio
 * signs in as nobody - so it is secured by the unguessable per-call token
 * in its URL, never by user or cluster auth, and it only records how the
 * one call it names ended (CallOutcome):
 *
 *  - on the call's log: Missed Call, Busy or Error, and how it ended;
 *  - on the on-call notification the call was made for, while that is only
 *    sent: Not Answered or Error. An answer - pressing 1 - an escalation or
 *    a skip is never written over. The notification's own hooks tell the
 *    record's feed (UserOnCallLogTimelineService): "Nitin did not answer
 *    the phone call", "could not page Nitin via phone call".
 *
 * A call ends once: a callback for a call whose outcome is written already
 * - Twilio may send one twice - writes and counts nothing more. The same
 * callback sent again still corrects its notification, which writes only
 * while that is only sent: Twilio sends a callback again when it was
 * answered with an error (StatusCallbackRetry), and the one that wrote the
 * log may have stopped before the notification was written (issue #6874).
 */
router.post(
  "/status-callback/:callLogId/:token",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const callLogId: string = req.params["callLogId"] as string;
      const token: string = req.params["token"] as string;

      if (!callLogId || !token || !ObjectID.isValidUUID(callLogId)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid status callback URL"),
        );
      }

      const callLog: CallLog | null = await CallLogService.findOneById({
        id: new ObjectID(callLogId),
        select: {
          _id: true,
          status: true,
          statusMessage: true,
          statusCallbackToken: true,
          userOnCallLogTimelineId: true,
          createdAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * Unknown id - a forged request, or a log already pruned by
       * retention. Answered with 200 so Twilio does not retry, and not
       * acted on.
       */
      if (!callLog) {
        logger.warn(`Call status callback for unknown log: ${callLogId}`);
        return Response.sendEmptySuccessResponse(req, res);
      }

      // Authenticate the callback against the per-call token.
      if (
        !callLog.statusCallbackToken ||
        !isStatusCallbackTokenValid(token, callLog.statusCallbackToken)
      ) {
        logger.warn(
          `Call status callback with invalid token for log: ${callLogId}`,
        );
        res.status(403).send("Forbidden");
        return;
      }

      const outcome: CallOutcome | null = getCallOutcome({
        providerStatus: req.body?.["CallStatus"],
        durationInSeconds: req.body?.["CallDuration"],
      });

      // Not how a call ended (ringing, in progress), or canceled: nothing to write.
      if (!outcome) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      const statusMessage: string = getCallOutcomeStatusMessage({
        callSid: req.body?.["CallSid"],
        outcome: outcome,
      });

      /*
       * The log says this callback's outcome already - its message says how
       * the call ended, also for an answered call, whose log still says
       * Success: Twilio sent the callback again. The log is not written
       * again, nor the call counted again.
       */
      const isOutcomeWritten: boolean = callLog.statusMessage === statusMessage;

      if (!isOutcomeWritten) {
        /*
         * Written once. A call placed is logged Success; how it ended moves
         * it on - Missed Call, Busy, Error - or, answered, leaves it so.
         */
        if (callLog.status !== CallStatus.Success) {
          return Response.sendEmptySuccessResponse(req, res);
        }

        /*
         * A bookkeeping stamp on the call's own log, as an SMS's delivery
         * status is (SMS.ts): CallLog has update workflows disabled and no
         * service update hooks, so the full update pipeline is skipped.
         * Only while the log still says Success, with the message it had
         * when the call was placed, in the same statement: of two callbacks
         * for one call at once, one writes and the other stops.
         */
        const isWritten: boolean =
          await CallLogService.compareAndSetColumnsByIdWithoutHooks({
            id: callLog.id!,
            data: {
              ...(outcome.callStatus ? { status: outcome.callStatus } : {}),
              statusMessage: statusMessage,
            },
            expectedData: {
              status: CallStatus.Success,
              statusMessage: (callLog.statusMessage ?? null) as string,
            },
          });

        if (!isWritten) {
          return Response.sendEmptySuccessResponse(req, res);
        }

        /*
         * How the call ended, for the platform's operator - once, as only
         * the callback that wrote it gets here (notification.delivery.count).
         */
        NotificationDeliveryMetrics.recordDelivery({
          channel: NotificationDeliveryChannel.Call,
          provider: NotificationDeliveryProvider.Twilio,
          providerConfig: getProviderConfigOfCallback(req.query),
          isOnCallPage: Boolean(callLog.userOnCallLogTimelineId),
          status: outcome.deliveryStatus,
          timeToStatusInMs: getTimeToCallOutcomeInMs({
            outcome: outcome,
            // The call's log is written as Twilio accepts the call.
            millisecondsSincePlaced:
              NotificationDeliveryMetrics.getMillisecondsSince(
                callLog.createdAt,
              ),
          }),
        });
      }

      /*
       * Only a notification that is still just sent: the person's answer
       * (pressing 1 is their acknowledgement), an escalation from it, or a
       * skip says more than how the call ended - checked in the same
       * statement as the write (OnCallNotificationStatus), as an SMS's
       * delivery report is. Also when the log was written already: the
       * callback that wrote it may have failed before this - the database
       * did - and Twilio sent it again. A notification that says the call
       * was not answered, or failed, moved on from Sent and is not written
       * again; an answered call's, still Sent, is told the same words again.
       */
      if (callLog.userOnCallLogTimelineId) {
        await recordProviderReport({
          userOnCallLogTimelineId: callLog.userOnCallLogTimelineId,
          status: outcome.notificationStatus || undefined,
          statusMessage: statusMessage,
        });
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * The statuses of a call's on-call notification that say a person was on
 * the line: they pressed 1 to acknowledge the page, or 2 to escalate it,
 * on this very call (OnCallNotificationStatus: each is written on the
 * notification it was answered from). A machine Twilio heard there is not
 * one.
 */
const ANSWERED_ON_THE_CALL: ReadonlyArray<UserNotificationStatus> = [
  UserNotificationStatus.Acknowledged,
  UserNotificationStatus.PassedOn,
];

// How many times the log is read again when its message changed under the write.
const MAX_MACHINE_ANSWERED_WRITE_ATTEMPTS: number = 3;

async function isAnsweredOnTheCall(
  userOnCallLogTimelineId: ObjectID,
): Promise<boolean> {
  const notification: UserOnCallLogTimeline | null =
    await UserOnCallLogTimelineService.findOneById({
      id: userOnCallLogTimelineId,
      select: {
        _id: true,
        status: true,
      },
      props: {
        isRoot: true,
      },
    });

  return Boolean(
    notification?.status && ANSWERED_ON_THE_CALL.includes(notification.status),
  );
}

/*
 * Writes that a machine answered the call over its log, once: only while
 * the log still says Success - placed, or answered as its status callback
 * said - at the message it had when read, in the same statement. A status
 * callback that wrote "answered" meanwhile leaves the log at Success, so it
 * is read again and written over; one that wrote anything else - rang out,
 * busy, failed - or another answering machine callback, is left. Whether
 * it was written, and whether the call's end had been counted already: the
 * status callback counts an answered call as it writes its message.
 */
async function writeMachineAnsweredOutcome(data: {
  callLog: CallLog;
  outcome: CallOutcome;
  statusMessage: string;
}): Promise<{ isWritten: boolean; wasEndCounted: boolean }> {
  let status: CallStatus | undefined = data.callLog.status;
  let statusMessage: string | undefined = data.callLog.statusMessage;

  for (
    let attempt: number = 0;
    attempt < MAX_MACHINE_ANSWERED_WRITE_ATTEMPTS;
    attempt++
  ) {
    if (status !== CallStatus.Success) {
      return { isWritten: false, wasEndCounted: false };
    }

    const isWritten: boolean =
      await CallLogService.compareAndSetColumnsByIdWithoutHooks({
        id: data.callLog.id!,
        data: {
          ...(data.outcome.callStatus
            ? { status: data.outcome.callStatus }
            : {}),
          statusMessage: data.statusMessage,
        },
        expectedData: {
          status: CallStatus.Success,
          statusMessage: (statusMessage ?? null) as string,
        },
      });

    if (isWritten) {
      return {
        isWritten: true,
        // A message saying how the call ended, rather than that it was placed.
        wasEndCounted: Boolean(readCallOutcomeMessage(statusMessage)),
      };
    }

    const current: CallLog | null = await CallLogService.findOneById({
      id: data.callLog.id!,
      select: {
        _id: true,
        status: true,
        statusMessage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!current) {
      return { isWritten: false, wasEndCounted: false };
    }

    status = current.status;
    statusMessage = current.statusMessage;
  }

  return { isWritten: false, wasEndCounted: false };
}

/*
 * Twilio's answering machine callback: who answered an on-call call
 * (#6594). Set as the asyncAmdStatusCallback of every on-call call
 * CallService places through Twilio for a project that detects voicemail
 * (CallService.getVoicemailCallbackUrl), with the call's log id and the
 * token its status callback carries. Twilio posts AnsweredBy while the call
 * goes on (Utils/AnsweredBy):
 *
 *  - a person, or Twilio could not tell: nothing is written - the status
 *    callback says how the call ended;
 *  - voicemail, at the end of its greeting: the call is turned to a short
 *    message, which the voicemail records, and ends - "a message was left";
 *    when it cannot be (the call ended first), "no message was left";
 *  - voicemail at the start of its greeting, or a fax machine: nothing is
 *    left.
 *
 * A call a machine answered then counts as not answered, as one that rang
 * out does: its log says Voicemail (a fax machine's, Missed Call), and the
 * on-call notification it was made for, while it is only sent, says Not
 * Answered, whose own hooks tell the record's feed "Nitin did not answer the
 * phone call ... It went to voicemail, and a message was left." The page
 * goes on to the next rule or level as for a missed call: nobody
 * acknowledged it.
 *
 * A public webhook, so it is held to two locks: the per-call token in its
 * URL, as the status callback is, and Twilio's own signature
 * (X-Twilio-Signature), made with the auth token of the account the call
 * went out on - the project's own Twilio config, or the OneUptime server's
 * (Utils/VoicemailCallback). A request that fails either is refused (403)
 * and changes nothing.
 *
 * The two callbacks of a call can come in either order. Twilio reports a
 * voicemail at the end of its greeting, while the call goes on, so this one
 * comes first as a rule, and the status callback that follows finds the
 * log moved on and leaves it. When the status callback came first - the
 * call had ended - it wrote "answered" and left the log Success, so this one
 * still writes over it, once. A person who pressed 1 or 2 on the call was
 * on the line: then nothing is written. Never over an acknowledgement, an
 * escalation or a skip (recordProviderReport). Twilio sends the callback
 * again when this server answered it with an error (StatusCallbackRetry): a
 * log that says a machine answered already writes nothing more, and still
 * corrects the notification while that is only sent.
 */
router.post(
  "/amd-callback/:callLogId/:token",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const callLogId: string = req.params["callLogId"] as string;
      const token: string = req.params["token"] as string;

      if (!callLogId || !token || !ObjectID.isValidUUID(callLogId)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid answering machine callback URL"),
        );
      }

      const callLog: CallLog | null = await CallLogService.findOneById({
        id: new ObjectID(callLogId),
        select: {
          _id: true,
          projectId: true,
          status: true,
          statusMessage: true,
          statusCallbackToken: true,
          userOnCallLogTimelineId: true,
          callData: true,
          createdAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * Unknown id - a forged request, or a log already pruned by
       * retention. Answered with 200 so Twilio does not retry, and not
       * acted on.
       */
      if (!callLog) {
        logger.warn(
          `Call answering machine callback for unknown log: ${callLogId}`,
        );
        return Response.sendEmptySuccessResponse(req, res);
      }

      // The per-call token in the URL.
      if (
        !callLog.statusCallbackToken ||
        !isStatusCallbackTokenValid(token, callLog.statusCallbackToken)
      ) {
        logger.warn(
          `Call answering machine callback with invalid token for log: ${callLogId}`,
        );
        res.status(403).send("Forbidden");
        return;
      }

      // Twilio's signature, by the account the call went out on.
      const account: TwilioConfig | null = await findTwilioAccountThatSigned({
        request: req as unknown as WebhookRequest,
        projectId: callLog.projectId,
      });

      if (!account) {
        logger.warn(
          `Call answering machine callback with invalid Twilio signature for log: ${callLogId}`,
        );
        res.status(403).send("Forbidden");
        return;
      }

      const answeredBy: AnsweredByOutcome | null = getAnsweredByOutcome(
        req.body?.["AnsweredBy"],
      );

      // A person, or Twilio could not tell: the status callback says how it ended.
      if (!answeredBy) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      if (callLog.status !== CallStatus.Success) {
        /*
         * The log says a machine answered already: Twilio sent the callback
         * again. The notification is corrected - the callback that wrote
         * the log may have stopped before it - while it is only sent.
         * Ended any other way - rang out, busy, failed - it is left.
         */
        const outcome: CallOutcomeLine | undefined = readCallOutcomeMessage(
          callLog.statusMessage,
        )?.outcome;

        if (
          isMachineAnsweredCallOutcome(outcome) &&
          callLog.userOnCallLogTimelineId &&
          callLog.statusMessage
        ) {
          await recordProviderReport({
            userOnCallLogTimelineId: callLog.userOnCallLogTimelineId,
            status: UserNotificationStatus.NotAnswered,
            statusMessage: callLog.statusMessage,
          });
        }

        return Response.sendEmptySuccessResponse(req, res);
      }

      /*
       * The person pressed 1 or 2 on this call: they were on the line, and
       * the machine Twilio heard is not theirs. Nothing is written.
       */
      if (
        callLog.userOnCallLogTimelineId &&
        (await isAnsweredOnTheCall(callLog.userOnCallLogTimelineId))
      ) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      const callSid: unknown =
        typeof req.body?.["CallSid"] === "string"
          ? req.body["CallSid"].trim()
          : req.body?.["CallSid"];

      /*
       * The voicemail's greeting is over: the call is turned to the message
       * kept for it as it was placed, which the voicemail records.
       */
      const isMessageLeft: boolean =
        answeredBy.canLeaveMessage && isTwilioCallSid(callSid)
          ? await leaveVoicemailMessage({
              account: account,
              callSid: callSid,
              message: getVoicemailMessageOfCall(callLog.callData),
              callLogId: callLog.id!,
            })
          : false;

      const outcome: CallOutcome = getMachineAnsweredCallOutcome({
        outcome: answeredBy,
        isMessageLeft: isMessageLeft,
      });

      const statusMessage: string = getCallOutcomeStatusMessage({
        callSid: callSid,
        outcome: outcome,
      });

      const written: { isWritten: boolean; wasEndCounted: boolean } =
        await writeMachineAnsweredOutcome({
          callLog: callLog,
          outcome: outcome,
          statusMessage: statusMessage,
        });

      if (!written.isWritten) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      /*
       * How the call ended, for the platform's operator - once: not when
       * the status callback had counted it answered already.
       */
      if (!written.wasEndCounted) {
        NotificationDeliveryMetrics.recordDelivery({
          channel: NotificationDeliveryChannel.Call,
          provider: NotificationDeliveryProvider.Twilio,
          providerConfig: getProviderConfigOfCallback(req.query),
          isOnCallPage: Boolean(callLog.userOnCallLogTimelineId),
          status: outcome.deliveryStatus,
          timeToStatusInMs: getTimeToCallOutcomeInMs({
            outcome: outcome,
            millisecondsSincePlaced:
              NotificationDeliveryMetrics.getMillisecondsSince(
                callLog.createdAt,
              ),
          }),
        });
      }

      // Not Answered, while the notification is only sent.
      if (callLog.userOnCallLogTimelineId) {
        await recordProviderReport({
          userOnCallLogTimelineId: callLog.userOnCallLogTimelineId,
          status: outcome.notificationStatus || undefined,
          statusMessage: statusMessage,
        });
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/test",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body;

      const callSMSConfigId: ObjectID = new ObjectID(
        body["callSMSConfigId"] as string,
      );

      /*
       * "Send Test Call" calls through the project's own Twilio account, so
       * it asks what every test send asks (TestSendAccess), before anything
       * is read: a signed-in member, on a credential that may make changes,
       * on the plan custom Twilio configs are sold on, who could add one -
       * team blocks counted - and a config they may read, in their own
       * project. One of another project and one that does not exist are
       * answered alike.
       */
      const caller: TestSendCaller = await TestSendAccess.assertMaySendTest({
        req: req,
        modelType: ProjectCallSMSConfig,
        record: {
          service: ProjectCallSMSConfigService,
          id: callSMSConfigId,
        },
      });

      // Read as OneUptime only now, for the credentials the call needs.
      const config: ProjectCallSMSConfig | null =
        await ProjectCallSMSConfigService.findOneById({
          id: callSMSConfigId,
          props: {
            isRoot: true,
          },
          // Read whole, as every send reads it (PROJECT_TWILIO_CONFIG_SELECT).
          select: {
            ...PROJECT_TWILIO_CONFIG_SELECT,
            projectId: true,
          },
        });

      if (!config) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "call and sms config not found for id" + callSMSConfigId.toString(),
          ),
        );
      }

      CommonAPI.assertResourceBelongsToProject({
        resourceProjectId: config.projectId,
        projectId: caller.projectId,
      });

      const toPhone: Phone = new Phone(body["toPhone"] as string);

      if (!toPhone) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("toPhone is required"),
        );
      }

      // if any of the twilio config is missing, we will not send make the call

      if (!config.twilioAccountSID) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("twilioAccountSID is required"),
        );
      }

      if (!config.twilioAuthToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("twilioAuthToken is required"),
        );
      }

      // A config used for SMS only has no number to make calls from, and needs none.
      if (
        !config.twilioPrimaryPhoneNumber &&
        TwilioConfigUses.getUse(config.usedFor) !== TwilioConfigUse.SmsOnly
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("twilioPrimaryPhoneNumber is required"),
        );
      }

      const twilioConfig: TwilioConfig | undefined =
        ProjectCallSMSConfigService.toTwilioConfig(config);

      /*
       * A config used for SMS only makes no calls (TwilioConfigUse): its
       * test says so, rather than calling through the server's own account
       * as a real call of its project would.
       */
      const cannotSendReason: string | null = twilioConfig
        ? TwilioPhoneNumbers.getCannotSendReason(
            twilioConfig,
            TwilioMessageKind.Call,
          )
        : null;

      if (cannotSendReason) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(cannotSendReason),
        );
      }

      let fromPhoneNumber: Phone | null = null;

      try {
        if (!twilioConfig) {
          throw new BadDataException("twilioConfig is undefined");
        }

        const testCallRequest: CallRequest = {
          data: [
            {
              sayMessage: "This is a test call from One Uptime.",
            },
          ],
          to: toPhone,
        };

        /*
         * The number it calls from - the one a real call to this phone
         * would come from, never an SMS number (TwilioPhoneNumbers) -
         * which the dialog names.
         */
        fromPhoneNumber = TwilioPhoneNumbers.pickSenderNumber({
          config: twilioConfig,
          kind: TwilioMessageKind.Call,
          to: toPhone,
        });

        await CallService.makeCall(testCallRequest, {
          projectId: config.projectId,
          customTwilioConfig: twilioConfig,
          /*
           * A test the project's settings keep from being placed - calls
           * turned off in the project - says why, rather than "placed".
           */
          failIfNotSent: true,
        });
      } catch (err) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));

        // Twilio's refusal, in words the person testing can act on.
        if (TwilioSendError.isActionableRefusal(err)) {
          throw err;
        }

        throw new BadDataException(
          "Error making test call. Please check the Twilio logs for more details.",
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: fromPhoneNumber
          ? fromPhoneNumber.toString()
          : null,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
