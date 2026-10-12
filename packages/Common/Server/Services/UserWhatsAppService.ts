import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import WhatsAppService from "./WhatsAppService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ChannelVerification, {
  ChannelVerificationStatus,
} from "../Utils/ChannelVerification";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserWhatsApp";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "../../Utils/Project/NotificationChannels";
import { getProjectBalanceTooLowMessage } from "../../Utils/Project/ProjectBalance";
import WhatsAppMessage from "../../Types/WhatsApp/WhatsAppMessage";
import {
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
  WhatsAppTemplateId,
} from "../../Types/WhatsApp/WhatsAppTemplates";

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
          userWhatsAppId: item.id!,
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
   * What this user would lose if this WhatsApp number were deleted. Ask BEFORE
   * calling delete; nothing here refuses anything.
   *
   * The hook directly above deletes every UserNotificationRule that points at
   * this number, and the foreign key is onDelete: "CASCADE" so the rows would
   * go even if it did not.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.WhatsApp,
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

    const project: Project | null = await ProjectService.findOneById({
      id: createBy.data.projectId!,
      props: {
        isRoot: true,
      },
      select: {
        enableWhatsAppNotifications: true,
        smsOrCallCurrentBalanceInUSDCents: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.enableWhatsAppNotifications) {
      throw new BadDataException(
        getProjectNotificationChannelOffMessage(
          ProjectNotificationChannel.WhatsApp,
        ),
      );
    }

    if (
      (project.smsOrCallCurrentBalanceInUSDCents as number) <= 100 &&
      IsBillingEnabled
    ) {
      throw new BadDataException(
        getProjectBalanceTooLowMessage(ProjectNotificationChannel.WhatsApp),
      );
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.isVerified) {
      /*
       * The first code, or no number. This was sent fire-and-forget, so a
       * code that never went out - WhatsApp not set up, a number Meta
       * refused - left a number in the list that could never be verified,
       * and a dialog saying the code had been sent. Now the add is refused
       * with the reason, and the number taken out again.
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
   * Why no verification code can be sent right now, or null when one can.
   *
   * Only the balance: a WhatsApp code is sent while the project has
   * WhatsApp off (the Notification service does not ask), but one the
   * balance cannot pay for is dropped there without a word - so it is
   * refused here, with who can add balance, rather than announced as sent.
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
        smsOrCallCurrentBalanceInUSDCents: true,
      },
    });

    if (!project) {
      return "Project not found";
    }

    if (
      (project.smsOrCallCurrentBalanceInUSDCents as number) <= 100 &&
      IsBillingEnabled
    ) {
      return getProjectBalanceTooLowMessage(
        ProjectNotificationChannel.WhatsApp,
      );
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
      throw new BadDataException("WhatsApp number already verified");
    }

    // Before the cooldown: a send that cannot happen costs the person nothing.
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
   * Throws, with the reason, when the message was not sent - and then
   * leaves no code on the row (ChannelVerification.issueAndSendCode).
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
    if (!item.projectId || !item.userId || !item.phone) {
      logger.warn("Cannot send WhatsApp verification code. Missing data.", {
        projectId: item.projectId?.toString(),
        userId: item.userId?.toString(),
      } as LogAttributes);
      throw new BadDataException(
        "Unable to send WhatsApp verification code. Please remove this number and add it again.",
      );
    }

    const templateKey: WhatsAppTemplateId =
      WhatsAppTemplateIds.VerificationCode;
    const templateVariables: Record<string, string> = {
      "1": code,
    };

    const whatsAppMessage: WhatsAppMessage = {
      to: item.phone,
      body: "",
      templateKey,
      templateVariables,
      templateLanguageCode: WhatsAppTemplateLanguage[templateKey],
    };

    ChannelVerification.throwIfNotSent(
      await WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
        projectId: item.projectId,
        isSensitive: true,
        userId: item.userId,
      }),
    );
  }
}

export default new Service();
