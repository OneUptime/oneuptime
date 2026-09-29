import User from "../../Models/DatabaseModels/User";
import ObjectID from "../../Types/ObjectID";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import UserService from "./UserService";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
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
        scheduledMaintenanceId: true,
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
      const scheduledMaintenanceId: ObjectID | undefined =
        item.scheduledMaintenanceId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (scheduledMaintenanceId && userId && projectId) {
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
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
            {
              scheduledMaintenanceId: scheduledMaintenanceId,
              projectId: projectId,
              scheduledMaintenanceFeedEventType:
                ScheduledMaintenanceFeedEventType.OwnerUserRemoved,
              displayColor: Red500,
              feedInfoInMarkdown: `Removed **${user.name.toString()}** (${user.email?.toString()}) from the scheduled maintenance as the owner.`,
              userId: deleteByUserId || undefined,
            },
          );
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
    // add scheduledMaintenance feed.

    const scheduledMaintenanceId: ObjectID | undefined =
      createdItem.scheduledMaintenanceId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (scheduledMaintenanceId && userId && projectId) {
      if (userId) {
        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: scheduledMaintenanceId,
            projectId: projectId,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.OwnerUserAdded,
            displayColor: Gray500,
            feedInfoInMarkdown: `Added **${await UserService.getUserMarkdownString(
              {
                userId: userId,
                projectId: projectId,
              },
            )}** to the scheduled maintenance as the owner.`,
            userId: createdByUserId || undefined,
          },
        );
      }
    }

    // get notification rule where inviteOwners is true.
    const notificationRules: Array<WorkspaceNotificationRule> =
      await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteOwnersIsTrue(
        {
          projectId: projectId!,
          notificationFor: {
            scheduledMaintenanceId: scheduledMaintenanceId,
          },
          notificationRuleEventType:
            NotificationRuleEventType.ScheduledMaintenance,
        },
      );

    WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels:
          await ScheduledMaintenanceService.getWorkspaceChannelForScheduledMaintenance(
            {
              scheduledMaintenanceId: scheduledMaintenanceId!,
            },
          ),
        userIds: [userId!],
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}

export default new Service();
