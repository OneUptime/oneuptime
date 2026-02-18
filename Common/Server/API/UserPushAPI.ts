import UserMiddleware from "../Middleware/UserAuthorization";
import UserPushService, {
  Service as UserPushServiceType,
} from "../Services/UserPushService";
import UserNotificationRuleService from "../Services/UserNotificationRuleService";
import PushNotificationService from "../Services/PushNotificationService";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import logger from "../Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import ObjectID from "../../Types/ObjectID";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import UserPush from "../../Models/DatabaseModels/UserPush";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";

function getAuthenticatedUserId(req: ExpressRequest): ObjectID {
  const userId: ObjectID | undefined = (req as OneUptimeRequest)
    .userAuthorization?.userId;
  if (!userId) {
    throw new NotAuthenticatedException(
      "You must be logged in to perform this action.",
    );
  }
  return userId;
}

export default class UserPushAPI extends BaseAPI<
  UserPush,
  UserPushServiceType
> {
  public constructor() {
    super(UserPush, UserPushService);

    this.router.post(
      `/user-push/register`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const userId: ObjectID = getAuthenticatedUserId(req);

          if (!req.body.deviceToken) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device token is required"),
            );
          }

          const validDeviceTypes: string[] = Object.values(PushDeviceType);
          if (
            !req.body.deviceType ||
            !validDeviceTypes.includes(req.body.deviceType)
          ) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Device type must be one of: " + validDeviceTypes.join(", "),
              ),
            );
          }

          if (!req.body.projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is required"),
            );
          }

          // Check if device is already registered
          const existingDevice: UserPush | null = await this.service.findOneBy({
            query: {
              userId: userId,
              projectId: new ObjectID(req.body.projectId),
              deviceToken: req.body.deviceToken,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
            },
          });

          if (existingDevice) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "This device is already registered for push notifications",
              ),
            );
          }

          // Create new device registration
          const userPush: UserPush = new UserPush();
          userPush.userId = userId;
          userPush.projectId = new ObjectID(req.body.projectId);
          userPush.deviceToken = req.body.deviceToken;
          userPush.deviceType = req.body.deviceType;
          userPush.deviceName = req.body.deviceName || "Unknown Device";
          userPush.isVerified = true; // Web, iOS, and Android devices are verified immediately

          const savedDevice: UserPush = await this.service.create({
            data: userPush,
            props: {
              isRoot: true,
            },
          });

          // Create default notification rules for this registered push device
          try {
            await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
              {
                projectId: new ObjectID(req.body.projectId),
                userId,
                notificationMethod: {
                  userPushId: savedDevice.id!,
                },
              },
            );
          } catch (e) {
            logger.error(e);
          }

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            deviceId: savedDevice._id!.toString(),
          });
        } catch (error: any) {
          next(error);
        }
      },
    );

    this.router.post(
      `/user-push/unregister`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const userId: ObjectID = getAuthenticatedUserId(req);

          if (!req.body.deviceToken) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device token is required"),
            );
          }

          await this.service.deleteBy({
            query: {
              userId: userId,
              deviceToken: req.body.deviceToken,
            },
            limit: 100,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message: "Device unregistered successfully",
          });
        } catch (error) {
          return next(error);
        }
      },
    );

    this.router.post(
      `/user-push/:deviceId/test-notification`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const userId: ObjectID = getAuthenticatedUserId(req);

          if (!req.params["deviceId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device ID is required"),
            );
          }

          // Get the device
          const device: UserPush | null = await this.service.findOneById({
            id: new ObjectID(req.params["deviceId"]),
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              deviceName: true,
              deviceToken: true,
              deviceType: true,
              isVerified: true,
              projectId: true,
            },
          });

          if (!device) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device not found"),
            );
          }

          // Check if the device belongs to the current user
          if (device.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Unauthorized access to device"),
            );
          }

          if (!device.isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device is not verified"),
            );
          }

          try {
            // Send test notification
            const testMessage: PushNotificationMessage =
              PushNotificationUtil.createGenericNotification({
                title: "Test Notification from OneUptime",
                body: "This is a test notification to verify your device is working correctly.",
                clickAction: "/dashboard",
                tag: "test-notification",
                requireInteraction: false,
              });

            await PushNotificationService.sendPushNotification(
              {
                devices: [
                  {
                    token: device.deviceToken!,
                    ...(device.deviceName && {
                      name: device.deviceName,
                    }),
                  },
                ],
                message: testMessage,
                deviceType: device.deviceType! as PushDeviceType,
              },
              {
                isSensitive: false,
                projectId: device.projectId!,
                userId: device.userId!,
              },
            );
          } catch (error: any) {
            throw new BadDataException(
              `Failed to send test notification: ${error.message}`,
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message: "Test notification sent successfully",
          });
        } catch (error) {
          return next(error);
        }
      },
    );

    this.router.post(
      `/user-push/:deviceId/verify`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const userId: ObjectID = getAuthenticatedUserId(req);

          if (!req.params["deviceId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device ID is required"),
            );
          }

          const device: UserPush | null = await this.service.findOneById({
            id: new ObjectID(req.params["deviceId"]),
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
              projectId: true,
            },
          });

          if (!device) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device not found"),
            );
          }

          // Check if the device belongs to the current user
          if (device.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Unauthorized access to device"),
            );
          }

          await this.service.verifyDevice(device._id!.toString());

          // Create default notification rules for this verified push device
          try {
            await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
              {
                projectId: new ObjectID(device.projectId!.toString()),
                userId,
                notificationMethod: {
                  userPushId: device.id!,
                },
              },
            );
          } catch (e) {
            logger.error(e);
          }

          return Response.sendEmptySuccessResponse(req, res);
        } catch (error) {
          return next(error);
        }
      },
    );

    this.router.post(
      `/user-push/:deviceId/unverify`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const userId: ObjectID = getAuthenticatedUserId(req);

          if (!req.params["deviceId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device ID is required"),
            );
          }

          const device: UserPush | null = await this.service.findOneById({
            id: new ObjectID(req.params["deviceId"]),
            props: {
              isRoot: true,
            },
            select: {
              userId: true,
            },
          });

          if (!device) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device not found"),
            );
          }

          // Check if the device belongs to the current user
          if (device.userId?.toString() !== userId.toString()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Unauthorized access to device"),
            );
          }

          await this.service.unverifyDevice(device._id!.toString());

          return Response.sendEmptySuccessResponse(req, res);
        } catch (error) {
          return next(error);
        }
      },
    );
  }
}
