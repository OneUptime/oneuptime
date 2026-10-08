import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import SmsService from "./SmsService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ChannelVerification, {
  ChannelVerificationStatus,
} from "../Utils/ChannelVerification";
import TwilioAccountAvailability from "../Utils/TwilioAccountAvailability";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserIncomingCallNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE } from "../../Utils/Project/NotificationChannels";
import { INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE } from "../../Utils/Project/ProjectBalance";
import { INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE } from "../../Utils/Project/TwilioAccount";

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
      throw new BadDataException(INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE);
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
      throw new BadDataException(INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE);
    }

    /*
     * Whose number this is: the user the write names under either name, or
     * - when it names nobody - the person adding it, whom CreatePermission
     * stamps as the owner after this hook.
     */
    const userId: ObjectID | undefined =
      RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        ["userId", "user"],
        "User",
      ) || createBy.props.userId;

    // Check if user already has a verified phone number for this project
    const existingVerifiedNumber: Model | null = await this.findOneBy({
      query: {
        userId: userId!,
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
      return INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE;
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
      return INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE;
    }

    if (
      !(await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: projectId,
        projectDefaultTwilioConfig: projectTwilioConfig,
      }))
    ) {
      return INCOMING_CALL_NUMBER_NO_TWILIO_ACCOUNT_MESSAGE;
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

  public async sendVerificationCode(item: Model, code: string): Promise<void> {
    /*
     * Sent through the project's default Twilio config when it has one, like
     * every other SMS and call to the project's members (UserSmsService's
     * codes among them). Sent without it, the code went out through the
     * global config and was paid from the project's balance - the balance
     * onBeforeCreate does not even check when the project has its own.
     *
     * And waited for: the Notification service's answer says whether Twilio
     * took the SMS (failIfNotSent makes a deliberate non-send an answer
     * too), where it used to be sent fire-and-forget and announced as sent
     * whatever happened.
     */
    const projectTwilioConfig: TwilioConfig | undefined =
      await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
        item.projectId,
      );

    ChannelVerification.throwIfNotSent(
      await SmsService.sendSms(
        {
          to: item.phone!,
          message:
            "This message is from OneUptime. Your verification code for incoming call routing is " +
            code,
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
