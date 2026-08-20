import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MailService from "./MailService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ChannelVerification from "../Utils/ChannelVerification";
import Model from "../../Models/DatabaseModels/UserEmail";
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
          userEmailId: item.id!,
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
   * What this user would lose if this email address were deleted. Ask BEFORE
   * calling delete; nothing here refuses anything.
   *
   * The hook directly above deletes every UserNotificationRule that points at
   * this address, and the foreign key is onDelete: "CASCADE" so the rows would
   * go even if it did not. That makes removing one address a much larger write
   * than it looks from the screen it is made on — for many users this address
   * is the method behind their entire on-call configuration.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.Email,
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
      // issue and send the first verification code
      const plainCode: string =
        await this.issueAndSendVerificationCode(createdItem);

      /*
       * TEST-ONLY seam, OFF unless explicitly switched on.
       *
       * The plaintext code is otherwise only ever emailed - never returned by
       * the API - which is deliberate: returning it would let a caller add
       * anybody's address and confirm it instantly, the exact takeover the
       * hashing/expiry/attempt controls exist to stop (see ChannelVerification
       * and VerificationCode). The end-to-end stack has no mailbox to read the
       * emailed code from, so this narrow hatch hands the code back on the
       * create response for it to confirm the address the way a user would.
       *
       * It is gated on an environment variable that is unset in every shipped
       * config and set true ONLY in the CI e2e job (docker-compose passes it
       * through, .github/workflows/test-release.yaml sets it for the SaaS run).
       * In production the flag is absent, this branch never runs, and the code
       * never leaves the mail path.
       */
      if (
        process.env["EXPOSE_VERIFICATION_CODE_IN_API_RESPONSE_FOR_E2E"] ===
        "true"
      ) {
        createdItem.verificationCode = plainCode;
      }
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
        email: true,
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
      throw new BadDataException("Email already verified");
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
  public async issueAndSendVerificationCode(item: Model): Promise<string> {
    const plainCode: string = await ChannelVerification.issueCodeOnItem({
      service: this,
      itemId: item.id!,
    });

    this.sendVerificationCode(item, plainCode);

    /*
     * The plaintext exists here for exactly as long as it takes to hand it to
     * the mailer, and is returned so a caller that has a legitimate reason to
     * see it can - see onCreateSuccess for the one place that does, and the
     * hard gate around it.
     */
    return plainCode;
  }

  public sendVerificationCode(item: Model, code: string): void {
    MailService.sendMail(
      {
        toEmail: item.email!,
        templateType: EmailTemplateType.VerificationCode,
        vars: {
          code: code,
          subject: "Verify this email address",
        },
        subject: "Verify this email address",
      },
      {
        projectId: item.projectId!,
        userId: item.userId!,
      },
    ).catch((err: Error) => {
      logger.error(err);
    });
  }
}
export default new Service();
