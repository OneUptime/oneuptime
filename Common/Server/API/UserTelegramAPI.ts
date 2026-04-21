import UserMiddleware from "../Middleware/UserAuthorization";
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
              verificationCode: true,
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

          return Response.sendJsonObjectResponse(req, res, {
            verificationCode: item.verificationCode as string,
            telegramBotUsername: botUsername,
            isVerified: Boolean(item.isVerified),
            deepLinkUrl: `https://t.me/${botUsername}?start=${item.verificationCode}`,
            startCommand: `/start ${item.verificationCode}`,
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

          await this.service.regenerateVerificationCode(req.body.itemId);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
