import CallService from "../Services/CallService";
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
