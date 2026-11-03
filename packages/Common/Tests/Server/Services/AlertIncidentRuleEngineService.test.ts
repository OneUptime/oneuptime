import Alert from "../../../Models/DatabaseModels/Alert";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Service from "../../../Models/DatabaseModels/Service";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertIncidentRuleEngineService, {
  ALERT_INCIDENT_RULE_CHECKS_PER_RUN,
  AlertIncidentRuleOutcome,
  AlertIncidentRuleResult,
  getAlertIncidentRuleAlertSelect,
  getAlertIncidentRuleDeclaredSentence,
  getAlertIncidentRuleResourceColumns,
} from "../../../Server/Services/AlertIncidentRuleEngineService";
import AlertIncidentRuleService from "../../../Server/Services/AlertIncidentRuleService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorService from "../../../Server/Services/MonitorService";
import logger from "../../../Server/Utils/Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY,
} from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ALERT INCIDENT RULES: THE FIRST RULE THAT MATCHES AN ALERT DECLARES AN
 * INCIDENT FROM IT, RIGHT AWAY OR ONCE ITS WAIT IS UP.
 *
 * Every service the engine reads or writes through is replaced here, so
 * each case says exactly what the engine asked for and what it did: which
 * rule decided, the incident it declared - as "Declare Incident" on the
 * alert's page would - with the alert to link and the rule's name, when it
 * waits instead, and what it leaves alone.
 */

type AnyFunction = (...args: Array<any>) => any;

const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const ALERT_ID: ObjectID = new ObjectID("7c000000-0000-4000-8000-0000000000a1");
const INCIDENT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-0000000000e1",
);
const MONITOR_ID: string = "7c000000-0000-4000-8000-0000000000b1";
const OTHER_MONITOR_ID: string = "7c000000-0000-4000-8000-0000000000b2";
const HOST_ID: string = "7c000000-0000-4000-8000-0000000000d1";
const SERVICE_ID: string = "7c000000-0000-4000-8000-0000000000d2";
const LABEL_PRODUCTION: string = "7c000000-0000-4000-8000-0000000000f1";
const LABEL_ARCHIVED: string = "7c000000-0000-4000-8000-0000000000f2";
const LABEL_DATABASE: string = "7c000000-0000-4000-8000-0000000000f3";

// The project's alert severities, most severe first.
const ALERT_CRITICAL: string = "7c000000-0000-4000-8000-000000000c01";
const ALERT_MAJOR: string = "7c000000-0000-4000-8000-000000000c02";
const ALERT_WARNING: string = "7c000000-0000-4000-8000-000000000c03";

// The project's incident severities, most severe first.
const SEV1: string = "7c000000-0000-4000-8000-000000000501";
const SEV2: string = "7c000000-0000-4000-8000-000000000502";
const MINOR: string = "7c000000-0000-4000-8000-000000000503";
const ARCHIVED_SEVERITY: string = "7c000000-0000-4000-8000-000000000504";
const OTHER_PROJECTS_SEVERITY: string = "7c000000-0000-4000-8000-000000000599";

const MINUTE: number = 60 * 1000;

const INCIDENT_LINK: string =
  "https://oneuptime.example/dashboard/project/incidents/incident";

interface RuleData {
  id?: string;
  name?: string;
  order?: number;
  declareAfterInMinutes?: number;
  showIncidentOnStatusPage?: boolean;
  incidentSeverityId?: string;
  monitors?: Array<string>;
  alertSeverities?: Array<string>;
  alertLabels?: Array<string>;
  monitorLabels?: Array<string>;
  alertTitlePattern?: string;
  monitorNamePattern?: string;
  criteria?: unknown;
}

function withId<T extends { _id?: string }>(model: T, id: string): T {
  model._id = id;
  return model;
}

function newRule(data: RuleData): AlertIncidentRule {
  const rule: AlertIncidentRule = new AlertIncidentRule();
  rule._id = data.id || ObjectID.generate().toString();
  rule.name = data.name || "Rule";
  rule.order = data.order || 1;
  rule.declareAfterInMinutes = data.declareAfterInMinutes || 0;
  rule.showIncidentOnStatusPage = data.showIncidentOnStatusPage !== false;

  if (data.incidentSeverityId) {
    rule.incidentSeverityId = new ObjectID(data.incidentSeverityId);
  }

  rule.monitors = (data.monitors || []).map((id: string): Monitor => {
    return withId(new Monitor(), id);
  });
  rule.alertSeverities = (data.alertSeverities || []).map(
    (id: string): AlertSeverity => {
      return withId(new AlertSeverity(), id);
    },
  );
  rule.alertLabels = (data.alertLabels || []).map((id: string): Label => {
    return withId(new Label(), id);
  });
  rule.monitorLabels = (data.monitorLabels || []).map((id: string): Label => {
    return withId(new Label(), id);
  });

  if (data.alertTitlePattern) {
    rule.alertTitlePattern = data.alertTitlePattern;
  }

  if (data.monitorNamePattern) {
    rule.monitorNamePattern = data.monitorNamePattern;
  }

  if (data.criteria !== undefined) {
    rule.criteria = data.criteria as never;
  }

  return rule;
}

interface AlertData {
  title?: string;
  description?: string;
  createdAt?: Date;
  monitorId?: string | null;
  alertSeverityId?: string | null;
  labels?: Array<{ id: string; isArchived?: boolean }>;
  hosts?: Array<string>;
  services?: Array<string>;
  isPrivate?: boolean;
  alertNumber?: number;
  alertNumberWithPrefix?: string;
}

function newAlert(data: AlertData = {}): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.projectId = PROJECT_ID;
  alert.title = data.title === undefined ? "Database CPU high" : data.title;
  alert.description =
    data.description === undefined
      ? "CPU stayed above 95% for 10 minutes."
      : data.description;
  alert.createdAt = data.createdAt || new Date(Date.now() - MINUTE);
  alert.currentAlertStateId = new ObjectID(
    "7c000000-0000-4000-8000-000000000a51",
  );

  const monitorId: string | null =
    data.monitorId === undefined ? MONITOR_ID : data.monitorId;

  if (monitorId) {
    alert.monitorId = new ObjectID(monitorId);
  }

  const severityId: string | null =
    data.alertSeverityId === undefined ? ALERT_CRITICAL : data.alertSeverityId;

  if (severityId) {
    alert.alertSeverityId = new ObjectID(severityId);
  }

  alert.labels = (data.labels || [{ id: LABEL_PRODUCTION }]).map(
    (label: { id: string; isArchived?: boolean }): Label => {
      const item: Label = withId(new Label(), label.id);
      item.isArchived = label.isArchived === true;
      return item;
    },
  );
  alert.hosts = (data.hosts || []).map((id: string): Host => {
    return withId(new Host(), id);
  });
  alert.services = (data.services || []).map((id: string): Service => {
    return withId(new Service(), id);
  });

  if (data.isPrivate) {
    alert.isPrivate = true;
  }

  alert.alertNumber = data.alertNumber || 12;
  alert.alertNumberWithPrefix = data.alertNumberWithPrefix || "ALT-12";

  return alert;
}

function alertSeverities(): Array<AlertSeverity> {
  return [
    [ALERT_CRITICAL, "Critical", 1],
    [ALERT_MAJOR, "Major", 2],
    [ALERT_WARNING, "Warning", 3],
  ].map(([id, name, order]: Array<string | number>): AlertSeverity => {
    const severity: AlertSeverity = withId(new AlertSeverity(), id as string);
    severity.name = name as string;
    severity.order = order as number;
    return severity;
  });
}

function incidentSeverities(
  rows: Array<[string, string, number, boolean?]> = [
    [SEV1, "SEV1", 1],
    [SEV2, "SEV2", 2],
    [MINOR, "Minor", 3],
    [ARCHIVED_SEVERITY, "Retired", 4, true],
  ],
): Array<IncidentSeverity> {
  return rows.map(
    ([id, name, order, isArchived]: [
      string,
      string,
      number,
      boolean?,
    ]): IncidentSeverity => {
      const severity: IncidentSeverity = withId(new IncidentSeverity(), id);
      severity.name = name;
      severity.order = order;
      severity.isArchived = isArchived === true;
      return severity;
    },
  );
}

// One statement the engine sent through the alert repository's builder.
interface RepositoryUpdate {
  set: Record<string, unknown> | undefined;
  where: Array<[string, Record<string, unknown> | undefined]>;
}

interface Stubs {
  findRules: jest.Mock;
  readAlert: jest.Mock;
  findAlerts: jest.Mock;
  countLinks: jest.Mock;
  createIncident: jest.Mock;
  readIncident: jest.Mock;
  createFeed: jest.Mock;
  isResolved: jest.Mock;
  readMonitor: jest.Mock;
  readIncidentSeverities: jest.Mock;
  readAlertSeverities: jest.Mock;
  updates: Array<RepositoryUpdate>;
}

let updatesAffect: number = 1;

function stub<T>(target: T, method: string): jest.Mock {
  return jest.spyOn(
    target as unknown as Record<string, AnyFunction>,
    method,
  ) as unknown as jest.Mock;
}

function stubAll(data: {
  rules: Array<AlertIncidentRule>;
  alert?: Alert | null;
  links?: number;
}): Stubs {
  const updates: Array<RepositoryUpdate> = [];

  const stubs: Stubs = {
    findRules: stub(AlertIncidentRuleService, "findBy").mockResolvedValue(
      data.rules as never,
    ),
    readAlert: stub(AlertService, "findOneById").mockResolvedValue(
      (data.alert === undefined ? newAlert() : data.alert) as never,
    ),
    findAlerts: stub(AlertService, "findBy").mockResolvedValue([] as never),
    countLinks: stub(IncidentAlertService, "countBy").mockResolvedValue(
      new PositiveNumber(data.links || 0) as never,
    ),
    createIncident: stub(IncidentService, "create").mockImplementation(
      (async (createBy: { data: Incident }): Promise<Incident> => {
        createBy.data.id = INCIDENT_ID;
        return createBy.data;
      }) as never,
    ),
    readIncident: stub(IncidentService, "findOneById").mockImplementation(
      (async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident.incidentNumber = 7;
        incident.incidentNumberWithPrefix = "INC-7";
        return incident;
      }) as never,
    ),
    createFeed: stub(AlertFeedService, "createAlertFeedItem").mockResolvedValue(
      undefined as never,
    ),
    isResolved: stub(
      AlertStateService,
      "isResolvedAlertState",
    ).mockResolvedValue(false as never),
    readMonitor: stub(MonitorService, "findOneById").mockResolvedValue(
      null as never,
    ),
    readIncidentSeverities: stub(
      IncidentSeverityService,
      "findBy",
    ).mockResolvedValue(incidentSeverities() as never),
    readAlertSeverities: stub(AlertSeverityService, "findBy").mockResolvedValue(
      alertSeverities() as never,
    ),
    updates: updates,
  };

  stub(IncidentService, "getIncidentLinkInDashboard").mockResolvedValue(
    new URL(INCIDENT_LINK) as never,
  );

  stub(AlertService, "getRepository").mockImplementation((() => {
    const update: RepositoryUpdate = { set: undefined, where: [] };

    const builder: Record<string, AnyFunction> = {
      update: (): Record<string, AnyFunction> => {
        return builder;
      },
      set: (values: Record<string, unknown>): Record<string, AnyFunction> => {
        update.set = values;
        return builder;
      },
      where: (
        sql: string,
        params?: Record<string, unknown>,
      ): Record<string, AnyFunction> => {
        update.where.push([sql, params]);
        return builder;
      },
      andWhere: (
        sql: string,
        params?: Record<string, unknown>,
      ): Record<string, AnyFunction> => {
        update.where.push([sql, params]);
        return builder;
      },
      execute: async (): Promise<{ affected: number }> => {
        updates.push(update);
        return { affected: updatesAffect };
      },
    };

    return {
      createQueryBuilder: (): Record<string, AnyFunction> => {
        return builder;
      },
    };
  }) as never);

  return stubs;
}

// What the engine handed IncidentService.create, the one time it did.
function declaredWith(stubs: Stubs): {
  incident: Incident;
  miscDataProps: JSONObject;
  props: Record<string, unknown>;
} {
  expect(stubs.createIncident).toHaveBeenCalledTimes(1);

  const createBy: {
    data: Incident;
    miscDataProps: JSONObject;
    props: Record<string, unknown>;
  } = stubs.createIncident.mock.calls[0]![0] as never;

  return {
    incident: createBy.data,
    miscDataProps: createBy.miscDataProps,
    props: createBy.props,
  };
}

function idsOf(records: Array<{ _id?: string }> | undefined): Array<string> {
  return (records || []).map((record: { _id?: string }): string => {
    return record._id || "";
  });
}

function feedMarkdown(stubs: Stubs): string {
  expect(stubs.createFeed).toHaveBeenCalledTimes(1);

  const item: { feedInfoInMarkdown: string } = stubs.createFeed.mock
    .calls[0]![0] as never;

  return item.feedInfoInMarkdown;
}

beforeEach(() => {
  updatesAffect = 1;
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new alert and the project's alert incident rules", () => {
  test("a project without an enabled rule reads nothing more and declares nothing", async () => {
    const stubs: Stubs = stubAll({ rules: [] });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.NoRuleMatched);
    expect(stubs.readAlert).not.toHaveBeenCalled();
    expect(stubs.createIncident).not.toHaveBeenCalled();
    expect(stubs.updates).toEqual([]);
  });

  test("reads the project's enabled rules, top of the list first, every one of them", async () => {
    const stubs: Stubs = stubAll({ rules: [] });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    const findBy: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      props: Record<string, unknown>;
    } = stubs.findRules.mock.calls[0]![0] as never;

    expect(findBy.query).toEqual({ projectId: PROJECT_ID, isEnabled: true });
    expect(findBy.sort).toEqual({
      order: SortOrder.Ascending,
      createdAt: SortOrder.Ascending,
    });
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("an alert without an id or project is left alone", async () => {
    const stubs: Stubs = stubAll({ rules: [newRule({})] });

    const alert: Alert = new Alert();

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(alert);

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.NoRuleMatched);
    expect(stubs.findRules).not.toHaveBeenCalled();
  });

  test("the first rule that matches decides, from the top of the list", async () => {
    const warningRule: AlertIncidentRule = newRule({
      name: "Warnings",
      alertSeverities: [ALERT_WARNING],
      incidentSeverityId: MINOR,
    });
    const criticalRule: AlertIncidentRule = newRule({
      name: "Critical alerts",
      alertSeverities: [ALERT_CRITICAL],
      incidentSeverityId: SEV2,
    });
    const everythingRule: AlertIncidentRule = newRule({
      name: "Everything",
      incidentSeverityId: SEV1,
    });

    const stubs: Stubs = stubAll({
      rules: [warningRule, criticalRule, everythingRule],
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Declared);
    expect(result.ruleId?.toString()).toBe(criticalRule._id);
    expect(result.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
      SEV2,
    );
    expect(
      declaredWith(stubs).miscDataProps[
        INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY
      ],
    ).toBe("Critical alerts");
  });

  test("a rule with no conditions matches every alert", async () => {
    const stubs: Stubs = stubAll({ rules: [newRule({ name: "All alerts" })] });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(
        newAlert({ monitorId: null, alertSeverityId: null, labels: [] }),
      );

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Declared);
    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
  });

  test("no rule matches: the alert stays an alert", async () => {
    const stubs: Stubs = stubAll({
      rules: [
        newRule({ monitors: [OTHER_MONITOR_ID] }),
        newRule({ alertSeverities: [ALERT_WARNING] }),
        newRule({ alertLabels: [LABEL_DATABASE] }),
        newRule({ alertTitlePattern: "disk.*full" }),
      ],
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.NoRuleMatched);
    expect(stubs.createIncident).not.toHaveBeenCalled();
    expect(stubs.updates).toEqual([]);
  });

  test("the conditions builder's criteria decide, not the legacy shadow pattern it leaves", async () => {
    const criteriaRule: (severity: string) => AlertIncidentRule = (
      severity: string,
    ): AlertIncidentRule => {
      return newRule({
        name: "Criteria rule",
        // What saving a criteria rule writes into the first pattern column.
        alertTitlePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
        criteria: {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "alertSeverities",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: [severity],
            },
          ],
        },
      });
    };

    let stubs: Stubs = stubAll({ rules: [criteriaRule(ALERT_CRITICAL)] });

    expect(
      (await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert()))
        .outcome,
    ).toBe(AlertIncidentRuleOutcome.Declared);
    expect(stubs.createIncident).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
    jest.spyOn(logger, "error").mockImplementation((() => {}) as never);

    stubs = stubAll({ rules: [criteriaRule(ALERT_WARNING)] });

    expect(
      (await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert()))
        .outcome,
    ).toBe(AlertIncidentRuleOutcome.NoRuleMatched);
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("matches the alert as it is stored, after its own rules ran, not as it was handed over", async () => {
    // The label rules gave the stored alert the Database label.
    const stubs: Stubs = stubAll({
      rules: [newRule({ alertLabels: [LABEL_DATABASE] })],
      alert: newAlert({ labels: [{ id: LABEL_DATABASE }] }),
    });

    const handedOver: Alert = newAlert({ labels: [] });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(handedOver);

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Declared);

    const read: { id: ObjectID; select: Record<string, unknown> } = stubs
      .readAlert.mock.calls[0]![0] as never;

    expect(read.id.toString()).toBe(ALERT_ID.toString());
    expect(read.select).toEqual(getAlertIncidentRuleAlertSelect());
  });

  describe("monitor conditions read the alert's monitor", () => {
    function monitorWith(labelIds: Array<string>, name: string): Monitor {
      const monitor: Monitor = withId(new Monitor(), MONITOR_ID);
      monitor.name = name;
      monitor.labels = labelIds.map((id: string): Label => {
        return withId(new Label(), id);
      });
      return monitor;
    }

    test("a monitor that carries one of the rule's monitor labels matches", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({ monitorLabels: [LABEL_PRODUCTION] })],
      });
      stubs.readMonitor.mockResolvedValue(
        monitorWith([LABEL_PRODUCTION], "prod-db") as never,
      );

      expect(
        (await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert()))
          .outcome,
      ).toBe(AlertIncidentRuleOutcome.Declared);
    });

    test("a monitor without them does not", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({ monitorLabels: [LABEL_PRODUCTION] })],
      });
      stubs.readMonitor.mockResolvedValue(
        monitorWith([LABEL_DATABASE], "prod-db") as never,
      );

      expect(
        (await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert()))
          .outcome,
      ).toBe(AlertIncidentRuleOutcome.NoRuleMatched);
    });

    test("a monitor name pattern is matched case-insensitively", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({ monitorNamePattern: "^PROD-" })],
      });
      stubs.readMonitor.mockResolvedValue(monitorWith([], "prod-db") as never);

      expect(
        (await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert()))
          .outcome,
      ).toBe(AlertIncidentRuleOutcome.Declared);
    });

    test("an alert from no monitor never matches a monitor condition", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({ monitorLabels: [LABEL_PRODUCTION] })],
        alert: newAlert({ monitorId: null }),
      });

      expect(
        (await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert()))
          .outcome,
      ).toBe(AlertIncidentRuleOutcome.NoRuleMatched);
      expect(stubs.readMonitor).not.toHaveBeenCalled();
    });
  });

  test("an alert already linked to an incident is left alone", async () => {
    const stubs: Stubs = stubAll({ rules: [newRule({})], links: 1 });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.AlreadyLinked);
    expect(stubs.createIncident).not.toHaveBeenCalled();

    const countBy: { query: Record<string, unknown> } = stubs.countLinks.mock
      .calls[0]![0] as never;

    expect(countBy.query["alertId"]?.toString()).toBe(ALERT_ID.toString());
    expect(countBy.query["projectId"]).toEqual(PROJECT_ID);
  });
});

describe("the incident an alert incident rule declares", () => {
  test("is what Declare Incident on the alert's page fills in, created as OneUptime with the alert to link", async () => {
    const rule: AlertIncidentRule = newRule({
      name: "Critical alerts",
      incidentSeverityId: SEV1,
    });
    const stubs: Stubs = stubAll({
      rules: [rule],
      alert: newAlert({
        hosts: [HOST_ID],
        services: [SERVICE_ID],
        labels: [
          { id: LABEL_PRODUCTION },
          { id: LABEL_ARCHIVED, isArchived: true },
        ],
      }),
    });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    const { incident, miscDataProps, props } = declaredWith(stubs);

    expect(props).toEqual({ isRoot: true });
    expect(incident.projectId).toEqual(PROJECT_ID);
    expect(incident.title).toBe("Database CPU high");
    expect(incident.description).toBe("CPU stayed above 95% for 10 minutes.");
    expect(incident.incidentSeverityId?.toString()).toBe(SEV1);
    expect(idsOf(incident.monitors)).toEqual([MONITOR_ID]);
    expect(idsOf(incident.hosts)).toEqual([HOST_ID]);
    expect(incident.hosts![0]).toBeInstanceOf(Host);
    expect(idsOf(incident.services)).toEqual([SERVICE_ID]);
    // An archived label stays on the alert, but nobody picks it for a new record.
    expect(idsOf(incident.labels)).toEqual([LABEL_PRODUCTION]);
    expect(incident.isCreatedAutomatically).toBe(true);
    expect(incident.isVisibleOnStatusPage).toBe(true);
    expect(incident.isPrivate).toBeUndefined();
    // Its own on-call rules decide who it pages, never the alert's policies.
    expect(incident.onCallDutyPolicies).toBeUndefined();

    expect(miscDataProps).toEqual({
      [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID.toString()],
      [INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY]: "Critical alerts",
    });
  });

  test("is private when its alert is", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({})],
      alert: newAlert({ isPrivate: true }),
    });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(declaredWith(stubs).incident.isPrivate).toBe(true);
  });

  test("is kept off status pages when the rule says so", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ showIncidentOnStatusPage: false })],
    });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(declaredWith(stubs).incident.isVisibleOnStatusPage).toBe(false);
  });

  test("takes the alert's number as its title when the alert has none", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({})],
      alert: newAlert({ title: "  ", description: "" }),
    });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(declaredWith(stubs).incident.title).toBe("Alert ALT-12");
    expect(declaredWith(stubs).incident.description).toBeUndefined();
  });

  test("affects no monitor when the alert came from none", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({})],
      alert: newAlert({ monitorId: null }),
    });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(declaredWith(stubs).incident.monitors).toBeUndefined();
  });

  describe("its severity", () => {
    test("is the rule's while that is still the project's", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({ incidentSeverityId: MINOR })],
      });

      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
        MINOR,
      );
    });

    test("is the rule's even when it is archived: an automation keeps the value it was set up with", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({ incidentSeverityId: ARCHIVED_SEVERITY })],
      });

      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
        ARCHIVED_SEVERITY,
      );
    });

    test("falls back to the alert's mapped severity when the rule names one that is not the project's", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({ incidentSeverityId: OTHER_PROJECTS_SEVERITY })],
      });

      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      // Critical is the most severe alert severity: SEV1, the most severe incident one.
      expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
        SEV1,
      );
    });

    test("with none named, is the incident severity at the alert severity's place in the list", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({})],
        alert: newAlert({ alertSeverityId: ALERT_MAJOR }),
      });

      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
        SEV2,
      );
    });

    test("with none named, is the incident severity of the same name first", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({})],
        alert: newAlert({ alertSeverityId: ALERT_WARNING }),
      });
      stubs.readIncidentSeverities.mockResolvedValue(
        incidentSeverities([
          [SEV1, "Critical", 1],
          [SEV2, "Warning", 2],
          [MINOR, "Minor", 3],
          [ARCHIVED_SEVERITY, "Info", 4],
        ]) as never,
      );

      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
        SEV2,
      );
    });

    test("never maps onto an archived incident severity", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({})],
        alert: newAlert({ alertSeverityId: ALERT_WARNING }),
      });
      // Warning is third; the third incident severity is archived.
      stubs.readIncidentSeverities.mockResolvedValue(
        incidentSeverities([
          [SEV1, "SEV1", 1],
          [SEV2, "SEV2", 2],
          [ARCHIVED_SEVERITY, "Retired", 3, true],
        ]) as never,
      );

      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      // Clamped to the least severe live one instead.
      expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
        SEV2,
      );
    });

    test("for an alert without a severity, is the least severe of the project's live ones", async () => {
      const stubs: Stubs = stubAll({
        rules: [newRule({})],
        alert: newAlert({ alertSeverityId: null }),
      });

      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
        MINOR,
      );
      expect(stubs.readAlertSeverities).not.toHaveBeenCalled();
    });

    test("a project with no incident severity gets no incident, and the engine says why", async () => {
      const stubs: Stubs = stubAll({ rules: [newRule({})] });
      stubs.readIncidentSeverities.mockResolvedValue([] as never);

      const result: AlertIncidentRuleResult =
        await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

      expect(result.outcome).toBe(AlertIncidentRuleOutcome.Failed);
      expect(stubs.createIncident).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("no incident severity"),
        expect.anything(),
      );
    });
  });

  test("the alert's feed names the rule, and the incident by its number and link only", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ name: "Critical alerts" })],
    });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    const item: Record<string, unknown> = stubs.createFeed.mock
      .calls[0]![0] as never;

    expect(item["alertFeedEventType"]).toBe(
      AlertFeedEventType.IncidentRuleExecuted,
    );
    expect(item["alertId"]).toEqual(new ObjectID(ALERT_ID.toString()));
    expect(item["projectId"]).toEqual(PROJECT_ID);

    const markdown: string = feedMarkdown(stubs);

    expect(markdown).toContain(
      "🚨 **Alert Incident Rule executed:** **Critical alerts**",
    );
    expect(markdown).toContain(
      `Declared **[Incident INC-7](${INCIDENT_LINK})** from this alert.`,
    );
    // The incident may be private: its title is never written here.
    expect(markdown).not.toContain("Database CPU high");
  });

  test("a rule's name is written in the feed as the text it is", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ name: "[Pay me](https://evil.example) **now**" })],
    });

    await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    const markdown: string = feedMarkdown(stubs);

    expect(markdown).not.toContain("[Pay me](https://evil.example)");
    expect(markdown).not.toContain("**now**");
  });

  test("declaring that fails is logged, and never thrown into the alert's create chain", async () => {
    const stubs: Stubs = stubAll({ rules: [newRule({})] });
    stubs.createIncident.mockRejectedValue(
      new Error("database went away") as never,
    );

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Failed);
    expect(stubs.createFeed).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("database went away"),
      expect.anything(),
    );
  });

  test("a feed entry that cannot be written does not undo the incident", async () => {
    const stubs: Stubs = stubAll({ rules: [newRule({})] });
    stubs.createFeed.mockRejectedValue(new Error("feed is down") as never);

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Declared);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("feed is down"),
      expect.anything(),
    );
  });
});

describe("a rule that waits for the alert to stay unresolved", () => {
  test("schedules a check for when its wait is up, and declares nothing yet", async () => {
    const createdAt: Date = new Date(Date.now() - 2 * MINUTE);
    const stubs: Stubs = stubAll({
      rules: [newRule({ declareAfterInMinutes: 15 })],
      alert: newAlert({ createdAt: createdAt }),
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    const checkAt: Date = new Date(createdAt.getTime() + 15 * MINUTE);

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Waiting);
    expect(result.checkAt).toEqual(checkAt);
    expect(stubs.createIncident).not.toHaveBeenCalled();
    expect(stubs.createFeed).not.toHaveBeenCalled();
    expect(stubs.updates).toHaveLength(1);
    expect(stubs.updates[0]!.set).toEqual({ nextIncidentRuleCheckAt: checkAt });
    expect(stubs.updates[0]!.where).toEqual([
      ['"_id" = :id', { id: ALERT_ID.toString() }],
    ]);
  });

  test("declares right away when its wait is already up as the alert is read", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ declareAfterInMinutes: 15 })],
      alert: newAlert({ createdAt: new Date(Date.now() - 20 * MINUTE) }),
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Declared);
    expect(feedMarkdown(stubs)).toContain(
      "from this alert: it had stayed unresolved for 15 minutes.",
    );
  });

  test("decides over a later rule that declares right away: the first match decides", async () => {
    const stubs: Stubs = stubAll({
      rules: [
        newRule({
          name: "Critical, if it lasts",
          alertSeverities: [ALERT_CRITICAL],
          declareAfterInMinutes: 30,
        }),
        newRule({ name: "Everything, right away" }),
      ],
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.applyRulesToAlert(newAlert());

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Waiting);
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });
});

describe("checking an alert whose wait is up", () => {
  const NOW: Date = new Date();

  test("claims the check only while it is still due, in one statement", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ declareAfterInMinutes: 15 })],
      alert: newAlert({ createdAt: new Date(NOW.getTime() - 16 * MINUTE) }),
    });

    await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
      alertId: ALERT_ID,
      now: NOW,
    });

    expect(stubs.updates[0]).toEqual({
      set: { nextIncidentRuleCheckAt: null },
      where: [
        ['"_id" = :id', { id: ALERT_ID.toString() }],
        ['"nextIncidentRuleCheckAt" <= :now', { now: NOW }],
      ],
    });
  });

  test("a check another run claimed, or that is no longer due, does nothing", async () => {
    updatesAffect = 0;
    const stubs: Stubs = stubAll({ rules: [newRule({})] });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.NotDue);
    expect(stubs.readAlert).not.toHaveBeenCalled();
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("an alert resolved before its wait was up never becomes an incident", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ declareAfterInMinutes: 15 })],
      alert: newAlert({ createdAt: new Date(NOW.getTime() - 16 * MINUTE) }),
    });
    stubs.isResolved.mockResolvedValue(true as never);

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Resolved);
    expect(stubs.findRules).not.toHaveBeenCalled();
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("an alert still unresolved when the wait is up has its incident declared", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ declareAfterInMinutes: 15, incidentSeverityId: SEV2 })],
      alert: newAlert({ createdAt: new Date(NOW.getTime() - 16 * MINUTE) }),
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Declared);
    expect(declaredWith(stubs).incident.incidentSeverityId?.toString()).toBe(
      SEV2,
    );
    // The claim, and nothing scheduled again.
    expect(stubs.updates).toHaveLength(1);
  });

  test("is matched again as the alert is now: a rule that waits longer schedules the next check", async () => {
    const createdAt: Date = new Date(NOW.getTime() - 16 * MINUTE);
    // Raised to Critical while it waited.
    const stubs: Stubs = stubAll({
      rules: [
        newRule({
          alertSeverities: [ALERT_CRITICAL],
          declareAfterInMinutes: 60,
        }),
        newRule({ declareAfterInMinutes: 15 }),
      ],
      alert: newAlert({ createdAt: createdAt }),
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    const checkAt: Date = new Date(createdAt.getTime() + 60 * MINUTE);

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Waiting);
    expect(result.checkAt).toEqual(checkAt);
    expect(stubs.createIncident).not.toHaveBeenCalled();
    expect(stubs.updates[1]!.set).toEqual({ nextIncidentRuleCheckAt: checkAt });
  });

  test("an alert no rule matches any more stays an alert", async () => {
    const stubs: Stubs = stubAll({ rules: [] });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.NoRuleMatched);
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("an alert linked to an incident while it waited is left alone", async () => {
    const stubs: Stubs = stubAll({
      rules: [newRule({ declareAfterInMinutes: 15 })],
      alert: newAlert({ createdAt: new Date(NOW.getTime() - 16 * MINUTE) }),
      links: 1,
    });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.AlreadyLinked);
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("an alert deleted since is skipped", async () => {
    const stubs: Stubs = stubAll({ rules: [newRule({})], alert: null });

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Failed);
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("a failure is logged, never thrown", async () => {
    const stubs: Stubs = stubAll({ rules: [newRule({})] });
    stubs.readAlert.mockRejectedValue(new Error("connection reset") as never);

    const result: AlertIncidentRuleResult =
      await AlertIncidentRuleEngineService.checkAlertWhenWaitIsUp({
        alertId: ALERT_ID,
        now: NOW,
      });

    expect(result.outcome).toBe(AlertIncidentRuleOutcome.Failed);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("connection reset"),
      expect.anything(),
    );
  });
});

describe("the worker's minute", () => {
  test("checks every alert whose check is due, oldest first, at most a run's worth, with one clock", async () => {
    const stubs: Stubs = stubAll({ rules: [] });
    const first: Alert = withId(new Alert(), ObjectID.generate().toString());
    const second: Alert = withId(new Alert(), ObjectID.generate().toString());
    stubs.findAlerts.mockResolvedValue([first, second] as never);

    const checked: Array<{ alertId: ObjectID; now: Date }> = [];
    jest
      .spyOn(AlertIncidentRuleEngineService, "checkAlertWhenWaitIsUp")
      .mockImplementation((async (data: {
        alertId: ObjectID;
        now: Date;
      }): Promise<AlertIncidentRuleResult> => {
        checked.push(data);
        return { outcome: AlertIncidentRuleOutcome.Resolved };
      }) as never);

    const results: Array<AlertIncidentRuleResult> =
      await AlertIncidentRuleEngineService.runDueChecks();

    expect(results).toHaveLength(2);
    expect(
      checked.map((data: { alertId: ObjectID }): string => {
        return data.alertId.toString();
      }),
    ).toEqual([first._id, second._id]);
    expect(checked[0]!.now).toBe(checked[1]!.now);

    const findBy: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = stubs.findAlerts.mock.calls[0]![0] as never;

    expect(Object.keys(findBy.query)).toEqual(["nextIncidentRuleCheckAt"]);
    expect(findBy.sort).toEqual({
      nextIncidentRuleCheckAt: SortOrder.Ascending,
    });
    expect(findBy.limit).toBe(ALERT_INCIDENT_RULE_CHECKS_PER_RUN);
  });

  test("a read that fails is logged, and the run ends quietly", async () => {
    const stubs: Stubs = stubAll({ rules: [] });
    stubs.findAlerts.mockRejectedValue(new Error("timeout") as never);

    expect(await AlertIncidentRuleEngineService.runDueChecks()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("timeout"),
    );
  });
});

describe("what the engine reads and writes", () => {
  test("the incident takes every affected resource the two models share, monitors and labels aside", () => {
    const columns: Array<string> = getAlertIncidentRuleResourceColumns();

    expect(columns).toEqual(
      expect.arrayContaining([
        "hosts",
        "kubernetesClusters",
        "dockerHosts",
        "podmanHosts",
        "services",
        "serviceLevelObjectives",
      ]),
    );
    expect(columns).not.toContain("monitors");
    expect(columns).not.toContain("labels");
    expect(columns).not.toContain("onCallDutyPolicies");

    for (const column of columns) {
      expect({ column, alert: new Alert().hasColumn(column) }).toEqual({
        column,
        alert: true,
      });
      expect({ column, incident: new Incident().hasColumn(column) }).toEqual({
        column,
        incident: true,
      });
    }
  });

  test("the alert is read with what its conditions and its incident need", () => {
    const select: Record<string, unknown> =
      getAlertIncidentRuleAlertSelect() as Record<string, unknown>;

    for (const column of [
      "title",
      "description",
      "createdAt",
      "monitorId",
      "alertSeverityId",
      "currentAlertStateId",
      "isPrivate",
      "alertNumberWithPrefix",
    ]) {
      expect({ column, selected: select[column] }).toEqual({
        column,
        selected: true,
      });
    }

    expect(select["labels"]).toEqual({ _id: true, isArchived: true });
    expect(select["hosts"]).toEqual({ _id: true });
  });

  test("the feed's sentence says how long a rule that waited waited", () => {
    expect(
      getAlertIncidentRuleDeclaredSentence({
        incidentLabel: "Incident #3",
        incidentLink: "https://x.example/i/3",
        declareAfterInMinutes: 0,
      }).toString(),
    ).toBe(
      "Declared **[Incident #3](https://x.example/i/3)** from this alert.",
    );

    expect(
      getAlertIncidentRuleDeclaredSentence({
        incidentLabel: "Incident #3",
        incidentLink: "https://x.example/i/3",
        declareAfterInMinutes: 90,
      }).toString(),
    ).toBe(
      "Declared **[Incident #3](https://x.example/i/3)** from this alert: it had stayed unresolved for 1 hour 30 minutes.",
    );
  });
});
