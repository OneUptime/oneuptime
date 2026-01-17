import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import SmsService from "./SmsService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Text from "../../Types/Text";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserIncomingCallNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // Check if user is trying to set isVerified to true
    if (!createBy.props.isRoot && createBy.data.isVerified) {
      throw new BadDataException("isVerified cannot be set to true");
    }

    // Check if SMS notifications are enabled for this project
    const project: Project | null = await ProjectService.findOneById({
      id: createBy.data.projectId!,
      props: {
        isRoot: true,
      },
      select: {
        enableSmsNotifications: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.enableSmsNotifications) {
      throw new BadDataException(
        "SMS notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.",
      );
    }

    // Check if user already has a verified phone number for this project
    const existingVerifiedNumber: Model | null = await this.findOneBy({
      query: {
        userId: createBy.data.userId!,
        projectId: createBy.data.projectId!,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingVerifiedNumber) {
      throw new BadDataException(
        "You already have a verified phone number for this project. Please delete the existing one before adding a new one.",
      );
    }

    return { carryForward: null, createBy };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.isVerified) {
      this.sendVerificationCode(createdItem);
    }

    return createdItem;
  }

  @CaptureSpan()
  public async resendVerificationCode(itemId: ObjectID): Promise<void> {
    const item: Model | null = await this.findOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      select: {
        phone: true,
        verificationCode: true,
        isVerified: true,
        projectId: true,
        userId: true,
      },
    });

    if (!item) {
      throw new BadDataException(
        "Item with ID " + itemId.toString() + " not found",
      );
    }

    if (item.isVerified) {
      throw new BadDataException("Phone Number already verified");
    }

    // Check if SMS notifications are enabled for this project
    const project: Project | null = await ProjectService.findOneById({
      id: item.projectId!,
      props: {
        isRoot: true,
      },
      select: {
        enableSmsNotifications: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.enableSmsNotifications) {
      throw new BadDataException(
        "SMS notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.",
      );
    }

    // Generate new verification code
    item.verificationCode = Text.generateRandomNumber(6);

    await this.updateOneById({
      id: item.id!,
      props: {
        isRoot: true,
      },
      data: {
        verificationCode: item.verificationCode,
      },
    });

    this.sendVerificationCode(item);
  }

  public sendVerificationCode(item: Model): void {
    // Send verification SMS
    SmsService.sendSms(
      {
        to: item.phone!,
        message:
          "This message is from OneUptime. Your verification code for incoming call routing is " +
          item.verificationCode,
      },
      {
        projectId: item.projectId,
        isSensitive: true,
        userId: item.userId!,
      },
    ).catch((err: Error) => {
      logger.error(err);
    });
  }

  @CaptureSpan()
  public async verifyPhoneNumber(
    itemId: ObjectID,
    userId: ObjectID,
    code: string,
  ): Promise<void> {
    const item: Model | null = await this.findOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      select: {
        userId: true,
        verificationCode: true,
        isVerified: true,
        projectId: true,
      },
    });

    if (!item) {
      throw new BadDataException("Item not found");
    }

    // Check user ID
    if (item.userId?.toString() !== userId.toString()) {
      throw new BadDataException("Invalid user ID");
    }

    if (item.isVerified) {
      throw new BadDataException("Phone number is already verified");
    }

    if (item.verificationCode !== code) {
      throw new BadDataException("Invalid verification code");
    }

    // Check if user already has a verified number for this project
    const existingVerifiedNumber: Model | null = await this.findOneBy({
      query: {
        userId: item.userId!,
        projectId: item.projectId!,
        isVerified: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingVerifiedNumber) {
      throw new BadDataException(
        "You already have a verified phone number for this project. Please delete the existing one before verifying a new one.",
      );
    }

    // Mark as verified
    await this.updateOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      data: {
        isVerified: true,
      },
    });
  }
}

export default new Service();
