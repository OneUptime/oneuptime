import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
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
        alertEpisodeId: true,
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
      const alertEpisodeId: ObjectID | undefined = item.alertEpisodeId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (alertEpisodeId && userId && projectId) {
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

        const episodeNumberResult: {
          number: number | null;
          numberWithPrefix: string | null;
        } = await AlertEpisodeService.getEpisodeNumber({
          episodeId: alertEpisodeId,
        });
        const episodeNumberDisplay: string =
          episodeNumberResult.numberWithPrefix ||
          "#" + episodeNumberResult.number;

        if (user && user.name) {
          await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
            alertEpisodeId: alertEpisodeId,
            projectId: projectId,
            alertEpisodeFeedEventType:
              AlertEpisodeFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) from the [Episode ${episodeNumberDisplay}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(projectId!, alertEpisodeId!)).toString()}) as the owner.`,
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
    const alertEpisodeId: ObjectID | undefined = createdItem.alertEpisodeId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (alertEpisodeId && userId && projectId) {
      const episodeNumberResult: {
        number: number | null;
        numberWithPrefix: string | null;
      } = await AlertEpisodeService.getEpisodeNumber({
        episodeId: alertEpisodeId,
      });
      const episodeNumberDisplay: string =
        episodeNumberResult.numberWithPrefix ||
        "#" + episodeNumberResult.number;

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: alertEpisodeId,
        projectId: projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OwnerUserAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `👨🏻‍💻 Added **${await UserService.getUserMarkdownString(
          {
            userId: userId,
            projectId: projectId,
          },
        )}** to the [Episode ${episodeNumberDisplay}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(projectId!, alertEpisodeId!)).toString()}) as the owner.`,
        userId: createdByUserId || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: userId || undefined,
        },
      });

      // get notification rule where inviteOwners is true.
      const notificationRules: Array<WorkspaceNotificationRule> =
        await WorkspaceNotificationRuleService.getNotificationRulesWhereInviteOwnersIsTrue(
          {
            projectId: projectId,
            notificationFor: {
              alertEpisodeId: alertEpisodeId,
            },
            notificationRuleEventType: NotificationRuleEventType.AlertEpisode,
          },
        );

      // Fetch episode to get workspace channels
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: alertEpisodeId,
          select: {
            postUpdatesToWorkspaceChannels: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (episode) {
        WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
          {
            notificationRules: notificationRules,
            projectId: projectId,
            workspaceChannels: episode.postUpdatesToWorkspaceChannels || [],
            userIds: [userId],
          },
        ).catch((error: Error) => {
          logger.error(error);
        });
      }
    }

    return createdItem;
  }
}

export default new Service();
