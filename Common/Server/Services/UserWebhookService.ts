import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/UserWebhook";
import URL from "../../Types/API/URL";
import logger from "../Utils/Logger";
import SSRFProtection from "../Utils/SSRFProtection";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * URL validation here used to be a hand-rolled copy of the SSRF blocklist that
 * had drifted weaker than the original (it compared the host with the port
 * still attached, and never resolved DNS). Everything that actually sends one
 * of these webhooks goes through WebhookService, which calls
 * SSRFProtection.validateWebhookTargetIsSafe — so the copy bought nothing and
 * would have been read as "this is checked". Both hooks now call the same
 * guard the sender does, which fails the write early instead of at delivery.
 */

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.webhookUrl) {
      throw new BadDataException("Webhook URL is required");
    }

    if (!createBy.data.name) {
      throw new BadDataException("Webhook name is required");
    }

    /*
     * An on-call webhook is registered by the user it pages, from inside a
     * project, so a self-hosted instance may allow it to reach an internal
     * service (issue #3424). Off unless the operator configured it.
     */
    await SSRFProtection.validateWebhookTargetIsSafe(createBy.data.webhookUrl, {
      allowPrivateNetworkTargets: true,
    });

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Create-time validation on its own is not a control: the URL is
     * editable afterwards.
     */
    const webhookUrl: unknown = updateBy.data.webhookUrl;

    if (typeof webhookUrl === "string" || webhookUrl instanceof URL) {
      await SSRFProtection.validateWebhookTargetIsSafe(webhookUrl, {
        allowPrivateNetworkTargets: true,
      });
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /* Webhooks skip verification, so default on-call rules are seeded at create time. */
    if (createdItem.projectId && createdItem.userId && createdItem.id) {
      try {
        await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
          {
            projectId: createdItem.projectId,
            userId: createdItem.userId,
            notificationMethod: {
              userWebhookId: createdItem.id,
            },
          },
        );
      } catch (err) {
        logger.error(err);
      }
    }

    return createdItem;
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
          userWebhookId: item.id!,
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
   * What this user would lose if this webhook were deleted. Ask BEFORE calling
   * delete; nothing here refuses anything.
   *
   * The hook directly above deletes every UserNotificationRule that points at
   * this webhook, and the foreign key is onDelete: "CASCADE" so the rows would
   * go even if it did not. A webhook has no verification concept at all, which
   * makes it the one method that counts the moment it exists — and therefore
   * the one whose deletion can take a responder from reachable to unreachable
   * with nothing in between.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.Webhook,
      methodId: data.itemId,
    });
  }
}

export default new Service();
