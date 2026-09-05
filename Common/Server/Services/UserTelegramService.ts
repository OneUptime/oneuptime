import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import Model from "../../Models/DatabaseModels/UserTelegram";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TelegramVerificationToken from "../Utils/TelegramVerificationToken";
import {
  QueryDeepPartialEntity,
  UpdateQueryBuilder,
  UpdateResult,
} from "typeorm";

export enum TelegramVerificationOutcome {
  Verified = "verified",
  Invalid = "invalid",
  Expired = "expired",
  AlreadyClaimed = "already-claimed",
}

export interface TelegramVerificationResult {
  outcome: TelegramVerificationOutcome;
  item?: Model | undefined;
}

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
          userTelegramId: item.id!,
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
   * What this user would lose if this Telegram account were deleted. Ask BEFORE
   * calling delete; nothing here refuses anything.
   *
   * The hook directly above deletes every UserNotificationRule that points at
   * this account, and the foreign key is onDelete: "CASCADE" so the rows would
   * go even if it did not.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.Telegram,
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

    if (!createBy.props.isRoot && createBy.data.telegramChatId) {
      throw new BadDataException("telegramChatId cannot be set directly");
    }

    /*
     * DatabaseService stamps props.tenantId only AFTER this hook. Until then,
     * both projectId and project are request data. Policy checks performed
     * against either request value would therefore be a confused-deputy bug:
     * the caller could pass an enabled/funded project here, pass this hook, and
     * have DatabaseService persist the row under a different authenticated
     * tenant afterwards.
     *
     * Canonicalize both spellings to the authenticated request tenant before
     * any lookup. Root jobs have no request tenant, so they retain the existing
     * internal-call behaviour and use the project explicitly carried by data.
     */
    const suppliedProjectId: ObjectID | undefined = createBy.data.projectId;
    const relationProjectId: ObjectID | null | undefined =
      createBy.data.project?.id ||
      (createBy.data.project?._id
        ? new ObjectID(createBy.data.project._id)
        : undefined);
    const requestTenantId: ObjectID | undefined = createBy.props.tenantId;

    if (!createBy.props.isRoot && !requestTenantId) {
      throw new BadDataException("Project ID is required");
    }

    const authoritativeProjectId: ObjectID | undefined = createBy.props.isRoot
      ? suppliedProjectId
      : requestTenantId;

    if (!authoritativeProjectId) {
      throw new BadDataException("Project ID is required");
    }

    if (
      suppliedProjectId &&
      !suppliedProjectId.equals(authoritativeProjectId)
    ) {
      throw new BadDataException("Project ID does not match request tenant");
    }

    if (
      relationProjectId &&
      !relationProjectId.equals(authoritativeProjectId)
    ) {
      throw new BadDataException(
        createBy.props.isRoot
          ? "Project relation does not match projectId"
          : "Project relation does not match request tenant",
      );
    }

    createBy.data.projectId = authoritativeProjectId;
    delete createBy.data.project;

    const project: Project | null = await ProjectService.findOneById({
      id: createBy.data.projectId!,
      props: {
        isRoot: true,
      },
      select: {
        enableTelegramNotifications: true,
        smsOrCallCurrentBalanceInUSDCents: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.enableTelegramNotifications) {
      throw new BadDataException(
        "Telegram notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.",
      );
    }

    if (
      (project.smsOrCallCurrentBalanceInUSDCents as number) <= 100 &&
      IsBillingEnabled
    ) {
      throw new BadDataException(
        "Your notification balance is low. Please recharge your balance in Project Settings > Notification Settings.",
      );
    }

    /*
     * Never accept a caller-selected bearer token. This hook runs before the
     * required-field and permission checks, so every ordinary create gets a
     * server-minted 256-bit capability and no API input can choose it.
     */
    createBy.data.verificationCode = TelegramVerificationToken.mint();

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async regenerateVerificationCode(itemId: ObjectID): Promise<string> {
    const item: Model | null = await this.findOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      select: {
        isVerified: true,
        verificationCode: true,
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
      throw new BadDataException("Telegram account already verified");
    }

    if (
      !item.projectId ||
      !item.userId ||
      !(await this.hasActiveProjectMembership({
        projectId: item.projectId,
        userId: item.userId,
      }))
    ) {
      throw new BadDataException("Item not found");
    }

    const retryAfterSeconds: number =
      TelegramVerificationToken.getResendRetryAfterSeconds({
        token: item.verificationCode,
      });

    if (
      !TelegramVerificationToken.isExpired({
        token: item.verificationCode,
      }) &&
      retryAfterSeconds > 0
    ) {
      throw new TooManyRequestsException(
        `Please wait ${retryAfterSeconds} seconds before rotating the Telegram verification code.`,
      );
    }

    const verificationCode: string = TelegramVerificationToken.mint();

    await this.updateColumnsByIdWithoutHooks({
      id: itemId,
      data: {
        verificationCode,
      },
      expectedData: {
        isVerified: false,
        ...(item.verificationCode !== undefined
          ? { verificationCode: item.verificationCode }
          : {}),
      },
    });

    const updatedItem: Model | null = await this.findOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      select: {
        isVerified: true,
        verificationCode: true,
      },
    });

    if (!updatedItem) {
      throw new BadDataException(
        "Item with ID " + itemId.toString() + " not found",
      );
    }

    if (updatedItem.isVerified) {
      throw new BadDataException("Telegram account already verified");
    }

    if (updatedItem.verificationCode !== verificationCode) {
      throw new TooManyRequestsException(
        "The Telegram verification code changed in another request. Please refresh and try again.",
      );
    }

    return verificationCode;
  }

  @CaptureSpan()
  public async getVerificationCode(itemId: ObjectID): Promise<string> {
    const item: Model | null = await this.findOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      select: {
        isVerified: true,
        verificationCode: true,
      },
    });

    if (!item) {
      throw new BadDataException("Item not found");
    }

    if (item.isVerified) {
      return "";
    }

    if (
      TelegramVerificationToken.isValidShape(item.verificationCode) &&
      !TelegramVerificationToken.isExpired({ token: item.verificationCode })
    ) {
      return item.verificationCode;
    }

    /*
     * Rows created before this fix hold a six-digit value with no timestamp.
     * Expired rows also arrive here. Rotate both on the owner's next view so
     * upgrades fail closed without leaving the user stranded.
     */
    return this.regenerateVerificationCode(itemId);
  }

  @CaptureSpan()
  public async hasActiveProjectMembership(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<boolean> {
    const membership: TeamMember | null = await TeamMemberService.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        hasAcceptedInvitation: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(membership);
  }

  @CaptureSpan()
  public async claimVerificationCode(data: {
    verificationCode: string;
    telegramChatId: string;
  }): Promise<TelegramVerificationResult> {
    if (!TelegramVerificationToken.isValidShape(data.verificationCode)) {
      return { outcome: TelegramVerificationOutcome.Invalid };
    }

    if (
      TelegramVerificationToken.isExpired({
        token: data.verificationCode,
      })
    ) {
      return { outcome: TelegramVerificationOutcome.Expired };
    }

    const item: Model | null = await this.findOneBy({
      query: {
        verificationCode: data.verificationCode,
        isVerified: false,
      },
      select: {
        _id: true,
        userId: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!item?.id || !item.projectId || !item.userId) {
      return { outcome: TelegramVerificationOutcome.Invalid };
    }

    if (
      !(await this.hasActiveProjectMembership({
        projectId: item.projectId,
        userId: item.userId,
      }))
    ) {
      return { outcome: TelegramVerificationOutcome.Invalid };
    }

    /*
     * Compare-and-set is essential here. Two chats can submit one leaked link
     * at the same time; only the UPDATE whose expected token and unverified
     * state still match may bind the row. The winner burns the capability in
     * the same statement, so replay is impossible.
     */
    const queryBuilder: UpdateQueryBuilder<Model> = this.getRepository()
      .createQueryBuilder()
      .update(Model)
      .set({
        isVerified: true,
        telegramChatId: data.telegramChatId,
        verificationCode: TelegramVerificationToken.mintUnusableValue(),
      } as QueryDeepPartialEntity<Model>)
      .where('"_id" = :itemId', { itemId: item.id.toString() })
      .andWhere('"isVerified" = :isVerified', { isVerified: false })
      .andWhere('"verificationCode" = :verificationCode', {
        verificationCode: data.verificationCode,
      })
      .andWhere(
        `EXISTS (
          SELECT 1
          FROM "TeamMember"
          WHERE "projectId" = :projectId
            AND "userId" = :userId
            AND "hasAcceptedInvitation" = TRUE
            AND "deletedAt" IS NULL
          FOR KEY SHARE
        )`,
        {
          projectId: item.projectId.toString(),
          userId: item.userId.toString(),
        },
      );

    const updateResult: UpdateResult = await queryBuilder.execute();

    /*
     * The affected-row result is the only reliable winner signal. Re-reading
     * the row cannot distinguish the winner from a simultaneous replay by the
     * same Telegram chat, because both requests observe the same final chat
     * id. Only the statement that changed the row may trigger follow-up work.
     */
    if (updateResult.affected !== 1) {
      return { outcome: TelegramVerificationOutcome.AlreadyClaimed };
    }

    const claimedItem: Model | null = await this.findOneById({
      id: item.id,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        userId: true,
        projectId: true,
        isVerified: true,
        telegramChatId: true,
      },
    });

    if (
      !claimedItem?.isVerified ||
      claimedItem.telegramChatId !== data.telegramChatId
    ) {
      return { outcome: TelegramVerificationOutcome.AlreadyClaimed };
    }

    return {
      outcome: TelegramVerificationOutcome.Verified,
      item: claimedItem,
    };
  }
}

export default new Service();
