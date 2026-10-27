import MasterAdminAuthorization from "../Middleware/MasterAdminAuthorization";
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
import CustomChannelEdition from "../Utils/Notification/CustomChannelEdition";

/*
 * Custom channels (CustomNotificationChannel).
 *
 * The CRUD routes are a master admin's alone: every access list on the model
 * is empty. Custom channels are an Enterprise feature (CustomChannelEdition):
 * adding or changing one needs it (EditionPermissions), and so do the tests
 * below. Beside them:
 *
 *   POST /custom-notification-channel/available
 *     The channels that are on, by id and name, for any signed-in person:
 *     what their notification methods and on-call rules offer. Nothing else
 *     of a channel ever reaches them - and none while the feature is not
 *     active.
 *
 *   POST /custom-notification-channel/test
 *     A test a person sends to themselves through a channel that is on, in a
 *     project they are a member of - to see a page reach them.
 *
 *   POST /custom-notification-channel/instance/test
 *     A master admin trying a channel they set up, whether it is on or not.
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
          // A test the caller sends to themselves (TestSendAccess).
          const sender: TestSendToSelfCaller =
            await TestSendAccess.assertMaySendTestToSelf(req);

          // An Enterprise feature: refused, saying so, without a license for it.
          await CustomChannelEdition.assertAvailable();

          const channel: CustomNotificationChannel | null =
            await this.service.findOneById({
              id: this.readTestChannelId(req),
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

          if (!channel.isEnabled) {
            throw new BadDataException(
              `${channel.name || "This custom channel"} is turned off.`,
            );
          }

          /*
           * Sent in the caller's project, as a real page to them would be:
           * only while they are a member there.
           */
          const projectId: ObjectID = this.readTestProjectId(req);

          TestSendAccess.assertSenderIsMemberOf({
            sender: sender,
            projectId: projectId,
          });

          const project: Project | null = await ProjectService.findOneById({
            id: projectId,
            select: {
              _id: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

          const result: CustomChannelDeliveryResult =
            await this.sendCustomChannelTest({
              channel: channel,
              userId: sender.userId,
              project: {
                id: projectId.toString(),
                name: project?.name || "",
              },
            });

          return this.sendTestAnswer(req, res, result);
        } catch (err) {
          return next(err);
        }
      },
    );

    this.router.post(
      `${path}/instance/test`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.userId) {
            throw new NotAuthorizedException(
              "Sign in as a master admin to test a custom channel.",
            );
          }

          // An Enterprise feature: refused, saying so, without a license for it.
          await CustomChannelEdition.assertAvailable();

          /*
           * The admin trying the channel they set up, whether it is on or
           * not, as themselves. It is the instance's setup being tried, so
           * it names no project and nobody's project is billed for it.
           */
          const channel: CustomNotificationChannel | null =
            await this.service.findOneById({
              id: this.readTestChannelId(req),
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

          const result: CustomChannelDeliveryResult =
            await this.sendCustomChannelTest({
              channel: channel,
              userId: props.userId,
              project: undefined,
            });

          return this.sendTestAnswer(req, res, result);
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

  private sendTestAnswer(
    req: ExpressRequest,
    res: ExpressResponse,
    result: CustomChannelDeliveryResult,
  ): void {
    return Response.sendJsonObjectResponse(req, res, {
      ok: result.ok,
      responseStatusCode: result.statusCode || null,
      statusMessage: result.message,
    });
  }

  // The channel a test names.
  private readTestChannelId(req: ExpressRequest): ObjectID {
    const channelId: string = String(
      (req.body as JSONObject)["customNotificationChannelId"] || "",
    );

    if (!channelId || !ObjectID.isValidUUID(channelId)) {
      throw new BadDataException("Choose a custom channel to test.");
    }

    return new ObjectID(channelId);
  }

  // The project a person's own test is sent in.
  private readTestProjectId(req: ExpressRequest): ObjectID {
    const projectId: string = String(
      (req.body as JSONObject)["projectId"] || "",
    );

    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      throw new NotAuthorizedException(
        "You are not authorized to access this project's data.",
      );
    }

    return new ObjectID(projectId);
  }

  private async sendCustomChannelTest(data: {
    channel: CustomNotificationChannel;
    userId: ObjectID;
    project: CustomChannelReference | undefined;
  }): Promise<CustomChannelDeliveryResult> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
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
      customNotificationChannelId: data.channel.id!,
      eventType: CustomChannelEvent.Test,
      isTest: true,
      // A member's test is sent in their project, which may be blocked.
      projectId: data.project ? new ObjectID(data.project.id) : undefined,
      payload: buildCustomChannelTestPayload({
        sentAt: new Date(),
        channel: {
          id: data.channel.id!.toString(),
          name: data.channel.name || "",
        },
        user: {
          id: data.userId.toString(),
          name: user?.name?.toString() || "",
          email: user?.email?.toString() || "",
        },
        project: data.project,
      }),
    });
  }
}
