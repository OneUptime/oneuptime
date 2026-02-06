import User from "../../Models/DatabaseModels/User";
import ObjectID from "../../Types/ObjectID";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertOwnerUser";
import UserService from "./UserService";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import AlertService from "./AlertService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Model[] = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
      select: {
        alertId: true,
        projectId: true,
        userId: true,
      },
    });

    return {
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
      deleteBy: deleteBy,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deleteByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    const itemsToDelete: Model[] = onDelete.carryForward.itemsToDelete;

    for (const item of itemsToDelete) {
      const alertId: ObjectID | undefined = item.alertId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (alertId && userId && projectId) {
        const user: User | null = await UserService.findOneById({
          id: userId,
          select: {
            name: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (user && user.name) {
          const alertNumberResult = await AlertService.getAlertNumber({
            alertId: alertId,
          });

          await AlertFeedService.createAlertFeedItem({
            alertId: alertId,
            projectId: projectId,
            alertFeedEventType: AlertFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) from the [Alert ${alertNumberResult.numberWithPrefix || '#' + alertNumberResult.number}](${(await AlertService.getAlertLinkInDashboard(projectId!, alertId!)).toString()}) as the owner.`,
            userId: deleteByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: userId || undefined,
            },
          });
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add alert feed.

    const alertId: ObjectID | undefined = createdItem.alertId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (alertId && userId && projectId) {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (user && user.name) {
        const alertNumberResult = await AlertService.getAlertNumber({
          alertId: alertId,
        });
        await AlertFeedService.createAlertFeedItem({
          alertId: alertId,
          projectId: projectId,
          alertFeedEventType: AlertFeedEventType.OwnerUserAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `👨🏻‍💻 Added **${await UserService.getUserMarkdownString(
            {
              userId: userId,
              projectId: projectId,
            },
          )}** to the [Alert ${alertNumberResult.numberWithPrefix || '#' + alertNumberResult.number}](${(await AlertService.getAlertLinkInDashboard(projectId!, alertId!)).toString()}) as the owner.`,
          userId: createdByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: userId || undefined,
          },
        });
      }
    }

    // get notification rule where inviteOwners is true.
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteOwnersIsTrue(
        {
          projectId: projectId!,
          notificationFor: {
            alertId: alertId,
          },
          notificationRuleEventType: NotificationRuleEventType.Alert,
        },
      );

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels: await AlertService.getWorkspaceChannelForAlert({
          alertId: alertId!,
        }),
        userIds: [userId!],
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}

export default new Service();
