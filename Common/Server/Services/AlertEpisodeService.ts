import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import AlertStateService from "./AlertStateService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../Models/DatabaseModels/AlertState";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AlertEpisodeStateTimeline from "../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertEpisodeStateTimelineService from "./AlertEpisodeStateTimelineService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import { Red500, Green500 } from "../../Types/BrandColors";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import AlertSeverityService from "./AlertSeverityService";
import AlertEpisodeMemberService from "./AlertEpisodeMemberService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async getExistingEpisodeNumberForProject(data: {
    projectId: ObjectID;
  }): Promise<number> {
    const lastEpisode: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        episodeNumber: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    if (!lastEpisode) {
      return 0;
    }

    return lastEpisode.episodeNumber ? Number(lastEpisode.episodeNumber) : 0;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException("ProjectId required to create alert episode.");
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    // Get the created state for episodes
    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: projectId,
        isCreatedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alertState || !alertState.id) {
      throw new BadDataException(
        "Created alert state not found for this project. Please add created alert state from settings.",
      );
    }

    createBy.data.currentAlertStateId = alertState.id;

    // Auto-generate episode number
    const episodeNumberForThisEpisode: number =
      (await this.getExistingEpisodeNumberForProject({
        projectId: projectId,
      })) + 1;

    createBy.data.episodeNumber = episodeNumberForThisEpisode;

    // Set initial lastAlertAddedAt
    if (!createBy.data.lastAlertAddedAt) {
      createBy.data.lastAlertAddedAt = OneUptimeDate.getCurrentDate();
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    if (!createdItem.currentAlertStateId) {
      throw new BadDataException("currentAlertStateId is required");
    }

    // Create initial state timeline entry
    Promise.resolve()
      .then(async () => {
        try {
          await this.changeEpisodeState({
            projectId: createdItem.projectId!,
            episodeId: createdItem.id!,
            alertStateId: createdItem.currentAlertStateId!,
            notifyOwners: false,
            rootCause: undefined,
            props: {
              isRoot: true,
            },
          });
        } catch (error) {
          logger.error(
            `Handle episode state change failed in AlertEpisodeService.onCreateSuccess: ${error}`,
          );
        }
      })
      .then(async () => {
        try {
          await this.createEpisodeCreatedFeed(createdItem);
        } catch (error) {
          logger.error(
            `Create episode feed failed in AlertEpisodeService.onCreateSuccess: ${error}`,
          );
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in AlertEpisodeService.onCreateSuccess: ${error}`,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async createEpisodeCreatedFeed(episode: Model): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
    }

    let feedInfoInMarkdown: string = `#### Episode ${episode.episodeNumber?.toString()} Created

**${episode.title || "No title provided."}**

`;

    if (episode.description) {
      feedInfoInMarkdown += `${episode.description}\n\n`;
    }

    if (episode.isManuallyCreated) {
      feedInfoInMarkdown += `This episode was manually created.\n\n`;
    }

    await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
      alertEpisodeId: episode.id,
      projectId: episode.projectId,
      alertEpisodeFeedEventType: AlertEpisodeFeedEventType.EpisodeCreated,
      displayColor: Red500,
      feedInfoInMarkdown: feedInfoInMarkdown,
      userId: episode.createdByUserId || undefined,
    });
  }

  @CaptureSpan()
  public async changeEpisodeState(data: {
    projectId: ObjectID;
    episodeId: ObjectID;
    alertStateId: ObjectID;
    notifyOwners: boolean;
    rootCause: string | undefined;
    props: DatabaseCommonInteractionProps;
    cascadeToAlerts?: boolean;
  }): Promise<void> {
    const {
      projectId,
      episodeId,
      alertStateId,
      notifyOwners,
      rootCause,
      props,
    } = data;

    // Get last episode state timeline
    const lastEpisodeStateTimeline: AlertEpisodeStateTimeline | null =
      await AlertEpisodeStateTimelineService.findOneBy({
        query: {
          alertEpisodeId: episodeId,
          projectId: projectId,
        },
        select: {
          _id: true,
          alertStateId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      lastEpisodeStateTimeline &&
      lastEpisodeStateTimeline.alertStateId &&
      lastEpisodeStateTimeline.alertStateId.toString() ===
        alertStateId.toString()
    ) {
      return;
    }

    const stateTimeline: AlertEpisodeStateTimeline =
      new AlertEpisodeStateTimeline();

    stateTimeline.alertEpisodeId = episodeId;
    stateTimeline.alertStateId = alertStateId;
    stateTimeline.projectId = projectId;
    stateTimeline.isOwnerNotified = !notifyOwners;

    if (rootCause) {
      stateTimeline.rootCause = rootCause;
    }

    await AlertEpisodeStateTimelineService.create({
      data: stateTimeline,
      props: props || {},
    });

    // Update resolved timestamp if this is a resolved state
    const alertState: AlertState | null = await AlertStateService.findOneById({
      id: alertStateId,
      select: {
        isResolvedState: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (alertState?.isResolvedState) {
      await this.updateOneById({
        id: episodeId,
        data: {
          resolvedAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  public async acknowledgeEpisode(
    episodeId: ObjectID,
    acknowledgedByUserId: ObjectID,
    cascadeToAlerts: boolean = true,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: episode.projectId,
        isAcknowledgedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alertState || !alertState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project.",
      );
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      alertStateId: alertState.id,
      notifyOwners: true,
      rootCause: undefined,
      props: {
        isRoot: true,
        userId: acknowledgedByUserId,
      },
      cascadeToAlerts: cascadeToAlerts,
    });
  }

  @CaptureSpan()
  public async resolveEpisode(
    episodeId: ObjectID,
    resolvedByUserId: ObjectID,
    cascadeToAlerts: boolean = true,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: episode.projectId,
        isResolvedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alertState || !alertState.id) {
      throw new BadDataException("Resolved state not found for this project.");
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      alertStateId: alertState.id,
      notifyOwners: true,
      rootCause: undefined,
      props: {
        isRoot: true,
        userId: resolvedByUserId,
      },
      cascadeToAlerts: cascadeToAlerts,
    });

    // Create feed for episode resolved
    await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
      alertEpisodeId: episodeId,
      projectId: episode.projectId,
      alertEpisodeFeedEventType: AlertEpisodeFeedEventType.EpisodeStateChanged,
      displayColor: Green500,
      feedInfoInMarkdown: `Episode has been resolved.`,
      userId: resolvedByUserId || undefined,
    });
  }

  @CaptureSpan()
  public async updateEpisodeSeverity(data: {
    episodeId: ObjectID;
    severityId: ObjectID;
    onlyIfHigher: boolean;
  }): Promise<void> {
    const { episodeId, severityId, onlyIfHigher } = data;

    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        alertSeverityId: true,
        alertSeverity: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode) {
      throw new BadDataException("Episode not found.");
    }

    if (onlyIfHigher && episode.alertSeverity?.order !== undefined) {
      // Get the new severity to check its order
      const newSeverity: AlertSeverity | null =
        await AlertSeverityService.findOneById({
          id: severityId,
          select: {
            order: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (newSeverity && newSeverity.order !== undefined) {
        // Lower order = higher severity
        if (newSeverity.order >= episode.alertSeverity.order) {
          return; // Don't update if new severity is not higher
        }
      }
    }

    await this.updateOneById({
      id: episodeId,
      data: {
        alertSeverityId: severityId,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async updateAlertCount(episodeId: ObjectID): Promise<void> {
    const count: PositiveNumber = await AlertEpisodeMemberService.countBy({
      query: {
        alertEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
    });

    await this.updateOneById({
      id: episodeId,
      data: {
        alertCount: count.toNumber(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async updateLastAlertAddedAt(episodeId: ObjectID): Promise<void> {
    await this.updateOneById({
      id: episodeId,
      data: {
        lastAlertAddedAt: OneUptimeDate.getCurrentDate(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async isEpisodeResolved(episodeId: ObjectID): Promise<boolean> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
        currentAlertState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    const resolvedState: AlertState =
      await AlertStateService.getResolvedAlertState({
        projectId: episode.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentOrder: number = episode.currentAlertState?.order || 0;
    const resolvedOrder: number = resolvedState.order || 0;

    return currentOrder >= resolvedOrder;
  }

  @CaptureSpan()
  public async isEpisodeAcknowledged(data: {
    episodeId: ObjectID;
  }): Promise<boolean> {
    const episode: Model | null = await this.findOneById({
      id: data.episodeId,
      select: {
        projectId: true,
        currentAlertState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    const acknowledgedState: AlertState =
      await AlertStateService.getAcknowledgedAlertState({
        projectId: episode.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentOrder: number = episode.currentAlertState?.order || 0;
    const acknowledgedOrder: number = acknowledgedState.order || 0;

    return currentOrder >= acknowledgedOrder;
  }

  @CaptureSpan()
  public async reopenEpisode(
    episodeId: ObjectID,
    reopenedByUserId?: ObjectID,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    // Get the created state
    const createdState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: episode.projectId,
        isCreatedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!createdState || !createdState.id) {
      throw new BadDataException("Created state not found for this project.");
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      alertStateId: createdState.id,
      notifyOwners: true,
      rootCause: "Episode reopened due to new alert added.",
      props: {
        isRoot: true,
        userId: reopenedByUserId,
      },
    });

    // Clear resolved timestamp
    await this.updateOneById({
      id: episodeId,
      data: {
        resolvedAt: undefined as any,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async getEpisodeLinkInDashboard(
    projectId: ObjectID,
    episodeId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/alerts/episodes/${episodeId.toString()}`,
    );
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    // Handle state changes
    if (
      onUpdate.updateBy.data.currentAlertStateId &&
      onUpdate.updateBy.props.tenantId
    ) {
      for (const itemId of updatedItemIds) {
        await this.changeEpisodeState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          episodeId: itemId,
          alertStateId: onUpdate.updateBy.data.currentAlertStateId as ObjectID,
          notifyOwners: true,
          rootCause: "State was changed when the episode was updated.",
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onUpdate;
  }
}

export default new Service();
