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
import PrivateNetworkWebhookConfig from "../Utils/PrivateNetworkWebhookConfig";
import ProjectService from "./ProjectService";
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

    await SSRFProtection.validateWebhookTargetIsSafe(createBy.data.webhookUrl, {
      allowPrivateNetworkTargets:
        await ProjectService.isPrivateNetworkWebhookAllowed(
          createBy.data.projectId,
        ),
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
        allowPrivateNetworkTargets:
          await this.isPrivateNetworkAllowedForUpdate(updateBy),
      });
    }

    return {
      updateBy,
      carryForward: null,
    };
  }

  /*
   * Whether an UPDATE may repoint a webhook at a private network address
   * (issue #3424).
   *
   * The project has to come from the rows being updated, not from the payload:
   * `updateBy.data.projectId` is caller-supplied, so reading it there would
   * let a request borrow another project's opt-in by naming its id. An update
   * matching rows in several projects only gets the exception if EVERY one of
   * them opted in, and one matching no rows gets nothing.
   *
   * The instance check comes first so the extra read only happens on the
   * deployments where the answer can be anything but false.
   */
  private async isPrivateNetworkAllowedForUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<boolean> {
    if (!PrivateNetworkWebhookConfig.isConfiguredOnInstance()) {
      return false;
    }

    const webhooks: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: { projectId: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    if (webhooks.length === 0) {
      return false;
    }

    for (const webhook of webhooks) {
      if (
        !(await ProjectService.isPrivateNetworkWebhookAllowed(
          webhook.projectId,
        ))
      ) {
        return false;
      }
    }

    return true;
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
