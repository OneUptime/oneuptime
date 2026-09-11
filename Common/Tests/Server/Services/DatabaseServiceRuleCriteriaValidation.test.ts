import AlertReminderRule from "../../../Models/DatabaseModels/AlertReminderRule";
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@faker-js/faker", () => {
  return {
    faker: {
      company: {
        name: (): string => {
          return "Test Company";
        },
      },
      internet: {
        email: (): string => {
          return "test@example.com";
        },
      },
      person: {
        fullName: (): string => {
          return "Test User";
        },
      },
      string: {
        alphanumeric: (): string => {
          return "test-value";
        },
      },
    },
  };
});

type SanitizeFunction = (
  data: unknown,
  props?: DatabaseCommonInteractionProps,
  isUpdate?: boolean,
) => Promise<JSONObject>;

type RawBooleanOperator = {
  _getSql: (alias: string) => string;
  _objectLiteralParameters: Record<string, unknown>;
};

const service: DatabaseService<StatusPageMonitorRule> =
  new DatabaseService<StatusPageMonitorRule>(StatusPageMonitorRule);
const alertReminderService: DatabaseService<AlertReminderRule> =
  new DatabaseService<AlertReminderRule>(AlertReminderRule);

const sanitize: SanitizeFunction = async (
  data: unknown,
  props: DatabaseCommonInteractionProps = { isRoot: true },
  isUpdate: boolean = true,
): Promise<JSONObject> => {
  return (await (
    service as unknown as { sanitizeCreateOrUpdate: SanitizeFunction }
  ).sanitizeCreateOrUpdate(data, props, isUpdate)) as JSONObject;
};

const sanitizeAlertReminder: SanitizeFunction = async (
  data: unknown,
  props: DatabaseCommonInteractionProps = { isRoot: true },
  isUpdate: boolean = true,
): Promise<JSONObject> => {
  return (await (
    alertReminderService as unknown as {
      sanitizeCreateOrUpdate: SanitizeFunction;
    }
  ).sanitizeCreateOrUpdate(data, props, isUpdate)) as JSONObject;
};

function criteriaFor(filter: RuleCriteriaFilter): JSONObject {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [filter as unknown as JSONObject],
  };
}

describe("DatabaseService rule criteria validation", () => {
  it("accepts valid configured criteria on the shared write path", async () => {
    const criteria: JSONObject = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.Any,
      filters: [
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "api",
        },
      ],
    };

    await expect(sanitize({ criteria: criteria })).resolves.toMatchObject({
      criteria: criteria,
    });
  });

  it.each([true, false])(
    "writes a fail-closed legacy compatibility shadow on update=%p",
    async (isUpdate: boolean) => {
      const criteria: JSONObject = criteriaFor({
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "api",
      });

      const result: JSONObject = await sanitize(
        {
          criteria: criteria,
          monitorLabels: ["11111111-1111-4111-8111-111111111111"],
          monitorNamePattern: "legacy-api-*",
          monitorDescriptionPattern: "legacy production",
        },
        { isRoot: true },
        isUpdate,
      );

      expect(result).toMatchObject({
        criteria: criteria,
        monitorNamePattern: "(?!)",
        monitorDescriptionPattern: null,
      });
      expect(result["monitorLabels"]).toBeUndefined();
    },
  );

  it.each([true, false])(
    "keeps relation-only reminder criteria invisible to old workers when enabled=%p",
    async (isEnabled: boolean) => {
      const labelId: string = "11111111-1111-4111-8111-111111111111";
      const severityId: string = "22222222-2222-4222-8222-222222222222";
      const criteria: JSONObject = {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "labels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [labelId],
          },
        ],
      };

      const result: JSONObject = await sanitizeAlertReminder(
        {
          criteria: criteria,
          isEnabled: isEnabled,
          labels: [labelId],
          alertSeverities: [severityId],
        },
        { isRoot: true },
        true,
      );

      expect(result).toMatchObject({
        criteria: criteria,
      });
      expect(result["labels"]).toBeUndefined();
      expect(result["alertSeverities"]).toBeUndefined();
      expect(result["isEnabled"]).toBe(isEnabled ? null : false);
      expect(result["criteriaIsEnabled"]).toBeUndefined();
    },
  );

  it("recovers the logical reminder state from a fail-closed browser payload", async () => {
    const criteria: JSONObject = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [],
      isEnabled: true,
    };

    const result: JSONObject = await sanitizeAlertReminder(
      {
        criteria: criteria,
        isEnabled: false,
      },
      { isRoot: true },
      false,
    );

    expect(result["isEnabled"]).toBeNull();
    expect(result["criteria"]).toMatchObject({ isEnabled: true });
  });

  it("rejects relation-only compatibility state on pattern-backed rules", async () => {
    await expect(
      sanitize({
        criteria: {
          ...criteriaFor({
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "api",
          }),
          isEnabled: true,
        },
      }),
    ).rejects.toThrow("isEnabled is only supported for relation-only rules");
  });

  it("defaults a criteria-only reminder create to logically enabled but legacy disabled", async () => {
    const labelId: string = "11111111-1111-4111-8111-111111111111";
    const criteria: JSONObject = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [labelId],
        },
      ],
    };

    const result: JSONObject = await sanitizeAlertReminder(
      {
        criteria: criteria,
      },
      { isRoot: true },
      false,
    );

    expect(result).toMatchObject({
      criteria: criteria,
      isEnabled: null,
    });
    expect(result["labels"]).toBeUndefined();
    expect(result["alertSeverities"]).toBeUndefined();
  });

  it("requires an explicit logical enabled state for relation-only criteria updates", async () => {
    const criteria: JSONObject = criteriaFor({
      field: "labels",
      operator: RuleCriteriaOperator.HasAnyOf,
      value: ["11111111-1111-4111-8111-111111111111"],
    });

    await expect(
      sanitizeAlertReminder({ criteria: criteria }, { isRoot: true }, true),
    ).rejects.toThrow(
      "isEnabled must be supplied when updating criteria for this rule.",
    );
  });

  it("rejects clearing configured relation-only criteria into a legacy match-all rule", async () => {
    await expect(
      sanitizeAlertReminder(
        { criteria: null, isEnabled: true },
        { isRoot: true },
        true,
      ),
    ).rejects.toThrow(
      "Configured criteria cannot be cleared from this rule. Save an empty criteria set to match every resource.",
    );
  });

  it("leaves legacy enabled-only reminder updates on the legacy column", async () => {
    await expect(
      sanitizeAlertReminder({ isEnabled: true }, { isRoot: true }, true),
    ).resolves.toMatchObject({
      isEnabled: true,
    });
  });

  it.each([true, false])(
    "queries the effective relation-only enabled state when enabled=%p",
    (isEnabled: boolean) => {
      const effectiveQuery: { isEnabled?: unknown } = (
        alertReminderService as unknown as {
          getRuleCriteriaEffectiveEnabledQuery: (query: {
            isEnabled: boolean;
          }) => { isEnabled?: unknown };
        }
      ).getRuleCriteriaEffectiveEnabledQuery({ isEnabled: isEnabled });
      const operator: RawBooleanOperator =
        effectiveQuery.isEnabled as RawBooleanOperator;
      const sql: string = operator._getSql('"AlertReminderRule"."isEnabled"');

      expect(sql).toContain(
        'CASE WHEN "AlertReminderRule"."criteria" IS NULL THEN COALESCE("AlertReminderRule"."isEnabled", false) ELSE "AlertReminderRule"."isEnabled" IS NULL END',
      );
      expect(Object.values(operator._objectLiteralParameters)).toContain(
        isEnabled,
      );
    },
  );

  it.each([
    [null, true],
    [false, false],
  ])(
    "presents criteria-backed physical enabled state %p as logical %p",
    (physicalEnabled: boolean | null, logicalEnabled: boolean) => {
      const rule: AlertReminderRule = new AlertReminderRule();
      rule.criteria = {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [],
      } as RuleCriteria;
      rule.isEnabled = physicalEnabled;

      (
        alertReminderService as unknown as {
          applyRuleCriteriaEffectiveEnabledToItem: (
            item: AlertReminderRule,
          ) => void;
        }
      ).applyRuleCriteriaEffectiveEnabledToItem(rule);

      expect(rule.isEnabled).toBe(logicalEnabled);
    },
  );

  it("does not reinterpret the enabled state of a legacy reminder rule", () => {
    const rule: AlertReminderRule = new AlertReminderRule();
    rule.criteria = null;
    rule.isEnabled = true;

    (
      alertReminderService as unknown as {
        applyRuleCriteriaEffectiveEnabledToItem: (
          item: AlertReminderRule,
        ) => void;
      }
    ).applyRuleCriteriaEffectiveEnabledToItem(rule);

    expect(rule.isEnabled).toBe(true);
  });

  it("does not fabricate isEnabled for a criteria-only projection", () => {
    const rule: AlertReminderRule = new AlertReminderRule();
    rule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [],
    };
    delete (rule as unknown as Record<string, unknown>)["isEnabled"];

    (
      alertReminderService as unknown as {
        applyRuleCriteriaEffectiveEnabledToItem: (
          item: AlertReminderRule,
          mapEffectiveEnabled: boolean,
        ) => void;
      }
    ).applyRuleCriteriaEffectiveEnabledToItem(rule, false);

    expect(rule.isEnabled).toBeUndefined();
  });

  it("uses criteria internally for an isEnabled-only projection without leaking it", () => {
    const select: Record<string, unknown> = { isEnabled: true };
    const removeCriteria: boolean = (
      alertReminderService as unknown as {
        addRuleCriteriaEffectiveEnabledToSelect: (
          selectValue: Record<string, unknown>,
        ) => boolean;
      }
    ).addRuleCriteriaEffectiveEnabledToSelect(select);
    const rule: AlertReminderRule = new AlertReminderRule();
    rule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [],
    };
    rule.isEnabled = null;

    expect(select["criteria"]).toBe(true);
    expect(removeCriteria).toBe(true);

    (
      alertReminderService as unknown as {
        applyRuleCriteriaEffectiveEnabledToItem: (
          item: AlertReminderRule,
          mapEffectiveEnabled: boolean,
          removeInternallySelectedCriteria: boolean,
        ) => void;
      }
    ).applyRuleCriteriaEffectiveEnabledToItem(rule, true, removeCriteria);

    expect(rule.isEnabled).toBe(true);
    expect(rule.criteria).toBeUndefined();
  });

  it.each([
    [
      { schemaVersion: 99, filterCondition: FilterCondition.All, filters: [] },
      "schemaVersion",
    ],
    [
      {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: "Neither",
        filters: [],
      },
      "filterCondition",
    ],
    [
      {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "   ",
          },
        ],
      },
      "non-blank",
    ],
    [
      {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [],
          },
        ],
      },
      "non-empty array",
    ],
  ])(
    "rejects malformed criteria before persistence %#",
    async (criteria: JSONObject, message: string) => {
      await expect(sanitize({ criteria: criteria })).rejects.toThrow(message);
    },
  );

  it.each([
    [
      {
        ...criteriaFor({
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "api",
        }),
        metadata: { payload: "x".repeat(100_000) },
      },
      "may only contain schemaVersion, filterCondition, filters, and optional isEnabled",
    ],
    [
      criteriaFor({
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "api",
        metadata: { nested: true },
      } as unknown as RuleCriteriaFilter),
      "may only contain field, operator, and value",
    ],
  ])(
    "rejects open-ended criteria objects before persistence %#",
    async (criteria: JSONObject, message: string) => {
      await expect(sanitize({ criteria: criteria })).rejects.toThrow(message);
    },
  );

  it.each([undefined, null])(
    "preserves legacy writes when criteria is %p",
    async (criteria: undefined | null) => {
      await expect(
        sanitize({ criteria: criteria, monitorNamePattern: "api" }),
      ).resolves.toMatchObject({
        criteria: criteria,
        monitorNamePattern: "api",
      });
    },
  );

  it.each(["notARealField", "statusPageGroup"])(
    "rejects unknown or action field %s",
    async (field: string) => {
      await expect(
        sanitize({
          criteria: criteriaFor({
            field,
            operator: RuleCriteriaOperator.Contains,
            value: "api",
          }),
        }),
      ).rejects.toThrow(
        `Rule criteria field "${field}" is not supported for StatusPageMonitorRule.`,
      );
    },
  );

  it("rejects relation operators for scalar fields", async () => {
    await expect(
      sanitize({
        criteria: criteriaFor({
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ["api"],
        }),
      }),
    ).rejects.toThrow(
      'Rule criteria field "monitorNamePattern" does not support relation operators.',
    );
  });

  it("rejects scalar operators for entity-array fields", async () => {
    await expect(
      sanitize({
        criteria: criteriaFor({
          field: "monitorLabels",
          operator: RuleCriteriaOperator.Contains,
          value: "production",
        }),
      }),
    ).rejects.toThrow(
      'Rule criteria field "monitorLabels" requires a relation operator.',
    );
  });

  it("accepts relation operators for entity-array fields", async () => {
    const criteria: JSONObject = criteriaFor({
      field: "monitorLabels",
      operator: RuleCriteriaOperator.HasAllOf,
      value: ["11111111-1111-4111-8111-111111111111"],
    });

    await expect(sanitize({ criteria })).resolves.toMatchObject({ criteria });
  });

  it("rejects invalid relation IDs at the persistence boundary", async () => {
    await expect(
      sanitize({
        criteria: criteriaFor({
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: ["Production"],
        }),
      }),
    ).rejects.toThrow(
      'Rule criteria field "monitorLabels" requires valid resource IDs.',
    );
  });
});
