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
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

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

    // Check if this device token already exists for this user and project
    const existingCount: PositiveNumber = await this.countBy({
      query: {
        deviceToken: createBy.data.deviceToken,
        userId: createBy.data.userId!,
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
}

export default new Service();
