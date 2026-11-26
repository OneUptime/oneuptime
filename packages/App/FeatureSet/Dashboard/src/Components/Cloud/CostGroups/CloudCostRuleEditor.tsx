import {
  CLOUD_PROVIDER_LABELS,
  CloudProvider,
} from "Common/Types/Cloud/CloudPlatform";
import {
  CLOUD_COST_FIELD_OPERATORS,
  CLOUD_COST_VALUELESS_OPERATORS,
  CloudCostRule,
  CloudCostRuleCondition,
  CloudCostRuleField,
  CloudCostRuleOperator,
  getCloudCostRulesProblem,
  isCloudCostIdField,
} from "Common/Types/Cloud/CloudCostRules";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  FIELD_LABELS,
  FIELD_ORDER,
  OPERATOR_LABELS,
  RULE_EDITOR_ADD_CONDITION,
  RULE_EDITOR_ADD_RULE,
  RULE_EDITOR_ADD_VALUE,
  RULE_EDITOR_ALL_CONDITIONS,
  RULE_EDITOR_AND,
  RULE_EDITOR_ANY_RULE,
  RULE_EDITOR_CHECK,
  RULE_EDITOR_EMPTY,
  RULE_EDITOR_NEEDS_KEY,
  RULE_EDITOR_NEEDS_VALUE,
  RULE_EDITOR_OR,
  RULE_EDITOR_OWNER_SPLIT,
  RULE_EDITOR_REMOVE_CONDITION,
  RULE_EDITOR_REMOVE_RULE,
  RULE_EDITOR_RULE,
  RULE_EDITOR_TAG_KEY,
  RULE_EDITOR_TYPE_OR_PICK,
  RULE_EDITOR_VALUES,
} from "./CloudCostGroupWords";
import {
  CloudCostRuleNames,
  CloudCostValueText,
  getCloudCostValueText,
  getNamesOf,
} from "./CloudCostRuleSummary";

/*
 * THE RULES OF A COST GROUP, EDITED.
 *
 * A group takes a cost when any of its rules matches it, and a rule
 * matches when all of its conditions do: rules are listed with "Or"
 * between them, a rule's conditions with "And". A condition is a row: what
 * it reads (a tag and its key, an account, an owner team...), how it
 * compares, and the values it names - picked from the project's records
 * for an account, a team, a label, an environment, an app or a cluster,
 * picked or typed for a service, a Region, a tag's value.
 *
 * What it hands back is the rules exactly as the server keeps them
 * (CloudCostRules), so the form's check and the server's are one check.
 */

export interface CloudCostRuleOptions {
  // The accounts' tags, the costliest first.
  tagKeys: Array<string>;
  // A tag's values, the costliest first, read when the tag is picked.
  loadTagValues: (key: string) => Promise<Array<string>>;
  services: Array<string>;
  regions: Array<string>;
}

export interface ComponentProps {
  value: Array<CloudCostRule>;
  onChange: (rules: Array<CloudCostRule>) => void;
  names: CloudCostRuleNames;
  options: CloudCostRuleOptions;
  // The form asked for the rules: say what is wrong with them, if anything.
  showProblem?: boolean | undefined;
  disabled?: boolean | undefined;
}

// A new condition: on the costliest tag when costs carry tags, else an account.
export function newCloudCostCondition(
  options: CloudCostRuleOptions,
): CloudCostRuleCondition {
  if (options.tagKeys.length > 0) {
    return {
      field: CloudCostRuleField.Tag,
      key: options.tagKeys[0]!,
      operator: CloudCostRuleOperator.Is,
      values: [],
    };
  }

  return {
    field: CloudCostRuleField.Account,
    operator: CloudCostRuleOperator.Is,
    values: [],
  };
}

// A condition moved to another field: its values belong to the old one.
export function changeConditionField(data: {
  condition: CloudCostRuleCondition;
  field: CloudCostRuleField;
  options: CloudCostRuleOptions;
}): CloudCostRuleCondition {
  const operators: ReadonlyArray<CloudCostRuleOperator> =
    CLOUD_COST_FIELD_OPERATORS[data.field];

  return {
    field: data.field,
    operator: operators.includes(data.condition.operator)
      ? data.condition.operator
      : operators[0]!,
    ...(data.field === CloudCostRuleField.Tag
      ? { key: data.condition.key || data.options.tagKeys[0] || "" }
      : {}),
    values: [],
  };
}

const ConditionRow: FunctionComponent<{
  condition: CloudCostRuleCondition;
  number: number;
  names: CloudCostRuleNames;
  options: CloudCostRuleOptions;
  disabled?: boolean | undefined;
  onChange: (condition: CloudCostRuleCondition) => void;
  onRemove: () => void;
}> = (props: {
  condition: CloudCostRuleCondition;
  number: number;
  names: CloudCostRuleNames;
  options: CloudCostRuleOptions;
  disabled?: boolean | undefined;
  onChange: (condition: CloudCostRuleCondition) => void;
  onRemove: () => void;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [tagValues, setTagValues] = useState<Array<string>>([]);
  const condition: CloudCostRuleCondition = props.condition;
  const isTag: boolean = condition.field === CloudCostRuleField.Tag;

  useEffect(() => {
    let ignore: boolean = false;

    if (isTag && condition.key) {
      props.options
        .loadTagValues(condition.key)
        .then((values: Array<string>): void => {
          if (!ignore) {
            setTagValues(values);
          }
        })
        .catch((): void => {
          // Suggestions only: a value can still be typed.
        });
    } else {
      setTagValues([]);
    }

    return (): void => {
      ignore = true;
    };
  }, [isTag, condition.key]);

  const fieldOptions: Array<DropdownOption> = FIELD_ORDER.map(
    (field: CloudCostRuleField): DropdownOption => {
      return { value: field, label: FIELD_LABELS[field] };
    },
  );
  const operatorOptions: Array<DropdownOption> = CLOUD_COST_FIELD_OPERATORS[
    condition.field
  ].map((operator: CloudCostRuleOperator): DropdownOption => {
    return { value: operator, label: OPERATOR_LABELS[operator] };
  });
  const tagKeyOptions: Array<DropdownOption> = Array.from(
    new Set([
      ...(condition.key ? [condition.key] : []),
      ...props.options.tagKeys,
    ]),
  ).map((key: string): DropdownOption => {
    return { value: key, label: key, isUserContent: true };
  });

  // What a value can be picked from: the project's records, or the costs'.
  const valueOptions: Array<DropdownOption> = ((): Array<DropdownOption> => {
    const names: Map<string, string> | null = getNamesOf(
      props.names,
      condition.field,
    );

    if (names) {
      return Array.from(names.entries())
        .sort((a: [string, string], b: [string, string]): number => {
          return a[1].localeCompare(b[1]);
        })
        .map(([id, name]: [string, string]): DropdownOption => {
          return { value: id, label: name, isUserContent: true };
        });
    }

    if (condition.field === CloudCostRuleField.Provider) {
      return Object.values(CloudProvider).map(
        (provider: CloudProvider): DropdownOption => {
          return {
            value: provider,
            label: CLOUD_PROVIDER_LABELS[provider],
            isUserContent: true,
          };
        },
      );
    }

    const suggestions: Array<string> =
      condition.field === CloudCostRuleField.Service
        ? props.options.services
        : condition.field === CloudCostRuleField.Region
          ? props.options.regions
          : isTag
            ? tagValues
            : [];

    return suggestions
      .filter((value: string): boolean => {
        return value.length > 0;
      })
      .map((value: string): DropdownOption => {
        return { value, label: value, isUserContent: true };
      });
  })();

  // The values picked, each drawn as the summary draws it.
  const picked: Array<DropdownOption> = condition.values.map(
    (value: string): DropdownOption => {
      const found: DropdownOption | undefined = valueOptions.find(
        (option: DropdownOption): boolean => {
          return String(option.value).toLowerCase() === value.toLowerCase();
        },
      );

      if (found) {
        return found;
      }

      const shown: CloudCostValueText = getCloudCostValueText({
        field: condition.field,
        value,
        names: props.names,
      });

      return {
        value,
        label: shown.text,
        isUserContent: shown.isAsWritten,
      };
    },
  );

  const isValueless: boolean = CLOUD_COST_VALUELESS_OPERATORS.includes(
    condition.operator,
  );
  const removeLabel: string = translator.translateTemplate(
    RULE_EDITOR_REMOVE_CONDITION,
    { number: translator.formatNumber(props.number) },
  );

  return (
    <div
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start"
      data-testid="cloud-cost-condition-row"
    >
      <div className="w-full sm:w-48">
        <Dropdown
          ariaLabel={FIELD_LABELS[condition.field]}
          dataTestId="cloud-cost-condition-field"
          options={fieldOptions}
          value={fieldOptions.find((option: DropdownOption): boolean => {
            return option.value === condition.field;
          })}
          isClearable={false}
          disabled={props.disabled}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (typeof value === "string" && value !== condition.field) {
              props.onChange(
                changeConditionField({
                  condition,
                  field: value as CloudCostRuleField,
                  options: props.options,
                }),
              );
            }
          }}
        />
      </div>
      {isTag ? (
        <div className="w-full sm:w-44">
          <Dropdown
            ariaLabel={RULE_EDITOR_TAG_KEY}
            dataTestId="cloud-cost-condition-tag-key"
            placeholder={RULE_EDITOR_TAG_KEY}
            options={tagKeyOptions}
            value={tagKeyOptions.find((option: DropdownOption): boolean => {
              return option.value === condition.key;
            })}
            isClearable={false}
            isCreatable={true}
            formatCreateLabel={(text: string): string => {
              return translator.translateTemplate(RULE_EDITOR_ADD_VALUE, {
                value: text,
              });
            }}
            disabled={props.disabled}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (typeof value === "string" && value.trim()) {
                props.onChange({ ...condition, key: value.trim(), values: [] });
              }
            }}
          />
        </div>
      ) : (
        <></>
      )}
      <div className="w-full sm:w-40">
        <Dropdown
          ariaLabel={OPERATOR_LABELS[condition.operator]}
          dataTestId="cloud-cost-condition-operator"
          options={operatorOptions}
          value={operatorOptions.find((option: DropdownOption): boolean => {
            return option.value === condition.operator;
          })}
          isClearable={false}
          disabled={props.disabled}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            if (typeof value === "string") {
              const operator: CloudCostRuleOperator =
                value as CloudCostRuleOperator;
              props.onChange({
                ...condition,
                operator,
                values: CLOUD_COST_VALUELESS_OPERATORS.includes(operator)
                  ? []
                  : condition.values,
              });
            }
          }}
        />
      </div>
      {isValueless ? (
        <div className="hidden sm:block sm:min-w-0 sm:flex-1" />
      ) : (
        <div className="w-full min-w-0 sm:min-w-[12rem] sm:flex-1">
          <Dropdown
            ariaLabel={RULE_EDITOR_VALUES}
            dataTestId="cloud-cost-condition-values"
            placeholder={RULE_EDITOR_TYPE_OR_PICK}
            options={valueOptions}
            value={picked}
            isMultiSelect={true}
            closeMenuOnSelect={false}
            isCreatable={
              !isCloudCostIdField(condition.field) &&
              condition.field !== CloudCostRuleField.Provider
            }
            formatCreateLabel={(text: string): string => {
              return translator.translateTemplate(RULE_EDITOR_ADD_VALUE, {
                value: text,
              });
            }}
            disabled={props.disabled}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              const values: Array<string> = (
                Array.isArray(value) ? value : value === null ? [] : [value]
              )
                .map((entry: DropdownValue): string => {
                  return String(entry).trim();
                })
                .filter((entry: string, index: number, all: Array<string>) => {
                  return (
                    entry.length > 0 &&
                    all.findIndex((other: string): boolean => {
                      return other.toLowerCase() === entry.toLowerCase();
                    }) === index
                  );
                });

              props.onChange({ ...condition, values });
            }}
          />
        </div>
      )}
      <div className="flex justify-end sm:pt-0.5">
        <Button
          buttonStyle={ButtonStyleType.ICON}
          icon={IconProp.Trash}
          ariaLabel={removeLabel}
          isAriaLabelTranslated={true}
          tooltip={removeLabel}
          dataTestId="cloud-cost-condition-remove"
          disabled={props.disabled}
          onClick={props.onRemove}
        />
      </div>
    </div>
  );
};

/*
 * What keeps the rules from being saved, in the reader's words: a
 * condition with no value or no tag key - all a person can leave undone
 * here, since fields, operators and records are picked. Anything else the
 * server's check finds (getCloudCostRulesProblem) is said in general.
 */
export function getRuleEditorProblem(data: {
  rules: Array<CloudCostRule>;
  translator: Translator;
}): string | null {
  for (let ruleIndex: number = 0; ruleIndex < data.rules.length; ruleIndex++) {
    const rule: CloudCostRule = data.rules[ruleIndex]!;

    for (
      let conditionIndex: number = 0;
      conditionIndex < rule.conditions.length;
      conditionIndex++
    ) {
      const condition: CloudCostRuleCondition =
        rule.conditions[conditionIndex]!;
      const where: { rule: string; condition: string } = {
        rule: data.translator.formatNumber(ruleIndex + 1),
        condition: data.translator.formatNumber(conditionIndex + 1),
      };

      if (condition.field === CloudCostRuleField.Tag && !condition.key) {
        return data.translator.translateTemplate(RULE_EDITOR_NEEDS_KEY, where);
      }

      if (
        !CLOUD_COST_VALUELESS_OPERATORS.includes(condition.operator) &&
        condition.values.length === 0
      ) {
        return data.translator.translateTemplate(
          RULE_EDITOR_NEEDS_VALUE,
          where,
        );
      }
    }
  }

  return getCloudCostRulesProblem(data.rules)
    ? data.translator.translateText(RULE_EDITOR_CHECK) || RULE_EDITOR_CHECK
    : null;
}

const CloudCostRuleEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const problem: string | null = props.showProblem
    ? getRuleEditorProblem({ rules: props.value, translator })
    : null;

  const setRule: (index: number, rule: CloudCostRule | null) => void = (
    index: number,
    rule: CloudCostRule | null,
  ): void => {
    const rules: Array<CloudCostRule> = props.value.slice();

    if (rule === null || rule.conditions.length === 0) {
      rules.splice(index, 1);
    } else {
      rules[index] = rule;
    }

    props.onChange(rules);
  };

  return (
    <div className="space-y-3" data-testid="cloud-cost-rule-editor">
      <p className="text-sm text-gray-600">
        {translator.translateText(RULE_EDITOR_ANY_RULE)}
      </p>
      {props.value.length === 0 ? (
        <p
          className="rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500"
          data-testid="cloud-cost-rule-editor-empty"
        >
          {translator.translateText(RULE_EDITOR_EMPTY)}
        </p>
      ) : (
        <></>
      )}
      {props.value.map((rule: CloudCostRule, ruleIndex: number) => {
        const removeRule: string = translator.translateTemplate(
          RULE_EDITOR_REMOVE_RULE,
          { number: translator.formatNumber(ruleIndex + 1) },
        );

        return (
          <div key={ruleIndex} className="space-y-3">
            {ruleIndex > 0 ? (
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {translator.translateText(RULE_EDITOR_OR)}
              </div>
            ) : (
              <></>
            )}
            <div
              className="space-y-3 rounded-md border border-gray-200 p-3"
              data-testid="cloud-cost-rule"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {translator.translateTemplate(RULE_EDITOR_RULE, {
                      number: translator.formatNumber(ruleIndex + 1),
                    })}
                  </div>
                  {rule.conditions.length > 1 ? (
                    <div className="text-xs text-gray-500">
                      {translator.translateText(RULE_EDITOR_ALL_CONDITIONS)}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
                <Button
                  buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                  buttonSize={ButtonSize.Small}
                  title={removeRule}
                  isTitleTranslated={true}
                  dataTestId="cloud-cost-rule-remove"
                  disabled={props.disabled}
                  onClick={() => {
                    setRule(ruleIndex, null);
                  }}
                />
              </div>
              {rule.conditions.map(
                (condition: CloudCostRuleCondition, conditionIndex: number) => {
                  return (
                    <div key={conditionIndex} className="space-y-2">
                      {conditionIndex > 0 ? (
                        <div className="text-xs font-medium text-gray-500">
                          {translator.translateText(RULE_EDITOR_AND)}
                        </div>
                      ) : (
                        <></>
                      )}
                      <ConditionRow
                        condition={condition}
                        number={conditionIndex + 1}
                        names={props.names}
                        options={props.options}
                        disabled={props.disabled}
                        onChange={(changed: CloudCostRuleCondition) => {
                          const conditions: Array<CloudCostRuleCondition> =
                            rule.conditions.slice();
                          conditions[conditionIndex] = changed;
                          setRule(ruleIndex, { conditions });
                        }}
                        onRemove={() => {
                          const conditions: Array<CloudCostRuleCondition> =
                            rule.conditions.slice();
                          conditions.splice(conditionIndex, 1);
                          setRule(ruleIndex, { conditions });
                        }}
                      />
                    </div>
                  );
                },
              )}
              <Button
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                icon={IconProp.Add}
                title={RULE_EDITOR_ADD_CONDITION}
                dataTestId="cloud-cost-condition-add"
                disabled={props.disabled}
                onClick={() => {
                  setRule(ruleIndex, {
                    conditions: [
                      ...rule.conditions,
                      newCloudCostCondition(props.options),
                    ],
                  });
                }}
              />
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          buttonStyle={ButtonStyleType.OUTLINE}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          title={RULE_EDITOR_ADD_RULE}
          dataTestId="cloud-cost-rule-add"
          disabled={props.disabled}
          onClick={() => {
            props.onChange([
              ...props.value,
              { conditions: [newCloudCostCondition(props.options)] },
            ]);
          }}
        />
        <span className="text-xs text-gray-500">
          {translator.translateText(RULE_EDITOR_OWNER_SPLIT)}
        </span>
      </div>
      {problem ? <FieldError message={problem} /> : <></>}
    </div>
  );
};

export default CloudCostRuleEditor;
