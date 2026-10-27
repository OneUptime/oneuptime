import UserMiddleware from "../Middleware/UserAuthorization";
import UserPushService, {
  Service as UserPushServiceType,
} from "../Services/UserPushService";
import UserNotificationRuleService from "../Services/UserNotificationRuleService";
import PushNotificationService from "../Services/PushNotificationService";
import GlobalConfigService from "../Services/GlobalConfigService";
import { PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE } from "../../Types/PushNotification/PushNotificationsTurnedOff";
import ExpoPushReceiptQueue from "../Infrastructure/ExpoPushReceiptQueue";
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
import TestSendAccess, { TestSendToSelfCaller } from "./TestSendAccess";
import ProjectMembership from "../Utils/TeamMember/ProjectMembership";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { JSONObject, ObjectType } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import { isExpoPushDeviceType } from "../../Types/PushNotification/ExpoPushDeviceType";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
  isCriticalAlertSound,
} from "../../Types/PushNotification/CriticalAlertSound";
import {
  CRITICAL_ALERT_VOLUME_MAX_PERCENT,
  CRITICAL_ALERT_VOLUME_MIN_PERCENT,
  isCriticalAlertVolumePercent,
} from "../../Types/PushNotification/CriticalAlertVolume";
import UserPush from "../../Models/DatabaseModels/UserPush";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";

/*
 * Booleans arrive from the mobile client as JSON booleans, but the same routes
 * get called by hand and from form posts where "true" is a string.
 *
 * What a request states about critical alerts, or undefined when it states
 * nothing: absent, or anything but a boolean or its string. The three
 * readings of the flag below differ only in what that undefined means.
 *
 * On a registration of a device that is ALREADY registered it means "keep
 * what the device holds". The app restates the flag on every registration
 * (MobileApp pushDevice.ts) - in apps newer than 1.6.0 as what the phone will
 * really do with a critical page, the responder's switch and the phone's own
 * permission together - and the device takes it (UserPushService
 * .restateCriticalAlertEnabled). A registration that does not mention it (an
 * app from before critical alerts, one that could not ask the OS, a
 * hand-made request) changes nothing.
 */
export function readStatedCriticalAlertFlag(raw: unknown): boolean | undefined {
  if (raw === true || raw === "true") {
    return true;
  }

  if (raw === false || raw === "false") {
    return false;
  }

  return undefined;
}

/*
 * On a NEW device's registration, absence is the normal case and means off:
 * overriding a silenced phone is never something a device registration turns
 * on by itself.
 */
export function parseCriticalAlertFlag(raw: unknown): boolean {
  return readStatedCriticalAlertFlag(raw) === true;
}

/*
 * On the toggle route the caller is stating an intent, so an unrecognised
 * value is refused rather than read as false. Quietly storing "off" for a
 * client that meant "on" leaves a responder believing their phone will ring
 * while it will not, and nothing surfaces the mistake until a missed page.
 */
export function parseCriticalAlertFlagStrict(raw: unknown): boolean {
  const stated: boolean | undefined = readStatedCriticalAlertFlag(raw);

  if (stated === undefined) {
    throw new BadDataException("isEnabled must be either true or false.");
  }

  return stated;
}

/*
 * Whether a test notification to this device goes out as a critical alert:
 * a phone whose critical alerts are on, as its app last reported them. Never
 * a browser, which cannot ring through silent mode whatever is stored for it.
 */
export function isTestNotificationCritical(device: {
  deviceType?: unknown;
  isCriticalAlertEnabled?: boolean | undefined;
}): boolean {
  return (
    isExpoPushDeviceType(device.deviceType) &&
    Boolean(device.isCriticalAlertEnabled)
  );
}

/*
 * The alarm and volume a phone registers with (the app restates its stored
 * choices on every registration, like isCriticalAlertEnabled). Read leniently:
 * a registration is how a phone gets paged at all, so a value this server does
 * not know - a sound added by a newer app - must not refuse it. Unknown or
 * absent reads as "not given", and the column's default (the system's own
 * critical sound, at full volume) applies.
 */
export function parseCriticalAlertSoundFromRegistration(
  raw: unknown,
): CriticalAlertSound | undefined {
  return isCriticalAlertSound(raw) ? raw : undefined;
}

export function parseCriticalAlertVolumeFromRegistration(
  raw: unknown,
): number | undefined {
  return isCriticalAlertVolumePercent(raw) ? raw : undefined;
}

/*
 * On the preferences route the caller is choosing, so a value this server
 * cannot honour is refused and named, rather than stored or quietly replaced
 * by the default. Absent means "keep what is stored".
 */
export function parseCriticalAlertSoundStrict(
  raw: unknown,
): CriticalAlertSound | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!isCriticalAlertSound(raw)) {
    throw new BadDataException(
      `sound must be one of: ${CRITICAL_ALERT_SOUNDS.map(
        (definition: CriticalAlertSoundDefinition): string => {
          return definition.sound;
        },
      ).join(", ")}.`,
    );
  }

  return raw;
}

export function parseCriticalAlertVolumeStrict(
  raw: unknown,
): number | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!isCriticalAlertVolumePercent(raw)) {
    throw new BadDataException(
      `volume must be a whole number from ${CRITICAL_ALERT_VOLUME_MIN_PERCENT} to ${CRITICAL_ALERT_VOLUME_MAX_PERCENT}.`,
    );
  }

  return raw;
}

/*
 * The project a registration names. The mobile app sends the id as a string.
 * The Dashboard sent the ObjectID itself, which JSON writes as
 * { _type: "ObjectID", value: "<id>" } (ObjectID.toJSON), and a browser keeps
 * running that Dashboard until it reloads. Both name the same project.
 * Reading the second with toString() gave "[object Object]", and every
 * browser registration was refused as "Project ID is invalid". Anything else
 * is not a project id: null.
 */
export function readProjectIdFromBody(raw: unknown): ObjectID | null {
  let value: unknown = raw;

  if (raw instanceof ObjectID) {
    value = raw.toString();
  } else if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as JSONObject)["_type"] === ObjectType.ObjectID
  ) {
    value = (raw as JSONObject)["value"];
  }

  if (typeof value !== "string") {
    return null;
  }

  const projectId: string = value.trim();

  if (!ObjectID.isValidUUID(projectId)) {
    return null;
  }

  return new ObjectID(projectId);
}

/*
 * The push token the mobile app had before the one it registers, when it
 * says: it got a new one on a phone where it kept its data (a phone set up
 * from a backup of the old one), and the device registered with the old one
 * is this phone (UserPushService.renewExpoPushDevice). Only an Expo push
 * token, from a phone, that is not the token being registered. Anything else
 * is not one, and is ignored rather than refused: a registration never fails
 * over it.
 */
export function readPreviousExpoPushToken(data: {
  previousDeviceToken: unknown;
  deviceToken: unknown;
  deviceType: unknown;
}): string | null {
  const previous: unknown = data.previousDeviceToken;

  if (
    !isExpoPushDeviceType(data.deviceType) ||
    typeof previous !== "string" ||
    !previous ||
    previous === data.deviceToken ||
    !PushNotificationService.isValidExpoPushToken(previous)
  ) {
    return null;
  }

  return previous;
}

/*
 * A push device is registered for one project and pages its owner on that
 * project's behalf, so only a member of the project may register one (or
 * turn one back on): somebody who has left cannot give themselves a way to
 * be reached by it again. The project named in the request is checked, not
 * trusted (ProjectMembership).
 */
export async function assertUserIsMemberOfProject(data: {
  userId: ObjectID;
  projectId: ObjectID;
}): Promise<void> {
  const memberUserIds: Set<string> = await ProjectMembership.getMemberUserIds({
    projectId: data.projectId,
    userIds: [data.userId],
  });

  if (!memberUserIds.has(data.userId.toString().toLowerCase())) {
    throw new NotAuthorizedException(
      "You are not authorized to access this project's data.",
    );
  }
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

          /*
           * No device is registered while the server has push turned off
           * (PushNotificationsTurnedOff): nothing would reach it. The
           * mobile app takes the refusal as it takes any other, and asks
           * again the next time it starts.
           */
          if (await GlobalConfigService.getPushNotificationsTurnedOff()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE),
            );
          }

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

          const projectId: ObjectID | null = readProjectIdFromBody(
            req.body.projectId,
          );

          if (!projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Project ID is invalid"),
            );
          }

          await assertUserIsMemberOfProject({
            userId: userId,
            projectId: projectId,
          });

          /*
           * The app asked Expo for this token just before, which renews it
           * there. A push sent before now whose receipt says the token was
           * gone is about the token as it was, and does not mark the phone
           * (ExpoPushReceiptService): an iPhone keeps its token through a
           * reinstall, so a page sent while the app was removed is refused
           * in its receipt after the app is back. Only an Expo push token
           * from a phone is noted: nothing else is one a receipt names.
           */
          if (
            isExpoPushDeviceType(req.body.deviceType) &&
            PushNotificationService.isValidExpoPushToken(req.body.deviceToken)
          ) {
            await ExpoPushReceiptQueue.noteTokenRegistered(
              req.body.deviceToken,
            );
          }

          // Check if device is already registered
          const existingDevice: UserPush | null = await this.service.findOneBy({
            query: {
              userId: userId,
              projectId: projectId,
              deviceToken: req.body.deviceToken,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              isVerified: true,
              deviceType: true,
              isCriticalAlertEnabled: true,
            },
          });

          /*
           * Registering a device that is already registered is not a
           * mistake: it is Register Device pressed again in a browser that
           * already gets this project's notifications, or the mobile app
           * registering on launch. The caller is told which device they
           * already have, and nothing is created.
           *
           * isVerified false, for a browser: the push service no longer
           * accepts the subscription the browser still holds
           * (UserPushService.markWebPushSubscriptionAsGone). The Dashboard
           * then gets a new one and reports it (subscription-change), so the
           * device it already has receives notifications again.
           */
          if (existingDevice) {
            /*
             * A phone restates whether a critical page rings through on it
             * every time it registers, and its device takes it, so the
             * Dashboard's device list, a test notification and every page
             * follow what the phone will really do. Said back to the app,
             * which tells the server again itself when this does not match
             * (an older server says nothing here). A browser has none.
             *
             * Never in the way of the registration itself: a write that
             * failed leaves the answer without it - the app then tells the
             * server outright - and a phone Expo said was gone is still
             * verified again below.
             */
            let criticalAlertAnswer: JSONObject = {};

            if (isExpoPushDeviceType(existingDevice.deviceType)) {
              try {
                criticalAlertAnswer = {
                  isCriticalAlertEnabled:
                    await this.service.restateCriticalAlertEnabled({
                      device: existingDevice,
                      isCriticalAlertEnabled: readStatedCriticalAlertFlag(
                        req.body.isCriticalAlertEnabled,
                      ),
                    }),
                };
              } catch (restateError) {
                logger.error(
                  restateError,
                  getLogAttributesFromRequest(req as OneUptimeRequest),
                );
              }
            }

            /*
             * A phone that stopped receiving notifications - Expo said its
             * token was gone (UserPushService.markExpoPushTokenAsGone) - and
             * registers that token again. The app asked Expo for the token
             * just before, which renews it there, so the device receives
             * notifications again, with its rules. Before, it stayed marked
             * however often the app registered it, and only deleting the
             * device (and its rules) brought the phone back.
             */
            if (
              !existingDevice.isVerified &&
              isExpoPushDeviceType(existingDevice.deviceType)
            ) {
              const deviceId: ObjectID = new ObjectID(
                existingDevice._id!.toString(),
              );

              /*
               * Nothing to verify again: a registration a moment earlier
               * verified it already, or it is gone. Said as it is now.
               */
              const isVerified: boolean =
                (await this.service.verifyExpoPushDeviceRegisteredAgain(
                  deviceId,
                )) ||
                Boolean(
                  (
                    await this.service.findOneById({
                      id: deviceId,
                      select: {
                        isVerified: true,
                      },
                      props: {
                        isRoot: true,
                      },
                    })
                  )?.isVerified,
                );

              return Response.sendJsonObjectResponse(req, res, {
                success: true,
                deviceId: deviceId.toString(),
                alreadyRegistered: true,
                isVerified: isVerified,
                ...criticalAlertAnswer,
              });
            }

            return Response.sendJsonObjectResponse(req, res, {
              success: true,
              deviceId: existingDevice._id!.toString(),
              alreadyRegistered: true,
              isVerified: Boolean(existingDevice.isVerified),
              ...criticalAlertAnswer,
            });
          }

          /*
           * A new token from a phone that says which token it had before:
           * its device here carries the new one from now on, with its
           * rules, instead of a new device with default rules beside an old
           * one that can no longer be reached.
           */
          const previousDeviceToken: string | null = readPreviousExpoPushToken({
            previousDeviceToken: req.body.previousDeviceToken,
            deviceToken: req.body.deviceToken,
            deviceType: req.body.deviceType,
          });

          if (previousDeviceToken) {
            const statedCriticalAlertEnabled: boolean | undefined =
              readStatedCriticalAlertFlag(req.body.isCriticalAlertEnabled);

            const renewedDevice: UserPush | null =
              await this.service.renewExpoPushDevice({
                userId: userId,
                projectId: projectId,
                previousDeviceToken: previousDeviceToken,
                deviceToken: req.body.deviceToken,
                deviceType: req.body.deviceType as PushDeviceType,
                deviceName: req.body.deviceName || "Unknown Device",
                isCriticalAlertEnabled: statedCriticalAlertEnabled,
                criticalAlertSound: parseCriticalAlertSoundFromRegistration(
                  req.body.criticalAlertSound,
                ),
                criticalAlertVolume: parseCriticalAlertVolumeFromRegistration(
                  req.body.criticalAlertVolume,
                ),
              });

            if (renewedDevice) {
              return Response.sendJsonObjectResponse(req, res, {
                success: true,
                deviceId: renewedDevice._id!.toString(),
                alreadyRegistered: true,
                isVerified: true,
                // What the device holds now: the phone's flag, or its own.
                isCriticalAlertEnabled:
                  statedCriticalAlertEnabled ??
                  Boolean(renewedDevice.isCriticalAlertEnabled),
              });
            }

            /*
             * A registration a moment earlier - the app registers again
             * when its projects change - may have renewed it already, after
             * the lookup above. That device is this phone's: it is named,
             * and no second device is made for the same token.
             */
            const renewedMeanwhile: UserPush | null =
              await this.service.findOneBy({
                query: {
                  userId: userId,
                  projectId: projectId,
                  deviceToken: req.body.deviceToken,
                },
                select: {
                  _id: true,
                  isVerified: true,
                },
                props: {
                  isRoot: true,
                },
              });

            if (renewedMeanwhile) {
              return Response.sendJsonObjectResponse(req, res, {
                success: true,
                deviceId: renewedMeanwhile._id!.toString(),
                alreadyRegistered: true,
                isVerified: Boolean(renewedMeanwhile.isVerified),
              });
            }
          }

          // Create new device registration
          const userPush: UserPush = new UserPush();
          userPush.userId = userId;
          userPush.projectId = projectId;
          userPush.deviceToken = req.body.deviceToken;
          userPush.deviceType = req.body.deviceType;
          userPush.deviceName = req.body.deviceName || "Unknown Device";
          userPush.isVerified = true; // Web, iOS, and Android devices are verified immediately
          /*
           * The mobile app sends this when the responder already had critical
           * alerts on and the device is re-registering (a reinstall, a new push
           * token, a second project). Absent, it stays off: overriding a
           * silenced phone is never something a registration turns on by
           * itself. Nor is a browser ever given it: no browser can ring
           * through silent mode, and a browser's device that said "on" would
           * read back as though it could.
           */
          const isPhone: boolean = isExpoPushDeviceType(req.body.deviceType);

          userPush.isCriticalAlertEnabled =
            isPhone && parseCriticalAlertFlag(req.body.isCriticalAlertEnabled);

          /*
           * The alarm and volume the phone chose, when it says (a reinstall,
           * a new token, a second project). Not given, the defaults apply.
           */
          const criticalAlertSound: CriticalAlertSound | undefined =
            parseCriticalAlertSoundFromRegistration(
              req.body.criticalAlertSound,
            );

          if (criticalAlertSound) {
            userPush.criticalAlertSound = criticalAlertSound;
          }

          const criticalAlertVolume: number | undefined =
            parseCriticalAlertVolumeFromRegistration(
              req.body.criticalAlertVolume,
            );

          if (criticalAlertVolume !== undefined) {
            userPush.criticalAlertVolume = criticalAlertVolume;
          }

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
                projectId: projectId,
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
            alreadyRegistered: false,
            isVerified: true,
            ...(isPhone
              ? {
                  isCriticalAlertEnabled: Boolean(
                    userPush.isCriticalAlertEnabled,
                  ),
                }
              : {}),
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

    /*
     * A browser replaced its push subscription, or lost it. The Dashboard's
     * service worker (sw.js.template) calls this from its
     * pushsubscriptionchange handler, and again when the Dashboard is next
     * opened if the call could not be made then. Until this route existed the
     * worker sent the new subscription nowhere, and the browser's devices kept
     * the old one until every notification to them failed.
     *
     * Keyed on the old subscription, like unregister and critical-alerts: the
     * worker knows the subscription it had and holds no row ids, and one
     * browser has a device per project it is registered in.
     *
     * Authenticated by the person's session, like every route here: a service
     * worker's fetch carries the Dashboard's cookies (same origin, SameSite
     * lax), and the worker refreshes a session whose access token has expired
     * before it gives up. Only the caller's own devices change.
     *
     * POST rather than PUT: PUT /user-push/:id is the generic update, and
     * would read "subscription-change" as a device id.
     */
    this.router.post(
      `/user-push/subscription-change`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const userId: ObjectID = getAuthenticatedUserId(req);

          const oldDeviceToken: unknown = req.body.oldDeviceToken;

          if (!oldDeviceToken || typeof oldDeviceToken !== "string") {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("oldDeviceToken is required"),
            );
          }

          const newDeviceToken: unknown = req.body.newDeviceToken;

          if (newDeviceToken === undefined) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "newDeviceToken is required: the new subscription, or null when the browser has none",
              ),
            );
          }

          /*
           * null, said outright: the browser has no subscription any more -
           * notifications were blocked for the site, or it could not get a
           * new one. Its devices stop being verified now, rather than at the
           * next page that fails to reach them.
           */
          if (newDeviceToken === null) {
            const markedCount: number =
              await this.service.markWebPushSubscriptionAsGone({
                deviceToken: oldDeviceToken,
                userId: userId,
              });

            return Response.sendJsonObjectResponse(req, res, {
              success: true,
              devicesUpdated: markedCount,
            });
          }

          PushNotificationService.assertIsWebPushSubscription(newDeviceToken);

          const memberProjectIds: Array<ObjectID> =
            await ProjectMembership.getMemberProjectIds({
              userId: userId,
            });

          const renewedCount: number =
            await this.service.replaceWebPushSubscription({
              userId: userId,
              oldDeviceToken: oldDeviceToken,
              newDeviceToken: newDeviceToken as string,
              memberProjectIds: memberProjectIds,
            });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            devicesUpdated: renewedCount,
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
          // A test to the caller's own device (TestSendAccess).
          const sender: TestSendToSelfCaller =
            await TestSendAccess.assertMaySendTestToSelf(req);
          const userId: ObjectID = sender.userId;

          // Said outright, rather than sent nowhere, while push is off.
          if (await GlobalConfigService.getPushNotificationsTurnedOff()) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE),
            );
          }

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
              criticalAlertSound: true,
              criticalAlertVolume: true,
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

          // Sent in the device's project: only while the caller is a member.
          TestSendAccess.assertSenderIsMemberOf({
            sender: sender,
            projectId: device.projectId,
          });

          /*
           * A device stops being verified when its push subscription is gone
           * (UserPushService.markWebPushSubscriptionAsGone), or Expo says its
           * token is (markExpoPushTokenAsGone), and nothing is sent to it.
           * Said in those words: "Device is not verified" told nobody what to
           * do. A phone registers again when its app is opened.
           */
          if (!device.isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                isExpoPushDeviceType(device.deviceType)
                  ? PushNotificationService.EXPO_DEVICE_NOT_RECEIVING_MESSAGE
                  : "This device no longer receives push notifications. Register it again from the browser or app it belongs to.",
              ),
            );
          }

          /*
           * A test that behaves unlike the real page is not a test of
           * anything. Critical alerts are the one setting whose effect a
           * responder cannot check by reasoning about it - they have to
           * silence the phone and hear it ring - so a device with the option
           * on gets a test that overrides silent mode exactly as a 3am page
           * would. The device as it is now: its app reports whether its
           * critical alerts are on, and the list the test was sent from may
           * have been read before it last did.
           */
          const isCriticalAlert: boolean = isTestNotificationCritical(device);

          try {
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
            // With the alarm and volume a real page would play.
            testMessage.criticalAlertSound = device.criticalAlertSound;
            testMessage.criticalAlertVolume = device.criticalAlertVolume;

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
            /*
             * Whether it went as a critical alert. The Dashboard says what
             * the test did from this, not from its list, which can be older
             * than the phone's last report.
             */
            isCriticalAlert: isCriticalAlert,
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
     *
     * The app calls it when the responder moves the switch, and - in apps
     * newer than 1.6.0 - whenever what the phone will do changes without
     * them: critical alerts turned off or back on in iOS Settings, Do Not
     * Disturb access taken away on Android. It says what the phone will
     * really do, and saying the same again changes nothing, so the app may
     * say it as often as it needs to. A token with no device here is
     * refused, and the app leaves it to the phone's next registration.
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

    /*
     * Choose the alarm a handset's critical pages play, and on an iPhone how
     * loud. Keyed on the device token and written for every project the phone
     * is registered against, like the critical-alerts toggle above: the app
     * knows its own push token and holds no row ids.
     *
     * Either may be left out to keep what is stored; a value this server
     * cannot honour is refused, by name.
     */
    this.router.post(
      `/user-push/critical-alert-preferences`,
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

          const sound: CriticalAlertSound | undefined =
            parseCriticalAlertSoundStrict(req.body.sound);
          const volume: number | undefined = parseCriticalAlertVolumeStrict(
            req.body.volume,
          );

          if (sound === undefined && volume === undefined) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException(
                "Give a critical alert sound, a critical alert volume, or both.",
              ),
            );
          }

          const updatedCount: number =
            await this.service.setCriticalAlertPreferencesForDeviceToken({
              userId: userId,
              deviceToken: req.body.deviceToken,
              sound: sound,
              volumePercent: volume,
            });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            ...(sound !== undefined ? { criticalAlertSound: sound } : {}),
            ...(volume !== undefined ? { criticalAlertVolume: volume } : {}),
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

          if (!device.projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Device not found"),
            );
          }

          // A device pages for its project: only while the owner is a member of it.
          await assertUserIsMemberOfProject({
            userId: userId,
            projectId: device.projectId,
          });

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
