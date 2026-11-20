import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import {
  DATA_SECURITY_AI_RULE_CRITERIA_FIELDS,
  DataSecurityAiRuleConditions,
  DataSecurityAiRuleIssue,
  doesDataSecurityAiRuleColumnsMatch,
  doesDataSecurityAiRuleMatch,
  readDataSecurityAiRuleValues,
} from "../../../Utils/DataSecurity/DataSecurityAiRuleMatch";
import { getRuleCriteriaFieldsForModel } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import { describe, expect, test } from "@jest/globals";

/*
 * Which Data Security issues a Data Security AI rule matches (#10364): its
 * check, severity, store and data, and for telemetry the service - each
 * condition skipped when empty, every set one holding - read from its
 * columns, or from the versioned conditions the Dashboard writes.
 */

const LABEL_PROD: string = "aaaaaaaa-0000-4000-8000-000000000001";
const LABEL_PCI: string = "aaaaaaaa-0000-4000-8000-000000000002";
const SERVICE_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";
const SERVICE_LABEL: string = "cccccccc-0000-4000-8000-000000000001";

function issue(
  overrides: Partial<DataSecurityAiRuleIssue> = {},
): DataSecurityAiRuleIssue {
  return {
    checkId: "secrets-in-telemetry",
    checkGroup: "Telemetry",
    severity: "Critical",
    sensitivity: "Restricted",
    kind: "Logs",
    provider: "oneuptime",
    environment: "Production",
    labelIds: [LABEL_PROD],
    dataCategories: ["Secrets and credentials"],
    serviceId: SERVICE_ID,
    serviceName: "checkout-api",
    serviceLabelIds: [SERVICE_LABEL],
    ...overrides,
  };
}

describe("the conditions a Data Security AI rule matches on", () => {
  test("are the trigger's own share, every one the rule criteria registry allows", () => {
    expect(DATA_SECURITY_AI_RULE_CRITERIA_FIELDS).toEqual([
      "dataSecurityChecks",
      "dataSecurityCheckGroups",
      "dataSecuritySeverities",
      "dataStoreSensitivities",
      "dataStoreKinds",
      "dataStoreProviders",
      "dataStoreEnvironments",
      "dataStoreLabels",
      "dataCategories",
      "services",
      "serviceLabels",
      "serviceNamePattern",
    ]);

    for (const field of DATA_SECURITY_AI_RULE_CRITERIA_FIELDS) {
      expect(getRuleCriteriaFieldsForModel("AutoRemediationRule")).toContain(
        field,
      );
    }
  });
});

describe("a rule's columns", () => {
  test("with none set, match every issue", () => {
    expect(doesDataSecurityAiRuleColumnsMatch({}, issue())).toBe(true);
    expect(doesDataSecurityAiRuleMatch({}, issue())).toBe(true);
  });

  test.each([
    ["dataSecurityChecks", ["secrets-in-telemetry"], ["public-read"]],
    ["dataSecurityCheckGroups", ["Telemetry"], ["Exposure"]],
    ["dataSecuritySeverities", ["Critical", "High"], ["Low"]],
    ["dataStoreSensitivities", ["Restricted"], ["Public"]],
    ["dataStoreKinds", ["Logs"], ["Traces"]],
    ["dataStoreProviders", ["oneuptime"], ["aws"]],
    ["dataStoreEnvironments", ["Production"], ["Development"]],
    ["dataCategories", ["Secrets and credentials"], ["Health"]],
  ])(
    "%s: holds for one of its values, and not for others",
    (field: string, holds: Array<string>, doesNotHold: Array<string>) => {
      expect(
        doesDataSecurityAiRuleColumnsMatch({ [field]: holds }, issue()),
      ).toBe(true);
      expect(
        doesDataSecurityAiRuleColumnsMatch({ [field]: doesNotHold }, issue()),
      ).toBe(false);
    },
  );

  test("compare without regard to case", () => {
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { dataSecuritySeverities: ["critical"], dataStoreKinds: ["LOGS"] },
        issue(),
      ),
    ).toBe(true);
  });

  test("must all hold together", () => {
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        {
          dataSecuritySeverities: ["Critical"],
          dataStoreEnvironments: ["Development"],
        },
        issue(),
      ),
    ).toBe(false);
  });

  test("match a store's labels and an issue's categories by any of them", () => {
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { dataStoreLabels: [{ _id: LABEL_PCI }, { _id: LABEL_PROD }] },
        issue(),
      ),
    ).toBe(true);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { dataStoreLabels: [{ _id: LABEL_PCI }] },
        issue(),
      ),
    ).toBe(false);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { dataCategories: ["Financial", "Secrets and credentials"] },
        issue({ dataCategories: ["Financial"] }),
      ),
    ).toBe(true);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { dataCategories: ["Health"] },
        issue({ dataCategories: [] }),
      ),
    ).toBe(false);
  });

  test("match a telemetry store's service by its id, its labels or its name", () => {
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { services: [{ _id: SERVICE_ID }] },
        issue(),
      ),
    ).toBe(true);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { serviceLabels: [{ _id: SERVICE_LABEL }] },
        issue(),
      ),
    ).toBe(true);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { serviceNamePattern: "^checkout" },
        issue(),
      ),
    ).toBe(true);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { serviceNamePattern: "^billing" },
        issue(),
      ),
    ).toBe(false);
  });

  test("never match a store that is no service's telemetry on a service condition", () => {
    const cloudStore: DataSecurityAiRuleIssue = issue({
      kind: "AWS S3 Bucket",
      serviceId: "",
      serviceName: "",
      serviceLabelIds: [],
    });

    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { services: [{ _id: SERVICE_ID }] },
        cloudStore,
      ),
    ).toBe(false);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { serviceLabels: [{ _id: SERVICE_LABEL }] },
        cloudStore,
      ),
    ).toBe(false);
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { serviceNamePattern: ".*" },
        cloudStore,
      ),
    ).toBe(false);
  });

  test("a pattern that is not a valid one matches nothing", () => {
    expect(
      doesDataSecurityAiRuleColumnsMatch(
        { serviceNamePattern: "(unclosed" },
        issue(),
      ),
    ).toBe(false);
  });

  test("an id is read from a text, an id or a record that has one", () => {
    expect(
      readDataSecurityAiRuleValues([
        " Critical ",
        { _id: "ABC" },
        { id: "def" },
        42,
        "",
      ]),
    ).toEqual(["critical", "abc", "def"]);
    expect(readDataSecurityAiRuleValues("Critical")).toEqual([]);
  });
});

describe("a rule's versioned conditions, as the Dashboard writes them", () => {
  function withCriteria(
    filters: Array<{
      field: string;
      operator: RuleCriteriaOperator;
      value: string | Array<string>;
    }>,
    filterCondition: FilterCondition = FilterCondition.All,
  ): DataSecurityAiRuleConditions {
    return {
      criteria: {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition,
        filters,
      },
      // Columns a rule with conditions no longer reads.
      dataSecuritySeverities: ["Low"],
    };
  }

  test("match by has any of, has none of and patterns, instead of the columns", () => {
    expect(
      doesDataSecurityAiRuleMatch(
        withCriteria([
          {
            field: "dataSecuritySeverities",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ["Critical", "High"],
          },
        ]),
        issue(),
      ),
    ).toBe(true);
    expect(
      doesDataSecurityAiRuleMatch(
        withCriteria([
          {
            field: "dataStoreEnvironments",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: ["Production"],
          },
        ]),
        issue(),
      ),
    ).toBe(false);
    expect(
      doesDataSecurityAiRuleMatch(
        withCriteria([
          {
            field: "serviceNamePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "checkout",
          },
        ]),
        issue(),
      ),
    ).toBe(true);
  });

  test("match when any condition holds, where the rule says any", () => {
    expect(
      doesDataSecurityAiRuleMatch(
        withCriteria(
          [
            {
              field: "dataStoreKinds",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: ["Traces"],
            },
            {
              field: "dataCategories",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: ["Secrets and credentials"],
            },
          ],
          FilterCondition.Any,
        ),
        issue(),
      ),
    ).toBe(true);
  });

  test("never match on a field that is no Data Security condition", () => {
    expect(
      doesDataSecurityAiRuleMatch(
        withCriteria([
          {
            field: "incidentSeverities",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: ["sev-1"],
          },
        ]),
        issue(),
      ),
    ).toBe(false);
  });

  test("with an empty list of conditions, match every issue", () => {
    expect(doesDataSecurityAiRuleMatch(withCriteria([]), issue())).toBe(true);
  });
});
