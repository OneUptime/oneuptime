import { IsBillingEnabled } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Text from "../../Types/Text";
import Project from "../../Models/DatabaseModels/Project";
import Model from "../../Models/DatabaseModels/UserTelegram";
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

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async regenerateVerificationCode(itemId: ObjectID): Promise<void> {
    const item: Model | null = await this.findOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      select: {
        isVerified: true,
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

    await this.updateOneById({
      id: itemId,
      props: {
        isRoot: true,
      },
      data: {
        verificationCode: Text.generateRandomNumber(6),
      },
    });
  }
}

export default new Service();
