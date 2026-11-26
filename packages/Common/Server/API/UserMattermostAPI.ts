import UserMiddleware from "../Middleware/UserAuthorization";
import UserMattermostService, {
  Service as UserMattermostServiceType,
} from "../Services/UserMattermostService";
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
import { ChannelVerificationMessages } from "../../Types/UserNotification/ChannelVerificationMessages";
import UserMattermost from "../../Models/DatabaseModels/UserMattermost";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { WorkspacePayloadMarkdown } from "../../Types/Workspace/WorkspaceMessagePayload";

export default class UserMattermostAPI extends BaseAPI<
  UserMattermost,
  UserMattermostServiceType
> {
  public constructor() {
    super(UserMattermost, UserMattermostService);

    /*
     * Sends a test direct message to the caller's own linked Mattermost
     * account, so "will a page actually reach me?" is answerable with one
     * click instead of a real incident.
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
              new BadDataException(ChannelVerificationMessages.noItemToTest),
            );
          }

          const item: UserMattermost | null = await this.service.findOneById({
            id: req.body["itemId"],
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
              mattermostUserId: true,
              isVerified: true,
            },
          });

          /*
           * Somebody else's method is answered exactly like one that does
           * not exist (#7272): the answer never says whether an id is
           * someone's.
           */
          if (!item || item.userId?.toString() !== sender.userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(ChannelVerificationMessages.notFound),
            );
          }

          // Sent in the method's project: only while the caller is a member.
          TestSendAccess.assertSenderIsMemberOf({
            sender: sender,
            projectId: item.projectId,
          });

          if (!item.mattermostUserId || !item.isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This Mattermost account is not verified. Please remove it and add it again.",
              ),
            );
          }

          const markdownBlock: WorkspacePayloadMarkdown = {
            _type: "WorkspacePayloadMarkdown",
            text: "👋 This is a OneUptime test notification. Your Mattermost account can receive on-call notifications.",
          };

          try {
            await WorkspaceUserNotificationService.sendDirectMessageToUser({
              projectId: item.projectId!,
              workspaceType: WorkspaceType.Mattermost,
              workspaceUserId: item.mattermostUserId,
              messageBlocks: [markdownBlock],
              messageSummary: "Test notification",
              userId: item.userId!,
            });
          } catch (err) {
            const message: string =
              err instanceof Error && err.message
                ? err.message
                : "The test message was not sent, and Mattermost did not say why. Try again in a moment.";

            return Response.sendJsonObjectResponse(req, res, {
              ok: false,
              statusMessage: message,
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            ok: true,
            statusMessage:
              "Test message sent. Check your Mattermost direct messages.",
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }
}
