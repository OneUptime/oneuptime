import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import SmsService from "./SmsService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ChannelVerification, {
  ChannelVerificationStatus,
} from "../Utils/ChannelVerification";
import TwilioAccountAvailability from "../Utils/TwilioAccountAvailability";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserSMS";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "../../Utils/Project/NotificationChannels";
import { getProjectBalanceTooLowMessage } from "../../Utils/Project/ProjectBalance";
import {
  getNoTwilioAccountMessage,
  TwilioMessageKind,
} from "../../Utils/Project/TwilioAccount";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The methods the delete removes, and the delete held to them.
    const itemsToDelete: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
      },
    );

    for (const item of itemsToDelete) {
      await UserNotificationRuleService.deleteBy({
        query: {
          userSmsId: item.id!,
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
   * go even if it did not. A phone number is the method people most often
   * retire — a new handset, a new country — and it is also the one whose delete
   * dialog gives no hint that an on-call configuration hangs off it.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.SMS,
      methodId: data.itemId,
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // check if this project has SMS and Call mEnabled.

    if (!createBy.props.isRoot && createBy.data.isVerified) {
      throw new BadDataException("isVerified cannot be set to true");
    }

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
        getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
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
        getProjectBalanceTooLowMessage(ProjectNotificationChannel.SMS),
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
      /*
       * The first code, or no number: one whose code could not be sent is
       * taken out again and the add is refused with the reason.
       */
      await ChannelVerification.sendFirstCodeOrRemoveItem({
        service: this,
        itemId: createdItem.id!,
        issueAndSend: async (): Promise<void> => {
          await this.issueAndSendVerificationCode(createdItem);
        },
      });
    }

    return createdItem;
  }

  /*
   * Why no verification code can be sent to this project's members right
   * now, or null when one can: SMS is off, the balance OneUptime would
   * charge is too low, or there is no Twilio account to send it through.
   * The refusal of a resend, and what the verify dialog says up front.
   */
  @CaptureSpan()
  public async getReasonCodeCannotBeSent(
    projectId: ObjectID,
  ): Promise<string | null> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      props: {
        isRoot: true,
      },
      select: {
        enableSmsNotifications: true,
        smsOrCallCurrentBalanceInUSDCents: true,
      },
    });

    if (!project) {
      return "Project not found";
    }

    if (!project.enableSmsNotifications) {
      return getProjectNotificationChannelOffMessage(
        ProjectNotificationChannel.SMS,
      );
    }

    /*
     * If the project has its own default Twilio config, OneUptime does not
     * charge the project's SMS balance, so the low-balance check does not apply.
     */
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        projectId,
      );

    if (
      !projectTwilioConfig &&
      (project.smsOrCallCurrentBalanceInUSDCents as number) <= 100 &&
      IsBillingEnabled
    ) {
      return getProjectBalanceTooLowMessage(ProjectNotificationChannel.SMS);
    }

    if (
      !(await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: projectId,
        projectDefaultTwilioConfig: projectTwilioConfig,
      }))
    ) {
      return getNoTwilioAccountMessage(TwilioMessageKind.SMS);
    }

    return null;
  }

  /*
   * Where this number's code stands, for its owner's verify dialog
   * (ChannelVerification.getStatus). The item is read by the caller, who
   * has already checked whose it is.
   */
  @CaptureSpan()
  public async getVerificationStatus(
    item: Model,
  ): Promise<ChannelVerificationStatus> {
    return ChannelVerification.getStatus({
      item: item,
      cannotSendReason: item.isVerified
        ? null
        : await this.getReasonCodeCannotBeSent(item.projectId!),
    });
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

    /*
     * Asked before the cooldown, and before a code is issued: a send that
     * cannot happen - SMS off, no balance, no Twilio account - costs the
     * person neither their cooldown nor the code they may still have.
     */
    const cannotSendReason: string | null =
      await this.getReasonCodeCannotBeSent(item.projectId!);

    if (cannotSendReason) {
      throw new BadDataException(cannotSendReason);
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
   * Throws, with the reason, when the SMS was not sent - and then leaves no
   * code on the row (ChannelVerification.issueAndSendCode).
   *
   * This does NOT check whether a send is allowed. Callers decide that:
   * onCreateSuccess because a brand new row has never been sent to, and
   * resendVerificationCode after the cooldown and the channel's own
   * preconditions have passed.
   */
  @CaptureSpan()
  public async issueAndSendVerificationCode(item: Model): Promise<void> {
    await ChannelVerification.issueAndSendCode({
      service: this,
      itemId: item.id!,
      destination: item.phone?.toString() || "this number",
      send: async (plainCode: string): Promise<void> => {
        await this.sendVerificationCode(item, plainCode);
      },
    });
  }

  /*
   * Sends the code and waits for the Notification service's answer, which
   * says whether Twilio took the SMS. It used to be sent fire-and-forget,
   * so a code that never went out - no Twilio account, a number Twilio
   * refused - was still announced as sent. failIfNotSent makes an SMS the
   * project deliberately does not send (SMS off, too little balance) an
   * answer of its own too, rather than a quiet success.
   */
  public async sendVerificationCode(item: Model, code: string): Promise<void> {
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        item.projectId,
      );

    ChannelVerification.throwIfNotSent(
      await SmsService.sendSms(
        {
          to: item.phone!,
          message:
            "This message is from OneUptime. Your verification code is " + code,
        },
        {
          projectId: item.projectId,
          customTwilioConfig: projectTwilioConfig,
          isSensitive: true,
          userId: item.userId!,
          failIfNotSent: true,
        },
      ),
    );
  }
}
export default new Service();
