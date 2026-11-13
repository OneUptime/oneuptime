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
                mdText`Removed team **${team.name}** from the scheduled maintenance as the owner.`.toString(),
              userId: deleteByUserId || undefined,
            },
          );
        }
      }
    }

    /*
     * Who owns the event changed, so a rule with an owners condition may
     * match it now ("Scheduled Maintenance Owner is none of ..."): a rule
     * that starts to match opens its channel, as it does when an
     * incident's owners change - whose change is posted, which checks the
     * rules on the way (WorkspaceNotificationRuleService
     * .createChannelsForRulesThatNowMatch). A maintenance event's owner
     * changes are not posted, so the rules are checked here.
     */
    await Service.checkRulesAgain(itemsToDelete);

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
              mdText`Added team **${team.name}** to the scheduled maintenance as the owner.`.toString(),
            userId: createdByUserId || undefined,
          },
        );
      }
    }

    /*
     * A new owner can make a rule with an owners condition match the event
     * ("Scheduled Maintenance Owner is any of Platform team"): that rule
     * opens its channel now, with its people - this owner among them, as a
     * rule that invites owners invites them. Checked before this owner is
     * invited to the channels the event has already.
     */
    await Service.checkRulesAgain([createdItem]);

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

  /*
   * The rules of the events whose owners changed, checked again: a rule
   * that now matches one, and creates a channel, opens it
   * (createChannelsForRulesThatNowMatch, which never throws).
   */
  public static async checkRulesAgain(rows: Array<Model>): Promise<void> {
    const checked: Set<string> = new Set();

    for (const row of rows) {
      if (!row.scheduledMaintenanceId || !row.projectId) {
        continue;
      }

      const key: string = row.scheduledMaintenanceId.toString();

      if (checked.has(key)) {
        continue;
      }

      checked.add(key);

      await WorkspaceNotificationRuleService.createChannelsForRulesThatNowMatch(
        {
          projectId: row.projectId,
          notificationFor: {
            scheduledMaintenanceId: row.scheduledMaintenanceId,
          },
        },
      );
    }
  }
}

export default new Service();
