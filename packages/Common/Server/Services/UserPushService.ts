import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import GlobalConfigService from "./GlobalConfigService";
import { PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE } from "../../Types/PushNotification/PushNotificationsTurnedOff";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Includes from "../../Types/BaseDatabase/Includes";
import {
  EXPO_PUSH_DEVICE_TYPES,
  isExpoPushDeviceType,
} from "../../Types/PushNotification/ExpoPushDeviceType";

export class Service extends DatabaseService<UserPush> {
  public constructor() {
    super(UserPush);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<UserPush>,
  ): Promise<OnCreate<UserPush>> {
    /*
     * No device is added while the server has push turned off
     * (PushNotificationsTurnedOff) - through the registration route or the
     * generic API alike: nothing would reach it.
     */
    if (await GlobalConfigService.getPushNotificationsTurnedOff()) {
      throw new BadDataException(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE);
    }

    if (!createBy.data.deviceToken) {
      throw new BadDataException("Device token is required");
    }

    if (!createBy.data.deviceType) {
      throw new BadDataException("Device type is required");
    }

    // Validate device type
    const validDeviceTypes: string[] = Object.values(PushDeviceType);
    if (!validDeviceTypes.includes(createBy.data.deviceType)) {
      throw new BadDataException(
        "Device type must be one of: " + validDeviceTypes.join(", "),
      );
    }

    /*
     * The alarm and volume a device is created with, when the write names
     * them: one a page can play, or refused here rather than stored. Delivery
     * reads anything else as the system sound at full volume, so a stray
     * value could not silence a page - but it would read back as a choice
     * that is not the one in force.
     */
    const criticalAlertSound: unknown = createBy.data.criticalAlertSound;

    if (
      criticalAlertSound !== undefined &&
      criticalAlertSound !== null &&
      !isCriticalAlertSound(criticalAlertSound)
    ) {
      throw new BadDataException(
        `Critical alert sound must be one of: ${CRITICAL_ALERT_SOUNDS.map(
          (definition: CriticalAlertSoundDefinition): string => {
            return definition.sound;
          },
        ).join(", ")}.`,
      );
    }

    const criticalAlertVolume: unknown = createBy.data.criticalAlertVolume;

    if (
      criticalAlertVolume !== undefined &&
      criticalAlertVolume !== null &&
      !isCriticalAlertVolumePercent(criticalAlertVolume)
    ) {
      throw new BadDataException(
        `Critical alert volume must be a whole number from ${CRITICAL_ALERT_VOLUME_MIN_PERCENT} to ${CRITICAL_ALERT_VOLUME_MAX_PERCENT}.`,
      );
    }

    /*
     * Whose device this is: the user the write names under either name, or
     * - when it names nobody - the person registering it, whom
     * CreatePermission stamps as the owner after this hook.
     */
    const userId: ObjectID | undefined =
      RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["userId", "user"],
        "User",
      ) || createBy.props.userId;

    // Check if this device token already exists for this user and project
    const existingCount: PositiveNumber = await this.countBy({
      query: {
        deviceToken: createBy.data.deviceToken,
        userId: userId!,
        projectId: createBy.data.projectId!,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingCount.toNumber() > 0) {
      throw new BadDataException(
        "This device is already registered for push notifications",
      );
    }

    return { carryForward: null, createBy };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<UserPush>,
  ): Promise<OnDelete<UserPush>> {
    // Add any cleanup logic here if needed
    return { carryForward: null, deleteBy };
  }

  /**
   * What this user would lose if this device were deleted. Ask BEFORE calling
   * delete; nothing here refuses anything.
   *
   * Note what the hook directly above does NOT do. The other six method
   * services delete their notification rules themselves; this one leaves it
   * entirely to UserNotificationRule.userPushId, which is onDelete: "CASCADE".
   * The rules go either way — the database sees to it — so the loss is exactly
   * as large here as everywhere else, and it is even less visible from the
   * code. Push is also the channel a responder is most likely to have several
   * of and to prune casually, one retired handset at a time.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.Push,
      methodId: data.itemId,
    });
  }

  @CaptureSpan()
  public async verifyDevice(deviceId: string): Promise<void> {
    await this.updateOneBy({
      query: {
        _id: deviceId,
      },
      data: {
        isVerified: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async unverifyDevice(deviceId: string): Promise<void> {
    await this.updateOneBy({
      query: {
        _id: deviceId,
      },
      data: {
        isVerified: false,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * Turn on-call critical alerts on or off for a handset.
   *
   * Keyed on the device TOKEN rather than a row id, because one phone owns one
   * row per project it is registered against, and "ring me through silent
   * mode" is a property of the phone. Toggling it per row would leave a
   * responder loud for one project and silent for the next - a distinction
   * nothing in the app offers to make and nobody would think to check.
   * Deletion already works this way for the same reason (see the unregister
   * route).
   *
   * Scoped to `userId` so a token cannot be used to reconfigure somebody
   * else's device, and to the two mobile platforms because no browser can
   * override a device's ringer: storing the preference on a web row would
   * read back as though it did something.
   *
   * Returns how many rows were updated, so the caller can tell a real toggle
   * apart from one that matched no device at all.
   */
  @CaptureSpan()
  public async setCriticalAlertEnabledForDeviceToken(data: {
    userId: ObjectID;
    deviceToken: string;
    isEnabled: boolean;
  }): Promise<number> {
    return await this.updateMobileDevicesOfToken({
      userId: data.userId,
      deviceToken: data.deviceToken,
      data: {
        isCriticalAlertEnabled: data.isEnabled,
      },
    });
  }

  /**
   * A phone registered a device it already has - the app does on every
   * start, every sign-in and every return to it at most five minutes apart -
   * and restated whether a critical page rings through on it (MobileApp
   * pushDevice.ts). The device takes it.
   *
   * The app says what the phone will really do with a critical page: on
   * only while the responder has Critical On-Call Alerts on AND the phone's
   * system allows it. A device that was already registered used to keep
   * whatever it was created with, so a phone whose app was reinstalled, or
   * whose critical alerts were turned off in the phone's own settings, went
   * on reading "On" in the Dashboard - and a test from there claimed to ring
   * through silent mode while the phone showed an ordinary notification.
   *
   * Only the switch. The alarm and volume a registration names are a new
   * device's; an existing device's are changed by the
   * critical-alert-preferences route. A registration reads them once, before
   * it tells each project in turn, so restating them could put back an alarm
   * the responder changed meanwhile.
   *
   * Only an iOS or Android device: no browser can ring through silent mode,
   * and a browser's device is left as it is. Only when the phone states it
   * (undefined: an app that does not know, or could not ask the OS), and
   * only when it differs from what the device holds, so the registrations
   * the app makes every few minutes write nothing while nothing changes.
   *
   * Returns whether critical pages ring through on the device now.
   */
  @CaptureSpan()
  public async restateCriticalAlertEnabled(data: {
    // The device as read: _id, deviceType and isCriticalAlertEnabled.
    device: UserPush;
    isCriticalAlertEnabled: boolean | undefined;
  }): Promise<boolean> {
    const device: UserPush = data.device;
    const stored: boolean = Boolean(device.isCriticalAlertEnabled);

    if (
      data.isCriticalAlertEnabled === undefined ||
      data.isCriticalAlertEnabled === stored ||
      !device._id ||
      !isExpoPushDeviceType(device.deviceType)
    ) {
      return stored;
    }

    await this.updateOneBy({
      query: {
        _id: device._id.toString(),
      },
      data: {
        isCriticalAlertEnabled: data.isCriticalAlertEnabled,
      },
      props: {
        isRoot: true,
      },
    });

    return data.isCriticalAlertEnabled;
  }

  /**
   * The alarm a handset's critical pages play, and on an iPhone how loud
   * (CriticalAlertSound, CriticalAlertVolume). Keyed on the device token and
   * kept to the caller's own iOS and Android devices for the same reasons as
   * setCriticalAlertEnabledForDeviceToken: it is a property of the phone, set
   * on every project the phone is registered against at once.
   *
   * Either may be left out to keep what is stored. The caller has already
   * checked the values; this writes them as given.
   */
  @CaptureSpan()
  public async setCriticalAlertPreferencesForDeviceToken(data: {
    userId: ObjectID;
    deviceToken: string;
    sound?: CriticalAlertSound | undefined;
    volumePercent?: number | undefined;
  }): Promise<number> {
    const update: {
      criticalAlertSound?: CriticalAlertSound;
      criticalAlertVolume?: number;
    } = {};

    if (data.sound !== undefined) {
      update.criticalAlertSound = data.sound;
    }

    if (data.volumePercent !== undefined) {
      update.criticalAlertVolume = data.volumePercent;
    }

    if (Object.keys(update).length === 0) {
      throw new BadDataException(
        "Give a critical alert sound, a critical alert volume, or both.",
      );
    }

    return await this.updateMobileDevicesOfToken({
      userId: data.userId,
      deviceToken: data.deviceToken,
      data: update,
    });
  }

  /*
   * Write `data` onto every iOS and Android device of `userId` registered with
   * `deviceToken` - one per project the phone is registered against - and say
   * how many were written. Refuses a token the caller has no device for, and
   * one that is only a browser's: no browser can override a device's ringer,
   * so a critical alert setting stored on a web row would read back as though
   * it did something.
   */
  private async updateMobileDevicesOfToken(options: {
    userId: ObjectID;
    deviceToken: string;
    data: {
      isCriticalAlertEnabled?: boolean;
      criticalAlertSound?: CriticalAlertSound;
      criticalAlertVolume?: number;
    };
  }): Promise<number> {
    const devices: Array<UserPush> = await this.findBy({
      query: {
        userId: options.userId,
        deviceToken: options.deviceToken,
      },
      select: {
        _id: true,
        deviceType: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (devices.length === 0) {
      throw new BadDataException(
        "No registered device was found for this device token.",
      );
    }

    const mobileDeviceIds: Array<string> = devices
      .filter((device: UserPush) => {
        return (
          device.deviceType === PushDeviceType.iOS ||
          device.deviceType === PushDeviceType.Android
        );
      })
      .map((device: UserPush) => {
        return device._id!.toString();
      });

    if (mobileDeviceIds.length === 0) {
      throw new BadDataException(
        "Critical alerts are only available on iOS and Android devices.",
      );
    }

    let updatedCount: number = 0;

    /*
     * One update per row rather than an `_id: In([...])` query: the query
     * builder used here takes a single value per column, and the count of
     * projects a responder belongs to is small.
     */
    for (const deviceId of mobileDeviceIds) {
      updatedCount += await this.updateOneBy({
        query: {
          _id: deviceId,
        },
        data: options.data,
        props: {
          isRoot: true,
        },
      });
    }

    return updatedCount;
  }

  /**
   * A browser push subscription that is gone: the push service answered a
   * send to it with 404 or 410 (PushNotificationService), or the browser
   * said it dropped it without getting a new one (the subscription-change
   * route).
   *
   * The web devices registered with it stop being verified. Nothing is sent
   * to an unverified device, and that is what makes the loss visible: the
   * on-call timeline says a page was not pushed because the device is not
   * verified, readiness counts the device as not ready, and the device list
   * says it no longer receives notifications. Before, a dead subscription
   * stayed verified, every page to it failed at the push service, and
   * everything said the device was fine.
   *
   * Marked, not deleted. The browser may still report a new subscription
   * (replaceWebPushSubscription), which brings these devices back with the
   * rules their owner set up for them; deleting a device takes its rules
   * with it (UserNotificationRule.userPushId cascades).
   *
   * Every account that registered the browser has lost the subscription
   * alike, so without `userId` all of them are marked. A caller reporting
   * for themselves passes their own id, and marks only their own devices.
   *
   * Returns how many devices were marked.
   */
  @CaptureSpan()
  public async markWebPushSubscriptionAsGone(data: {
    deviceToken: string;
    userId?: ObjectID | undefined;
  }): Promise<number> {
    return await this.markPushTokenAsGone({
      ...data,
      deviceType: PushDeviceType.Web,
    });
  }

  /*
   * What marking a gone subscription or token does, for both kinds: the
   * verified devices of these types registered with it stop being verified,
   * as root (UserPush grants update to nobody), every one of them - not
   * deleted, so their rules survive. markWebPushSubscriptionAsGone and
   * markExpoPushTokenAsGone differ only in the devices a token can belong to.
   */
  private async markPushTokenAsGone(data: {
    deviceToken: string;
    deviceType: PushDeviceType | Includes;
    userId?: ObjectID | undefined;
  }): Promise<number> {
    return await this.updateBy({
      query: {
        deviceToken: data.deviceToken,
        deviceType: data.deviceType,
        isVerified: true,
        ...(data.userId ? { userId: data.userId } : {}),
      },
      data: {
        isVerified: false,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * An Expo push token that is gone: Expo answered a send to it with
   * DeviceNotRegistered (PushNotificationService - sent directly with the
   * deployment's Expo access token, or through the push relay, which says
   * so in its answer). The mobile app was removed from the device, or the
   * device's push token is no longer valid.
   *
   * The phones and tablets registered with it stop being verified, exactly
   * as markWebPushSubscriptionAsGone does for a browser: nothing more is
   * sent to them, and the on-call timeline, readiness and the device list
   * say they no longer receive notifications. Before, the token stayed
   * verified and every later page to it failed at Expo.
   *
   * Marked, not deleted, for the same reason: the rules their owner set up
   * for them survive (UserNotificationRule.userPushId cascades on delete).
   * The app gets its token from Expo again every time it registers, which
   * renews it there, and registering a device that is marked here verifies
   * it again (UserPushAPI's register route).
   *
   * Only iOS and Android devices: an Expo push token is never a browser's
   * subscription. Every account that registered the token has lost it
   * alike, so without `userId` all of them are marked.
   *
   * Returns how many devices were marked.
   */
  @CaptureSpan()
  public async markExpoPushTokenAsGone(data: {
    deviceToken: string;
    userId?: ObjectID | undefined;
  }): Promise<number> {
    return await this.markPushTokenAsGone({
      ...data,
      deviceType: new Includes([...EXPO_PUSH_DEVICE_TYPES]),
    });
  }

  /**
   * The mobile app registered a token again whose device is not verified -
   * most often one Expo said was gone (markExpoPushTokenAsGone). The app
   * asks Expo for its token on every launch before it registers, and that
   * request renews the token with Expo, so the token it registers is one
   * Expo can deliver to: the device is verified again, with the rules its
   * owner set up for it. If Expo still refuses it, the next page marks it
   * again.
   *
   * Only an iOS or Android device. A browser's subscription that the push
   * service refused is gone for good, and its browser renews it with a new
   * one instead (replaceWebPushSubscription).
   *
   * Returns whether the device was verified again.
   */
  @CaptureSpan()
  public async verifyExpoPushDeviceRegisteredAgain(
    deviceId: ObjectID,
  ): Promise<boolean> {
    const verifiedCount: number = await this.updateOneBy({
      query: {
        _id: deviceId.toString(),
        deviceType: new Includes([...EXPO_PUSH_DEVICE_TYPES]),
        isVerified: false,
      },
      data: {
        isVerified: true,
      },
      props: {
        isRoot: true,
      },
    });

    return verifiedCount > 0;
  }

  /**
   * The mobile app got a new push token on a phone where it kept its data -
   * a phone set up from a backup of the old one, say - and says which token
   * it had before (the register route's previousDeviceToken). When the
   * person's device in this project registered with that token no longer
   * receives notifications - Expo said its token was gone - this phone takes
   * it over: it carries the new token from now on, verified, with the rules
   * its owner set up for it, and the name, type and critical-alerts setting
   * the phone registers with now. Before, the new token got a new device
   * with default rules, and the old one stayed "Not receiving
   * notifications" until somebody deleted it.
   *
   * Only a device that no longer receives notifications. One that still
   * does may be a phone still in use - an iPad set up from an iPhone's
   * backup reports the iPhone's token - and taking it over would silently
   * stop paging that phone. Then this phone gets a device of its own, as
   * before.
   *
   * Like a browser's subscription-change (replaceWebPushSubscription), only
   * the caller's own iOS or Android device in this project, and only when
   * the new token has no device there yet (the register route checks):
   * nothing is ever deleted. Returns the device renewed, or null when there
   * was none to renew.
   */
  @CaptureSpan()
  public async renewExpoPushDevice(data: {
    userId: ObjectID;
    projectId: ObjectID;
    previousDeviceToken: string;
    deviceToken: string;
    deviceType: PushDeviceType;
    deviceName: string;
    /*
     * Whether critical pages ring through on the phone, as it registers now.
     * Left out - the phone could not ask its OS - the device keeps its own,
     * as a device the phone already has does (restateCriticalAlertEnabled).
     */
    isCriticalAlertEnabled?: boolean | undefined;
    // The phone's alarm and volume as it registers now; left out, kept.
    criticalAlertSound?: CriticalAlertSound | undefined;
    criticalAlertVolume?: number | undefined;
  }): Promise<UserPush | null> {
    if (
      !data.previousDeviceToken ||
      data.previousDeviceToken === data.deviceToken
    ) {
      return null;
    }

    const previous: UserPush | null = await this.findOneBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
        deviceToken: data.previousDeviceToken,
        deviceType: new Includes([...EXPO_PUSH_DEVICE_TYPES]),
        isVerified: false,
      },
      select: {
        _id: true,
        isCriticalAlertEnabled: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!previous?._id) {
      return null;
    }

    /*
     * Still the old token, and still not receiving: another registration may
     * have renewed it a moment ago, or the old phone registered it again,
     * and then this one has nothing to take over.
     */
    const renewedCount: number = await this.updateOneBy({
      query: {
        _id: previous._id.toString(),
        userId: data.userId,
        deviceToken: data.previousDeviceToken,
        isVerified: false,
      },
      data: {
        deviceToken: data.deviceToken,
        deviceType: data.deviceType,
        deviceName: data.deviceName,
        isVerified: true,
        ...(data.isCriticalAlertEnabled !== undefined
          ? { isCriticalAlertEnabled: data.isCriticalAlertEnabled }
          : {}),
        ...(data.criticalAlertSound !== undefined
          ? { criticalAlertSound: data.criticalAlertSound }
          : {}),
        ...(data.criticalAlertVolume !== undefined
          ? { criticalAlertVolume: data.criticalAlertVolume }
          : {}),
      },
      props: {
        isRoot: true,
      },
    });

    if (renewedCount === 0) {
      return null;
    }

    // What critical pages do on the device now.
    previous.isCriticalAlertEnabled = Boolean(
      data.isCriticalAlertEnabled ?? previous.isCriticalAlertEnabled,
    );

    return previous;
  }

  /**
   * A browser replaced its push subscription - it expired, the push service
   * rotated it, permission was given back - and its service worker reports
   * the old one and the new one. Every web device of `userId` registered with
   * the old one carries the new one from now on, and is verified again: one
   * browser has one subscription, and a device per project it is registered
   * in.
   *
   * Only devices of projects in `memberProjectIds`, the projects the person
   * is a member of now. A device pages its owner for its project, and
   * somebody who has left cannot give themselves a way to be reached by it
   * again (the register and verify routes check the same).
   *
   * A project where this browser is already registered with the new
   * subscription - it was registered again before the old one was replaced
   * here - keeps that device. The old one is marked unverified rather than
   * renewed: renewing it would push every notification to this browser twice.
   *
   * Returns how many devices now carry the new subscription.
   */
  @CaptureSpan()
  public async replaceWebPushSubscription(data: {
    userId: ObjectID;
    oldDeviceToken: string;
    newDeviceToken: string;
    memberProjectIds: Array<ObjectID>;
  }): Promise<number> {
    // Nothing was replaced: every device would count as registered again.
    if (data.oldDeviceToken === data.newDeviceToken) {
      return 0;
    }

    const devices: Array<UserPush> = await this.findBy({
      query: {
        userId: data.userId,
        deviceToken: data.oldDeviceToken,
        deviceType: PushDeviceType.Web,
      },
      select: {
        _id: true,
        projectId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const memberProjectIds: Set<string> = new Set<string>(
      data.memberProjectIds.map((projectId: ObjectID): string => {
        return projectId.toString().toLowerCase();
      }),
    );

    let renewedCount: number = 0;

    for (const device of devices) {
      if (
        !device.projectId ||
        !memberProjectIds.has(device.projectId.toString().toLowerCase())
      ) {
        continue;
      }

      const registeredAgain: UserPush | null = await this.findOneBy({
        query: {
          userId: data.userId,
          projectId: device.projectId,
          deviceToken: data.newDeviceToken,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (registeredAgain) {
        await this.updateOneBy({
          query: {
            _id: device._id!,
          },
          data: {
            isVerified: false,
          },
          props: {
            isRoot: true,
          },
        });

        continue;
      }

      renewedCount += await this.updateOneBy({
        query: {
          _id: device._id!,
        },
        data: {
          deviceToken: data.newDeviceToken,
          isVerified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    return renewedCount;
  }
}

export default new Service();
