import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import PositiveNumber from "../../Types/PositiveNumber";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import UserPush from "../../Models/DatabaseModels/UserPush";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
}

export default new Service();
