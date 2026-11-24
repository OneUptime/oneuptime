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
import { ChannelVerificationMessages } from "../../Types/UserNotification/ChannelVerificationMessages";
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
              new BadDataException(ChannelVerificationMessages.noItem),
            );
          }

          /*
           * A person first: a request whose session names nobody (a
           * project's API key) is refused before any row is read, so a
           * missing caller id is never compared with a row's owner.
           */
          const userId: ObjectID | undefined = (req as OneUptimeRequest)
            ?.userAuthorization?.userId;

          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(ChannelVerificationMessages.notSignedIn),
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

          /*
           * Somebody else's chat is answered exactly like one that does not
           * exist (#7272), as is one in a project its owner left (below):
           * the answer never says whether an id is someone's.
           */
          if (!item || item.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(ChannelVerificationMessages.notFound),
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
              new BadDataException(ChannelVerificationMessages.notFound),
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
              new BadDataException(ChannelVerificationMessages.noItem),
            );
          }

          // A person first, as above.
          const userId: ObjectID | undefined = (req as OneUptimeRequest)
            ?.userAuthorization?.userId;

          if (!userId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(ChannelVerificationMessages.notSignedIn),
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

          /*
           * Somebody else's chat is answered exactly like one that does not
           * exist (#7272), as is one in a project its owner left (below):
           * the answer never says whether an id is someone's.
           */
          if (!item || item.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(ChannelVerificationMessages.notFound),
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
              new BadDataException(ChannelVerificationMessages.notFound),
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
