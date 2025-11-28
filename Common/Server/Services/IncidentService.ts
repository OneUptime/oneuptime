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
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Model from "../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import User from "../../Models/DatabaseModels/User";
import { IsBillingEnabled } from "../EnvironmentConfig";
import MetricService from "./MetricService";
import IncidentMetricType from "../../Types/Incident/IncidentMetricType";
import Metric, {
  MetricPointType,
  ServiceType,
} from "../../Models/AnalyticsModels/Metric";
import OneUptimeDate from "../../Types/Date";
import TelemetryUtil from "../Utils/Telemetry/Telemetry";
import logger from "../Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "../../Server/Infrastructure/Semaphore";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500, Gray500, Red500 } from "../../Types/BrandColors";
import Label from "../../Models/DatabaseModels/Label";
import LabelService from "./LabelService";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/Incident";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { MessageBlocksByWorkspaceType } from "./WorkspaceNotificationRuleService";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import MetricType from "../../Models/DatabaseModels/MetricType";
import UpdateBy from "../Types/Database/UpdateBy";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import Dictionary from "../../Types/Dictionary";
import IncidentTemplateService from "./IncidentTemplateService";
import IncidentTemplate from "../../Models/DatabaseModels/IncidentTemplate";

// key is incidentId for this dictionary.
type UpdateCarryForward = Dictionary<{
  monitorsRemoved: Array<Monitor>;
  monitorsAdded: Array<Monitor>;
  oldChangeMonitorStatusIdTo: ObjectID | undefined;
  newMonitorChangeStatusIdTo: ObjectID | undefined;
}>;

type IncidentUpdatePayload = {
  postmortemNote?: string | null;
  title?: string | null;
  rootCause?: string | null;
  description?: string | null;
  remediationNotes?: string | null;
  labels?: unknown;
  incidentSeverity?: unknown;
  [key: string]: unknown;
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async isIncidentResolved(data: {
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
      throw new BadDataException("Incident Project ID not found");
    }

    const resolvedIncidentState: IncidentState =
      await IncidentStateService.getResolvedIncidentState({
        projectId: incident.projectId,
        props: {
          isRoot: true,
        },
      });

    const currentIncidentStateOrder: number =
      incident.currentIncidentState!.order!;
    const resolvedIncidentStateOrder: number = resolvedIncidentState.order!;

    if (currentIncidentStateOrder >= resolvedIncidentStateOrder) {
      return true;
    }

    return false;
  }

  @CaptureSpan()
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
      throw new BadDataException("Incident Project ID not found");
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

  @CaptureSpan()
  public async resolveIncident(
    incidentId: ObjectID,
    resolvedByUserId: ObjectID,
  ): Promise<Model> {
    // check if the incident is already resolved.
    const isIncidentResolved: boolean = await this.isIncidentResolved({
      incidentId: incidentId,
    });

    if (isIncidentResolved) {
      throw new BadDataException("Incident is already resolved.");
    }

    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        projectId: true,
        incidentNumber: true,
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

    return incident;
  }

  @CaptureSpan()
  public async acknowledgeIncident(
    incidentId: ObjectID,
    acknowledgedByUserId: ObjectID,
  ): Promise<Model> {
    // check if the incident is already acknowledged.
    const isIncidentAcknowledged: boolean = await this.isIncidentAcknowledged({
      incidentId: incidentId,
    });

    if (isIncidentAcknowledged) {
      throw new BadDataException("Incident is already acknowledged.");
    }

    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        projectId: true,
        incidentNumber: true,
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

    return incident;
  }

  @CaptureSpan()
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

    return lastIncident.incidentNumber
      ? Number(lastIncident.incidentNumber)
      : 0;
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    /*
     * get monitors for this incident.
     * if the monitors are removed then change them to operational state.
     * then change all of the monitors in this incident to the changeMonitorStatusToId.
     */

    const carryForward: UpdateCarryForward = {};

    if (
      updateBy.data.monitors ||
      updateBy.data.changeMonitorStatusTo ||
      updateBy.data.changeMonitorStatusToId
    ) {
      const incidentsToUpdate: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          monitors: {
            _id: true,
          },
          projectId: true,
          changeMonitorStatusToId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: updateBy.props,
      });

      for (const incident of incidentsToUpdate) {
        carryForward[incident.id!.toString()] = {
          monitorsRemoved: [],
          monitorsAdded: [],
          oldChangeMonitorStatusIdTo: incident.changeMonitorStatusToId,
          newMonitorChangeStatusIdTo:
            (updateBy.data.changeMonitorStatusToId as ObjectID) ||
            (updateBy.data.changeMonitorStatusTo as unknown as MonitorStatus)
              ?._id ||
            undefined,
        };

        for (const monitor of incident.monitors || []) {
          // check if this monitor is actually removed.
          let isRemoved: boolean = true;

          for (const updatedMonitor of updateBy.data
            ?.monitors as unknown as Array<Monitor>) {
            if (
              updatedMonitor._id &&
              updatedMonitor._id.toString() === monitor._id?.toString()
            ) {
              isRemoved = false;
              break;
            }
          }

          if (isRemoved) {
            carryForward[incident.id!.toString()]?.monitorsRemoved?.push(
              monitor,
            );
          }
        }

        if (updateBy.data.monitors && updateBy.data.monitors.length > 0) {
          for (const monitor of updateBy.data
            ?.monitors as unknown as Array<Monitor>) {
            // check if this monitor is actually added.
            let isAdded: boolean = true;

            for (const existingMonitor of incident.monitors || []) {
              if (
                existingMonitor._id &&
                existingMonitor._id.toString() === monitor._id?.toString()
              ) {
                isAdded = false;
                break;
              }
            }

            if (isAdded) {
              // this monitor is added.
              carryForward[incident.id!.toString()]?.monitorsAdded?.push(
                monitor,
              );
            }
          }
        }
      }
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnIncidentCreated if it's being updated
    if (
      updateBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated !==
      undefined
    ) {
      if (
        updateBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ===
        false
      ) {
        updateBy.data.subscriberNotificationStatusOnIncidentCreated =
          StatusPageSubscriberNotificationStatus.Skipped;
        updateBy.data.subscriberNotificationStatusMessage =
          "Notifications skipped as subscribers are not to be notified for this incident.";
      } else if (
        updateBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ===
        true
      ) {
        updateBy.data.subscriberNotificationStatusOnIncidentCreated =
          StatusPageSubscriberNotificationStatus.Pending;
      }
    }

    return {
      updateBy: updateBy,
      carryForward: carryForward,
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.tenantId && !createBy.props.isRoot) {
      throw new BadDataException("ProjectId required to create incident.");
    }

    const projectId: ObjectID =
      createBy.props.tenantId || createBy.data.projectId!;

    if (!createBy.data.declaredAt) {
      createBy.data.declaredAt = OneUptimeDate.getCurrentDate();
    } else {
      createBy.data.declaredAt = OneUptimeDate.fromString(
        createBy.data.declaredAt as Date,
      );
    }

    // Determine the initial incident state
    let initialIncidentStateId: ObjectID | undefined = undefined;

    // If currentIncidentStateId is already provided (manual selection), use it
    if (createBy.data.currentIncidentStateId) {
      initialIncidentStateId = createBy.data.currentIncidentStateId;

      // Validate that the provided state exists and belongs to the project
      const providedState: IncidentState | null =
        await IncidentStateService.findOneBy({
          query: {
            _id: initialIncidentStateId.toString(),
            projectId: projectId,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!providedState) {
        throw new BadDataException(
          "Invalid incident state provided. The state does not exist or does not belong to this project.",
        );
      }
    } else if (createBy.data.createdIncidentTemplateId) {
      // If created from a template, check if template has a custom initial state
      const incidentTemplate: IncidentTemplate | null =
        await IncidentTemplateService.findOneBy({
          query: {
            _id: createBy.data.createdIncidentTemplateId.toString(),
            projectId: projectId,
          },
          select: {
            initialIncidentStateId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (incidentTemplate?.initialIncidentStateId) {
        initialIncidentStateId = incidentTemplate.initialIncidentStateId;

        // Validate that the template's state exists and belongs to the project
        const templateState: IncidentState | null =
          await IncidentStateService.findOneBy({
            query: {
              _id: initialIncidentStateId.toString(),
              projectId: projectId,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!templateState) {
          // Fall back to default if template state is invalid
          initialIncidentStateId = undefined;
        }
      }
    }

    // If no custom state is provided or found, fall back to default created state
    if (!initialIncidentStateId) {
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

      initialIncidentStateId = incidentState.id;
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

    createBy.data.currentIncidentStateId = initialIncidentStateId;
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

      if (userId) {
        createBy.data.rootCause = `Incident created by ${await UserService.getUserMarkdownString(
          {
            userId: userId!,
            projectId: projectId,
          },
        )}`;
      }
    }

    // Set notification status based on shouldStatusPageSubscribersBeNotifiedOnIncidentCreated
    if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ===
      false
    ) {
      createBy.data.subscriberNotificationStatusOnIncidentCreated =
        StatusPageSubscriberNotificationStatus.Skipped;
      createBy.data.subscriberNotificationStatusMessage =
        "Notifications skipped as subscribers are not to be notified for this incident.";
    } else if (
      createBy.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated ===
      true
    ) {
      createBy.data.subscriberNotificationStatusOnIncidentCreated =
        StatusPageSubscriberNotificationStatus.Pending;
    }

    return {
      createBy,
      carryForward: {
        mutex: mutex,
      },
    };
  }

  @CaptureSpan()
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

    // Get incident data for feed creation
    const incident: Model | null = await this.findOneById({
      id: createdItem.id,
      select: {
        projectId: true,
        incidentNumber: true,
        title: true,
        description: true,
        incidentSeverity: {
          name: true,
        },
        rootCause: true,
        createdByUserId: true,
        createdByUser: {
          _id: true,
          name: true,
          email: true,
        },
        remediationNotes: true,
        currentIncidentState: {
          name: true,
        },
        labels: {
          name: true,
        },
        monitors: {
          name: true,
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    // Release mutex immediately
    this.releaseMutexAsync(onCreate, createdItem.projectId!);

    // Execute operations sequentially with error handling
    Promise.resolve()
      .then(async () => {
        try {
          if (createdItem.projectId && createdItem.id) {
            return await this.handleIncidentWorkspaceOperationsAsync(
              createdItem,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Workspace operations failed in IncidentService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.createIncidentFeedAsync(incident);
        } catch (error) {
          logger.error(
            `Create incident feed failed in IncidentService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.handleIncidentStateChangeAsync(createdItem);
        } catch (error) {
          logger.error(
            `Handle incident state change failed in IncidentService.onCreateSuccess: ${error}`,
          );
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
          logger.error(
            `Add owners failed in IncidentService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (createdItem.changeMonitorStatusToId && createdItem.projectId) {
            return await this.handleMonitorStatusChangeAsync(
              createdItem,
              onCreate,
            );
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `Monitor status change failed in IncidentService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          return await this.disableActiveMonitoringIfManualIncident(
            createdItem.id!,
          );
        } catch (error) {
          logger.error(
            `Disable active monitoring failed in IncidentService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .then(async () => {
        try {
          if (
            createdItem.onCallDutyPolicies?.length &&
            createdItem.onCallDutyPolicies?.length > 0
          ) {
            return await this.executeOnCallDutyPoliciesAsync(createdItem);
          }
          return Promise.resolve();
        } catch (error) {
          logger.error(
            `On-call duty policy execution failed in IncidentService.onCreateSuccess: ${error}`,
          );
          return Promise.resolve();
        }
      })
      .catch((error: Error) => {
        logger.error(
          `Critical error in IncidentService sequential operations: ${error}`,
        );
      });

    return createdItem;
  }

  @CaptureSpan()
  private async handleIncidentWorkspaceOperationsAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for workspace operations",
        );
      }

      // send message to workspaces - slack, teams, etc.
      const workspaceResult: {
        channelsCreated: Array<NotificationRuleWorkspaceChannel>;
      } | null =
        await IncidentWorkspaceMessages.createChannelsAndInviteUsersToChannels({
          projectId: createdItem.projectId,
          incidentId: createdItem.id,
          incidentNumber: createdItem.incidentNumber!,
        });

      if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
        // update incident with these channels.
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
      logger.error(`Error in handleIncidentWorkspaceOperationsAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  private async createIncidentFeedAsync(incident: Model): Promise<void> {
    try {
      const createdByUserId: ObjectID | undefined | null =
        incident.createdByUserId || incident.createdByUser?.id;

      let feedInfoInMarkdown: string = `#### 🚨 Incident ${incident.incidentNumber?.toString()} Created: 
        
**${incident.title || "No title provided."}**:

${incident.description || "No description provided."}

`;

      if (incident.currentIncidentState?.name) {
        feedInfoInMarkdown += `🔴 **Incident State**: ${incident.currentIncidentState.name} \n\n`;
      }

      if (incident.incidentSeverity?.name) {
        feedInfoInMarkdown += `⚠️ **Severity**: ${incident.incidentSeverity.name} \n\n`;
      }

      if (incident.monitors && incident.monitors.length > 0) {
        feedInfoInMarkdown += `🌎 **Resources Affected**:\n`;

        for (const monitor of incident.monitors) {
          feedInfoInMarkdown += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(incident.projectId!, monitor.id!)).toString()})\n`;
        }

        feedInfoInMarkdown += `\n\n`;
      }

      if (incident.rootCause) {
        feedInfoInMarkdown += `\n
📄 **Root Cause**:

${incident.rootCause || "No root cause provided."}

`;
      }

      if (incident.remediationNotes) {
        feedInfoInMarkdown += `\n 
🎯 **Remediation Notes**:

${incident.remediationNotes || "No remediation notes provided."}


`;
      }

      const incidentCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
        await IncidentWorkspaceMessages.getIncidentCreateMessageBlocks({
          incidentId: incident.id!,
          projectId: incident.projectId!,
        });

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.IncidentCreated,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown,
        userId: createdByUserId || undefined,
        workspaceNotification: {
          appendMessageBlocks: incidentCreateMessageBlocks,
          sendWorkspaceNotification: true,
        },
      });
    } catch (error) {
      logger.error(`Error in createIncidentFeedAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  private async handleIncidentStateChangeAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (!createdItem.currentIncidentStateId) {
        throw new BadDataException("currentIncidentStateId is required");
      }

      if (!createdItem.projectId || !createdItem.id) {
        throw new BadDataException(
          "projectId and id are required for state change",
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
        timelineStartsAt: createdItem.declaredAt,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(`Error in handleIncidentStateChangeAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  private async executeOnCallDutyPoliciesAsync(
    createdItem: Model,
  ): Promise<void> {
    try {
      if (
        createdItem.onCallDutyPolicies?.length &&
        createdItem.onCallDutyPolicies?.length > 0
      ) {
        // Execute all on-call policies in parallel
        const policyPromises: Promise<void>[] =
          createdItem.onCallDutyPolicies.map((policy: OnCallDutyPolicy) => {
            return OnCallDutyPolicyService.executePolicy(
              new ObjectID(policy["_id"] as string),
              {
                triggeredByIncidentId: createdItem.id!,
                userNotificationEventType:
                  UserNotificationEventType.IncidentCreated,
              },
            );
          });

        await Promise.allSettled(policyPromises);
      }
    } catch (error) {
      logger.error(`Error in executeOnCallDutyPoliciesAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  private async handleMonitorStatusChangeAsync(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    try {
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
            "Status was changed because Incident #" +
              createdItem.incidentNumber?.toString() +
              " was created.",
          createdItem.createdStateLog,
          onCreate.createBy.props,
        );
      }
    } catch (error) {
      logger.error(`Error in handleMonitorStatusChangeAsync: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
  private releaseMutexAsync(
    onCreate: OnCreate<Model>,
    projectId: ObjectID,
  ): void {
    // Release mutex in background without blocking
    if (onCreate.carryForward && onCreate.carryForward.mutex) {
      const mutex: SemaphoreMutex = onCreate.carryForward.mutex;

      setImmediate(async () => {
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
            "Mutex release failed - IncidentService.incident-create " +
              projectId.toString() +
              " at " +
              OneUptimeDate.getCurrentDateAsFormattedString(),
          );
          logger.error(err);
        }
      });
    }
  }

  @CaptureSpan()
  public async disableActiveMonitoringIfManualIncident(
    incidentId: ObjectID,
  ): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        monitors: {
          _id: true,
        },
        isCreatedAutomatically: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found");
    }

    if (!incident.isCreatedAutomatically) {
      const monitors: Array<Monitor> = incident.monitors || [];

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
  }

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
  public async getIncidentLinkInDashboard(
    projectId: ObjectID,
    incidentId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/incidents/${incidentId.toString()}`,
    );
  }

  @CaptureSpan()
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
        const incident: Model | null = await this.findOneById({
          id: incidentId,
          select: {
            projectId: true,
            incidentNumber: true,
          },
          props: {
            isRoot: true,
          },
        });

        const projectId: ObjectID = incident!.projectId!;
        const incidentNumber: number = incident!.incidentNumber!;
        const incidentLabel: string = `Incident ${incidentNumber}`;
        const incidentLink: URL = await this.getIncidentLinkInDashboard(
          projectId,
          incidentId,
        );

        const updatedIncidentData: IncidentUpdatePayload = (onUpdate.updateBy
          .data ?? {}) as IncidentUpdatePayload;

        const createdByUserId: ObjectID | undefined | null =
          onUpdate.updateBy.props.userId;

        if (
          Object.prototype.hasOwnProperty.call(
            updatedIncidentData,
            "postmortemNote",
          )
        ) {
          const noteValue: string =
            (updatedIncidentData.postmortemNote as string) || "";
          const hasNoteContent: boolean = noteValue.trim().length > 0;

          const postmortemFeedMarkdown: string = hasNoteContent
            ? `**📘 Postmortem Note updated for [${incidentLabel}](${incidentLink.toString()})**\n\n${noteValue}`
            : `**📘 Postmortem Note cleared for [${incidentLabel}](${incidentLink.toString()})**\n\n_No postmortem note provided._`;

          await IncidentFeedService.createIncidentFeedItem({
            incidentId,
            projectId,
            incidentFeedEventType: IncidentFeedEventType.PostmortemNote,
            displayColor: Blue500,
            feedInfoInMarkdown: postmortemFeedMarkdown,
            userId: createdByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
          });
        }

        let shouldAddIncidentFeed: boolean = false;
        let feedInfoInMarkdown: string = `**[${incidentLabel}](${incidentLink.toString()}) was updated.**`;

        if (
          Object.prototype.hasOwnProperty.call(updatedIncidentData, "title")
        ) {
          const title: string =
            (updatedIncidentData.title as string) || "No title provided.";
          feedInfoInMarkdown += `\n\n**Title**: \n${title}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          Object.prototype.hasOwnProperty.call(updatedIncidentData, "rootCause")
        ) {
          const rootCause: string =
            (updatedIncidentData.rootCause as string) || "";
          const rootCauseText: string = rootCause.trim().length
            ? rootCause
            : "Root cause removed.";
          feedInfoInMarkdown += `\n\n**📄 Root Cause**: \n${rootCauseText}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            updatedIncidentData,
            "description",
          )
        ) {
          const description: string =
            (updatedIncidentData.description as string) ||
            "No description provided.";
          feedInfoInMarkdown += `\n\n**Incident Description**: \n${description}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          Object.prototype.hasOwnProperty.call(
            updatedIncidentData,
            "remediationNotes",
          )
        ) {
          const remediationNotes: string =
            (updatedIncidentData.remediationNotes as string) || "";
          const remediationText: string = remediationNotes.trim().length
            ? remediationNotes
            : "Remediation notes removed.";
          feedInfoInMarkdown += `\n\n**🎯 Remediation Notes**: \n${remediationText}\n`;
          shouldAddIncidentFeed = true;
        }

        if (
          updatedIncidentData.labels &&
          (updatedIncidentData.labels as Array<Label>).length > 0 &&
          Array.isArray(updatedIncidentData.labels)
        ) {
          const labelIds: Array<ObjectID> = (updatedIncidentData.labels as any)
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

            shouldAddIncidentFeed = true;
          }
        }

        if (
          updatedIncidentData.incidentSeverity &&
          (updatedIncidentData.incidentSeverity as any)._id
        ) {
          const incidentSeverity: IncidentSeverity | null =
            await IncidentSeverityService.findOneBy({
              query: {
                _id: new ObjectID(
                  (updatedIncidentData.incidentSeverity as any)?._id.toString(),
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
            feedInfoInMarkdown += `\n\n**⚠️ Incident Severity**:
${incidentSeverity.name}
`;

            shouldAddIncidentFeed = true;
          }
        }

        const carryForward: UpdateCarryForward | undefined =
          onUpdate.carryForward;

        if (carryForward) {
          const incidentCarryForward:
            | {
                monitorsRemoved: Array<Monitor>;
                monitorsAdded: Array<Monitor>;
                oldChangeMonitorStatusIdTo: ObjectID | undefined;
                newMonitorChangeStatusIdTo: ObjectID | undefined;
              }
            | undefined = carryForward[incidentId.toString()];

          if (incidentCarryForward) {
            if (incidentCarryForward.monitorsRemoved.length > 0) {
              const monitorsRemoved: Array<Monitor> =
                await MonitorService.findBy({
                  query: {
                    _id: QueryHelper.any(
                      incidentCarryForward.monitorsRemoved.map(
                        (monitor: Monitor) => {
                          return new ObjectID(monitor._id?.toString() || "");
                        },
                      ),
                    ),
                  },
                  select: {
                    name: true,
                    _id: true,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  props: {
                    isRoot: true,
                  },
                });

              // change these monitors back to operational state.
              await this.markMonitorsActiveForMonitoring(
                projectId!,
                incidentCarryForward.monitorsRemoved,
              );

              feedInfoInMarkdown += `\n\n**🗑️ Monitors Removed**:\n`;

              for (const monitor of monitorsRemoved) {
                feedInfoInMarkdown += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitor.id!)).toString()})\n`;
              }

              shouldAddIncidentFeed = true;
            }

            if (incidentCarryForward.monitorsAdded.length > 0) {
              const monitorsAdded: Array<Monitor> = await MonitorService.findBy(
                {
                  query: {
                    _id: QueryHelper.any(
                      incidentCarryForward.monitorsAdded.map(
                        (monitor: Monitor) => {
                          return new ObjectID(monitor._id?.toString() || "");
                        },
                      ),
                    ),
                  },
                  select: {
                    name: true,
                    _id: true,
                  },
                  limit: LIMIT_PER_PROJECT,
                  skip: 0,
                  props: {
                    isRoot: true,
                  },
                },
              );

              feedInfoInMarkdown += `\n\n**🌎 Monitors Added**:\n`;

              for (const monitor of monitorsAdded) {
                feedInfoInMarkdown += `- [${monitor.name}](${(await MonitorService.getMonitorLinkInDashboard(projectId!, monitor.id!)).toString()})\n`;
              }

              shouldAddIncidentFeed = true;
            }

            if (
              incidentCarryForward.oldChangeMonitorStatusIdTo &&
              incidentCarryForward.newMonitorChangeStatusIdTo
            ) {
              const oldMonitorStatus: MonitorStatus | null =
                await MonitorStatusService.findOneBy({
                  query: {
                    _id: incidentCarryForward.oldChangeMonitorStatusIdTo,
                  },
                  select: {
                    name: true,
                  },
                  props: {
                    isRoot: true,
                  },
                });

              const newMonitorStatus: MonitorStatus | null =
                await MonitorStatusService.findOneBy({
                  query: {
                    _id: incidentCarryForward.newMonitorChangeStatusIdTo,
                  },
                  select: {
                    name: true,
                  },
                  props: {
                    isRoot: true,
                  },
                });

              if (oldMonitorStatus && newMonitorStatus) {
                feedInfoInMarkdown += `\n\n**🔄 Monitor Status Changed**:\n- **From** ${oldMonitorStatus.name} to ${newMonitorStatus.name}`;
                shouldAddIncidentFeed = true;
              }
            }

            const changeNewMonitorStatusTo: ObjectID | undefined =
              incidentCarryForward.newMonitorChangeStatusIdTo ||
              incidentCarryForward.oldChangeMonitorStatusIdTo;

            if (incidentCarryForward.monitorsAdded?.length > 0) {
              await this.disableActiveMonitoringIfManualIncident(incidentId);
            }

            if (changeNewMonitorStatusTo) {
              const incident: Model | null = await this.findOneById({
                id: incidentId,
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

              const monitorsForThisIncident: Array<Monitor> =
                incident?.monitors || [];

              await MonitorService.changeMonitorStatus(
                projectId!,
                monitorsForThisIncident.map((monitor: Monitor) => {
                  return new ObjectID(monitor._id?.toString() || "");
                }),
                changeNewMonitorStatusTo,
                true, // notifyMonitorOwners
                "Status was changed because Incident #" +
                  incidentNumber?.toString() +
                  " was updated.",
                undefined,
                onUpdate.updateBy.props,
              );
            }
          }
        }

        if (shouldAddIncidentFeed) {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incidentId,
            projectId: onUpdate.updateBy.props.tenantId as ObjectID,
            incidentFeedEventType: IncidentFeedEventType.IncidentUpdated,
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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
    timelineStartsAt?: Date | string | undefined;
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
      timelineStartsAt,
    } = data;

    const declaredTimelineStart: Date | undefined = timelineStartsAt
      ? OneUptimeDate.fromString(timelineStartsAt as Date)
      : undefined;

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

    if (!lastIncidentStatusTimeline && declaredTimelineStart) {
      statusTimeline.startsAt = declaredTimelineStart;
    }

    // Map boolean to enum value
    statusTimeline.subscriberNotificationStatus = isSubscribersNotified
      ? StatusPageSubscriberNotificationStatus.Success
      : StatusPageSubscriberNotificationStatus.Pending;

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

  @CaptureSpan()
  public async refreshIncidentMetrics(data: {
    incidentId: ObjectID;
  }): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        projectId: true,
        declaredAt: true,
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
      throw new BadDataException("Incident Project ID not found");
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

    // delete all the incident metrics with this incident id because it's a refresh.

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
      incident.declaredAt ||
      incident.createdAt ||
      OneUptimeDate.getCurrentDate();

    const metricTypesMap: Dictionary<MetricType> = {};

    const incidentCountMetric: Metric = new Metric();

    incidentCountMetric.projectId = incident.projectId;
    incidentCountMetric.serviceId = incident.id!;
    incidentCountMetric.serviceType = ServiceType.Incident;
    incidentCountMetric.name = IncidentMetricType.IncidentCount;
    incidentCountMetric.value = 1;
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
    incidentCountMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
      incidentCountMetric.attributes,
    );

    incidentCountMetric.time = incidentStartsAt;
    incidentCountMetric.timeUnixNano = OneUptimeDate.toUnixNano(
      incidentCountMetric.time,
    );
    incidentCountMetric.metricPointType = MetricPointType.Sum;

    itemsToSave.push(incidentCountMetric);

    // add metric type for this to map.
    const metricType: MetricType = new MetricType();
    metricType.name = incidentCountMetric.name;
    metricType.description = "Number of incidents created";
    metricType.unit = "";
    metricType.telemetryServices = [];

    // add to map.
    metricTypesMap[incidentCountMetric.name] = metricType;

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
        timeToAcknowledgeMetric.value = OneUptimeDate.getDifferenceInSeconds(
          ackIncidentStateTimeline?.startsAt || OneUptimeDate.getCurrentDate(),
          incidentStartsAt,
        );
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
        timeToAcknowledgeMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
          timeToAcknowledgeMetric.attributes,
        );

        timeToAcknowledgeMetric.time =
          ackIncidentStateTimeline?.startsAt ||
          incident.declaredAt ||
          incident.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToAcknowledgeMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToAcknowledgeMetric.time,
        );
        timeToAcknowledgeMetric.metricPointType = MetricPointType.Sum;

        itemsToSave.push(timeToAcknowledgeMetric);

        // add metric type for this to map.
        const metricType: MetricType = new MetricType();
        metricType.name = timeToAcknowledgeMetric.name;
        metricType.description = "Time taken to acknowledge the incident";
        metricType.unit = "seconds";

        // add to map.
        metricTypesMap[timeToAcknowledgeMetric.name] = metricType;
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
        timeToResolveMetric.value = OneUptimeDate.getDifferenceInSeconds(
          resolvedIncidentStateTimeline?.startsAt ||
            OneUptimeDate.getCurrentDate(),
          incidentStartsAt,
        );
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
        timeToResolveMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
          timeToResolveMetric.attributes,
        );

        timeToResolveMetric.time =
          resolvedIncidentStateTimeline?.startsAt ||
          incident.declaredAt ||
          incident.createdAt ||
          OneUptimeDate.getCurrentDate();
        timeToResolveMetric.timeUnixNano = OneUptimeDate.toUnixNano(
          timeToResolveMetric.time,
        );
        timeToResolveMetric.metricPointType = MetricPointType.Sum;

        itemsToSave.push(timeToResolveMetric);

        // add metric type for this to map.
        const metricType: MetricType = new MetricType();
        metricType.name = timeToResolveMetric.name;
        metricType.description = "Time taken to resolve the incident";
        metricType.unit = "seconds";
        // add to map.
        metricTypesMap[timeToResolveMetric.name] = metricType;
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
      incidentDurationMetric.value = OneUptimeDate.getDifferenceInSeconds(
        incidentEndsAt,
        incidentStartsAt,
      );
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
      incidentDurationMetric.attributeKeys = TelemetryUtil.getAttributeKeys(
        incidentDurationMetric.attributes,
      );

      incidentDurationMetric.time =
        lastIncidentStateTimeline?.startsAt ||
        incident.declaredAt ||
        incident.createdAt ||
        OneUptimeDate.getCurrentDate();
      incidentDurationMetric.timeUnixNano = OneUptimeDate.toUnixNano(
        incidentDurationMetric.time,
      );
      incidentDurationMetric.metricPointType = MetricPointType.Sum;

      itemsToSave.push(incidentDurationMetric);

      // add metric type for this to map.
      const metricType: MetricType = new MetricType();
      metricType.name = incidentDurationMetric.name;
      metricType.description = "Duration of the incident";
      metricType.unit = "seconds";

      // add to map.
      metricTypesMap[incidentDurationMetric.name] = metricType;
    }

    await MetricService.createMany({
      items: itemsToSave,
      props: {
        isRoot: true,
      },
    });

    TelemetryUtil.indexMetricNameServiceNameMap({
      metricNameServiceNameMap: metricTypesMap,
      projectId: incident.projectId,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }

  @CaptureSpan()
  public async getWorkspaceChannelForIncident(data: {
    incidentId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found.");
    }

    return (incident.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  @CaptureSpan()
  public async getIncidentNumber(data: {
    incidentId: ObjectID;
  }): Promise<number | null> {
    const incident: Model | null = await this.findOneById({
      id: data.incidentId,
      select: {
        incidentNumber: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new BadDataException("Incident not found.");
    }

    return incident.incidentNumber ? Number(incident.incidentNumber) : null;
  }

  /**
   * Ensures the currentIncidentStateId of the incident matches the latest timeline entry.
   */
  public async refreshIncidentCurrentStatus(
    incidentId: ObjectID,
  ): Promise<void> {
    const incident: Model | null = await this.findOneById({
      id: incidentId,
      select: {
        _id: true,
        projectId: true,
        currentIncidentStateId: true,
      },
      props: { isRoot: true },
    });
    if (!incident || !incident.projectId) {
      return;
    }
    const latestTimeline: IncidentStateTimeline | null =
      await IncidentStateTimelineService.findOneBy({
        query: {
          incidentId: incident.id!,
          projectId: incident.projectId,
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        select: {
          incidentStateId: true,
        },
        props: {
          isRoot: true,
        },
      });
    if (
      latestTimeline &&
      latestTimeline.incidentStateId &&
      incident.currentIncidentStateId?.toString() !==
        latestTimeline.incidentStateId.toString()
    ) {
      await this.updateOneBy({
        query: { _id: incident.id!.toString() },
        data: {
          currentIncidentStateId: latestTimeline.incidentStateId,
        },
        props: { isRoot: true },
      });
      logger.info(
        `Updated Incident ${incident.id} current state to ${latestTimeline.incidentStateId}`,
      );
    }
  }
}

export default new Service();
