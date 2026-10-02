import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import MonitorService from "../../../Server/Services/MonitorService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import RunbookRuleService from "../../../Server/Services/RunbookRuleService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { getRunbookRuleCriteriaFields } from "../../../Types/Runbook/RunbookRuleCriteria";
import RunbookRuleTriggerEntity from "../../../Types/Runbook/RunbookRuleTriggerEntity";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * "The incident runbook rules don't have things like incident labels,
 * monitor labels, and all of that stuff. Can you please add those things as
 * well, just like we have on the incident privacy rules?" - the maintainer.
 *
 * Runbook rules now match an incident, alert or scheduled maintenance event
 * on its monitors, severity, labels, its monitors' labels, names and
 * descriptions, and its title and description, combined with Match all or
 * Match any - and a rule saved before any of this keeps matching exactly as
 * it did.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000003");
const EVENT_ID: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000004");

const MONITOR_API: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const MONITOR_WORKER: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const MONITOR_ELSEWHERE: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000003",
);

const LABEL_PRODUCTION: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000001",
);
const LABEL_CUSTOMER: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000002",
);
const LABEL_STAGING: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);

const SEVERITY_CRITICAL: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000001",
);
const SEVERITY_MINOR: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000002",
);

const RUNBOOK_FAILOVER: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000001",
);
const RUNBOOK_SNAPSHOT: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000002",
);

interface FakeMonitor {
  name: string;
  description: string;
  labels: Array<ObjectID>;
}

/*
 * The monitors the incidents, alerts and events below come from:
 * - checkout-api: a production service, labelled production;
 * - background-worker: a staging worker, labelled staging.
 */
const MONITORS: Record<string, FakeMonitor> = {
  [MONITOR_API.toString()]: {
    name: "checkout-api",
    description: "Production checkout service",
    labels: [LABEL_PRODUCTION],
  },
  [MONITOR_WORKER.toString()]: {
    name: "background-worker",
    description: "Staging queue worker",
    labels: [LABEL_STAGING],
  },
};

type Ref = { id: ObjectID; _id: string };

function ref(id: ObjectID): Ref {
  return { id: id, _id: id.toString() };
}

function refs(ids: Array<ObjectID>): Array<Ref> {
  return ids.map(ref);
}

function fakeIncident(overrides: Record<string, unknown> = {}): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Checkout API is down",
    description: "Customers cannot pay: connection refused",
    incidentSeverityId: SEVERITY_CRITICAL,
    monitors: refs([MONITOR_API, MONITOR_WORKER]),
    labels: refs([LABEL_PRODUCTION, LABEL_CUSTOMER]),
    ...overrides,
  } as unknown as Incident;
}

function fakeAlert(overrides: Record<string, unknown> = {}): Alert {
  return {
    id: ALERT_ID,
    _id: ALERT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Checkout API latency is high",
    description: "p99 above 2s: timeout",
    alertSeverityId: SEVERITY_CRITICAL,
    monitorId: MONITOR_API,
    labels: refs([LABEL_PRODUCTION, LABEL_CUSTOMER]),
    ...overrides,
  } as unknown as Alert;
}

function fakeEvent(
  overrides: Record<string, unknown> = {},
): ScheduledMaintenance {
  return {
    id: EVENT_ID,
    _id: EVENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Checkout database upgrade",
    description: "Postgres 16 upgrade with a short write freeze",
    monitors: refs([MONITOR_API, MONITOR_WORKER]),
    labels: refs([LABEL_PRODUCTION, LABEL_CUSTOMER]),
    ...overrides,
  } as unknown as ScheduledMaintenance;
}

function criteria(
  filterCondition: FilterCondition,
  filters: Array<RuleCriteriaFilter>,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

function rule(overrides: Record<string, unknown> = {}): RunbookRule {
  return {
    id: new ObjectID("60000000-0000-4000-8000-000000000001"),
    _id: "60000000-0000-4000-8000-000000000001",
    name: "Start the failover runbook",
    runbooks: refs([RUNBOOK_FAILOVER]),
    ...overrides,
  } as unknown as RunbookRule;
}

function withCriteria(
  filterCondition: FilterCondition,
  filters: Array<RuleCriteriaFilter>,
  overrides: Record<string, unknown> = {},
): RunbookRule {
  return rule({ criteria: criteria(filterCondition, filters), ...overrides });
}

function one(filter: RuleCriteriaFilter): RunbookRule {
  return withCriteria(FilterCondition.All, [filter]);
}

function ids(...values: Array<ObjectID>): Array<string> {
  return values.map((value: ObjectID): string => {
    return value.toString();
  });
}

let findMonitor: SpyInstance<typeof MonitorService.findOneById>;

beforeEach(() => {
  findMonitor = jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation(
      async (
        data: Parameters<typeof MonitorService.findOneById>[0],
      ): Promise<Monitor | null> => {
        const monitor: FakeMonitor | undefined = MONITORS[data.id.toString()];

        if (!monitor) {
          return null;
        }

        return {
          id: data.id,
          _id: data.id.toString(),
          name: monitor.name,
          description: monitor.description,
          labels: refs(monitor.labels),
        } as unknown as Monitor;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * One condition at a time, on each kind of record: what it is true for and
 * what it is false for. The incident and the event both come from
 * checkout-api and background-worker; the alert from checkout-api only.
 */
interface SingleConditionCase {
  name: string;
  filter: RuleCriteriaFilter;
  matches: boolean;
}

const SHARED_CASES: Array<SingleConditionCase> = [
  {
    name: "Monitors has any of one of its monitors",
    filter: {
      field: "monitors",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(MONITOR_API, MONITOR_ELSEWHERE),
    },
    matches: true,
  },
  {
    name: "Monitors has any of a monitor it does not come from",
    filter: {
      field: "monitors",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(MONITOR_ELSEWHERE),
    },
    matches: false,
  },
  {
    name: "Monitors has none of a monitor it does not come from",
    filter: {
      field: "monitors",
      operator: RuleCriteriaOperator.HasNoneOf,
      value: ids(MONITOR_ELSEWHERE),
    },
    matches: true,
  },
  {
    name: "Monitors has none of its own monitor",
    filter: {
      field: "monitors",
      operator: RuleCriteriaOperator.HasNoneOf,
      value: ids(MONITOR_API),
    },
    matches: false,
  },
  {
    name: "Labels has any of one of its labels",
    filter: {
      field: "labels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_STAGING, LABEL_PRODUCTION),
    },
    matches: true,
  },
  {
    name: "Labels has any of a label it does not carry",
    filter: {
      field: "labels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_STAGING),
    },
    matches: false,
  },
  {
    name: "Labels has all of the labels it carries",
    filter: {
      field: "labels",
      operator: RuleCriteriaOperator.HasAllOf,
      value: ids(LABEL_PRODUCTION, LABEL_CUSTOMER),
    },
    matches: true,
  },
  {
    name: "Labels has all of, one of which it lacks",
    filter: {
      field: "labels",
      operator: RuleCriteriaOperator.HasAllOf,
      value: ids(LABEL_PRODUCTION, LABEL_STAGING),
    },
    matches: false,
  },
  {
    name: "Labels has none of a label it carries",
    filter: {
      field: "labels",
      operator: RuleCriteriaOperator.HasNoneOf,
      value: ids(LABEL_CUSTOMER),
    },
    matches: false,
  },
  {
    name: "Monitor Labels has any of its monitor's label",
    filter: {
      field: "monitorLabels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_PRODUCTION),
    },
    matches: true,
  },
  {
    name: "Monitor Labels has any of a label no monitor of it carries",
    filter: {
      field: "monitorLabels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_CUSTOMER),
    },
    matches: false,
  },
  {
    name: "Title contains, ignoring case",
    filter: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "CHECKOUT",
    },
    matches: true,
  },
  {
    name: "Title contains text it does not have",
    filter: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "billing",
    },
    matches: false,
  },
  {
    name: "Title does not contain text it does not have",
    filter: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.DoesNotContain,
      value: "billing",
    },
    matches: true,
  },
  {
    name: "Title starts with its first word",
    filter: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.StartsWith,
      value: "checkout",
    },
    matches: true,
  },
  {
    name: "Title equals only part of it",
    filter: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.Equals,
      value: "checkout",
    },
    matches: false,
  },
  {
    name: "Title matches a wildcard",
    filter: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.MatchesPattern,
      value: "*checkout*",
    },
    matches: true,
  },
  {
    name: "Title does not match a regex it matches",
    filter: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.DoesNotMatchPattern,
      value: "^checkout\\b",
    },
    matches: false,
  },
  {
    name: "Monitor Name matches a regex one monitor's name fits",
    filter: {
      field: "monitorNamePattern",
      operator: RuleCriteriaOperator.MatchesPattern,
      value: "^checkout-",
    },
    matches: true,
  },
  {
    name: "Monitor Name ends with what no monitor's name does",
    filter: {
      field: "monitorNamePattern",
      operator: RuleCriteriaOperator.EndsWith,
      value: "-db",
    },
    matches: false,
  },
  {
    name: "Monitor Description contains a word of one monitor's",
    filter: {
      field: "monitorDescriptionPattern",
      operator: RuleCriteriaOperator.Contains,
      value: "production",
    },
    matches: true,
  },
  {
    name: "Monitor Description does not equal what no monitor's is",
    filter: {
      field: "monitorDescriptionPattern",
      operator: RuleCriteriaOperator.NotEquals,
      value: "Billing service",
    },
    matches: true,
  },
];

describe("incident runbook rules", () => {
  const INCIDENT_CASES: Array<SingleConditionCase> = [
    ...SHARED_CASES,
    {
      name: "Incident Severities has any of its severity",
      filter: {
        field: "incidentSeverities",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(SEVERITY_MINOR, SEVERITY_CRITICAL),
      },
      matches: true,
    },
    {
      name: "Incident Severities has any of another severity",
      filter: {
        field: "incidentSeverities",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(SEVERITY_MINOR),
      },
      matches: false,
    },
    {
      name: "Incident Description contains a phrase of it",
      filter: {
        field: "descriptionPattern",
        operator: RuleCriteriaOperator.Contains,
        value: "connection refused",
      },
      matches: true,
    },
  ];

  it.each(INCIDENT_CASES)(
    "$name: $matches",
    async ({ filter, matches }: SingleConditionCase) => {
      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident(),
          one(filter),
        ),
      ).resolves.toBe(matches);
    },
  );

  it("Match all needs every condition", async () => {
    const filters: Array<RuleCriteriaFilter> = [
      {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_PRODUCTION),
      },
      {
        field: "incidentSeverities",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(SEVERITY_CRITICAL),
      },
      {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_CUSTOMER),
      },
      {
        field: "titlePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "down",
      },
    ];

    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        withCriteria(FilterCondition.All, filters),
      ),
    ).resolves.toBe(true);
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident({ incidentSeverityId: SEVERITY_MINOR }),
        withCriteria(FilterCondition.All, filters),
      ),
    ).resolves.toBe(false);
  });

  it("Match any needs one condition", async () => {
    const filters: Array<RuleCriteriaFilter> = [
      {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_STAGING),
      },
      {
        field: "incidentSeverities",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(SEVERITY_CRITICAL),
      },
    ];

    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        withCriteria(FilterCondition.Any, filters),
      ),
    ).resolves.toBe(true);
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident({ incidentSeverityId: SEVERITY_MINOR }),
        withCriteria(FilterCondition.Any, filters),
      ),
    ).resolves.toBe(false);
  });

  it("checks monitor conditions one monitor at a time", async () => {
    /*
     * checkout-api is "api" but production; background-worker is staging
     * but no "api": no single monitor meets both conditions.
     */
    const apiAndStaging: Array<RuleCriteriaFilter> = [
      {
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "api",
      },
      {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_STAGING),
      },
    ];

    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        withCriteria(FilterCondition.All, apiAndStaging),
      ),
    ).resolves.toBe(false);

    // With Match any, either monitor is enough.
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        withCriteria(FilterCondition.Any, apiAndStaging),
      ),
    ).resolves.toBe(true);

    // And one monitor meeting both is enough for Match all.
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        withCriteria(FilterCondition.All, [
          apiAndStaging[0]!,
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(LABEL_PRODUCTION),
          },
        ]),
      ),
    ).resolves.toBe(true);
  });

  it("reads each monitor once per rule, however many conditions use it", async () => {
    await RunbookRuleEngineService.doesIncidentMatchRule(
      fakeIncident(),
      withCriteria(FilterCondition.All, [
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "worker",
        },
        {
          field: "monitorDescriptionPattern",
          operator: RuleCriteriaOperator.Contains,
          value: "queue",
        },
        {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAllOf,
          value: ids(LABEL_STAGING),
        },
      ]),
    );

    expect(findMonitor).toHaveBeenCalledTimes(2);
  });

  it("a monitor condition is never true for an incident without monitors, its negation always", async () => {
    const incident: Incident = fakeIncident({ monitors: [] });

    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        incident,
        one({
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(LABEL_PRODUCTION),
        }),
      ),
    ).resolves.toBe(false);
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        incident,
        one({
          field: "monitors",
          operator: RuleCriteriaOperator.HasNoneOf,
          value: ids(MONITOR_API),
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        incident,
        one({
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasNoneOf,
          value: ids(LABEL_PRODUCTION),
        }),
      ),
    ).resolves.toBe(true);
    expect(findMonitor).not.toHaveBeenCalled();
  });

  it("a severity condition is never true for an incident without one", async () => {
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident({ incidentSeverityId: undefined }),
        one({
          field: "incidentSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(SEVERITY_CRITICAL),
        }),
      ),
    ).resolves.toBe(false);
  });

  it("matches labels label rules attached earlier in the same create hook", async () => {
    // IncidentLabelRuleEngineService writes these back as Label models.
    const incident: Incident = fakeIncident({
      labels: [ref(LABEL_STAGING)],
    });

    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        incident,
        one({
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(LABEL_STAGING),
        }),
      ),
    ).resolves.toBe(true);
  });

  it("reads a relation handed over as a plain { _id }", async () => {
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident({ labels: [{ _id: LABEL_CUSTOMER.toString() }] }),
        one({
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(LABEL_CUSTOMER),
        }),
      ),
    ).resolves.toBe(true);
  });

  it("never matches on an alert severity, which an incident cannot have", async () => {
    const alertSeverity: RuleCriteriaFilter = {
      field: "alertSeverities",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(SEVERITY_CRITICAL),
    };

    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        one(alertSeverity),
      ),
    ).resolves.toBe(false);
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        one({ ...alertSeverity, operator: RuleCriteriaOperator.HasNoneOf }),
      ),
    ).resolves.toBe(false);
  });

  it("ignores the never-matching legacy pattern the server writes beside conditions", async () => {
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        withCriteria(
          FilterCondition.All,
          [
            {
              field: "labels",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: ids(LABEL_PRODUCTION),
            },
          ],
          {
            titlePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
            monitors: refs([MONITOR_ELSEWHERE]),
          },
        ),
      ),
    ).resolves.toBe(true);
  });

  it("a rule with no conditions starts its runbooks for every incident", async () => {
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(
        fakeIncident(),
        withCriteria(FilterCondition.All, []),
      ),
    ).resolves.toBe(true);
    await expect(
      RunbookRuleEngineService.doesIncidentMatchRule(fakeIncident(), rule()),
    ).resolves.toBe(true);
  });

  describe("rules saved before conditions existed", () => {
    it("keep matching on their title and description patterns", async () => {
      const legacy: RunbookRule = rule({
        titlePattern: "checkout|payments",
        descriptionPattern: "connection refused",
      });

      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(fakeIncident(), legacy),
      ).resolves.toBe(true);
      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident({ description: "Slow responses" }),
          legacy,
        ),
      ).resolves.toBe(false);
      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident({ title: undefined }),
          rule({ titlePattern: "checkout" }),
        ),
      ).resolves.toBe(false);
    });

    it("never match on, nor throw for, an invalid regex", async () => {
      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident(),
          rule({ titlePattern: "checkout(" }),
        ),
      ).resolves.toBe(false);
    });

    it("match every column they fill, as the API can write them", async () => {
      const everything: RunbookRule = rule({
        monitors: refs([MONITOR_API]),
        incidentSeverities: refs([SEVERITY_CRITICAL]),
        labels: refs([LABEL_CUSTOMER]),
        monitorLabels: refs([LABEL_PRODUCTION]),
        monitorNamePattern: "^checkout",
        monitorDescriptionPattern: "production",
        titlePattern: "down",
      });

      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident(),
          everything,
        ),
      ).resolves.toBe(true);
      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident({ labels: refs([LABEL_STAGING]) }),
          everything,
        ),
      ).resolves.toBe(false);
      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident({ monitors: refs([MONITOR_WORKER]) }),
          everything,
        ),
      ).resolves.toBe(false);
    });

    it("leave an alert severity column alone on an incident rule", async () => {
      await expect(
        RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident(),
          rule({ alertSeverities: refs([SEVERITY_MINOR]) }),
        ),
      ).resolves.toBe(true);
    });
  });
});

describe("alert runbook rules", () => {
  const ALERT_CASES: Array<SingleConditionCase> = [
    {
      name: "Monitors has any of the alert's monitor",
      filter: {
        field: "monitors",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(MONITOR_API),
      },
      matches: true,
    },
    {
      name: "Monitors has any of a monitor the alert does not come from",
      filter: {
        field: "monitors",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(MONITOR_WORKER),
      },
      matches: false,
    },
    {
      name: "Alert Severities has any of its severity",
      filter: {
        field: "alertSeverities",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(SEVERITY_CRITICAL),
      },
      matches: true,
    },
    {
      name: "Alert Severities has none of its severity",
      filter: {
        field: "alertSeverities",
        operator: RuleCriteriaOperator.HasNoneOf,
        value: ids(SEVERITY_CRITICAL),
      },
      matches: false,
    },
    {
      name: "Alert Labels has all of its labels",
      filter: {
        field: "labels",
        operator: RuleCriteriaOperator.HasAllOf,
        value: ids(LABEL_PRODUCTION, LABEL_CUSTOMER),
      },
      matches: true,
    },
    {
      name: "Alert Labels has any of a label it lacks",
      filter: {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_STAGING),
      },
      matches: false,
    },
    {
      name: "Monitor Labels has any of its monitor's label",
      filter: {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_PRODUCTION),
      },
      matches: true,
    },
    {
      name: "Monitor Labels has any of the other monitor's label",
      filter: {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_STAGING),
      },
      matches: false,
    },
    {
      name: "Monitor Name starts with its monitor's name",
      filter: {
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.StartsWith,
        value: "checkout",
      },
      matches: true,
    },
    {
      name: "Monitor Description contains the other monitor's words",
      filter: {
        field: "monitorDescriptionPattern",
        operator: RuleCriteriaOperator.Contains,
        value: "queue",
      },
      matches: false,
    },
    {
      name: "Alert Title contains, ignoring case",
      filter: {
        field: "titlePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "LATENCY",
      },
      matches: true,
    },
    {
      name: "Alert Description matches a regex",
      filter: {
        field: "descriptionPattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "timeout$",
      },
      matches: true,
    },
  ];

  it.each(ALERT_CASES)(
    "$name: $matches",
    async ({ filter, matches }: SingleConditionCase) => {
      await expect(
        RunbookRuleEngineService.doesAlertMatchRule(fakeAlert(), one(filter)),
      ).resolves.toBe(matches);
    },
  );

  it("Match all and Match any combine alert conditions", async () => {
    const filters: Array<RuleCriteriaFilter> = [
      {
        field: "alertSeverities",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(SEVERITY_MINOR),
      },
      {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: ids(LABEL_PRODUCTION),
      },
    ];

    await expect(
      RunbookRuleEngineService.doesAlertMatchRule(
        fakeAlert(),
        withCriteria(FilterCondition.All, filters),
      ),
    ).resolves.toBe(false);
    await expect(
      RunbookRuleEngineService.doesAlertMatchRule(
        fakeAlert(),
        withCriteria(FilterCondition.Any, filters),
      ),
    ).resolves.toBe(true);
  });

  it("an alert without a monitor meets no monitor condition", async () => {
    const alert: Alert = fakeAlert({ monitorId: undefined });

    for (const field of ["monitorLabels", "monitors"]) {
      await expect(
        RunbookRuleEngineService.doesAlertMatchRule(
          alert,
          one({
            field: field,
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(field === "monitors" ? MONITOR_API : LABEL_PRODUCTION),
          }),
        ),
      ).resolves.toBe(false);
    }

    await expect(
      RunbookRuleEngineService.doesAlertMatchRule(
        alert,
        one({
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "checkout",
        }),
      ),
    ).resolves.toBe(false);
    expect(findMonitor).not.toHaveBeenCalled();
  });

  it("never matches on an incident severity, which an alert cannot have", async () => {
    await expect(
      RunbookRuleEngineService.doesAlertMatchRule(
        fakeAlert(),
        one({
          field: "incidentSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(SEVERITY_CRITICAL),
        }),
      ),
    ).resolves.toBe(false);
  });

  it("keeps rules saved before conditions existed working", async () => {
    await expect(
      RunbookRuleEngineService.doesAlertMatchRule(
        fakeAlert(),
        rule({ titlePattern: "latency", descriptionPattern: "p99" }),
      ),
    ).resolves.toBe(true);
    await expect(
      RunbookRuleEngineService.doesAlertMatchRule(
        fakeAlert(),
        rule({ titlePattern: "^disk" }),
      ),
    ).resolves.toBe(false);
    await expect(
      RunbookRuleEngineService.doesAlertMatchRule(
        fakeAlert(),
        rule({ alertSeverities: refs([SEVERITY_MINOR]) }),
      ),
    ).resolves.toBe(false);
  });
});

describe("scheduled maintenance runbook rules", () => {
  const EVENT_CASES: Array<SingleConditionCase> = [
    ...SHARED_CASES,
    {
      name: "Event Description contains a word of it",
      filter: {
        field: "descriptionPattern",
        operator: RuleCriteriaOperator.Contains,
        value: "write freeze",
      },
      matches: true,
    },
  ];

  it.each(EVENT_CASES)(
    "$name: $matches",
    async ({ filter, matches }: SingleConditionCase) => {
      await expect(
        RunbookRuleEngineService.doesScheduledMaintenanceMatchRule(
          fakeEvent(),
          one(filter),
        ),
      ).resolves.toBe(matches);
    },
  );

  it("checks monitor conditions one affected monitor at a time", async () => {
    await expect(
      RunbookRuleEngineService.doesScheduledMaintenanceMatchRule(
        fakeEvent(),
        withCriteria(FilterCondition.All, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "worker",
          },
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(LABEL_PRODUCTION),
          },
        ]),
      ),
    ).resolves.toBe(false);
    await expect(
      RunbookRuleEngineService.doesScheduledMaintenanceMatchRule(
        fakeEvent(),
        withCriteria(FilterCondition.All, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "worker",
          },
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(LABEL_STAGING),
          },
        ]),
      ),
    ).resolves.toBe(true);
  });

  it.each(["incidentSeverities", "alertSeverities"])(
    "never matches on %s, which an event does not have",
    async (field: string) => {
      await expect(
        RunbookRuleEngineService.doesScheduledMaintenanceMatchRule(
          fakeEvent(),
          one({
            field: field,
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(SEVERITY_CRITICAL),
          }),
        ),
      ).resolves.toBe(false);
    },
  );

  it("keeps rules saved before conditions existed working", async () => {
    await expect(
      RunbookRuleEngineService.doesScheduledMaintenanceMatchRule(
        fakeEvent(),
        rule({ titlePattern: "database upgrade" }),
      ),
    ).resolves.toBe(true);
    await expect(
      RunbookRuleEngineService.doesScheduledMaintenanceMatchRule(
        fakeEvent(),
        rule({ descriptionPattern: "kernel" }),
      ),
    ).resolves.toBe(false);
  });
});

describe("every criterion each trigger offers is evaluated", () => {
  /*
   * For every field a page offers, a condition the record meets and one it
   * does not. A field the engine let through without evaluating it would
   * read as true for both; one it refused would read as false for both.
   */
  const MEETS: Record<string, RuleCriteriaFilter> = {
    monitors: {
      field: "monitors",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(MONITOR_API),
    },
    incidentSeverities: {
      field: "incidentSeverities",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(SEVERITY_CRITICAL),
    },
    alertSeverities: {
      field: "alertSeverities",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(SEVERITY_CRITICAL),
    },
    labels: {
      field: "labels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_PRODUCTION),
    },
    monitorLabels: {
      field: "monitorLabels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_PRODUCTION),
    },
    titlePattern: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "checkout",
    },
    descriptionPattern: {
      field: "descriptionPattern",
      operator: RuleCriteriaOperator.MatchesPattern,
      value: ".+",
    },
    monitorNamePattern: {
      field: "monitorNamePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "checkout",
    },
    monitorDescriptionPattern: {
      field: "monitorDescriptionPattern",
      operator: RuleCriteriaOperator.Contains,
      value: "production",
    },
  };

  const MISSES: Record<string, RuleCriteriaFilter> = {
    monitors: {
      field: "monitors",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(MONITOR_ELSEWHERE),
    },
    incidentSeverities: {
      field: "incidentSeverities",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(SEVERITY_MINOR),
    },
    alertSeverities: {
      field: "alertSeverities",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(SEVERITY_MINOR),
    },
    labels: {
      field: "labels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_STAGING),
    },
    monitorLabels: {
      field: "monitorLabels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ids(LABEL_CUSTOMER),
    },
    titlePattern: {
      field: "titlePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "billing",
    },
    descriptionPattern: {
      field: "descriptionPattern",
      operator: RuleCriteriaOperator.Contains,
      value: "no such words",
    },
    monitorNamePattern: {
      field: "monitorNamePattern",
      operator: RuleCriteriaOperator.Contains,
      value: "billing",
    },
    monitorDescriptionPattern: {
      field: "monitorDescriptionPattern",
      operator: RuleCriteriaOperator.Contains,
      value: "billing",
    },
  };

  type Matcher = (rule: RunbookRule) => Promise<boolean>;

  const MATCHERS: Array<[RunbookRuleTriggerEntity, Matcher]> = [
    [
      RunbookRuleTriggerEntity.Incident,
      (runbookRule: RunbookRule): Promise<boolean> => {
        return RunbookRuleEngineService.doesIncidentMatchRule(
          fakeIncident(),
          runbookRule,
        );
      },
    ],
    [
      RunbookRuleTriggerEntity.Alert,
      (runbookRule: RunbookRule): Promise<boolean> => {
        return RunbookRuleEngineService.doesAlertMatchRule(
          fakeAlert(),
          runbookRule,
        );
      },
    ],
    [
      RunbookRuleTriggerEntity.ScheduledMaintenance,
      (runbookRule: RunbookRule): Promise<boolean> => {
        return RunbookRuleEngineService.doesScheduledMaintenanceMatchRule(
          fakeEvent(),
          runbookRule,
        );
      },
    ],
  ];

  it.each(MATCHERS)(
    "%s rules",
    async (trigger: RunbookRuleTriggerEntity, matches: Matcher) => {
      const fields: ReadonlyArray<string> =
        getRunbookRuleCriteriaFields(trigger);

      expect(fields.length).toBeGreaterThanOrEqual(7);

      for (const field of fields) {
        expect({ field, meets: await matches(one(MEETS[field]!)) }).toEqual({
          field,
          meets: true,
        });
        expect({ field, meets: await matches(one(MISSES[field]!)) }).toEqual({
          field,
          meets: false,
        });
      }
    },
  );
});

describe("starting runbooks when a record is created", () => {
  let findRules: SpyInstance<typeof RunbookRuleService.findBy>;
  let startRunbook: SpyInstance<
    typeof RunbookRuleEngineService.startRunbookFor
  >;

  function mockRules(rules: Array<RunbookRule>): void {
    findRules.mockResolvedValue(rules);
  }

  function startedRunbookIds(): Array<string> {
    return startRunbook.mock.calls.map(
      (
        call: Parameters<typeof RunbookRuleEngineService.startRunbookFor>,
      ): string => {
        return call[0].runbookId.toString();
      },
    );
  }

  beforeEach(() => {
    findRules = jest.spyOn(RunbookRuleService, "findBy").mockResolvedValue([]);
    startRunbook = jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue(null);
  });

  it("reads the project's enabled incident rules with every criterion", async () => {
    await RunbookRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(findRules).toHaveBeenCalledTimes(1);
    const read: Parameters<typeof RunbookRuleService.findBy>[0] =
      findRules.mock.calls[0]![0];

    expect(read.query).toEqual({
      projectId: PROJECT_ID,
      isEnabled: true,
      triggerEntityType: RunbookRuleTriggerEntity.Incident,
    });
    expect(read.props).toEqual({ isRoot: true });
    expect(read.select).toEqual(
      expect.objectContaining({
        criteria: true,
        runbooks: { _id: true },
        monitors: { _id: true },
        incidentSeverities: { _id: true },
        alertSeverities: { _id: true },
        labels: { _id: true },
        monitorLabels: { _id: true },
        titlePattern: true,
        descriptionPattern: true,
        monitorNamePattern: true,
        monitorDescriptionPattern: true,
      }),
    );
  });

  it("starts the runbooks of the matching rules once each, linked to the incident", async () => {
    mockRules([
      withCriteria(
        FilterCondition.All,
        [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(LABEL_PRODUCTION),
          },
        ],
        { runbooks: refs([RUNBOOK_FAILOVER, RUNBOOK_SNAPSHOT]) },
      ),
      withCriteria(
        FilterCondition.All,
        [
          {
            field: "incidentSeverities",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(SEVERITY_CRITICAL),
          },
        ],
        { runbooks: refs([RUNBOOK_SNAPSHOT]) },
      ),
      // A staging rule: does not match this production incident.
      withCriteria(
        FilterCondition.All,
        [
          {
            field: "labels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ids(LABEL_STAGING),
          },
        ],
        {
          runbooks: refs([
            new ObjectID("50000000-0000-4000-8000-000000000009"),
          ]),
        },
      ),
    ]);

    await RunbookRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(startedRunbookIds().sort()).toEqual(
      ids(RUNBOOK_FAILOVER, RUNBOOK_SNAPSHOT).sort(),
    );
    for (const call of startRunbook.mock.calls) {
      expect(call[0].projectId).toBe(PROJECT_ID);
      expect(call[0].linkage).toEqual({ incidentId: INCIDENT_ID });
    }
  });

  it("does not evaluate a rule that has no runbook to start", async () => {
    mockRules([
      withCriteria(
        FilterCondition.All,
        [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "api",
          },
        ],
        { runbooks: [] },
      ),
    ]);

    await RunbookRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(findMonitor).not.toHaveBeenCalled();
    expect(startRunbook).not.toHaveBeenCalled();
  });

  it("one rule failing to evaluate does not stop the others", async () => {
    findMonitor.mockRejectedValue(new Error("database unavailable"));
    mockRules([
      rule({ monitorLabels: refs([LABEL_PRODUCTION]) }),
      rule({
        titlePattern: "checkout",
        runbooks: refs([RUNBOOK_SNAPSHOT]),
      }),
    ]);

    await expect(
      RunbookRuleEngineService.applyRulesToIncident(fakeIncident()),
    ).resolves.toBeUndefined();

    expect(startedRunbookIds()).toEqual(ids(RUNBOOK_SNAPSHOT));
  });

  it("never throws out of the create hook when the rules cannot be read", async () => {
    findRules.mockRejectedValue(new Error("database unavailable"));

    await expect(
      RunbookRuleEngineService.applyRulesToIncident(fakeIncident()),
    ).resolves.toBeUndefined();
    expect(startRunbook).not.toHaveBeenCalled();
  });

  it("reads nothing for a record that was not saved", async () => {
    await RunbookRuleEngineService.applyRulesToIncident(
      fakeIncident({ id: undefined, _id: undefined }),
    );
    await RunbookRuleEngineService.applyRulesToAlert(
      fakeAlert({ projectId: undefined }),
    );
    await RunbookRuleEngineService.applyRulesToScheduledMaintenance(
      fakeEvent({ id: undefined, _id: undefined }),
    );

    expect(findRules).not.toHaveBeenCalled();
  });

  it("matches alert rules on the alert and links the runbook to it", async () => {
    mockRules([
      withCriteria(FilterCondition.All, [
        {
          field: "alertSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(SEVERITY_CRITICAL),
        },
        {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(LABEL_PRODUCTION),
        },
      ]),
    ]);

    await RunbookRuleEngineService.applyRulesToAlert(fakeAlert());

    expect(findRules.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
      isEnabled: true,
      triggerEntityType: RunbookRuleTriggerEntity.Alert,
    });
    expect(startedRunbookIds()).toEqual(ids(RUNBOOK_FAILOVER));
    expect(startRunbook.mock.calls[0]![0].linkage).toEqual({
      alertId: ALERT_ID,
    });
  });

  it("matches scheduled maintenance rules on the event and links the runbook to it", async () => {
    mockRules([
      withCriteria(FilterCondition.Any, [
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(LABEL_CUSTOMER),
        },
      ]),
    ]);

    await RunbookRuleEngineService.applyRulesToScheduledMaintenance(
      fakeEvent(),
    );

    expect(findRules.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
      isEnabled: true,
      triggerEntityType: RunbookRuleTriggerEntity.ScheduledMaintenance,
    });
    expect(startedRunbookIds()).toEqual(ids(RUNBOOK_FAILOVER));
    expect(startRunbook.mock.calls[0]![0].linkage).toEqual({
      scheduledMaintenanceId: EVENT_ID,
    });
  });

  it("starts nothing when no rule matches", async () => {
    mockRules([
      withCriteria(FilterCondition.All, [
        {
          field: "monitors",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ids(MONITOR_ELSEWHERE),
        },
      ]),
    ]);

    await RunbookRuleEngineService.applyRulesToScheduledMaintenance(
      fakeEvent(),
    );

    expect(startRunbook).not.toHaveBeenCalled();
  });
});
