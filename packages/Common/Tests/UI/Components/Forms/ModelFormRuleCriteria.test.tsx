import { describe, expect, jest, test } from "@jest/globals";
import { ReactElement } from "react";
import RuleBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import AlertReminderRule from "../../../../Models/DatabaseModels/AlertReminderRule";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import type Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  addRuleCriteriaToSelect,
  applyRuleCriteriaLegacySafetyShadow,
  replaceLegacyRuleCriteriaFields,
  RULE_CRITERIA_FIELD_NAME,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaModelForm";

function fieldName(field: {
  field?: Record<string, unknown> | undefined;
}): string {
  return Object.keys(field.field || {})[0] || "";
}

function ruleFields(): Fields<any> {
  return [
    {
      field: { name: true },
      title: "Name",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.Text,
    },
    {
      field: { monitorLabels: true },
      title: "Monitor Labels",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
    },
    {
      field: { monitorNamePattern: true },
      title: "Monitor Name Pattern",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.Text,
    },
    {
      field: { labelsToAdd: true },
      title: "Labels to Add",
      stepId: "actions",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
    },
  ];
}

function reminderRuleFields(): Fields<any> {
  return [
    {
      field: { isEnabled: true },
      title: "Is Enabled",
      stepId: "basic-info",
      fieldType: FormFieldSchemaType.Toggle,
    },
    {
      field: { labels: true },
      title: "Labels",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
    },
    {
      field: { alertSeverities: true },
      title: "Alert Severities",
      stepId: "match-criteria",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
    },
  ];
}

describe("ModelForm rule criteria integration", () => {
  test("keeps legacy match fields in the API select and adds criteria", () => {
    const select: Record<string, unknown> = {
      name: true,
      monitorLabels: true,
      monitorNamePattern: true,
      labelsToAdd: true,
    };

    const result: Record<string, unknown> = addRuleCriteriaToSelect({
      model: new RuleBaseModel(),
      fields: ruleFields(),
      select: select,
    });

    expect(result).toEqual({
      ...select,
      criteria: true,
    });
  });

  test("sends a fail-closed legacy shadow with criteria for old API pods", () => {
    const values: Record<string, unknown> = {
      criteria: {
        schemaVersion: 1,
        filterCondition: "All",
        filters: [
          {
            field: "monitorNamePattern",
            operator: "Contains",
            value: "api",
          },
        ],
      },
      monitorLabels: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
      monitorNamePattern: "api-*",
    };

    applyRuleCriteriaLegacySafetyShadow({
      model: new StatusPageMonitorRule(),
      fields: ruleFields(),
      values: values,
    });

    expect(values["monitorLabels"]).toEqual([]);
    expect(values["monitorNamePattern"]).toBe("(?!)");
    expect(values["criteria"]).toMatchObject({
      filterCondition: "All",
    });
  });

  test.each([true, false])(
    "carries logical reminder enabled=%p inside criteria while old APIs see disabled",
    (isEnabled: boolean) => {
      const values: Record<string, unknown> = {
        criteria: {
          schemaVersion: 1,
          filterCondition: "All",
          filters: [
            {
              field: "labels",
              operator: "HasAnyOf",
              value: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
            },
          ],
        },
        isEnabled: isEnabled,
        labels: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
        alertSeverities: ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"],
      };

      applyRuleCriteriaLegacySafetyShadow({
        model: new AlertReminderRule(),
        fields: reminderRuleFields(),
        values: values,
      });

      expect(values["labels"]).toEqual([]);
      expect(values["alertSeverities"]).toEqual([]);
      expect(values["isEnabled"]).toBe(false);
      expect(values["criteria"]).toMatchObject({ isEnabled: isEnabled });
    },
  );

  test("replaces only visible match fields with one full-width builder", () => {
    const result: Fields<any> = replaceLegacyRuleCriteriaFields(
      new RuleBaseModel(),
      ruleFields(),
    );

    expect(result.map(fieldName)).toEqual([
      "name",
      RULE_CRITERIA_FIELD_NAME,
      "labelsToAdd",
    ]);

    const criteriaField: Field<any> | undefined = result.find(
      (field: Field<any>): boolean => {
        return fieldName(field) === RULE_CRITERIA_FIELD_NAME;
      },
    );

    expect(criteriaField?.stepId).toBe("match-criteria");
    expect(criteriaField?.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(criteriaField?.spanFullRow).toBe(true);
    expect(criteriaField?.getCustomElement).toBeDefined();
    expect(criteriaField?.customValidation).toBeDefined();
  });

  test("validates builder values before submitting the model form", () => {
    const criteriaField: Field<any> | undefined =
      replaceLegacyRuleCriteriaFields(new RuleBaseModel(), ruleFields()).find(
        (field: Field<any>): boolean => {
          return fieldName(field) === RULE_CRITERIA_FIELD_NAME;
        },
      );

    expect(
      criteriaField?.customValidation?.({
        criteria: {
          schemaVersion: 1,
          filterCondition: "All",
          filters: [
            {
              field: "monitorNamePattern",
              operator: "Contains",
              value: "",
            },
          ],
        },
      }),
    ).toContain("non-blank");
  });

  test.each([undefined, null])(
    "allows a legacy rule with absent criteria=%p to be opened and edited",
    (criteria: undefined | null) => {
      const criteriaField: Field<any> | undefined =
        replaceLegacyRuleCriteriaFields(new RuleBaseModel(), ruleFields()).find(
          (field: Field<any>): boolean => {
            return fieldName(field) === RULE_CRITERIA_FIELD_NAME;
          },
        );

      expect(
        criteriaField?.customValidation?.({
          criteria: criteria,
          monitorNamePattern: "legacy-*",
        }),
      ).toBeNull();
    },
  );

  test("passes hidden legacy current values into the builder for conversion", () => {
    const result: Fields<any> = replaceLegacyRuleCriteriaFields(
      new RuleBaseModel(),
      ruleFields(),
    );
    const criteriaField: Field<any> | undefined = result.find(
      (field: Field<any>): boolean => {
        return fieldName(field) === RULE_CRITERIA_FIELD_NAME;
      },
    );
    const currentValues: Record<string, unknown> = {
      monitorLabels: ["production-label"],
      monitorNamePattern: "^api-",
    };
    const onChange: ReturnType<typeof jest.fn> = jest.fn();

    const element: ReactElement | undefined = criteriaField!.getCustomElement!(
      currentValues,
      { onChange: onChange },
    );
    expect(element).toBeDefined();
    const elementProps: {
      legacyValues: Record<string, unknown>;
      value?: unknown;
    } = element!.props as {
      legacyValues: Record<string, unknown>;
      value?: unknown;
    };

    expect(elementProps.legacyValues).toBe(currentValues);
    expect(elementProps.value).toBeUndefined();
  });

  test("preserves an existing criteria value for edit round-trips", () => {
    const result: Fields<any> = replaceLegacyRuleCriteriaFields(
      new RuleBaseModel(),
      ruleFields(),
    );
    const criteriaField: Field<any> | undefined = result.find(
      (field: Field<any>): boolean => {
        return fieldName(field) === RULE_CRITERIA_FIELD_NAME;
      },
    );
    const storedCriteria: Record<string, unknown> = {
      schemaVersion: 1,
      filterCondition: "Any",
      filters: [
        {
          field: "monitorNamePattern",
          operator: "MatchesPattern",
          value: "api-*",
        },
      ],
    };

    const element: ReactElement | undefined = criteriaField!.getCustomElement!(
      {
        criteria: storedCriteria,
        monitorNamePattern: "legacy-*",
      },
      { onChange: jest.fn() },
    );

    expect(element).toBeDefined();
    expect((element!.props as { value?: unknown }).value).toBe(storedCriteria);
  });

  test("leaves non-rule forms unchanged", () => {
    const fields: Fields<any> = ruleFields();
    const select: Record<string, unknown> = { monitorLabels: true };
    const monitor: Monitor = new Monitor();

    expect(replaceLegacyRuleCriteriaFields(monitor, fields)).toBe(fields);
    expect(
      addRuleCriteriaToSelect({
        model: monitor,
        fields: fields,
        select: select,
      }),
    ).toBe(select);
  });

  test("does not add a builder when a rule form has no match-criteria fields", () => {
    const fields: Fields<any> = [
      {
        field: { name: true },
        stepId: "basic-info",
        fieldType: FormFieldSchemaType.Text,
      },
    ];
    const select: Record<string, unknown> = { name: true };

    expect(replaceLegacyRuleCriteriaFields(new RuleBaseModel(), fields)).toBe(
      fields,
    );
    expect(
      addRuleCriteriaToSelect({
        model: new RuleBaseModel(),
        fields: fields,
        select: select,
      }),
    ).toBe(select);
  });
});
