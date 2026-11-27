import ObjectID from "../../Types/ObjectID";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
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
import { mdText, MarkdownText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * A MAINTENANCE EVENT'S OWNERS, AND WHAT ITS CHANNELS HEAR OF THEM
 * (#11223).
 *
 * A person made an owner of an event, or taken off as one, writes a line to
 * the event's feed, which is posted to its Slack, Microsoft Teams and
 * Mattermost channels too - as every other kind of record's owner lines
 * are, through the feed entry's workspace notification
 * (ScheduledMaintenanceOwnerTeamService says what that brings).
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Model[] = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        scheduledMaintenanceId: true,
        projectId: true,
        userId: true,
      },
    );

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
        /*
         * The entry is the channels' line too: the owner is named as the
         * added entry names them, linked to their page - someone only
         * invited by the name typed for them, never by an address, and no
         * address after anybody's name (FeedPersonName, #10668). A member
         * with no name is no longer taken off without a word.
         */
        const owner: MarkdownText = await UserService.getUserMarkdownString({
          userId: userId,
          projectId: projectId,
        });

        if (!owner.isEmpty()) {
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
            {
              scheduledMaintenanceId: scheduledMaintenanceId,
              projectId: projectId,
              scheduledMaintenanceFeedEventType:
                ScheduledMaintenanceFeedEventType.OwnerUserRemoved,
              displayColor: Red500,
              feedInfoInMarkdown:
                mdText`👨🏻‍💻 Removed **${owner}** from the ${await ScheduledMaintenanceService.getScheduledMaintenanceMarkdownLink(
                  {
                    projectId: projectId,
                    scheduledMaintenanceId: scheduledMaintenanceId,
                  },
                )} as the owner.`.toString(),
              userId: deleteByUserId || undefined,
              workspaceNotification: {
                sendWorkspaceNotification: true,
                leadWithAuthor: true,
              },
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
            feedInfoInMarkdown:
              mdText`👨🏻‍💻 Added **${await UserService.getUserMarkdownString({
                userId: userId,
                projectId: projectId,
              })}** to the ${await ScheduledMaintenanceService.getScheduledMaintenanceMarkdownLink(
                {
                  projectId: projectId,
                  scheduledMaintenanceId: scheduledMaintenanceId,
                },
              )} as the owner.`.toString(),
            userId: createdByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              leadWithAuthor: true,
            },
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
        notificationFor: {
          scheduledMaintenanceId: scheduledMaintenanceId,
        },
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}

export default new Service();
