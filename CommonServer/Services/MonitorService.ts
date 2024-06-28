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
import Probe from "Model/Models/Probe";
import User from "Model/Models/User";
import Select from "../Types/Database/Select";

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
      MonitorTypeHelper.isProbableMonitors(createdItem.monitorType)
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
