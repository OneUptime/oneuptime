import UserMiddleware from "../Middleware/UserAuthorization";
import UserPushService, {
  Service as UserPushServiceType,
} from "../Services/UserPushService";
import PushNotificationService from "../Services/PushNotificationService";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
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
import UserPush from "../../Models/DatabaseModels/UserPush";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";

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

          if (!req.body.deviceToken) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device token is required"),
            );
          }

          if (!req.body.deviceType || req.body.deviceType !== "web") {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Only web device type is supported"),
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
              userId: (req as OneUptimeRequest).userAuthorization!.userId!,
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
            // Mark as used and return a specific response indicating device was already registered
            throw new BadDataException(
              "This device is already registered for push notifications",
            );
          }

          // Create new device registration
          const userPush: UserPush = new UserPush();
          userPush.userId = (
            req as OneUptimeRequest
          ).userAuthorization!.userId!;
          userPush.projectId = new ObjectID(req.body.projectId);
          userPush.deviceToken = req.body.deviceToken;
          userPush.deviceType = req.body.deviceType;
          userPush.deviceName = req.body.deviceName || "Unknown Device";
          userPush.isVerified = true; // For web push, we consider it verified immediately

          const savedDevice: UserPush = await this.service.create({
            data: userPush,
            props: {
              isRoot: true,
            },
          });

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
      `/user-push/:deviceId/test-notification`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        req = req as OneUptimeRequest;

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
        if (
          device.userId?.toString() !==
          (req as OneUptimeRequest).userAuthorization!.userId!.toString()
        ) {
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
              deviceType: device.deviceType!,
            },
            {
              isSensitive: false,
              projectId: device.projectId!,
              userId: device.userId!,
            },
          );

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            message: "Test notification sent successfully",
          });
        } catch (error: any) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(
              `Failed to send test notification: ${error.message}`,
            ),
          );
        }
      },
    );

    this.router.post(
      `/user-push/:deviceId/verify`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        req = req as OneUptimeRequest;

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
        if (
          device.userId?.toString() !==
          (req as OneUptimeRequest).userAuthorization!.userId!.toString()
        ) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Unauthorized access to device"),
          );
        }

        await this.service.verifyDevice(device._id!.toString());

        return Response.sendEmptySuccessResponse(req, res);
      },
    );

    this.router.post(
      `/user-push/:deviceId/unverify`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        req = req as OneUptimeRequest;

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
        if (
          device.userId?.toString() !==
          (req as OneUptimeRequest).userAuthorization!.userId!.toString()
        ) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Unauthorized access to device"),
          );
        }

        await this.service.unverifyDevice(device._id!.toString());

        return Response.sendEmptySuccessResponse(req, res);
      },
    );
  }
}
