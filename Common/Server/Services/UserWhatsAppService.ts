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
import ChannelVerification from "../Utils/ChannelVerification";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserWhatsApp";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WhatsAppMessage from "../../Types/WhatsApp/WhatsAppMessage";
import {
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
  WhatsAppTemplateId,
} from "../../Types/WhatsApp/WhatsAppTemplates";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";

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
        "WhatsApp notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.",
      );
    }

    if (
      (project.smsOrCallCurrentBalanceInUSDCents as number) <= 100 &&
      IsBillingEnabled
    ) {
      throw new BadDataException(
        "Your WhatsApp balance is low. Please recharge your balance in Project Settings > Notification Settings.",
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
      this.issueAndSendVerificationCode(createdItem).catch((error: Error) => {
        logger.error(error, {
          projectId: createdItem.projectId?.toString(),
          userId: createdItem.userId?.toString(),
        } as LogAttributes);
      });
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
      throw new BadDataException("WhatsApp number already verified");
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

    await this.sendVerificationCode(item, plainCode);
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

    const response: HTTPResponse<JSONObject> =
      await WhatsAppService.sendWhatsAppMessage(whatsAppMessage, {
        projectId: item.projectId,
        isSensitive: true,
        userId: item.userId,
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }
  }
}

export default new Service();
