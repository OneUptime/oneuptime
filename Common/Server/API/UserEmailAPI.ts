import UserMiddleware from "../Middleware/UserAuthorization";
import UserEmailService, {
  Service as UserEmailServiceType,
} from "../Services/UserEmailService";
import UserNotificationRuleService from "../Services/UserNotificationRuleService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import logger from "../Utils/Logger";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserEmail from "../../Models/DatabaseModels/UserEmail";

export default class UserEmailAPI extends BaseAPI<
  UserEmail,
  UserEmailServiceType
> {
  public constructor() {
    super(UserEmail, UserEmailService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/verify`,
      UserMiddleware.getUserMiddleware,
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

          // Check if the code matches and verify the email.
          const item: UserEmail | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
              verificationCode: true,
            },
          });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          //check user id

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

          if (item.verificationCode !== req.body["code"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid code"),
            );
          }

          await this.service.updateOneById({
            id: item.id!,
            props: {
              isRoot: true,
            },
            data: {
              isVerified: true,
            },
          });

          // Create default notification rules for this verified email
          try {
            await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
              {
                projectId: new ObjectID(item.projectId!.toString()),
                userId: new ObjectID(item.userId!.toString()),
                notificationMethod: {
                  userEmailId: item.id!,
                },
              },
            );
          } catch (e) {
            logger.error(e);
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

          await this.service.resendVerificationCode(req.body.itemId);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
