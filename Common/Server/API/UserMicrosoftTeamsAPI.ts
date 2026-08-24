import UserMiddleware from "../Middleware/UserAuthorization";
import UserMicrosoftTeamsService, {
  Service as UserMicrosoftTeamsServiceType,
} from "../Services/UserMicrosoftTeamsService";
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
import UserMicrosoftTeams from "../../Models/DatabaseModels/UserMicrosoftTeams";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { WorkspacePayloadMarkdown } from "../../Types/Workspace/WorkspaceMessagePayload";

export default class UserMicrosoftTeamsAPI extends BaseAPI<
  UserMicrosoftTeams,
  UserMicrosoftTeamsServiceType
> {
  public constructor() {
    super(UserMicrosoftTeams, UserMicrosoftTeamsService);

    /*
     * Sends a test direct message to the caller's own linked Microsoft Teams
     * account. Worth a click on this channel more than any other: a Teams DM
     * needs the OneUptime app installed for the user, and this surfaces the
     * actionable "install the app" error before a real page depends on it.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test`,
      UserMiddleware.getUserMiddleware,
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

          const item: UserMicrosoftTeams | null =
            await this.service.findOneById({
              id: req.body["itemId"],
              props: {
                isRoot: true,
              },
              select: {
                userId: true,
                projectId: true,
                microsoftTeamsUserId: true,
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

          if (!item.microsoftTeamsUserId || !item.isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This Microsoft Teams account is not verified. Please remove it and add it again.",
              ),
            );
          }

          const markdownBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: "👋 This is a OneUptime test notification. Your Microsoft Teams account can receive on-call notifications.",
          };

          try {
            await WorkspaceUserNotificationService.sendDirectMessageToUser({
              projectId: item.projectId!,
              workspaceType: WorkspaceType.MicrosoftTeams,
              workspaceUserId: item.microsoftTeamsUserId,
              messageBlocks: [markdownBlock],
              messageSummary: "Test notification",
              userId: item.userId!,
            });
          } catch (err) {
            const message: string =
              err instanceof Error && err.message
                ? err.message
                : "Unknown error sending test Microsoft Teams message.";

            return Response.sendJsonObjectResponse(req, res, {
              ok: false,
              statusMessage: message,
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            ok: true,
            statusMessage:
              "Test message sent. Check your Microsoft Teams chats.",
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
