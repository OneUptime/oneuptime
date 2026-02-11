import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import IncidentStateService from "./IncidentStateService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Model from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IncidentEpisodeStateTimeline from "../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeStateTimelineService from "./IncidentEpisodeStateTimelineService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import OneUptimeDate from "../../Types/Date";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Red500, Yellow500, Purple500 } from "../../Types/BrandColors";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import IncidentEpisodeOwnerUserService from "./IncidentEpisodeOwnerUserService";
import IncidentEpisodeOwnerTeamService from "./IncidentEpisodeOwnerTeamService";
import TeamMemberService from "./TeamMemberService";
import IncidentEpisodeOwnerUser from "../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentEpisodeOwnerTeam from "../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import User from "../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import IncidentEpisodeWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";
import IncidentService from "./IncidentService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import IncidentGroupingRuleService from "./IncidentGroupingRuleService";
import ProjectService from "./ProjectService";
import IncidentGroupingRule from "../../Models/DatabaseModels/IncidentGroupingRule";

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
    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException(
        "ProjectId required to create incident episode.",
      );
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    // Get the created state for episodes
    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
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

    if (!incidentState || !incidentState.id) {
      throw new BadDataException(
        "Created incident state not found for this project. Please add created incident state from settings.",
      );
    }

    createBy.data.currentIncidentStateId = incidentState.id;

    // Auto-generate episode number
    const episodeCounterResult: {
      counter: number;
      prefix: string | undefined;
    } = await ProjectService.incrementAndGetIncidentEpisodeCounter(projectId);

    createBy.data.episodeNumber = episodeCounterResult.counter;
    createBy.data.episodeNumberWithPrefix = episodeCounterResult.prefix
      ? `${episodeCounterResult.prefix}${episodeCounterResult.counter}`
      : `#${episodeCounterResult.counter}`;

    // Set initial lastIncidentAddedAt
    if (!createBy.data.lastIncidentAddedAt) {
      createBy.data.lastIncidentAddedAt = OneUptimeDate.getCurrentDate();
    }

    // Set declaredAt if not provided
    if (!createBy.data.declaredAt) {
      createBy.data.declaredAt = OneUptimeDate.getCurrentDate();
    }

    // Copy showEpisodeOnStatusPage from grouping rule if available
    if (createBy.data.incidentGroupingRuleId) {
      const groupingRule: IncidentGroupingRule | null =
        await IncidentGroupingRuleService.findOneById({
          id: createBy.data.incidentGroupingRuleId,
          select: {
            showEpisodeOnStatusPage: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (groupingRule) {
        createBy.data.isVisibleOnStatusPage =
          groupingRule.showEpisodeOnStatusPage ?? true;
      }
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

    if (!createdItem.currentIncidentStateId) {
      throw new BadDataException("currentIncidentStateId is required");
    }

    // Create initial state timeline entry
    Promise.resolve()
      .then(async () => {
        try {
          if (createdItem.projectId && createdItem.id) {
            await this.handleEpisodeWorkspaceOperationsAsync(createdItem);
          }
        } catch (error) {
          logger.error(
            `Workspace operations failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
          );
        }
      })
      .then(async () => {
        try {
          await this.changeEpisodeState({
            projectId: createdItem.projectId!,
            episodeId: createdItem.id!,
            incidentStateId: createdItem.currentIncidentStateId!,
            notifyOwners: false,
            rootCause: undefined,
            props: {
              isRoot: true,
            },
          });
        } catch (error) {
          logger.error(
            `Handle episode state change failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
          );
        }
      })
      .then(async () => {
        try {
          await this.createEpisodeCreatedFeed(createdItem);
        } catch (error) {
          logger.error(
            `Create episode feed failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
          );
        }
      })
      .then(async () => {
        // Execute on-call duty policies
        try {
          await this.executeEpisodeOnCallDutyPoliciesAsync(createdItem);
        } catch (error) {
          logger.error(
            `On-call duty policy execution failed in IncidentEpisodeService.onCreateSuccess: ${error}`,
          );
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in IncidentEpisodeService.onCreateSuccess: ${error}`,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleEpisodeWorkspaceOperationsAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for workspace operations",
        );
      }

      const workspaceResult: {
        channelsCreated: Array<NotificationRuleWorkspaceChannel>;
      } | null =
        await IncidentEpisodeWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: createdItem.projectId,
            incidentEpisodeId: createdItem.id,
            episodeNumber: createdItem.episodeNumber || 0,
            episodeNumberWithPrefix: createdItem.episodeNumberWithPrefix,
          },
        );

      if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
        await this.updateOneById({
          id: createdItem.id,
          data: {
            postUpdatesToWorkspaceChannels:
              workspaceResult.channelsCreated || [],
          },
          props: {
            isRoot: true,
          },
        });
      }
    } catch (error) {
      logger.error(`Error in handleEpisodeWorkspaceOperationsAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  private async createEpisodeCreatedFeed(episode: Model): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
    }

    let feedInfoInMarkdown: string = `#### Episode ${episode.episodeNumberWithPrefix || "#" + episode.episodeNumber?.toString()} Created

**${episode.title || "No title provided."}**

`;

    if (episode.description) {
      feedInfoInMarkdown += `${episode.description}\n\n`;
    }

    if (episode.isManuallyCreated) {
      feedInfoInMarkdown += `This episode was manually created.\n\n`;
    }

    const episodeCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
      await IncidentEpisodeWorkspaceMessages.getIncidentEpisodeCreateMessageBlocks(
        {
          incidentEpisodeId: episode.id,
          projectId: episode.projectId,
        },
      );

    await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
      incidentEpisodeId: episode.id,
      projectId: episode.projectId,
      incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.EpisodeCreated,
      displayColor: Red500,
      feedInfoInMarkdown: feedInfoInMarkdown,
      userId: episode.createdByUserId || undefined,
      workspaceNotification: {
        appendMessageBlocks: episodeCreateMessageBlocks,
        sendWorkspaceNotification: true,
      },
    });
  }

  @CaptureSpan()
  private async executeEpisodeOnCallDutyPoliciesAsync(
    createdItem: Model,
  ): Promise<void> {
    if (!createdItem.id || !createdItem.projectId) {
      return;
    }

    try {
      // Fetch the episode with on-call duty policies since they may not be loaded
      const episodeWithPolicies: Model | null = await this.findOneById({
        id: createdItem.id,
        select: {
          onCallDutyPolicies: {
            _id: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (
        !episodeWithPolicies?.onCallDutyPolicies?.length ||
        episodeWithPolicies.onCallDutyPolicies.length === 0
      ) {
        return;
      }

      // Execute all on-call policies in parallel
      const policyPromises: Promise<void>[] =
        episodeWithPolicies.onCallDutyPolicies.map(
          (policy: OnCallDutyPolicy) => {
            return OnCallDutyPolicyService.executePolicy(
              new ObjectID(policy._id as string),
              {
                triggeredByIncidentEpisodeId: createdItem.id!,
                userNotificationEventType:
                  UserNotificationEventType.IncidentEpisodeCreated,
              },
            );
          },
        );

      await Promise.allSettled(policyPromises);

      // Update the flag to indicate on-call policy has been executed
      await this.updateOneById({
        id: createdItem.id,
        data: {
          isOnCallPolicyExecuted: true,
        },
        props: {
          isRoot: true,
        },
      });

      // Create feed entry for on-call policy execution
      const policyNames: string[] = episodeWithPolicies.onCallDutyPolicies
        .map((policy: OnCallDutyPolicy) => {
          return policy.name || "Unnamed Policy";
        })
        .filter((name: string) => {
          return Boolean(name);
        });

      let feedInfoInMarkdown: string = `#### On-Call Policy Executed\n\n`;
      feedInfoInMarkdown += `The following on-call ${policyNames.length === 1 ? "policy has" : "policies have"} been executed for this episode:\n\n`;

      for (const policyName of policyNames) {
        feedInfoInMarkdown += `- ${policyName}\n`;
      }

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: createdItem.id,
        projectId: createdItem.projectId,
        incidentEpisodeFeedEventType: IncidentEpisodeFeedEventType.OnCallPolicy,
        displayColor: Purple500,
        feedInfoInMarkdown: feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(`Error in executeEpisodeOnCallDutyPoliciesAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  public async changeEpisodeState(data: {
    projectId: ObjectID;
    episodeId: ObjectID;
    incidentStateId: ObjectID;
    notifyOwners: boolean;
    rootCause: string | undefined;
    props: DatabaseCommonInteractionProps;
    cascadeToIncidents?: boolean;
  }): Promise<void> {
    const {
      projectId,
      episodeId,
      incidentStateId,
      notifyOwners,
      rootCause,
      props,
      cascadeToIncidents,
    } = data;

    // Get last episode state timeline
    const lastEpisodeStateTimeline: IncidentEpisodeStateTimeline | null =
      await IncidentEpisodeStateTimelineService.findOneBy({
        query: {
          incidentEpisodeId: episodeId,
          projectId: projectId,
        },
        select: {
          _id: true,
          incidentStateId: true,
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
      lastEpisodeStateTimeline.incidentStateId &&
      lastEpisodeStateTimeline.incidentStateId.toString() ===
        incidentStateId.toString()
    ) {
      return;
    }

    const stateTimeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();

    stateTimeline.incidentEpisodeId = episodeId;
    stateTimeline.incidentStateId = incidentStateId;
    stateTimeline.projectId = projectId;
    stateTimeline.isOwnerNotified = !notifyOwners;

    if (rootCause) {
      stateTimeline.rootCause = rootCause;
    }

    await IncidentEpisodeStateTimelineService.create({
      data: stateTimeline,
      props: props || {},
    });

    /*
     * Note: resolvedAt is updated by IncidentEpisodeStateTimelineService.onCreateSuccess()
     * to avoid duplicate updates.
     */

    // Cascade state change to all member incidents if requested
    if (cascadeToIncidents) {
      await this.cascadeStateToMemberIncidents({
        projectId,
        episodeId,
        incidentStateId,
        props,
      });
    }
  }

  @CaptureSpan()
  public async cascadeStateToMemberIncidents(data: {
    projectId: ObjectID;
    episodeId: ObjectID;
    incidentStateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { projectId, episodeId, incidentStateId, props } = data;

    // Get all member incidents for this episode
    const members: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: episodeId,
          projectId: projectId,
        },
        select: {
          incidentId: true,
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

    // Update state for each member incident
    for (const member of members) {
      if (!member.incidentId) {
        continue;
      }

      try {
        await IncidentService.changeIncidentState({
          projectId: projectId,
          incidentId: member.incidentId,
          incidentStateId: incidentStateId,
          shouldNotifyStatusPageSubscribers: false,
          isSubscribersNotified: false,
          notifyOwners: false, // Don't send notifications for cascaded state changes
          rootCause: "State changed by episode state cascade.",
          stateChangeLog: undefined,
          props: props,
        });
      } catch (error) {
        logger.error(
          `Failed to cascade state change to incident ${member.incidentId.toString()}: ${error}`,
        );
      }
    }
  }

  @CaptureSpan()
  public async acknowledgeEpisode(
    episodeId: ObjectID,
    acknowledgedByUserId?: ObjectID,
    cascadeToIncidents: boolean = true,
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

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
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

    if (!incidentState || !incidentState.id) {
      throw new BadDataException(
        "Acknowledged incident state not found for this project.",
      );
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      incidentStateId: incidentState.id,
      notifyOwners: false,
      rootCause: acknowledgedByUserId
        ? `Acknowledged by user.`
        : "Acknowledged via API.",
      props: {
        isRoot: true,
        userId: acknowledgedByUserId,
      },
      cascadeToIncidents: cascadeToIncidents,
    });
  }

  @CaptureSpan()
  public async resolveEpisode(
    episodeId: ObjectID,
    resolvedByUserId?: ObjectID,
    cascadeToIncidents: boolean = true,
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

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
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

    if (!incidentState || !incidentState.id) {
      throw new BadDataException(
        "Resolved incident state not found for this project.",
      );
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      incidentStateId: incidentState.id,
      notifyOwners: false,
      rootCause: resolvedByUserId ? `Resolved by user.` : "Resolved via API.",
      props: {
        isRoot: true,
        userId: resolvedByUserId,
      },
      cascadeToIncidents: cascadeToIncidents,
    });
  }

  @CaptureSpan()
  public async reopenEpisode(
    episodeId: ObjectID,
    reopenedByUserId?: ObjectID,
    cascadeToIncidents: boolean = true,
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

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
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

    if (!incidentState || !incidentState.id) {
      throw new BadDataException(
        "Created incident state not found for this project.",
      );
    }

    await this.changeEpisodeState({
      projectId: episode.projectId,
      episodeId: episodeId,
      incidentStateId: incidentState.id,
      notifyOwners: false,
      rootCause: reopenedByUserId ? `Reopened by user.` : "Reopened via API.",
      props: {
        isRoot: true,
        userId: reopenedByUserId,
      },
      cascadeToIncidents: cascadeToIncidents,
    });

    // Clear resolved timestamp and allIncidentsResolvedAt when episode is reopened
    await this.updateOneById({
      id: episodeId,
      data: {
        resolvedAt: null,
        allIncidentsResolvedAt: null,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async updateEpisodeSeverity(
    episodeId: ObjectID,
    severityId: ObjectID,
    onlyIfHigher: boolean = false,
  ): Promise<void> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
        incidentSeverityId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode || !episode.projectId) {
      throw new BadDataException("Episode not found.");
    }

    // If onlyIfHigher is true, check if the new severity is higher than the current
    if (onlyIfHigher && episode.incidentSeverityId) {
      const currentSeverity: IncidentSeverity | null =
        await IncidentSeverityService.findOneById({
          id: episode.incidentSeverityId,
          select: {
            order: true,
          },
          props: {
            isRoot: true,
          },
        });

      const newSeverity: IncidentSeverity | null =
        await IncidentSeverityService.findOneById({
          id: severityId,
          select: {
            order: true,
          },
          props: {
            isRoot: true,
          },
        });

      // Lower order number means higher severity
      if (
        currentSeverity?.order !== undefined &&
        newSeverity?.order !== undefined &&
        newSeverity.order >= currentSeverity.order
      ) {
        return; // New severity is not higher, don't update
      }
    }

    await this.updateOneById({
      id: episodeId,
      data: {
        incidentSeverityId: severityId,
      },
      props: {
        isRoot: true,
      },
    });

    // Create feed entry for severity change
    const newSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneById({
        id: severityId,
        select: {
          name: true,
          color: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (newSeverity && episode.projectId) {
      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episodeId,
        projectId: episode.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.SeverityChanged,
        displayColor: newSeverity.color || Yellow500,
        feedInfoInMarkdown: `Episode severity changed to **${newSeverity.name || "Unknown"}**`,
      });
    }
  }

  @CaptureSpan()
  public async updateIncidentCount(episodeId: ObjectID): Promise<void> {
    const count: PositiveNumber = await IncidentEpisodeMemberService.countBy({
      query: {
        incidentEpisodeId: episodeId,
      },
      props: {
        isRoot: true,
      },
    });

    const incidentCount: number = count.toNumber();

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
      incidentCount: number;
      title?: string;
      description?: string;
    } = {
      incidentCount: incidentCount,
    };

    // Update title with dynamic variables if template exists
    if (episode?.titleTemplate) {
      updateData.title = this.renderTemplateWithDynamicValues(
        episode.titleTemplate,
        incidentCount,
      );
    }

    // Update description with dynamic variables if template exists
    if (episode?.descriptionTemplate) {
      updateData.description = this.renderTemplateWithDynamicValues(
        episode.descriptionTemplate,
        incidentCount,
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
    incidentCount: number,
  ): string {
    let result: string = template;

    // Replace dynamic variables
    result = result.replace(/\{\{incidentCount\}\}/g, incidentCount.toString());

    return result;
  }

  @CaptureSpan()
  public async updateLastIncidentAddedAt(episodeId: ObjectID): Promise<void> {
    await this.updateOneById({
      id: episodeId,
      data: {
        lastIncidentAddedAt: OneUptimeDate.getCurrentDate(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async findOwners(episodeId: ObjectID): Promise<Array<User>> {
    // Get direct user owners
    const userOwners: Array<IncidentEpisodeOwnerUser> =
      await IncidentEpisodeOwnerUserService.findBy({
        query: {
          incidentEpisodeId: episodeId,
        },
        select: {
          userId: true,
          user: {
            _id: true,
            email: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Get team owners
    const teamOwners: Array<IncidentEpisodeOwnerTeam> =
      await IncidentEpisodeOwnerTeamService.findBy({
        query: {
          incidentEpisodeId: episodeId,
        },
        select: {
          teamId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    // Collect all unique users
    const usersMap: Map<string, User> = new Map();

    // Add direct user owners
    for (const owner of userOwners) {
      if (owner.user && owner.userId) {
        usersMap.set(owner.userId.toString(), owner.user);
      }
    }

    // Add users from teams
    for (const teamOwner of teamOwners) {
      if (teamOwner.teamId) {
        const teamMembers: Array<User> = await TeamMemberService.getUsersInTeam(
          teamOwner.teamId,
        );
        for (const user of teamMembers) {
          if (user.id) {
            usersMap.set(user.id.toString(), user);
          }
        }
      }
    }

    return Array.from(usersMap.values());
  }

  @CaptureSpan()
  public async addOwners(data: {
    episodeId: ObjectID;
    projectId: ObjectID;
    userIds?: Array<ObjectID>;
    teamIds?: Array<ObjectID>;
    createdByUserId?: ObjectID;
  }): Promise<void> {
    const { episodeId, projectId, userIds, teamIds, createdByUserId } = data;

    // Add user owners
    if (userIds && userIds.length > 0) {
      for (const userId of userIds) {
        // Check if already exists
        const existing: IncidentEpisodeOwnerUser | null =
          await IncidentEpisodeOwnerUserService.findOneBy({
            query: {
              incidentEpisodeId: episodeId,
              userId: userId,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
            },
          });

        if (!existing) {
          const ownerUser: IncidentEpisodeOwnerUser =
            new IncidentEpisodeOwnerUser();
          ownerUser.incidentEpisodeId = episodeId;
          ownerUser.userId = userId;
          ownerUser.projectId = projectId;
          if (createdByUserId) {
            ownerUser.createdByUserId = createdByUserId;
          }

          await IncidentEpisodeOwnerUserService.create({
            data: ownerUser,
            props: {
              isRoot: true,
            },
          });
        }
      }
    }

    // Add team owners
    if (teamIds && teamIds.length > 0) {
      for (const teamId of teamIds) {
        // Check if already exists
        const existing: IncidentEpisodeOwnerTeam | null =
          await IncidentEpisodeOwnerTeamService.findOneBy({
            query: {
              incidentEpisodeId: episodeId,
              teamId: teamId,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
            },
          });

        if (!existing) {
          const ownerTeam: IncidentEpisodeOwnerTeam =
            new IncidentEpisodeOwnerTeam();
          ownerTeam.incidentEpisodeId = episodeId;
          ownerTeam.teamId = teamId;
          ownerTeam.projectId = projectId;
          if (createdByUserId) {
            ownerTeam.createdByUserId = createdByUserId;
          }

          await IncidentEpisodeOwnerTeamService.create({
            data: ownerTeam,
            props: {
              isRoot: true,
            },
          });
        }
      }
    }
  }

  @CaptureSpan()
  public getWorkspaceChannelForEpisode(
    episode: Model,
    workspaceType: WorkspaceType,
  ): Array<NotificationRuleWorkspaceChannel> {
    if (
      !episode.postUpdatesToWorkspaceChannels ||
      !Array.isArray(episode.postUpdatesToWorkspaceChannels) ||
      episode.postUpdatesToWorkspaceChannels.length === 0
    ) {
      return [];
    }

    return episode.postUpdatesToWorkspaceChannels.filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        return channel.workspaceType === workspaceType;
      },
    );
  }

  @CaptureSpan()
  public async isEpisodeResolved(episodeId: ObjectID): Promise<boolean> {
    const episode: Model | null = await this.findOneById({
      id: episodeId,
      select: {
        projectId: true,
        currentIncidentState: {
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

    const resolvedState: IncidentState =
      await IncidentStateService.getResolvedIncidentState({
        projectId: episode.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentOrder: number = episode.currentIncidentState?.order || 0;
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
        currentIncidentState: {
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

    const acknowledgedState: IncidentState =
      await IncidentStateService.getAcknowledgedIncidentState({
        projectId: episode.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentOrder: number = episode.currentIncidentState?.order || 0;
    const acknowledgedOrder: number = acknowledgedState.order || 0;

    return currentOrder >= acknowledgedOrder;
  }

  @CaptureSpan()
  public async getEpisodeLinkInDashboard(
    projectId: ObjectID,
    episodeId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/incidents/episodes/${episodeId.toString()}`,
    );
  }

  @CaptureSpan()
  public async getEpisodeNumber(data: { episodeId: ObjectID }): Promise<{
    number: number | null;
    numberWithPrefix: string | null;
  }> {
    const episode: Model | null = await this.findOneById({
      id: data.episodeId,
      select: {
        episodeNumber: true,
        episodeNumberWithPrefix: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!episode) {
      throw new BadDataException("Episode not found.");
    }

    return {
      number: episode.episodeNumber ? Number(episode.episodeNumber) : null,
      numberWithPrefix: episode.episodeNumberWithPrefix || null,
    };
  }
}

export default new Service();
