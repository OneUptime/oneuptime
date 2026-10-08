import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import UserPush from "../../Models/DatabaseModels/UserPush";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<UserPush> {
  public constructor() {
    super(UserPush);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<UserPush>,
  ): Promise<OnCreate<UserPush>> {
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
    const devices: Array<UserPush> = await this.findBy({
      query: {
        userId: data.userId,
        deviceToken: data.deviceToken,
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
        data: {
          isCriticalAlertEnabled: data.isEnabled,
        },
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
    return await this.updateBy({
      query: {
        deviceToken: data.deviceToken,
        deviceType: PushDeviceType.Web,
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
