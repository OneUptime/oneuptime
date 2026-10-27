import { StateListType } from "Common/Utils/StateOrder";

/*
 * What the settings pages for a project's states, severities, monitor
 * statuses, postmortem statuses and security case statuses and priorities
 * say: Incident States, Alert States, Scheduled Maintenance States, Monitor
 * Statuses, Incident Severities, Alert Severities, Postmortem Statuses, Case
 * Statuses and Case Priorities.
 *
 * Each page is one drag-ordered list, and its order means something
 * (Common/Utils/StateOrder): incidents only ever move down their states,
 * monitors shown together take the worst status, severities are ranked. So
 * each card says what its order means in a sentence, the state pages show
 * what an incident (alert, event) in each state counts as, and the built-in
 * rows say what OneUptime does with them.
 *
 * Kept in one React-free module so the pages render these exact strings, and
 * App/Tests/Dashboard/StateSettingsI18n checks that each has an entry in all
 * seventeen Dashboard locale files - the dashboard translates a string by
 * looking up its English text, so a string with no entry silently stays
 * English.
 */

export interface StateSettingsCountsAsCopy {
  // The column's title.
  title: string;
  // What the column means, in the (i) beside its title.
  tooltip: string;
  /*
   * What a row counts as, by the furthest built-in row it sits at or below
   * (getStateListReachedBuiltIn). `aboveAll` is for a row above every one.
   */
  aboveAll: string;
  byBuiltIn: Record<string, string>;
}

/*
 * A column that says what each built-in row is for, read off its own flag
 * rather than where it sits - the Case Priorities page's Detection
 * severity: which detection severity opens its cases at each built-in
 * priority. A row of the project's own reads `otherwise`, drawn muted, as an
 * empty value is.
 */
export interface StateSettingsBuiltInColumnCopy {
  title: string;
  tooltip: string;
  byBuiltIn: Record<string, string>;
  otherwise: string;
}

export interface StateSettingsPageCopy {
  // The card's title and the sentence under it.
  title: string;
  description: string;
  // The state pages' "Counts as" column; the other pages have none.
  countsAs?: StateSettingsCountsAsCopy | undefined;
  // A column of what each built-in row is for (StateSettingsBuiltInColumnCopy).
  builtInColumn?: StateSettingsBuiltInColumnCopy | undefined;
  // What each built-in row is, by its flag, in the Built-in tag's tooltip.
  builtInTooltips: Record<string, string>;
  // Why a built-in row's Delete is locked.
  deleteLockedReason?: string | undefined;
  // The create and edit form.
  namePlaceholder: string;
  descriptionPlaceholder: string;
  /*
   * What the form says under Name and Description, in the reader's
   * language. Every page says it in its own words: left to the model's
   * columns, the form said "Any friendly name of this object", an API
   * reader's words, in English in every language.
   */
  nameDescription: string;
  descriptionDescription: string;
}

export const StateSettingsSharedCopy: {
  nameColumnTitle: string;
  descriptionColumnTitle: string;
  builtInTag: string;
  nameFieldTitle: string;
  descriptionFieldTitle: string;
  colorFieldTitle: string;
  colorFieldDescription: string;
  colorFieldPlaceholder: string;
} = {
  nameColumnTitle: "Name",
  descriptionColumnTitle: "Description",
  builtInTag: "Built-in",
  nameFieldTitle: "Name",
  descriptionFieldTitle: "Description",
  colorFieldTitle: "Color",
  colorFieldDescription:
    "Shown as a dot before the name, wherever this appears.",
  colorFieldPlaceholder: "Please select a color.",
};

const INCIDENT_COUNTS_AS: StateSettingsCountsAsCopy = {
  title: "Counts as",
  tooltip:
    "Where a state sits decides what an incident in it counts as. From the acknowledged state down, it counts as acknowledged and on-call stops paging. From the resolved state down, it counts as resolved.",
  aboveAll: "Not acknowledged",
  byBuiltIn: {
    isCreatedState: "Not acknowledged",
    isAcknowledgedState: "Acknowledged",
    isResolvedState: "Resolved",
  },
};

const ALERT_COUNTS_AS: StateSettingsCountsAsCopy = {
  title: "Counts as",
  tooltip:
    "Where a state sits decides what an alert in it counts as. From the acknowledged state down, it counts as acknowledged and on-call stops paging. From the resolved state down, it counts as resolved.",
  aboveAll: "Not acknowledged",
  byBuiltIn: {
    isCreatedState: "Not acknowledged",
    isAcknowledgedState: "Acknowledged",
    isResolvedState: "Resolved",
  },
};

export const STATE_SETTINGS_COPY: Record<StateListType, StateSettingsPageCopy> =
  {
    [StateListType.IncidentState]: {
      title: "Incident States",
      description:
        "Incidents only ever move down this list. Drag a state to change where it sits. A new state is added just above the resolved state.",
      countsAs: INCIDENT_COUNTS_AS,
      builtInTooltips: {
        isCreatedState:
          "New incidents start in this state. It can be renamed, but not deleted.",
        isAcknowledgedState:
          "Acknowledging an incident moves it to this state. It can be renamed, but not deleted.",
        isResolvedState:
          "Resolving an incident moves it to this state. It can be renamed, but not deleted.",
      },
      deleteLockedReason: "Built-in states can be renamed, but not deleted.",
      namePlaceholder: "Investigating",
      descriptionPlaceholder: "The team is looking into what happened.",
      nameDescription:
        "What the state is called, like Investigating or Monitoring.",
      descriptionDescription:
        "What the team is doing while an incident is in this state, in a sentence.",
    },
    [StateListType.AlertState]: {
      title: "Alert States",
      description:
        "Alerts only ever move down this list. Drag a state to change where it sits. A new state is added just above the resolved state.",
      countsAs: ALERT_COUNTS_AS,
      builtInTooltips: {
        isCreatedState:
          "New alerts start in this state. It can be renamed, but not deleted.",
        isAcknowledgedState:
          "Acknowledging an alert moves it to this state. It can be renamed, but not deleted.",
        isResolvedState:
          "Resolving an alert moves it to this state. It can be renamed, but not deleted.",
      },
      deleteLockedReason: "Built-in states can be renamed, but not deleted.",
      namePlaceholder: "Investigating",
      descriptionPlaceholder: "The team is looking into what happened.",
      nameDescription:
        "What the state is called, like Investigating or Monitoring.",
      descriptionDescription:
        "What the team is doing while an alert is in this state, in a sentence.",
    },
    [StateListType.ScheduledMaintenanceState]: {
      title: "Scheduled Maintenance States",
      description:
        "Maintenance events only ever move down this list. Drag a state to change where it sits. A new state is added just above the completed state.",
      countsAs: {
        title: "Counts as",
        tooltip:
          "Where a state sits decides how an event in it shows on your status pages. From the ongoing state down, it shows as ongoing. From the ended state down, it shows as ended.",
        aboveAll: "Scheduled",
        byBuiltIn: {
          isScheduledState: "Scheduled",
          isOngoingState: "Ongoing",
          isEndedState: "Ended",
          isResolvedState: "Completed",
        },
      },
      builtInTooltips: {
        isScheduledState:
          "New maintenance events start in this state. It can be renamed, but not deleted.",
        isOngoingState:
          "An event moves to this state when its maintenance starts. It can be renamed, but not deleted.",
        isEndedState:
          "An event moves to this state when its maintenance ends. It can be renamed, but not deleted.",
        isResolvedState:
          "Completing an event moves it to this state. It can be renamed, but not deleted.",
      },
      deleteLockedReason: "Built-in states can be renamed, but not deleted.",
      namePlaceholder: "Verifying",
      descriptionPlaceholder:
        "The work is done and the team is checking that everything is back to normal.",
      nameDescription: "What the state is called, like Verifying or Delayed.",
      descriptionDescription:
        "What is happening while an event is in this state, in a sentence.",
    },
    [StateListType.MonitorStatus]: {
      title: "Monitor Statuses",
      description:
        "From healthiest to worst. Where monitors are shown together, as on a status page or in a monitor group, the status lowest in this list wins. Drag a status to change where it sits. A new status is added just above the offline status.",
      builtInTooltips: {
        isOperationalState:
          "New monitors start in this status. It can be renamed, but not deleted.",
        isOfflineState:
          "OneUptime treats a monitor in this status as down. It can be renamed, but not deleted.",
      },
      deleteLockedReason: "Built-in statuses can be renamed, but not deleted.",
      namePlaceholder: "Degraded",
      descriptionPlaceholder: "The monitor responds, but slowly.",
      nameDescription: "What the status is called, like Degraded or Down.",
      descriptionDescription:
        "How a monitor in this status behaves, in a sentence.",
    },
    [StateListType.IncidentSeverity]: {
      title: "Incident Severities",
      description:
        "Most severe first. Drag a severity to change its rank. Where OneUptime compares severities, such as for the severity of an episode, the one higher in this list wins.",
      builtInTooltips: {},
      namePlaceholder: "Critical",
      descriptionPlaceholder:
        "Customers cannot use the product. Respond immediately.",
      nameDescription: "What the severity is called, like Critical or SEV1.",
      descriptionDescription:
        "What an incident of this severity means, and how fast to respond.",
    },
    [StateListType.AlertSeverity]: {
      title: "Alert Severities",
      description:
        "Most severe first. Drag a severity to change its rank. Where OneUptime compares severities, such as for the severity of an episode, the one higher in this list wins.",
      builtInTooltips: {},
      namePlaceholder: "Critical",
      descriptionPlaceholder:
        "Customers cannot use the product. Respond immediately.",
      nameDescription: "What the severity is called, like Critical or SEV1.",
      descriptionDescription:
        "What an alert of this severity means, and how fast to respond.",
    },
    /*
     * A postmortem can move back up this list (reopened for another look),
     * so unlike the state pages it does not say it "only ever moves down":
     * its order says what each status counts as (Common/Utils/Incident/
     * PostmortemStatus).
     */
    [StateListType.IncidentPostmortemStatus]: {
      title: "Postmortem Statuses",
      description:
        "How far a postmortem has come. Drag a status to change where it sits. A new status is added just above the completed status, and a status below it counts as done.",
      countsAs: {
        title: "Counts as",
        tooltip:
          "Where a status sits decides what a postmortem in it counts as. From the draft status down, it is in progress. From the completed status down, it is done and no longer owed.",
        aboveAll: "Not started",
        byBuiltIn: {
          isNotStartedStatus: "Not started",
          isDraftStatus: "In progress",
          isCompletedStatus: "Done",
        },
      },
      builtInTooltips: {
        isNotStartedStatus:
          "A new incident's postmortem starts in this status. It can be renamed, but not deleted.",
        isDraftStatus:
          "Writing a postmortem moves it to this status. It can be renamed, but not deleted.",
        isCompletedStatus:
          "Publishing a postmortem on a status page moves it to this status. It can be renamed, but not deleted.",
      },
      deleteLockedReason: "Built-in statuses can be renamed, but not deleted.",
      namePlaceholder: "In Review",
      descriptionPlaceholder:
        "The postmortem is written and waiting for the team's review.",
      nameDescription: "What the status is called, like In Review or Approved.",
      descriptionDescription:
        "How far a postmortem in this status has come, in a sentence.",
    },
    /*
     * A security case can move back up (reopened), so like the postmortem
     * statuses its order says what each status counts as
     * (Common/Utils/SecurityCase/SecurityCaseStatuses).
     */
    [StateListType.SecurityCaseStatus]: {
      title: "Case Statuses",
      description:
        "How far a case has come. Drag a status to change where it sits. A new status is added just above the closed status, and a status below it counts as closed.",
      countsAs: {
        title: "Counts as",
        tooltip:
          "Where a status sits decides what a case in it counts as. From the acknowledged status down, someone is on it. From the contained status down, it is contained. From the closed status down, it is closed and carries a verdict.",
        aboveAll: "Not acknowledged",
        byBuiltIn: {
          isNewStatus: "Not acknowledged",
          isAcknowledgedStatus: "Acknowledged",
          isContainedStatus: "Contained",
          isClosedStatus: "Closed",
        },
      },
      builtInTooltips: {
        isNewStatus:
          "New cases start in this status. It can be renamed, but not deleted.",
        isAcknowledgedStatus:
          "Reopening a case moves it to this status. Reaching it records when the case was acknowledged. It can be renamed, but not deleted.",
        isContainedStatus:
          "Reaching this status records the time to contain. It can be renamed, but not deleted.",
        isClosedStatus:
          "Close Case moves a case to this status, with a verdict. It can be renamed, but not deleted.",
      },
      deleteLockedReason: "Built-in statuses can be renamed, but not deleted.",
      namePlaceholder: "Triage",
      descriptionPlaceholder:
        "Someone is checking whether the detection is real.",
      nameDescription:
        "What the status is called, like Investigating or Triage.",
      descriptionDescription:
        "What a case in this status is waiting for, in a sentence.",
    },
    /*
     * Ranked like severities, but with a built-in priority for each
     * detection severity, which keep their order
     * (Common/Utils/SecurityCase/SecurityCasePriorities).
     */
    [StateListType.SecurityCasePriority]: {
      title: "Case Priorities",
      description:
        "Most urgent first. Drag a priority to change its rank: playbooks and notifications that say at least High read this order. A new priority is added at the end.",
      builtInColumn: {
        title: "Detection severity",
        tooltip:
          "Detections of this severity open their cases at this priority, and a case rises when a more severe detection joins it. People and playbooks set the priorities you add.",
        byBuiltIn: {
          isCriticalPriority: "Critical",
          isHighPriority: "High",
          isMediumPriority: "Medium or unknown",
          isLowPriority: "Low",
          isInformationalPriority: "Informational",
        },
        otherwise: "None",
      },
      builtInTooltips: {
        isCriticalPriority:
          "Critical detections open their cases at this priority, and people hear about its cases at once. It can be renamed, but not deleted.",
        isHighPriority:
          "High detections open their cases at this priority. People hear about cases from here up, unless they choose otherwise. It can be renamed, but not deleted.",
        isMediumPriority:
          "Medium detections, and the cases people open, start at this priority. It can be renamed, but not deleted.",
        isLowPriority:
          "Low detections open their cases at this priority. It can be renamed, but not deleted.",
        isInformationalPriority:
          "Informational detections open their cases at this priority. It can be renamed, but not deleted.",
      },
      deleteLockedReason:
        "Built-in priorities can be renamed, but not deleted.",
      namePlaceholder: "Emergency",
      descriptionPlaceholder: "A confirmed breach. Page the team now.",
      nameDescription: "What the priority is called, like High or P1.",
      descriptionDescription:
        "How fast a case at this priority needs a person, in a sentence.",
    },
  };

/** Every string the nine pages show, for the locale checks. */
export const getStateSettingsStrings: () => Array<string> =
  (): Array<string> => {
    const strings: Set<string> = new Set(
      Object.values(StateSettingsSharedCopy),
    );

    for (const page of Object.values(STATE_SETTINGS_COPY)) {
      strings.add(page.title);
      strings.add(page.description);
      strings.add(page.namePlaceholder);
      strings.add(page.descriptionPlaceholder);
      strings.add(page.nameDescription);
      strings.add(page.descriptionDescription);

      if (page.deleteLockedReason) {
        strings.add(page.deleteLockedReason);
      }

      for (const tooltip of Object.values(page.builtInTooltips)) {
        strings.add(tooltip);
      }

      if (page.countsAs) {
        strings.add(page.countsAs.title);
        strings.add(page.countsAs.tooltip);
        strings.add(page.countsAs.aboveAll);

        for (const label of Object.values(page.countsAs.byBuiltIn)) {
          strings.add(label);
        }
      }

      if (page.builtInColumn) {
        strings.add(page.builtInColumn.title);
        strings.add(page.builtInColumn.tooltip);
        strings.add(page.builtInColumn.otherwise);

        for (const label of Object.values(page.builtInColumn.byBuiltIn)) {
          strings.add(label);
        }
      }
    }

    return Array.from(strings);
  };
