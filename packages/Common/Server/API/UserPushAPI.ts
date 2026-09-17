import UserMiddleware from "../Middleware/UserAuthorization";
import UserPushService, {
  Service as UserPushServiceType,
} from "../Services/UserPushService";
import UserNotificationRuleService from "../Services/UserNotificationRuleService";
import PushNotificationService from "../Services/PushNotificationService";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
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

/*
 * Booleans arrive from the mobile client as JSON booleans, but the same routes
 * get called by hand and from form posts where "true" is a string.
 *
 * On REGISTRATION, absence is the normal case and means off: overriding a
 * silenced phone is never something a device registration turns on by itself.
 */
export function parseCriticalAlertFlag(raw: unknown): boolean {
  return raw === true || raw === "true";
}

/*
 * On the toggle route the caller is stating an intent, so an unrecognised
 * value is refused rather than read as false. Quietly storing "off" for a
 * client that meant "on" leaves a responder believing their phone will ring
 * while it will not, and nothing surfaces the mistake until a missed page.
 */
export function parseCriticalAlertFlagStrict(raw: unknown): boolean {
  if (raw === true || raw === "true") {
    return true;
  }

  if (raw === false || raw === "false") {
    return false;
  }

  throw new BadDataException("isEnabled must be either true or false.");
}

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
          /*
           * The mobile app sends this when the responder already had critical
           * alerts on and the device is re-registering (a reinstall, a new push
           * token, a second project). Absent, it stays off: overriding a
           * silenced phone is never something a registration turns on by
           * itself.
           */
          userPush.isCriticalAlertEnabled = parseCriticalAlertFlag(
            req.body.isCriticalAlertEnabled,
          );

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
            logger.error(
              e,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
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
              isCriticalAlertEnabled: true,
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
            const isCriticalAlert: boolean = Boolean(
              device.isCriticalAlertEnabled,
            );

            /*
             * A test that behaves unlike the real page is not a test of
             * anything. Critical alerts are the one setting whose effect a
             * responder cannot check by reasoning about it - they have to
             * silence the phone and hear it ring - so a device with the option
             * on gets a test that overrides silent mode exactly as a 3am page
             * would.
             */
            const testMessage: PushNotificationMessage =
              PushNotificationUtil.createGenericNotification({
                title: isCriticalAlert
                  ? "Test Critical Alert from OneUptime"
                  : "Test Notification from OneUptime",
                body: isCriticalAlert
                  ? "This is a test critical alert. If your device is silenced or in Do Not Disturb and you heard this, on-call pages will reach you."
                  : "This is a test notification to verify your device is working correctly.",
                clickAction: "/dashboard",
                tag: "test-notification",
                requireInteraction: false,
              });

            testMessage.isCriticalAlert = isCriticalAlert;

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

    /*
     * Turn "ring me through silent mode" on or off for this handset.
     *
     * A dedicated route rather than the generic CRUD update, for the same
     * reason verify/unverify are: UserPush grants no update permission to
     * anybody, so every write to it passes an explicit ownership check first
     * and then runs as root. That keeps the set of things that can change a
     * responder's paging configuration short and readable.
     *
     * Keyed on the device token, like unregister and unlike verify: the mobile
     * app knows its own push token and holds no row ids, and one phone has a
     * row per project it is registered against.
     */
    this.router.post(
      `/user-push/critical-alerts`,
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

          /*
           * Required rather than defaulted. A request that forgot the field
           * would otherwise silently turn the setting OFF, and a responder
           * whose pages stopped overriding Do Not Disturb has no way to notice
           * until the page they missed.
           */
          if (req.body.isEnabled === undefined || req.body.isEnabled === null) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("isEnabled is required"),
            );
          }

          const isEnabled: boolean = parseCriticalAlertFlagStrict(
            req.body.isEnabled,
          );

          const updatedCount: number =
            await this.service.setCriticalAlertEnabledForDeviceToken({
              userId: userId,
              deviceToken: req.body.deviceToken,
              isEnabled: isEnabled,
            });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            isCriticalAlertEnabled: isEnabled,
            devicesUpdated: updatedCount,
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
            logger.error(
              e,
              getLogAttributesFromRequest(req as OneUptimeRequest),
            );
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
