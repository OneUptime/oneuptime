import UserMiddleware from "../Middleware/UserAuthorization";
import CustomNotificationChannelService, {
  Service as CustomNotificationChannelServiceType,
} from "../Services/CustomNotificationChannelService";
import CustomNotificationChannelDeliveryService, {
  CustomChannelDeliveryResult,
} from "../Services/CustomNotificationChannelDeliveryService";
import ProjectService from "../Services/ProjectService";
import UserService from "../Services/UserService";
import CustomChannelActions, {
  CustomChannelActionAnswer,
} from "../Utils/OnCall/CustomChannelActions";
import { CUSTOM_CHANNEL_ACTION_TOKEN_PARAM } from "../Utils/OnCall/CustomChannelActionToken";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import TestSendAccess, { TestSendToSelfCaller } from "./TestSendAccess";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CustomChannelEvent,
  CustomChannelReference,
  buildCustomChannelTestPayload,
} from "../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CustomNotificationChannel from "../../Models/DatabaseModels/CustomNotificationChannel";
import Project from "../../Models/DatabaseModels/Project";
import User from "../../Models/DatabaseModels/User";

/*
 * Custom channels (CustomNotificationChannel).
 *
 * The CRUD routes are a master admin's alone: every access list on the model
 * is empty. Beside them:
 *
 *   POST /custom-notification-channel/available
 *     The channels that are on, by id and name, for any signed-in person:
 *     what their notification methods and on-call rules offer. Nothing else
 *     of a channel ever reaches them.
 *
 *   POST /custom-notification-channel/test
 *     Sends a test to a channel. A master admin may test any channel, on or
 *     off, as themselves; anybody else a channel that is on, as themselves,
 *     in a project they are a member of - to see a page reach them.
 *
 *   POST /custom-notification-channel/page/<notification id>/<action>?token=
 *     What the channel's service calls when the person acknowledges,
 *     escalates or resolves a page in the company's own app
 *     (CustomChannelActions). No session: the token is the proof
 *     (CustomChannelActionToken).
 */
export default class CustomNotificationChannelAPI extends BaseAPI<
  CustomNotificationChannel,
  CustomNotificationChannelServiceType
> {
  public constructor() {
    super(CustomNotificationChannel, CustomNotificationChannelService);

    const path: string = new this.entityType().getCrudApiPath()!.toString();

    this.router.post(
      `${path}/available`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const channels: Array<CustomNotificationChannel> =
            await this.service.getChannelsThatAreOn();

          return Response.sendJsonObjectResponse(req, res, {
            channels: channels.map(
              (channel: CustomNotificationChannel): JSONObject => {
                return {
                  _id: channel.id!.toString(),
                  name: channel.name || "",
                  pageEveryoneByDefault:
                    channel.pageEveryoneByDefault !== false,
                };
              },
            ),
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `${path}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const result: CustomChannelDeliveryResult = await this.sendTest(req);

          return Response.sendJsonObjectResponse(req, res, {
            ok: result.ok,
            responseStatusCode: result.statusCode || null,
            statusMessage: result.message,
          });
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `${path}/page/:notificationId/:action`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const answer: CustomChannelActionAnswer =
            await CustomChannelActions.act({
              notificationId: String(req.params["notificationId"] || ""),
              action: String(req.params["action"] || ""),
              token:
                req.query?.[CUSTOM_CHANNEL_ACTION_TOKEN_PARAM] ||
                (req.body as JSONObject | undefined)?.[
                  CUSTOM_CHANNEL_ACTION_TOKEN_PARAM
                ],
            });

          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(req, res, {
            action: answer.action,
            result: answer.result,
            message: answer.message,
          });
        } catch (err) {
          return next(err);
        }
      },
    );
  }

  private async sendTest(
    req: ExpressRequest,
  ): Promise<CustomChannelDeliveryResult> {
    const channelId: string = String(
      (req.body as JSONObject)["customNotificationChannelId"] || "",
    );

    if (!channelId || !ObjectID.isValidUUID(channelId)) {
      throw new BadDataException("Choose a custom channel to test.");
    }

    const channel: CustomNotificationChannel | null =
      await this.service.findOneById({
        id: new ObjectID(channelId),
        select: {
          _id: true,
          name: true,
          isEnabled: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!channel) {
      throw new BadDataException("This custom channel no longer exists.");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    let userId: ObjectID;
    let project: CustomChannelReference | undefined = undefined;

    if (props.isMasterAdmin && props.userId) {
      // The admin trying the channel they set up, whether it is on or not.
      userId = props.userId;
    } else {
      // A test the caller sends to themselves (TestSendAccess).
      const sender: TestSendToSelfCaller =
        await TestSendAccess.assertMaySendTestToSelf(req);

      if (!channel.isEnabled) {
        throw new BadDataException(
          `${channel.name || "This custom channel"} is turned off.`,
        );
      }

      const projectIdText: string = String(
        (req.body as JSONObject)["projectId"] || "",
      );

      if (!projectIdText || !ObjectID.isValidUUID(projectIdText)) {
        throw new NotAuthorizedException(
          "You are not authorized to access this project's data.",
        );
      }

      const projectId: ObjectID = new ObjectID(projectIdText);

      // Sent in the caller's project: only while they are a member.
      TestSendAccess.assertSenderIsMemberOf({
        sender: sender,
        projectId: projectId,
      });

      userId = sender.userId;

      const projectRow: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      project = {
        id: projectId.toString(),
        name: projectRow?.name || "",
      };
    }

    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    return await CustomNotificationChannelDeliveryService.send({
      customNotificationChannelId: channel.id!,
      eventType: CustomChannelEvent.Test,
      isTest: true,
      // A member's test is sent in their project, which may be blocked.
      projectId: project ? new ObjectID(project.id) : undefined,
      payload: buildCustomChannelTestPayload({
        sentAt: new Date(),
        channel: {
          id: channel.id!.toString(),
          name: channel.name || "",
        },
        user: {
          id: userId.toString(),
          name: user?.name?.toString() || "",
          email: user?.email?.toString() || "",
        },
        project: project,
      }),
    });
  }
}
