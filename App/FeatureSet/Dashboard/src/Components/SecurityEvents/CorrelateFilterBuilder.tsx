import React, { FunctionComponent, ReactElement } from "react";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import AutocompleteTextInput from "Common/UI/Components/AutocompleteTextInput/AutocompleteTextInput";
import IconProp from "Common/Types/Icon/IconProp";
import {
  CorrelationCondition,
  CorrelationConnector,
  CorrelationFieldDefinition,
  CorrelationFieldDefinitions,
  CorrelationFieldKey,
  CorrelationOperator,
  CorrelationOperatorLabels,
  getCorrelationFieldDefinition,
} from "../../Utils/SecurityEventCorrelation";

/*
 * The chainable condition rows for Security Events → Correlate: field +
 * operator + value per row, one AND/OR connector for the whole chain,
 * add/remove. Fully controlled — the parent owns the draft conditions and
 * applies them when the user hits Correlate.
 */

export interface ComponentProps {
  conditions: Array<CorrelationCondition>;
  connector: CorrelationConnector;
  onChange: (
    conditions: Array<CorrelationCondition>,
    connector: CorrelationConnector,
  ) => void;
}

const fieldDropdownOptions: Array<DropdownOption> =
  CorrelationFieldDefinitions.map(
    (definition: CorrelationFieldDefinition): DropdownOption => {
      return {
        label: definition.label,
        value: definition.key,
      };
    },
  );

function operatorDropdownOptions(
  definition: CorrelationFieldDefinition,
): Array<DropdownOption> {
  return definition.operators.map(
    (operator: CorrelationOperator): DropdownOption => {
      return {
        label: CorrelationOperatorLabels[operator],
        value: operator,
      };
    },
  );
}

export function getDefaultCorrelationCondition(): CorrelationCondition {
  return {
    field: CorrelationFieldKey.Observable,
    operator: CorrelationOperator.Equals,
    value: "",
  };
}

const CorrelateFilterBuilder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const updateCondition: (
    index: number,
    condition: CorrelationCondition,
  ) => void = (index: number, condition: CorrelationCondition): void => {
    const next: Array<CorrelationCondition> = [...props.conditions];
    next[index] = condition;
    props.onChange(next, props.connector);
  };

  const renderValueInput: (
    condition: CorrelationCondition,
    index: number,
  ) => ReactElement = (
    condition: CorrelationCondition,
    index: number,
  ): ReactElement => {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(condition.field);

    if (definition.valueOptions && definition.valueOptions.length > 0) {
      const valueOptions: Array<DropdownOption> = definition.valueOptions.map(
        (option: string): DropdownOption => {
          return { label: option, value: option };
        },
      );
      return (
        <Dropdown
          dataTestId={`correlate-condition-value-${index}`}
          ariaLabel={`Condition ${index + 1} value`}
          options={valueOptions}
          value={valueOptions.find((option: DropdownOption) => {
            return option.value === condition.value;
          })}
          placeholder={definition.placeholder || "Select a value"}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            updateCondition(index, {
              ...condition,
              value: typeof value === "string" ? value : "",
            });
          }}
        />
      );
    }

    if (definition.valueSuggestions && definition.valueSuggestions.length > 0) {
      return (
        <AutocompleteTextInput
          dataTestId={`correlate-condition-value-${index}`}
          ariaLabel={`Condition ${index + 1} value`}
          value={condition.value}
          suggestions={definition.valueSuggestions}
          placeholder={definition.placeholder}
          onChange={(value: string) => {
            updateCondition(index, { ...condition, value });
          }}
        />
      );
    }

    return (
      <Input
        dataTestId={`correlate-condition-value-${index}`}
        ariaLabel={`Condition ${index + 1} value`}
        value={condition.value}
        placeholder={definition.placeholder}
        onChange={(value: string) => {
          updateCondition(index, { ...condition, value });
        }}
      />
    );
  };

  return (
    <div
      data-testid="correlate-filter-builder"
      className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3"
    >
      {props.conditions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Match</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5">
            <button
              type="button"
              data-testid="correlate-connector-and"
              aria-pressed={props.connector === "and"}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                props.connector === "and"
                  ? "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => {
                props.onChange(props.conditions, "and");
              }}
            >
              All conditions
            </button>
            <button
              type="button"
              data-testid="correlate-connector-or"
              aria-pressed={props.connector === "or"}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                props.connector === "or"
                  ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => {
                props.onChange(props.conditions, "or");
              }}
            >
              Any condition
            </button>
          </div>
        </div>
      )}

      {props.conditions.map(
        (condition: CorrelationCondition, index: number): ReactElement => {
          const definition: CorrelationFieldDefinition =
            getCorrelationFieldDefinition(condition.field);
          const operatorOptions: Array<DropdownOption> =
            operatorDropdownOptions(definition);

          return (
            <div
              key={index}
              data-testid={`correlate-condition-row-${index}`}
              className="flex flex-col md:flex-row md:items-center gap-2"
            >
              {index > 0 && (
                <span
                  className={`inline-flex w-fit shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold border ${
                    props.connector === "or"
                      ? "bg-amber-50 text-amber-600 border-amber-200"
                      : "bg-indigo-50 text-indigo-600 border-indigo-200"
                  }`}
                >
                  {props.connector === "or" ? "OR" : "AND"}
                </span>
              )}
              <div className="md:w-44">
                <Dropdown
                  dataTestId={`correlate-condition-field-${index}`}
                  ariaLabel={`Condition ${index + 1} field`}
                  options={fieldDropdownOptions}
                  value={fieldDropdownOptions.find((option: DropdownOption) => {
                    return option.value === condition.field;
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (typeof value !== "string") {
                      return;
                    }
                    const nextField: CorrelationFieldKey =
                      value as CorrelationFieldKey;
                    const nextDefinition: CorrelationFieldDefinition =
                      getCorrelationFieldDefinition(nextField);
                    /*
                     * Keep the operator when the new field offers it too;
                     * fall back to the field's first operator otherwise.
                     * The value resets — a hostname makes no sense as a
                     * severity.
                     */
                    const nextOperator: CorrelationOperator =
                      nextDefinition.operators.includes(condition.operator)
                        ? condition.operator
                        : (nextDefinition.operators[0] as CorrelationOperator);
                    updateCondition(index, {
                      field: nextField,
                      operator: nextOperator,
                      value: "",
                    });
                  }}
                />
              </div>
              <div className="md:w-40">
                <Dropdown
                  dataTestId={`correlate-condition-operator-${index}`}
                  ariaLabel={`Condition ${index + 1} operator`}
                  options={operatorOptions}
                  value={operatorOptions.find((option: DropdownOption) => {
                    return option.value === condition.operator;
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (typeof value !== "string") {
                      return;
                    }
                    updateCondition(index, {
                      ...condition,
                      operator: value as CorrelationOperator,
                    });
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                {renderValueInput(condition, index)}
              </div>
              <Button
                dataTestId={`correlate-condition-delete-${index}`}
                ariaLabel={`Remove condition ${index + 1}`}
                icon={IconProp.Trash}
                buttonStyle={ButtonStyleType.ICON}
                buttonSize={ButtonSize.Small}
                tooltip="Remove condition"
                onClick={() => {
                  const next: Array<CorrelationCondition> =
                    props.conditions.filter(
                      (
                        _condition: CorrelationCondition,
                        conditionIndex: number,
                      ) => {
                        return conditionIndex !== index;
                      },
                    );
                  props.onChange(next, props.connector);
                }}
              />
            </div>
          );
        },
      )}

      <div>
        <Button
          dataTestId="correlate-add-condition"
          title="Add condition"
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            props.onChange(
              [...props.conditions, getDefaultCorrelationCondition()],
              props.connector,
            );
          }}
        />
      </div>
    </div>
  );
};

export default CorrelateFilterBuilder;
