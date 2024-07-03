import DatabaseConfig from "../DatabaseConfig";
import {
  AllowedActiveMonitorCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import { ActiveMonitoringMeteredPlan } from "../Types/Billing/MeteredPlan/AllMeteredPlans";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorProbeService from "./MonitorProbeService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import ProbeService from "./ProbeService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import URL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Typeof from "Common/Types/Typeof";
import Model from "Model/Models/Monitor";
import MonitorOwnerTeam from "Model/Models/MonitorOwnerTeam";
import MonitorOwnerUser from "Model/Models/MonitorOwnerUser";
import MonitorProbe from "Model/Models/MonitorProbe";
import MonitorStatus from "Model/Models/MonitorStatus";
import MonitorStatusTimeline from "Model/Models/MonitorStatusTimeline";
import Probe, { ProbeConnectionStatus } from "Model/Models/Probe";
import User from "Model/Models/User";
import Select from "../Types/Database/Select";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import Markdown, { MarkdownContentType } from "../Types/Markdown";
import Dictionary from "Common/Types/Dictionary";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";

export class Service extends DatabaseService<Model> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(Model, postgresDatabase);
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.deleteBy.props.tenantId && IsBillingEnabled) {
      await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
        onDelete.deleteBy.props.tenantId,
      );
    }

    return onDelete;
  }

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

    return onUpdate;
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.disableActiveMonitoring !== undefined) {
      const items: Array<Model> = await this.findBy({
        query: updateBy.query,
        props: updateBy.props,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: {
          monitorType: true,
        },
      });

      // check if the monitor type is not manual.

      for (const item of items) {
        if (item.monitorType && item.monitorType === MonitorType.Manual) {
          if (updateBy.data.disableActiveMonitoring === true) {
            throw new BadDataException(
              "You can only disable monitoring for active monitors. Disabling monitoring for manual monitors is not allowed.",
            );
          } else {
            throw new BadDataException(
              "You can only enable monitoring for active monitors. Enabling monitoring for manual monitors is not allowed.",
            );
          }
        }
      }
    }

    return { updateBy, carryForward: null };
  }

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

    await this.changeMonitorStatus(
      createdItem.projectId,
      [createdItem.id],
      createdItem.currentMonitorStatusId,
      false, // notifyOwners = false
      "This status was created when the monitor was created.",
      undefined,
      onCreate.createBy.props,
    );

    if (
      createdItem.monitorType &&
      MonitorTypeHelper.isProbableMonitor(createdItem.monitorType)
    ) {
      await this.addDefaultProbesToMonitor(
        createdItem.projectId,
        createdItem.id,
      );
    }

    if (IsBillingEnabled) {
      await ActiveMonitoringMeteredPlan.reportQuantityToBillingProvider(
        createdItem.projectId,
      );
    }

    // add owners.

    if (
      onCreate.createBy.miscDataProps &&
      (onCreate.createBy.miscDataProps["ownerTeams"] ||
        onCreate.createBy.miscDataProps["ownerUsers"])
    ) {
      await this.addOwners(
        createdItem.projectId,
        createdItem.id,
        (onCreate.createBy.miscDataProps["ownerUsers"] as Array<ObjectID>) ||
          [],
        (onCreate.createBy.miscDataProps["ownerTeams"] as Array<ObjectID>) ||
          [],
        false,
        onCreate.createBy.props,
      );
    }

    // refresh probe status.
    await this.refreshMonitorProbeStatus(createdItem.id);

    return createdItem;
  }

  public async getMonitorLinkInDashboard(
    projectId: ObjectID,
    monitorId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/monitors/${monitorId.toString()}`,
    );
  }

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

  public async addDefaultProbesToMonitor(
    projectId: ObjectID,
    monitorId: ObjectID,
  ): Promise<void> {
    const globalProbes: Array<Probe> = await ProbeService.findBy({
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

    for (const probe of totalProbes) {
      const monitorProbe: MonitorProbe = new MonitorProbe();

      monitorProbe.monitorId = monitorId;
      monitorProbe.probeId = probe.id!;
      monitorProbe.projectId = projectId;
      monitorProbe.isEnabled = true;

      await MonitorProbeService.create({
        data: monitorProbe,
        props: {
          isRoot: true,
        },
      });
    }
  }

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

      await UserNotificationSettingService.sendUserNotification({
        userId: owner.id!,
        projectId: monitor.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        eventType:
          NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR,
      });
    }
  }

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

      await UserNotificationSettingService.sendUserNotification({
        userId: owner.id!,
        projectId: monitor.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        eventType:
          NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
      });
    }
  }

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
            createdAt: SortOrder.Descending,
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
}
export default new Service();
