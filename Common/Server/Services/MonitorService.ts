import DatabaseConfig from "../DatabaseConfig";
import {
  AllowedActiveMonitorCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import { ActiveMonitoringMeteredPlan } from "../Types/Billing/MeteredPlan/AllMeteredPlans";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorProbeService from "./MonitorProbeService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import ProbeService from "./ProbeService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Typeof from "../../Types/Typeof";
import Model from "../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import Probe, {
  ProbeConnectionStatus,
} from "../../Models/DatabaseModels/Probe";
import User from "../../Models/DatabaseModels/User";
import Select from "../Types/Database/Select";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import Markdown, { MarkdownContentType } from "../Types/Markdown";
import Dictionary from "../../Types/Dictionary";
import { SMSMessage } from "../../Types/SMS/SMS";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import Query from "../Types/Database/Query";
import DeleteBy from "../Types/Database/DeleteBy";
import StatusPageResourceService from "./StatusPageResourceService";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import MonitorWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/Monitor";
import MonitorFeedService from "./MonitorFeedService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import { Gray500, Green500 } from "../../Types/BrandColors";
import LabelService from "./LabelService";
import logger from "../Utils/Logger";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";
import Project from "../../Models/DatabaseModels/Project";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import MetricService from "./MetricService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async refreshMonitorCurrentStatus(monitorId: ObjectID): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: monitorId,
      select: {
        _id: true,
        currentMonitorStatusId: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const lastMonitorStatus: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: monitorId,
          endsAt: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          monitorStatusId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!lastMonitorStatus) {
      return;
    }
    if (!lastMonitorStatus.monitorStatusId) {
      return;
    }

    if (!monitor) {
      return;
    }

    if (
      monitor.currentMonitorStatusId?.toString() !==
      lastMonitorStatus.monitorStatusId.toString()
    ) {
      await this.updateOneById({
        id: monitor.id!,
        data: {
          currentMonitorStatusId: lastMonitorStatus.monitorStatusId,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const monitorsPendingDeletion: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        projectId: true,
      },
      props: deleteBy.props,
    });

    for (const monitor of monitorsPendingDeletion) {
      if (!monitor.id) {
        continue;
      }

      // delete all the status page resources for this monitor.
      await StatusPageResourceService.deleteBy({
        query: {
          monitorId: monitor.id,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = monitor.projectId as
        | ObjectID
        | undefined;

      if (!projectId) {
        continue;
      }

      try {
        await WorkspaceNotificationRuleService.archiveWorkspaceChannels({
          projectId: projectId,
          notificationFor: {
            monitorId: monitor.id,
          },
          sendMessageBeforeArchiving: {
            _type: "WorkspacePayloadMarkdown",
            text: `🗑️ This monitor is deleted. The channel is being archived.`,
          },
        });
      } catch (error) {
        logger.error(
          `Error while archiving workspace channels for monitor ${monitor.id?.toString()}: ${error}`,
        );
      }
    }

    return {
      deleteBy,
      carryForward: {
        monitors: monitorsPendingDeletion,
      },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.deleteBy.props.tenantId && IsBillingEnabled) {
      await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
        onDelete.deleteBy.props.tenantId,
      );
    }

    if (onDelete.carryForward && onDelete.carryForward.monitors) {
      for (const monitor of onDelete.carryForward
        .monitors as Array<Model>) {
        if (!monitor.projectId || !monitor.id) {
          continue;
        }

        await MetricService.deleteBy({
          query: {
            projectId: monitor.projectId,
            serviceId: monitor.id,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.currentMonitorStatusId &&
      onUpdate.updateBy.props.tenantId
    ) {
      await this.changeMonitorStatus(
        onUpdate.updateBy.props.tenantId as ObjectID,
        updatedItemIds as Array<ObjectID>,
        onUpdate.updateBy.data.currentMonitorStatusId as ObjectID,
        true, // notifyOwners = true
        "This status was changed when the monitor was updated.",
        undefined,
        {
          isRoot: true,
        },
      );
    }

    if (updatedItemIds.length > 0) {
      for (const monitorId of updatedItemIds) {
        const monitor: Model | null = await this.findOneById({
          id: monitorId,
          select: {
            projectId: true,
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

        const projectId: ObjectID = monitor!.projectId!;
        const monitorName: string = monitor!.name!;

        let shouldAddMonitorFeed: boolean = false;
        let feedInfoInMarkdown: string = `Monitor **[${monitorName}](${(await this.getMonitorLinkInDashboard(projectId!, monitorId!)).toString()}) was updated.**`;

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        if (onUpdate.updateBy.data.monitoringInterval) {
          await MonitorProbeService.updateNextPingAtForMonitor({
            monitorId: monitorId,
          });
        }

        if (onUpdate.updateBy.data.name) {
          // add monitor feed.

          feedInfoInMarkdown += `\n\n**Name**: 
    ${onUpdate.updateBy.data.name || "No name provided."}
    `;
          shouldAddMonitorFeed = true;
        }

        if (onUpdate.updateBy.data.description) {
          // add monitor feed.

          feedInfoInMarkdown += `\n\n**Monitor Description**: 
              ${onUpdate.updateBy.data.description || "No description provided."}
              `;
          shouldAddMonitorFeed = true;
        }

        if (
          onUpdate.updateBy.data.labels &&
          onUpdate.updateBy.data.labels.length > 0 &&
          Array.isArray(onUpdate.updateBy.data.labels)
        ) {
          const labelIds: Array<ObjectID> = (
            onUpdate.updateBy.data.labels as any
          )
            .map((label: Label) => {
              if (label._id) {
                return new ObjectID(label._id?.toString());
              }

              return null;
            })
            .filter((labelId: ObjectID | null) => {
              return labelId !== null;
            });

          const labels: Array<Label> = await LabelService.findBy({
            query: {
              _id: QueryHelper.any(labelIds),
            },
            select: {
              name: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          if (labels.length > 0) {
            feedInfoInMarkdown += `\n\n**🏷️ Labels**:
    
    ${labels
      .map((label: Label) => {
        return `- ${label.name}`;
      })
      .join("\n")}
    `;

            shouldAddMonitorFeed = true;
          }
        }

        if (shouldAddMonitorFeed) {
          await MonitorFeedService.createMonitorFeedItem({
            monitorId: monitorId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
            displayColor: Gray500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: createdByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          });
        }
      }
    }

    return onUpdate;
  }

  public getEnabledMonitorQuery(): Query<Model> {
    return {
      disableActiveMonitoring: false, // do not fetch if disabled is true.
      disableActiveMonitoringBecauseOfManualIncident: false,
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.monitorType) {
      throw new BadDataException("Monitor type required to create monitor.");
    }

    if (!Object.values(MonitorType).includes(createBy.data.monitorType)) {
      throw new BadDataException(
        `Invalid monitor type "${
          createBy.data.monitorType
        }". Valid monitor types are ${Object.values(MonitorType).join(", ")}.`,
      );
    }

    if (IsBillingEnabled && createBy.props.tenantId) {
      const currentPlan: CurrentPlan = await ProjectService.getCurrentPlan(
        createBy.props.tenantId,
      );

      if (currentPlan.isSubscriptionUnpaid) {
        throw new BadDataException(
          "Your subscription is unpaid. Please update your payment method and pay all the outstanding invoices to add more monitors.",
        );
      }

      if (
        currentPlan.plan === PlanType.Free &&
        createBy.data.monitorType !== MonitorType.Manual
      ) {
        const monitorCount: PositiveNumber = await this.countBy({
          query: {
            projectId: createBy.props.tenantId,
            monitorType: QueryHelper.any(
              MonitorTypeHelper.getActiveMonitorTypes(),
            ),
          },
          props: {
            isRoot: true,
          },
        });

        if (monitorCount.toNumber() >= AllowedActiveMonitorCountInFreePlan) {
          throw new BadDataException(
            `You have reached the maximum allowed monitor limit for the free plan. Please upgrade your plan to add more monitors.`,
          );
        }
      }
    }

    if (createBy.data.monitorType === MonitorType.Server) {
      createBy.data.serverMonitorSecretKey = ObjectID.generate();
    }

    if (createBy.data.monitorType === MonitorType.IncomingRequest) {
      createBy.data.incomingRequestSecretKey = ObjectID.generate();
    }

    if (!createBy.props.tenantId) {
      throw new BadDataException("ProjectId required to create monitor.");
    }

    const monitorStatus: MonitorStatus | null =
      await MonitorStatusService.findOneBy({
        query: {
          projectId: createBy.props.tenantId,
          isOperationalState: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!monitorStatus || !monitorStatus.id) {
      throw new BadDataException(
        "Operational status not found for this project. Please add an operational status",
      );
    }

    createBy.data.currentMonitorStatusId = monitorStatus.id;

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    if (!createdItem.currentMonitorStatusId) {
      throw new BadDataException("currentMonitorStatusId is required");
    }

    const monitor: Model | null = await this.findOneById({
      id: createdItem.id,
      select: {
        projectId: true,
        name: true,
        description: true,
        monitorType: true,
        currentMonitorStatus: {
          name: true,
        },
        labels: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    const createdByUserId: ObjectID | undefined | null =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    let feedInfoInMarkdown: string = `#### 🌎 Monitor Created: 
          
**${createdItem.name?.trim() || "No name provided."}**:

${createdItem.description?.trim() || "No description provided."}
    
`;

    if (monitor?.currentMonitorStatus?.name) {
      feedInfoInMarkdown += `➡️ **Monitor Status**: ${monitor.currentMonitorStatus.name} \n\n`;
    }

    if (monitor?.monitorType) {
      feedInfoInMarkdown += `⚙️ **Monitor Type**: ${monitor.monitorType} \n\n`;
    }

    if (monitor?.labels && monitor.labels.length > 0) {
      feedInfoInMarkdown += `🏷️ **Labels**:\n`;

      for (const label of monitor.labels) {
        feedInfoInMarkdown += `- ${label.name}\n`;
      }

      feedInfoInMarkdown += `\n\n`;
    }

    // Execute operations sequentially with error handling (workspace first)
    Promise.resolve()
      .then(async () => {
        try {
          return await this.handleWorkspaceOperationsAsync({
            projectId: createdItem.projectId!,
            monitorId: createdItem.id!,
            monitorName: createdItem.name!,
            feedInfoInMarkdown,
            createdByUserId,
          });
        } catch (error) {
          logger.error(
            "Workspace operations failed in MonitorService.onCreateSuccess",
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.changeMonitorStatus(
            createdItem.projectId!,
            [createdItem.id!],
            createdItem.currentMonitorStatusId!,
            false, // notifyOwners = false
            "This status was created when the monitor was created.",
            undefined,
            onCreate.createBy.props,
          );
        } catch (error) {
          logger.error(
            "Change monitor status failed in MonitorService.onCreateSuccess",
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (
            createdItem.monitorType &&
            MonitorTypeHelper.isProbableMonitor(createdItem.monitorType)
          ) {
            return await this.addDefaultProbesToMonitor(
              createdItem.projectId!,
              createdItem.id!,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            "Add default probes failed in MonitorService.onCreateSuccess",
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (IsBillingEnabled) {
            return await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
              createdItem.projectId!,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            "Billing operations failed in MonitorService.onCreateSuccess",
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (
            onCreate.createBy.miscDataProps &&
            (onCreate.createBy.miscDataProps["ownerTeams"] ||
              onCreate.createBy.miscDataProps["ownerUsers"])
          ) {
            return await this.addOwners(
              createdItem.projectId!,
              createdItem.id!,
              (onCreate.createBy.miscDataProps[
                "ownerUsers"
              ] as Array<ObjectID>) || [],
              (onCreate.createBy.miscDataProps[
                "ownerTeams"
              ] as Array<ObjectID>) || [],
              false,
              onCreate.createBy.props,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error("Add owners failed in MonitorService.onCreateSuccess");
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.refreshMonitorProbeStatus(createdItem.id!);
        } catch (error) {
          logger.error(
            "Refresh probe status failed in MonitorService.onCreateSuccess",
          );
          logger.error(error as Error);
          return Promise.resolve();
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in MonitorService sequential operations: ${error}`,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleWorkspaceOperationsAsync(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    monitorName: string;
    feedInfoInMarkdown: string;
    createdByUserId: ObjectID | undefined | null;
  }): Promise<void> {
    // send message to workspaces - slack, teams, etc.
    const workspaceResult: {
      channelsCreated: Array<NotificationRuleWorkspaceChannel>;
    } | null =
      await MonitorWorkspaceMessages.createChannelsAndInviteUsersToChannels({
        projectId: data.projectId,
        monitorId: data.monitorId,
        monitorName: data.monitorName,
      });

    if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
      // update monitor with these channels.
      await this.updateOneById({
        id: data.monitorId,
        data: {
          postUpdatesToWorkspaceChannels: workspaceResult.channelsCreated || [],
        },
        props: {
          isRoot: true,
        },
      });
    }

    const monitorCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
      await MonitorWorkspaceMessages.getMonitorCreateMessageBlocks({
        monitorId: data.monitorId,
        projectId: data.projectId,
      });

    await MonitorFeedService.createMonitorFeedItem({
      monitorId: data.monitorId,
      projectId: data.projectId,
      monitorFeedEventType: MonitorFeedEventType.MonitorCreated,
      displayColor: Green500,
      feedInfoInMarkdown: data.feedInfoInMarkdown,
      userId: data.createdByUserId || undefined,
      workspaceNotification: {
        appendMessageBlocks: monitorCreateMessageBlocks,
        sendWorkspaceNotification: true,
      },
    });
  }

  @CaptureSpan()
  public async getMonitorLinkInDashboard(
    projectId: ObjectID,
    monitorId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/monitors/${monitorId.toString()}`,
    );
  }

  @CaptureSpan()
  public async findOwners(monitorId: ObjectID): Promise<Array<User>> {
    if (!monitorId) {
      throw new BadDataException("monitorId is required");
    }

    const ownerUsers: Array<MonitorOwnerUser> =
      await MonitorOwnerUserService.findBy({
        query: {
          monitorId: monitorId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          } as Select<User>,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<MonitorOwnerTeam> =
      await MonitorOwnerTeamService.findBy({
        query: {
          monitorId: monitorId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: MonitorOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: MonitorOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  @CaptureSpan()
  public async addOwners(
    projectId: ObjectID,
    monitorId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: MonitorOwnerTeam = new MonitorOwnerTeam();
      teamOwner.monitorId = monitorId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await MonitorOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: MonitorOwnerUser = new MonitorOwnerUser();
      teamOwner.monitorId = monitorId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      teamOwner.isOwnerNotified = !notifyOwners;
      await MonitorOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }

  @CaptureSpan()
  public async addDefaultProbesToMonitor(
    projectId: ObjectID,
    monitorId: ObjectID,
  ): Promise<void> {
    // Fetch project to see if global probes should be added automatically.
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        _id: true,
        doNotAddGlobalProbesByDefaultOnNewMonitors: true,
      },
      props: {
        isRoot: true,
      },
    });

    const shouldSkipGlobalProbes: boolean =
      project?.doNotAddGlobalProbesByDefaultOnNewMonitors === true;

    let globalProbes: Array<Probe> = [];

    if (!shouldSkipGlobalProbes) {
      globalProbes = await ProbeService.findBy({
        query: {
          isGlobalProbe: true,
          shouldAutoEnableProbeOnNewMonitors: true,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    const projectProbes: Array<Probe> = await ProbeService.findBy({
      query: {
        isGlobalProbe: false,
        shouldAutoEnableProbeOnNewMonitors: true,
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const totalProbes: Array<Probe> = [...globalProbes, ...projectProbes];

    if (totalProbes.length === 0) {
      return;
    }

    // Create all monitor probes in parallel for better performance
    const createPromises: Array<Promise<MonitorProbe>> = [];

    for (const probe of totalProbes) {
      const monitorProbe: MonitorProbe = new MonitorProbe();
      monitorProbe.monitorId = monitorId;
      monitorProbe.probeId = probe.id!;
      monitorProbe.projectId = projectId;
      monitorProbe.isEnabled = true;

      createPromises.push(
        MonitorProbeService.create({
          data: monitorProbe,
          props: {
            isRoot: true,
          },
        }),
      );
    }

    // Execute all creates in parallel
    await Promise.all(createPromises);
  }

  @CaptureSpan()
  public async refreshMonitorProbeStatus(monitorId: ObjectID): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: monitorId,
      select: {
        _id: true,
        monitorType: true,
        isAllProbesDisconnectedFromThisMonitor: true,
        isNoProbeEnabledOnThisMonitor: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      return;
    }

    if (!monitor.id) {
      return;
    }

    const monitorType: MonitorType | undefined = monitor?.monitorType;

    if (!monitorType) {
      return;
    }

    const isProbeableMonitor: boolean =
      MonitorTypeHelper.isProbableMonitor(monitorType);

    if (!isProbeableMonitor) {
      return;
    }

    // get all the probes for this monitor.

    const probesForMonitor: Array<MonitorProbe> =
      await MonitorProbeService.findBy({
        query: {
          monitorId: monitorId,
        },
        select: {
          _id: true,
          isEnabled: true,
          projectId: true,
          monitorId: true,
          probeId: true,
          probe: {
            connectionStatus: true,
            isGlobalProbe: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const enabledProbes: Array<MonitorProbe> = probesForMonitor.filter(
      (probe: MonitorProbe) => {
        return probe.isEnabled;
      },
    );

    if (probesForMonitor.length === 0 || enabledProbes.length === 0) {
      if (!monitor.isNoProbeEnabledOnThisMonitor) {
        // no probes for this monitor.
        await this.updateOneById({
          id: monitorId,
          data: {
            isNoProbeEnabledOnThisMonitor: true,
          },
          props: {
            isRoot: true,
          },
        });

        // notify owners that no probe is enabled.

        await this.notifyOwnersWhenNoProbeIsEnabled({
          monitorId: monitorId,
          isNoProbesEnabled: true,
        });
      }
    } else if (monitor.isNoProbeEnabledOnThisMonitor) {
      await this.updateOneById({
        id: monitorId,
        data: {
          isNoProbeEnabledOnThisMonitor: false,
        },
        props: {
          isRoot: true,
        },
      });

      // notify owners that probes are now enabled.

      await this.notifyOwnersWhenNoProbeIsEnabled({
        monitorId: monitorId,
        isNoProbesEnabled: false,
      });
    }

    const disconnectedProbes: Array<MonitorProbe> = probesForMonitor.filter(
      (monitorProbe: MonitorProbe) => {
        return (
          monitorProbe.probe?.connectionStatus ===
            ProbeConnectionStatus.Disconnected && monitorProbe.isEnabled
        );
      },
    );

    if (IsBillingEnabled) {
      // check if these probes are global probes.
      const anyGlobalProbe: boolean = enabledProbes.some(
        (monitorProbe: MonitorProbe) => {
          return monitorProbe.probe?.isGlobalProbe === true;
        },
      );

      if (anyGlobalProbe) {
        // do not notify if any global probe is disconnected.
        return;
      }
    }

    if (
      disconnectedProbes.length === enabledProbes.length &&
      enabledProbes.length > 0
    ) {
      if (!monitor.isAllProbesDisconnectedFromThisMonitor) {
        // all probes are disconnected.
        await this.updateOneById({
          id: monitorId,
          data: {
            isAllProbesDisconnectedFromThisMonitor: true,
          },
          props: {
            isRoot: true,
          },
        });

        await this.notifyOwnersProbesDisconnected({
          monitorId: monitorId,
          isProbeDisconnected: true,
        });
      }
    } else if (monitor.isAllProbesDisconnectedFromThisMonitor) {
      await this.updateOneById({
        id: monitorId,
        data: {
          isAllProbesDisconnectedFromThisMonitor: false,
        },
        props: {
          isRoot: true,
        },
      });

      await this.notifyOwnersProbesDisconnected({
        monitorId: monitorId,
        isProbeDisconnected: false,
      });
    }
  }

  @CaptureSpan()
  public async getLabelsForMonitors(data: {
    monitorIds: Array<ObjectID>;
  }): Promise<Array<Label>> {
    if (data.monitorIds.length === 0) {
      return [];
    }

    const monitors: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(data.monitorIds),
      },
      select: {
        _id: true,
        name: true,
        labels: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    const labels: Array<Label> = [];

    for (const monitor of monitors) {
      if (monitor.labels) {
        for (const label of monitor.labels) {
          const isLabelAlreadyAdded: boolean = labels.some((l: Label) => {
            return l.id!.toString() === label.id!.toString();
          });

          if (!isLabelAlreadyAdded) {
            labels.push(label);
          }
        }
      }
    }

    return labels;
  }

  @CaptureSpan()
  public async notifyOwnersWhenNoProbeIsEnabled(data: {
    monitorId: ObjectID;
    isNoProbesEnabled: boolean;
  }): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        project: {
          name: true,
        },
        description: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      return;
    }

    if (!monitor.id) {
      return;
    }

    let doesResourceHasOwners: boolean = true;

    let owners: Array<User> = await this.findOwners(monitor.id!);

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(monitor.projectId!);
    }

    if (owners.length === 0) {
      return;
    }

    const title: string = data.isNoProbesEnabled
      ? "No Probes Enabled. This monitor is not being monitored"
      : "Probes Enabled. This monitor is now being monitored.";

    const enabledStatus: string = data.isNoProbesEnabled
      ? "Disabled"
      : "Enabled";

    const vars: Dictionary<string> = {
      title: title,
      monitorName: monitor.name!,
      currentStatus: enabledStatus,
      projectName: monitor.project!.name!,
      monitorDescription: await Markdown.convertToHTML(
        monitor.description! || "",
        MarkdownContentType.Email,
      ),
      monitorViewLink: (
        await this.getMonitorLinkInDashboard(monitor.projectId!, monitor.id!)
      ).toString(),
    };

    if (doesResourceHasOwners === true) {
      vars["isOwner"] = "true";
    }

    for (const owner of owners) {
      // send email to the owner.

      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.MonitorProbesStatus,
        vars: vars,
        subject: `[Monitor Probes ${enabledStatus}] ${monitor.name!}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. Probes for monitor ${monitor.name} is ${enabledStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. Probes for monitor ${monitor.name} is ${enabledStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      };

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            monitor_name: monitor.name!,
            probe_status: enabledStatus,
            monitor_link: vars["monitorViewLink"] || "",
          },
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: owner.id!,
        projectId: monitor.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage:
          PushNotificationUtil.createMonitorProbeStatusNotification({
            title: "OneUptime: Monitor Probe Status",
            body: `Probes for monitor ${monitor.name} is ${enabledStatus}`,
            tag: "monitor-probe-status",
            monitorId: monitor.id!.toString(),
            monitorName: monitor.name!,
          }),
        whatsAppMessage,
        eventType,
      });
    }
  }

  @CaptureSpan()
  public async notifyOwnersProbesDisconnected(data: {
    monitorId: ObjectID;
    isProbeDisconnected: boolean;
  }): Promise<void> {
    const monitor: Model | null = await this.findOneById({
      id: data.monitorId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        project: {
          name: true,
        },
        description: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      return;
    }

    if (!monitor.id) {
      return;
    }

    let doesResourceHasOwners: boolean = true;

    let owners: Array<User> = await this.findOwners(monitor.id!);

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(monitor.projectId!);
    }

    if (owners.length === 0) {
      return;
    }

    const status: string = data.isProbeDisconnected
      ? "Disconnected"
      : "Connected";

    const vars: Dictionary<string> = {
      title: `Probes for monitor ${monitor.name} is ${status}.`,
      monitorName: monitor.name!,
      currentStatus: status,
      projectName: monitor.project!.name!,
      monitorDescription: await Markdown.convertToHTML(
        monitor.description! || "",
        MarkdownContentType.Email,
      ),
      monitorViewLink: (
        await this.getMonitorLinkInDashboard(monitor.projectId!, monitor.id!)
      ).toString(),
    };

    if (doesResourceHasOwners === true) {
      vars["isOwner"] = "true";
    }

    for (const owner of owners) {
      // send email to the owner.

      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.MonitorProbesStatus,
        vars: vars,
        subject: `[Monitor Probes ${status}] ${monitor.name!}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. Probes for monitor ${monitor.name} is ${status}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. New monitor was created ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      };

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            monitor_name: monitor.name!,
            probe_status: status,
            monitor_link: vars["monitorViewLink"] || "",
          },
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: owner.id!,
        projectId: monitor.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage:
          PushNotificationUtil.createMonitorCreatedNotification({
            monitorName: monitor.name!,
            monitorId: monitor.id!.toString(),
          }),
        whatsAppMessage,
        eventType,
      });
    }
  }

  @CaptureSpan()
  public async refreshProbeStatus(probeId: ObjectID): Promise<void> {
    // get all the monitors for this probe.

    const monitorProbes: Array<MonitorProbe> = await MonitorProbeService.findBy(
      {
        query: {
          probeId: probeId,
        },
        select: {
          _id: true,
          isEnabled: true,
          projectId: true,
          monitorId: true,
          monitor: {
            monitorType: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      },
    );

    if (monitorProbes.length === 0) {
      return;
    }

    for (const monitorProbe of monitorProbes) {
      await this.refreshMonitorProbeStatus(monitorProbe.monitorId!);
    }
  }

  @CaptureSpan()
  public async changeMonitorStatus(
    projectId: ObjectID,
    monitorIds: Array<ObjectID>,
    monitorStatusId: ObjectID,
    notifyOwners: boolean,
    rootCause: string | undefined,
    statusChangeLog: JSONObject | undefined,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (const monitorId of monitorIds) {
      // get last monitor status timeline.
      const lastMonitorStatusTimeline: MonitorStatusTimeline | null =
        await MonitorStatusTimelineService.findOneBy({
          query: {
            monitorId: monitorId,
            projectId: projectId,
          },
          select: {
            _id: true,
            monitorStatusId: true,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
        });

      if (
        lastMonitorStatusTimeline &&
        lastMonitorStatusTimeline.monitorStatusId &&
        lastMonitorStatusTimeline.monitorStatusId.toString() ===
          monitorStatusId.toString()
      ) {
        // status is same as last status. do not create new status timeline.
        continue;
      }

      const statusTimeline: MonitorStatusTimeline = new MonitorStatusTimeline();

      statusTimeline.monitorId = monitorId;
      statusTimeline.monitorStatusId = monitorStatusId;
      statusTimeline.projectId = projectId;
      statusTimeline.isOwnerNotified = !notifyOwners;

      if (statusChangeLog) {
        statusTimeline.statusChangeLog = statusChangeLog;
      }
      if (rootCause) {
        statusTimeline.rootCause = rootCause;
      }

      await MonitorStatusTimelineService.create({
        data: statusTimeline,
        props: props,
      });
    }
  }

  @CaptureSpan()
  public async getWorkspaceChannelForMonitor(data: {
    monitorId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const monitor: Model | null = await this.findOneById({
      id: data.monitorId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      throw new BadDataException(ExceptionMessages.MonitorNotFound);
    }

    return (monitor.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  // get monitor name
  @CaptureSpan()
  public async getMonitorName(data: { monitorId: ObjectID }): Promise<string> {
    const { monitorId } = data;

    const monitor: Model | null = await this.findOneById({
      id: monitorId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!monitor) {
      throw new BadDataException(ExceptionMessages.MonitorNotFound);
    }

    return monitor.name || "";
  }
}
export default new Service();
