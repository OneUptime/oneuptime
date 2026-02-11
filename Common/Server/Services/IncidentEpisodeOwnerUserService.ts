import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
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
        incidentEpisodeId: true,
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
      const incidentEpisodeId: ObjectID | undefined = item.incidentEpisodeId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (incidentEpisodeId && userId && projectId) {
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
        } = await IncidentEpisodeService.getEpisodeNumber({
          episodeId: incidentEpisodeId,
        });
        const episodeNumberDisplay: string =
          episodeNumberResult.numberWithPrefix ||
          "#" + episodeNumberResult.number;

        if (user && user.name) {
          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId: incidentEpisodeId,
            projectId: projectId,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) from the [Episode ${episodeNumberDisplay}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId!, incidentEpisodeId!)).toString()}) as the owner.`,
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
    const incidentEpisodeId: ObjectID | undefined =
      createdItem.incidentEpisodeId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (incidentEpisodeId && userId && projectId) {
      const episodeNumberResult: {
        number: number | null;
        numberWithPrefix: string | null;
      } = await IncidentEpisodeService.getEpisodeNumber({
        episodeId: incidentEpisodeId,
      });
      const episodeNumberDisplay: string =
        episodeNumberResult.numberWithPrefix ||
        "#" + episodeNumberResult.number;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: incidentEpisodeId,
        projectId: projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.OwnerUserAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `👨🏻‍💻 Added **${await UserService.getUserMarkdownString(
          {
            userId: userId,
            projectId: projectId,
          },
        )}** to the [Episode ${episodeNumberDisplay}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId!, incidentEpisodeId!)).toString()}) as the owner.`,
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
              incidentEpisodeId: incidentEpisodeId,
            },
            notificationRuleEventType:
              NotificationRuleEventType.IncidentEpisode,
          },
        );

      // Fetch episode to get workspace channels
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: incidentEpisodeId,
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
            workspaceChannels:
              episode.postUpdatesToWorkspaceChannels || [],
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
