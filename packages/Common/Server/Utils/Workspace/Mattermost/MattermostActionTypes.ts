import SlackActionType from "../Slack/Actions/ActionTypes";

/*
 * THE BUTTONS A MATTERMOST MESSAGE CARRIES.
 *
 * OneUptime's messages are built once for every chat, with Slack's action
 * ids on their buttons (WorkspaceMessages): Microsoft Teams presses them
 * by the same ids, and so does Mattermost. Mattermost shows a button only
 * when OneUptime can act on its press there (MattermostActions), so these
 * lists are what a message shows in Mattermost: a button for each of
 * them, and in its menu each of the menu's actions that is one of them.
 * Every other button - a form Mattermost has no field for, a press that
 * only works in Slack - is left out, and the message's View link opens
 * the record in OneUptime for it.
 */

// What a press does at once: a state change, or a form opened.
export enum MattermostPress {
  Acknowledge = "Acknowledge",
  Resolve = "Resolve",
  MarkAsOngoing = "MarkAsOngoing",
  MarkAsComplete = "MarkAsComplete",
  OpenNoteForm = "OpenNoteForm",
  OpenStateForm = "OpenStateForm",
  OpenOnCallPolicyForm = "OpenOnCallPolicyForm",
  OpenSeverityForm = "OpenSeverityForm",
}

// What a form's submission does.
export enum MattermostSubmit {
  Note = "Note",
  State = "State",
  OnCallPolicy = "OnCallPolicy",
  Severity = "Severity",
}

// The records a button is about.
export enum MattermostRecordType {
  Incident = "Incident",
  Alert = "Alert",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

export interface MattermostPressSpec {
  recordType: MattermostRecordType;
  press: MattermostPress;
  // The form's submission, for a press that opens one.
  submitActionId?: string | undefined;
}

export interface MattermostSubmitSpec {
  recordType: MattermostRecordType;
  submit: MattermostSubmit;
}

export const MATTERMOST_PRESS_ACTIONS: Readonly<
  Record<string, MattermostPressSpec>
> = {
  // Incidents
  [SlackActionType.AcknowledgeIncident]: {
    recordType: MattermostRecordType.Incident,
    press: MattermostPress.Acknowledge,
  },
  [SlackActionType.ResolveIncident]: {
    recordType: MattermostRecordType.Incident,
    press: MattermostPress.Resolve,
  },
  [SlackActionType.ViewAddIncidentNote]: {
    recordType: MattermostRecordType.Incident,
    press: MattermostPress.OpenNoteForm,
    submitActionId: SlackActionType.SubmitIncidentNote,
  },
  [SlackActionType.ViewChangeIncidentState]: {
    recordType: MattermostRecordType.Incident,
    press: MattermostPress.OpenStateForm,
    submitActionId: SlackActionType.SubmitChangeIncidentState,
  },
  [SlackActionType.ViewExecuteIncidentOnCallPolicy]: {
    recordType: MattermostRecordType.Incident,
    press: MattermostPress.OpenOnCallPolicyForm,
    submitActionId: SlackActionType.SubmitExecuteIncidentOnCallPolicy,
  },
  [SlackActionType.ViewChangeIncidentSeverity]: {
    recordType: MattermostRecordType.Incident,
    press: MattermostPress.OpenSeverityForm,
    submitActionId: SlackActionType.SubmitChangeIncidentSeverity,
  },
  // Alerts
  [SlackActionType.AcknowledgeAlert]: {
    recordType: MattermostRecordType.Alert,
    press: MattermostPress.Acknowledge,
  },
  [SlackActionType.ResolveAlert]: {
    recordType: MattermostRecordType.Alert,
    press: MattermostPress.Resolve,
  },
  [SlackActionType.ViewAddAlertNote]: {
    recordType: MattermostRecordType.Alert,
    press: MattermostPress.OpenNoteForm,
    submitActionId: SlackActionType.SubmitAlertNote,
  },
  [SlackActionType.ViewChangeAlertState]: {
    recordType: MattermostRecordType.Alert,
    press: MattermostPress.OpenStateForm,
    submitActionId: SlackActionType.SubmitChangeAlertState,
  },
  [SlackActionType.ViewExecuteAlertOnCallPolicy]: {
    recordType: MattermostRecordType.Alert,
    press: MattermostPress.OpenOnCallPolicyForm,
    submitActionId: SlackActionType.SubmitExecuteAlertOnCallPolicy,
  },
  // Incident episodes
  [SlackActionType.AcknowledgeIncidentEpisode]: {
    recordType: MattermostRecordType.IncidentEpisode,
    press: MattermostPress.Acknowledge,
  },
  [SlackActionType.ResolveIncidentEpisode]: {
    recordType: MattermostRecordType.IncidentEpisode,
    press: MattermostPress.Resolve,
  },
  [SlackActionType.ViewAddIncidentEpisodeNote]: {
    recordType: MattermostRecordType.IncidentEpisode,
    press: MattermostPress.OpenNoteForm,
    submitActionId: SlackActionType.SubmitIncidentEpisodeNote,
  },
  [SlackActionType.ViewChangeIncidentEpisodeState]: {
    recordType: MattermostRecordType.IncidentEpisode,
    press: MattermostPress.OpenStateForm,
    submitActionId: SlackActionType.SubmitChangeIncidentEpisodeState,
  },
  [SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy]: {
    recordType: MattermostRecordType.IncidentEpisode,
    press: MattermostPress.OpenOnCallPolicyForm,
    submitActionId: SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
  },
  // Alert episodes
  [SlackActionType.AcknowledgeAlertEpisode]: {
    recordType: MattermostRecordType.AlertEpisode,
    press: MattermostPress.Acknowledge,
  },
  [SlackActionType.ResolveAlertEpisode]: {
    recordType: MattermostRecordType.AlertEpisode,
    press: MattermostPress.Resolve,
  },
  [SlackActionType.ViewAddAlertEpisodeNote]: {
    recordType: MattermostRecordType.AlertEpisode,
    press: MattermostPress.OpenNoteForm,
    submitActionId: SlackActionType.SubmitAlertEpisodeNote,
  },
  [SlackActionType.ViewChangeAlertEpisodeState]: {
    recordType: MattermostRecordType.AlertEpisode,
    press: MattermostPress.OpenStateForm,
    submitActionId: SlackActionType.SubmitChangeAlertEpisodeState,
  },
  [SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy]: {
    recordType: MattermostRecordType.AlertEpisode,
    press: MattermostPress.OpenOnCallPolicyForm,
    submitActionId: SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
  },
  // Scheduled maintenance
  [SlackActionType.MarkScheduledMaintenanceAsOngoing]: {
    recordType: MattermostRecordType.ScheduledMaintenance,
    press: MattermostPress.MarkAsOngoing,
  },
  [SlackActionType.MarkScheduledMaintenanceAsComplete]: {
    recordType: MattermostRecordType.ScheduledMaintenance,
    press: MattermostPress.MarkAsComplete,
  },
  [SlackActionType.ViewAddScheduledMaintenanceNote]: {
    recordType: MattermostRecordType.ScheduledMaintenance,
    press: MattermostPress.OpenNoteForm,
    submitActionId: SlackActionType.SubmitScheduledMaintenanceNote,
  },
  [SlackActionType.ViewChangeScheduledMaintenanceState]: {
    recordType: MattermostRecordType.ScheduledMaintenance,
    press: MattermostPress.OpenStateForm,
    submitActionId: SlackActionType.SubmitChangeScheduledMaintenanceState,
  },
};

// Each form's submission, by the action id its dialog is opened with.
export const MATTERMOST_SUBMIT_ACTIONS: Readonly<
  Record<string, MattermostSubmitSpec>
> = ((): Record<string, MattermostSubmitSpec> => {
  const submits: Record<string, MattermostSubmitSpec> = {};

  const submitOfPress: Partial<Record<MattermostPress, MattermostSubmit>> = {
    [MattermostPress.OpenNoteForm]: MattermostSubmit.Note,
    [MattermostPress.OpenStateForm]: MattermostSubmit.State,
    [MattermostPress.OpenOnCallPolicyForm]: MattermostSubmit.OnCallPolicy,
    [MattermostPress.OpenSeverityForm]: MattermostSubmit.Severity,
  };

  for (const spec of Object.values(MATTERMOST_PRESS_ACTIONS)) {
    const submit: MattermostSubmit | undefined = submitOfPress[spec.press];

    if (spec.submitActionId && submit) {
      submits[spec.submitActionId] = {
        recordType: spec.recordType,
        submit: submit,
      };
    }
  }

  return submits;
})();

// Whether a button or a menu item with this action id is shown in Mattermost.
export const isMattermostAction: (actionId: string) => boolean = (
  actionId: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(
    MATTERMOST_PRESS_ACTIONS,
    actionId,
  );
};
