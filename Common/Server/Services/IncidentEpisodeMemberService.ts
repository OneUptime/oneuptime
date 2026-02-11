import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/IncidentEpisodeMember";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Yellow500, Green500 } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import IncidentService from "./IncidentService";
import IncidentEpisodeService from "./IncidentEpisodeService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is required");
    }

    if (!createBy.data.incidentId) {
      throw new BadDataException("incidentId is required");
    }

    // Check if this incident is already in the episode
    const existingMember: Model | null = await this.findOneBy({
      query: {
        incidentEpisodeId: createBy.data.incidentEpisodeId,
        incidentId: createBy.data.incidentId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    if (existingMember) {
      throw new BadDataException(
        "Incident is already a member of this episode",
      );
    }

    // Set addedAt if not provided
    if (!createBy.data.addedAt) {
      createBy.data.addedAt = OneUptimeDate.getCurrentDate();
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.incidentEpisodeId) {
      throw new BadDataException("incidentEpisodeId is required");
    }

    if (!createdItem.incidentId) {
      throw new BadDataException("incidentId is required");
    }

    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    // Update incident's episode reference
    await IncidentService.updateOneById({
      id: createdItem.incidentId,
      data: {
        incidentEpisodeId: createdItem.incidentEpisodeId,
      },
      props: {
        isRoot: true,
      },
    });

    // Update episode's incidentCount and lastIncidentAddedAt
    try {
      await IncidentEpisodeService.updateIncidentCount(
        createdItem.incidentEpisodeId!,
      );
      await IncidentEpisodeService.updateLastIncidentAddedAt(
        createdItem.incidentEpisodeId!,
      );
    } catch (error) {
      logger.error(
        `Error updating episode counts in IncidentEpisodeMemberService.onCreateSuccess: ${error}`,
      );
    }

    // Get incident details for feed
    const incident: Incident | null = await IncidentService.findOneById({
      id: createdItem.incidentId,
      select: {
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        title: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Get episode details for feed
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: createdItem.incidentEpisodeId,
        select: {
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          title: true,
        },
        props: {
          isRoot: true,
        },
      });

    // Create feed item on episode
    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: createdItem.incidentEpisodeId,
      projectId: createdItem.projectId,
      incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.IncidentAdded,
      displayColor: Yellow500,
      feedInfoInMarkdown: `**Incident ${incident?.incidentNumberWithPrefix || "#" + (incident?.incidentNumber || "N/A")}** added to episode: ${incident?.title || "No title"}`,
      userId: createdItem.addedByUserId || undefined,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: createdItem.addedByUserId || undefined,
      },
    });

    // Create feed item on incident
    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId,
      projectId: createdItem.projectId,
      incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
      displayColor: Yellow500,
      feedInfoInMarkdown: `Added to **Episode ${episode?.episodeNumberWithPrefix || "#" + (episode?.episodeNumber || "N/A")}**: ${episode?.title || "No title"}`,
      userId: createdItem.addedByUserId || undefined,
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Get the member records before deletion
    const membersToDelete: Model[] = await this.findBy({
      query: deleteBy.query,
      props: {
        isRoot: true,
      },
      select: {
        incidentEpisodeId: true,
        incidentId: true,
        projectId: true,
      },
      limit: 100,
      skip: 0,
    });

    return {
      deleteBy,
      carryForward: membersToDelete,
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    const membersDeleted: Model[] = onDelete.carryForward as Model[];

    if (membersDeleted && membersDeleted.length > 0) {
      for (const member of membersDeleted) {
        if (member.incidentId) {
          // Clear the episode reference from the incident
          await IncidentService.updateOneById({
            id: member.incidentId,
            data: {
              incidentEpisodeId: undefined as any,
            },
            props: {
              isRoot: true,
            },
          });

          // Get incident details for feed
          const incident: Incident | null = await IncidentService.findOneById({
            id: member.incidentId,
            select: {
              incidentNumber: true,
              incidentNumberWithPrefix: true,
              title: true,
            },
            props: {
              isRoot: true,
            },
          });

          // Create feed item for removal
          if (member.incidentEpisodeId && member.projectId) {
            // Get episode details for feed
            const episode: IncidentEpisode | null =
              await IncidentEpisodeService.findOneById({
                id: member.incidentEpisodeId,
                select: {
                  episodeNumber: true,
                  episodeNumberWithPrefix: true,
                  title: true,
                },
                props: {
                  isRoot: true,
                },
              });

            // Create feed item on episode
            await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
              incidentEpisodeId: member.incidentEpisodeId,
              projectId: member.projectId,
              incidentEpisodeFeedEventType:
                IncidentEpisodeFeedEventType.IncidentRemoved,
              displayColor: Green500,
              feedInfoInMarkdown: `**Incident ${incident?.incidentNumberWithPrefix || "#" + (incident?.incidentNumber || "N/A")}** removed from episode: ${incident?.title || "No title"}`,
              workspaceNotification: {
                sendWorkspaceNotification: true,
              },
            });

            // Create feed item on incident
            await IncidentFeedService.createIncidentFeedItem({
              incidentId: member.incidentId,
              projectId: member.projectId,
              incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
              displayColor: Green500,
              feedInfoInMarkdown: `Removed from **Episode ${episode?.episodeNumberWithPrefix || "#" + (episode?.episodeNumber || "N/A")}**: ${episode?.title || "No title"}`,
            });
          }
        }

        if (member.incidentEpisodeId) {
          // Update episode's incidentCount
          await IncidentEpisodeService.updateIncidentCount(
            member.incidentEpisodeId,
          );
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public async getIncidentsInEpisode(episodeId: ObjectID): Promise<ObjectID[]> {
    const members: Model[] = await this.findBy({
      query: {
        incidentEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
      select: {
        incidentId: true,
      },
      limit: 1000,
      skip: 0,
    });

    return members
      .filter((m: Model) => {
        return m.incidentId;
      })
      .map((m: Model) => {
        return m.incidentId!;
      });
  }

  @CaptureSpan()
  public async isIncidentInEpisode(
    incidentId: ObjectID,
    episodeId: ObjectID,
  ): Promise<boolean> {
    const member: Model | null = await this.findOneBy({
      query: {
        incidentId: incidentId,
        incidentEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
      },
    });

    return member !== null;
  }
}

export default new Service();
