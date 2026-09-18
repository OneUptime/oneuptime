import UserMiddleware from "../Middleware/UserAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../Middleware/VerificationCodeRateLimit";
import UserEmailService, {
  Service as UserEmailServiceType,
} from "../Services/UserEmailService";
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
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserNotificationRuleService from "../Services/UserNotificationRuleService";
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
export default class UserEmailAPI extends BaseAPI<
  UserEmail,
  UserEmailServiceType
> {
  public constructor() {
    super(UserEmail, UserEmailService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/verify`,
      UserMiddleware.getUserMiddleware,
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

          /* Create default notification rules for this verified email */
          try {
            await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
              {
                projectId: new ObjectID(result.projectId!.toString()),
                userId: new ObjectID(result.userId!.toString()),
                notificationMethod: {
                  userEmailId: result.itemId!,
                },
              },
            );
          } catch (e) {
            logger.error(
              e,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/resend-verification-code`,
      UserMiddleware.getUserMiddleware,
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

          const item: UserEmail | null = await this.service.findOneById({
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

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
