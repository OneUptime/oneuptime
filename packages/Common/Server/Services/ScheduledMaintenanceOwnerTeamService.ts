import Team from "../../Models/DatabaseModels/Team";
import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import TeamService from "./TeamService";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
import logger from "../Utils/Logger";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * A MAINTENANCE EVENT'S OWNER TEAMS, AND WHAT ITS CHANNELS HEAR OF THEM
 * (#11223).
 *
 * A team added to an event or taken off it writes a line to the event's
 * feed, which is posted to its Slack, Microsoft Teams and Mattermost
 * channels too - as an incident's, an alert's, an episode's, a monitor's and
 * an on-call policy's owner lines are: through the feed entry's workspace
 * notification, and so through everything a post goes through. A rule that
 * chooses its updates posts it when it ticks Owners (FeedUpdateKinds). A
 * line made while the event is being created waits for "Scheduled
 * Maintenance Created" and follows it (WorkspaceCreatedMessageFirst). And a
 * rule with an owners condition that the change makes match - "Scheduled
 * Maintenance Owner is any of Platform" - opens its channel first, as
 * posting asks for every message about a record
 * (WorkspaceNotificationRuleService.createChannelsForRulesThatNowMatch).
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
        teamId: true,
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
      const teamId: ObjectID | undefined = item.teamId;

      if (scheduledMaintenanceId && teamId && projectId) {
        const team: Team | null = await TeamService.findOneById({
          id: teamId,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (team && team.name) {
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
            {
              scheduledMaintenanceId: scheduledMaintenanceId,
              projectId: projectId,
              scheduledMaintenanceFeedEventType:
                ScheduledMaintenanceFeedEventType.OwnerTeamRemoved,
              displayColor: Red500,
              feedInfoInMarkdown:
                mdText`👨🏻‍👩🏻‍👦🏻 Removed team **${team.name}** from the ${await ScheduledMaintenanceService.getScheduledMaintenanceMarkdownLink(
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
    const teamId: ObjectID | undefined = createdItem.teamId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (scheduledMaintenanceId && teamId && projectId) {
      const team: Team | null = await TeamService.findOneById({
        id: teamId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (team && team.name) {
        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem(
          {
            scheduledMaintenanceId: scheduledMaintenanceId,
            projectId: projectId,
            scheduledMaintenanceFeedEventType:
              ScheduledMaintenanceFeedEventType.OwnerTeamAdded,
            displayColor: Gray500,
            feedInfoInMarkdown:
              mdText`👨🏻‍👩🏻‍👦🏻 Added team **${team.name}** to the ${await ScheduledMaintenanceService.getScheduledMaintenanceMarkdownLink(
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

    logger.debug(`Notification Rules for ScheduledMaintenance Owner Teams`);
    logger.debug(notificationRules);

    WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels:
          await ScheduledMaintenanceService.getWorkspaceChannelForScheduledMaintenance(
            {
              scheduledMaintenanceId: scheduledMaintenanceId!,
            },
          ),
        teamIds: [teamId!],
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
