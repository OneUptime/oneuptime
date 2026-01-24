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
import { Red500, Green500, Yellow500 } from "../../Types/BrandColors";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import AlertSeverityService from "./AlertSeverityService";
import AlertEpisodeMemberService from "./AlertEpisodeMemberService";
import AlertEpisodeOwnerUserService from "./AlertEpisodeOwnerUserService";
import AlertEpisodeOwnerTeamService from "./AlertEpisodeOwnerTeamService";
import TeamMemberService from "./TeamMemberService";
import AlertEpisodeOwnerUser from "../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import AlertEpisodeOwnerTeam from "../../Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeMember from "../../Models/DatabaseModels/AlertEpisodeMember";
import User from "../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import Typeof from "../../Types/Typeof";

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
      cascadeToAlerts,
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

    // Cascade state change to all member alerts if requested
    if (cascadeToAlerts) {
      await this.cascadeStateToMemberAlerts({
        projectId,
        episodeId,
        alertStateId,
        props,
      });
    }
  }

  @CaptureSpan()
  private async cascadeStateToMemberAlerts(data: {
    projectId: ObjectID;
    episodeId: ObjectID;
    alertStateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { projectId, episodeId, alertStateId, props } = data;

    // Get all member alerts for this episode
    const members: Array<AlertEpisodeMember> =
      await AlertEpisodeMemberService.findBy({
        query: {
          alertEpisodeId: episodeId,
          projectId: projectId,
        },
        select: {
          alertId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    if (members.length === 0) {
      return;
    }

    // Import AlertService dynamically to avoid circular dependency
    const { default: AlertService } = await import("./AlertService");

    // Update state for each member alert
    for (const member of members) {
      if (!member.alertId) {
        continue;
      }

      try {
        await AlertService.changeAlertState({
          projectId: projectId,
          alertId: member.alertId,
          alertStateId: alertStateId,
          notifyOwners: false, // Don't send notifications for cascaded state changes
          rootCause: "State changed by episode state cascade.",
          stateChangeLog: undefined,
          props: props,
        });
      } catch (error) {
        logger.error(
          `Failed to cascade state change to alert ${member.alertId.toString()}: ${error}`,
        );
      }
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

    // Create feed for episode acknowledged
    let feedMessage: string = "Episode has been acknowledged.";
    if (cascadeToAlerts) {
      feedMessage += " All member alerts have also been acknowledged.";
    }

    await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
      alertEpisodeId: episodeId,
      projectId: episode.projectId,
      alertEpisodeFeedEventType: AlertEpisodeFeedEventType.EpisodeStateChanged,
      displayColor: Yellow500,
      feedInfoInMarkdown: feedMessage,
      userId: acknowledgedByUserId || undefined,
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
    let feedMessage: string = "Episode has been resolved.";
    if (cascadeToAlerts) {
      feedMessage += " All member alerts have also been resolved.";
    }

    await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
      alertEpisodeId: episodeId,
      projectId: episode.projectId,
      alertEpisodeFeedEventType: AlertEpisodeFeedEventType.EpisodeStateChanged,
      displayColor: Green500,
      feedInfoInMarkdown: feedMessage,
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

    const alertCount: number = count.toNumber();

    // Get the episode to check for templates
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        titleTemplate: true,
        descriptionTemplate: true,
        title: true,
        description: true,
      },
      props: {
        isRoot: true,
      },
    });

    const updateData: {
      alertCount: number;
      title?: string;
      description?: string;
    } = {
      alertCount: alertCount,
    };

    // Update title with dynamic variables if template exists
    if (episode?.titleTemplate) {
      updateData.title = this.renderTemplateWithDynamicValues(
        episode.titleTemplate,
        alertCount,
      );
    }

    // Update description with dynamic variables if template exists
    if (episode?.descriptionTemplate) {
      updateData.description = this.renderTemplateWithDynamicValues(
        episode.descriptionTemplate,
        alertCount,
      );
    }

    await this.updateOneById({
      id: episodeId,
      data: updateData,
      props: {
        isRoot: true,
      },
    });
  }

  private renderTemplateWithDynamicValues(
    template: string,
    alertCount: number,
  ): string {
    let result: string = template;

    // Replace dynamic variables
    result = result.replace(/\{\{alertCount\}\}/g, alertCount.toString());

    return result;
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

  @CaptureSpan()
  public async findOwners(episodeId: ObjectID): Promise<Array<User>> {
    // Get direct user owners
    const ownerUsers: Array<AlertEpisodeOwnerUser> =
      await AlertEpisodeOwnerUserService.findBy({
        query: {
          alertEpisodeId: episodeId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Get team owners
    const ownerTeams: Array<AlertEpisodeOwnerTeam> =
      await AlertEpisodeOwnerTeamService.findBy({
        query: {
          alertEpisodeId: episodeId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const users: Array<User> = ownerUsers
      .map((ownerUser: AlertEpisodeOwnerUser) => {
        return ownerUser.user!;
      })
      .filter((user: User) => {
        return Boolean(user);
      });

    // Expand teams to individual users
    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> = ownerTeams.map(
        (ownerTeam: AlertEpisodeOwnerTeam) => {
          return ownerTeam.teamId!;
        },
      );

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        // Avoid duplicates
        if (
          !users.find((user: User) => {
            return user.id?.toString() === teamUser.id?.toString();
          })
        ) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  @CaptureSpan()
  public async getWorkspaceChannelForEpisode(data: {
    episodeId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const episode: Model | null = await this.findOneById({
      id: data.episodeId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode) {
      throw new BadDataException("Alert Episode not found.");
    }

    return (episode.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }
        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    episodeId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: AlertEpisodeOwnerTeam = new AlertEpisodeOwnerTeam();
      teamOwner.alertEpisodeId = episodeId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await AlertEpisodeOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }

      const userOwner: AlertEpisodeOwnerUser = new AlertEpisodeOwnerUser();
      userOwner.alertEpisodeId = episodeId;
      userOwner.projectId = projectId;
      userOwner.userId = userId;
      userOwner.isOwnerNotified = !notifyOwners;

      await AlertEpisodeOwnerUserService.create({
        data: userOwner,
        props: props,
      });
    }
  }
}

export default new Service();
