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
    alert.monitorId = alert.monitorId || alert.monitor?.id || undefined;
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
