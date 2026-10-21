import { StateListType } from "Common/Utils/StateOrder";

/*
 * What the six settings pages for a project's states, severities and monitor
 * statuses say: Incident States, Alert States, Scheduled Maintenance States,
 * Monitor Statuses, Incident Severities and Alert Severities.
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

export interface StateSettingsPageCopy {
  // The card's title and the sentence under it.
  title: string;
  description: string;
  // The state pages' "Counts as" column; the other pages have none.
  countsAs?: StateSettingsCountsAsCopy | undefined;
  // What each built-in row is, by its flag, in the Built-in tag's tooltip.
  builtInTooltips: Record<string, string>;
  // Why a built-in row's Delete is locked.
  deleteLockedReason?: string | undefined;
  // The create and edit form.
  namePlaceholder: string;
  descriptionPlaceholder: string;
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
    },
    [StateListType.IncidentSeverity]: {
      title: "Incident Severities",
      description:
        "Most severe first. Drag a severity to change its rank. Where OneUptime compares severities, such as for the severity of an episode, the one higher in this list wins.",
      builtInTooltips: {},
      namePlaceholder: "Critical",
      descriptionPlaceholder:
        "Customers cannot use the product. Respond immediately.",
    },
    [StateListType.AlertSeverity]: {
      title: "Alert Severities",
      description:
        "Most severe first. Drag a severity to change its rank. Where OneUptime compares severities, such as for the severity of an episode, the one higher in this list wins.",
      builtInTooltips: {},
      namePlaceholder: "Critical",
      descriptionPlaceholder:
        "Customers cannot use the product. Respond immediately.",
    },
  };

/** Every string the six pages show, for the locale checks. */
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
    }

    return Array.from(strings);
  };
