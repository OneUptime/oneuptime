import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import SmsService from "./SmsService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ChannelVerification from "../Utils/ChannelVerification";
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
        smsOrCallCurrentBalanceInUSDCents: true,
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

    /*
     * If the project has its own default Twilio config, OneUptime does not
     * charge the project's SMS balance, so the low-balance check does not apply.
     */
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        createBy.data.projectId!,
      );

    if (
      !projectTwilioConfig &&
      (project.smsOrCallCurrentBalanceInUSDCents as number) <= 100 &&
      IsBillingEnabled
    ) {
      throw new BadDataException(
        "Your SMS balance is low. Please recharge your SMS balance in Project Settings > Notification Settings.",
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
      // issue and send the first verification code
      await this.issueAndSendVerificationCode(createdItem);
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
        isVerified: true,
        projectId: true,
        userId: true,
        verificationCodeSentAt: true,
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
        smsOrCallCurrentBalanceInUSDCents: true,
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

    /*
     * If the project has its own default Twilio config, OneUptime does not
     * charge the project's SMS balance, so the low-balance check does not apply.
     */
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        item.projectId!,
      );

    if (
      !projectTwilioConfig &&
      (project.smsOrCallCurrentBalanceInUSDCents as number) <= 100 &&
      IsBillingEnabled
    ) {
      throw new BadDataException(
        "Your SMS balance is low. Please recharge your SMS balance in Project Settings > Notification Settings.",
      );
    }

    /*
     * Resend cooldown.
     *
     * Without it, spending the attempt budget on a code and asking for
     * another one is free, which turns the attempt limit into a speed bump
     * rather than a wall — and the resend control doubles as a way to send
     * somebody unsolicited messages as fast as the network allows, at the
     * project's expense.
     */
    const retryAfterSeconds: number =
      ChannelVerification.getResendRetryAfterSeconds({
        lastSentAt: item.verificationCodeSentAt,
      });

    if (retryAfterSeconds > 0) {
      throw new TooManyRequestsException(
        `Please wait ${retryAfterSeconds} seconds before requesting another verification code.`,
      );
    }

    await this.issueAndSendVerificationCode(item);
  }

  /*
   * Mint a fresh code for this row, store only its digest, and send the
   * plaintext to the channel.
   *
   * The plaintext exists in memory for exactly as long as it takes to hand it
   * to the notification service and is never written anywhere. Everything
   * about why — expiry, the attempt counter, rotation, the resend cooldown —
   * is in Common/Server/Utils/ChannelVerification.ts.
   *
   * This does NOT check whether a send is allowed. Callers decide that:
   * onCreateSuccess because a brand new row has never been sent to, and
   * resendVerificationCode after the cooldown and the channel's own
   * preconditions have passed.
   */
  @CaptureSpan()
  public async issueAndSendVerificationCode(item: Model): Promise<void> {
    const plainCode: string = await ChannelVerification.issueCodeOnItem({
      service: this,
      itemId: item.id!,
    });

    this.sendVerificationCode(item, plainCode);
  }

  public sendVerificationCode(item: Model, code: string): void {
    // Send verification SMS
    SmsService.sendSms(
      {
        to: item.phone!,
        message:
          "This message is from OneUptime. Your verification code for incoming call routing is " +
          code,
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
}

export default new Service();
