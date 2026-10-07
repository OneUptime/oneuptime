import IncidentAlertRuleMatcher, {
  IncidentAlertMatchRule,
} from "../../../../Server/Utils/Rules/IncidentAlertRuleMatcher";
import MonitorService from "../../../../Server/Services/MonitorService";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Whether an incident or an alert matches a rule that decides what OneUptime
 * AI does with it: an Auto Remediation Rule (which ones are fixed, and how)
 * or an Investigation Rule (which ones are investigated). Both read a
 * condition the same way, here:
 *
 *   - a rule with no condition matches everything;
 *   - every legacy column is skip-if-empty, ANDed with the others;
 *   - the versioned conditions (criteria) win over the legacy columns,
 *     which the dashboard fills with a never-matching pattern for old API
 *     servers;
 *   - a pattern is a case-insensitive regex, and an invalid one never
 *     matches (and is logged with the kind of rule it belongs to).
 */

const MONITOR_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
);
const MONITOR_B: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
);
const SEVERITY_HIGH: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
);
const SEVERITY_LOW: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
);
const LABEL_PROD: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
);
const LABEL_STAGING: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
);

function ref<T extends { _id?: string | undefined }>(
  type: { new (): T },
  id: ObjectID,
): T {
  const model: T = new type();
  model._id = id.toString();
  return model;
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return Object.assign(new Incident(), {
    title: "Checkout database is down",
    description: "Connection refused on port 5432",
    incidentSeverityId: SEVERITY_HIGH,
    monitors: [ref(Monitor, MONITOR_A)],
    labels: [ref(Label, LABEL_PROD)],
    ...overrides,
  });
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return Object.assign(new Alert(), {
    title: "Checkout database is down",
    description: "Connection refused on port 5432",
    alertSeverityId: SEVERITY_HIGH,
    monitorId: MONITOR_A,
    labels: [ref(Label, LABEL_PROD)],
    ...overrides,
  });
}

function criteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

async function incidentMatches(rule: IncidentAlertMatchRule): Promise<boolean> {
  return await IncidentAlertRuleMatcher.doesIncidentMatch(
    incident(),
    rule,
    "investigation rule",
  );
}

async function alertMatches(rule: IncidentAlertMatchRule): Promise<boolean> {
  return await IncidentAlertRuleMatcher.doesAlertMatch(
    alert(),
    rule,
    "investigation rule",
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a rule with no condition", () => {
  test("matches every incident and every alert", async () => {
    expect(await incidentMatches({})).toBe(true);
    expect(await alertMatches({})).toBe(true);
    expect(
      await IncidentAlertRuleMatcher.doesIncidentMatch(
        new Incident(),
        { monitors: [], labels: [], titlePattern: "" },
        "investigation rule",
      ),
    ).toBe(true);
  });
});

describe("the legacy columns", () => {
  test.each([
    ["one of its monitors", { monitors: [ref(Monitor, MONITOR_A)] }, true],
    ["another monitor", { monitors: [ref(Monitor, MONITOR_B)] }, false],
    [
      "its severity",
      { incidentSeverities: [ref(IncidentSeverity, SEVERITY_HIGH)] },
      true,
    ],
    [
      "another severity",
      { incidentSeverities: [ref(IncidentSeverity, SEVERITY_LOW)] },
      false,
    ],
    ["one of its labels", { labels: [ref(Label, LABEL_PROD)] }, true],
    ["another label", { labels: [ref(Label, LABEL_STAGING)] }, false],
    ["its title, in any case", { titlePattern: "CHECKOUT" }, true],
    ["another title", { titlePattern: "^payments" }, false],
    ["its description", { descriptionPattern: "refused|timeout" }, true],
    ["another description", { descriptionPattern: "disk full" }, false],
  ])(
    "an incident rule naming %s matches: %s",
    async (_name: string, rule: IncidentAlertMatchRule, expected: boolean) => {
      expect(await incidentMatches(rule)).toBe(expected);
    },
  );

  test.each([
    ["its monitor", { monitors: [ref(Monitor, MONITOR_A)] }, true],
    ["another monitor", { monitors: [ref(Monitor, MONITOR_B)] }, false],
    [
      "its severity",
      { alertSeverities: [ref(AlertSeverity, SEVERITY_HIGH)] },
      true,
    ],
    [
      "another severity",
      { alertSeverities: [ref(AlertSeverity, SEVERITY_LOW)] },
      false,
    ],
    ["one of its labels", { labels: [ref(Label, LABEL_PROD)] }, true],
    ["its title", { titlePattern: "database" }, true],
  ])(
    "an alert rule naming %s matches: %s",
    async (_name: string, rule: IncidentAlertMatchRule, expected: boolean) => {
      expect(await alertMatches(rule)).toBe(expected);
    },
  );

  test("every column must hold (AND), each skipped while empty", async () => {
    expect(
      await incidentMatches({
        monitors: [ref(Monitor, MONITOR_A)],
        labels: [ref(Label, LABEL_PROD)],
        titlePattern: "checkout",
      }),
    ).toBe(true);
    expect(
      await incidentMatches({
        monitors: [ref(Monitor, MONITOR_A)],
        labels: [ref(Label, LABEL_STAGING)],
      }),
    ).toBe(false);
  });

  test("an incident with no monitor, label or severity matches no rule that asks for one", async () => {
    const bare: Incident = Object.assign(new Incident(), { title: "x" });

    for (const rule of [
      { monitors: [ref(Monitor, MONITOR_A)] },
      { labels: [ref(Label, LABEL_PROD)] },
      { incidentSeverities: [ref(IncidentSeverity, SEVERITY_HIGH)] },
      { descriptionPattern: "anything" },
    ] as Array<IncidentAlertMatchRule>) {
      expect(
        await IncidentAlertRuleMatcher.doesIncidentMatch(
          bare,
          rule,
          "investigation rule",
        ),
      ).toBe(false);
    }
  });

  test("an invalid pattern never matches, and is logged with the kind of rule", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    expect(
      await IncidentAlertRuleMatcher.doesIncidentMatch(
        incident(),
        { titlePattern: "([unclosed" },
        "auto-remediation rule",
      ),
    ).toBe(false);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "Invalid regex pattern in auto-remediation rule",
    );
  });

  test("monitor labels: any of the incident's monitors carrying one is enough", async () => {
    jest.spyOn(MonitorService, "findOneById").mockImplementation((async (
      args: unknown,
    ) => {
      const id: string = String((args as { id: ObjectID }).id);

      return Object.assign(new Monitor(), {
        _id: id,
        labels: id === MONITOR_B.toString() ? [ref(Label, LABEL_STAGING)] : [],
      });
    }) as never);

    expect(
      await IncidentAlertRuleMatcher.doesIncidentMatch(
        incident({
          monitors: [ref(Monitor, MONITOR_A), ref(Monitor, MONITOR_B)],
        }),
        { monitorLabels: [ref(Label, LABEL_STAGING)] },
        "investigation rule",
      ),
    ).toBe(true);
    expect(
      await IncidentAlertRuleMatcher.doesIncidentMatch(
        incident({ monitors: [ref(Monitor, MONITOR_A)] }),
        { monitorLabels: [ref(Label, LABEL_STAGING)] },
        "investigation rule",
      ),
    ).toBe(false);
  });
});

describe("the versioned conditions", () => {
  test("win over the never-matching pattern the dashboard leaves for old servers", async () => {
    const rule: IncidentAlertMatchRule = {
      titlePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
      criteria: criteria([
        {
          field: "incidentSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [SEVERITY_HIGH.toString()],
        },
      ]),
    };

    expect(await incidentMatches(rule)).toBe(true);
  });

  test("match when every condition holds, and not when one does not", async () => {
    const severity: RuleCriteriaFilter = {
      field: "incidentSeverities",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: [SEVERITY_HIGH.toString()],
    };
    const otherMonitor: RuleCriteriaFilter = {
      field: "monitors",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: [MONITOR_B.toString()],
    };

    expect(
      await incidentMatches({ criteria: criteria([severity, otherMonitor]) }),
    ).toBe(false);
    expect(
      await incidentMatches({
        criteria: criteria([severity, otherMonitor], FilterCondition.Any),
      }),
    ).toBe(true);
  });

  test("a negated condition excludes what it names", async () => {
    expect(
      await alertMatches({
        criteria: criteria([
          {
            field: "labels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [LABEL_PROD.toString()],
          },
        ]),
      }),
    ).toBe(false);
    expect(
      await alertMatches({
        criteria: criteria([
          {
            field: "labels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [LABEL_STAGING.toString()],
          },
        ]),
      }),
    ).toBe(true);
  });

  test("an alert's severity condition reads its alert severity", async () => {
    expect(
      await alertMatches({
        criteria: criteria([
          {
            field: "alertSeverities",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [SEVERITY_LOW.toString()],
          },
        ]),
      }),
    ).toBe(false);
  });
});
