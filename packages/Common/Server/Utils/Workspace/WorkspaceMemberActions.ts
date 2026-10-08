import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import AcknowledgedStateUtil from "../../../Utils/AcknowledgedState";
import ResolvedStateUtil, { ResolvedStateList } from "../../../Utils/ResolvedState";
import { StateListType } from "../../../Utils/StateOrder";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../Services/AlertEpisodeStateTimelineService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../Services/IncidentEpisodeStateTimelineService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../Services/ScheduledMaintenanceStateTimelineService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";

/*
 * WHAT A SLACK OR MICROSOFT TEAMS BUTTON CHANGES, IT CHANGES AS THE MEMBER
 * WHO PRESSED IT.
 *
 * Acknowledge, Resolve, Mark as Ongoing, Mark as Complete, Change State and
 * Execute On-Call Policy on an incident, an alert, an incident or alert
 * episode, or a scheduled maintenance event are made here with the props of
 * the OneUptime member the chat account is connected to
 * (WorkspaceActionAuthorization.getProjectMemberProps) - the props the
 * dashboard uses for the same person - and as the same write the dashboard
 * makes for the same action:
 *
 *   - a state change is the creation of a row in the record's state
 *     timeline, with the state it moves to, as the dashboard's state panel
 *     creates it,
 *   - executing an on-call policy is the creation of its execution log,
 *     triggered by the record, as the dashboard's Execute On-Call Policy
 *     creates it.
 *
 * (A note is the creation of the note, by the note services' addNote, with
 * the same props.)
 *
 * So each one is held to the rules the API holds the same person to: their
 * permission to create the row and every column it writes, their read of
 * the record it is made under and of every record it names - labels, owners
 * and their team's blocks included - and the project's plan. A refusal is
 * the exception the write throws, written for that person, for the chat to
 * tell them. What follows from a saved state change - the record's current
 * state, an episode's member alerts or incidents - is OneUptime's own write,
 * as it is for a change made in the dashboard (StateChangeFollowOn).
 *
 * The record is read as the member first: one they may not read is
 * answered like one that is not there, before anything about it - its state
 * included - is told to them.
 */

// The records Slack and Microsoft Teams buttons act on.
export enum WorkspaceEventType {
  Incident = "Incident",
  Alert = "Alert",
  ScheduledMaintenance = "ScheduledMaintenance",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
}

export interface WorkspaceEvent {
  type: WorkspaceEventType;
  id: ObjectID;
}

// A state a chat's change-state form offers.
export interface WorkspaceEventStateOption {
  id: ObjectID;
  name: string;
}

// The record a button acts on, as its member reads it.
interface ReadEvent {
  projectId: ObjectID;
  currentStateId: ObjectID | undefined;
}

// A state of the record's list, with what decides where it sits.
type ProjectState = IncidentState | AlertState | ScheduledMaintenanceState;

interface EventTypeDefinition {
  // Singular, lower case, for sentences: "incident", "alert episode".
  noun: string;
  // How the services name it in their refusals: "Incident is already resolved."
  subject: string;
  // The state list Acknowledge and Resolve read; none for maintenance.
  stateList: ResolvedStateList | null;
}

const EVENT_TYPES: Record<WorkspaceEventType, EventTypeDefinition> = {
  [WorkspaceEventType.Incident]: {
    noun: "incident",
    subject: "Incident",
    stateList: StateListType.IncidentState,
  },
  [WorkspaceEventType.Alert]: {
    noun: "alert",
    subject: "Alert",
    stateList: StateListType.AlertState,
  },
  [WorkspaceEventType.IncidentEpisode]: {
    noun: "incident episode",
    subject: "Episode",
    stateList: StateListType.IncidentState,
  },
  [WorkspaceEventType.AlertEpisode]: {
    noun: "alert episode",
    subject: "Episode",
    stateList: StateListType.AlertState,
  },
  [WorkspaceEventType.ScheduledMaintenance]: {
    noun: "scheduled maintenance event",
    subject: "Scheduled maintenance event",
    stateList: null,
  },
};

export default class WorkspaceMemberActions {
  public static getNoun(type: WorkspaceEventType): string {
    return EVENT_TYPES[type].noun;
  }

  /*
   * Moves the record into `stateId`, as the member: the state timeline row
   * the dashboard's state panel creates for the same change. The timeline
   * service refuses a state of another project, the state the record is in
   * already, and a move up the project's list of states.
   */
  @CaptureSpan()
  public static async changeState(data: {
    event: WorkspaceEvent;
    stateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const event: ReadEvent = await this.readEvent({
      event: data.event,
      props: data.props,
    });

    await this.createStateChange({
      event: data.event,
      projectId: event.projectId,
      stateId: data.stateId,
      props: data.props,
    });
  }

  /*
   * Acknowledge, as the member: a move into the project's acknowledged state
   * - the first from the top flagged acknowledged - refused for a record
   * acknowledged already, or further along, with the sentence the services
   * say it in everywhere else (Common/Utils/AcknowledgedState).
   */
  @CaptureSpan()
  public static async acknowledge(data: {
    event: WorkspaceEvent;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const definition: EventTypeDefinition = EVENT_TYPES[data.event.type];

    if (!definition.stateList) {
      throw new BadDataException(
        `A ${definition.noun} cannot be acknowledged.`,
      );
    }

    const event: ReadEvent = await this.readEvent({
      event: data.event,
      props: data.props,
    });

    const states: Array<ProjectState> = await this.getProjectStates({
      type: data.event.type,
      projectId: event.projectId,
    });

    const refusal: string | null = AcknowledgedStateUtil.getAcknowledgeRefusal(
      {
        list: definition.stateList,
        states: states,
        stateId: event.currentStateId,
        subject: definition.subject,
      },
    );

    if (refusal) {
      throw new BadDataException(refusal);
    }

    const acknowledgedState: ProjectState | null =
      AcknowledgedStateUtil.getAcknowledgedState({
        list: definition.stateList,
        states: states,
      });

    if (!acknowledgedState || !acknowledgedState.id) {
      throw new BadDataException(
        "Acknowledged state not found for this project. Please add acknowledged state from settings.",
      );
    }

    await this.createStateChange({
      event: data.event,
      projectId: event.projectId,
      stateId: acknowledgedState.id,
      props: data.props,
    });
  }

  /*
   * Resolve, as the member: a move into the project's resolved state - the
   * first from the top flagged resolved (Common/Utils/ResolvedState) -
   * refused for a record resolved already. For a scheduled maintenance
   * event, Mark as Complete: a move into its completed state.
   */
  @CaptureSpan()
  public static async resolve(data: {
    event: WorkspaceEvent;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const definition: EventTypeDefinition = EVENT_TYPES[data.event.type];

    const event: ReadEvent = await this.readEvent({
      event: data.event,
      props: data.props,
    });

    if (data.event.type === WorkspaceEventType.ScheduledMaintenance) {
      if (
        await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
          scheduledMaintenanceId: data.event.id,
        })
      ) {
        throw new BadDataException(
          `${definition.subject} is already complete.`,
        );
      }

      const completedState: ScheduledMaintenanceState =
        await ScheduledMaintenanceStateService.getCompletedScheduledMaintenanceState(
          {
            projectId: event.projectId,
            props: {
              isRoot: true,
            },
          },
        );

      await this.createStateChange({
        event: data.event,
        projectId: event.projectId,
        stateId: completedState.id!,
        props: data.props,
      });

      return;
    }

    const states: Array<ProjectState> = await this.getProjectStates({
      type: data.event.type,
      projectId: event.projectId,
    });

    const stateList: ResolvedStateList = definition.stateList!;

    if (
      ResolvedStateUtil.isResolved({
        list: stateList,
        states: states,
        stateId: event.currentStateId,
      })
    ) {
      throw new BadDataException(`${definition.subject} is already resolved.`);
    }

    const resolvedState: ProjectState | null =
      ResolvedStateUtil.getResolvedState({
        list: stateList,
        states: states,
      });

    if (!resolvedState || !resolvedState.id) {
      throw new BadDataException(
        "Resolved state not found for this project. Please add resolved state from settings.",
      );
    }

    await this.createStateChange({
      event: data.event,
      projectId: event.projectId,
      stateId: resolvedState.id,
      props: data.props,
    });
  }

  /*
   * Mark as Ongoing, as the member: a move into the project's ongoing state
   * (ScheduledMaintenanceStartUtil), refused for an event that has started
   * already - in its ongoing state or any state after it.
   */
  @CaptureSpan()
  public static async markScheduledMaintenanceAsOngoing(data: {
    scheduledMaintenanceId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const event: WorkspaceEvent = {
      type: WorkspaceEventType.ScheduledMaintenance,
      id: data.scheduledMaintenanceId,
    };

    const readEvent: ReadEvent = await this.readEvent({
      event: event,
      props: data.props,
    });

    if (
      await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
        scheduledMaintenanceId: data.scheduledMaintenanceId,
      })
    ) {
      throw new BadDataException(
        "Scheduled maintenance event is already ongoing.",
      );
    }

    const ongoingState: ScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.getOngoingScheduledMaintenanceState(
        {
          projectId: readEvent.projectId,
          props: {
            isRoot: true,
          },
        },
      );

    await this.createStateChange({
      event: event,
      projectId: readEvent.projectId,
      stateId: ongoingState.id!,
      props: data.props,
    });
  }

  /*
   * The states a change-state form offers its member: the project's states
   * of the record's kind that they may read, in the project's order, as the
   * dashboard's state panel lists them for them. None when they may read
   * none - the chat then says so instead of showing an empty form.
   */
  @CaptureSpan()
  public static async findStateOptions(data: {
    type: WorkspaceEventType;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<WorkspaceEventStateOption>> {
    const states: Array<ProjectState> = await this.findReadableStates(data);

    const options: Array<WorkspaceEventStateOption> = [];

    for (const state of states) {
      if (state.id && state.name) {
        options.push({
          id: state.id,
          name: state.name,
        });
      }
    }

    return options;
  }

  /*
   * Executes an on-call policy for the record, as the member: the execution
   * log the dashboard's Execute On-Call Policy creates, triggered by the
   * record. The log service pages from there; an archived policy pages no
   * one and says so on the log (OnCallDutyPolicyArchive).
   */
  @CaptureSpan()
  public static async executeOnCallPolicy(data: {
    event: WorkspaceEvent;
    onCallDutyPolicyId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const event: ReadEvent = await this.readEvent({
      event: data.event,
      props: data.props,
    });

    const executionLog: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    executionLog.projectId = event.projectId;
    executionLog.onCallDutyPolicyId = data.onCallDutyPolicyId;

    switch (data.event.type) {
      case WorkspaceEventType.Incident:
        executionLog.triggeredByIncidentId = data.event.id;
        executionLog.userNotificationEventType =
          UserNotificationEventType.IncidentCreated;
        break;
      case WorkspaceEventType.Alert:
        executionLog.triggeredByAlertId = data.event.id;
        executionLog.userNotificationEventType =
          UserNotificationEventType.AlertCreated;
        break;
      case WorkspaceEventType.IncidentEpisode:
        executionLog.triggeredByIncidentEpisodeId = data.event.id;
        executionLog.userNotificationEventType =
          UserNotificationEventType.IncidentEpisodeCreated;
        break;
      case WorkspaceEventType.AlertEpisode:
        executionLog.triggeredByAlertEpisodeId = data.event.id;
        executionLog.userNotificationEventType =
          UserNotificationEventType.AlertEpisodeCreated;
        break;
      case WorkspaceEventType.ScheduledMaintenance:
        throw new BadDataException(
          "On-call policies are executed for incidents, alerts and episodes, not for scheduled maintenance events.",
        );
    }

    await OnCallDutyPolicyExecutionLogService.create({
      data: executionLog,
      props: data.props,
    });
  }

  /*
   * The record, read with the member's props: in its project, under their
   * labels, owners and blocks, a private incident only for those who may
   * see it. One they may not read is refused like one that is not there.
   */
  private static async readEvent(data: {
    event: WorkspaceEvent;
    props: DatabaseCommonInteractionProps;
  }): Promise<ReadEvent> {
    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!data.props.userId || !projectId) {
      throw new NotAuthorizedException(
        `You do not have permission to change this ${this.getNoun(data.event.type)}.`,
      );
    }

    let readEvent: ReadEvent | null = null;

    try {
      readEvent = await this.findEvent({
        event: data.event,
        projectId: projectId,
        props: data.props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }
    }

    if (!readEvent) {
      throw new NotAuthorizedException(
        `The ${this.getNoun(data.event.type)} was not found in this project, or you do not have access to it.`,
      );
    }

    return readEvent;
  }

  private static async findEvent(data: {
    event: WorkspaceEvent;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ReadEvent | null> {
    const { event, projectId, props } = data;

    switch (event.type) {
      case WorkspaceEventType.Incident: {
        const incident: Incident | null = await IncidentService.findOneBy({
          query: {
            _id: event.id.toString(),
            projectId: projectId,
          },
          select: {
            _id: true,
            currentIncidentStateId: true,
          },
          props: props,
        });

        return incident
          ? {
              projectId: projectId,
              currentStateId: incident.currentIncidentStateId,
            }
          : null;
      }
      case WorkspaceEventType.Alert: {
        const alert: Alert | null = await AlertService.findOneBy({
          query: {
            _id: event.id.toString(),
            projectId: projectId,
          },
          select: {
            _id: true,
            currentAlertStateId: true,
          },
          props: props,
        });

        return alert
          ? {
              projectId: projectId,
              currentStateId: alert.currentAlertStateId,
            }
          : null;
      }
      case WorkspaceEventType.IncidentEpisode: {
        const episode: IncidentEpisode | null =
          await IncidentEpisodeService.findOneBy({
            query: {
              _id: event.id.toString(),
              projectId: projectId,
            },
            select: {
              _id: true,
              currentIncidentStateId: true,
            },
            props: props,
          });

        return episode
          ? {
              projectId: projectId,
              currentStateId: episode.currentIncidentStateId,
            }
          : null;
      }
      case WorkspaceEventType.AlertEpisode: {
        const episode: AlertEpisode | null =
          await AlertEpisodeService.findOneBy({
            query: {
              _id: event.id.toString(),
              projectId: projectId,
            },
            select: {
              _id: true,
              currentAlertStateId: true,
            },
            props: props,
          });

        return episode
          ? {
              projectId: projectId,
              currentStateId: episode.currentAlertStateId,
            }
          : null;
      }
      case WorkspaceEventType.ScheduledMaintenance: {
        const scheduledMaintenance: ScheduledMaintenance | null =
          await ScheduledMaintenanceService.findOneBy({
            query: {
              _id: event.id.toString(),
              projectId: projectId,
            },
            select: {
              _id: true,
              currentScheduledMaintenanceStateId: true,
            },
            props: props,
          });

        return scheduledMaintenance
          ? {
              projectId: projectId,
              currentStateId:
                scheduledMaintenance.currentScheduledMaintenanceStateId,
            }
          : null;
      }
    }
  }

  /*
   * The project's states of the record's kind, as OneUptime reads them:
   * where Acknowledge and Resolve move a record is the project's rule, not
   * the member's pick. The state the move names is still held to the
   * member's read, by the create.
   */
  private static async getProjectStates(data: {
    type: WorkspaceEventType;
    projectId: ObjectID;
  }): Promise<Array<ProjectState>> {
    switch (data.type) {
      case WorkspaceEventType.Incident:
      case WorkspaceEventType.IncidentEpisode:
        return await IncidentStateService.getAllIncidentStates({
          projectId: data.projectId,
          props: {
            isRoot: true,
          },
        });
      case WorkspaceEventType.Alert:
      case WorkspaceEventType.AlertEpisode:
        return await AlertStateService.getAllAlertStates({
          projectId: data.projectId,
          props: {
            isRoot: true,
          },
        });
      case WorkspaceEventType.ScheduledMaintenance:
        return await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates(
          {
            projectId: data.projectId,
            props: {
              isRoot: true,
            },
          },
        );
    }
  }

  // The project's states of the record's kind that the member may read.
  private static async findReadableStates(data: {
    type: WorkspaceEventType;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ProjectState>> {
    switch (data.type) {
      case WorkspaceEventType.Incident:
      case WorkspaceEventType.IncidentEpisode:
        return await WorkspaceActionAuthorization.findReadable({
          service: IncidentStateService,
          props: data.props,
          query: {
            projectId: data.projectId,
          },
          select: {
            _id: true,
            name: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
        });
      case WorkspaceEventType.Alert:
      case WorkspaceEventType.AlertEpisode:
        return await WorkspaceActionAuthorization.findReadable({
          service: AlertStateService,
          props: data.props,
          query: {
            projectId: data.projectId,
          },
          select: {
            _id: true,
            name: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
        });
      case WorkspaceEventType.ScheduledMaintenance:
        return await WorkspaceActionAuthorization.findReadable({
          service: ScheduledMaintenanceStateService,
          props: data.props,
          query: {
            projectId: data.projectId,
          },
          select: {
            _id: true,
            name: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
        });
    }
  }

  /*
   * The state timeline row, with what the dashboard sends for it: the
   * project, the record and the state. Created by the member - they are its
   * creator - so the timeline service writes "changed by" them, and posts
   * the change to the record's feed and channels as theirs.
   */
  private static async createStateChange(data: {
    event: WorkspaceEvent;
    projectId: ObjectID;
    stateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { event, projectId, stateId, props } = data;

    switch (event.type) {
      case WorkspaceEventType.Incident: {
        const timeline: IncidentStateTimeline = new IncidentStateTimeline();
        timeline.projectId = projectId;
        timeline.incidentId = event.id;
        timeline.incidentStateId = stateId;

        await IncidentStateTimelineService.create({
          data: timeline,
          props: props,
        });
        return;
      }
      case WorkspaceEventType.Alert: {
        const timeline: AlertStateTimeline = new AlertStateTimeline();
        timeline.projectId = projectId;
        timeline.alertId = event.id;
        timeline.alertStateId = stateId;

        await AlertStateTimelineService.create({
          data: timeline,
          props: props,
        });
        return;
      }
      case WorkspaceEventType.IncidentEpisode: {
        const timeline: IncidentEpisodeStateTimeline =
          new IncidentEpisodeStateTimeline();
        timeline.projectId = projectId;
        timeline.incidentEpisodeId = event.id;
        timeline.incidentStateId = stateId;

        await IncidentEpisodeStateTimelineService.create({
          data: timeline,
          props: props,
        });
        return;
      }
      case WorkspaceEventType.AlertEpisode: {
        const timeline: AlertEpisodeStateTimeline =
          new AlertEpisodeStateTimeline();
        timeline.projectId = projectId;
        timeline.alertEpisodeId = event.id;
        timeline.alertStateId = stateId;

        await AlertEpisodeStateTimelineService.create({
          data: timeline,
          props: props,
        });
        return;
      }
      case WorkspaceEventType.ScheduledMaintenance: {
        const timeline: ScheduledMaintenanceStateTimeline =
          new ScheduledMaintenanceStateTimeline();
        timeline.projectId = projectId;
        timeline.scheduledMaintenanceId = event.id;
        timeline.scheduledMaintenanceStateId = stateId;

        await ScheduledMaintenanceStateTimelineService.create({
          data: timeline,
          props: props,
        });
        return;
      }
    }
  }
}
