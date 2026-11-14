import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  UsedByGroup,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRow,
  UsedByRowKind,
  getUsedByGroupTotal,
} from "Common/Types/UsedBy/UsedBy";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * "USED BY" IN THE READER'S WORDS (Types/UsedBy/UsedBy, #6813).
 *
 * The server says what refers to a record as counts and rows; every word
 * the card, its list and the Delete and Archive dialogs show is looked up
 * here, whole, with the count set into it. Each relation has a short title
 * for the card's line ("Status pages") and a sentence for the dialogs that
 * says what deleting or archiving the record affects ("3 status pages show
 * this monitor.").
 */

export interface UsedByRelationWords {
  title: string;
  impact: PluralTemplate;
}

export const USED_BY_RELATION_WORDS: Readonly<
  Record<UsedByRelation, UsedByRelationWords>
> = {
  [UsedByRelation.MonitorStatusPages]: {
    title: translationKey("Status pages"),
    impact: {
      one: "{{count}} status page shows this monitor.",
      other: "{{count}} status pages show this monitor.",
    },
  },
  [UsedByRelation.MonitorGroups]: {
    title: translationKey("Monitor groups"),
    impact: {
      one: "This monitor is in {{count}} monitor group.",
      other: "This monitor is in {{count}} monitor groups.",
    },
  },
  [UsedByRelation.MonitorSlos]: {
    title: translationKey("SLOs"),
    impact: {
      one: "{{count}} SLO measures this monitor.",
      other: "{{count}} SLOs measure this monitor.",
    },
  },
  [UsedByRelation.MonitorScheduledMaintenance]: {
    title: translationKey("Maintenance coming up or in progress"),
    impact: {
      one: "{{count}} maintenance event coming up or in progress names this monitor.",
      other:
        "{{count}} maintenance events coming up or in progress name this monitor.",
    },
  },
  [UsedByRelation.MonitorDependents]: {
    title: translationKey("Monitors that depend on it"),
    impact: {
      one: "{{count}} monitor depends on this monitor: its alerts wait while this one is down.",
      other:
        "{{count}} monitors depend on this monitor: their alerts wait while this one is down.",
    },
  },
  [UsedByRelation.MonitorWorkflows]: {
    title: translationKey("Workflows"),
    impact: {
      one: "{{count}} workflow names this monitor.",
      other: "{{count}} workflows name this monitor.",
    },
  },
  [UsedByRelation.MonitorDashboards]: {
    title: translationKey("Dashboards"),
    impact: {
      one: "{{count}} dashboard names this monitor.",
      other: "{{count}} dashboards name this monitor.",
    },
  },
  [UsedByRelation.ScheduleOnCallPolicies]: {
    title: translationKey("On-call policies that page it"),
    impact: {
      one: "{{count}} on-call policy pages this schedule.",
      other: "{{count}} on-call policies page this schedule.",
    },
  },
  [UsedByRelation.ServiceMonitors]: {
    title: translationKey("Monitors watching it"),
    impact: {
      one: "{{count}} monitor watches this service.",
      other: "{{count}} monitors watch this service.",
    },
  },
  [UsedByRelation.ServiceSlos]: {
    title: translationKey("SLOs measuring its monitors"),
    impact: {
      one: "{{count}} SLO measures a monitor of this service.",
      other: "{{count}} SLOs measure monitors of this service.",
    },
  },
  [UsedByRelation.StatusPageOpenIncidents]: {
    title: translationKey("Open incidents"),
    impact: {
      one: "Visitors see {{count}} open incident on this status page.",
      other: "Visitors see {{count}} open incidents on this status page.",
    },
  },
  [UsedByRelation.StatusPageMaintenance]: {
    title: translationKey("Maintenance coming up or in progress"),
    impact: {
      one: "Visitors see {{count}} maintenance event coming up or in progress on this status page.",
      other:
        "Visitors see {{count}} maintenance events coming up or in progress on this status page.",
    },
  },
  [UsedByRelation.TeamOnCallPolicies]: {
    title: translationKey("On-call policies that page it"),
    impact: {
      one: "{{count}} on-call policy pages this team.",
      other: "{{count}} on-call policies page this team.",
    },
  },
  [UsedByRelation.TeamOwnedMonitors]: {
    title: translationKey("Monitors it owns"),
    impact: {
      one: "This team owns {{count}} monitor.",
      other: "This team owns {{count}} monitors.",
    },
  },
  [UsedByRelation.TeamOwnedStatusPages]: {
    title: translationKey("Status pages it owns"),
    impact: {
      one: "This team owns {{count}} status page.",
      other: "This team owns {{count}} status pages.",
    },
  },
  [UsedByRelation.TeamOwnedServices]: {
    title: translationKey("Services it owns"),
    impact: {
      one: "This team owns {{count}} service.",
      other: "This team owns {{count}} services.",
    },
  },
  [UsedByRelation.TeamOwnedOnCallPolicies]: {
    title: translationKey("On-call policies it owns"),
    impact: {
      one: "This team owns {{count}} on-call policy.",
      other: "This team owns {{count}} on-call policies.",
    },
  },
  [UsedByRelation.TeamOwnedSchedules]: {
    title: translationKey("On-call schedules it owns"),
    impact: {
      one: "This team owns {{count}} on-call schedule.",
      other: "This team owns {{count}} on-call schedules.",
    },
  },
  [UsedByRelation.LabelMonitors]: {
    title: translationKey("Monitors"),
    impact: {
      one: "{{count}} monitor carries this label.",
      other: "{{count}} monitors carry this label.",
    },
  },
  [UsedByRelation.LabelMonitorGroups]: {
    title: translationKey("Monitor groups"),
    impact: {
      one: "{{count}} monitor group carries this label.",
      other: "{{count}} monitor groups carry this label.",
    },
  },
  [UsedByRelation.LabelStatusPages]: {
    title: translationKey("Status pages"),
    impact: {
      one: "{{count}} status page carries this label.",
      other: "{{count}} status pages carry this label.",
    },
  },
  [UsedByRelation.LabelServices]: {
    title: translationKey("Services"),
    impact: {
      one: "{{count}} service carries this label.",
      other: "{{count}} services carry this label.",
    },
  },
  [UsedByRelation.LabelIncidents]: {
    title: translationKey("Incidents"),
    impact: {
      one: "{{count}} incident carries this label.",
      other: "{{count}} incidents carry this label.",
    },
  },
  [UsedByRelation.LabelAlerts]: {
    title: translationKey("Alerts"),
    impact: {
      one: "{{count}} alert carries this label.",
      other: "{{count}} alerts carry this label.",
    },
  },
  [UsedByRelation.LabelScheduledMaintenance]: {
    title: translationKey("Scheduled maintenance"),
    impact: {
      one: "{{count}} scheduled maintenance event carries this label.",
      other: "{{count}} scheduled maintenance events carry this label.",
    },
  },
  [UsedByRelation.LabelOnCallPolicies]: {
    title: translationKey("On-call policies"),
    impact: {
      one: "{{count}} on-call policy carries this label.",
      other: "{{count}} on-call policies carry this label.",
    },
  },
  [UsedByRelation.LabelOnCallSchedules]: {
    title: translationKey("On-call schedules"),
    impact: {
      one: "{{count}} on-call schedule carries this label.",
      other: "{{count}} on-call schedules carry this label.",
    },
  },
  [UsedByRelation.LabelSlos]: {
    title: translationKey("SLOs"),
    impact: {
      one: "{{count}} SLO carries this label.",
      other: "{{count}} SLOs carry this label.",
    },
  },
  [UsedByRelation.LabelWorkflows]: {
    title: translationKey("Workflows"),
    impact: {
      one: "{{count}} workflow carries this label.",
      other: "{{count}} workflows carry this label.",
    },
  },
  [UsedByRelation.LabelDashboards]: {
    title: translationKey("Dashboards"),
    impact: {
      one: "{{count}} dashboard carries this label.",
      other: "{{count}} dashboards carry this label.",
    },
  },
};

/*
 * What a record's card says: its title and the line under it, and - when
 * nothing refers to it - what to do next, with the page it is done on.
 */
export interface UsedByCardWords {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyActionTitle?: string | undefined;
  emptyActionPage?: PageMap | undefined;
}

export const USED_BY_CARD_WORDS: Readonly<
  Record<UsedByRecordKind, UsedByCardWords>
> = {
  [UsedByRecordKind.Monitor]: {
    title: translationKey("Used by"),
    description: translationKey(
      "What refers to this monitor. Deleting or archiving it changes these.",
    ),
    emptyTitle: translationKey("Nothing uses this monitor yet"),
    emptyDescription: translationKey(
      "No status page, SLO, maintenance, workflow or other monitor refers to it. Add it to a status page so visitors see when it is down.",
    ),
    emptyActionTitle: translationKey("Go to status pages"),
    emptyActionPage: PageMap.STATUS_PAGES,
  },
  [UsedByRecordKind.OnCallSchedule]: {
    title: translationKey("Used by"),
    description: translationKey(
      "The on-call policies that page whoever is on call on this schedule.",
    ),
    emptyTitle: translationKey("Nothing uses this schedule yet"),
    emptyDescription: translationKey(
      "No on-call policy pages it, so nobody on it is paged. Add it to an on-call policy's escalation rule.",
    ),
    emptyActionTitle: translationKey("Go to on-call policies"),
    emptyActionPage: PageMap.ON_CALL_DUTY_POLICIES,
  },
  [UsedByRecordKind.Service]: {
    title: translationKey("Used by"),
    description: translationKey(
      "The monitors watching this service, and the SLOs that measure them.",
    ),
    emptyTitle: translationKey("No monitor watches this service yet"),
    emptyDescription: translationKey(
      "Link a monitor to it from the monitor's Linked Resources card, so the monitor's incidents and alerts are linked here too.",
    ),
    emptyActionTitle: translationKey("Go to monitors"),
    emptyActionPage: PageMap.MONITORS,
  },
  [UsedByRecordKind.StatusPage]: {
    title: translationKey("Showing now"),
    description: translationKey(
      "The open incidents and the maintenance coming up or in progress that visitors see on this page.",
    ),
    emptyTitle: translationKey("Nothing to tell visitors right now"),
    emptyDescription: translationKey(
      "No open incident and no maintenance coming up or in progress is shown on this status page.",
    ),
  },
  [UsedByRecordKind.Team]: {
    title: translationKey("Used by"),
    description: translationKey(
      "The on-call policies that page this team, and what it owns.",
    ),
    emptyTitle: translationKey("Nothing uses this team yet"),
    emptyDescription: translationKey(
      "No on-call policy pages it and it owns nothing. Page it from an on-call policy's escalation rule, or make it an owner of a monitor.",
    ),
    emptyActionTitle: translationKey("Go to on-call policies"),
    emptyActionPage: PageMap.ON_CALL_DUTY_POLICIES,
  },
  [UsedByRecordKind.Label]: {
    title: translationKey("Used by"),
    description: translationKey(
      "How many records of each kind carry this label.",
    ),
    emptyTitle: translationKey("Nothing carries this label yet"),
    emptyDescription: translationKey(
      "Add it to a monitor, a status page or another record from that record's Labels field.",
    ),
  },
};

// What a record is that nothing names: a row with no name.
export const UNNAMED_ROW: string = translationKey("Untitled");

// Rows the reader may not read, after some they may.
export const AND_HIDDEN_ROWS: PluralTemplate = {
  one: "and {{count}} you can't see",
  other: "and {{count}} you can't see",
};

// Rows the reader may not read, when they may read none.
export const ONLY_HIDDEN_ROWS: PluralTemplate = {
  one: "{{count}} you can't see",
  other: "{{count}} you can't see",
};

// Beside a dialog's sentence: how many of those the reader may not read.
export const HIDDEN_IN_IMPACT: PluralTemplate = {
  one: "({{count}} of them you can't see)",
  other: "({{count}} of them you can't see)",
};

export const SEE_ALL: string = translationKey("See all");

// A label's row action on Settings > Labels.
export const USED_BY_ACTION: string = translationKey("Used by");
export const SHOW_MORE: string = translationKey("Show more");

export const LOADING_USED_BY: string = translationKey("Loading what uses this");

// The server answered with something this page cannot read.
export const COULD_NOT_LOAD_USED_BY: string = translationKey(
  "The answer could not be read. Reload the page to get the latest version, then try again.",
);

// The card's and the dialog's error, with the server's own sentence.
export const COULD_NOT_LOAD_USED_BY_WITH_ERROR: string = translationKey(
  "Couldn't load what uses this. {{error}}",
);

export const TRY_AGAIN: string = translationKey("Try again");

export const BACK_TO_ALL: string = translationKey("Back to everything");

export const CLOSE: string = translationKey("Close");

// The heading of the dialogs' list.
export const STILL_IN_USE: string = translationKey("Still in use");

// What a Delete page says above the list.
export const STILL_IN_USE_DESCRIPTION: string = translationKey(
  "Deleting it changes these. Check them before you delete it.",
);

/*
 * A row's name as its own page shows it: its number first when it has one
 * ("INC-18 Checkout is down"), or "Untitled".
 */
export function getUsedByRowName(
  row: UsedByRow,
  translator: Translator,
): string {
  const name: string = row.name.trim();
  const number: string = (row.number || "").trim();

  if (number && name) {
    return `${number} ${name}`;
  }

  return name || number || translator.translateText(UNNAMED_ROW) || UNNAMED_ROW;
}

// The page a row opens.
const ROW_PAGES: Readonly<Record<UsedByRowKind, PageMap>> = {
  [UsedByRowKind.Monitor]: PageMap.MONITOR_VIEW,
  [UsedByRowKind.MonitorGroup]: PageMap.MONITOR_GROUP_VIEW,
  [UsedByRowKind.StatusPage]: PageMap.STATUS_PAGE_VIEW,
  [UsedByRowKind.ServiceLevelObjective]: PageMap.SLO_VIEW,
  [UsedByRowKind.ScheduledMaintenance]: PageMap.SCHEDULED_MAINTENANCE_VIEW,
  [UsedByRowKind.Workflow]: PageMap.WORKFLOW_VIEW,
  [UsedByRowKind.Dashboard]: PageMap.DASHBOARD_VIEW,
  [UsedByRowKind.OnCallDutyPolicy]: PageMap.ON_CALL_DUTY_POLICY_VIEW,
  [UsedByRowKind.OnCallSchedule]: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
  [UsedByRowKind.Service]: PageMap.SERVICE_VIEW,
  [UsedByRowKind.Incident]: PageMap.INCIDENT_VIEW,
  [UsedByRowKind.Alert]: PageMap.ALERT_VIEW,
};

export function getUsedByRowPage(rowKind: UsedByRowKind): PageMap {
  return ROW_PAGES[rowKind];
}

export function getUsedByRowRoute(
  rowKind: UsedByRowKind,
  rowId: string,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[getUsedByRowPage(rowKind)] as Route,
    { modelId: new ObjectID(rowId) },
  );
}

export function getUsedByRelationTitle(
  relation: UsedByRelation,
  translator: Translator,
): string {
  const title: string = USED_BY_RELATION_WORDS[relation].title;

  return translator.translateText(title) || title;
}

/*
 * What a group means for the record, with every record that refers to it
 * counted, seen or not: "3 status pages show this monitor."
 */
export function getUsedByImpactSentence(
  group: Pick<UsedByGroup, "relation" | "count" | "hiddenCount">,
  translator: Translator,
): string {
  return translator.translatePlural(
    USED_BY_RELATION_WORDS[group.relation].impact,
    getUsedByGroupTotal(group),
  );
}

/*
 * The rows the reader may not read, as the card says them under the ones
 * they may: "and 2 you can't see", or "2 you can't see" when that is all.
 * Empty when they may read them all.
 */
export function getUsedByHiddenNote(
  group: Pick<UsedByGroup, "count" | "hiddenCount">,
  translator: Translator,
): string {
  if (group.hiddenCount <= 0) {
    return "";
  }

  return translator.translatePlural(
    group.count > 0 ? AND_HIDDEN_ROWS : ONLY_HIDDEN_ROWS,
    group.hiddenCount,
  );
}

// Beside a dialog's sentence: "(2 of them you can't see)", or "".
export function getUsedByHiddenInImpact(
  group: Pick<UsedByGroup, "hiddenCount">,
  translator: Translator,
): string {
  if (group.hiddenCount <= 0) {
    return "";
  }

  return translator.translatePlural(HIDDEN_IN_IMPACT, group.hiddenCount);
}
