import UserMiddleware from "../Middleware/UserAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../Middleware/VerificationCodeRateLimit";
import UserSMSService, {
  Service as UserSMSServiceType,
} from "../Services/UserSmsService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import ChannelVerification, {
  ChannelVerificationOutcome,
  ChannelVerificationResult,
} from "../Utils/ChannelVerification";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import ChannelVerificationStatusRoute from "./ChannelVerificationStatusRoute";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserNotificationRuleService from "../Services/UserNotificationRuleService";
import UserCallService from "../Services/UserCallService";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";

/*
 * The verify and resend routes for this notification channel.
 *
 * Neither the checking of a submitted code nor the issuing of a new one lives
 * here, on purpose. The state machine is shared by all five channels
 * (Common/Server/Utils/ChannelVerification.ts) so that a control added for one
 * of them cannot quietly go missing on another — which is exactly what went
 * wrong before: five hand-written copies of "compare the column, set
 * isVerified", none of which expired the code, counted attempts, or refused a
 * caller running the comparison a million times against somebody else's phone
 * number.
 *
 * What is left here is the HTTP shape: reject malformed bodies, run the rate
 * limiter before anything costs a database read, and turn the outcome into a
 * response.
 */
export default class UserSMSAPI extends BaseAPI<UserSMS, UserSMSServiceType> {
  public constructor() {
    super(UserSMS, UserSMSService);

    this.router.post(
      `/user-sms/verify`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      VerificationCodeRateLimit.getMiddleware(
        VerificationCodeRateLimitBucket.Verify,
      ),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.body.itemId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          if (!req.body.code) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid code"),
            );
          }

          const userId: ObjectID | undefined = (req as OneUptimeRequest)
            ?.userAuthorization?.userId;

          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          const result: ChannelVerificationResult =
            await ChannelVerification.verifyCode({
              service: this.service,
              itemId: new ObjectID(req.body["itemId"].toString()),
              userId: userId,
              code: req.body["code"].toString(),
            });

          if (result.outcome !== ChannelVerificationOutcome.Verified) {
            return Response.sendErrorResponse(
              req,
              res,
              ChannelVerification.getFailureException(result.outcome),
            );
          }

          /* Create default notification rules for this verified SMS number */
          try {
            await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
              {
                projectId: new ObjectID(result.projectId!.toString()),
                userId: new ObjectID(result.userId!.toString()),
                notificationMethod: {
                  userSmsId: result.itemId!,
                },
              },
            );
          } catch (e) {
            logger.error(
              e,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
          }

          /*
           * A number verified for SMS is verified for calls: the call
           * numbers this person added for the same number in this project
           * are verified with it (UserCallService.isNumberVerifiedForSms
           * says why, and why not the other way round). The answer says how
           * many, so the dialog can tell them they need no second code.
           */
          let alsoVerifiedForCalls: number = 0;

          try {
            const smsNumber: UserSMS | null = await this.service.findOneById({
              id: result.itemId!,
              props: {
                isRoot: true,
              },
              select: {
                phone: true,
              },
            });

            if (smsNumber?.phone) {
              alsoVerifiedForCalls =
                await UserCallService.verifyNumbersProvenBySms({
                  userId: new ObjectID(result.userId!.toString()),
                  projectId: new ObjectID(result.projectId!.toString()),
                  phone: smsNumber.phone,
                });
            }
          } catch (e) {
            logger.error(
              e,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            alsoVerifiedForCalls: alsoVerifiedForCalls,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `/user-sms/resend-verification-code`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      VerificationCodeRateLimit.getMiddleware(
        VerificationCodeRateLimitBucket.Resend,
      ),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.body.itemId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          const item: UserSMS | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
            },
          });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          /*
           * A caller may only ask for a code to be sent to a row they own.
           * Without this the resend route is a way to make somebody else's
           * device ring on demand.
           */
          if (
            item.userId?.toString() !==
            (req as OneUptimeRequest)?.userAuthorization?.userId?.toString()
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          await this.service.resendVerificationCode(req.body.itemId);

          /*
           * Answered with where the new code stands, so the verify dialog
           * shows its times and the next cooldown without asking again.
           */
          return Response.sendJsonObjectResponse(
            req,
            res,
            (await ChannelVerificationStatusRoute.getStatusJSON({
              service: this.service,
              itemId: new ObjectID(req.body["itemId"].toString()),
            })) || {},
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    // Where the person's own code stands, for the verify dialog.
    ChannelVerificationStatusRoute.register({
      router: this.router,
      path: "/user-sms",
      service: this.service,
    });
  }
}
