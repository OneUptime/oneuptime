import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
  RuleCriteriaValue,
} from "../../../Types/Rules/RuleCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useEffect } from "react";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "../Dropdown/Dropdown";
import EntityDropdown from "../EntityDropdown/EntityDropdown";
import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import FormValues from "../Forms/Types/FormValues";
import Input, { InputType } from "../Input/Input";

const ARRAY_OPERATORS: Array<RuleCriteriaOperator> = [
  RuleCriteriaOperator.HasAnyOf,
  RuleCriteriaOperator.HasAllOf,
  RuleCriteriaOperator.HasNoneOf,
];

const TEXT_OPERATORS: Array<RuleCriteriaOperator> = [
  RuleCriteriaOperator.Equals,
  RuleCriteriaOperator.NotEquals,
  RuleCriteriaOperator.Contains,
  RuleCriteriaOperator.DoesNotContain,
  RuleCriteriaOperator.StartsWith,
  RuleCriteriaOperator.EndsWith,
  RuleCriteriaOperator.MatchesPattern,
  RuleCriteriaOperator.DoesNotMatchPattern,
];

const SCALAR_OPERATORS: Array<RuleCriteriaOperator> = [
  RuleCriteriaOperator.Equals,
  RuleCriteriaOperator.NotEquals,
];

const TEXT_FIELD_TYPES: Array<FormFieldSchemaType> = [
  FormFieldSchemaType.Text,
  FormFieldSchemaType.LongText,
  FormFieldSchemaType.Name,
  FormFieldSchemaType.Hostname,
  FormFieldSchemaType.Domain,
  FormFieldSchemaType.Email,
  FormFieldSchemaType.URL,
  FormFieldSchemaType.Route,
];

const NUMBER_FIELD_TYPES: Array<FormFieldSchemaType> = [
  FormFieldSchemaType.Number,
  FormFieldSchemaType.PositiveNumber,
  FormFieldSchemaType.Port,
];

export const RULE_CRITERIA_OPERATOR_LABELS: Record<
  RuleCriteriaOperator,
  string
> = {
  [RuleCriteriaOperator.Equals]: "Equals",
  [RuleCriteriaOperator.NotEquals]: "Does not equal",
  [RuleCriteriaOperator.Contains]: "Contains",
  [RuleCriteriaOperator.DoesNotContain]: "Does not contain",
  [RuleCriteriaOperator.StartsWith]: "Starts with",
  [RuleCriteriaOperator.EndsWith]: "Ends with",
  [RuleCriteriaOperator.MatchesPattern]: "Matches pattern",
  [RuleCriteriaOperator.DoesNotMatchPattern]: "Does not match pattern",
  [RuleCriteriaOperator.HasAnyOf]: "Has any of",
  [RuleCriteriaOperator.HasAllOf]: "Has all of",
  [RuleCriteriaOperator.HasNoneOf]: "Has none of",
};

export interface ComponentProps<TEntity> {
  fields: Array<Field<TEntity>>;
  legacyValues?: Record<string, unknown> | undefined;
  value?: RuleCriteria | null | undefined;
  onChange: (value: RuleCriteria) => void;
  disabled?: boolean | undefined;
  error?: string | undefined;
}

export function getRuleCriteriaFieldName<TEntity>(
  field: Field<TEntity>,
): string | null {
  if (field.overrideFieldKey) {
    return field.overrideFieldKey;
  }

  const names: Array<string> = Object.keys(field.field || {});
  return names[0] || null;
}

function titleFromFieldName(fieldName: string): string {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character: string): string => {
      return character.toUpperCase();
    });
}

function isTextField<TEntity>(field: Field<TEntity>): boolean {
  return TEXT_FIELD_TYPES.includes(field.fieldType || FormFieldSchemaType.Text);
}

function isNumberField<TEntity>(field: Field<TEntity>): boolean {
  return NUMBER_FIELD_TYPES.includes(
    field.fieldType || FormFieldSchemaType.Text,
  );
}

function isBooleanField<TEntity>(field: Field<TEntity>): boolean {
  return (
    field.fieldType === FormFieldSchemaType.Toggle ||
    field.fieldType === FormFieldSchemaType.Checkbox
  );
}

function isArrayOperator(operator: RuleCriteriaOperator): boolean {
  return ARRAY_OPERATORS.includes(operator);
}

export function getRuleCriteriaOperatorsForField<TEntity>(
  field: Field<TEntity>,
): Array<RuleCriteriaOperator> {
  const fieldName: string = getRuleCriteriaFieldName(field) || "";

  if (
    fieldName === "ipMatchTarget" ||
    fieldName === "sysObjectIdPattern" ||
    fieldName === "subnetCidr"
  ) {
    return [
      RuleCriteriaOperator.MatchesPattern,
      RuleCriteriaOperator.DoesNotMatchPattern,
    ];
  }

  if (field.fieldType === FormFieldSchemaType.MultiSelectDropdown) {
    return ARRAY_OPERATORS;
  }

  if (isTextField(field)) {
    return TEXT_OPERATORS;
  }

  return SCALAR_OPERATORS;
}

export function getDefaultRuleCriteriaOperator<TEntity>(
  field: Field<TEntity>,
): RuleCriteriaOperator {
  const fieldName: string = getRuleCriteriaFieldName(field) || "";

  if (field.fieldType === FormFieldSchemaType.MultiSelectDropdown) {
    return RuleCriteriaOperator.HasAnyOf;
  }

  if (isTextField(field) && fieldName.toLocaleLowerCase().includes("pattern")) {
    return RuleCriteriaOperator.MatchesPattern;
  }

  return getRuleCriteriaOperatorsForField(field)[0]!;
}

function normalizeScalarValue(value: unknown): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value && typeof value === "object") {
    const objectValue: Record<string, unknown> = value as Record<
      string,
      unknown
    >;

    for (const key of ["value", "_id", "id"]) {
      const candidate: unknown = objectValue[key];

      if (
        typeof candidate === "string" ||
        typeof candidate === "number" ||
        typeof candidate === "boolean"
      ) {
        return candidate;
      }

      if (
        candidate &&
        typeof candidate === "object" &&
        typeof (candidate as { toString?: () => string }).toString ===
          "function"
      ) {
        const stringValue: string = (
          candidate as { toString: () => string }
        ).toString();

        if (stringValue !== "[object Object]") {
          return stringValue;
        }
      }
    }
  }

  return "";
}

function normalizeValue(
  value: unknown,
  operator: RuleCriteriaOperator,
): RuleCriteriaValue {
  if (isArrayOperator(operator)) {
    const values: Array<unknown> = Array.isArray(value) ? value : [value];

    return values
      .map((item: unknown): string => {
        return normalizeScalarValue(item).toString();
      })
      .filter((item: string): boolean => {
        return item.length > 0;
      });
  }

  return normalizeScalarValue(value);
}

function hasLegacyValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

export function convertLegacyValuesToRuleCriteria<TEntity>(data: {
  fields: Array<Field<TEntity>>;
  values?: Record<string, unknown> | undefined;
}): RuleCriteria {
  const filters: Array<RuleCriteriaFilter> = [];

  for (const field of data.fields) {
    const fieldName: string | null = getRuleCriteriaFieldName(field);

    if (!fieldName) {
      continue;
    }

    const legacyValue: unknown = data.values?.[fieldName];

    if (!hasLegacyValue(legacyValue)) {
      continue;
    }

    const operator: RuleCriteriaOperator =
      getDefaultRuleCriteriaOperator(field);

    filters.push({
      field: fieldName,
      operator: operator,
      value: normalizeValue(legacyValue, operator),
    });
  }

  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  };
}

function emptyValueForField<TEntity>(
  field: Field<TEntity>,
  operator: RuleCriteriaOperator,
): RuleCriteriaValue {
  if (isArrayOperator(operator)) {
    return [];
  }

  if (isBooleanField(field)) {
    return true;
  }

  if (isNumberField(field)) {
    return 0;
  }

  return "";
}

function flattenOptions(
  options: Array<DropdownOption | DropdownOptionGroup>,
): Array<DropdownOption> {
  return options.flatMap(
    (option: DropdownOption | DropdownOptionGroup): Array<DropdownOption> => {
      if ("options" in option) {
        return option.options;
      }

      return [option];
    },
  );
}

function selectedDropdownValue(
  options: Array<DropdownOption | DropdownOptionGroup>,
  value: RuleCriteriaValue,
): DropdownOption | Array<DropdownOption> | undefined {
  const values: Array<string | number | boolean> = Array.isArray(value)
    ? value
    : [value];
  const selected: Array<DropdownOption> = flattenOptions(options).filter(
    (option: DropdownOption): boolean => {
      return values.includes(option.value);
    },
  );

  if (Array.isArray(value)) {
    return selected;
  }

  return selected[0];
}

const RuleCriteriaBuilder: <TEntity>(
  props: ComponentProps<TEntity>,
) => ReactElement = <TEntity,>(
  props: ComponentProps<TEntity>,
): ReactElement => {
  const availableFields: Array<Field<TEntity>> = props.fields.filter(
    (field: Field<TEntity>): boolean => {
      return (
        !field.showIf ||
        field.showIf((props.legacyValues || {}) as FormValues<TEntity>)
      );
    },
  );

  const legacyCriteria: RuleCriteria = convertLegacyValuesToRuleCriteria({
    fields: availableFields,
    values: props.legacyValues,
  });

  const criteria: RuleCriteria = props.value || legacyCriteria;

  useEffect(() => {
    if (!props.value) {
      props.onChange(legacyCriteria);
    }
  }, [props.value, JSON.stringify(legacyCriteria)]);

  const updateCriteria: (next: Partial<RuleCriteria>) => void = (
    next: Partial<RuleCriteria>,
  ): void => {
    props.onChange({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition:
        next.filterCondition || criteria.filterCondition || FilterCondition.All,
      filters: next.filters || criteria.filters || [],
    });
  };

  const fieldOptions: Array<DropdownOption> = availableFields
    .map((field: Field<TEntity>): DropdownOption | null => {
      const fieldName: string | null = getRuleCriteriaFieldName(field);

      if (!fieldName) {
        return null;
      }

      return {
        value: fieldName,
        label: field.title || titleFromFieldName(fieldName),
      };
    })
    .filter((option: DropdownOption | null): option is DropdownOption => {
      return option !== null;
    });

  const getField: (fieldName: string) => Field<TEntity> | undefined = (
    fieldName: string,
  ): Field<TEntity> | undefined => {
    return availableFields.find((field: Field<TEntity>): boolean => {
      return getRuleCriteriaFieldName(field) === fieldName;
    });
  };

  const changeFilter: (index: number, filter: RuleCriteriaFilter) => void = (
    index: number,
    filter: RuleCriteriaFilter,
  ): void => {
    const filters: Array<RuleCriteriaFilter> = [...criteria.filters];
    filters[index] = filter;
    updateCriteria({ filters: filters });
  };

  const renderValue: (
    filter: RuleCriteriaFilter,
    field: Field<TEntity>,
    index: number,
  ) => ReactElement = (
    filter: RuleCriteriaFilter,
    field: Field<TEntity>,
    index: number,
  ): ReactElement => {
    const isMultiSelect: boolean = isArrayOperator(filter.operator);
    const commonProps: {
      id: string;
      dataTestId: string;
      ariaLabel: string;
    } = {
      id: `rule-criteria-value-${index}`,
      dataTestId: `rule-criteria-value-${index}`,
      ariaLabel: `Value for condition ${index + 1}`,
    };

    if (field.dropdownModal) {
      return (
        <EntityDropdown
          {...commonProps}
          disabled={props.disabled}
          options={field.dropdownOptions}
          modelType={field.dropdownModal.type}
          labelField={field.dropdownModal.labelField}
          valueField={field.dropdownModal.valueField}
          isMultiSelect={isMultiSelect}
          value={filter.value}
          placeholder={field.placeholder || "Select a value"}
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            changeFilter(index, {
              ...filter,
              value: normalizeValue(value, filter.operator),
            });
          }}
        />
      );
    }

    if (field.dropdownOptions || isBooleanField(field)) {
      const options: Array<DropdownOption | DropdownOptionGroup> =
        field.dropdownOptions || [
          { label: "True", value: true },
          { label: "False", value: false },
        ];

      return (
        <Dropdown
          {...commonProps}
          disabled={props.disabled}
          options={options}
          value={selectedDropdownValue(options, filter.value)}
          isMultiSelect={isMultiSelect}
          placeholder={field.placeholder || "Select a value"}
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            changeFilter(index, {
              ...filter,
              value: normalizeValue(value, filter.operator),
            });
          }}
        />
      );
    }

    return (
      <Input
        {...commonProps}
        disabled={props.disabled}
        type={isNumberField(field) ? InputType.NUMBER : InputType.TEXT}
        value={filter.value.toString()}
        placeholder={field.placeholder || "Enter a value"}
        onChange={(value: string): void => {
          changeFilter(index, {
            ...filter,
            value:
              isNumberField(field) && value.length > 0 ? Number(value) : value,
          });
        }}
      />
    );
  };

  return (
    <div data-testid="rule-criteria-builder" className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-gray-700">
          How should conditions be combined?
        </legend>
        <div className="mt-2 flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="rule-criteria-filter-condition"
              value={FilterCondition.All}
              checked={criteria.filterCondition === FilterCondition.All}
              disabled={props.disabled}
              data-testid="rule-criteria-match-all"
              onChange={(): void => {
                updateCriteria({ filterCondition: FilterCondition.All });
              }}
            />
            Match all
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio"
              name="rule-criteria-filter-condition"
              value={FilterCondition.Any}
              checked={criteria.filterCondition === FilterCondition.Any}
              disabled={props.disabled}
              data-testid="rule-criteria-match-any"
              onChange={(): void => {
                updateCriteria({ filterCondition: FilterCondition.Any });
              }}
            />
            Match any
          </label>
        </div>
      </fieldset>

      {criteria.filters.length === 0 && (
        <p
          className="rounded-md bg-gray-50 p-3 text-sm text-gray-600"
          data-testid="rule-criteria-empty"
        >
          No conditions have been added. Add a condition to control which
          resources this rule matches.
        </p>
      )}

      {criteria.filters.map(
        (filter: RuleCriteriaFilter, index: number): ReactElement => {
          const field: Field<TEntity> | undefined = getField(filter.field);
          const operatorOptions: Array<DropdownOption> = (
            field ? getRuleCriteriaOperatorsForField(field) : SCALAR_OPERATORS
          ).map((operator: RuleCriteriaOperator): DropdownOption => {
            return {
              value: operator,
              label: RULE_CRITERIA_OPERATOR_LABELS[operator],
            };
          });

          return (
            <div
              key={`${filter.field}-${index}`}
              className="rounded-md border border-gray-200 bg-gray-50 p-4"
              data-testid={`rule-criteria-row-${index}`}
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div>
                  <label
                    htmlFor={`rule-criteria-field-${index}`}
                    className="text-sm font-medium text-gray-700"
                  >
                    Criteria
                  </label>
                  <Dropdown
                    id={`rule-criteria-field-${index}`}
                    ariaLabel={`Criteria for condition ${index + 1}`}
                    dataTestId={`rule-criteria-field-${index}`}
                    disabled={props.disabled}
                    options={fieldOptions}
                    value={fieldOptions.find(
                      (option: DropdownOption): boolean => {
                        return option.value === filter.field;
                      },
                    )}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ): void => {
                      const fieldName: string = value?.toString() || "";
                      const nextField: Field<TEntity> | undefined =
                        getField(fieldName);

                      if (!nextField) {
                        return;
                      }

                      const operator: RuleCriteriaOperator =
                        getDefaultRuleCriteriaOperator(nextField);

                      changeFilter(index, {
                        field: fieldName,
                        operator: operator,
                        value: emptyValueForField(nextField, operator),
                      });
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor={`rule-criteria-operator-${index}`}
                    className="text-sm font-medium text-gray-700"
                  >
                    Operator
                  </label>
                  <Dropdown
                    id={`rule-criteria-operator-${index}`}
                    ariaLabel={`Operator for condition ${index + 1}`}
                    dataTestId={`rule-criteria-operator-${index}`}
                    disabled={props.disabled}
                    options={operatorOptions}
                    value={operatorOptions.find(
                      (option: DropdownOption): boolean => {
                        return option.value === filter.operator;
                      },
                    )}
                    onChange={(
                      value: DropdownValue | Array<DropdownValue> | null,
                    ): void => {
                      if (!field || !value) {
                        return;
                      }

                      const operator: RuleCriteriaOperator =
                        value.toString() as RuleCriteriaOperator;

                      changeFilter(index, {
                        ...filter,
                        operator: operator,
                        value: emptyValueForField(field, operator),
                      });
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor={`rule-criteria-value-${index}`}
                    className="text-sm font-medium text-gray-700"
                  >
                    Value
                  </label>
                  {field ? (
                    renderValue(filter, field, index)
                  ) : (
                    <p className="mt-2 text-sm text-red-600">
                      This criteria field is no longer available.
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex justify-end">
                <Button
                  title="Delete"
                  ariaLabel={`Delete condition ${index + 1}`}
                  dataTestId={`rule-criteria-delete-${index}`}
                  icon={IconProp.Trash}
                  buttonSize={ButtonSize.Small}
                  buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                  disabled={props.disabled}
                  onClick={(): void => {
                    updateCriteria({
                      filters: criteria.filters.filter(
                        (_item: RuleCriteriaFilter, itemIndex: number) => {
                          return itemIndex !== index;
                        },
                      ),
                    });
                  }}
                />
              </div>
            </div>
          );
        },
      )}

      {props.error && (
        <p className="text-sm text-red-600" data-testid="rule-criteria-error">
          {props.error}
        </p>
      )}

      <Button
        title="Add Condition"
        ariaLabel="Add condition"
        dataTestId="rule-criteria-add"
        icon={IconProp.Add}
        buttonSize={ButtonSize.Small}
        buttonStyle={ButtonStyleType.OUTLINE}
        disabled={props.disabled || availableFields.length === 0}
        onClick={(): void => {
          const field: Field<TEntity> | undefined = availableFields[0];

          if (!field) {
            return;
          }

          const fieldName: string | null = getRuleCriteriaFieldName(field);

          if (!fieldName) {
            return;
          }

          const operator: RuleCriteriaOperator =
            getDefaultRuleCriteriaOperator(field);

          updateCriteria({
            filters: [
              ...criteria.filters,
              {
                field: fieldName,
                operator: operator,
                value: emptyValueForField(field, operator),
              },
            ],
          });
        }}
      />
    </div>
  );
};

export default RuleCriteriaBuilder;
