import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
  RuleCriteriaValue,
} from "../../../Types/Rules/RuleCriteria";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "../../../Types/Filter/FilterConditionUtil";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useEffect, useId } from "react";
import useTranslateValue from "../../Utils/Translation";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "../Dropdown/Dropdown";
import EntityDropdown from "../EntityDropdown/EntityDropdown";
import Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { translateValidationMessage } from "../Forms/Validation";
import Icon from "../Icon/Icon";
import Input, { InputType } from "../Input/Input";
import {
  changeRuleCriteriaFilterField,
  changeRuleCriteriaFilterOperator,
  convertLegacyValuesToRuleCriteria,
  createRuleCriteriaFilter,
  findRuleCriteriaField,
  formatRuleCriteriaMessage,
  getAvailableRuleCriteriaFields,
  getNextRuleCriteriaField,
  getRuleCriteriaFieldName,
  getRuleCriteriaFieldTitle,
  getRuleCriteriaFilterProblem,
  getRuleCriteriaOperatorLabel,
  getRuleCriteriaOperatorsForField,
  getRuleCriteriaValuePlaceholder,
  isRuleCriteriaArrayOperator,
  normalizeRuleCriteriaValue,
  RULE_CRITERIA_SCALAR_OPERATORS,
  RuleCriteriaCopy,
  RuleCriteriaMessage,
} from "./RuleCriteriaFields";

/*
 * The helpers the builder used to define itself. They live in
 * RuleCriteriaFields now; these re-exports keep the old import path working.
 */
export {
  convertLegacyValuesToRuleCriteria,
  getDefaultRuleCriteriaOperator,
  getRuleCriteriaFieldName,
  getRuleCriteriaOperatorsForField,
  RULE_CRITERIA_OPERATOR_LABELS,
} from "./RuleCriteriaFields";

export interface ComponentProps<TEntity> {
  fields: Array<Field<TEntity>>;
  legacyValues?: Record<string, unknown> | undefined;
  value?: RuleCriteria | null | undefined;
  onChange: (value: RuleCriteria) => void;
  disabled?: boolean | undefined;
  error?: string | undefined;
  /*
   * The rule matches nothing until it has a condition (its API refuses an
   * empty list), so the empty state asks for one instead of saying the rule
   * applies to everything.
   */
  requiresCondition?: boolean | undefined;
}

/*
 * The conditions of a rule, as a sentence per row: "If [Incident Title]
 * [Contains] [database]", "And [Monitor Labels] [Has any of] [Production]".
 *
 * - With fewer than two conditions there is nothing to combine, so "Match
 *   all / Match any" only appears once there is (isFilterConditionNeeded,
 *   the rule every form asking for a filter condition follows); every later
 *   row then starts with the word it picked ("And" / "Or").
 * - "Add condition" starts the next row on a field no row uses yet.
 * - A row is one line on a wide screen and stacks on a narrow one, and its
 *   remove button is a quiet icon at the end rather than a red button below.
 * - A value's placeholder says what to put there for the operator chosen.
 * - Problems are said in plain words next to the row they are about, once the
 *   form has asked for the conditions (props.error is set).
 *
 * Every rule page shares this component through RuleCriteriaModelForm, so it
 * knows nothing about any one kind of rule: the criteria and their names are
 * the page's match fields.
 */
const RuleCriteriaBuilder: <TEntity>(
  props: ComponentProps<TEntity>,
) => ReactElement = <TEntity,>(
  props: ComponentProps<TEntity>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) ?? text;
  };
  const radioGroupName: string = `rule-criteria-filter-condition-${useId()}`;

  const availableFields: Array<Field<TEntity>> = getAvailableRuleCriteriaFields(
    props.fields,
    props.legacyValues,
  );

  const legacyCriteria: RuleCriteria = convertLegacyValuesToRuleCriteria({
    fields: availableFields,
    values: props.legacyValues,
  });

  const criteria: RuleCriteria = props.value || legacyCriteria;
  const matchesAll: boolean = criteria.filterCondition !== FilterCondition.Any;

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

  const changeFilter: (index: number, filter: RuleCriteriaFilter) => void = (
    index: number,
    filter: RuleCriteriaFilter,
  ): void => {
    const filters: Array<RuleCriteriaFilter> = [...criteria.filters];
    filters[index] = filter;
    updateCriteria({ filters: filters });
  };

  const addCondition: () => void = (): void => {
    const field: Field<TEntity> | undefined = getNextRuleCriteriaField(
      availableFields,
      criteria.filters,
    );
    const filter: RuleCriteriaFilter | null = field
      ? createRuleCriteriaFilter(field)
      : null;

    if (!filter) {
      return;
    }

    updateCriteria({ filters: [...criteria.filters, filter] });
  };

  const removeCondition: (index: number) => void = (index: number): void => {
    updateCriteria({
      filters: criteria.filters.filter(
        (_item: RuleCriteriaFilter, itemIndex: number): boolean => {
          return itemIndex !== index;
        },
      ),
    });
  };

  const fieldOptions: Array<DropdownOption> = availableFields.map(
    (field: Field<TEntity>): DropdownOption => {
      const fieldName: string = getRuleCriteriaFieldName(field) || "";

      return {
        value: fieldName,
        label: getRuleCriteriaFieldTitle(field, fieldName),
      };
    },
  );

  const describeProblem: (problem: RuleCriteriaMessage) => string = (
    problem: RuleCriteriaMessage,
  ): string => {
    return formatRuleCriteriaMessage(problem, translateValidationMessage);
  };

  /*
   * Problems are only pointed out once the form has asked for the conditions
   * - it hands the builder an error then - so a row added a second ago is not
   * already red for having no value yet.
   */
  const rowProblems: Array<string | null> = criteria.filters.map(
    (filter: RuleCriteriaFilter): string | null => {
      if (!props.error) {
        return null;
      }

      const problem: RuleCriteriaMessage | null = getRuleCriteriaFilterProblem(
        filter,
        findRuleCriteriaField(availableFields, filter.field),
      );

      return problem ? describeProblem(problem) : null;
    },
  );

  const hasRowProblem: boolean = rowProblems.some(
    (problem: string | null): boolean => {
      return problem !== null;
    },
  );

  const addButton: ReactElement = (
    <Button
      title={RuleCriteriaCopy.addCondition}
      ariaLabel={tx(RuleCriteriaCopy.addCondition)}
      dataTestId="rule-criteria-add"
      icon={IconProp.Add}
      buttonSize={ButtonSize.Normal}
      buttonStyle={ButtonStyleType.SECONDARY}
      disabled={props.disabled || availableFields.length === 0}
      onClick={addCondition}
    />
  );

  const renderValue: (
    filter: RuleCriteriaFilter,
    field: Field<TEntity>,
    index: number,
    problem: string | null,
  ) => ReactElement = (
    filter: RuleCriteriaFilter,
    field: Field<TEntity>,
    index: number,
    problem: string | null,
  ): ReactElement => {
    const isMultiSelect: boolean = isRuleCriteriaArrayOperator(filter.operator);
    // Dropdown and Input translate their own placeholder; EntityDropdown does not.
    const placeholder: string = getRuleCriteriaValuePlaceholder(
      field,
      filter.operator,
    );
    const commonProps: {
      id: string;
      dataTestId: string;
      ariaLabel: string;
    } = {
      id: `rule-criteria-value-${index}`,
      dataTestId: `rule-criteria-value-${index}`,
      ariaLabel: translator.translateTemplate(
        "Value for condition {{number}}",
        {
          number: index + 1,
        },
      ),
    };
    const error: string | undefined = problem || undefined;

    if (field.dropdownModal) {
      return (
        <EntityDropdown
          {...commonProps}
          className="relative w-full"
          disabled={props.disabled}
          options={field.dropdownOptions}
          modelType={field.dropdownModal.type}
          labelField={field.dropdownModal.labelField}
          valueField={field.dropdownModal.valueField}
          isMultiSelect={isMultiSelect}
          value={filter.value}
          placeholder={tx(placeholder)}
          error={error}
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            changeFilter(index, {
              ...filter,
              value: normalizeRuleCriteriaValue(value, filter.operator),
            });
          }}
        />
      );
    }

    if (
      field.dropdownOptions ||
      field.fieldType === FormFieldSchemaType.Toggle ||
      field.fieldType === FormFieldSchemaType.Checkbox
    ) {
      const options: Array<DropdownOption | DropdownOptionGroup> =
        field.dropdownOptions || [
          { label: RuleCriteriaCopy.trueValue, value: true },
          { label: RuleCriteriaCopy.falseValue, value: false },
        ];

      return (
        <Dropdown
          {...commonProps}
          className="relative w-full"
          disabled={props.disabled}
          options={options}
          value={selectedDropdownValue(options, filter.value)}
          isMultiSelect={isMultiSelect}
          placeholder={placeholder}
          error={error}
          onChange={(
            value: DropdownValue | Array<DropdownValue> | null,
          ): void => {
            changeFilter(index, {
              ...filter,
              value: normalizeRuleCriteriaValue(value, filter.operator),
            });
          }}
        />
      );
    }

    const isNumber: boolean =
      field.fieldType === FormFieldSchemaType.Number ||
      field.fieldType === FormFieldSchemaType.PositiveNumber ||
      field.fieldType === FormFieldSchemaType.Port;

    return (
      <Input
        {...commonProps}
        outerDivClassName="relative w-full rounded-md shadow-sm"
        disabled={props.disabled}
        type={isNumber ? InputType.NUMBER : InputType.TEXT}
        value={filter.value.toString()}
        placeholder={placeholder}
        error={error}
        onChange={(value: string): void => {
          changeFilter(index, {
            ...filter,
            value: isNumber && value.length > 0 ? Number(value) : value,
          });
        }}
      />
    );
  };

  const renderConnector: (index: number) => ReactElement = (
    index: number,
  ): ReactElement => {
    if (index === 0) {
      return (
        <span className="text-sm font-semibold text-gray-700">
          {tx(RuleCriteriaCopy.ifConnector)}
        </span>
      );
    }

    return (
      <span
        className={`inline-flex whitespace-nowrap rounded-md border px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide ${
          matchesAll
            ? "border-blue-200 bg-blue-50 text-blue-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
        data-testid={`rule-criteria-connector-${index}`}
      >
        {tx(
          matchesAll
            ? RuleCriteriaCopy.andConnector
            : RuleCriteriaCopy.orConnector,
        )}
      </span>
    );
  };

  const renderRow: (
    filter: RuleCriteriaFilter,
    index: number,
  ) => ReactElement = (
    filter: RuleCriteriaFilter,
    index: number,
  ): ReactElement => {
    const field: Field<TEntity> | undefined = findRuleCriteriaField(
      availableFields,
      filter.field,
    );
    const operatorOptions: Array<DropdownOption> = (
      field
        ? getRuleCriteriaOperatorsForField(field)
        : [...RULE_CRITERIA_SCALAR_OPERATORS]
    ).map((operator: RuleCriteriaOperator): DropdownOption => {
      return {
        value: operator,
        label: getRuleCriteriaOperatorLabel(field, operator),
      };
    });
    const problem: string | null = rowProblems[index] || null;

    return (
      <li
        key={`${filter.field}-${index}`}
        className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 lg:grid-cols-[3.5rem_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_auto]"
        data-testid={`rule-criteria-row-${index}`}
      >
        <div className="flex h-10 items-center">{renderConnector(index)}</div>

        <div className="min-w-0">
          <Dropdown
            id={`rule-criteria-field-${index}`}
            ariaLabel={translator.translateTemplate(
              "Criteria for condition {{number}}",
              { number: index + 1 },
            )}
            dataTestId={`rule-criteria-field-${index}`}
            className="relative w-full"
            isClearable={false}
            disabled={props.disabled}
            options={fieldOptions}
            value={fieldOptions.find((option: DropdownOption): boolean => {
              return option.value === filter.field;
            })}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              const nextField: Field<TEntity> | undefined =
                findRuleCriteriaField(availableFields, value?.toString() || "");

              if (!nextField || value?.toString() === filter.field) {
                return;
              }

              changeFilter(
                index,
                changeRuleCriteriaFilterField({
                  filter: filter,
                  fromField: field,
                  toField: nextField,
                }),
              );
            }}
          />
        </div>

        <div className="min-w-0 max-lg:col-start-2 max-lg:row-start-2">
          <Dropdown
            id={`rule-criteria-operator-${index}`}
            ariaLabel={translator.translateTemplate(
              "Operator for condition {{number}}",
              { number: index + 1 },
            )}
            dataTestId={`rule-criteria-operator-${index}`}
            className="relative w-full"
            isClearable={false}
            disabled={props.disabled || !field}
            options={operatorOptions}
            value={operatorOptions.find((option: DropdownOption): boolean => {
              return option.value === filter.operator;
            })}
            onChange={(
              value: DropdownValue | Array<DropdownValue> | null,
            ): void => {
              if (!field || !value || value.toString() === filter.operator) {
                return;
              }

              changeFilter(
                index,
                changeRuleCriteriaFilterOperator({
                  filter: filter,
                  field: field,
                  operator: value.toString() as RuleCriteriaOperator,
                }),
              );
            }}
          />
        </div>

        <div className="min-w-0 max-lg:col-start-2 max-lg:row-start-3">
          {field ? (
            renderValue(filter, field, index, problem)
          ) : (
            <p
              className="pt-2 text-sm text-red-600"
              role="alert"
              data-testid={`rule-criteria-unavailable-${index}`}
            >
              {tx(RuleCriteriaCopy.fieldUnavailable)}
            </p>
          )}
        </div>

        <div className="flex h-10 items-center max-lg:col-start-3 max-lg:row-start-1">
          <Button
            title={RuleCriteriaCopy.removeCondition}
            tooltip={RuleCriteriaCopy.removeCondition}
            ariaLabel={translator.translateTemplate(
              "Remove condition {{number}}",
              {
                number: index + 1,
              },
            )}
            dataTestId={`rule-criteria-delete-${index}`}
            icon={IconProp.Trash}
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.ICON}
            disabled={props.disabled}
            onClick={(): void => {
              removeCondition(index);
            }}
          />
        </div>
      </li>
    );
  };

  return (
    <div data-testid="rule-criteria-builder" className="space-y-3">
      {criteria.filters.length === 0 ? (
        <div
          className="flex flex-col gap-4 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-5 sm:flex-row sm:items-center sm:justify-between"
          data-testid="rule-criteria-empty"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"
              aria-hidden="true"
            >
              <Icon icon={IconProp.Filter} className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {tx(RuleCriteriaCopy.emptyTitle)}
              </p>
              <p
                className="mt-1 text-sm text-gray-500"
                data-testid="rule-criteria-empty-description"
              >
                {tx(
                  props.requiresCondition
                    ? RuleCriteriaCopy.emptyNeedsCondition
                    : RuleCriteriaCopy.emptyMatchesEverything,
                )}
              </p>
            </div>
          </div>
          <div className="shrink-0">{addButton}</div>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          {isFilterConditionNeeded(criteria.filters) && (
            <fieldset
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
              data-testid="rule-criteria-combine"
            >
              <legend className="sr-only">
                {tx(RuleCriteriaCopy.combineLegend)}
              </legend>
              <div className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
                {[FilterCondition.All, FilterCondition.Any].map(
                  (filterCondition: FilterCondition): ReactElement => {
                    const isChecked: boolean =
                      (filterCondition === FilterCondition.All) === matchesAll;

                    return (
                      <label
                        key={filterCondition}
                        className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-indigo-500 ${
                          isChecked
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={radioGroupName}
                          value={filterCondition}
                          checked={isChecked}
                          disabled={props.disabled}
                          data-testid={
                            filterCondition === FilterCondition.All
                              ? "rule-criteria-match-all"
                              : "rule-criteria-match-any"
                          }
                          onChange={(): void => {
                            updateCriteria({
                              filterCondition: filterCondition,
                            });
                          }}
                        />
                        {tx(
                          filterCondition === FilterCondition.All
                            ? RuleCriteriaCopy.matchAll
                            : RuleCriteriaCopy.matchAny,
                        )}
                      </label>
                    );
                  },
                )}
              </div>
              <p
                className="text-sm text-gray-500"
                data-testid="rule-criteria-combine-hint"
              >
                {tx(
                  matchesAll
                    ? RuleCriteriaCopy.matchAllHint
                    : RuleCriteriaCopy.matchAnyHint,
                )}
              </p>
            </fieldset>
          )}

          <ol className="space-y-3">{criteria.filters.map(renderRow)}</ol>

          <div>{addButton}</div>
        </div>
      )}

      {props.error && !hasRowProblem && (
        <p
          className="text-sm text-red-600"
          role="alert"
          data-testid="rule-criteria-error"
        >
          {props.error}
        </p>
      )}
    </div>
  );
};

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

export default RuleCriteriaBuilder;
