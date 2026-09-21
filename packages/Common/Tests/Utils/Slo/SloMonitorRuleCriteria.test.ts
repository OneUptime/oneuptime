import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import MonitorType from "../../../Types/Monitor/MonitorType";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import {
  SLO_MONITOR_RULE_INVALID_CRITERIA_DESCRIPTION,
  SLO_MONITOR_RULE_MAX_LABELS_NAMED,
  SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION,
  SLO_MONITOR_RULE_OPERATOR_PHRASES,
  SloMonitorRuleCriteriaCarrier,
  describeSloMonitorRuleCriteria,
  getSloMonitorRuleCriteriaKey,
  getSloMonitorRuleLabelIds,
  hasConfiguredCriteria,
} from "../../../Utils/Slo/SloMonitorRuleCriteria";
import { describe, expect, test } from "@jest/globals";

/*
 * The words the SLO feed and the AI toolbox use for "what this monitor rule
 * matches". The contract that matters is that they describe what the ENGINE
 * evaluates: criteria win over the legacy columns they shadow, legacy columns
 * AND together with labels matching any-of, and an empty or invalid rule is
 * described as matching nothing - never as matching everything.
 */

const PRODUCTION_LABEL_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TIER1_LABEL_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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

function labelNames(): Map<string, string> {
  return new Map<string, string>([
    [PRODUCTION_LABEL_ID, "Production"],
    [TIER1_LABEL_ID, "Tier 1"],
  ]);
}

describe("describeSloMonitorRuleCriteria - legacy rules", () => {
  test("describes a label rule as any-of the named labels", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          monitorLabels: [
            { _id: PRODUCTION_LABEL_ID, name: "Production" },
            { _id: TIER1_LABEL_ID, name: "Tier 1" },
          ],
        },
      }),
    ).toBe('Labels has any of "Production", "Tier 1"');
  });

  test("ANDs every configured legacy criterion, in field order", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          monitorLabels: [{ _id: PRODUCTION_LABEL_ID, name: "Production" }],
          monitorNamePattern: "^api-",
          monitorDescriptionPattern: "tier-1",
        },
      }),
    ).toBe(
      'Labels has any of "Production" AND Name matches pattern "^api-" AND Description matches pattern "tier-1"',
    );
  });

  test("reads label ids off ObjectID-carrying rows as well as _id stubs", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          monitorLabels: [{ id: new ObjectID(PRODUCTION_LABEL_ID) }],
        },
        labelNameById: labelNames(),
      }),
    ).toBe('Labels has any of "Production"');
  });

  test("still counts a label it cannot name, rather than shrinking the list", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          monitorLabels: [{ _id: PRODUCTION_LABEL_ID }],
        },
      }),
    ).toBe("Labels has any of an unknown label (dddddddd)");
  });

  test("names a bounded number of labels and counts the rest", () => {
    const ids: Array<string> = Array.from(
      { length: SLO_MONITOR_RULE_MAX_LABELS_NAMED + 3 },
      (_value: unknown, index: number): string => {
        return `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, "0")}`;
      },
    );

    const description: string = describeSloMonitorRuleCriteria({
      rule: {
        monitorLabels: ids.map((id: string, index: number) => {
          return { _id: id, name: `Label ${index}` };
        }),
      },
    });

    expect(description).toContain('"Label 0"');
    expect(description).toContain(
      `"Label ${SLO_MONITOR_RULE_MAX_LABELS_NAMED - 1}"`,
    );
    expect(description).not.toContain(
      `"Label ${SLO_MONITOR_RULE_MAX_LABELS_NAMED}"`,
    );
    expect(description).toMatch(/, 3 more$/);
  });

  test("an empty legacy rule matches nothing, and says so", () => {
    expect(describeSloMonitorRuleCriteria({ rule: {} })).toBe(
      SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION,
    );
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          monitorLabels: [],
          monitorNamePattern: "",
          monitorDescriptionPattern: null,
        },
      }),
    ).toBe(SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION);
    expect(SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION).toContain(
      "matches no monitors",
    );
  });
});

describe("describeSloMonitorRuleCriteria - configurable criteria", () => {
  test("joins All filters with AND and phrases every operator", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          criteria: criteria(FilterCondition.All, [
            {
              field: "monitorNamePattern",
              operator: RuleCriteriaOperator.StartsWith,
              value: "api-",
            },
            {
              field: "monitorLabels",
              operator: RuleCriteriaOperator.HasAllOf,
              value: [PRODUCTION_LABEL_ID, TIER1_LABEL_ID],
            },
          ]),
        },
        labelNameById: labelNames(),
      }),
    ).toBe(
      'Name starts with "api-" AND Labels has all of "Production", "Tier 1"',
    );
  });

  test("joins Any filters with OR", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          criteria: criteria(FilterCondition.Any, [
            {
              field: "monitorDescriptionPattern",
              operator: RuleCriteriaOperator.Contains,
              value: "checkout",
            },
            {
              field: "monitorLabels",
              operator: RuleCriteriaOperator.HasNoneOf,
              value: [TIER1_LABEL_ID],
            },
          ]),
        },
        labelNameById: labelNames(),
      }),
    ).toBe('Description contains "checkout" OR Labels has none of "Tier 1"');
  });

  test("ignores the legacy safety shadow the criteria save left behind", () => {
    const rule: SloMonitorRuleCriteriaCarrier = {
      criteria: criteria(FilterCondition.All, [
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.EndsWith,
          value: "-prod",
        },
      ]),
      monitorNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
      monitorLabels: [{ _id: PRODUCTION_LABEL_ID, name: "Production" }],
    };

    const description: string = describeSloMonitorRuleCriteria({ rule });

    expect(description).toBe('Name ends with "-prod"');
    expect(description).not.toContain("(?!)");
    expect(description).not.toContain("Production");
  });

  test("invalid criteria are described as matching nothing - the engine fails closed", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          criteria: {
            schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
            filterCondition: FilterCondition.All,
            filters: [
              {
                field: "monitorLabels",
                operator: RuleCriteriaOperator.HasAnyOf,
                // A relation operator needs an array of ids.
                value: "not-an-array",
              },
            ],
          },
        },
      }),
    ).toBe(SLO_MONITOR_RULE_INVALID_CRITERIA_DESCRIPTION);
  });

  test("criteria with no filters match nothing", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: { criteria: criteria(FilterCondition.All, []) },
      }),
    ).toBe(SLO_MONITOR_RULE_NO_CRITERIA_DESCRIPTION);
  });

  test("every operator has a phrase", () => {
    for (const operator of Object.values(RuleCriteriaOperator)) {
      expect(SLO_MONITOR_RULE_OPERATOR_PHRASES[operator]).toBeTruthy();
    }
  });
});

describe("getSloMonitorRuleLabelIds", () => {
  test("reads a legacy rule's labels, de-duplicated in order", () => {
    expect(
      getSloMonitorRuleLabelIds({
        monitorLabels: [
          { _id: TIER1_LABEL_ID },
          { _id: PRODUCTION_LABEL_ID },
          { id: new ObjectID(TIER1_LABEL_ID) },
        ],
      }),
    ).toEqual([TIER1_LABEL_ID, PRODUCTION_LABEL_ID]);
  });

  test("reads only the criteria's label filters once criteria are set", () => {
    expect(
      getSloMonitorRuleLabelIds({
        criteria: criteria(FilterCondition.Any, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [PRODUCTION_LABEL_ID],
          },
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.Contains,
            value: TIER1_LABEL_ID,
          },
        ]),
        monitorLabels: [{ _id: TIER1_LABEL_ID }],
      }),
    ).toEqual([PRODUCTION_LABEL_ID]);
  });

  test("returns nothing for invalid criteria", () => {
    expect(
      getSloMonitorRuleLabelIds({
        criteria: { nonsense: true } as unknown as RuleCriteria,
      }),
    ).toEqual([]);
  });
});

describe("hasConfiguredCriteria", () => {
  test("is true only when criteria is present", () => {
    expect(hasConfiguredCriteria({})).toBe(false);
    expect(hasConfiguredCriteria({ criteria: null })).toBe(false);
    expect(
      hasConfiguredCriteria({ criteria: criteria(FilterCondition.All, []) }),
    ).toBe(true);
  });
});

describe("getSloMonitorRuleCriteriaKey", () => {
  test("is equal for a resubmitted rule whose labels come back in a different order and case", () => {
    expect(
      getSloMonitorRuleCriteriaKey({
        monitorLabels: [{ _id: PRODUCTION_LABEL_ID }, { _id: TIER1_LABEL_ID }],
        monitorNamePattern: "^api-",
      }),
    ).toBe(
      getSloMonitorRuleCriteriaKey({
        monitorLabels: [
          { _id: TIER1_LABEL_ID.toUpperCase() },
          { _id: PRODUCTION_LABEL_ID },
        ],
        monitorNamePattern: "^api-",
      }),
    );
  });

  test("is equal for the same criteria whatever order jsonb hands the keys back in", () => {
    const written: RuleCriteria = criteria(FilterCondition.All, [
      {
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.StartsWith,
        value: "api",
      },
    ]);

    const readBack: RuleCriteria = JSON.parse(
      '{"filters":[{"value":"api","operator":"StartsWith","field":"monitorNamePattern"}],"schemaVersion":1,"filterCondition":"' +
        FilterCondition.All +
        '"}',
    ) as RuleCriteria;

    expect(getSloMonitorRuleCriteriaKey({ criteria: written })).toBe(
      getSloMonitorRuleCriteriaKey({ criteria: readBack }),
    );
  });

  test("changes when what the rule matches changes", () => {
    const base: SloMonitorRuleCriteriaCarrier = {
      monitorLabels: [{ _id: PRODUCTION_LABEL_ID }],
    };

    expect(getSloMonitorRuleCriteriaKey(base)).not.toBe(
      getSloMonitorRuleCriteriaKey({
        ...base,
        monitorNamePattern: "^api-",
      }),
    );
    expect(getSloMonitorRuleCriteriaKey(base)).not.toBe(
      getSloMonitorRuleCriteriaKey({
        monitorLabels: [{ _id: TIER1_LABEL_ID }],
      }),
    );
    expect(getSloMonitorRuleCriteriaKey(base)).not.toBe(
      getSloMonitorRuleCriteriaKey({
        ...base,
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [PRODUCTION_LABEL_ID],
          },
        ]),
      }),
    );
  });

  test("ignores the legacy shadow once criteria are set", () => {
    const rule: SloMonitorRuleCriteriaCarrier = {
      criteria: criteria(FilterCondition.Any, [
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "api",
        },
      ]),
    };

    expect(getSloMonitorRuleCriteriaKey(rule)).toBe(
      getSloMonitorRuleCriteriaKey({
        ...rule,
        monitorNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
        monitorLabels: [{ _id: PRODUCTION_LABEL_ID }],
      }),
    );
  });
});

describe("SLO monitor type criteria descriptions", () => {
  test.each(["", "Invalid monitor type"])(
    "describes an invalid legacy monitor type as matching no monitors: %p",
    (monitorType: string) => {
      expect(
        describeSloMonitorRuleCriteria({
          rule: {
            monitorType: monitorType as MonitorType,
            monitorNamePattern: ".*",
          },
        }),
      ).toBe(SLO_MONITOR_RULE_INVALID_CRITERIA_DESCRIPTION);
    },
  );

  test.each([
    { operator: RuleCriteriaOperator.Equals, value: "Invalid monitor type" },
    { operator: RuleCriteriaOperator.NotEquals, value: "" },
    { operator: RuleCriteriaOperator.Contains, value: MonitorType.API },
    { operator: RuleCriteriaOperator.HasAnyOf, value: [MonitorType.API] },
  ])(
    "describes invalid type criteria as matching no monitors: %p",
    (filter: Pick<RuleCriteriaFilter, "operator" | "value">) => {
      expect(
        describeSloMonitorRuleCriteria({
          rule: {
            criteria: criteria(FilterCondition.Any, [
              { field: "monitorType", ...filter },
            ]),
          },
        }),
      ).toBe(SLO_MONITOR_RULE_INVALID_CRITERIA_DESCRIPTION);
    },
  );

  test.each([RuleCriteriaOperator.Equals, RuleCriteriaOperator.NotEquals])(
    "describes configured monitor type %s without looking up labels",
    (operator: RuleCriteriaOperator) => {
      const rule: SloMonitorRuleCriteriaCarrier = {
        criteria: criteria(FilterCondition.All, [
          { field: "monitorType", operator, value: MonitorType.API },
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: "^staging-",
          },
        ]),
        monitorType: MonitorType.Website,
      };
      expect(describeSloMonitorRuleCriteria({ rule })).toBe(
        `Type ${SLO_MONITOR_RULE_OPERATOR_PHRASES[operator]} "API" AND Name does not match pattern "^staging-"`,
      );
      expect(getSloMonitorRuleLabelIds(rule)).toEqual([]);
    },
  );

  test("describes a legacy monitor type combined with other attributes", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: {
          monitorType: MonitorType.Website,
          monitorLabels: [{ _id: PRODUCTION_LABEL_ID, name: "Production" }],
          monitorNamePattern: "^checkout-",
        },
      }),
    ).toBe(
      'Labels has any of "Production" AND Type is "Website" AND Name matches pattern "^checkout-"',
    );
  });

  test("describes a type-only legacy rule as a configured condition", () => {
    expect(
      describeSloMonitorRuleCriteria({
        rule: { monitorType: MonitorType.API },
      }),
    ).toBe('Type is "API"');
  });

  test("detects changes to legacy monitor types for audit and feed updates", () => {
    const apiKey: string = getSloMonitorRuleCriteriaKey({
      monitorType: MonitorType.API,
    });
    expect(apiKey).not.toBe(
      getSloMonitorRuleCriteriaKey({ monitorType: MonitorType.Website }),
    );
    expect(apiKey).not.toBe(getSloMonitorRuleCriteriaKey({}));
    expect(getSloMonitorRuleCriteriaKey({ monitorType: null })).toBe(
      getSloMonitorRuleCriteriaKey({}),
    );
  });

  test("ignores legacy monitor type shadows for configured rule identity", () => {
    const configured: RuleCriteria = criteria(FilterCondition.All, [
      {
        field: "monitorType",
        operator: RuleCriteriaOperator.Equals,
        value: MonitorType.API,
      },
    ]);
    expect(
      getSloMonitorRuleCriteriaKey({
        criteria: configured,
        monitorType: MonitorType.Website,
      }),
    ).toBe(getSloMonitorRuleCriteriaKey({ criteria: configured }));
  });
});
