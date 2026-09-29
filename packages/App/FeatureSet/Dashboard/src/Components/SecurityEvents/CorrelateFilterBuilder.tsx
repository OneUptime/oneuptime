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
import useTranslateValue from "Common/UI/Utils/Translation";
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
 * applies them when the user hits Correlate. The parent can hang its own
 * action (the Correlate button) in the footer and receive Enter presses from
 * the plain text value editors.
 */

export interface ComponentProps {
  conditions: Array<CorrelationCondition>;
  connector: CorrelationConnector;
  onChange: (
    conditions: Array<CorrelationCondition>,
    connector: CorrelationConnector,
  ) => void;
  footerAction?: ReactElement | undefined;
  onSubmit?: (() => void) | undefined;
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
  const { translateString } = useTranslateValue();
  const t: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

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
        onEnterPress={props.onSubmit}
        onChange={(value: string) => {
          updateCondition(index, { ...condition, value });
        }}
      />
    );
  };

  return (
    <div
      data-testid="correlate-filter-builder"
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3"
    >
      {props.conditions.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            {t("Match")}
          </span>
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
              {t("All conditions")}
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
              {t("Any condition")}
            </button>
          </div>
        </div>
      )}

      {props.conditions.length === 0 && (
        <p
          data-testid="correlate-builder-empty"
          className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-500"
        >
          {t("No conditions yet. Add one to start.")}
        </p>
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
              {/*
               * A fixed-width leading cell keeps the field dropdowns aligned
               * down the chain. On small screens the rows stack, so the
               * first row's "Where" cell collapses instead of leaving a gap.
               */}
              {index === 0 ? (
                <div
                  data-testid={`correlate-condition-lead-${index}`}
                  className="max-md:hidden shrink-0 md:block md:w-14"
                >
                  <span className="text-xs font-medium text-gray-500">
                    {t("Where")}
                  </span>
                </div>
              ) : (
                <div
                  data-testid={`correlate-condition-lead-${index}`}
                  className="shrink-0 md:w-14"
                >
                  <span
                    className={`inline-flex w-fit items-center rounded-full border px-1.5 py-0.5 text-xs font-bold ${
                      props.connector === "or"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-indigo-50 text-indigo-600 border-indigo-200"
                    }`}
                  >
                    {props.connector === "or" ? "OR" : "AND"}
                  </span>
                </div>
              )}
              <div className="md:w-44">
                <Dropdown
                  dataTestId={`correlate-condition-field-${index}`}
                  isClearable={false}
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
                  isClearable={false}
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
                ariaLabel={`${t("Remove condition")} ${index + 1}`}
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

      {/*
       * Button carries md:ml-3 and w-full md:w-auto for modal footers. The
       * [&_button] overrides keep both footer buttons (ours and the parent's
       * footerAction) flush with the rows above, and sized to their labels
       * once the footer becomes a row at sm.
       */}
      <div
        data-testid="correlate-builder-footer"
        className="flex flex-col gap-2 border-t border-gray-200 pt-3 sm:flex-row sm:items-center sm:justify-between [&_button]:ml-0 [&_button]:sm:w-auto"
      >
        <Button
          dataTestId="correlate-add-condition"
          title="Add condition"
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            props.onChange(
              [...props.conditions, getDefaultCorrelationCondition()],
              props.connector,
            );
          }}
        />
        {props.footerAction ?? <></>}
      </div>
    </div>
  );
};

export default CorrelateFilterBuilder;
