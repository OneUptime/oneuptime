import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import CallService from "./CallService";
import DatabaseService from "./DatabaseService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import CallRequest from "../../Types/Call/CallRequest";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ChannelVerification from "../Utils/ChannelVerification";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserCall";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      await UserNotificationRuleService.deleteBy({
        query: {
          userCallId: item.id!,
          projectId: item.projectId!,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /**
   * What this user would lose if this number were deleted. Ask BEFORE calling
   * delete; nothing here refuses anything.
   *
   * The hook directly above deletes every UserNotificationRule that points at
   * this number, and the foreign key is onDelete: "CASCADE" so the rows would
   * go even if it did not. Voice is often the last escalation step a responder
   * has configured — the one that wakes them — so it is the method whose quiet
   * removal is least likely to be noticed until an incident.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.Call,
      methodId: data.itemId,
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot && createBy.data.isVerified) {
      throw new BadDataException("isVerified cannot be set to true");
    }

    // check if this project has SMS and Call mEnabled.

    const project: Project | null = await ProjectService.findOneById({
      id: createBy.data.projectId!,
      props: {
        isRoot: true,
      },
      select: {
        enableCallNotifications: true,
        smsOrCallCurrentBalanceInUSDCents: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.enableCallNotifications) {
      throw new BadDataException(
        "Call notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.",
      );
    }

    /*
     * If the project has its own default Twilio config, OneUptime does not
     * charge the project's Call/SMS balance, so the low-balance check does not apply.
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

    // Check if Call notifications are enabled for this project
    const project: Project | null = await ProjectService.findOneById({
      id: item.projectId!,
      props: {
        isRoot: true,
      },
      select: {
        enableCallNotifications: true,
        smsOrCallCurrentBalanceInUSDCents: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.enableCallNotifications) {
      throw new BadDataException(
        "Call notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.",
      );
    }

    /*
     * If the project has its own default Twilio config, OneUptime does not
     * charge the project's Call/SMS balance, so the low-balance check does not apply.
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
    // add space to make it more clear and slow down the message
    const spokenCode: string = code.split("").join("  ");

    const callRequest: CallRequest = {
      to: item.phone!,
      data: [
        {
          sayMessage: "This call is from One Uptime.",
        },
        {
          sayMessage: "Your verification code is " + spokenCode,
        },
        {
          sayMessage: "Your verification code is " + spokenCode,
        },
        {
          sayMessage: "Your verification code is " + spokenCode,
        },
        {
          sayMessage: "Thank you for using One Uptime. Goodbye.",
        },
      ],
    };

    // send verification call.
    (async () => {
      const projectTwilioConfig: TwilioConfig | undefined =
        await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
          item.projectId,
        );

      await CallService.makeCall(callRequest, {
        projectId: item.projectId,
        customTwilioConfig: projectTwilioConfig,
        isSensitive: true,
        userId: item.userId!,
      });
    })().catch((err: Error) => {
      logger.error(err);
    });
  }
}

export default new Service();
