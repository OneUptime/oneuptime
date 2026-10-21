import UserMiddleware from "../Middleware/UserAuthorization";
import UserSlackService, {
  Service as UserSlackServiceType,
} from "../Services/UserSlackService";
import WorkspaceUserNotificationService from "../Services/WorkspaceUserNotificationService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import TestSendAccess, { TestSendToSelfCaller } from "./TestSendAccess";
import BadDataException from "../../Types/Exception/BadDataException";
import UserSlack from "../../Models/DatabaseModels/UserSlack";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { WorkspacePayloadMarkdown } from "../../Types/Workspace/WorkspaceMessagePayload";

export default class UserSlackAPI extends BaseAPI<
  UserSlack,
  UserSlackServiceType
> {
  public constructor() {
    super(UserSlack, UserSlackService);

    /*
     * Sends a test direct message to the caller's own linked Slack account,
     * so "will a page actually reach me?" is answerable with one click
     * instead of a real incident.
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          // A test to the caller's own account (TestSendAccess).
          const sender: TestSendToSelfCaller =
            await TestSendAccess.assertMaySendTestToSelf(req);

          if (!req.body["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          const item: UserSlack | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
              slackUserId: true,
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

          if (item.userId?.toString() !== sender.userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid user ID"),
            );
          }

          // Sent in the method's project: only while the caller is a member.
          TestSendAccess.assertSenderIsMemberOf({
            sender: sender,
            projectId: item.projectId,
          });

          if (!item.slackUserId || !item.isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This Slack account is not verified. Please remove it and add it again.",
              ),
            );
          }

          const markdownBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: "👋 This is a OneUptime test notification. Your Slack account can receive on-call notifications.",
          };

          try {
            await WorkspaceUserNotificationService.sendDirectMessageToUser({
              projectId: item.projectId!,
              workspaceType: WorkspaceType.Slack,
              workspaceUserId: item.slackUserId,
              messageBlocks: [markdownBlock],
              messageSummary: "Test notification",
              userId: item.userId!,
            });
          } catch (err) {
            const message: string =
              err instanceof Error && err.message
                ? err.message
                : "Unknown error sending test Slack message.";

            return Response.sendJsonObjectResponse(req, res, {
              ok: false,
              statusMessage: message,
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            ok: true,
            statusMessage:
              "Test message sent. Check your Slack direct messages.",
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
