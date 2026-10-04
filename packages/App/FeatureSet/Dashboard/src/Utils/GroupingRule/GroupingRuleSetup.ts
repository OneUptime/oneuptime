import IconProp from "Common/Types/Icon/IconProp";
import { toPeoplePickerIds } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * The plain-language half of the Incident and Alert Grouping Rules pages.
 *
 * "The incident grouping rules are extremely hard to understand and use for
 * people. How can we make this simple? The idea is to reduce as much decision
 * / option / choice paralysis as possible." - the maintainer, looking at a
 * table that ran off the screen and a nine-step form.
 *
 * A rule still stores what it always stored - five group-by switches, a time
 * window, the lifecycle switches - and the engines read it exactly as before
 * (IncidentGroupingEngineService, AlertGroupingEngineService). What changes is
 * how a person gets there:
 *
 *   - one question instead of five switches: group by monitor, severity,
 *     title, everything together, or a custom mix (getGroupingMode maps the
 *     switches to that answer and getGroupByValuesForMode maps it back);
 *   - four ready-made rules that are added in one click
 *     (GROUPING_RULE_TEMPLATES);
 *   - one sentence per rule in the list instead of raw columns
 *     (getGroupingRuleSummary);
 *   - everything else behind "Show advanced settings", which an existing rule
 *     that uses any of it opens with (hasAdvancedSettings);
 *   - who owns the episodes a rule opens asked with one people picker, where
 *     two dropdowns set a default assignee nothing ever showed (see
 *     EPISODE_OWNERS_FIELD_KEY).
 *
 * React-free on purpose: App has no react (see
 * App/Tests/FeatureSetImportsStayReactFree.test.ts), and the node tests that
 * pin this logic import it from here. Translation is handed in rather than
 * imported, for the same reason. Every English string below is also its own
 * key in all seventeen Dashboard locale files.
 */

export enum GroupingRuleKind {
  Incident = "Incident",
  Alert = "Alert",
}

/*
 * The one question the form asks instead of five switches. Custom is the way
 * to every other combination of the switches, so nothing a rule could do
 * before is out of reach.
 */
export enum GroupingMode {
  Monitor = "monitor",
  Severity = "severity",
  Title = "title",
  Everything = "everything",
  Custom = "custom",
}

/*
 * The reader's language: the English text is the key, and {{placeholders}}
 * are filled in from values (see Common/UI/Utils/TranslateTemplate).
 */
export type GroupingRuleTranslateFunction = (
  text: string,
  values?: Record<string, string | number> | undefined,
) => string;

// A rule, or a form's values for one. Read loosely: either may be partial.
export type GroupingRuleValues = Record<string, unknown>;

export interface GroupByFieldNames {
  monitor: string;
  severity: string;
  title: string;
  labels: string;
  monitorLabels: string;
}

// The two models name their title and label switches after what they group.
export const GROUP_BY_FIELD_NAMES: Record<GroupingRuleKind, GroupByFieldNames> =
  {
    [GroupingRuleKind.Incident]: {
      monitor: "groupByMonitor",
      severity: "groupBySeverity",
      title: "groupByIncidentTitle",
      labels: "groupByIncidentLabels",
      monitorLabels: "groupByMonitorLabels",
    },
    [GroupingRuleKind.Alert]: {
      monitor: "groupByMonitor",
      severity: "groupBySeverity",
      title: "groupByAlertTitle",
      labels: "groupByAlertLabels",
      monitorLabels: "groupByMonitorLabels",
    },
  };

// The form-only keys the simple controls are registered under.
export const GROUPING_MODE_FIELD_KEY: string = "groupingMode";
export const TIME_WINDOW_SETTING_FIELD_KEY: string = "timeWindowSetting";
export const REOPEN_WINDOW_SETTING_FIELD_KEY: string = "reopenWindowSetting";
export const RESOLVE_DELAY_SETTING_FIELD_KEY: string = "resolveDelaySetting";
export const INACTIVITY_TIMEOUT_SETTING_FIELD_KEY: string =
  "inactivityTimeoutSetting";
export const SHOW_ADVANCED_SETTINGS_FIELD_KEY: string = "showAdvancedSettings";

/*
 * Who owns the episodes a rule opens: the On-Call & Ownership step's Episode
 * Owners, one people picker kept in the rule's episodeOwnerUsers and
 * episodeOwnerTeams. The engines make each of them an owner of every episode
 * the rule opens - listed on the episode's Owners page and notified like any
 * owner (GroupingRuleEpisodeOwners, on the server).
 *
 * The step used to ask "Default Assign To Team" and "Default Assign To User"
 * instead: two dropdowns the engines copied into the episode's
 * assignedToTeam and assignedToUser, which nothing in OneUptime reads - no
 * page, notification or worker. A rule saved with them keeps them: the API
 * and Terraform still read and write those columns, and the engines still
 * copy them. Its edit form names them under the owners and offers to make
 * them owners instead (getLegacyDefaultAssignee).
 */
export const EPISODE_OWNERS_FIELD_KEY: string = "episodeOwners";
export const EPISODE_OWNER_USERS_COLUMN: string = "episodeOwnerUsers";
export const EPISODE_OWNER_TEAMS_COLUMN: string = "episodeOwnerTeams";

// The form-only key of the line under the owners that names the old pair.
export const LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY: string =
  "legacyDefaultAssignee";

// The columns the old pair wrote, which the edit form reads and clears.
export const LEGACY_DEFAULT_ASSIGNEE_USER_COLUMN: string =
  "defaultAssignToUserId";
export const LEGACY_DEFAULT_ASSIGNEE_TEAM_COLUMN: string =
  "defaultAssignToTeamId";

// Their relations, which a rule read through the API can carry instead.
const LEGACY_DEFAULT_ASSIGNEE_USER_RELATION: string = "defaultAssignToUser";
const LEGACY_DEFAULT_ASSIGNEE_TEAM_RELATION: string = "defaultAssignToTeam";

const LEGACY_DEFAULT_ASSIGNEE_KEYS: Array<string> = [
  LEGACY_DEFAULT_ASSIGNEE_USER_COLUMN,
  LEGACY_DEFAULT_ASSIGNEE_TEAM_COLUMN,
  LEGACY_DEFAULT_ASSIGNEE_USER_RELATION,
  LEGACY_DEFAULT_ASSIGNEE_TEAM_RELATION,
];

/*
 * The engines fall back to this when a rule's time window is switched on with
 * no minutes (`rule.timeWindowMinutes || 60`), so the summary does too.
 */
export const ENGINE_FALLBACK_TIME_WINDOW_MINUTES: number = 60;

// A blank rule starts grouping by monitor, within half an hour.
export const DEFAULT_TIME_WINDOW_MINUTES: number = 30;

/*
 * The minutes the lifecycle switches start from when they are turned on with
 * nothing typed yet.
 */
export const DEFAULT_REOPEN_WINDOW_MINUTES: number = 30;
export const DEFAULT_RESOLVE_DELAY_MINUTES: number = 5;
export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES: number = 60;

/*
 * The columns are integers. A year is far past any sensible window and far
 * short of the column's limit.
 */
export const MAX_SETTING_MINUTES: number = 525600;

export const MINUTES_VALIDATION_MESSAGE: string =
  "Enter a whole number of minutes between 1 and {{max}}.";

/*
 * Copy that reads the same for both products. Kind-specific copy is a record
 * keyed by GroupingRuleKind, because "incidents" and "alerts" do not swap in
 * cleanly in every language.
 */
export type KindCopy = Record<GroupingRuleKind, string>;

export const GROUPING_RULE_COPY: {
  cardDescription: KindCopy;
  emptyStateTitle: string;
  emptyStateExample: KindCopy;
  createCustomRule: string;
  templatesModalTitle: string;
  templatesModalDescription: string;
  addRule: string;
  ruleAdded: string;
  groupingStepTitle: string;
  whichStepTitle: KindCopy;
  modeFieldTitle: KindCopy;
  modeFieldDescription: KindCopy;
  timeWindowTitle: KindCopy;
  timeWindowDescription: KindCopy;
  timeWindowSentence: KindCopy;
  reopenWindowTitle: string;
  reopenWindowDescription: KindCopy;
  reopenWindowSentence: string;
  resolveDelayTitle: string;
  resolveDelayDescription: KindCopy;
  resolveDelaySentence: string;
  inactivityTimeoutTitle: string;
  inactivityTimeoutDescription: KindCopy;
  inactivityTimeoutSentence: KindCopy;
  showAdvancedTitle: string;
  showAdvancedDescription: string;
  summaryColumnTitle: string;
  episodeOwnersTitle: string;
  episodeOwnersDescription: string;
  legacyAssigneeTitle: string;
  legacyAssigneeDescription: string;
  legacyAssigneeAddAsOwners: string;
  legacyAssigneeRemove: string;
} = {
  cardDescription: {
    [GroupingRuleKind.Incident]:
      "Put related incidents into one episode, so your team works on one problem instead of a flood of incidents. Rules are checked from top to bottom and the first match wins - drag a rule to change its place.",
    [GroupingRuleKind.Alert]:
      "Put related alerts into one episode, so your team works on one problem instead of a flood of alerts. Rules are checked from top to bottom and the first match wins - drag a rule to change its place.",
  },
  emptyStateTitle: "Start with a template",
  emptyStateExample: {
    [GroupingRuleKind.Incident]:
      "For example, when a database goes down and 20 monitors open incidents within five minutes, a rule can put all 20 into one episode that your team acknowledges and resolves together.",
    [GroupingRuleKind.Alert]:
      "For example, when a database goes down and 20 monitors raise alerts within five minutes, a rule can put all 20 into one episode that your team acknowledges and resolves together.",
  },
  createCustomRule: "Create Custom Rule",
  templatesModalTitle: "Create from Template",
  templatesModalDescription:
    "Add a ready-made rule in one click. You can edit it afterwards.",
  addRule: "Add Rule",
  ruleAdded: "Rule added: {{name}}",
  groupingStepTitle: "Grouping",
  whichStepTitle: {
    [GroupingRuleKind.Incident]: "Which Incidents",
    [GroupingRuleKind.Alert]: "Which Alerts",
  },
  modeFieldTitle: {
    [GroupingRuleKind.Incident]: "Group incidents by",
    [GroupingRuleKind.Alert]: "Group alerts by",
  },
  modeFieldDescription: {
    [GroupingRuleKind.Incident]:
      "Incidents that share this go into one episode. The rule applies to every new incident unless you narrow it down under Which Incidents.",
    [GroupingRuleKind.Alert]:
      "Alerts that share this go into one episode. The rule applies to every new alert unless you narrow it down under Which Alerts.",
  },
  timeWindowTitle: {
    [GroupingRuleKind.Incident]:
      "Only group incidents that arrive close together",
    [GroupingRuleKind.Alert]: "Only group alerts that arrive close together",
  },
  timeWindowDescription: {
    [GroupingRuleKind.Incident]:
      "When this is off, matching incidents keep joining the open episode until it is resolved.",
    [GroupingRuleKind.Alert]:
      "When this is off, matching alerts keep joining the open episode until it is resolved.",
  },
  timeWindowSentence: {
    [GroupingRuleKind.Incident]:
      "Within {{minutes}} minutes of the previous incident",
    [GroupingRuleKind.Alert]:
      "Within {{minutes}} minutes of the previous alert",
  },
  reopenWindowTitle: "Reopen recently resolved episodes",
  reopenWindowDescription: {
    [GroupingRuleKind.Incident]:
      "When a matching incident arrives soon after its episode was resolved, reopen that episode instead of starting a new one.",
    [GroupingRuleKind.Alert]:
      "When a matching alert arrives soon after its episode was resolved, reopen that episode instead of starting a new one.",
  },
  reopenWindowSentence:
    "Up to {{minutes}} minutes after the episode is resolved",
  resolveDelayTitle: "Wait before resolving an episode",
  resolveDelayDescription: {
    [GroupingRuleKind.Incident]:
      "When every incident in an episode is resolved, wait before resolving the episode, in case one comes back.",
    [GroupingRuleKind.Alert]:
      "When every alert in an episode is resolved, wait before resolving the episode, in case one comes back.",
  },
  resolveDelaySentence: "Wait {{minutes}} minutes",
  inactivityTimeoutTitle: "Resolve quiet episodes",
  inactivityTimeoutDescription: {
    [GroupingRuleKind.Incident]:
      "Resolve an episode automatically when no new incident has joined it for a while.",
    [GroupingRuleKind.Alert]:
      "Resolve an episode automatically when no new alert has joined it for a while.",
  },
  inactivityTimeoutSentence: {
    [GroupingRuleKind.Incident]:
      "After {{minutes}} minutes without a new incident",
    [GroupingRuleKind.Alert]: "After {{minutes}} minutes without a new alert",
  },
  showAdvancedTitle: "Show advanced settings",
  showAdvancedDescription:
    "Reopen and auto-resolve episodes, set episode titles and labels, page on-call and assign owners. Most teams can leave these as they are.",
  summaryColumnTitle: "Grouping",
  episodeOwnersTitle: "Episode Owners",
  episodeOwnersDescription:
    "Added as owners of every episode this rule opens, and notified like any other owner.",
  /*
   * The line under the owners of a rule that still has the old default
   * assignee: who it names, that nothing shows it, and the way out.
   */
  legacyAssigneeTitle: "Default assignee",
  legacyAssigneeDescription:
    "Set by an older version of this form and not shown anywhere. Add them as owners to make them responsible for the episodes this rule opens.",
  legacyAssigneeAddAsOwners: "Add as owners",
  legacyAssigneeRemove: "Remove",
};

export interface GroupingModeOption {
  mode: GroupingMode;
  icon: IconProp;
  title: string;
  description: KindCopy;
}

// The cards of the "Group incidents by" question, most useful first.
export const GROUPING_MODE_OPTIONS: Array<GroupingModeOption> = [
  {
    mode: GroupingMode.Monitor,
    icon: IconProp.Activity,
    title: "Monitor",
    description: {
      [GroupingRuleKind.Incident]:
        "One episode per monitor. A good default for most teams.",
      [GroupingRuleKind.Alert]:
        "One episode per monitor. A good default for most teams.",
    },
  },
  {
    mode: GroupingMode.Everything,
    icon: IconProp.Bolt,
    title: "Everything Together",
    description: {
      [GroupingRuleKind.Incident]:
        "One shared episode for all matching incidents. Catches an outage that trips many monitors at once.",
      [GroupingRuleKind.Alert]:
        "One shared episode for all matching alerts. Catches an outage that trips many monitors at once.",
    },
  },
  {
    mode: GroupingMode.Severity,
    icon: IconProp.ExclaimationCircle,
    title: "Severity",
    description: {
      [GroupingRuleKind.Incident]:
        "One episode per severity, such as all Critical incidents.",
      [GroupingRuleKind.Alert]:
        "One episode per severity, such as all Critical alerts.",
    },
  },
  {
    mode: GroupingMode.Title,
    icon: IconProp.DocumentDuplicate,
    title: "Title",
    description: {
      [GroupingRuleKind.Incident]:
        "One episode per title, for the same problem firing again and again. Numbers in titles are ignored.",
      [GroupingRuleKind.Alert]:
        "One episode per title, for the same problem firing again and again. Numbers in titles are ignored.",
    },
  },
  {
    mode: GroupingMode.Custom,
    icon: IconProp.AdjustmentHorizontal,
    title: "Custom",
    description: {
      [GroupingRuleKind.Incident]:
        "Combine monitor, severity, title and labels yourself on the next step.",
      [GroupingRuleKind.Alert]:
        "Combine monitor, severity, title and labels yourself on the next step.",
    },
  },
];

/*
 * A ready-made rule. Its name is also the name the form suggests for its
 * mode, so picking a card in the form and adding a template agree.
 */
export interface GroupingRuleTemplate {
  id: string;
  mode: Exclude<GroupingMode, GroupingMode.Custom>;
  icon: IconProp;
  timeWindowMinutes: number;
  name: KindCopy;
  description: KindCopy;
}

export const GROUPING_RULE_TEMPLATES: Array<GroupingRuleTemplate> = [
  {
    id: "same-monitor",
    mode: GroupingMode.Monitor,
    icon: IconProp.Activity,
    timeWindowMinutes: 30,
    name: {
      [GroupingRuleKind.Incident]: "Group incidents from the same monitor",
      [GroupingRuleKind.Alert]: "Group alerts from the same monitor",
    },
    description: {
      [GroupingRuleKind.Incident]:
        "One episode per monitor. Incidents from that monitor join it while they arrive within 30 minutes of each other.",
      [GroupingRuleKind.Alert]:
        "One episode per monitor. Alerts from that monitor join it while they arrive within 30 minutes of each other.",
    },
  },
  {
    id: "happen-together",
    mode: GroupingMode.Everything,
    icon: IconProp.Bolt,
    timeWindowMinutes: 10,
    name: {
      [GroupingRuleKind.Incident]: "Group incidents that happen together",
      [GroupingRuleKind.Alert]: "Group alerts that happen together",
    },
    description: {
      [GroupingRuleKind.Incident]:
        "One shared episode for every incident that arrives within 10 minutes of the last one, whatever the monitor. Catches an outage that trips many monitors at once.",
      [GroupingRuleKind.Alert]:
        "One shared episode for every alert that arrives within 10 minutes of the last one, whatever the monitor. Catches an outage that trips many monitors at once.",
    },
  },
  {
    id: "same-severity",
    mode: GroupingMode.Severity,
    icon: IconProp.ExclaimationCircle,
    timeWindowMinutes: 30,
    name: {
      [GroupingRuleKind.Incident]: "Group incidents by severity",
      [GroupingRuleKind.Alert]: "Group alerts by severity",
    },
    description: {
      [GroupingRuleKind.Incident]:
        "One episode per severity, such as all Critical incidents, while they arrive within 30 minutes of each other.",
      [GroupingRuleKind.Alert]:
        "One episode per severity, such as all Critical alerts, while they arrive within 30 minutes of each other.",
    },
  },
  {
    id: "same-title",
    mode: GroupingMode.Title,
    icon: IconProp.DocumentDuplicate,
    timeWindowMinutes: 60,
    name: {
      [GroupingRuleKind.Incident]: "Group repeats of the same incident",
      [GroupingRuleKind.Alert]: "Group repeats of the same alert",
    },
    description: {
      [GroupingRuleKind.Incident]:
        "One episode per incident title, for the same problem firing again and again within an hour. Numbers in titles are ignored.",
      [GroupingRuleKind.Alert]:
        "One episode per alert title, for the same problem firing again and again within an hour. Numbers in titles are ignored.",
    },
  },
];

// The phrases the list's Grouping column is built from.
export const GROUPING_SUMMARY_COPY: {
  perMonitor: string;
  perSeverity: string;
  perTitle: string;
  everything: KindCopy;
  perCombination: string;
  fieldMonitor: string;
  fieldSeverity: string;
  fieldTitle: string;
  fieldLabels: KindCopy;
  fieldMonitorLabels: string;
  timeWindowOn: KindCopy;
  timeWindowOff: KindCopy;
  reopens: string;
  waitsBeforeResolving: string;
  resolvesWhenQuiet: KindCopy;
  runsOneOnCallPolicy: string;
  runsOnCallPolicies: string;
  showsOnStatusPages: string;
  minute: string;
  minutes: string;
  hour: string;
  hours: string;
  day: string;
  days: string;
} = {
  perMonitor: "One episode per monitor",
  perSeverity: "One episode per severity",
  perTitle: "One episode per title",
  everything: {
    [GroupingRuleKind.Incident]: "All matching incidents share one episode",
    [GroupingRuleKind.Alert]: "All matching alerts share one episode",
  },
  /*
   * A custom mix, listed by the switches' own names (shared with the rest of
   * the Dashboard): "One episode per combination of: Monitor, Severity". A
   * label switch on its own reads right too - labels group by their exact
   * set, which is a combination.
   */
  perCombination: "One episode per combination of: {{fields}}",
  fieldMonitor: "Monitor",
  fieldSeverity: "Severity",
  fieldTitle: "Title",
  fieldLabels: {
    [GroupingRuleKind.Incident]: "Incident Labels",
    [GroupingRuleKind.Alert]: "Alert Labels",
  },
  fieldMonitorLabels: "Monitor Labels",
  timeWindowOn: {
    [GroupingRuleKind.Incident]:
      "New incidents join while they arrive within {{duration}} of the last one",
    [GroupingRuleKind.Alert]:
      "New alerts join while they arrive within {{duration}} of the last one",
  },
  timeWindowOff: {
    [GroupingRuleKind.Incident]:
      "New incidents keep joining until the episode is resolved",
    [GroupingRuleKind.Alert]:
      "New alerts keep joining until the episode is resolved",
  },
  reopens: "Reopens episodes resolved in the last {{duration}}",
  waitsBeforeResolving: "Waits {{duration}} before resolving",
  resolvesWhenQuiet: {
    [GroupingRuleKind.Incident]:
      "Resolves after {{duration}} without new incidents",
    [GroupingRuleKind.Alert]: "Resolves after {{duration}} without new alerts",
  },
  runsOneOnCallPolicy: "Runs 1 on-call policy",
  runsOnCallPolicies: "Runs {{count}} on-call policies",
  showsOnStatusPages: "Shows episodes on status pages",
  // These six are shared with the rest of the Dashboard.
  minute: "1 minute",
  minutes: "{{count}} minutes",
  hour: "1 hour",
  hours: "{{count}} hours",
  day: "1 day",
  days: "{{count}} days",
};

type ReadFlagFunction = (values: GroupingRuleValues, key: string) => boolean;

const isOn: ReadFlagFunction = (
  values: GroupingRuleValues,
  key: string,
): boolean => {
  return values[key] === true;
};

/*
 * The question's answer for a rule's five switches. One switch on its own is
 * one of the named answers (labels on their own have no card, so they are
 * Custom); none at all is Everything; anything else is Custom.
 */
export const getGroupingMode: (
  values: GroupingRuleValues,
  kind: GroupingRuleKind,
) => GroupingMode = (
  values: GroupingRuleValues,
  kind: GroupingRuleKind,
): GroupingMode => {
  const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];
  const monitor: boolean = isOn(values, names.monitor);
  const severity: boolean = isOn(values, names.severity);
  const title: boolean = isOn(values, names.title);
  const labels: boolean = isOn(values, names.labels);
  const monitorLabels: boolean = isOn(values, names.monitorLabels);

  const switchedOn: number = [
    monitor,
    severity,
    title,
    labels,
    monitorLabels,
  ].filter(Boolean).length;

  if (switchedOn === 0) {
    return GroupingMode.Everything;
  }

  if (switchedOn === 1 && monitor) {
    return GroupingMode.Monitor;
  }

  if (switchedOn === 1 && severity) {
    return GroupingMode.Severity;
  }

  if (switchedOn === 1 && title) {
    return GroupingMode.Title;
  }

  return GroupingMode.Custom;
};

export const isGroupingMode: (value: unknown) => value is GroupingMode = (
  value: unknown,
): value is GroupingMode => {
  return (
    typeof value === "string" &&
    (Object.values(GroupingMode) as Array<string>).includes(value)
  );
};

/*
 * The answer the form shows: what the person picked, when they picked
 * something - Custom must stay Custom while its switches still happen to
 * spell out a named answer - and otherwise what the switches say.
 */
export const getSelectedGroupingMode: (
  values: GroupingRuleValues,
  kind: GroupingRuleKind,
) => GroupingMode = (
  values: GroupingRuleValues,
  kind: GroupingRuleKind,
): GroupingMode => {
  const picked: unknown = values[GROUPING_MODE_FIELD_KEY];

  if (isGroupingMode(picked)) {
    return picked;
  }

  return getGroupingMode(values, kind);
};

/*
 * The five switches for a named answer. Null for Custom, which leaves the
 * switches as they are for the person to change on the Group By step.
 */
export const getGroupByValuesForMode: (
  mode: GroupingMode,
  kind: GroupingRuleKind,
) => Record<string, boolean> | null = (
  mode: GroupingMode,
  kind: GroupingRuleKind,
): Record<string, boolean> | null => {
  if (mode === GroupingMode.Custom) {
    return null;
  }

  const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];

  return {
    [names.monitor]: mode === GroupingMode.Monitor,
    [names.severity]: mode === GroupingMode.Severity,
    [names.title]: mode === GroupingMode.Title,
    [names.labels]: false,
    [names.monitorLabels]: false,
  };
};

export const getGroupingRuleTemplate: (
  mode: GroupingMode,
) => GroupingRuleTemplate | null = (
  mode: GroupingMode,
): GroupingRuleTemplate | null => {
  return (
    GROUPING_RULE_TEMPLATES.find((template: GroupingRuleTemplate): boolean => {
      return template.mode === mode;
    }) || null
  );
};

// The time window a named answer starts with; null for Custom.
export const getDefaultTimeWindowMinutes: (
  mode: GroupingMode,
) => number | null = (mode: GroupingMode): number | null => {
  return getGroupingRuleTemplate(mode)?.timeWindowMinutes ?? null;
};

// The name the form suggests for an answer; null for Custom.
export const getSuggestedRuleName: (data: {
  mode: GroupingMode;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}) => string | null = (data: {
  mode: GroupingMode;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}): string | null => {
  const template: GroupingRuleTemplate | null = getGroupingRuleTemplate(
    data.mode,
  );

  return template ? data.translate(template.name[data.kind]) : null;
};

/*
 * Whether a name is one the form suggested - in the reader's language or in
 * English - rather than one somebody typed. Only a suggested name follows the
 * answer when it changes.
 */
export const isSuggestedRuleName: (data: {
  name: unknown;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}) => boolean = (data: {
  name: unknown;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}): boolean => {
  if (typeof data.name !== "string") {
    return false;
  }

  const name: string = data.name.trim();

  return GROUPING_RULE_TEMPLATES.some(
    (template: GroupingRuleTemplate): boolean => {
      const english: string = template.name[data.kind];
      return name === english || name === data.translate(english);
    },
  );
};

/*
 * What changes when the answer to "Group incidents by" changes:
 *
 *   - the five switches, for a named answer (Custom keeps them);
 *   - the name, while it is empty or still a suggestion;
 *   - the time window, while it is on and still the previous answer's
 *     starting value - picking Everything Together should not leave the
 *     half hour that suited Monitor.
 *
 * The answer itself is written by the form, under GROUPING_MODE_FIELD_KEY.
 */
export const getValuesForGroupingModeChange: (data: {
  values: GroupingRuleValues;
  mode: GroupingMode;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}) => GroupingRuleValues = (data: {
  values: GroupingRuleValues;
  mode: GroupingMode;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}): GroupingRuleValues => {
  const updates: GroupingRuleValues = {};

  const groupBy: Record<string, boolean> | null = getGroupByValuesForMode(
    data.mode,
    data.kind,
  );

  if (groupBy) {
    Object.assign(updates, groupBy);
  }

  const currentName: string =
    typeof data.values["name"] === "string"
      ? (data.values["name"] as string).trim()
      : "";

  const suggestedName: string | null = getSuggestedRuleName({
    mode: data.mode,
    kind: data.kind,
    translate: data.translate,
  });

  if (
    suggestedName &&
    (!currentName ||
      isSuggestedRuleName({
        name: currentName,
        kind: data.kind,
        translate: data.translate,
      }))
  ) {
    updates["name"] = suggestedName;
  }

  const previousDefault: number | null = getDefaultTimeWindowMinutes(
    getSelectedGroupingMode(data.values, data.kind),
  );
  const nextDefault: number | null = getDefaultTimeWindowMinutes(data.mode);
  const currentMinutes: number | null = parseMinutes(
    data.values["timeWindowMinutes"],
  );

  if (
    nextDefault !== null &&
    isOn(data.values, "enableTimeWindow") &&
    (currentMinutes === null || currentMinutes === previousDefault)
  ) {
    updates["timeWindowMinutes"] = nextDefault;
  }

  return updates;
};

/*
 * What a blank rule starts as: enabled, grouping by monitor within half an
 * hour. Without isEnabled here the form's Enabled switch rendered off and the
 * form saved what it showed - every rule created from the old form was off
 * until somebody noticed it was doing nothing.
 */
export const getNewGroupingRuleValues: (data: {
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}) => GroupingRuleValues = (data: {
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}): GroupingRuleValues => {
  return {
    name:
      getSuggestedRuleName({
        mode: GroupingMode.Monitor,
        kind: data.kind,
        translate: data.translate,
      }) || "",
    isEnabled: true,
    ...getGroupByValuesForMode(GroupingMode.Monitor, data.kind),
    enableTimeWindow: true,
    timeWindowMinutes: DEFAULT_TIME_WINDOW_MINUTES,
  };
};

// The columns a template sets on the rule it adds.
export const getTemplateRuleValues: (data: {
  template: GroupingRuleTemplate;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}) => GroupingRuleValues = (data: {
  template: GroupingRuleTemplate;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}): GroupingRuleValues => {
  return {
    name: data.translate(data.template.name[data.kind]),
    isEnabled: true,
    ...getGroupByValuesForMode(data.template.mode, data.kind),
    enableTimeWindow: true,
    timeWindowMinutes: data.template.timeWindowMinutes,
  };
};

/*
 * A whole number of minutes the columns can hold, or null. Accepts what a
 * number input hands over (a string) as well as a stored number.
 */
const WHOLE_NUMBER_TEXT: RegExp = /^\s*\d+\s*$/;

export const parseMinutes: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  let parsed: number = NaN;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && WHOLE_NUMBER_TEXT.test(value)) {
    parsed = Number(value.trim());
  }

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SETTING_MINUTES) {
    return null;
  }

  return parsed;
};

/*
 * Whether minutes came from the rule as it is stored, rather than being typed
 * into the box: the box hands over text that is not a whole number as typed,
 * so a number, or nothing, was loaded.
 */
const isStoredMinutes: (minutes: unknown) => boolean = (
  minutes: unknown,
): boolean => {
  return typeof minutes !== "string";
};

/*
 * The minutes of a switched-on setting must be a usable number. A switched-off
 * setting is not checked: the engines do not read its minutes.
 *
 * Neither is a value a rule was saved with that the engines fall back on - a
 * window switched on with no minutes, or 0 (the old form saved 0 when its
 * switch was ticked and its box left empty). Refusing those would stop
 * somebody renaming a rule that has worked the same way for years; the form
 * shows what the engines do with them instead (getMinutesSettingDisplay).
 */
export const getMinutesValidationError: (data: {
  enabled: unknown;
  minutes: unknown;
  translate: GroupingRuleTranslateFunction;
}) => string | null = (data: {
  enabled: unknown;
  minutes: unknown;
  translate: GroupingRuleTranslateFunction;
}): string | null => {
  if (data.enabled !== true) {
    return null;
  }

  if (isStoredMinutes(data.minutes)) {
    const stored: unknown = data.minutes;

    if (
      stored === undefined ||
      stored === null ||
      (typeof stored === "number" && Number.isInteger(stored))
    ) {
      return null;
    }
  }

  if (parseMinutes(data.minutes) === null) {
    return data.translate(MINUTES_VALIDATION_MESSAGE, {
      max: MAX_SETTING_MINUTES,
    });
  }

  return null;
};

/*
 * What a minutes setting shows: what the engines do with it. A switch that is
 * on with no usable minutes saved is, to the engines, either the time
 * window's fallback hour (fallbackMinutes) or not on at all - reopening,
 * waiting to resolve and resolving when quiet all need minutes above 0 - so
 * that is what the switch and the box show. Nothing is written until the
 * person changes the setting, so a rule opened and saved keeps what it had.
 */
export const getMinutesSettingDisplay: (data: {
  enabled: unknown;
  minutes: unknown;
  fallbackMinutes: number | null;
}) => { enabled: boolean; minutes: unknown } = (data: {
  enabled: unknown;
  minutes: unknown;
  fallbackMinutes: number | null;
}): { enabled: boolean; minutes: unknown } => {
  if (data.enabled !== true) {
    return { enabled: false, minutes: data.minutes };
  }

  if (!isStoredMinutes(data.minutes) || parseMinutes(data.minutes) !== null) {
    return { enabled: true, minutes: data.minutes };
  }

  const stored: number = Number(data.minutes);

  if (Number.isInteger(stored) && stored > 0) {
    // Saved before the box had a ceiling: the engines use it as it is.
    return { enabled: true, minutes: stored };
  }

  if (data.fallbackMinutes !== null) {
    return { enabled: true, minutes: data.fallbackMinutes };
  }

  return { enabled: false, minutes: data.minutes };
};

/*
 * The values a minutes setting saves: its switch, and its minutes - as typed
 * while it is on (so validation can say what is wrong), and always a usable
 * number while it is off, so a cleared box is never saved into the column.
 */
export const getMinutesSettingValues: (data: {
  enabled: boolean;
  minutes: unknown;
  defaultMinutes: number;
}) => { enabled: boolean; minutes: number | string } = (data: {
  enabled: boolean;
  minutes: unknown;
  defaultMinutes: number;
}): { enabled: boolean; minutes: number | string } => {
  const parsed: number | null = parseMinutes(data.minutes);

  if (parsed !== null) {
    return { enabled: data.enabled, minutes: parsed };
  }

  if (data.enabled && typeof data.minutes === "string") {
    return { enabled: true, minutes: data.minutes };
  }

  return { enabled: data.enabled, minutes: data.defaultMinutes };
};

// "30 minutes", "2 hours", "1 day" - in the reader's language.
export const formatGroupingDuration: (data: {
  minutes: number;
  translate: GroupingRuleTranslateFunction;
}) => string = (data: {
  minutes: number;
  translate: GroupingRuleTranslateFunction;
}): string => {
  const minutes: number = data.minutes;

  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days: number = minutes / 1440;
    return days === 1
      ? data.translate(GROUPING_SUMMARY_COPY.day)
      : data.translate(GROUPING_SUMMARY_COPY.days, { count: days });
  }

  if (minutes >= 60 && minutes % 60 === 0) {
    const hours: number = minutes / 60;
    return hours === 1
      ? data.translate(GROUPING_SUMMARY_COPY.hour)
      : data.translate(GROUPING_SUMMARY_COPY.hours, { count: hours });
  }

  return minutes === 1
    ? data.translate(GROUPING_SUMMARY_COPY.minute)
    : data.translate(GROUPING_SUMMARY_COPY.minutes, { count: minutes });
};

// A positive number of minutes the engines act on, or null when off.
type ReadMinutesSettingFunction = (
  values: GroupingRuleValues,
  enabledKey: string,
  minutesKey: string,
) => number | null;

const getActiveMinutes: ReadMinutesSettingFunction = (
  values: GroupingRuleValues,
  enabledKey: string,
  minutesKey: string,
): number | null => {
  if (!isOn(values, enabledKey)) {
    return null;
  }

  const minutes: number = Number(values[minutesKey]);

  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
};

/*
 * The time window the engines group with: off, or the rule's minutes - with
 * the engines' own fallback for a window switched on with none.
 */
export const getEffectiveTimeWindowMinutes: (
  values: GroupingRuleValues,
) => number | null = (values: GroupingRuleValues): number | null => {
  if (!isOn(values, "enableTimeWindow")) {
    return null;
  }

  const minutes: number = Number(values["timeWindowMinutes"]);

  return Number.isFinite(minutes) && minutes > 0
    ? minutes
    : ENGINE_FALLBACK_TIME_WINDOW_MINUTES;
};

export interface GroupingRuleSummary {
  // How incidents are split into episodes: "One episode per monitor".
  grouping: string;
  // How long an episode keeps taking incidents.
  timing: string;
  /*
   * The settings a reader cannot infer from the two lines above, and only
   * those that are on: reopening, waiting to resolve, resolving when quiet,
   * paging, status pages.
   */
  details: Array<string>;
}

/*
 * The list's Grouping column: what a rule does, in two short lines and a few
 * notes, read with the same rules the engines read it with.
 */
export const getGroupingRuleSummary: (data: {
  rule: GroupingRuleValues;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}) => GroupingRuleSummary = (data: {
  rule: GroupingRuleValues;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}): GroupingRuleSummary => {
  const translate: GroupingRuleTranslateFunction = data.translate;
  const rule: GroupingRuleValues = data.rule;
  const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[data.kind];

  let grouping: string = "";

  switch (getGroupingMode(rule, data.kind)) {
    case GroupingMode.Monitor:
      grouping = translate(GROUPING_SUMMARY_COPY.perMonitor);
      break;
    case GroupingMode.Severity:
      grouping = translate(GROUPING_SUMMARY_COPY.perSeverity);
      break;
    case GroupingMode.Title:
      grouping = translate(GROUPING_SUMMARY_COPY.perTitle);
      break;
    case GroupingMode.Everything:
      grouping = translate(GROUPING_SUMMARY_COPY.everything[data.kind]);
      break;
    case GroupingMode.Custom: {
      const fields: Array<string> = [];

      if (isOn(rule, names.monitor)) {
        fields.push(translate(GROUPING_SUMMARY_COPY.fieldMonitor));
      }

      if (isOn(rule, names.severity)) {
        fields.push(translate(GROUPING_SUMMARY_COPY.fieldSeverity));
      }

      if (isOn(rule, names.title)) {
        fields.push(translate(GROUPING_SUMMARY_COPY.fieldTitle));
      }

      if (isOn(rule, names.labels)) {
        fields.push(translate(GROUPING_SUMMARY_COPY.fieldLabels[data.kind]));
      }

      if (isOn(rule, names.monitorLabels)) {
        fields.push(translate(GROUPING_SUMMARY_COPY.fieldMonitorLabels));
      }

      grouping = translate(GROUPING_SUMMARY_COPY.perCombination, {
        fields: fields.join(", "),
      });
      break;
    }
  }

  const timeWindowMinutes: number | null = getEffectiveTimeWindowMinutes(rule);

  const timing: string =
    timeWindowMinutes === null
      ? translate(GROUPING_SUMMARY_COPY.timeWindowOff[data.kind])
      : translate(GROUPING_SUMMARY_COPY.timeWindowOn[data.kind], {
          duration: formatGroupingDuration({
            minutes: timeWindowMinutes,
            translate,
          }),
        });

  const details: Array<string> = [];

  const reopenMinutes: number | null = getActiveMinutes(
    rule,
    "enableReopenWindow",
    "reopenWindowMinutes",
  );

  if (reopenMinutes !== null) {
    details.push(
      translate(GROUPING_SUMMARY_COPY.reopens, {
        duration: formatGroupingDuration({ minutes: reopenMinutes, translate }),
      }),
    );
  }

  const resolveDelayMinutes: number | null = getActiveMinutes(
    rule,
    "enableResolveDelay",
    "resolveDelayMinutes",
  );

  if (resolveDelayMinutes !== null) {
    details.push(
      translate(GROUPING_SUMMARY_COPY.waitsBeforeResolving, {
        duration: formatGroupingDuration({
          minutes: resolveDelayMinutes,
          translate,
        }),
      }),
    );
  }

  const inactivityMinutes: number | null = getActiveMinutes(
    rule,
    "enableInactivityTimeout",
    "inactivityTimeoutMinutes",
  );

  if (inactivityMinutes !== null) {
    details.push(
      translate(GROUPING_SUMMARY_COPY.resolvesWhenQuiet[data.kind], {
        duration: formatGroupingDuration({
          minutes: inactivityMinutes,
          translate,
        }),
      }),
    );
  }

  const onCallPolicies: unknown = rule["onCallDutyPolicies"];
  const onCallPolicyCount: number = Array.isArray(onCallPolicies)
    ? onCallPolicies.length
    : 0;

  if (onCallPolicyCount === 1) {
    details.push(translate(GROUPING_SUMMARY_COPY.runsOneOnCallPolicy));
  } else if (onCallPolicyCount > 1) {
    details.push(
      translate(GROUPING_SUMMARY_COPY.runsOnCallPolicies, {
        count: onCallPolicyCount,
      }),
    );
  }

  if (isOn(rule, "showEpisodeOnStatusPage")) {
    details.push(translate(GROUPING_SUMMARY_COPY.showsOnStatusPages));
  }

  return { grouping, timing, details };
};

// The same, as one line of text: the column's CSV cell.
export const getGroupingRuleSummaryText: (data: {
  rule: GroupingRuleValues;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}) => string = (data: {
  rule: GroupingRuleValues;
  kind: GroupingRuleKind;
  translate: GroupingRuleTranslateFunction;
}): string => {
  const summary: GroupingRuleSummary = getGroupingRuleSummary(data);

  return [summary.grouping, summary.timing, ...summary.details].join(". ");
};

// The columns the summary reads, for the list's select.
export const getGroupingRuleSummarySelect: (
  kind: GroupingRuleKind,
) => Record<string, unknown> = (
  kind: GroupingRuleKind,
): Record<string, unknown> => {
  const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];

  const select: Record<string, unknown> = {
    [names.monitor]: true,
    [names.severity]: true,
    [names.title]: true,
    [names.labels]: true,
    [names.monitorLabels]: true,
    enableTimeWindow: true,
    timeWindowMinutes: true,
    enableReopenWindow: true,
    reopenWindowMinutes: true,
    enableResolveDelay: true,
    resolveDelayMinutes: true,
    enableInactivityTimeout: true,
    inactivityTimeoutMinutes: true,
    onCallDutyPolicies: {
      _id: true,
    },
  };

  if (kind === GroupingRuleKind.Incident) {
    select["showEpisodeOnStatusPage"] = true;
  }

  return select;
};

type HasValueFunction = (value: unknown) => boolean;

const hasValue: HasValueFunction = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
};

/*
 * Whether a rule uses anything behind "Show advanced settings". An existing
 * rule that does opens with them shown, so nothing it does is ever hidden
 * from the person editing it - its episode owners included, and the old
 * default assignee, whose line is drawn on the same step.
 */
export const hasAdvancedSettings: (values: GroupingRuleValues) => boolean = (
  values: GroupingRuleValues,
): boolean => {
  /*
   * A lifecycle switch counts only while the engines act on it - on, with
   * minutes above 0 - which is also when the form shows it on.
   */
  return (
    getActiveMinutes(values, "enableReopenWindow", "reopenWindowMinutes") !==
      null ||
    getActiveMinutes(values, "enableResolveDelay", "resolveDelayMinutes") !==
      null ||
    getActiveMinutes(
      values,
      "enableInactivityTimeout",
      "inactivityTimeoutMinutes",
    ) !== null ||
    isOn(values, "showEpisodeOnStatusPage") ||
    [
      "description",
      "episodeTitleTemplate",
      "episodeDescriptionTemplate",
      "episodeLabels",
      "onCallDutyPolicies",
      EPISODE_OWNER_USERS_COLUMN,
      EPISODE_OWNER_TEAMS_COLUMN,
      ...LEGACY_DEFAULT_ASSIGNEE_KEYS,
      "episodeMemberRoleAssignments",
    ].some((key: string): boolean => {
      return hasValue(values[key]);
    })
  );
};

type ReadIdFunction = (value: unknown) => string | null;

// One id, in any shape a form value or a related row holds it.
const readId: ReadIdFunction = (value: unknown): string | null => {
  return toPeoplePickerIds(value)[0] || null;
};

export interface LegacyDefaultAssignee {
  userId: string | null;
  teamId: string | null;
}

/*
 * The default assignee a rule still has from the old form - its user, its
 * team, or both - or null when it has none.
 */
export const getLegacyDefaultAssignee: (
  values: GroupingRuleValues,
) => LegacyDefaultAssignee | null = (
  values: GroupingRuleValues,
): LegacyDefaultAssignee | null => {
  const userId: string | null =
    readId(values[LEGACY_DEFAULT_ASSIGNEE_USER_COLUMN]) ||
    readId(values[LEGACY_DEFAULT_ASSIGNEE_USER_RELATION]);
  const teamId: string | null =
    readId(values[LEGACY_DEFAULT_ASSIGNEE_TEAM_COLUMN]) ||
    readId(values[LEGACY_DEFAULT_ASSIGNEE_TEAM_RELATION]);

  if (!userId && !teamId) {
    return null;
  }

  return { userId, teamId };
};

export enum LegacyDefaultAssigneeAction {
  AddAsOwners = "add-as-owners",
  Remove = "remove",
}

/*
 * What the line's buttons hand the form. Add as owners names the picks to
 * make owners: the ones the project still has, as the line looked them up
 * (someone who left, or a deleted team, cannot own anything).
 */
export interface LegacyDefaultAssigneeChange {
  action: LegacyDefaultAssigneeAction;
  userId?: string | null | undefined;
  teamId?: string | null | undefined;
}

export const isLegacyDefaultAssigneeChange: (
  value: unknown,
) => value is LegacyDefaultAssigneeChange = (
  value: unknown,
): value is LegacyDefaultAssigneeChange => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const action: unknown = (value as Record<string, unknown>)["action"];

  return (
    action === LegacyDefaultAssigneeAction.AddAsOwners ||
    action === LegacyDefaultAssigneeAction.Remove
  );
};

type AddOwnerIdFunction = (list: unknown, id: string | null) => Array<string>;

// The list's ids with one more, unless it is there already in any case.
const addOwnerId: AddOwnerIdFunction = (
  list: unknown,
  id: string | null,
): Array<string> => {
  const ids: Array<string> = toPeoplePickerIds(list);

  if (
    id &&
    !ids.some((existing: string): boolean => {
      return existing.toLowerCase() === id.toLowerCase();
    })
  ) {
    ids.push(id);
  }

  return ids;
};

/*
 * The form values either button writes. Both clear the old pair, so it is
 * gone from the rule once it is saved and the line does not come back; Add
 * as owners also adds its picks to Episode Owners, each once.
 */
export const getValuesForLegacyDefaultAssigneeChange: (data: {
  values: GroupingRuleValues;
  change: LegacyDefaultAssigneeChange;
}) => GroupingRuleValues = (data: {
  values: GroupingRuleValues;
  change: LegacyDefaultAssigneeChange;
}): GroupingRuleValues => {
  const updates: GroupingRuleValues = {
    [LEGACY_DEFAULT_ASSIGNEE_USER_COLUMN]: null,
    [LEGACY_DEFAULT_ASSIGNEE_TEAM_COLUMN]: null,
  };

  for (const key of LEGACY_DEFAULT_ASSIGNEE_KEYS) {
    if (data.values[key] !== undefined) {
      updates[key] = null;
    }
  }

  if (data.change.action !== LegacyDefaultAssigneeAction.AddAsOwners) {
    return updates;
  }

  if (data.change.userId) {
    updates[EPISODE_OWNER_USERS_COLUMN] = addOwnerId(
      data.values[EPISODE_OWNER_USERS_COLUMN],
      data.change.userId,
    );
  }

  if (data.change.teamId) {
    updates[EPISODE_OWNER_TEAMS_COLUMN] = addOwnerId(
      data.values[EPISODE_OWNER_TEAMS_COLUMN],
      data.change.teamId,
    );
  }

  return updates;
};

/*
 * Every English string these pages show that is not already shared with the
 * rest of the Dashboard. The locale test holds each of them to a real
 * translation in every language.
 */
export const getGroupingRuleUiStrings: () => Array<string> =
  (): Array<string> => {
    const strings: Set<string> = new Set<string>();

    type AddFunction = (value: string | KindCopy) => void;

    const add: AddFunction = (value: string | KindCopy): void => {
      if (typeof value === "string") {
        strings.add(value);
        return;
      }

      strings.add(value[GroupingRuleKind.Incident]);
      strings.add(value[GroupingRuleKind.Alert]);
    };

    for (const value of Object.values(GROUPING_RULE_COPY)) {
      add(value);
    }

    for (const option of GROUPING_MODE_OPTIONS) {
      add(option.title);
      add(option.description);
    }

    for (const template of GROUPING_RULE_TEMPLATES) {
      add(template.name);
      add(template.description);
    }

    for (const value of Object.values(GROUPING_SUMMARY_COPY)) {
      add(value);
    }

    add(MINUTES_VALIDATION_MESSAGE);

    return Array.from(strings);
  };
