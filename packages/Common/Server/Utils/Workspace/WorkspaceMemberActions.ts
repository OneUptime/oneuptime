import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
import ResolvedStateUtil, {
  ResolvedStateList,
} from "../../../Utils/ResolvedState";
import ScheduledMaintenanceStartUtil from "../../../Utils/ScheduledMaintenanceStart";
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
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization, {
  WorkspaceActionResource,
} from "./WorkspaceActionAuthorization";

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
 * included - is told to them. A press reads it once. The check that the
 * member may act (authorize) reads it with what the actions and the chats'
 * own answers need, and hands it on as a WorkspaceEventRecord; an action
 * given one reads nothing of it again, and one given only the record's id
 * (OneUptime AI's tools) reads it itself.
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

/*
 * The record a button acts on, as its member read it: in their project,
 * under their labels, owners and blocks. Handed from the read that checked
 * the member may act on it to the chat's own answer and to the write.
 */
export interface WorkspaceEventRecord extends WorkspaceEvent {
  projectId: ObjectID;
  currentStateId: ObjectID | undefined;
  // Its number, for the chats' own sentences: 42, and "INC-42" with a prefix.
  number: number | null;
  numberWithPrefix: string | null;
}

/*
 * Where a record stands, for a chat's own answer to a button that comes too
 * late. An incident, an alert or an episode is acknowledged in the
 * project's acknowledged state or any state after it, resolved included
 * (Common/Utils/AcknowledgedState), and resolved in its resolved state or
 * after it (Common/Utils/ResolvedState). A scheduled maintenance event has
 * started once it is ongoing or anything after it
 * (ScheduledMaintenanceStartUtil.hasStarted), and is complete in its
 * completed state or after it (ScheduledMaintenanceStartUtil.isComplete).
 * What does not apply to a kind is false.
 */
export interface WorkspaceEventStanding {
  isAcknowledged: boolean;
  isResolved: boolean;
  hasStarted: boolean;
  isComplete: boolean;
}

// A state a chat's change-state form offers.
export interface WorkspaceEventStateOption {
  id: ObjectID;
  name: string;
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

/*
 * The records this class read as a member, each with whose read it was
 * ("<user>:<project>"). Only these are taken as read: a record built by
 * hand, or read for another member or in another project, is read again as
 * the member before anything is said or written about it (getEventRecord).
 */
const MEMBER_READS: WeakMap<WorkspaceEventRecord, string> = new WeakMap();

function readerOf(props: DatabaseCommonInteractionProps): string | null {
  if (!props.userId || !props.tenantId) {
    return null;
  }

  return `${props.userId.toString()}:${props.tenantId.toString()}`;
}

export default class WorkspaceMemberActions {
  public static getNoun(type: WorkspaceEventType): string {
    return EVENT_TYPES[type].noun;
  }

  /*
   * The record as a resource of WorkspaceActionAuthorization: the service
   * that reads it, and what the actions and the chats' answers need of it -
   * its state and its number - so the read that checks the member may act on
   * it is the only read of it.
   */
  public static getEventResource(
    event: WorkspaceEvent,
  ): WorkspaceActionResource {
    switch (event.type) {
      case WorkspaceEventType.Incident: {
        const select: Select<Incident> = {
          currentIncidentStateId: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        };

        return {
          service: IncidentService,
          id: event.id,
          select: select as Select<DatabaseBaseModel>,
        };
      }
      case WorkspaceEventType.Alert: {
        const select: Select<Alert> = {
          currentAlertStateId: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
        };

        return {
          service: AlertService,
          id: event.id,
          select: select as Select<DatabaseBaseModel>,
        };
      }
      case WorkspaceEventType.IncidentEpisode: {
        const select: Select<IncidentEpisode> = {
          currentIncidentStateId: true,
          episodeNumber: true,
          episodeNumberWithPrefix: true,
        };

        return {
          service: IncidentEpisodeService,
          id: event.id,
          select: select as Select<DatabaseBaseModel>,
        };
      }
      case WorkspaceEventType.AlertEpisode: {
        const select: Select<AlertEpisode> = {
          currentAlertStateId: true,
          episodeNumber: true,
          episodeNumberWithPrefix: true,
        };

        return {
          service: AlertEpisodeService,
          id: event.id,
          select: select as Select<DatabaseBaseModel>,
        };
      }
      case WorkspaceEventType.ScheduledMaintenance: {
        const select: Select<ScheduledMaintenance> = {
          currentScheduledMaintenanceStateId: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        };

        return {
          service: ScheduledMaintenanceService,
          id: event.id,
          select: select as Select<DatabaseBaseModel>,
        };
      }
    }
  }

  /*
   * Whether the member may make a `modelType` row for the record - the row
   * the button writes - and read the record and every other record the
   * action names (`resources`): WorkspaceActionAuthorization's check, with
   * its refusals, written for them. Hands back the record as that check read
   * it, for the chat's own answer and for the write, so the press reads it
   * once.
   */
  @CaptureSpan()
  public static async authorize(data: {
    props: DatabaseCommonInteractionProps;
    modelType: DatabaseBaseModelType;
    action: string;
    event: WorkspaceEvent;
    resources?: Array<WorkspaceActionResource> | undefined;
  }): Promise<WorkspaceEventRecord> {
    const records: Array<DatabaseBaseModel> =
      await WorkspaceActionAuthorization.assertCanCreateAndRead({
        props: data.props,
        modelType: data.modelType,
        action: data.action,
        resources: [
          this.getEventResource(data.event),
          ...(data.resources || []),
        ],
      });

    return this.asMemberRead({
      event: data.event,
      props: data.props,
      record: records[0]!,
    });
  }

  /*
   * The record read as the member - in their project, under their labels,
   * owners and blocks - with `select`'s columns as well as those the actions
   * need, for a chat that shows it before acting on it: one read for both.
   * Null for a record they may not read, as for one that is not there.
   */
  @CaptureSpan()
  public static async findEventForMember<
    TBaseModel extends DatabaseBaseModel,
  >(data: {
    event: WorkspaceEvent;
    props: DatabaseCommonInteractionProps;
    select: Select<TBaseModel>;
  }): Promise<{ record: TBaseModel; event: WorkspaceEventRecord } | null> {
    const record: DatabaseBaseModel | null = await this.findAsMember({
      event: data.event,
      props: data.props,
      select: data.select as Select<DatabaseBaseModel>,
    });

    if (!record) {
      return null;
    }

    return {
      record: record as TBaseModel,
      event: this.asMemberRead({
        event: data.event,
        props: data.props,
        record: record,
      }),
    };
  }

  /*
   * The record as the member's read gave it, remembered as theirs, so the
   * actions take it without reading it again (getEventRecord).
   */
  private static asMemberRead(data: {
    event: WorkspaceEvent;
    props: DatabaseCommonInteractionProps;
    record: DatabaseBaseModel;
  }): WorkspaceEventRecord {
    const reader: string | null = readerOf(data.props);

    if (!reader) {
      throw new NotAuthorizedException(
        `You do not have permission to change this ${this.getNoun(data.event.type)}.`,
      );
    }

    // Frozen: what is taken as read stays what was read.
    const event: WorkspaceEventRecord = Object.freeze(
      this.toEventRecord({
        event: data.event,
        projectId: data.props.tenantId!,
        record: data.record,
      }),
    );

    MEMBER_READS.set(event, reader);

    return event;
  }

  /*
   * The record as read with getEventResource's columns, in `projectId` - the
   * member's project, which the read was held to.
   */
  private static toEventRecord(data: {
    event: WorkspaceEvent;
    projectId: ObjectID;
    record: DatabaseBaseModel;
  }): WorkspaceEventRecord {
    const read: (
      currentStateId: ObjectID | undefined,
      number: number | undefined,
      numberWithPrefix: string | undefined,
    ) => WorkspaceEventRecord = (
      currentStateId: ObjectID | undefined,
      number: number | undefined,
      numberWithPrefix: string | undefined,
    ): WorkspaceEventRecord => {
      return {
        type: data.event.type,
        id: data.event.id,
        projectId: data.projectId,
        currentStateId: currentStateId,
        number: number ? Number(number) : null,
        numberWithPrefix: numberWithPrefix || null,
      };
    };

    switch (data.event.type) {
      case WorkspaceEventType.Incident: {
        const incident: Incident = data.record as Incident;

        return read(
          incident.currentIncidentStateId,
          incident.incidentNumber,
          incident.incidentNumberWithPrefix,
        );
      }
      case WorkspaceEventType.Alert: {
        const alert: Alert = data.record as Alert;

        return read(
          alert.currentAlertStateId,
          alert.alertNumber,
          alert.alertNumberWithPrefix,
        );
      }
      case WorkspaceEventType.IncidentEpisode: {
        const episode: IncidentEpisode = data.record as IncidentEpisode;

        return read(
          episode.currentIncidentStateId,
          episode.episodeNumber,
          episode.episodeNumberWithPrefix,
        );
      }
      case WorkspaceEventType.AlertEpisode: {
        const episode: AlertEpisode = data.record as AlertEpisode;

        return read(
          episode.currentAlertStateId,
          episode.episodeNumber,
          episode.episodeNumberWithPrefix,
        );
      }
      case WorkspaceEventType.ScheduledMaintenance: {
        const scheduledMaintenance: ScheduledMaintenance =
          data.record as ScheduledMaintenance;

        return read(
          scheduledMaintenance.currentScheduledMaintenanceStateId,
          scheduledMaintenance.scheduledMaintenanceNumber,
          scheduledMaintenance.scheduledMaintenanceNumberWithPrefix,
        );
      }
    }
  }

  /*
   * Where the record stands, from the record as its member read it and the
   * project's states, read as OneUptime as the moves read them - the record
   * itself is not read again.
   */
  @CaptureSpan()
  public static async getStanding(
    event: WorkspaceEventRecord,
  ): Promise<WorkspaceEventStanding> {
    return this.getStandingAmong({
      event: event,
      states: await this.getProjectStates({
        type: event.type,
        projectId: event.projectId,
      }),
    });
  }

  /*
   * Moves the record into `stateId`, as the member: the state timeline row
   * the dashboard's state panel creates for the same change, so it is
   * refused where the dashboard's would be. Every timeline service refuses a
   * state of another project and the state the record is in already; those
   * of incidents, alerts and scheduled maintenance events also refuse a move
   * up the project's list of states, while an episode's takes any other
   * state, from chat as from the dashboard.
   */
  @CaptureSpan()
  public static async changeState(data: {
    event: WorkspaceEvent | WorkspaceEventRecord;
    stateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const event: WorkspaceEventRecord = await this.getEventRecord({
      event: data.event,
      props: data.props,
    });

    await this.createStateChange({
      event: event,
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
    event: WorkspaceEvent | WorkspaceEventRecord;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const definition: EventTypeDefinition = EVENT_TYPES[data.event.type];

    if (!definition.stateList) {
      throw new BadDataException(
        `A ${definition.noun} cannot be acknowledged.`,
      );
    }

    const event: WorkspaceEventRecord = await this.getEventRecord({
      event: data.event,
      props: data.props,
    });

    const states: Array<ProjectState> = await this.getProjectStates({
      type: event.type,
      projectId: event.projectId,
    });

    const refusal: string | null = AcknowledgedStateUtil.getAcknowledgeRefusal({
      list: definition.stateList,
      states: states,
      stateId: event.currentStateId,
      subject: definition.subject,
    });

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
      event: event,
      stateId: acknowledgedState.id,
      props: data.props,
    });
  }

  /*
   * Resolve, as the member: a move into the project's resolved state - the
   * first from the top flagged resolved (Common/Utils/ResolvedState) -
   * refused for a record resolved already. For a scheduled maintenance
   * event, Mark as Complete: a move into its completed state, refused for an
   * event complete already.
   */
  @CaptureSpan()
  public static async resolve(data: {
    event: WorkspaceEvent | WorkspaceEventRecord;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const definition: EventTypeDefinition = EVENT_TYPES[data.event.type];

    const event: WorkspaceEventRecord = await this.getEventRecord({
      event: data.event,
      props: data.props,
    });

    const states: Array<ProjectState> = await this.getProjectStates({
      type: event.type,
      projectId: event.projectId,
    });

    if (event.type === WorkspaceEventType.ScheduledMaintenance) {
      const completedState: ScheduledMaintenanceState | null =
        ScheduledMaintenanceStartUtil.getCompletedState({
          states: states as Array<ScheduledMaintenanceState>,
        });

      if (!completedState || !completedState.id) {
        throw new BadDataException(
          "Completed ScheduledMaintenance State not found for this project",
        );
      }

      if (this.getStandingAmong({ event: event, states: states }).isComplete) {
        throw new BadDataException(
          `${definition.subject} is already complete.`,
        );
      }

      await this.createStateChange({
        event: event,
        stateId: completedState.id,
        props: data.props,
      });

      return;
    }

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
      event: event,
      stateId: resolvedState.id,
      props: data.props,
    });
  }

  /*
   * Mark as Ongoing, as the member: a move into the project's ongoing state
   * (ScheduledMaintenanceStartUtil), refused for an event that has started
   * already - in its ongoing state or any state after it - with what it is:
   * complete, or ongoing.
   */
  @CaptureSpan()
  public static async markScheduledMaintenanceAsOngoing(data: {
    event: WorkspaceEvent | WorkspaceEventRecord;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.event.type !== WorkspaceEventType.ScheduledMaintenance) {
      throw new BadDataException(
        `Only a scheduled maintenance event can be marked as ongoing, not this ${this.getNoun(data.event.type)}.`,
      );
    }

    const event: WorkspaceEventRecord = await this.getEventRecord({
      event: data.event,
      props: data.props,
    });

    const states: Array<ProjectState> = await this.getProjectStates({
      type: event.type,
      projectId: event.projectId,
    });

    const standing: WorkspaceEventStanding = this.getStandingAmong({
      event: event,
      states: states,
    });

    if (standing.hasStarted) {
      // Started already: say whether it is over, too.
      throw new BadDataException(
        standing.isComplete
          ? "Scheduled maintenance event is already complete."
          : "Scheduled maintenance event is already ongoing.",
      );
    }

    const ongoingState: ScheduledMaintenanceState | null =
      ScheduledMaintenanceStartUtil.getOngoingState({
        states: states as Array<ScheduledMaintenanceState>,
      });

    if (!ongoingState || !ongoingState.id) {
      throw new BadDataException(
        "Ongoing ScheduledMaintenance State not found for this project",
      );
    }

    await this.createStateChange({
      event: event,
      stateId: ongoingState.id,
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
    event: WorkspaceEvent | WorkspaceEventRecord;
    onCallDutyPolicyId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const event: WorkspaceEventRecord = await this.getEventRecord({
      event: data.event,
      props: data.props,
    });

    const executionLog: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    executionLog.projectId = event.projectId;
    executionLog.onCallDutyPolicyId = data.onCallDutyPolicyId;

    switch (event.type) {
      case WorkspaceEventType.Incident:
        executionLog.triggeredByIncidentId = event.id;
        executionLog.userNotificationEventType =
          UserNotificationEventType.IncidentCreated;
        break;
      case WorkspaceEventType.Alert:
        executionLog.triggeredByAlertId = event.id;
        executionLog.userNotificationEventType =
          UserNotificationEventType.AlertCreated;
        break;
      case WorkspaceEventType.IncidentEpisode:
        executionLog.triggeredByIncidentEpisodeId = event.id;
        executionLog.userNotificationEventType =
          UserNotificationEventType.IncidentEpisodeCreated;
        break;
      case WorkspaceEventType.AlertEpisode:
        executionLog.triggeredByAlertEpisodeId = event.id;
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
   * The record as its member reads it: the one handed in when this class
   * read it for this member in this project (authorize,
   * findEventForMember), or read here - for a record handed in by id, built
   * by hand, or read for someone else.
   */
  private static async getEventRecord(data: {
    event: WorkspaceEvent | WorkspaceEventRecord;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceEventRecord> {
    const event: WorkspaceEvent | WorkspaceEventRecord = data.event;
    const reader: string | null = readerOf(data.props);

    if (reader && MEMBER_READS.get(event as WorkspaceEventRecord) === reader) {
      return event as WorkspaceEventRecord;
    }

    return await this.readEvent({
      event: { type: event.type, id: event.id },
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
  }): Promise<WorkspaceEventRecord> {
    const record: DatabaseBaseModel | null = await this.findAsMember({
      event: data.event,
      props: data.props,
    });

    if (!record) {
      throw new NotAuthorizedException(
        `The ${this.getNoun(data.event.type)} ${WorkspaceActionAuthorization.NOT_FOUND_OR_NOT_READABLE}`,
      );
    }

    return this.asMemberRead({
      event: data.event,
      props: data.props,
      record: record,
    });
  }

  /*
   * The member's read of the record, with getEventResource's columns and
   * `select`'s: in their project, with their props. Null for a record they
   * may not read, as for one that is not there.
   */
  private static async findAsMember(data: {
    event: WorkspaceEvent;
    props: DatabaseCommonInteractionProps;
    select?: Select<DatabaseBaseModel> | undefined;
  }): Promise<DatabaseBaseModel | null> {
    const projectId: ObjectID | undefined = data.props.tenantId;

    if (!data.props.userId || !projectId) {
      throw new NotAuthorizedException(
        `You do not have permission to change this ${this.getNoun(data.event.type)}.`,
      );
    }

    const resource: WorkspaceActionResource = this.getEventResource(data.event);

    try {
      return await resource.service.findOneBy({
        query: {
          _id: data.event.id.toString(),
          projectId: projectId,
        } as Query<DatabaseBaseModel>,
        select: {
          ...(data.select || {}),
          ...(resource.select || {}),
          _id: true,
        } as Select<DatabaseBaseModel>,
        props: data.props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }
    }

    return null;
  }

  // Where the record stands among the project's states (getStanding).
  private static getStandingAmong(data: {
    event: WorkspaceEventRecord;
    states: Array<ProjectState>;
  }): WorkspaceEventStanding {
    const { event, states } = data;
    const stateList: ResolvedStateList | null =
      EVENT_TYPES[event.type].stateList;

    if (!stateList) {
      const maintenanceStates: Array<ScheduledMaintenanceState> =
        states as Array<ScheduledMaintenanceState>;

      return {
        isAcknowledged: false,
        isResolved: false,
        hasStarted: ScheduledMaintenanceStartUtil.hasStarted({
          states: maintenanceStates,
          state: maintenanceStates.find(
            (state: ScheduledMaintenanceState): boolean => {
              return (
                Boolean(event.currentStateId) &&
                state.id?.toString() === event.currentStateId!.toString()
              );
            },
          ),
        }),
        isComplete: ScheduledMaintenanceStartUtil.isComplete({
          states: maintenanceStates,
          state: { _id: event.currentStateId },
        }),
      };
    }

    return {
      isAcknowledged: AcknowledgedStateUtil.isAcknowledged({
        list: stateList,
        states: states,
        stateId: event.currentStateId,
      }),
      isResolved: ResolvedStateUtil.isResolved({
        list: stateList,
        states: states,
        stateId: event.currentStateId,
      }),
      hasStarted: false,
      isComplete: false,
    };
  }

  /*
   * The project's states of the record's kind, as OneUptime reads them:
   * where Acknowledge, Resolve and the maintenance moves take a record is
   * the project's rule, not the member's pick. The state the move names is
   * still held to the member's read, by the create.
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
    event: WorkspaceEventRecord;
    stateId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const { event, stateId, props } = data;
    const projectId: ObjectID = event.projectId;

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
