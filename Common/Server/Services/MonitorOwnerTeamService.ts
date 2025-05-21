import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorFeedService from "./MonitorFeedService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import TeamService from "./TeamService";
import Team from "../../Models/DatabaseModels/Team";
import DeleteBy from "../Types/Database/DeleteBy";
import MonitorService from "./MonitorService";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceNotificationRule from "../../Models/DatabaseModels/WorkspaceNotificationRule";
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
        monitorId: true,
        projectId: true,
        teamId: true,
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
      const monitorId: ObjectID | undefined = item.monitorId;
      const projectId: ObjectID | undefined = item.projectId;
      const teamId: ObjectID | undefined = item.teamId;

      if (monitorId && teamId && projectId) {
        const team: Team | null = await TeamService.findOneById({
          id: teamId,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

        const monitorName: string = await MonitorService.getMonitorName({
          monitorId: monitorId,
        });

        if (team && team.name) {
          await MonitorFeedService.createMonitorFeedItem({
            monitorId: monitorId,
            projectId: projectId,
            monitorFeedEventType: MonitorFeedEventType.OwnerTeamRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Removed team **${team.name}** from the [Monitor ${monitorName}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitorId!)).toString()}) as the owner.`,
            userId: deleteByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: deleteByUserId || undefined,
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
    // add monitor feed.

    const monitorId: ObjectID | undefined = createdItem.monitorId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const teamId: ObjectID | undefined = createdItem.teamId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (monitorId && teamId && projectId) {
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
        const monitorName: string = await MonitorService.getMonitorName({
          monitorId: monitorId,
        });

        await MonitorFeedService.createMonitorFeedItem({
          monitorId: monitorId,
          projectId: projectId,
          monitorFeedEventType: MonitorFeedEventType.OwnerTeamAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `👨🏻‍👩🏻‍👦🏻 Added team **${team.name}** to the [Monitor ${monitorName}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitorId!)).toString()}) as the owner.`,
          userId: createdByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: createdByUserId || undefined,
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
            monitorId: monitorId,
          },
          notificationRuleEventType: NotificationRuleEventType.Monitor,
        },
      );

    logger.debug(`Notification Rules for Monitor Owner Teams`);
    logger.debug(notificationRules);

    WorkspaceNotificationRuleService.inviteTeamsBasedOnRulesAndWorkspaceChannels(
      {
        notificationRules: notificationRules,
        projectId: projectId!,
        workspaceChannels: await MonitorService.getWorkspaceChannelForMonitor({
          monitorId: monitorId!,
        }),
        teamIds: [teamId!],
      },
    ).catch((error: Error) => {
      logger.error(error);
    });

    return createdItem;
  }
}

export default new Service();
