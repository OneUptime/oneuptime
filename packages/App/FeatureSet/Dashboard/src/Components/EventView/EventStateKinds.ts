import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import { PluralTemplate, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { StateMoveList } from "Common/Utils/StateMove";
import { StateListType } from "Common/Utils/StateOrder";
import { BulkStateChangeNoteType } from "../../Utils/BulkStateChange";

/*
 * THE FIVE KINDS OF RECORD THAT WALK DOWN A LIST OF STATES, FOR THEIR LISTS.
 *
 * Incidents, alerts, incident and alert episodes and scheduled maintenance
 * events move from state to state by a new row of their state timeline
 * (Common/Utils/StateMove). Their lists move them the way their own pages
 * do - Acknowledge, Resolve, "Mark as Ongoing", Change State - in each row's
 * ⋯ menu and in Bulk Actions (useEventStateActions), and each kind's entry
 * here says what is different about it: which timeline, which note the
 * change can post and who may post it, whether it reaches a status page's
 * subscribers, and the words of its dialogs - the record page's own for one
 * row, the list's for a selection.
 */

export enum EventStateKind {
  Incident = "Incident",
  Alert = "Alert",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

/*
 * The moves a list offers by name, beside Change State: an incident's,
 * an alert's or an episode's Acknowledge and Resolve; a scheduled
 * maintenance event's Mark as Ongoing (Start) and Mark as Ended (End).
 */
export enum EventStateQuickMove {
  Acknowledge = "Acknowledge",
  Resolve = "Resolve",
  Start = "Start",
  End = "End",
}

export interface EventStateQuickMoveWords {
  /*
   * One row's dialog, in the record page's words ("Acknowledge Incident",
   * "This records an acknowledgement on the incident timeline and stops
   * any on-call escalation for this incident."). A template with {{state}}
   * names the project's own state ("Mark Scheduled Maintenance as
   * {{state}}").
   */
  rowTitle: string;
  rowDescription: string;
}

export interface EventStateKindDefinition {
  kind: EventStateKind;
  eventModelType: { new (): BaseModel };
  timelineModelType: { new (): BaseModel };
  noteTemplateModelType: { new (): BaseModel };
  /*
   * The note a change posts, as its model: offered only to someone who may
   * create one (StateChangeFormFields). An incident that is private posts
   * its note as a private one (privateNoteModelType).
   */
  noteModelType: { new (): BaseModel };
  privateNoteModelType?: { new (): BaseModel } | undefined;
  // On the timeline: the record's id and the state's id.
  eventIdField: string;
  stateIdField: string;
  // On the record: its current state.
  currentStateColumn: string;
  stateList: StateMoveList;
  noteType: BulkStateChangeNoteType;
  // Whether a change can tell status page subscribers (incidents, maintenance).
  notifiesSubscribers: boolean;
  /*
   * An incident can be private: it takes no public notes and reaches no
   * subscriber (Common/Types/StatusPage/PrivateRecordPublicNotes), so its
   * change is built per incident (buildIncidentBulkStateChange).
   */
  hasPerEventPrivacy: boolean;
  quickMoves: Array<EventStateQuickMove>;
  quickMoveWords: Partial<Record<EventStateQuickMove, EventStateQuickMoveWords>>;
  words: {
    // The list's Change State dialog, as it always read.
    changeStateTitle: string;
    changeStateBulkDescription: string;
    bulkNoteTitle: string;
    bulkNoteDescription: string;
    // The note's line in one row's dialog: the record page's words.
    rowNoteDescription: string;
    rowPrivateNoteDescription?: string | undefined;
    /*
     * Said after a bulk Acknowledge or Resolve's sentence, for a record
     * whose change moves others with it: an episode's incidents.
     */
    bulkMembersSentence?: string | undefined;
  };
}

// One row's Change State: "Pick the next state for Checkout API down."
export const ROW_CHANGE_STATE_DESCRIPTION: string = translationKey(
  "Pick the next state for {{name}}.",
);

// A selection's Acknowledge and Resolve, and a maintenance move.
export const BULK_QUICK_MOVE_TITLES: Record<EventStateQuickMove, PluralTemplate> =
  {
    [EventStateQuickMove.Acknowledge]: {
      one: "Acknowledge {{count}} {{itemName}}",
      other: "Acknowledge {{count}} {{itemsName}}",
    },
    [EventStateQuickMove.Resolve]: {
      one: "Resolve {{count}} {{itemName}}",
      other: "Resolve {{count}} {{itemsName}}",
    },
    [EventStateQuickMove.Start]: {
      one: "Mark {{count}} {{itemName}} as {{state}}",
      other: "Mark {{count}} {{itemsName}} as {{state}}",
    },
    [EventStateQuickMove.End]: {
      one: "Mark {{count}} {{itemName}} as {{state}}",
      other: "Mark {{count}} {{itemsName}} as {{state}}",
    },
  };

export const BULK_QUICK_MOVE_DESCRIPTIONS: Record<EventStateQuickMove, string> =
  {
    [EventStateQuickMove.Acknowledge]: translationKey(
      "Each selected {{itemName}} is acknowledged on its timeline, which stops its on-call escalation.",
    ),
    [EventStateQuickMove.Resolve]: translationKey(
      "Each selected {{itemName}} is marked as resolved on its timeline.",
    ),
    [EventStateQuickMove.Start]: translationKey(
      "Each selected {{itemName}} is marked as {{state}} on its timeline.",
    ),
    [EventStateQuickMove.End]: translationKey(
      "Each selected {{itemName}} is marked as {{state}} on its timeline.",
    ),
  };

// The menu items of a maintenance move: the record page's buttons.
export const MARK_AS_STATE: string = translationKey("Mark as {{state}}");

/*
 * Why a selected record was left alone: it is there already, or past it -
 * a record never moves back up its list (StateMove).
 */
export const ALREADY_ACKNOWLEDGED: string = translationKey(
  "Already acknowledged.",
);
export const ALREADY_RESOLVED: string = translationKey("Already resolved.");
export const ALREADY_AT_OR_PAST_STATE: string = translationKey(
  "Already at {{state}} or past it.",
);

export const QUICK_MOVE_RESULT_LABELS: Partial<
  Record<
    EventStateQuickMove,
    { succeeded: PluralTemplate; failed: PluralTemplate }
  >
> = {
  [EventStateQuickMove.Acknowledge]: {
    succeeded: {
      one: "{{count}} {{itemName}} acknowledged",
      other: "{{count}} {{itemsName}} acknowledged",
    },
    failed: {
      one: "{{count}} {{itemName}} not acknowledged",
      other: "{{count}} {{itemsName}} not acknowledged",
    },
  },
  [EventStateQuickMove.Resolve]: {
    succeeded: {
      one: "{{count}} {{itemName}} resolved",
      other: "{{count}} {{itemsName}} resolved",
    },
    failed: {
      one: "{{count}} {{itemName}} not resolved",
      other: "{{count}} {{itemsName}} not resolved",
    },
  },
};

export const EVENT_STATE_KINDS: Record<EventStateKind, EventStateKindDefinition> =
  {
    [EventStateKind.Incident]: {
      kind: EventStateKind.Incident,
      eventModelType: Incident,
      timelineModelType: IncidentStateTimeline,
      noteTemplateModelType: IncidentNoteTemplate,
      noteModelType: IncidentPublicNote,
      privateNoteModelType: IncidentInternalNote,
      eventIdField: "incidentId",
      stateIdField: "incidentStateId",
      currentStateColumn: "currentIncidentState",
      stateList: StateListType.IncidentState,
      noteType: BulkStateChangeNoteType.Public,
      notifiesSubscribers: true,
      hasPerEventPrivacy: true,
      quickMoves: [EventStateQuickMove.Acknowledge, EventStateQuickMove.Resolve],
      quickMoveWords: {
        [EventStateQuickMove.Acknowledge]: {
          rowTitle: translationKey("Acknowledge Incident"),
          rowDescription: translationKey(
            "This records an acknowledgement on the incident timeline and stops any on-call escalation for this incident.",
          ),
        },
        [EventStateQuickMove.Resolve]: {
          rowTitle: translationKey("Resolve Incident"),
          rowDescription: translationKey(
            "This marks the incident as resolved on the incident timeline.",
          ),
        },
      },
      words: {
        changeStateTitle: translationKey("Change Incident State"),
        changeStateBulkDescription: translationKey(
          "Select the state to change incidents to. Incidents already at or past the selected state will be skipped.",
        ),
        bulkNoteTitle: translationKey("Public Note"),
        bulkNoteDescription: translationKey(
          "Post a public note about this state change to the status page. The same note is added to every incident you selected, as a private note on private incidents.",
        ),
        rowNoteDescription: translationKey(
          "Post a public note about this state change to the status page.",
        ),
        rowPrivateNoteDescription: translationKey(
          "Post a private note about this state change.",
        ),
      },
    },
    [EventStateKind.Alert]: {
      kind: EventStateKind.Alert,
      eventModelType: Alert,
      timelineModelType: AlertStateTimeline,
      noteTemplateModelType: AlertNoteTemplate,
      noteModelType: AlertInternalNote,
      eventIdField: "alertId",
      stateIdField: "alertStateId",
      currentStateColumn: "currentAlertState",
      stateList: StateListType.AlertState,
      noteType: BulkStateChangeNoteType.Private,
      notifiesSubscribers: false,
      hasPerEventPrivacy: false,
      quickMoves: [EventStateQuickMove.Acknowledge, EventStateQuickMove.Resolve],
      quickMoveWords: {
        [EventStateQuickMove.Acknowledge]: {
          rowTitle: translationKey("Acknowledge Alert"),
          rowDescription: translationKey(
            "This records an acknowledgement on the alert timeline and stops any on-call escalation for this alert.",
          ),
        },
        [EventStateQuickMove.Resolve]: {
          rowTitle: translationKey("Resolve Alert"),
          rowDescription: translationKey(
            "This marks the alert as resolved on the alert timeline.",
          ),
        },
      },
      words: {
        changeStateTitle: translationKey("Change Alert State"),
        changeStateBulkDescription: translationKey(
          "Select the state to change alerts to. Alerts already at or past the selected state will be skipped.",
        ),
        bulkNoteTitle: translationKey("Private Note"),
        bulkNoteDescription: translationKey(
          "Add an optional private note about this state change. Only your team can see it, and the same note is added to every alert you selected.",
        ),
        rowNoteDescription: translationKey(
          "Add an optional private note about this state change. Only your team can see it.",
        ),
      },
    },
    [EventStateKind.IncidentEpisode]: {
      kind: EventStateKind.IncidentEpisode,
      eventModelType: IncidentEpisode,
      timelineModelType: IncidentEpisodeStateTimeline,
      noteTemplateModelType: IncidentNoteTemplate,
      noteModelType: IncidentEpisodeInternalNote,
      eventIdField: "incidentEpisodeId",
      stateIdField: "incidentStateId",
      currentStateColumn: "currentIncidentState",
      stateList: StateListType.IncidentState,
      noteType: BulkStateChangeNoteType.Private,
      notifiesSubscribers: false,
      hasPerEventPrivacy: false,
      quickMoves: [EventStateQuickMove.Acknowledge, EventStateQuickMove.Resolve],
      quickMoveWords: {
        [EventStateQuickMove.Acknowledge]: {
          rowTitle: translationKey("Acknowledge Episode"),
          rowDescription: translationKey(
            "This records an acknowledgement on the episode timeline and also updates all incidents in this episode. Any on-call escalation for the episode and its incidents stops.",
          ),
        },
        [EventStateQuickMove.Resolve]: {
          rowTitle: translationKey("Resolve Episode"),
          rowDescription: translationKey(
            "This marks the episode as resolved on the episode timeline and also updates all incidents in this episode.",
          ),
        },
      },
      words: {
        changeStateTitle: translationKey("Change Episode State"),
        changeStateBulkDescription: translationKey(
          "Select the state to change episodes to. Episodes already at or past the selected state will be skipped. Member incidents will also be updated.",
        ),
        bulkNoteTitle: translationKey("Private Note"),
        bulkNoteDescription: translationKey(
          "Add an optional private note about this state change. Only your team can see it, and the same note is added to every episode you selected.",
        ),
        rowNoteDescription: translationKey(
          "Post a private note about this state change.",
        ),
        bulkMembersSentence: translationKey(
          "The incidents in each episode are updated too.",
        ),
      },
    },
    [EventStateKind.AlertEpisode]: {
      kind: EventStateKind.AlertEpisode,
      eventModelType: AlertEpisode,
      timelineModelType: AlertEpisodeStateTimeline,
      noteTemplateModelType: AlertNoteTemplate,
      noteModelType: AlertEpisodeInternalNote,
      eventIdField: "alertEpisodeId",
      stateIdField: "alertStateId",
      currentStateColumn: "currentAlertState",
      stateList: StateListType.AlertState,
      noteType: BulkStateChangeNoteType.Private,
      notifiesSubscribers: false,
      hasPerEventPrivacy: false,
      quickMoves: [EventStateQuickMove.Acknowledge, EventStateQuickMove.Resolve],
      quickMoveWords: {
        [EventStateQuickMove.Acknowledge]: {
          rowTitle: translationKey("Acknowledge Episode"),
          rowDescription: translationKey(
            "This records an acknowledgement on the episode timeline and also updates all alerts in this episode. Any on-call escalation for the episode and its alerts stops.",
          ),
        },
        [EventStateQuickMove.Resolve]: {
          rowTitle: translationKey("Resolve Episode"),
          rowDescription: translationKey(
            "This marks the episode as resolved on the episode timeline and also updates all alerts in this episode.",
          ),
        },
      },
      words: {
        changeStateTitle: translationKey("Change Episode State"),
        changeStateBulkDescription: translationKey(
          "Select the state to change episodes to. Episodes already at or past the selected state will be skipped. Member alerts will also be updated.",
        ),
        bulkNoteTitle: translationKey("Private Note"),
        bulkNoteDescription: translationKey(
          "Add an optional private note about this state change. Only your team can see it, and the same note is added to every episode you selected.",
        ),
        rowNoteDescription: translationKey(
          "Post a private note about this state change.",
        ),
        bulkMembersSentence: translationKey(
          "The alerts in each episode are updated too.",
        ),
      },
    },
    [EventStateKind.ScheduledMaintenance]: {
      kind: EventStateKind.ScheduledMaintenance,
      eventModelType: ScheduledMaintenance,
      timelineModelType: ScheduledMaintenanceStateTimeline,
      noteTemplateModelType: ScheduledMaintenanceNoteTemplate,
      noteModelType: ScheduledMaintenancePublicNote,
      eventIdField: "scheduledMaintenanceId",
      stateIdField: "scheduledMaintenanceStateId",
      currentStateColumn: "currentScheduledMaintenanceState",
      stateList: StateListType.ScheduledMaintenanceState,
      noteType: BulkStateChangeNoteType.Public,
      notifiesSubscribers: true,
      hasPerEventPrivacy: false,
      quickMoves: [EventStateQuickMove.Start, EventStateQuickMove.End],
      quickMoveWords: {
        [EventStateQuickMove.Start]: {
          rowTitle: translationKey("Mark Scheduled Maintenance as {{state}}"),
          rowDescription: translationKey("This updates the event timeline."),
        },
        [EventStateQuickMove.End]: {
          rowTitle: translationKey("Mark Scheduled Maintenance as {{state}}"),
          rowDescription: translationKey("This updates the event timeline."),
        },
      },
      words: {
        changeStateTitle: translationKey("Change Scheduled Maintenance State"),
        changeStateBulkDescription: translationKey(
          "Select the state to change scheduled maintenance events to. Events already at or past the selected state will be skipped.",
        ),
        bulkNoteTitle: translationKey("Public Note"),
        bulkNoteDescription: translationKey(
          "Post a public note about this state change to the status page. The same note is added to every event you selected.",
        ),
        rowNoteDescription: translationKey(
          "Post a public note about this state change to the status page.",
        ),
      },
    },
  };
