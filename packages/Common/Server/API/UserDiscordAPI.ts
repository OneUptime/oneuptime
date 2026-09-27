import UserMiddleware from "../Middleware/UserAuthorization";
import UserDiscordService, {
  Service as UserDiscordServiceType,
} from "../Services/UserDiscordService";
import WorkspaceUserNotificationService from "../Services/WorkspaceUserNotificationService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import UserDiscord from "../../Models/DatabaseModels/UserDiscord";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { WorkspacePayloadMarkdown } from "../../Types/Workspace/WorkspaceMessagePayload";

export default class UserDiscordAPI extends BaseAPI<
  UserDiscord,
  UserDiscordServiceType
> {
  public constructor() {
    super(UserDiscord, UserDiscordService);

    /*
     * Sends a test direct message to the caller's own linked Discord account,
     * so "will a page actually reach me?" is answerable with one click
     * instead of a real incident.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.body["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          const item: UserDiscord | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
              discordUserId: true,
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

          if (!item.discordUserId || !item.isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This Discord account is not verified. Please remove it and add it again.",
              ),
            );
          }

          const markdownBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: "👋 This is a OneUptime test notification. Your Discord account can receive on-call notifications.",
          };

          try {
            await WorkspaceUserNotificationService.sendDirectMessageToUser({
              projectId: item.projectId!,
              workspaceType: WorkspaceType.Discord,
              workspaceUserId: item.discordUserId,
              messageBlocks: [markdownBlock],
              messageSummary: "Test notification",
              userId: item.userId!,
            });
          } catch (err) {
            const message: string =
              err instanceof Error && err.message
                ? err.message
                : "Unknown error sending test Discord message.";

            return Response.sendJsonObjectResponse(req, res, {
              ok: false,
              statusMessage: message,
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            ok: true,
            statusMessage:
              "Test message sent. Check your Discord direct messages.",
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
