import SmsService from "../Services/SmsService";
import crypto from "crypto";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
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
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";

const router: ExpressRouter = Express.getRouter();

// Constant-time comparison of the per-message status-callback token.
const isStatusCallbackTokenValid: (
  provided: string,
  expected: string,
) => boolean = (provided: string, expected: string): boolean => {
  const providedBuffer: Buffer = Buffer.from(provided);
  const expectedBuffer: Buffer = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch, so guard first.
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    providedBuffer as Uint8Array,
    expectedBuffer as Uint8Array,
  );
};

router.post(
  "/send",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = JSONFunctions.deserialize(req.body);

      await SmsService.sendSms(body["to"] as Phone, body["message"] as string, {
        projectId: body["projectId"] as ObjectID,
        isSensitive: (body["isSensitive"] as boolean) || false,
        userOnCallLogTimelineId:
          (body["userOnCallLogTimelineId"] as ObjectID) || undefined,
        customTwilioConfig: body["customTwilioConfig"] as any,
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
 * Twilio delivery-status callback. Configured as the `statusCallback` URL on each
 * outbound message in SmsService. This is a public webhook (Twilio is unauthenticated),
 * so it is secured by an unguessable per-message token embedded in the URL — never by
 * user/cluster auth. It only advances the delivery status of the single referenced SMS log.
 */
router.post(
  "/status-callback/:smsLogId/:token",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const smsLogId: string = req.params["smsLogId"] as string;
      const token: string = req.params["token"] as string;

      if (!smsLogId || !token || !ObjectID.isValidUUID(smsLogId)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid status callback URL"),
        );
      }

      const smsLog: SmsLog | null = await SmsLogService.findOneById({
        id: new ObjectID(smsLogId),
        select: {
          _id: true,
          status: true,
          statusCallbackToken: true,
          userOnCallLogTimelineId: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * Unknown id — a forged request or a log already pruned by retention. Acknowledge
       * with 200 so the provider does not retry, but do not act on it.
       */
      if (!smsLog) {
        logger.warn(`SMS status callback for unknown log: ${smsLogId}`);
        return Response.sendEmptySuccessResponse(req, res);
      }

      // Authenticate the callback against the per-message token.
      if (
        !smsLog.statusCallbackToken ||
        !isStatusCallbackTokenValid(token, smsLog.statusCallbackToken)
      ) {
        logger.warn(
          `SMS status callback with invalid token for log: ${smsLogId}`,
        );
        res.status(403).send("Forbidden");
        return;
      }

      const providerStatus: string =
        (req.body["MessageStatus"] as string) ||
        (req.body["SmsStatus"] as string) ||
        "";

      const mappedStatus: SmsStatus | null =
        SmsService.mapProviderStatusToSmsStatus(providerStatus);

      // A status we don't track (e.g. inbound "received"). Acknowledge and ignore.
      if (!mappedStatus) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      /*
       * Provider callbacks can occasionally arrive out of order. Don't let a stale
       * non-terminal status (Sending/Sent) regress an already-terminal one.
       */
      const terminalStatuses: Array<SmsStatus> = [
        SmsStatus.Delivered,
        SmsStatus.Undelivered,
        SmsStatus.Failed,
      ];
      if (
        smsLog.status &&
        terminalStatuses.includes(smsLog.status) &&
        !terminalStatuses.includes(mappedStatus)
      ) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      const errorCode: string | undefined = req.body["ErrorCode"]
        ? String(req.body["ErrorCode"])
        : undefined;
      const messageSid: string | undefined = req.body["MessageSid"]
        ? String(req.body["MessageSid"])
        : undefined;

      let statusMessage: string = `Delivery status: ${mappedStatus}.`;
      if (messageSid) {
        statusMessage += ` Message ID: ${messageSid}.`;
      }
      if (errorCode) {
        statusMessage += ` Provider error code: ${errorCode}.`;
      }

      await SmsLogService.updateOneById({
        id: smsLog.id!,
        data: {
          status: mappedStatus,
          statusMessage: statusMessage,
          ...(errorCode ? { errorCode: errorCode } : {}),
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * Reflect a failed delivery back onto the linked on-call timeline entry — the
       * optimistic "Sent" recorded at submit time was wrong. Only correct the optimistic
       * "Sending"/"Sent" states; never clobber a user action (Acknowledged) or an
       * intentional Skipped.
       */
      if (
        smsLog.userOnCallLogTimelineId &&
        SmsService.isFailureStatus(mappedStatus)
      ) {
        const timeline: UserOnCallLogTimeline | null =
          await UserOnCallLogTimelineService.findOneById({
            id: smsLog.userOnCallLogTimelineId,
            select: {
              _id: true,
              status: true,
            },
            props: {
              isRoot: true,
            },
          });

        const correctableStatuses: Array<UserNotificationStatus> = [
          UserNotificationStatus.Sent,
          UserNotificationStatus.Sending,
        ];

        if (
          timeline &&
          timeline.status &&
          correctableStatuses.includes(timeline.status)
        ) {
          await UserOnCallLogTimelineService.updateOneById({
            id: smsLog.userOnCallLogTimelineId,
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: statusMessage,
            },
            props: {
              isRoot: true,
            },
          });

          /*
           * A failed/undelivered on-call SMS could trigger escalation to the next rule
           * here in the future. Intentionally not implemented yet.
           */
        }
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

      const config: ProjectCallSMSConfig | null =
        await ProjectCallSMSConfigService.findOneById({
          id: callSMSConfigId,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            twilioAccountSID: true,
            twilioAuthToken: true,
            twilioPrimaryPhoneNumber: true,
            twilioSecondaryPhoneNumbers: true,
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

      if (!config.twilioPrimaryPhoneNumber) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("twilioPrimaryPhoneNumber is required"),
        );
      }

      const twilioConfig: TwilioConfig | undefined =
        ProjectCallSMSConfigService.toTwilioConfig(config);

      try {
        if (!twilioConfig) {
          throw new BadDataException("twilioConfig is undefined");
        }

        await SmsService.sendSms(
          toPhone,
          "This is a test SMS from OneUptime.",
          {
            projectId: config.projectId,
            customTwilioConfig: twilioConfig,
          },
        );
      } catch (err) {
        logger.error(err, getLogAttributesFromRequest(req as RequestLike));
        throw new BadDataException(
          "Failed to send test SMS. Please check the twilio logs for more details.",
        );
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
