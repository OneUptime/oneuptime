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
import UserSmsService from "./UserSmsService";
import CallRequest from "../../Types/Call/CallRequest";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ChannelVerification, {
  ChannelVerificationStatus,
} from "../Utils/ChannelVerification";
import TwilioAccountAvailability from "../Utils/TwilioAccountAvailability";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserCall";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
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
        getProjectNotificationChannelOffMessage(
          ProjectNotificationChannel.Call,
        ),
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
        getProjectBalanceTooLowMessage(ProjectNotificationChannel.Call),
      );
    }

    return { carryForward: null, createBy };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.isVerified) {
      if (
        await this.isNumberVerifiedForSms({
          item: createdItem,
          addedByUserId: onCreate.createBy.props.userId,
        })
      ) {
        // Already proven by SMS: no call, no code - it is verified.
        await this.markVerifiedBySms(createdItem);
        createdItem.isVerified = true;
      } else {
        /*
         * The first code, or no number: one whose code could not be sent
         * is taken out again and the add is refused with the reason.
         */
        await ChannelVerification.sendFirstCodeOrRemoveItem({
          service: this,
          itemId: createdItem.id!,
          issueAndSend: async (): Promise<void> => {
            await this.issueAndSendVerificationCode(createdItem);
          },
        });
      }
    }
    return createdItem;
  }

  /*
   * A NUMBER VERIFIED FOR SMS IS VERIFIED FOR CALLS.
   *
   * A code is how a person proves a number is theirs before OneUptime will
   * page it. Typing back a code that was texted to a number proves exactly
   * that, and a phone that receives texts takes calls - so a person who
   * already verified a number for SMS was being made to sit through a robot
   * reading digits down the line to prove the same thing again.
   *
   * Not the other way round. A call proves that a number rings; a landline
   * rings too, and never shows a text. A number verified only by call still
   * gets its own SMS code, so an SMS method never goes live on a number
   * that cannot receive one.
   *
   * Only for the person's own adds, in the same project. A number an
   * administrator adds for somebody (UserNotificationMethodAdminService)
   * still needs that person's own code: an administrator can type a number
   * in, but never make it live.
   */
  @CaptureSpan()
  public async isNumberVerifiedForSms(data: {
    item: Model;
    addedByUserId: ObjectID | undefined;
  }): Promise<boolean> {
    if (
      !data.item.userId ||
      !data.item.projectId ||
      !data.item.phone ||
      !data.addedByUserId ||
      data.addedByUserId.toString() !== data.item.userId.toString()
    ) {
      return false;
    }

    const verifiedSmsNumbers: Array<UserSMS> = await UserSmsService.findBy({
      query: {
        userId: data.item.userId,
        projectId: data.item.projectId,
        isVerified: true,
      },
      select: {
        _id: true,
        phone: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    return verifiedSmsNumbers.some((smsNumber: UserSMS): boolean => {
      return Phone.isSameNumber(smsNumber.phone, data.item.phone);
    });
  }

  /*
   * When a person verifies a number for SMS, the call numbers they added
   * for the same number in the same project are verified with it (see
   * isNumberVerifiedForSms for why, and why only their own adds). Returns
   * how many were, so the dialog can say so.
   */
  @CaptureSpan()
  public async verifyNumbersProvenBySms(data: {
    userId: ObjectID;
    projectId: ObjectID;
    phone: Phone;
  }): Promise<number> {
    const unverifiedNumbers: Array<Model> = await this.findBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
        isVerified: false,
      },
      select: {
        _id: true,
        phone: true,
        userId: true,
        projectId: true,
        createdByUserId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const provenNumbers: Array<Model> = unverifiedNumbers.filter(
      (callNumber: Model): boolean => {
        return (
          callNumber.createdByUserId?.toString() === data.userId.toString() &&
          Phone.isSameNumber(callNumber.phone, data.phone)
        );
      },
    );

    for (const callNumber of provenNumbers) {
      await this.markVerifiedBySms(callNumber);
    }

    return provenNumbers.length;
  }

  /*
   * Verified on the strength of the SMS code: the row is marked as the
   * verify route marks one, any code on it is cleared, and it gets the
   * default notification rules a number verified by its own code gets.
   */
  private async markVerifiedBySms(item: Model): Promise<void> {
    await ChannelVerification.markVerified({
      service: this,
      itemId: item.id!,
    });

    try {
      await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
        {
          projectId: item.projectId!,
          userId: item.userId!,
          notificationMethod: {
            userCallId: item.id!,
          },
        },
      );
    } catch (error) {
      logger.error(error);
    }
  }

  /*
   * Why no verification call can be placed to this project's members right
   * now, or null when one can: calls are off, the balance OneUptime would
   * charge is too low, or there is no Twilio account to call through. The
   * refusal of a resend, and what the verify dialog says up front.
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
        enableCallNotifications: true,
        smsOrCallCurrentBalanceInUSDCents: true,
      },
    });

    if (!project) {
      return "Project not found";
    }

    if (!project.enableCallNotifications) {
      return getProjectNotificationChannelOffMessage(
        ProjectNotificationChannel.Call,
      );
    }

    /*
     * If the project has its own default Twilio config, OneUptime does not
     * charge the project's Call/SMS balance, so the low-balance check does not apply.
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
      return getProjectBalanceTooLowMessage(ProjectNotificationChannel.Call);
    }

    if (
      !(await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: projectId,
        projectDefaultTwilioConfig: projectTwilioConfig,
      }))
    ) {
      return getNoTwilioAccountMessage(TwilioMessageKind.Call);
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
     * Asked before the cooldown, and before a code is issued: a call that
     * cannot happen - calls off, no balance, no Twilio account - costs the
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
   * Throws, with the reason, when the call was not placed - and then leaves
   * no code on the row (ChannelVerification.issueAndSendCode).
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
   * Places the call and waits for the Notification service's answer, which
   * says whether Twilio took it. It used to be placed fire-and-forget, so a
   * call that never happened - no Twilio account, a number Twilio refused -
   * was still announced as on its way.
   */
  public async sendVerificationCode(item: Model, code: string): Promise<void> {
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
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        item.projectId,
      );

    ChannelVerification.throwIfNotSent(
      await CallService.makeCall(callRequest, {
        projectId: item.projectId,
        customTwilioConfig: projectTwilioConfig,
        isSensitive: true,
        userId: item.userId!,
      }),
    );
  }
}

export default new Service();
