import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import IncidentOwnerTeamService from "./IncidentOwnerTeamService";
import IncidentOwnerUserService from "./IncidentOwnerUserService";
import IncidentStateService from "./IncidentStateService";
import IncidentStateTimelineService from "./IncidentStateTimelineService";
import MonitorService from "./MonitorService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import TeamMemberService from "./TeamMemberService";
import UserService from "./UserService";
import URL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Typeof from "Common/Types/Typeof";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import Model from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import User from "Common/Models/DatabaseModels/User";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    this.hardDeleteItemsOlderThanInDays("createdAt", 120);
  }

  public async acknowledgeIncident(
    incidentId: ObjectID,
    acknowledgedByUserId: ObjectID,
  ): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident || !incident.projectId) {
      throw new BadDataException("Incident not found.");
    }

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: incident.projectId,
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
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const incidentStateTimeline: IncidentStateTimeline =
      new IncidentStateTimeline();
    incidentStateTimeline.projectId = incident.projectId;
    incidentStateTimeline.incidentId = incidentId;
    incidentStateTimeline.incidentStateId = incidentState.id;
    incidentStateTimeline.createdByUserId = acknowledgedByUserId;

    await IncidentStateTimelineService.create({
      data: incidentStateTimeline,
      props: {
        isRoot: true,
      },
    });
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException("ProjectId required to create incident.");
    }

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: createBy.props.tenantId || createBy.data.projectId!,
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

    if (
      (createBy.data.createdByUserId ||
        createBy.data.createdByUser ||
        createBy.props.userId) &&
      !createBy.data.rootCause
    ) {
      let userId: ObjectID | undefined = createBy.data.createdByUserId;

      if (createBy.props.userId) {
        userId = createBy.props.userId;
      }

      if (createBy.data.createdByUser && createBy.data.createdByUser.id) {
        userId = createBy.data.createdByUser.id;
      }

      const user: User | null = await UserService.findOneBy({
        query: {
          _id: userId?.toString() as string,
        },
        select: {
          _id: true,
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (user) {
        createBy.data.rootCause = `Incident created by ${user.name} (${user.email})`;
      }
    }

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

    if (!createdItem.currentIncidentStateId) {
      throw new BadDataException("currentIncidentStateId is required");
    }

    if (createdItem.changeMonitorStatusToId && createdItem.projectId) {
      // change status of all the monitors.
      await MonitorService.changeMonitorStatus(
        createdItem.projectId,
        createdItem.monitors?.map((monitor: Monitor) => {
          return new ObjectID(monitor._id || "");
        }) || [],
        createdItem.changeMonitorStatusToId,
        true, // notifyMonitorOwners
        createdItem.rootCause ||
          "Status was changed because incident " +
            createdItem.id.toString() +
            " was created.",
        createdItem.createdStateLog,
        onCreate.createBy.props,
      );
    }

    await this.changeIncidentState({
      projectId: createdItem.projectId,
      incidentId: createdItem.id,
      incidentStateId: createdItem.currentIncidentStateId,
      shouldNotifyStatusPageSubscribers: Boolean(
        createdItem.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ),
      isSubscribersNotified: Boolean(
        createdItem.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ), // we dont want to notify subscribers when incident state changes because they are already notified when the incident is created.
      notifyOwners: false,
      rootCause: createdItem.rootCause,
      stateChangeLog: createdItem.createdStateLog,
      props: {
        isRoot: true,
      },
    });

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

    if (
      createdItem.onCallDutyPolicies?.length &&
      createdItem.onCallDutyPolicies?.length > 0
    ) {
      for (const policy of createdItem.onCallDutyPolicies) {
        await OnCallDutyPolicyService.executePolicy(
          new ObjectID(policy._id as string),
          {
            triggeredByIncidentId: createdItem.id!,
            userNotificationEventType:
              UserNotificationEventType.IncidentCreated,
          },
        );
      }
    }

    // check if the incident is created manaull by a user and if thats the case, then disable active monitoting on that monitor.

    if (!createdItem.isCreatedAutomatically) {
      const monitors: Array<Monitor> = createdItem.monitors || [];

      for (const monitor of monitors) {
        await MonitorService.updateOneById({
          id: monitor.id!,
          data: {
            disableActiveMonitoringBecauseOfManualIncident: true,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    return createdItem;
  }

  public async getIncidentIdentifiedDate(incidentId: ObjectID): Promise<Date> {
    const timeline: IncidentStateTimeline | null =
      await IncidentStateTimelineService.findOneBy({
        query: {
          incidentId: incidentId,
        },
        select: {
          startsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    if (!timeline || !timeline.startsAt) {
      throw new BadDataException("Incident identified date not found.");
    }

    return timeline.startsAt;
  }

  public async findOwners(incidentId: ObjectID): Promise<Array<User>> {
    if (!incidentId) {
      throw new BadDataException("incidentId is required");
    }

    const ownerUsers: Array<IncidentOwnerUser> =
      await IncidentOwnerUserService.findBy({
        query: {
          incidentId: incidentId,
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

    const ownerTeams: Array<IncidentOwnerTeam> =
      await IncidentOwnerTeamService.findBy({
        query: {
          incidentId: incidentId,
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
      ownerUsers.map((ownerUser: IncidentOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: IncidentOwnerTeam) => {
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
    incidentId: ObjectID,
    userIds: Array<ObjectID>,
    teamIds: Array<ObjectID>,
    notifyOwners: boolean,
    props: DatabaseCommonInteractionProps,
  ): Promise<void> {
    for (let teamId of teamIds) {
      if (typeof teamId === Typeof.String) {
        teamId = new ObjectID(teamId.toString());
      }

      const teamOwner: IncidentOwnerTeam = new IncidentOwnerTeam();
      teamOwner.incidentId = incidentId;
      teamOwner.projectId = projectId;
      teamOwner.teamId = teamId;
      teamOwner.isOwnerNotified = !notifyOwners;

      await IncidentOwnerTeamService.create({
        data: teamOwner,
        props: props,
      });
    }

    for (let userId of userIds) {
      if (typeof userId === Typeof.String) {
        userId = new ObjectID(userId.toString());
      }
      const teamOwner: IncidentOwnerUser = new IncidentOwnerUser();
      teamOwner.incidentId = incidentId;
      teamOwner.projectId = projectId;
      teamOwner.userId = userId;
      teamOwner.isOwnerNotified = !notifyOwners;
      await IncidentOwnerUserService.create({
        data: teamOwner,
        props: props,
      });
    }
  }

  public async getIncidentLinkInDashboard(
    projectId: ObjectID,
    incidentId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/incidents/${incidentId.toString()}`,
    );
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.updateBy.data.currentIncidentStateId &&
      onUpdate.updateBy.props.tenantId
    ) {
      for (const itemId of updatedItemIds) {
        await this.changeIncidentState({
          projectId: onUpdate.updateBy.props.tenantId as ObjectID,
          incidentId: itemId,
          incidentStateId: onUpdate.updateBy.data
            .currentIncidentStateId as ObjectID,
          notifyOwners: true,
          shouldNotifyStatusPageSubscribers: true,
          isSubscribersNotified: false,
          rootCause: "This status was changed when the incident was updated.",
          stateChangeLog: undefined,
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onUpdate;
  }

  public async doesMonitorHasMoreActiveManualIncidents(
    monitorId: ObjectID,
    proojectId: ObjectID,
  ): Promise<boolean> {
    const resolvedState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: proojectId,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          order: true,
        },
      });

    const incidentCount: PositiveNumber = await this.countBy({
      query: {
        monitors: QueryHelper.inRelationArray([monitorId]),
        currentIncidentState: {
          order: QueryHelper.lessThan(resolvedState?.order as number),
        },
        isCreatedAutomatically: false,
      },
      props: {
        isRoot: true,
      },
    });

    return incidentCount.toNumber() > 0;
  }

  public async markMonitorsActiveForMonitoring(
    projectId: ObjectID,
    monitors: Array<Monitor>,
  ): Promise<void> {
    // resolve all the monitors.

    if (monitors.length > 0) {
      // get resolved monitor state.
      const resolvedMonitorState: MonitorStatus | null =
        await MonitorStatusService.findOneBy({
          query: {
            projectId: projectId!,
            isOperationalState: true,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
          },
        });

      if (resolvedMonitorState) {
        for (const monitor of monitors) {
          //check state of the monitor.

          const doesMonitorHasMoreActiveManualIncidents: boolean =
            await this.doesMonitorHasMoreActiveManualIncidents(
              monitor.id!,
              projectId!,
            );

          if (doesMonitorHasMoreActiveManualIncidents) {
            continue;
          }

          await MonitorService.updateOneById({
            id: monitor.id!,
            data: {
              disableActiveMonitoringBecauseOfManualIncident: false,
            },
            props: {
              isRoot: true,
            },
          });

          const latestState: MonitorStatusTimeline | null =
            await MonitorStatusTimelineService.findOneBy({
              query: {
                monitorId: monitor.id!,
                projectId: projectId!,
              },
              select: {
                _id: true,
                monitorStatusId: true,
              },
              props: {
                isRoot: true,
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
            });

          if (
            latestState &&
            latestState.monitorStatusId?.toString() ===
              resolvedMonitorState.id!.toString()
          ) {
            // already on this state. Skip.
            continue;
          }

          const monitorStatusTimeline: MonitorStatusTimeline =
            new MonitorStatusTimeline();
          monitorStatusTimeline.monitorId = monitor.id!;
          monitorStatusTimeline.projectId = projectId!;
          monitorStatusTimeline.monitorStatusId = resolvedMonitorState.id!;

          await MonitorStatusTimelineService.create({
            data: monitorStatusTimeline,
            props: {
              isRoot: true,
            },
          });
        }
      }
    }
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const incidents: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        projectId: true,
        monitors: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return {
      deleteBy,
      carryForward: {
        incidents: incidents,
      },
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (onDelete.carryForward && onDelete.carryForward.incidents) {
      for (const incident of onDelete.carryForward.incidents) {
        if (incident.monitors && incident.monitors.length > 0) {
          await this.markMonitorsActiveForMonitoring(
            incident.projectId!,
            incident.monitors,
          );
        }
      }
    }

    return onDelete;
  }

  public async changeIncidentState(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentStateId: ObjectID;
    shouldNotifyStatusPageSubscribers: boolean;
    isSubscribersNotified: boolean;
    notifyOwners: boolean;
    rootCause: string | undefined;
    stateChangeLog: JSONObject | undefined;
    props: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    const {
      projectId,
      incidentId,
      incidentStateId,
      shouldNotifyStatusPageSubscribers,
      isSubscribersNotified,
      notifyOwners,
      rootCause,
      stateChangeLog,
      props,
    } = data;

    // get last monitor status timeline.
    const lastIncidentStatusTimeline: IncidentStateTimeline | null =
      await IncidentStateTimelineService.findOneBy({
        query: {
          incidentId: incidentId,
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
      lastIncidentStatusTimeline &&
      lastIncidentStatusTimeline.incidentStateId &&
      lastIncidentStatusTimeline.incidentStateId.toString() ===
        incidentStateId.toString()
    ) {
      return;
    }

    const statusTimeline: IncidentStateTimeline = new IncidentStateTimeline();

    statusTimeline.incidentId = incidentId;
    statusTimeline.incidentStateId = incidentStateId;
    statusTimeline.projectId = projectId;
    statusTimeline.isOwnerNotified = !notifyOwners;
    statusTimeline.shouldStatusPageSubscribersBeNotified =
      shouldNotifyStatusPageSubscribers;

    statusTimeline.isStatusPageSubscribersNotified = isSubscribersNotified;

    if (stateChangeLog) {
      statusTimeline.stateChangeLog = stateChangeLog;
    }
    if (rootCause) {
      statusTimeline.rootCause = rootCause;
    }

    await IncidentStateTimelineService.create({
      data: statusTimeline,
      props: props || {},
    });
  }
}
export default new Service();
