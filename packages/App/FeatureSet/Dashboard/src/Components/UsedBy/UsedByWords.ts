import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  UsedByCounts,
  UsedByGroup,
  UsedByGroupPart,
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
 * this monitor."), and - for the kinds whose lists delete several at once -
 * one for a selection ("12 status pages show the selected monitors.").
 * A family's row says what kind of record it is by the model's own name.
 */

export interface UsedByRelationWords {
  title: string;
  impact: PluralTemplate;
  /*
   * What deleting or archiving several records of a list's selection
   * affects, counted for all of them ("12 status pages show the selected
   * monitors."): every relation a list's bulk Delete counts has one.
   */
  bulkImpact?: PluralTemplate | undefined;
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
    bulkImpact: {
      one: "{{count}} status page shows the selected monitors.",
      other: "{{count}} status pages show the selected monitors.",
    },
  },
  [UsedByRelation.MonitorGroups]: {
    title: translationKey("Monitor groups"),
    impact: {
      one: "This monitor is in {{count}} monitor group.",
      other: "This monitor is in {{count}} monitor groups.",
    },
    bulkImpact: {
      one: "The selected monitors are in {{count}} monitor group.",
      other: "The selected monitors are in {{count}} monitor groups.",
    },
  },
  [UsedByRelation.MonitorSlos]: {
    title: translationKey("SLOs"),
    impact: {
      one: "{{count}} SLO measures this monitor.",
      other: "{{count}} SLOs measure this monitor.",
    },
    bulkImpact: {
      one: "{{count}} SLO measures the selected monitors.",
      other: "{{count}} SLOs measure the selected monitors.",
    },
  },
  [UsedByRelation.MonitorScheduledMaintenance]: {
    title: translationKey("Maintenance coming up or in progress"),
    impact: {
      one: "{{count}} maintenance event coming up or in progress names this monitor.",
      other:
        "{{count}} maintenance events coming up or in progress name this monitor.",
    },
    bulkImpact: {
      one: "{{count}} maintenance event coming up or in progress names the selected monitors.",
      other:
        "{{count}} maintenance events coming up or in progress name the selected monitors.",
    },
  },
  [UsedByRelation.MonitorDependents]: {
    title: translationKey("Monitors that depend on it"),
    impact: {
      one: "{{count}} monitor depends on this monitor: its alerts wait while this one is down.",
      other:
        "{{count}} monitors depend on this monitor: their alerts wait while this one is down.",
    },
    bulkImpact: {
      one: "{{count}} monitor depends on the selected monitors: its alerts wait while they are down.",
      other:
        "{{count}} monitors depend on the selected monitors: their alerts wait while they are down.",
    },
  },
  [UsedByRelation.MonitorRules]: {
    title: translationKey("Rules that name it"),
    impact: {
      one: "{{count}} rule names this monitor.",
      other: "{{count}} rules name this monitor.",
    },
    bulkImpact: {
      one: "{{count}} rule names the selected monitors.",
      other: "{{count}} rules name the selected monitors.",
    },
  },
  [UsedByRelation.MonitorTemplates]: {
    title: translationKey("Templates that name it"),
    impact: {
      one: "{{count}} template names this monitor.",
      other: "{{count}} templates name this monitor.",
    },
    bulkImpact: {
      one: "{{count}} template names the selected monitors.",
      other: "{{count}} templates name the selected monitors.",
    },
  },
  [UsedByRelation.MonitorWorkflows]: {
    title: translationKey("Workflows"),
    impact: {
      one: "{{count}} workflow names this monitor.",
      other: "{{count}} workflows name this monitor.",
    },
    bulkImpact: {
      one: "{{count}} workflow names the selected monitors.",
      other: "{{count}} workflows name the selected monitors.",
    },
  },
  [UsedByRelation.MonitorDashboards]: {
    title: translationKey("Dashboards"),
    impact: {
      one: "{{count}} dashboard names this monitor.",
      other: "{{count}} dashboards name this monitor.",
    },
    bulkImpact: {
      one: "{{count}} dashboard names the selected monitors.",
      other: "{{count}} dashboards name the selected monitors.",
    },
  },
  [UsedByRelation.ScheduleOnCallPolicies]: {
    title: translationKey("On-call policies that page it"),
    impact: {
      one: "{{count}} on-call policy pages this schedule.",
      other: "{{count}} on-call policies page this schedule.",
    },
    bulkImpact: {
      one: "{{count}} on-call policy pages the selected schedules.",
      other: "{{count}} on-call policies page the selected schedules.",
    },
  },
  [UsedByRelation.ServiceMonitors]: {
    title: translationKey("Monitors watching it"),
    impact: {
      one: "{{count}} monitor watches this service.",
      other: "{{count}} monitors watch this service.",
    },
    bulkImpact: {
      one: "{{count}} monitor watches the selected services.",
      other: "{{count}} monitors watch the selected services.",
    },
  },
  [UsedByRelation.ServiceSlos]: {
    title: translationKey("SLOs measuring its monitors"),
    impact: {
      one: "{{count}} SLO measures a monitor of this service.",
      other: "{{count}} SLOs measure monitors of this service.",
    },
    bulkImpact: {
      one: "{{count}} SLO measures monitors of the selected services.",
      other: "{{count}} SLOs measure monitors of the selected services.",
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
    bulkImpact: {
      one: "Visitors see {{count}} maintenance event coming up or in progress on the selected status pages.",
      other:
        "Visitors see {{count}} maintenance events coming up or in progress on the selected status pages.",
    },
  },
  [UsedByRelation.TeamOnCallPolicies]: {
    title: translationKey("On-call policies that page it"),
    impact: {
      one: "{{count}} on-call policy pages this team.",
      other: "{{count}} on-call policies page this team.",
    },
    bulkImpact: {
      one: "{{count}} on-call policy pages the selected teams.",
      other: "{{count}} on-call policies page the selected teams.",
    },
  },
  [UsedByRelation.TeamOwnedMonitors]: {
    title: translationKey("Monitors it owns"),
    impact: {
      one: "This team owns {{count}} monitor.",
      other: "This team owns {{count}} monitors.",
    },
    bulkImpact: {
      one: "The selected teams own {{count}} monitor.",
      other: "The selected teams own {{count}} monitors.",
    },
  },
  [UsedByRelation.TeamOwnedStatusPages]: {
    title: translationKey("Status pages it owns"),
    impact: {
      one: "This team owns {{count}} status page.",
      other: "This team owns {{count}} status pages.",
    },
    bulkImpact: {
      one: "The selected teams own {{count}} status page.",
      other: "The selected teams own {{count}} status pages.",
    },
  },
  [UsedByRelation.TeamOwnedServices]: {
    title: translationKey("Services it owns"),
    impact: {
      one: "This team owns {{count}} service.",
      other: "This team owns {{count}} services.",
    },
    bulkImpact: {
      one: "The selected teams own {{count}} service.",
      other: "The selected teams own {{count}} services.",
    },
  },
  [UsedByRelation.TeamOwnedOnCallPolicies]: {
    title: translationKey("On-call policies it owns"),
    impact: {
      one: "This team owns {{count}} on-call policy.",
      other: "This team owns {{count}} on-call policies.",
    },
    bulkImpact: {
      one: "The selected teams own {{count}} on-call policy.",
      other: "The selected teams own {{count}} on-call policies.",
    },
  },
  [UsedByRelation.TeamOwnedSchedules]: {
    title: translationKey("On-call schedules it owns"),
    impact: {
      one: "This team owns {{count}} on-call schedule.",
      other: "This team owns {{count}} on-call schedules.",
    },
    bulkImpact: {
      one: "The selected teams own {{count}} on-call schedule.",
      other: "The selected teams own {{count}} on-call schedules.",
    },
  },
  [UsedByRelation.TeamOwnedOther]: {
    title: translationKey("Everything else it owns"),
    impact: {
      one: "This team owns {{count}} other record.",
      other: "This team owns {{count}} other records.",
    },
    bulkImpact: {
      one: "The selected teams own {{count}} other record.",
      other: "The selected teams own {{count}} other records.",
    },
  },
  [UsedByRelation.OnCallPolicyRules]: {
    title: translationKey("On-call rules that page it"),
    impact: {
      one: "{{count}} on-call rule pages this on-call policy.",
      other: "{{count}} on-call rules page this on-call policy.",
    },
    bulkImpact: {
      one: "{{count}} on-call rule pages the selected on-call policies.",
      other: "{{count}} on-call rules page the selected on-call policies.",
    },
  },
  [UsedByRelation.OnCallPolicyMonitors]: {
    title: translationKey("Monitors whose criteria page it"),
    impact: {
      one: "{{count}} monitor pages this on-call policy from its criteria.",
      other: "{{count}} monitors page this on-call policy from their criteria.",
    },
    bulkImpact: {
      one: "{{count}} monitor pages the selected on-call policies from its criteria.",
      other:
        "{{count}} monitors page the selected on-call policies from their criteria.",
    },
  },
  [UsedByRelation.OnCallPolicyOther]: {
    title: translationKey("Templates and other rules that page it"),
    impact: {
      one: "{{count}} template or rule pages this on-call policy.",
      other: "{{count}} templates and rules page this on-call policy.",
    },
    bulkImpact: {
      one: "{{count}} template or rule pages the selected on-call policies.",
      other:
        "{{count}} templates and rules page the selected on-call policies.",
    },
  },
  [UsedByRelation.OnCallPolicyWorkflows]: {
    title: translationKey("Workflows"),
    impact: {
      one: "{{count}} workflow pages this on-call policy.",
      other: "{{count}} workflows page this on-call policy.",
    },
    bulkImpact: {
      one: "{{count}} workflow pages the selected on-call policies.",
      other: "{{count}} workflows page the selected on-call policies.",
    },
  },
  [UsedByRelation.MonitorGroupStatusPages]: {
    title: translationKey("Status pages"),
    impact: {
      one: "{{count}} status page shows this monitor group.",
      other: "{{count}} status pages show this monitor group.",
    },
    bulkImpact: {
      one: "{{count}} status page shows the selected monitor groups.",
      other: "{{count}} status pages show the selected monitor groups.",
    },
  },
  [UsedByRelation.MonitorGroupSlos]: {
    title: translationKey("SLOs measuring its monitors"),
    impact: {
      one: "{{count}} SLO measures a monitor of this group.",
      other: "{{count}} SLOs measure monitors of this group.",
    },
    bulkImpact: {
      one: "{{count}} SLO measures monitors of the selected groups.",
      other: "{{count}} SLOs measure monitors of the selected groups.",
    },
  },
  [UsedByRelation.SloBurnRateRules]: {
    title: translationKey("Burn-rate rules"),
    impact: {
      one: "{{count}} burn-rate rule watches this SLO.",
      other: "{{count}} burn-rate rules watch this SLO.",
    },
    bulkImpact: {
      one: "{{count}} burn-rate rule watches the selected SLOs.",
      other: "{{count}} burn-rate rules watch the selected SLOs.",
    },
  },
  [UsedByRelation.SloErrorBudgetPolicies]: {
    title: translationKey("Error budget policy tiers"),
    impact: {
      one: "{{count}} error budget policy tier acts on this SLO.",
      other: "{{count}} error budget policy tiers act on this SLO.",
    },
    bulkImpact: {
      one: "{{count}} error budget policy tier acts on the selected SLOs.",
      other: "{{count}} error budget policy tiers act on the selected SLOs.",
    },
  },
  [UsedByRelation.SloDashboards]: {
    title: translationKey("Dashboards"),
    impact: {
      one: "{{count}} dashboard shows this SLO.",
      other: "{{count}} dashboards show this SLO.",
    },
    bulkImpact: {
      one: "{{count}} dashboard shows the selected SLOs.",
      other: "{{count}} dashboards show the selected SLOs.",
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
      one: "{{count}} maintenance event carries this label.",
      other: "{{count}} maintenance events carry this label.",
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
 * nothing refers to it - what to do next, with the page it is done on (a
 * page of the record's own, such as an SLO's Burn-Rate Rules, opens on the
 * record).
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
  /*
   * What runs the policy (#7758): a policy pages nobody until a rule, a
   * monitor's criteria or a template does - "show the chain, and name the
   * break" (Docs/ux/README.md#principles).
   */
  [UsedByRecordKind.OnCallPolicy]: {
    title: translationKey("What runs this policy"),
    description: translationKey(
      "The on-call rules, monitors and templates that page this policy. It pages nobody until one of them does.",
    ),
    emptyTitle: translationKey("Nothing runs this policy yet"),
    emptyDescription: translationKey(
      "No on-call rule, monitor or template pages it, so it pages nobody. Add an on-call rule that pages it for new incidents.",
    ),
    emptyActionTitle: translationKey("Go to incident on-call rules"),
    emptyActionPage: PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
  },
  [UsedByRecordKind.MonitorGroup]: {
    title: translationKey("Used by"),
    description: translationKey(
      "The status pages that show this monitor group, and the SLOs that measure its monitors.",
    ),
    emptyTitle: translationKey("No status page shows this group yet"),
    emptyDescription: translationKey(
      "Add it to a status page's resources, so visitors see its monitors as one line.",
    ),
    emptyActionTitle: translationKey("Go to status pages"),
    emptyActionPage: PageMap.STATUS_PAGES,
  },
  /*
   * No action of its own when nothing uses it: a new SLO's Getting started
   * card already offers its burn-rate rules, one button for one job.
   */
  [UsedByRecordKind.Slo]: {
    title: translationKey("Used by"),
    description: translationKey(
      "The burn-rate rules and error budget policy that act on this SLO, and the dashboards that show it.",
    ),
    emptyTitle: translationKey("Nothing uses this SLO yet"),
    emptyDescription: translationKey(
      "No burn-rate rule, error budget policy or dashboard refers to it, so nobody is told when its budget burns fast.",
    ),
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

// A row's Delete or Archive dialog while it reads what uses the record.
export const CHECKING_WHAT_USES_IT: string = translationKey(
  "Checking what still uses it…",
);

// A bulk Delete or Archive dialog while it reads what uses the selection.
export const CHECKING_WHAT_USES_THEM: string = translationKey(
  "Checking what still uses them…",
);

/*
 * A rule switched off, or a monitor that is not checked: it names the
 * record but changes nothing until it is on again.
 */
export const ROW_IS_OFF: string = translationKey("Off");

/*
 * One kind of a family's line and how many of it refer, set apart from the
 * next by " · ": "Incident On-Call Rule: 2 · Alert Owner Rule: 1". The
 * shared label-and-value key, so each language writes its own colon
 * ("{{label}} : {{identifier}}" in French, a full-width one in Chinese).
 */
export const USED_BY_PART: string = translationKey("{{label}}: {{identifier}}");

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

/*
 * What a family's row is, as the product names that kind of record - the
 * model's own name, as its lists and pages title it ("Incident On-Call
 * Rule").
 */
export const USED_BY_ROW_KIND_NAMES: Readonly<Record<UsedByRowKind, string>> = {
  [UsedByRowKind.Monitor]: translationKey("Monitor"),
  [UsedByRowKind.MonitorGroup]: translationKey("Monitor Group"),
  [UsedByRowKind.StatusPage]: translationKey("Status Page"),
  [UsedByRowKind.ServiceLevelObjective]: translationKey("SLO"),
  [UsedByRowKind.ScheduledMaintenance]: translationKey("Maintenance Event"),
  [UsedByRowKind.Workflow]: translationKey("Workflow"),
  [UsedByRowKind.Dashboard]: translationKey("Dashboard"),
  [UsedByRowKind.OnCallDutyPolicy]: translationKey("On-Call Policy"),
  [UsedByRowKind.OnCallSchedule]: translationKey("On-Call Schedule"),
  [UsedByRowKind.Service]: translationKey("Service"),
  [UsedByRowKind.Incident]: translationKey("Incident"),
  [UsedByRowKind.Alert]: translationKey("Alert"),
  [UsedByRowKind.IncidentOnCallRule]: translationKey("Incident On-Call Rule"),
  [UsedByRowKind.AlertOnCallRule]: translationKey("Alert On-Call Rule"),
  [UsedByRowKind.IncidentEpisodeOnCallRule]: translationKey(
    "Incident Episode On-Call Rule",
  ),
  [UsedByRowKind.AlertEpisodeOnCallRule]: translationKey(
    "Alert Episode On-Call Rule",
  ),
  [UsedByRowKind.IncidentOwnerRule]: translationKey("Incident Owner Rule"),
  [UsedByRowKind.AlertOwnerRule]: translationKey("Alert Owner Rule"),
  [UsedByRowKind.IncidentLabelRule]: translationKey("Incident Label Rule"),
  [UsedByRowKind.AlertLabelRule]: translationKey("Alert Label Rule"),
  [UsedByRowKind.IncidentGroupingRule]: translationKey(
    "Incident Grouping Rule",
  ),
  [UsedByRowKind.AlertGroupingRule]: translationKey("Alert Grouping Rule"),
  [UsedByRowKind.IncidentPrivacyRule]: translationKey("Incident Privacy Rule"),
  [UsedByRowKind.AlertPrivacyRule]: translationKey("Alert Privacy Rule"),
  [UsedByRowKind.IncidentSlaRule]: translationKey("Incident SLA Rule"),
  [UsedByRowKind.AlertIncidentRule]: translationKey("Alert Incident Rule"),
  [UsedByRowKind.IncidentAiRule]: translationKey("AI Rule"),
  [UsedByRowKind.AlertAiRule]: translationKey("AI Rule"),
  [UsedByRowKind.IncidentRunbookRule]: translationKey("Runbook Rule"),
  [UsedByRowKind.AlertRunbookRule]: translationKey("Runbook Rule"),
  [UsedByRowKind.MaintenanceRunbookRule]: translationKey("Runbook Rule"),
  [UsedByRowKind.PostmortemRule]: translationKey("Postmortem Rule"),
  [UsedByRowKind.MaintenanceLabelRule]: translationKey(
    "Scheduled Maintenance Label Rule",
  ),
  [UsedByRowKind.MaintenanceOwnerRule]: translationKey(
    "Scheduled Maintenance Owner Rule",
  ),
  [UsedByRowKind.SloBurnRateRule]: translationKey("SLO Burn Rate Rule"),
  [UsedByRowKind.SloErrorBudgetPolicyTier]: translationKey(
    "SLO Error Budget Policy Tier",
  ),
  [UsedByRowKind.CloudBudget]: translationKey("Cloud Budget"),
  [UsedByRowKind.IncidentTemplate]: translationKey("Incident Template"),
  [UsedByRowKind.MaintenanceTemplate]: translationKey(
    "Scheduled Maintenance Template",
  ),
  [UsedByRowKind.AnnouncementTemplate]: translationKey(
    "Status Page Announcement Template",
  ),
  [UsedByRowKind.IncidentEpisode]: translationKey("Incident Episode"),
  [UsedByRowKind.AlertEpisode]: translationKey("Alert Episode"),
  [UsedByRowKind.Runbook]: translationKey("Runbook"),
  [UsedByRowKind.IncomingCallPolicy]: translationKey("Incoming Call Policy"),
  [UsedByRowKind.Team]: translationKey("Team"),
  [UsedByRowKind.Host]: translationKey("Host"),
  [UsedByRowKind.KubernetesCluster]: translationKey("Kubernetes Cluster"),
  [UsedByRowKind.DockerHost]: translationKey("Docker Host"),
  [UsedByRowKind.DockerSwarmCluster]: translationKey("Docker Swarm Cluster"),
  [UsedByRowKind.PodmanHost]: translationKey("Podman Host"),
  [UsedByRowKind.ProxmoxCluster]: translationKey("Proxmox Cluster"),
  [UsedByRowKind.OpenStackCloud]: translationKey("OpenStack Cloud"),
  [UsedByRowKind.VMwareVCenter]: translationKey("VMware vCenter"),
  [UsedByRowKind.CephCluster]: translationKey("Ceph Cluster"),
  [UsedByRowKind.StorageArray]: translationKey("Storage Array"),
  [UsedByRowKind.NetworkDevice]: translationKey("Network Device"),
  [UsedByRowKind.IoTFleet]: translationKey("IoT Fleet"),
  [UsedByRowKind.CloudResource]: translationKey("Cloud Resource"),
  [UsedByRowKind.ServerlessFunction]: translationKey("Serverless Function"),
  [UsedByRowKind.DatabaseServer]: translationKey("Database Server"),
  [UsedByRowKind.MessageQueue]: translationKey("Message Queue"),
  [UsedByRowKind.RumApplication]: translationKey("RUM Application"),
  [UsedByRowKind.DataStore]: translationKey("Data Store"),
  [UsedByRowKind.DataAsset]: translationKey("Data Asset"),
  [UsedByRowKind.DataPipeline]: translationKey("Data Pipeline"),
  [UsedByRowKind.Probe]: translationKey("Probe"),
  [UsedByRowKind.Runner]: translationKey("Runner"),
  [UsedByRowKind.AIAgent]: translationKey("AI Agent"),
};

/*
 * The page a row opens, or null for a kind with no page of its own (an AI
 * agent is set up on each resource it reads): such a row is its name.
 */
const ROW_PAGES: Readonly<Record<UsedByRowKind, PageMap | null>> = {
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
  // A list of rules: the page of the event's rules.
  [UsedByRowKind.IncidentOnCallRule]: PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
  [UsedByRowKind.AlertOnCallRule]: PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
  [UsedByRowKind.IncidentEpisodeOnCallRule]:
    PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
  [UsedByRowKind.AlertEpisodeOnCallRule]: PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
  [UsedByRowKind.IncidentOwnerRule]: PageMap.INCIDENTS_SETTINGS_OWNER_RULE_VIEW,
  [UsedByRowKind.AlertOwnerRule]: PageMap.ALERTS_SETTINGS_OWNER_RULE_VIEW,
  [UsedByRowKind.IncidentLabelRule]: PageMap.INCIDENTS_SETTINGS_LABEL_RULE_VIEW,
  [UsedByRowKind.AlertLabelRule]: PageMap.ALERTS_SETTINGS_LABEL_RULE_VIEW,
  [UsedByRowKind.IncidentGroupingRule]:
    PageMap.INCIDENTS_SETTINGS_GROUPING_RULES,
  [UsedByRowKind.AlertGroupingRule]: PageMap.ALERTS_SETTINGS_GROUPING_RULES,
  [UsedByRowKind.IncidentPrivacyRule]:
    PageMap.INCIDENTS_SETTINGS_PRIVACY_RULE_VIEW,
  [UsedByRowKind.AlertPrivacyRule]: PageMap.ALERTS_SETTINGS_PRIVACY_RULE_VIEW,
  [UsedByRowKind.IncidentSlaRule]: PageMap.INCIDENTS_SETTINGS_SLA_RULES,
  [UsedByRowKind.AlertIncidentRule]: PageMap.ALERTS_SETTINGS_INCIDENT_RULES,
  [UsedByRowKind.IncidentAiRule]: PageMap.INCIDENTS_SETTINGS_AI,
  [UsedByRowKind.AlertAiRule]: PageMap.ALERTS_SETTINGS_AI,
  [UsedByRowKind.IncidentRunbookRule]: PageMap.INCIDENTS_SETTINGS_RUNBOOK_RULES,
  [UsedByRowKind.AlertRunbookRule]: PageMap.ALERTS_SETTINGS_RUNBOOK_RULES,
  [UsedByRowKind.MaintenanceRunbookRule]:
    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_RUNBOOK_RULES,
  [UsedByRowKind.PostmortemRule]: PageMap.INCIDENTS_SETTINGS_AI,
  [UsedByRowKind.MaintenanceLabelRule]:
    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULE_VIEW,
  [UsedByRowKind.MaintenanceOwnerRule]:
    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULE_VIEW,
  // The SLO's own page of them (the row's linkId is the SLO).
  [UsedByRowKind.SloBurnRateRule]: PageMap.SLO_VIEW_BURN_RATE_RULES,
  [UsedByRowKind.SloErrorBudgetPolicyTier]:
    PageMap.SLO_VIEW_ERROR_BUDGET_POLICY,
  [UsedByRowKind.CloudBudget]: PageMap.CLOUD_BUDGETS,
  [UsedByRowKind.IncidentTemplate]: PageMap.INCIDENTS_SETTINGS_TEMPLATES_VIEW,
  [UsedByRowKind.MaintenanceTemplate]:
    PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES_VIEW,
  [UsedByRowKind.AnnouncementTemplate]:
    PageMap.STATUS_PAGES_SETTINGS_ANNOUNCEMENT_TEMPLATES_VIEW,
  [UsedByRowKind.IncidentEpisode]: PageMap.INCIDENT_EPISODE_VIEW,
  [UsedByRowKind.AlertEpisode]: PageMap.ALERT_EPISODE_VIEW,
  [UsedByRowKind.Runbook]: PageMap.RUNBOOK_VIEW,
  [UsedByRowKind.IncomingCallPolicy]:
    PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW,
  [UsedByRowKind.Team]: PageMap.TEAM_VIEW,
  [UsedByRowKind.Host]: PageMap.HOST_VIEW,
  [UsedByRowKind.KubernetesCluster]: PageMap.KUBERNETES_CLUSTER_VIEW,
  [UsedByRowKind.DockerHost]: PageMap.DOCKER_HOST_VIEW,
  [UsedByRowKind.DockerSwarmCluster]: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
  [UsedByRowKind.PodmanHost]: PageMap.PODMAN_HOST_VIEW,
  [UsedByRowKind.ProxmoxCluster]: PageMap.PROXMOX_CLUSTER_VIEW,
  [UsedByRowKind.OpenStackCloud]: PageMap.OPENSTACK_CLOUD_VIEW,
  [UsedByRowKind.VMwareVCenter]: PageMap.VMWARE_VCENTER_VIEW,
  [UsedByRowKind.CephCluster]: PageMap.CEPH_CLUSTER_VIEW,
  [UsedByRowKind.StorageArray]: PageMap.STORAGE_ARRAY_VIEW,
  [UsedByRowKind.NetworkDevice]: PageMap.NETWORK_DEVICE_VIEW,
  [UsedByRowKind.IoTFleet]: PageMap.IOT_FLEET_VIEW,
  [UsedByRowKind.CloudResource]: PageMap.CLOUD_RESOURCE_VIEW,
  [UsedByRowKind.ServerlessFunction]: PageMap.SERVERLESS_FUNCTION_VIEW,
  [UsedByRowKind.DatabaseServer]: PageMap.DATABASE_SERVER_VIEW,
  [UsedByRowKind.MessageQueue]: PageMap.MESSAGE_QUEUE_VIEW,
  [UsedByRowKind.RumApplication]: PageMap.RUM_APPLICATION_VIEW,
  [UsedByRowKind.DataStore]: PageMap.DATA_OBSERVABILITY_STORE_VIEW,
  [UsedByRowKind.DataAsset]: PageMap.DATA_OBSERVABILITY_TABLE_VIEW,
  [UsedByRowKind.DataPipeline]: PageMap.DATA_OBSERVABILITY_PIPELINE_VIEW,
  [UsedByRowKind.Probe]: PageMap.MONITORS_SETTINGS_PROBE_VIEW,
  [UsedByRowKind.Runner]: PageMap.RUNBOOKS_RUNNER_VIEW,
  [UsedByRowKind.AIAgent]: null,
};

export function getUsedByRowPage(rowKind: UsedByRowKind): PageMap | null {
  return ROW_PAGES[rowKind] || null;
}

/*
 * Where a row of a relation leads when it is not its kind's own page: an
 * on-call policy that pages the schedule or the team opens on its
 * Escalation Rules, where the schedule or the team is named - the rules its
 * line names (#9701). Anywhere else - a team's owned policies - a policy
 * opens on its overview.
 */
const RELATION_ROW_PAGES: Partial<Record<UsedByRelation, PageMap>> = {
  [UsedByRelation.ScheduleOnCallPolicies]:
    PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
  [UsedByRelation.TeamOnCallPolicies]:
    PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
};

/*
 * Where a row leads: its kind's page, opened on the row - or on the record
 * the server named for it (linkId: an SLO's burn-rate rule opens its SLO's
 * Burn-Rate Rules page), or the page its relation opens it on (a policy that
 * pages a schedule, on its Escalation Rules). A kind's list of rules opens
 * as it is. Null for a kind with no page.
 */
export function getUsedByRowRoute(
  rowKind: UsedByRowKind,
  rowId: string,
  linkId?: string | undefined,
  relation?: UsedByRelation | undefined,
): Route | null {
  const page: PageMap | null =
    (relation ? RELATION_ROW_PAGES[relation] : undefined) ||
    getUsedByRowPage(rowKind);

  if (!page) {
    return null;
  }

  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(linkId || rowId),
  });
}

// The name of the kind of record a row is, in the reader's words.
export function getUsedByRowKindName(
  rowKind: UsedByRowKind,
  translator: Translator,
): string {
  const name: string = USED_BY_ROW_KIND_NAMES[rowKind];

  return translator.translateText(name) || name;
}

/*
 * A family's kinds as one line: "Incident On-Call Rule: 2 · Alert Owner
 * Rule: 1", each kind counted with what the reader may not see. Empty for
 * a line that is no family.
 */
export function getUsedByPartsLine(
  group: Pick<UsedByCounts, "parts">,
  translator: Translator,
): string {
  return (group.parts || [])
    .map((part: UsedByGroupPart): string => {
      return translator.translateTemplate(USED_BY_PART, {
        label: getUsedByRowKindName(part.rowKind, translator),
        identifier: translator.formatNumber(getUsedByGroupTotal(part)),
      });
    })
    .join(" · ");
}

/*
 * What a group means for several records of a list's selection, counted
 * for all of them: "12 status pages show the selected monitors." Empty for
 * a relation with no such sentence.
 */
export function getUsedByBulkImpactSentence(
  group: Pick<UsedByCounts, "relation" | "count" | "hiddenCount">,
  translator: Translator,
): string {
  const words: PluralTemplate | undefined =
    USED_BY_RELATION_WORDS[group.relation].bulkImpact;

  if (!words) {
    return "";
  }

  return translator.translatePlural(words, getUsedByGroupTotal(group));
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
