import UserMiddleware from "../Middleware/UserAuthorization";
import VerificationCodeRateLimit, {
  VerificationCodeRateLimitBucket,
} from "../Middleware/VerificationCodeRateLimit";
import GlobalConfigService from "../Services/GlobalConfigService";
import UserTelegramService, {
  Service as UserTelegramServiceType,
} from "../Services/UserTelegramService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";

export default class UserTelegramAPI extends BaseAPI<
  UserTelegram,
  UserTelegramServiceType
> {
  public constructor() {
    super(UserTelegram, UserTelegramService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/verification-info`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
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

          const item: UserTelegram | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
              isVerified: true,
            },
          });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

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

          if (
            !item.projectId ||
            !item.userId ||
            !(await this.service.hasActiveProjectMembership({
              projectId: item.projectId,
              userId: item.userId,
            }))
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
              query: {
                _id: ObjectID.getZeroObjectID().toString(),
              },
              props: {
                isRoot: true,
              },
              select: {
                telegramBotUsername: true,
              },
            });

          const botUsername: string | undefined =
            globalConfig?.telegramBotUsername?.trim() || undefined;

          if (!botUsername) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Telegram bot is not configured. Please contact your OneUptime administrator.",
              ),
            );
          }

          const verificationCode: string = item.isVerified
            ? ""
            : await this.service.getVerificationCode(item.id!);

          return Response.sendJsonObjectResponse(req, res, {
            verificationCode,
            telegramBotUsername: botUsername,
            isVerified: Boolean(item.isVerified),
            deepLinkUrl: verificationCode
              ? `https://t.me/${botUsername}?start=${verificationCode}`
              : "",
            startCommand: verificationCode ? `/start ${verificationCode}` : "",
          });
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

          const item: UserTelegram | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
            },
          });

          if (!item) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

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

          if (
            !item.projectId ||
            !item.userId ||
            !(await this.service.hasActiveProjectMembership({
              projectId: item.projectId,
              userId: item.userId,
            }))
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item not found"),
            );
          }

          await this.service.regenerateVerificationCode(req.body.itemId);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
