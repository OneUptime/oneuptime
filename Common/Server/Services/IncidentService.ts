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
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Typeof from "../../Types/Typeof";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import Model from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import User from "Common/Models/DatabaseModels/User";
import { IsBillingEnabled } from "../EnvironmentConfig";
import MetricService from "./MetricService";
import IncidentMetricType from "../../Types/Incident/IncidentMetricType";
import Metric, {
  MetricPointType,
  ServiceType,
} from "../../Models/AnalyticsModels/Metric";
import OneUptimeDate from "../../Types/Date";
import TelemetryUtil from "../Utils/Telemetry/Telemetry";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import logger from "../Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "./IncidentSeverityService";

import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../Utils/Workspace/WorkspaceBase";
import IncidentWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/Incident";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async isIncidentAcknowledged(data: {
    incidentId: ObjectID;
  }): Promise<boolean> {
    const incident: Model | null = await this.findOneBy({
      query: {
        _id: data.incidentId,
      },
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

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    if (!incident.projectId) {
      throw new BadDataException("Incient Project ID not found");
    }

    const ackIncidentState: IncidentState =
      await IncidentStateService.getAcknowledgedIncidentState({
        projectId: incident.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentIncidentStateOrder: number =
      incident.currentIncidentState!.order!;
    const ackIncidentStateOrder: number = ackIncidentState.order!;

    if (currentIncidentStateOrder >= ackIncidentStateOrder) {
      return true;
    }

    return false;
  }

  public async resolveIncident(
    incidentId: ObjectID,
    resolvedByUserId: ObjectID,
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
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    const incidentStateTimeline: IncidentStateTimeline =
      new IncidentStateTimeline();
    incidentStateTimeline.projectId = incident.projectId;
    incidentStateTimeline.incidentId = incidentId;
    incidentStateTimeline.incidentStateId = incidentState.id;
    incidentStateTimeline.createdByUserId = resolvedByUserId;

    await IncidentStateTimelineService.create({
      data: incidentStateTimeline,
      props: {
        isRoot: true,
      },
    });

    // store incident metric
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

    // store incident metric
  }

  public async getExistingIncidentNumberForProject(data: {
    projectId: ObjectID;
  }): Promise<number> {
    // get last incident number.
    const lastIncident: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        incidentNumber: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });

    if (!lastIncident) {
      return 0;
    }

    return lastIncident.incidentNumber || 0;
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException("ProjectId required to create incident.");
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

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

    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: projectId.toString(),
        namespace: "IncidentService.incident-create",
        lockTimeout: 15000,
        acquireTimeout: 20000,
      });

      logger.debug(
        "Mutex acquired - IncidentService.incident-create " +
          projectId.toString() +
          " at " +
          OneUptimeDate.getCurrentDateAsFormattedString(),
      );
    } catch (err) {
      logger.debug(
        "Mutex acquire failed - IncidentService.incident-create " +
          projectId.toString() +
          " at " +
          OneUptimeDate.getCurrentDateAsFormattedString(),
      );
      logger.error(err);
    }

    const incidentNumberForThisIncident: number =
      (await this.getExistingIncidentNumberForProject({
        projectId: projectId,
      })) + 1;

    createBy.data.currentIncidentStateId = incidentState.id;
    createBy.data.incidentNumber = incidentNumberForThisIncident;

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

    return {
      createBy,
      carryForward: {
        mutex: mutex,
      },
    };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // these should never be null.
    if (!createdItem.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!createdItem.id) {
      throw new BadDataException("id is required");
    }

    // release the mutex.
    if (onCreate.carryForward && onCreate.carryForward.mutex) {
      const mutex: SemaphoreMutex = onCreate.carryForward.mutex;
      const projectId: ObjectID = createdItem.projectId!;

      try {
        await Semaphore.release(mutex);
        logger.debug(
          "Mutex released - IncidentService.incident-create " +
            projectId.toString() +
            " at " +
            OneUptimeDate.getCurrentDateAsFormattedString(),
        );
      } catch (err) {
        logger.debug(
          "Mutex release failed -  IncidentService.incident-create " +
            projectId.toString() +
            " at " +
            OneUptimeDate.getCurrentDateAsFormattedString(),
        );
        logger.error(err);
      }
    }

    const createdByUserId: ObjectID | undefined | null =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    await IncidentFeedService.createIncidentFeed({
      incidentId: createdItem.id!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
      displayColor: Red500,
      feedInfoInMarkdown: `**Incident #${createdItem.incidentNumber?.toString()} Created**: 
      
**Incident Title**:

${createdItem.title || "No title provided."}

**Description**:

${createdItem.description || "No description provided."}

      `,
      userId: createdByUserId || undefined,
    });

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

    await IncidentFeedService.createIncidentFeed({
      incidentId: createdItem.id!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.RootCause,
      displayColor: Red500,
      feedInfoInMarkdown: `**Root Cause**

${createdItem.rootCause || "No root cause provided."}`,
    });

    await IncidentFeedService.createIncidentFeed({
      incidentId: createdItem.id!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.RemediationNotes,
      displayColor: Red500,
      feedInfoInMarkdown: `**Remediation Notes**

${createdItem.remediationNotes || "No remediation notes provided."}`,
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

    // send message to workspaces - slack, teams,   etc.
    const workspaceResult: {
      channelsCreated: Array<WorkspaceChannel>;
      workspaceSendMessageResponse: WorkspaceSendMessageResponse;
    } | null = await IncidentWorkspaceMessages.notifyWorkspaceOnIncidentCreate({
      projectId: createdItem.projectId,
      incidentId: createdItem.id!,
      incidentNumber: createdItem.incidentNumber!,
    });

    if (
      workspaceResult &&
      (workspaceResult.channelsCreated?.length > 0 ||
        workspaceResult?.workspaceSendMessageResponse?.threads?.length > 0)
    ) {
      // update incident with these channels.
      await this.updateOneById({
        id: createdItem.id!,
        data: {
          postUpdatesToWorkspaceChannels: workspaceResult.channelsCreated || [],
          workspaceSendMessageResponse:
            workspaceResult.workspaceSendMessageResponse,
        },
        props: {
          isRoot: true,
        },
      });
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

    if (updatedItemIds.length > 0) {
      for (const incidentId of updatedItemIds) {
        let shouldAddIncidentFeed: boolean = false;
        let feedInfoInMarkdown: string = "**Incident was updated.**";

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        if (onUpdate.updateBy.data.title) {
          // add incident feed.

          feedInfoInMarkdown += `\n\n**Title**: 
${onUpdate.updateBy.data.title || "No title provided."}
`;
          shouldAddIncidentFeed = true;
        }

        if (onUpdate.updateBy.data.rootCause) {
          if (onUpdate.updateBy.data.title) {
            // add incident feed.

            feedInfoInMarkdown += `\n\n**Root Cause**: 
${onUpdate.updateBy.data.rootCause || "No root cause provided."}
  `;
            shouldAddIncidentFeed = true;
          }
        }

        if (onUpdate.updateBy.data.description) {
          // add incident feed.

          feedInfoInMarkdown += `\n\n**Incident Description**: 
          ${onUpdate.updateBy.data.description || "No description provided."}
          `;
          shouldAddIncidentFeed = true;
        }

        if (onUpdate.updateBy.data.remediationNotes) {
          // add incident feed.

          feedInfoInMarkdown += `\n\n**Remediation Notes**: 
${onUpdate.updateBy.data.remediationNotes || "No remediation notes provided."}
        `;
          shouldAddIncidentFeed = true;
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
            feedInfoInMarkdown += `\n\n**Labels**:

${labels
  .map((label: Label) => {
    return `- ${label.name}`;
  })
  .join("\n")}
`;

            shouldAddIncidentFeed = true;
          }
        }

        if (
          onUpdate.updateBy.data.incidentSeverity &&
          (onUpdate.updateBy.data.incidentSeverity as any)._id
        ) {
          const incidentSeverity: IncidentSeverity | null =
            await IncidentSeverityService.findOneBy({
              query: {
                _id: new ObjectID(
                  (
                    onUpdate.updateBy.data.incidentSeverity as any
                  )?._id.toString(),
                ),
              },
              select: {
                name: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (incidentSeverity) {
            feedInfoInMarkdown += `\n\n**Incident Severity**:
${incidentSeverity.name}
`;

            shouldAddIncidentFeed = true;
          }
        }

        if (shouldAddIncidentFeed) {
          await IncidentFeedService.createIncidentFeed({
            incidentId: incidentId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
            displayColor: Gray500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: createdByUserId || undefined,
          });
        }
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
                startsAt: SortOrder.Descending,
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

  public async refreshIncidentMetrics(data: {
    incidentId: ObjectID;
  }): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        projectId: true,
        monitors: {
          _id: true,
          name: true,
        },
        incidentSeverity: {
          _id: true,
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    if (!incident.projectId) {
      throw new BadDataException("Incient Project ID not found");
    }

    // get incident state timeline

    const incidentStateTimelines: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
        query: {
          incidentId: data.incidentId,
        },
        select: {
          projectId: true,
          incidentStateId: true,
          incidentState: {
            isAcknowledgedState: true,
            isResolvedState: true,
          },
          startsAt: true,
          endsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const firstIncidentStateTimeline: IncidentStateTimeline | undefined =
      incidentStateTimelines[0];

    // delete all the incident metrics with this incident id because its a refresh.

    await MetricService.deleteBy({
      query: {
        serviceId: data.incidentId,
      },
      props: {
        isRoot: true,
      },
    });

    const itemsToSave: Array<Metric> = [];

    // now we need to create new metrics for this incident - TimeToAcknowledge, TimeToResolve, IncidentCount, IncidentDuration

    const incidentStartsAt: Date =
      firstIncidentStateTimeline?.startsAt ||
      incident.createdAt ||
      OneUptimeDate.getCurrentDate();

    const incidentCountMetric: Metric = new Metric();

    incidentCountMetric.projectId = incident.projectId;
    incidentCountMetric.serviceId = incident.id!;
    incidentCountMetric.serviceType = ServiceType.Incident;
    incidentCountMetric.name = IncidentMetricType.IncidentCount;
    incidentCountMetric.description = "Number of incidents created";
    incidentCountMetric.value = 1;
    incidentCountMetric.unit = "";
    incidentCountMetric.attributes = {
      incidentId: data.incidentId.toString(),
      projectId: incident.projectId.toString(),
      monitorIds:
        incident.monitors?.map((monitor: Monitor) => {
          return monitor._id?.toString();
        }) || [],
      monitorNames:
        incident.monitors?.map((monitor: Monitor) => {
          return monitor.name?.toString();
        }) || [],
      incidentSeverityId: incident.incidentSeverity?._id?.toString(),
      incidentSeverityName: incident.incidentSeverity?.name?.toString(),
    };

    incidentCountMetric.time = incidentStartsAt;
    incidentCountMetric.timeUnixNano = OneUptimeDate.toUnixNano(
      incidentCountMetric.time,
    );
    incidentCountMetric.metricPointType = MetricPointType.Sum;

    itemsToSave.push(incidentCountMetric);

    // is the incident acknowledged?
    const isIncidentAcknowledged: boolean = incidentStateTimelines.some(
      (timeline: IncidentStateTimeline) => {
        return timeline.incidentState?.isAcknowledgedState;
      },
    );

    if (isIncidentAcknowledged) {
      const ackIncidentStateTimeline: IncidentStateTimeline | undefined =
        incidentStateTimelines.find((timeline: IncidentStateTimeline) => {
          return timeline.incidentState?.isAcknowledgedState;
        });

      if (ackIncidentStateTimeline) {
        const timeToAcknowledgeMetric: Metric = new Metric();

        timeToAcknowledgeMetric.projectId = incident.projectId;
        timeToAcknowledgeMetric.serviceId = incident.id!;
        timeToAcknowledgeMetric.serviceType = ServiceType.Incident;
        timeToAcknowledgeMetric.name = IncidentMetricType.TimeToAcknowledge;
        timeToAcknowledgeMetric.description =
          "Time taken to acknowledge the incident";
        timeToAcknowledgeMetric.value = OneUptimeDate.getDifferenceInSeconds(
          ackIncidentStateTimeline?.startsAt || OneUptimeDate.getCurrentDate(),
          incidentStartsAt,
        );
        timeToAcknowledgeMetric.unit = "seconds";
        timeToAcknowledgeMetric.attributes = {
          incidentId: data.incidentId.toString(),
          projectId: incident.projectId.toString(),
          monitorIds:
            incident.monitors?.map((monitor: Monitor) => {
              return monitor._id?.toString();
            }) || [],
          monitorNames:
            incident.monitors?.map((monitor: Monitor) => {
              return monitor.name?.toString();
            }) || [],
          incidentSeverityId: incident.incidentSeverity?._id?.toString(),
          incidentSeverityName: incident.incidentSeverity?.name?.toString(),
        };

        timeToAcknowledgeMetric.time =
          ackIncidentStateTimeline?.startsAt ||
          incident.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToAcknowledgeMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToAcknowledgeMetric.time,
        );
        timeToAcknowledgeMetric.metricPointType = MetricPointType.Sum;

        itemsToSave.push(timeToAcknowledgeMetric);
      }
    }

    // time to resolve
    const isIncidentResolved: boolean = incidentStateTimelines.some(
      (timeline: IncidentStateTimeline) => {
        return timeline.incidentState?.isResolvedState;
      },
    );

    if (isIncidentResolved) {
      const resolvedIncidentStateTimeline: IncidentStateTimeline | undefined =
        incidentStateTimelines.find((timeline: IncidentStateTimeline) => {
          return timeline.incidentState?.isResolvedState;
        });

      if (resolvedIncidentStateTimeline) {
        const timeToResolveMetric: Metric = new Metric();

        timeToResolveMetric.projectId = incident.projectId;
        timeToResolveMetric.serviceId = incident.id!;
        timeToResolveMetric.serviceType = ServiceType.Incident;
        timeToResolveMetric.name = IncidentMetricType.TimeToResolve;
        timeToResolveMetric.description = "Time taken to resolve the incident";
        timeToResolveMetric.value = OneUptimeDate.getDifferenceInSeconds(
          resolvedIncidentStateTimeline?.startsAt ||
            OneUptimeDate.getCurrentDate(),
          incidentStartsAt,
        );
        timeToResolveMetric.unit = "seconds";
        timeToResolveMetric.attributes = {
          incidentId: data.incidentId.toString(),
          projectId: incident.projectId.toString(),
          monitorIds:
            incident.monitors?.map((monitor: Monitor) => {
              return monitor._id?.toString();
            }) || [],
          monitorNames:
            incident.monitors?.map((monitor: Monitor) => {
              return monitor.name?.toString();
            }) || [],
          incidentSeverityId: incident.incidentSeverity?._id?.toString(),
          incidentSeverityName: incident.incidentSeverity?.name?.toString(),
        };

        timeToResolveMetric.time =
          resolvedIncidentStateTimeline?.startsAt ||
          incident.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToResolveMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToResolveMetric.time,
        );
        timeToResolveMetric.metricPointType = MetricPointType.Sum;

        itemsToSave.push(timeToResolveMetric);
      }
    }

    // incident duration

    const incidentDurationMetric: Metric = new Metric();

    const lastIncidentStateTimeline: IncidentStateTimeline | undefined =
      incidentStateTimelines[incidentStateTimelines.length - 1];

    if (lastIncidentStateTimeline) {
      const incidentEndsAt: Date =
        lastIncidentStateTimeline.startsAt || OneUptimeDate.getCurrentDate();

      // save metric.

      incidentDurationMetric.projectId = incident.projectId;
      incidentDurationMetric.serviceId = incident.id!;
      incidentDurationMetric.serviceType = ServiceType.Incident;
      incidentDurationMetric.name = IncidentMetricType.IncidentDuration;
      incidentDurationMetric.description = "Duration of the incident";
      incidentDurationMetric.value = OneUptimeDate.getDifferenceInSeconds(
        incidentEndsAt,
        incidentStartsAt,
      );
      incidentDurationMetric.unit = "seconds";
      incidentDurationMetric.attributes = {
        incidentId: data.incidentId.toString(),
        projectId: incident.projectId.toString(),
        monitorIds:
          incident.monitors?.map((monitor: Monitor) => {
            return monitor._id?.toString();
          }) || [],
        monitorNames:
          incident.monitors?.map((monitor: Monitor) => {
            return monitor.name?.toString();
          }) || [],
        incidentSeverityId: incident.incidentSeverity?._id?.toString(),
        incidentSeverityName: incident.incidentSeverity?.name?.toString(),
      };

      incidentDurationMetric.time =
        lastIncidentStateTimeline?.startsAt ||
        incident.createdAt ||
        OneUptimeDate.getCurrentDate();
      incidentDurationMetric.timeUnixNano = OneUptimeDate.toUnixNano(
        incidentDurationMetric.time,
      );
      incidentDurationMetric.metricPointType = MetricPointType.Sum;
    }

    await MetricService.createMany({
      items: itemsToSave,
      props: {
        isRoot: true,
      },
    });

    // index attributes.
    TelemetryUtil.indexAttributes({
      attributes: ["monitorIds", "projectId", "incidentId", "monitorNames"],
      projectId: incident.projectId,
      telemetryType: TelemetryType.Metric,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }
}
export default new Service();
