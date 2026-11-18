/*
 * MonitorIncident and MonitorAlert render titles through MonitorTemplateUtil,
 * which pulls the native isolated-vm addon in through VMAPI. Nothing here
 * runs the sandbox, and the prebuilt binary cannot always load in the test
 * environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertPrivacyRule from "../../../Models/DatabaseModels/AlertPrivacyRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentPrivacyRule from "../../../Models/DatabaseModels/IncidentPrivacyRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import User from "../../../Models/DatabaseModels/User";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CriteriaAlert } from "../../../Types/Monitor/CriteriaAlert";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertIncidentRuleEngineService, {
  AlertIncidentRuleOutcome,
  AlertIncidentRuleResult,
} from "../../../Server/Services/AlertIncidentRuleEngineService";
import AlertIncidentRuleService from "../../../Server/Services/AlertIncidentRuleService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertLabelRuleService from "../../../Server/Services/AlertLabelRuleService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertOwnerRuleService from "../../../Server/Services/AlertOwnerRuleService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertPrivacyRuleService from "../../../Server/Services/AlertPrivacyRuleService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentLabelRuleService from "../../../Server/Services/IncidentLabelRuleService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentOwnerRuleService from "../../../Server/Services/IncidentOwnerRuleService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentPrivacyRuleService from "../../../Server/Services/IncidentPrivacyRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkDeviceOwnerUserService from "../../../Server/Services/NetworkDeviceOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallTestPageService from "../../../Server/Services/OnCallTestPageService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import WhoIsToldService from "../../../Server/Services/WhoIsToldService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DataAlertCause from "../../../Server/Utils/DataObservability/DataAlertCause";
import logger from "../../../Server/Utils/Logger";
import MonitorAlert from "../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../Server/Utils/Monitor/MonitorResourceContext";
import { OnCallRulesPaging } from "../../../Server/Utils/OnCall/OnCallRulePageAs";
import RuleAddedLabels from "../../../Server/Utils/Rules/RuleAddedLabels";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import IncidentStatusPageScope from "../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  WhoIsToldEvent,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldRule,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT "WHEN THIS GOES DOWN" SAYS A NEW RECORD'S RULES DO IS WHAT THEY DO
 * (#7212, #7213, #7216).
 *
 * The card (WhoIsToldService) holds the incident or alert a monitor's
 * criteria would open in memory and asks each engine's own read-only plan
 * of it, in the create's order: the privacy rules, then the label rules,
 * then the on-call rules - and, for an alert, its alert incident rules
 * last. A real one is made by MonitorIncident (MonitorAlert) from the same
 * criteria, and the engines are applied to it as the create's chain applies
 * them (IncidentService.onCreateSuccess, AlertService.onCreateSuccess).
 *
 * Over generated monitors, criteria and rules - severities, monitor names
 * and labels, the record's labels, title patterns on the title it gets,
 * labels label rules add and inherit, on-call rules keyed on any of those
 * labels, privacy rules, alert incident rules with and without a wait and a
 * severity of their own - drawn from a seed so a failure can be run again:
 * whether the card says the record is private is whether the real one is
 * (and then it shows on no status page); the policies the card says its
 * on-call rules page are the policies the real one's page; the incident the
 * card says an alert becomes is the one the engine declares, by the same
 * rule, wait and severity, and what that incident pages agrees too. And
 * both are what a plain reading of the rules says.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72120000-0000-4000-8000-000000000001",
);
const MONITOR_ID: string = "72120000-0000-4000-8000-000000000002";
const OTHER_MONITOR: string = "72120000-0000-4000-8000-000000000003";
const STEP_ID: string = "72120000-0000-4000-8000-000000000004";
const STATUS_PAGE_ID: string = "72120000-0000-4000-8000-000000000005";

const INCIDENT_SEVERITIES: Array<[string, string]> = [
  ["72120000-0000-4000-8000-0000000000b1", "Critical"],
  ["72120000-0000-4000-8000-0000000000b2", "Minor"],
];
const ALERT_SEVERITIES: Array<[string, string]> = [
  ["72120000-0000-4000-8000-0000000000b8", "Critical"],
  ["72120000-0000-4000-8000-0000000000b9", "Warning"],
];
const MONITOR_LABELS: Array<string> = [
  "72120000-0000-4000-8000-0000000000c1",
  "72120000-0000-4000-8000-0000000000c2",
];
const RECORD_LABELS: Array<string> = ["72120000-0000-4000-8000-0000000000d1"];
const ADDED_LABELS: Array<string> = [
  "72120000-0000-4000-8000-0000000000e1",
  "72120000-0000-4000-8000-0000000000e2",
];
const ALL_LABELS: Array<string> = [
  ...MONITOR_LABELS,
  ...RECORD_LABELS,
  ...ADDED_LABELS,
];
const POLICIES: Array<string> = [
  "72120000-0000-4000-8000-0000000000f1",
  "72120000-0000-4000-8000-0000000000f2",
  "72120000-0000-4000-8000-0000000000f3",
];

const MONITOR_NAMES: Array<string> = ["Checkout API", "Search API"];
const TITLE_TEMPLATES: Array<string> = [
  "{{monitorName}} is offline",
  "Checkout is down",
  "{{monitorName}} failed",
];
const TITLE_PATTERNS: Array<string> = [
  "^Checkout",
  "offline$",
  // Only the template as written says this.
  "monitorName",
  "^Search API",
];
const WAITS: Array<number> = [0, 0, 15, 30];

const CASES: number = 150;

type Kind = "incident" | "alert";

// A generated rule's conditions, as plain facts.
interface Conditions {
  severities: Array<string>;
  monitors: Array<string>;
  labels: Array<string>;
  monitorLabels: Array<string>;
  titlePattern: string | null;
}

interface LabelRuleFacts extends Conditions {
  adds: Array<string>;
  inheritsFromMonitors: boolean;
}

interface OnCallRuleFacts extends Conditions {
  policies: Array<string>;
}

interface IncidentRuleFacts extends Conditions {
  waitInMinutes: number;
  // An incident severity of its own, or none: the alert's is mapped.
  incidentSeverity: string | null;
}

interface CaseFacts {
  monitorName: string;
  monitorLabels: Array<string>;
  titleTemplate: string;
  // Of the record's kind.
  severity: string;
  labels: Array<string>;
  isPrivate: boolean;
  privacyRules: Array<Conditions>;
  labelRules: Array<LabelRuleFacts>;
  onCallRules: Array<OnCallRuleFacts>;
  // Alerts only: the alert incident rules, and the incident on-call rules.
  incidentRules: Array<IncidentRuleFacts>;
  incidentOnCallRules: Array<OnCallRuleFacts>;
}

function pick<T>(items: Array<T>, random: SeededRandom): T {
  return items[random(items.length)]!;
}

function rarelySomeOf(
  items: Array<string>,
  odds: number,
  random: SeededRandom,
): Array<string> {
  return random(odds) === 0 ? [pick(items, random)] : [];
}

function someOf(items: Array<string>, random: SeededRandom): Array<string> {
  if (random(2) === 0) {
    return [];
  }

  const chosen: Array<string> = [pick(items, random)];

  if (random(2) === 0) {
    const second: string = pick(items, random);

    if (!chosen.includes(second)) {
      chosen.push(second);
    }
  }

  return chosen;
}

function severityIds(kind: Kind): Array<string> {
  return (kind === "incident" ? INCIDENT_SEVERITIES : ALERT_SEVERITIES).map(
    (severity: [string, string]): string => {
      return severity[0];
    },
  );
}

function generateConditions(
  random: SeededRandom,
  kind: Kind,
  labels: Array<string>,
): Conditions {
  return {
    severities: rarelySomeOf(severityIds(kind), 3, random),
    monitors: rarelySomeOf([MONITOR_ID, OTHER_MONITOR], 5, random),
    labels: rarelySomeOf(labels, 3, random),
    monitorLabels: rarelySomeOf(MONITOR_LABELS, 5, random),
    titlePattern: random(3) === 0 ? pick(TITLE_PATTERNS, random) : null,
  };
}

function generateCase(random: SeededRandom, kind: Kind): CaseFacts {
  const count: (most: number) => number = (most: number): number => {
    return random(most + 1);
  };

  const privacyRules: Array<Conditions> = [];
  const labelRules: Array<LabelRuleFacts> = [];
  const onCallRules: Array<OnCallRuleFacts> = [];
  const incidentRules: Array<IncidentRuleFacts> = [];
  const incidentOnCallRules: Array<OnCallRuleFacts> = [];

  for (let index: number = count(2); index > 0; index--) {
    // Privacy rules run first: only the criteria's labels are there yet.
    privacyRules.push(generateConditions(random, kind, RECORD_LABELS));
  }

  for (let index: number = count(3); index > 0; index--) {
    labelRules.push({
      ...generateConditions(random, kind, RECORD_LABELS),
      adds: someOf(ADDED_LABELS, random),
      inheritsFromMonitors: random(4) === 0,
    });
  }

  for (let index: number = count(3); index > 0; index--) {
    onCallRules.push({
      ...generateConditions(random, kind, ALL_LABELS),
      // Most on-call rules here ask for a label, which is what label rules change.
      labels: random(4) === 0 ? [] : [pick(ALL_LABELS, random)],
      policies: random(5) === 0 ? [] : [pick(POLICIES, random)],
    });
  }

  if (kind === "alert") {
    for (let index: number = count(3); index > 0; index--) {
      incidentRules.push({
        ...generateConditions(random, kind, ALL_LABELS),
        waitInMinutes: pick(WAITS, random),
        incidentSeverity:
          random(2) === 0 ? pick(severityIds("incident"), random) : null,
      });
    }

    for (let index: number = count(2); index > 0; index--) {
      incidentOnCallRules.push({
        ...generateConditions(random, "incident", ALL_LABELS),
        policies: [pick(POLICIES, random)],
      });
    }
  }

  return {
    monitorName: pick(MONITOR_NAMES, random),
    monitorLabels: someOf(MONITOR_LABELS, random),
    titleTemplate: pick(TITLE_TEMPLATES, random),
    severity: pick(severityIds(kind), random),
    labels: someOf(RECORD_LABELS, random),
    isPrivate: random(6) === 0,
    privacyRules: privacyRules,
    labelRules: labelRules,
    onCallRules: onCallRules,
    incidentRules: incidentRules,
    incidentOnCallRules: incidentOnCallRules,
  };
}

// The title the record gets: what is known of the monitor before a check put in.
function renderedTitle(facts: CaseFacts): string {
  return facts.titleTemplate.split("{{monitorName}}").join(facts.monitorName);
}

/*
 * A PLAIN READING OF THE RULES. A rule matches when every condition it sets
 * holds of the record as it is when the rule runs.
 */
interface RecordState {
  severity: string;
  labels: Array<string>;
  title: string;
}

function overlaps(wanted: Array<string>, had: Array<string>): boolean {
  return (
    wanted.length === 0 ||
    wanted.some((id: string): boolean => {
      return had.includes(id);
    })
  );
}

function oracleMatches(
  rule: Conditions,
  state: RecordState,
  facts: CaseFacts,
): boolean {
  if (rule.severities.length > 0 && !rule.severities.includes(state.severity)) {
    return false;
  }

  if (rule.monitors.length > 0 && !rule.monitors.includes(MONITOR_ID)) {
    return false;
  }

  if (
    !overlaps(rule.labels, state.labels) ||
    !overlaps(rule.monitorLabels, facts.monitorLabels)
  ) {
    return false;
  }

  return !rule.titlePattern || new RegExp(rule.titlePattern).test(state.title);
}

function sortedUnique(ids: Array<string>): Array<string> {
  return Array.from(new Set<string>(ids)).sort();
}

// Private: the criteria says so, or a privacy rule matches the record as it opens.
function oracleIsPrivate(facts: CaseFacts, state: RecordState): boolean {
  return (
    facts.isPrivate ||
    facts.privacyRules.some((rule: Conditions): boolean => {
      return oracleMatches(rule, state, facts);
    })
  );
}

// Its labels once its label rules have run, each matched on the record as it opened.
function oracleLabels(facts: CaseFacts, state: RecordState): Array<string> {
  const labels: Array<string> = [...state.labels];

  for (const rule of facts.labelRules) {
    if (!oracleMatches(rule, state, facts)) {
      continue;
    }

    labels.push(...rule.adds);

    if (rule.inheritsFromMonitors) {
      labels.push(...facts.monitorLabels);
    }
  }

  return sortedUnique(labels);
}

// The policies its on-call rules page, on its labels as the label rules leave them.
function oraclePolicies(
  rules: Array<OnCallRuleFacts>,
  state: RecordState,
  facts: CaseFacts,
): Array<string> {
  return sortedUnique(
    rules.flatMap((rule: OnCallRuleFacts): Array<string> => {
      return oracleMatches(rule, state, facts) ? rule.policies : [];
    }),
  );
}

// The first alert incident rule that matches the alert as it is once its own rules ran.
function oracleIncidentRule(
  facts: CaseFacts,
  state: RecordState,
): number | null {
  const index: number = facts.incidentRules.findIndex(
    (rule: IncidentRuleFacts): boolean => {
      return oracleMatches(rule, state, facts);
    },
  );

  return index === -1 ? null : index;
}

// The incident severity it gets: the rule's, else the alert's by name.
function oracleIncidentSeverity(
  rule: IncidentRuleFacts,
  facts: CaseFacts,
): string {
  if (rule.incidentSeverity) {
    return rule.incidentSeverity;
  }

  const alertName: string = ALERT_SEVERITIES.find(
    (severity: [string, string]): boolean => {
      return severity[0] === facts.severity;
    },
  )![1];

  return (
    INCIDENT_SEVERITIES.find((severity: [string, string]): boolean => {
      return severity[1] === alertName;
    })?.[0] ||
    // None of that name: the least severe.
    INCIDENT_SEVERITIES[INCIDENT_SEVERITIES.length - 1]![0]
  );
}

/*
 * THE RECORDS, AS THE PROJECT'S ROWS HOLD THEM.
 */
function withId<T extends { _id?: string | undefined }>(
  item: T,
  id: string,
): T {
  item._id = id;
  return item;
}

function labelsOf(ids: Array<string>): Array<Label> {
  return ids.map((id: string): Label => {
    return withId(new Label(), id);
  });
}

function monitorsOf(ids: Array<string>): Array<Monitor> {
  return ids.map((id: string): Monitor => {
    return withId(new Monitor(), id);
  });
}

function policiesOf(ids: Array<string>): Array<OnCallDutyPolicy> {
  return ids.map((id: string): OnCallDutyPolicy => {
    return withId(new OnCallDutyPolicy(), id);
  });
}

function ruleId(prefix: string, index: number): string {
  return `72120000-0000-4000-8000-0000000${prefix}${index.toString().padStart(2, "0")}`;
}

// The conditions both kinds of rule hold, by the columns of their kind.
function withConditions<T extends Record<string, unknown>>(
  rule: T,
  facts: Conditions,
  kind: Kind,
): T {
  const record: Record<string, unknown> = rule as Record<string, unknown>;

  if (kind === "incident") {
    record["incidentSeverities"] = facts.severities.map(
      (id: string): IncidentSeverity => {
        return withId(new IncidentSeverity(), id);
      },
    );
    record["incidentLabels"] = labelsOf(facts.labels);

    if (facts.titlePattern) {
      record["incidentTitlePattern"] = facts.titlePattern;
    }
  } else {
    record["alertSeverities"] = facts.severities.map(
      (id: string): AlertSeverity => {
        return withId(new AlertSeverity(), id);
      },
    );
    record["alertLabels"] = labelsOf(facts.labels);

    if (facts.titlePattern) {
      record["alertTitlePattern"] = facts.titlePattern;
    }
  }

  record["monitors"] = monitorsOf(facts.monitors);
  record["monitorLabels"] = labelsOf(facts.monitorLabels);
  record["projectId"] = PROJECT_ID;
  record["isEnabled"] = true;
  return rule;
}

function privacyRulesOf(
  facts: CaseFacts,
  kind: Kind,
): Array<IncidentPrivacyRule | AlertPrivacyRule> {
  return facts.privacyRules.map(
    (
      rule: Conditions,
      index: number,
    ): IncidentPrivacyRule | AlertPrivacyRule => {
      const item: IncidentPrivacyRule | AlertPrivacyRule =
        kind === "incident"
          ? withId(new IncidentPrivacyRule(), ruleId("a", index))
          : withId(new AlertPrivacyRule(), ruleId("a", index));
      item.name = `Privacy rule ${index}`;
      return withConditions(
        item as unknown as Record<string, unknown>,
        rule,
        kind,
      ) as unknown as IncidentPrivacyRule | AlertPrivacyRule;
    },
  );
}

function labelRulesOf(
  facts: CaseFacts,
  kind: Kind,
): Array<IncidentLabelRule | AlertLabelRule> {
  return facts.labelRules.map(
    (
      rule: LabelRuleFacts,
      index: number,
    ): IncidentLabelRule | AlertLabelRule => {
      const item: IncidentLabelRule | AlertLabelRule =
        kind === "incident"
          ? withId(new IncidentLabelRule(), ruleId("b", index))
          : withId(new AlertLabelRule(), ruleId("b", index));
      item.name = `Label rule ${index}`;
      item.labelsToAdd = labelsOf(rule.adds);
      item.inheritLabelsFromMonitors = rule.inheritsFromMonitors;
      return withConditions(
        item as unknown as Record<string, unknown>,
        rule,
        kind,
      ) as unknown as IncidentLabelRule | AlertLabelRule;
    },
  );
}

function onCallRulesOf(
  rules: Array<OnCallRuleFacts>,
  kind: Kind,
  prefix: string,
): Array<IncidentOnCallRule | AlertOnCallRule> {
  return rules.map(
    (
      rule: OnCallRuleFacts,
      index: number,
    ): IncidentOnCallRule | AlertOnCallRule => {
      const item: IncidentOnCallRule | AlertOnCallRule =
        kind === "incident"
          ? withId(new IncidentOnCallRule(), ruleId(prefix, index))
          : withId(new AlertOnCallRule(), ruleId(prefix, index));
      item.name = `On-call rule ${index}`;
      item.onCallDutyPolicies = policiesOf(rule.policies);
      return withConditions(
        item as unknown as Record<string, unknown>,
        rule,
        kind,
      ) as unknown as IncidentOnCallRule | AlertOnCallRule;
    },
  );
}

function incidentRulesOf(facts: CaseFacts): Array<AlertIncidentRule> {
  return facts.incidentRules.map(
    (rule: IncidentRuleFacts, index: number): AlertIncidentRule => {
      const item: AlertIncidentRule = withId(
        new AlertIncidentRule(),
        ruleId("d", index),
      );
      item.name = `Incident rule ${index}`;
      item.order = index + 1;
      item.declareAfterInMinutes = rule.waitInMinutes;

      if (rule.incidentSeverity) {
        item.incidentSeverityId = new ObjectID(rule.incidentSeverity);
      }

      return withConditions(
        item as unknown as Record<string, unknown>,
        rule,
        "alert",
      ) as unknown as AlertIncidentRule;
    },
  );
}

function criteriaOf(facts: CaseFacts, kind: Kind): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-offline";
  instance.data!.name = "Offline";
  instance.data!.changeMonitorStatus = false;
  instance.data!.createIncidents = kind === "incident";
  instance.data!.createAlerts = kind === "alert";
  instance.data!.incidents = [];
  instance.data!.alerts = [];

  const template: Record<string, unknown> = {
    id: `${kind}-template`,
    title: facts.titleTemplate,
    description: "The check failed.",
    labelIds: facts.labels.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isPrivate: facts.isPrivate,
  };

  if (kind === "incident") {
    instance.data!.incidents = [
      {
        ...template,
        incidentSeverityId: new ObjectID(facts.severity),
      } as never,
    ];
  } else {
    instance.data!.alerts = [
      { ...template, alertSeverityId: new ObjectID(facts.severity) } as never,
    ];
  }

  return instance;
}

function monitorOf(facts: CaseFacts, kind: Kind): Monitor {
  const monitor: Monitor = withId(new Monitor(), MONITOR_ID);
  monitor.name = facts.monitorName;
  monitor.description = "";
  monitor.monitorType = MonitorType.Website;
  monitor.projectId = PROJECT_ID;
  monitor.labels = labelsOf(facts.monitorLabels);
  monitor.monitorSteps = {
    data: {
      monitorStepsInstanceArray: [
        {
          id: new ObjectID(STEP_ID),
          data: {
            id: STEP_ID,
            monitorCriteria: {
              data: { monitorCriteriaInstanceArray: [criteriaOf(facts, kind)] },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
  return monitor;
}

function labelIdsOf(labels: Array<Label> | undefined): Array<string> {
  return sortedUnique(
    (labels || []).map((label: Label): string => {
      return (label._id || label.id?.toString() || "").toLowerCase();
    }),
  );
}

function pagedIds(paging: OnCallRulesPaging): Array<string> {
  return sortedUnique([...paging.addedPolicyIds, ...paging.observerPolicyIds]);
}

function cardPolicies(event: WhoIsToldEvent): Array<string> {
  return sortedUnique(
    event.policies.map((policy: WhoIsToldPolicy): string => {
      return policy.id;
    }),
  );
}

function attachStub(): unknown {
  return {
    createQueryBuilder: () => {
      const builder: Record<string, unknown> = {};

      for (const step of [
        "relation",
        "of",
        "update",
        "set",
        "where",
        "andWhere",
      ]) {
        builder[step] = (): unknown => {
          return builder;
        };
      }

      builder["add"] = async (): Promise<void> => {};
      builder["execute"] = async (): Promise<{ affected: number }> => {
        return { affected: 1 };
      };

      return builder;
    },
  };
}

const DATA_TO_PROCESS: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: new ObjectID(MONITOR_ID),
  monitorStepId: new ObjectID(STEP_ID),
  monitoredAt: new Date("2026-11-17T08:00:00.000Z"),
} as unknown as ProbeMonitorResponse;

let facts: CaseFacts;
let createdIncidents: Array<Incident> = [];
let createdAlerts: Array<Alert> = [];
let errors: SpyInstance<typeof logger.error>;

// Every read both the card and the real record make, as the case says.
function stubCase(kind: Kind): void {
  const incidentKind: boolean = kind === "incident";

  jest
    .spyOn(IncidentPrivacyRuleService, "findBy")
    .mockResolvedValue(
      (incidentKind ? privacyRulesOf(facts, "incident") : []) as never,
    );
  jest
    .spyOn(AlertPrivacyRuleService, "findBy")
    .mockResolvedValue(
      (incidentKind ? [] : privacyRulesOf(facts, "alert")) as never,
    );
  jest
    .spyOn(IncidentLabelRuleService, "findBy")
    .mockResolvedValue(
      (incidentKind ? labelRulesOf(facts, "incident") : []) as never,
    );
  jest
    .spyOn(AlertLabelRuleService, "findBy")
    .mockResolvedValue(
      (incidentKind ? [] : labelRulesOf(facts, "alert")) as never,
    );
  jest
    .spyOn(IncidentOnCallRuleService, "findBy")
    .mockResolvedValue(
      (incidentKind
        ? onCallRulesOf(facts.onCallRules, "incident", "c")
        : onCallRulesOf(facts.incidentOnCallRules, "incident", "e")) as never,
    );
  jest
    .spyOn(AlertOnCallRuleService, "findBy")
    .mockResolvedValue(
      (incidentKind
        ? []
        : onCallRulesOf(facts.onCallRules, "alert", "c")) as never,
    );
  jest
    .spyOn(AlertIncidentRuleService, "findBy")
    .mockResolvedValue((incidentKind ? [] : incidentRulesOf(facts)) as never);

  jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
    return monitorOf(facts, kind);
  }) as never);
  jest.spyOn(MonitorService, "findOneBy").mockImplementation((async () => {
    return monitorOf(facts, kind);
  }) as never);
}

// The reads and writes no case changes.
function stubBase(): void {
  errors = jest.spyOn(logger, "error");

  jest.spyOn(IncidentOwnerRuleService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(AlertOwnerRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(new Project() as never);
  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);
  jest.spyOn(ServerSendingStatus, "getStatuses").mockResolvedValue([]);
  jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue(
    INCIDENT_SEVERITIES.map(
      (severity: [string, string], index: number): IncidentSeverity => {
        const item: IncidentSeverity = withId(
          new IncidentSeverity(),
          severity[0],
        );
        item.name = severity[1];
        item.order = index + 1;
        return item;
      },
    ) as never,
  );
  jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue(
    ALERT_SEVERITIES.map(
      (severity: [string, string], index: number): AlertSeverity => {
        const item: AlertSeverity = withId(new AlertSeverity(), severity[0]);
        item.name = severity[1];
        item.order = index + 1;
        return item;
      },
    ) as never,
  );
  jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([] as never);
  // Every policy is the project's, with nobody on its first level.
  jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockImplementation((async () => {
      return POLICIES.map((id: string): OnCallDutyPolicy => {
        const policy: OnCallDutyPolicy = withId(new OnCallDutyPolicy(), id);
        policy.name = `Policy ${id.slice(-2)}`;
        return policy;
      });
    }) as never);
  jest.spyOn(OnCallTestPageService, "readFirstLevel").mockResolvedValue({
    targets: [],
    notPaged: [],
    notPagedCodes: [],
    levelCount: 1,
  } as never);
  jest
    .spyOn(IncidentOnCallRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(1) as never);
  jest
    .spyOn(AlertOnCallRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(1) as never);
  // The monitor is on one status page, which shows its incidents.
  const page: StatusPage = withId(new StatusPage(), STATUS_PAGE_ID);
  page.name = "Public status";
  page.projectId = PROJECT_ID;
  jest
    .spyOn(IncidentStatusPageScope, "resolvePagesForDraftIncident")
    .mockResolvedValue({
      statusPages: [page],
      statusPageToResources: {},
      isScoped: false,
      excludedStatusPages: [],
    });
  jest
    .spyOn(ProjectService, "getOwners")
    .mockResolvedValue([withId(new User(), MONITOR_ID)] as never);
  jest.spyOn(MonitorService, "findOwners").mockResolvedValue([] as never);
  jest.spyOn(UserService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

  // The real record's own reads and writes.
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true);
  jest
    .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
    .mockImplementation((async (data: { ids: Array<ObjectID | string> }) => {
      return { usableIds: data.ids, droppedIds: [] };
    }) as never);
  // Every label and policy a rule names is the project's.
  jest
    .spyOn(ProjectScopedReferenceValidator, "keepIdsInProject")
    .mockImplementation((async (data: { ids: Array<string> }) => {
      return data.ids;
    }) as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockImplementation((async () => {
      return MonitorResourceContextUtil.emptyContext();
    }) as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockImplementation((async () => {
      return MonitorResourceContextUtil.emptyContext();
    }) as never);
  jest.spyOn(DataAlertCause, "getSubject").mockResolvedValue(null);
  jest.spyOn(IncidentService, "create").mockImplementation((async (createBy: {
    data: Incident;
  }) => {
    const incident: Incident = createBy.data;
    incident._id = ObjectID.generate().toString();
    createdIncidents.push(incident);
    return incident;
  }) as never);
  jest.spyOn(AlertService, "create").mockImplementation((async (createBy: {
    data: Alert;
  }) => {
    const alert: Alert = createBy.data;
    alert._id = ObjectID.generate().toString();

    // The monitor it is of, under either name.
    const monitorId: ObjectID | undefined =
      alert.monitorId || alert.monitor?.id || undefined;

    if (monitorId) {
      alert.monitorId = monitorId;
    }

    // Created now: a rule's wait starts as the alert opens.
    alert.createdAt = new Date();
    createdAlerts.push(alert);
    return alert;
  }) as never);
  // A record is read back as it is held: its labels, as the label rules leave them.
  jest.spyOn(IncidentService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    return (
      createdIncidents.find((incident: Incident): boolean => {
        return incident.id?.toString() === args.id.toString();
      }) || null
    );
  }) as never);
  jest.spyOn(AlertService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    return (
      createdAlerts.find((alert: Alert): boolean => {
        return alert.id?.toString() === args.id.toString();
      }) || null
    );
  }) as never);
  jest
    .spyOn(IncidentService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "getRepository")
    .mockReturnValue(attachStub() as never);
  jest
    .spyOn(AlertService, "getRepository")
    .mockReturnValue(attachStub() as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue("https://oneuptime.test/incident" as never);
  jest
    .spyOn(IncidentAlertService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest.spyOn(RuleAddedLabels, "add").mockResolvedValue(undefined as never);
  jest.spyOn(LabelService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
}

// What the card says of the one record the criteria opens.
async function cardEvent(): Promise<WhoIsToldEvent> {
  const result: WhoIsToldResult = await WhoIsToldService.resolve({
    projectId: PROJECT_ID,
    monitorId: new ObjectID(MONITOR_ID),
    refresh: true,
  });

  expect(result.criteria).toHaveLength(1);
  expect(result.criteria[0]!.events).toHaveLength(1);

  return result.criteria[0]!.events[0]!;
}

beforeEach(() => {
  createdIncidents = [];
  createdAlerts = [];
  WhoIsToldService.clearCache();
  stubBase();
});

afterEach(() => {
  jest.restoreAllMocks();
  WhoIsToldService.clearCache();
});

describe("a new incident's privacy, label and on-call rules", () => {
  test("the card, the real incident and a plain reading of the rules agree on generated cases", async () => {
    const random: SeededRandom = seededRandom(7212);
    let madePrivateByRule: number = 0;
    let pagedOnlyByLabelRules: number = 0;
    let paged: number = 0;

    for (let index: number = 0; index < CASES; index++) {
      facts = generateCase(random, "incident");
      createdIncidents = [];
      stubCase("incident");

      const event: WhoIsToldEvent = await cardEvent();

      // The real incident, through the create's chain in its order.
      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteriaOf(facts, "incident"),
        monitor: monitorOf(facts, "incident"),
        dataToProcess: DATA_TO_PROCESS,
        rootCause: "The check failed",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
        openIncidents: [],
        props: {},
      });

      const context: string = JSON.stringify({ case: index, facts });

      expect({ context, created: createdIncidents.length }).toEqual({
        context,
        created: 1,
      });

      const incident: Incident = createdIncidents[0]!;

      await IncidentPrivacyRuleEngineService.applyRulesToIncident(incident);
      await IncidentLabelRuleEngineService.applyRulesToIncident(incident);
      const paging: OnCallRulesPaging =
        await IncidentOnCallRuleEngineService.applyRulesToIncident(incident);

      const opened: RecordState = {
        severity: facts.severity,
        labels: facts.labels,
        title: renderedTitle(facts),
      };
      const isPrivate: boolean = oracleIsPrivate(facts, opened);
      const labels: Array<string> = oracleLabels(facts, opened);
      const policies: Array<string> = oraclePolicies(
        facts.onCallRules,
        { ...opened, labels: labels },
        facts,
      );

      // Private: the card, the real incident and the rules say the same.
      expect({ context, card: event.isPrivate === true }).toEqual({
        context,
        card: isPrivate,
      });
      expect({ context, real: incident.isPrivate === true }).toEqual({
        context,
        real: isPrivate,
      });
      // A private incident shows on no status page; a public one on the monitor's.
      expect({ context, pages: event.statusPages.length }).toEqual({
        context,
        pages: isPrivate ? 0 : 1,
      });
      // Its labels once the label rules have run.
      expect({ context, labels: labelIdsOf(incident.labels) }).toEqual({
        context,
        labels: labels,
      });
      // What it pages, on those labels.
      expect({ context, card: cardPolicies(event) }).toEqual({
        context,
        card: policies,
      });
      expect({ context, real: pagedIds(paging) }).toEqual({
        context,
        real: policies,
      });
      expect({ context, errors: errors.mock.calls }).toEqual({
        context,
        errors: [],
      });

      if (isPrivate && !facts.isPrivate) {
        madePrivateByRule++;
      }

      if (policies.length > 0) {
        paged++;

        if (
          oraclePolicies(facts.onCallRules, opened, facts).length <
          policies.length
        ) {
          pagedOnlyByLabelRules++;
        }
      }
    }

    // The generator draws every kind of case, so the agreement means something.
    expect(madePrivateByRule).toBeGreaterThan(CASES / 20);
    expect(paged).toBeGreaterThan(CASES / 10);
    // A record an on-call rule pages only for a label a label rule added (#7212).
    expect(pagedOnlyByLabelRules).toBeGreaterThan(CASES / 50);
  });
});

describe("a new alert's privacy, label, on-call and alert incident rules", () => {
  test("the card, the real alert, the incident it declares and a plain reading of the rules agree on generated cases", async () => {
    const random: SeededRandom = seededRandom(7216);
    let declaredRightAway: number = 0;
    let waiting: number = 0;
    let none: number = 0;

    for (let index: number = 0; index < CASES; index++) {
      facts = generateCase(random, "alert");
      createdAlerts = [];
      createdIncidents = [];
      stubCase("alert");

      const event: WhoIsToldEvent = await cardEvent();

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteriaOf(facts, "alert"),
        monitor: monitorOf(facts, "alert"),
        dataToProcess: DATA_TO_PROCESS,
        rootCause: "The check failed",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
        openAlerts: [],
        props: {},
      });

      const context: string = JSON.stringify({ case: index, facts });

      expect({ context, created: createdAlerts.length }).toEqual({
        context,
        created: 1,
      });

      const alert: Alert = createdAlerts[0]!;

      await AlertPrivacyRuleEngineService.applyRulesToAlert(alert);
      await AlertLabelRuleEngineService.applyRulesToAlert(alert);
      const paging: OnCallRulesPaging =
        await AlertOnCallRuleEngineService.applyRulesToAlert(alert);
      const declaration: AlertIncidentRuleResult =
        await AlertIncidentRuleEngineService.applyRulesToAlert(alert);

      const opened: RecordState = {
        severity: facts.severity,
        labels: facts.labels,
        title: renderedTitle(facts),
      };
      const isPrivate: boolean = oracleIsPrivate(facts, opened);
      const labeled: RecordState = {
        ...opened,
        labels: oracleLabels(facts, opened),
      };

      expect({ context, card: event.isPrivate === true }).toEqual({
        context,
        card: isPrivate,
      });
      expect({ context, real: alert.isPrivate === true }).toEqual({
        context,
        real: isPrivate,
      });
      expect({ context, card: cardPolicies(event) }).toEqual({
        context,
        card: oraclePolicies(facts.onCallRules, labeled, facts),
      });
      expect({ context, real: pagedIds(paging) }).toEqual({
        context,
        real: oraclePolicies(facts.onCallRules, labeled, facts),
      });

      // The incident it becomes: by the first rule that matches the alert as it ends up.
      const ruleIndex: number | null = oracleIncidentRule(facts, labeled);

      if (ruleIndex === null) {
        none++;
        expect({ context, card: event.declares }).toEqual({
          context,
          card: undefined,
        });
        expect({ context, real: declaration.outcome }).toEqual({
          context,
          real: AlertIncidentRuleOutcome.NoRuleMatched,
        });
        continue;
      }

      const rule: IncidentRuleFacts = facts.incidentRules[ruleIndex]!;
      const declaredBy: WhoIsToldRule | undefined = event.declares?.rule;

      expect({ context, card: declaredBy?.id }).toEqual({
        context,
        card: ruleId("d", ruleIndex),
      });
      expect({ context, real: declaration.ruleId?.toString() }).toEqual({
        context,
        real: ruleId("d", ruleIndex),
      });
      expect({ context, wait: event.declares?.waitInMinutes }).toEqual({
        context,
        wait: rule.waitInMinutes,
      });

      const severity: string = oracleIncidentSeverity(rule, facts);
      const severityName: string = INCIDENT_SEVERITIES.find(
        (item: [string, string]): boolean => {
          return item[0] === severity;
        },
      )![1];

      expect({ context, card: event.declares?.incident.severityName }).toEqual({
        context,
        card: severityName,
      });
      // A private alert's incident is private too.
      expect({
        context,
        card: event.declares?.incident.isPrivate === true,
      }).toEqual({ context, card: isPrivate });

      // What the incident pages: its own on-call rules, on the alert's labels.
      const incidentState: RecordState = {
        severity: severity,
        labels: labeled.labels,
        title: labeled.title,
      };
      const incidentPolicies: Array<string> = oraclePolicies(
        facts.incidentOnCallRules,
        incidentState,
        facts,
      );

      expect({
        context,
        card: cardPolicies(event.declares!.incident),
      }).toEqual({ context, card: incidentPolicies });

      if (rule.waitInMinutes > 0) {
        waiting++;
        expect({ context, real: declaration.outcome }).toEqual({
          context,
          real: AlertIncidentRuleOutcome.Waiting,
        });
        continue;
      }

      declaredRightAway++;
      expect({ context, real: declaration.outcome }).toEqual({
        context,
        real: AlertIncidentRuleOutcome.Declared,
      });

      // The incident the engine really declared: its severity, and what it pages.
      const incident: Incident = createdIncidents[0]!;

      expect({
        context,
        real: incident.incidentSeverityId?.toString(),
      }).toEqual({ context, real: severity });
      expect({ context, real: incident.isPrivate === true }).toEqual({
        context,
        real: isPrivate,
      });
      expect({
        context,
        real: pagedIds(
          await IncidentOnCallRuleEngineService.applyRulesToIncident(incident),
        ),
      }).toEqual({ context, real: incidentPolicies });
      expect({ context, errors: errors.mock.calls }).toEqual({
        context,
        errors: [],
      });
    }

    expect(declaredRightAway).toBeGreaterThan(CASES / 10);
    expect(waiting).toBeGreaterThan(CASES / 20);
    expect(none).toBeGreaterThan(CASES / 10);
  });
});

/*
 * WHAT AN ALERT'S OWNERS MAKE ITS ON-CALL RULES PAGE (#9407).
 *
 * An alert on-call rule can match on who owns the alert: "Alert Owner is
 * any of" (or "is none of") people and teams. The real alert's owners are
 * the owner rows its create writes before its on-call rules run - the
 * people and teams its criteria names and the network device's owners
 * (MonitorAlert, through AlertService.addOwners), then whom its owner rules
 * add (AlertOwnerRuleEngineService) - each a member of the project or one
 * of its teams (OwnerRuleAssignment.createOwner). The card holds the alert
 * in memory, with no rows, and works out the same owners.
 *
 * Over generated criteria owners, device owners, owner rules and on-call
 * rules with and without an owner condition, both "is any of" and "is none
 * of": the policies the card says are paged are the ones the real alert's
 * rules page, matched on its owner rows, and both are what a plain reading
 * of the rules says.
 */
describe("a new alert's owners and its Alert Owner rules (#9407)", () => {
  const ANA: string = "72120000-0000-4000-8000-000000000a01";
  const BEN: string = "72120000-0000-4000-8000-000000000a02";
  // Left the project: never an owner.
  const CARA: string = "72120000-0000-4000-8000-000000000a03";
  // The project's teams: Payments has Ana in it, Night shift nobody.
  const PAYMENTS: string = "72120000-0000-4000-8000-000000000a11";
  const NIGHT_SHIFT: string = "72120000-0000-4000-8000-000000000a12";
  // Another project's team: never an owner here.
  const ELSEWHERE: string = "72120000-0000-4000-8000-000000000a13";

  const MEMBERS: Array<string> = [ANA, BEN];
  const PROJECT_TEAMS: Record<string, string> = {
    [PAYMENTS]: "Payments",
    [NIGHT_SHIFT]: "Night shift",
  };
  const TEAM_MEMBERS: Record<string, Array<string>> = {
    [PAYMENTS]: [ANA],
    [NIGHT_SHIFT]: [],
  };
  const PEOPLE: Array<string> = [ANA, BEN, CARA];
  const TEAMS: Array<string> = [PAYMENTS, NIGHT_SHIFT, ELSEWHERE];
  const CANDIDATES: Array<string> = [...PEOPLE, ...TEAMS];

  const OWNER_CASES: number = 150;

  interface OwnerRuleFacts {
    severities: Array<string>;
    titlePattern: string | null;
    people: Array<string>;
    teams: Array<string>;
  }

  interface OwnerOnCallRuleFacts {
    severities: Array<string>;
    titlePattern: string | null;
    owner: { isNoneOf: boolean; picks: Array<string> } | null;
    policies: Array<string>;
  }

  interface OwnerCaseFacts {
    monitorName: string;
    titleTemplate: string;
    severity: string;
    criteriaPeople: Array<string>;
    criteriaTeams: Array<string>;
    devicePeople: Array<string>;
    deviceTeams: Array<string>;
    ownerRules: Array<OwnerRuleFacts>;
    onCallRules: Array<OwnerOnCallRuleFacts>;
  }

  function generateOwnerCase(random: SeededRandom): OwnerCaseFacts {
    const ownerRules: Array<OwnerRuleFacts> = [];
    const onCallRules: Array<OwnerOnCallRuleFacts> = [];

    for (let index: number = random(3); index > 0; index--) {
      ownerRules.push({
        severities: rarelySomeOf(severityIds("alert"), 3, random),
        titlePattern: random(3) === 0 ? pick(TITLE_PATTERNS, random) : null,
        people: someOf(PEOPLE, random),
        teams: someOf(TEAMS, random),
      });
    }

    for (let index: number = 1 + random(3); index > 0; index--) {
      const picks: Array<string> = [pick(CANDIDATES, random)];

      if (random(3) === 0) {
        const second: string = pick(CANDIDATES, random);

        if (!picks.includes(second)) {
          picks.push(second);
        }
      }

      onCallRules.push({
        severities: rarelySomeOf(severityIds("alert"), 4, random),
        titlePattern: random(5) === 0 ? pick(TITLE_PATTERNS, random) : null,
        // Most here ask who owns the alert, which is what this is about.
        owner:
          random(5) === 0 ? null : { isNoneOf: random(2) === 0, picks: picks },
        policies: [pick(POLICIES, random)],
      });
    }

    const devices: boolean = random(3) === 0;

    return {
      monitorName: pick(MONITOR_NAMES, random),
      titleTemplate: pick(TITLE_TEMPLATES, random),
      severity: pick(severityIds("alert"), random),
      criteriaPeople: someOf(PEOPLE, random),
      criteriaTeams: someOf(TEAMS, random),
      devicePeople: devices ? someOf(PEOPLE, random) : [],
      deviceTeams: devices ? someOf(TEAMS, random) : [],
      ownerRules: ownerRules,
      onCallRules: onCallRules,
    };
  }

  // A rule's conditions besides owners, on the alert as it opens.
  function holds(
    rule: { severities: Array<string>; titlePattern: string | null },
    facts: OwnerCaseFacts,
  ): boolean {
    if (
      rule.severities.length > 0 &&
      !rule.severities.includes(facts.severity)
    ) {
      return false;
    }

    return (
      !rule.titlePattern ||
      new RegExp(rule.titlePattern).test(
        facts.titleTemplate.split("{{monitorName}}").join(facts.monitorName),
      )
    );
  }

  /*
   * A PLAIN READING: the alert's owners are everyone named - the criteria,
   * the device, each owner rule that matches - who can own it: a member of
   * the project, or one of its teams, whoever is in it.
   */
  function oracleOwners(facts: OwnerCaseFacts): Array<string> {
    const named: Array<string> = [
      ...facts.criteriaPeople,
      ...facts.criteriaTeams,
      ...facts.devicePeople,
      ...facts.deviceTeams,
    ];

    for (const rule of facts.ownerRules) {
      if (holds(rule, facts)) {
        named.push(...rule.people, ...rule.teams);
      }
    }

    return sortedUnique(
      named.filter((id: string): boolean => {
        return MEMBERS.includes(id) || Boolean(PROJECT_TEAMS[id]);
      }),
    );
  }

  function oracleOwnerPolicies(facts: OwnerCaseFacts): Array<string> {
    const owners: Array<string> = oracleOwners(facts);

    return sortedUnique(
      facts.onCallRules.flatMap((rule: OwnerOnCallRuleFacts): Array<string> => {
        if (!holds(rule, facts)) {
          return [];
        }

        if (rule.owner) {
          const picked: boolean = rule.owner.picks.some(
            (id: string): boolean => {
              return owners.includes(id);
            },
          );

          if (picked === rule.owner.isNoneOf) {
            return [];
          }
        }

        return rule.policies;
      }),
    );
  }

  function ownerRulesOf(facts: OwnerCaseFacts): Array<AlertOwnerRule> {
    return facts.ownerRules.map(
      (rule: OwnerRuleFacts, index: number): AlertOwnerRule => {
        const item: AlertOwnerRule = withId(
          new AlertOwnerRule(),
          ruleId("f", index),
        );
        item.name = `Owner rule ${index}`;
        item.projectId = PROJECT_ID;
        item.isEnabled = true;
        item.notifyOwners = false;
        item.monitors = [];
        item.alertLabels = [];
        item.monitorLabels = [];
        item.alertSeverities = rule.severities.map(
          (id: string): AlertSeverity => {
            return withId(new AlertSeverity(), id);
          },
        );

        if (rule.titlePattern) {
          item.alertTitlePattern = rule.titlePattern;
        }

        item.ownerUsers = rule.people.map((id: string): User => {
          return withId(new User(), id);
        });
        item.ownerTeams = rule.teams.map((id: string): Team => {
          return withId(new Team(), id);
        });
        return item;
      },
    );
  }

  function ownerOnCallRulesOf(facts: OwnerCaseFacts): Array<AlertOnCallRule> {
    return facts.onCallRules.map(
      (rule: OwnerOnCallRuleFacts, index: number): AlertOnCallRule => {
        const item: AlertOnCallRule = withId(
          new AlertOnCallRule(),
          ruleId("e", index),
        );
        item.name = `On-call rule ${index}`;
        item.projectId = PROJECT_ID;
        item.isEnabled = true;
        item.onCallDutyPolicies = policiesOf(rule.policies);

        if (!rule.owner) {
          return withConditions(
            item as unknown as Record<string, unknown>,
            {
              severities: rule.severities,
              monitors: [],
              labels: [],
              monitorLabels: [],
              titlePattern: rule.titlePattern,
            },
            "alert",
          ) as unknown as AlertOnCallRule;
        }

        // An owner condition lives in the criteria, and so do the rest then.
        const filters: Array<RuleCriteriaFilter> = [
          {
            field: "alertOwners",
            operator: rule.owner.isNoneOf
              ? RuleCriteriaOperator.HasNoneOf
              : RuleCriteriaOperator.HasAnyOf,
            value: rule.owner.picks,
          },
        ];

        if (rule.severities.length > 0) {
          filters.push({
            field: "alertSeverities",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: rule.severities,
          });
        }

        if (rule.titlePattern) {
          filters.push({
            field: "alertTitlePattern",
            operator: RuleCriteriaOperator.MatchesPattern,
            value: rule.titlePattern,
          });
        }

        item.criteria = {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: filters,
        };
        return item;
      },
    );
  }

  // The monitor of a case: one criteria that opens an alert with these owners.
  function ownerMonitorOf(facts: OwnerCaseFacts): Monitor {
    const monitor: Monitor = monitorOf(
      {
        monitorName: facts.monitorName,
        monitorLabels: [],
        titleTemplate: facts.titleTemplate,
        severity: facts.severity,
        labels: [],
        isPrivate: false,
        privacyRules: [],
        labelRules: [],
        onCallRules: [],
        incidentRules: [],
        incidentOnCallRules: [],
      },
      "alert",
    );

    const instance: MonitorCriteriaInstance = criteriaInstanceOf(monitor);

    instance.data!.alerts = (instance.data!.alerts || []).map(
      (template: CriteriaAlert): CriteriaAlert => {
        return {
          ...template,
          ownerUserIds: facts.criteriaPeople.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          ownerTeamIds: facts.criteriaTeams.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        };
      },
    );

    return monitor;
  }

  function criteriaInstanceOf(monitor: Monitor): MonitorCriteriaInstance {
    return (
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0] as MonitorStep
    ).data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
  }

  // The owner rows the real alert gets, as the owner tables hold them.
  interface OwnerRow {
    alertId: string;
    userId?: string | undefined;
    teamId?: string | undefined;
  }

  let ownerRows: Array<OwnerRow> = [];
  let ownerFacts: OwnerCaseFacts;

  // The ids a query asks for in a column: one id, or QueryHelper.any's.
  function idsOfQuery(
    query: Record<string, unknown>,
    column: string,
  ): Array<string> {
    const value: unknown = query[column];

    if (!value) {
      return [];
    }

    if (value instanceof ObjectID || typeof value === "string") {
      return [value.toString().toLowerCase()];
    }

    const parameters: Record<string, unknown> =
      ((value as { objectLiteralParameters?: Record<string, unknown> })
        ?.objectLiteralParameters as Record<string, unknown>) || {};
    const values: unknown = Object.values(parameters)[0];

    return (Array.isArray(values) ? values : []).map(
      (item: unknown): string => {
        return String(item).toLowerCase();
      },
    );
  }

  function rowsOf(
    query: Record<string, unknown>,
    column: "userId" | "teamId",
  ): Array<AlertOwnerUser | AlertOwnerTeam> {
    const alertIds: Array<string> = idsOfQuery(query, "alertId");
    const ownerIds: Array<string> = idsOfQuery(query, column);

    return ownerRows
      .filter((row: OwnerRow): boolean => {
        const id: string | undefined = row[column];

        return (
          Boolean(id) &&
          alertIds.includes(row.alertId) &&
          (ownerIds.length === 0 || ownerIds.includes(id!))
        );
      })
      .map((row: OwnerRow): AlertOwnerUser | AlertOwnerTeam => {
        const item: AlertOwnerUser | AlertOwnerTeam =
          column === "userId" ? new AlertOwnerUser() : new AlertOwnerTeam();
        item.alertId = new ObjectID(row.alertId);
        (item as unknown as Record<string, unknown>)[column] = new ObjectID(
          row[column]!,
        );
        return item;
      });
  }

  beforeEach(() => {
    ownerRows = [];

    jest
      .spyOn(IncidentPrivacyRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertPrivacyRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentLabelRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(AlertLabelRuleService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(IncidentOnCallRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertIncidentRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(AlertOnCallRuleService, "findBy")
      .mockImplementation((async () => {
        return ownerOnCallRulesOf(ownerFacts);
      }) as never);
    jest
      .spyOn(AlertOwnerRuleService, "findBy")
      .mockImplementation((async () => {
        return ownerRulesOf(ownerFacts);
      }) as never);
    jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
      return ownerMonitorOf(ownerFacts);
    }) as never);
    jest.spyOn(MonitorService, "findOneBy").mockImplementation((async () => {
      return ownerMonitorOf(ownerFacts);
    }) as never);
    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockImplementation((async () => {
        return {
          ownerUserIds: ownerFacts.devicePeople.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
          ownerTeamIds: ownerFacts.deviceTeams.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        };
      }) as never);

    // Who is a member of the project, and who is in each of its teams.
    jest
      .spyOn(TeamMemberService, "isUserMemberOfProject")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        return MEMBERS.includes(data.userId.toString().toLowerCase());
      }) as never);
    jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockImplementation((async (data: {
        userIds: Array<ObjectID | string>;
      }) => {
        return data.userIds
          .filter((id: ObjectID | string): boolean => {
            return MEMBERS.includes(id.toString().toLowerCase());
          })
          .map((id: ObjectID | string): ObjectID => {
            return new ObjectID(id.toString());
          });
      }) as never);
    jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
      query: Record<string, unknown>;
    }) => {
      return idsOfQuery(args.query, "teamId").flatMap(
        (teamId: string): Array<TeamMember> => {
          return (TEAM_MEMBERS[teamId] || []).map(
            (userId: string): TeamMember => {
              const member: TeamMember = new TeamMember();
              member.teamId = new ObjectID(teamId);
              member.userId = new ObjectID(userId);
              return member;
            },
          );
        },
      );
    }) as never);
    // The project's teams, read with the project's id: another's is not found.
    jest.spyOn(TeamService, "findBy").mockImplementation((async (args: {
      query: Record<string, unknown>;
    }) => {
      return idsOfQuery(args.query, "_id")
        .filter((id: string): boolean => {
          return Boolean(PROJECT_TEAMS[id]);
        })
        .map((id: string): Team => {
          const team: Team = withId(new Team(), id);
          team.name = PROJECT_TEAMS[id]!;
          return team;
        });
    }) as never);

    // The owner tables: written by the create, read by the on-call rules.
    jest
      .spyOn(AlertOwnerUserService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        return rowsOf(args.query, "userId");
      }) as never);
    jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        return rowsOf(args.query, "teamId");
      }) as never);
    jest
      .spyOn(AlertOwnerUserService, "create")
      .mockImplementation((async (createBy: { data: AlertOwnerUser }) => {
        ownerRows.push({
          alertId: createBy.data.alertId!.toString().toLowerCase(),
          userId: createBy.data.userId!.toString().toLowerCase(),
        });
        return createBy.data;
      }) as never);
    jest
      .spyOn(AlertOwnerTeamService, "create")
      .mockImplementation((async (createBy: { data: AlertOwnerTeam }) => {
        const teamId: string = createBy.data.teamId!.toString().toLowerCase();

        // The owner service refuses a team that is not the project's.
        if (!PROJECT_TEAMS[teamId]) {
          throw new ProjectScopedReferenceException(
            "The team is not one of this project's teams.",
          );
        }

        ownerRows.push({
          alertId: createBy.data.alertId!.toString().toLowerCase(),
          teamId: teamId,
        });
        return createBy.data;
      }) as never);
  });

  test("the card, the real alert's owner rows and a plain reading of the rules agree on what is paged", async () => {
    const random: SeededRandom = seededRandom(9407);
    let matchedOnOwners: number = 0;
    let keptOffByOwners: number = 0;
    let ownedByARuleAlone: number = 0;

    for (let index: number = 0; index < OWNER_CASES; index++) {
      ownerFacts = generateOwnerCase(random);
      ownerRows = [];
      createdAlerts = [];
      createdIncidents = [];

      const event: WhoIsToldEvent = await cardEvent();
      const monitor: Monitor = ownerMonitorOf(ownerFacts);

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstanceOf(monitor),
        monitor: monitor,
        dataToProcess: DATA_TO_PROCESS,
        rootCause: "The check failed",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
        openAlerts: [],
        props: {},
      });

      const context: string = JSON.stringify({ case: index, ownerFacts });

      expect({ context, created: createdAlerts.length }).toEqual({
        context,
        created: 1,
      });

      const alert: Alert = createdAlerts[0]!;

      // The create's chain, in its order: privacy, owners, labels, on-call.
      await AlertPrivacyRuleEngineService.applyRulesToAlert(alert);
      await AlertOwnerRuleEngineService.applyRulesToAlert(alert);
      await AlertLabelRuleEngineService.applyRulesToAlert(alert);
      const paging: OnCallRulesPaging =
        await AlertOnCallRuleEngineService.applyRulesToAlert(alert);

      const owners: Array<string> = oracleOwners(ownerFacts);
      const policies: Array<string> = oracleOwnerPolicies(ownerFacts);

      // The real alert's owner rows are the owners a plain reading gives.
      expect({
        context,
        rows: sortedUnique(
          ownerRows.map((row: OwnerRow): string => {
            return (row.userId || row.teamId)!;
          }),
        ),
      }).toEqual({ context, rows: owners });
      // And the card matches on them, as the real alert's rules do.
      expect({ context, card: cardPolicies(event) }).toEqual({
        context,
        card: policies,
      });
      expect({ context, real: pagedIds(paging) }).toEqual({
        context,
        real: policies,
      });
      expect({ context, errors: errors.mock.calls }).toEqual({
        context,
        errors: [],
      });

      // Named by the criteria or the device, rather than by an owner rule alone.
      const namedDirectly: Set<string> = new Set<string>([
        ...ownerFacts.criteriaPeople,
        ...ownerFacts.criteriaTeams,
        ...ownerFacts.devicePeople,
        ...ownerFacts.deviceTeams,
      ]);

      for (const rule of ownerFacts.onCallRules) {
        if (!rule.owner || !holds(rule, ownerFacts)) {
          continue;
        }

        const pickedOwners: Array<string> = rule.owner.picks.filter(
          (id: string): boolean => {
            return owners.includes(id);
          },
        );

        if (pickedOwners.length > 0 && !rule.owner.isNoneOf) {
          matchedOnOwners++;
        }

        if (pickedOwners.length > 0 && rule.owner.isNoneOf) {
          keptOffByOwners++;
        }

        if (
          pickedOwners.length > 0 &&
          pickedOwners.every((id: string): boolean => {
            return !namedDirectly.has(id);
          })
        ) {
          ownedByARuleAlone++;
        }
      }
    }

    // The generator draws every kind of case, so the agreement means something.
    expect(matchedOnOwners).toBeGreaterThan(OWNER_CASES / 10);
    expect(keptOffByOwners).toBeGreaterThan(OWNER_CASES / 20);
    expect(ownedByARuleAlone).toBeGreaterThan(OWNER_CASES / 50);
  });
});
