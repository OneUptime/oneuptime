import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  FilterBuilderConfig,
  FilterConditionData,
  FilterFieldDefinition,
  FilterFieldValueOption,
} from "./Types";
import {
  getValueForOperator,
  joinListValue,
  splitListValue,
} from "./FilterQueryParser";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

const CUSTOM_ATTRIBUTE_VALUE: string = "__custom_attribute__";

export interface ComponentProps {
  condition: FilterConditionData;
  onChange: (condition: FilterConditionData) => void;
  onDelete: () => void;
  canDelete: boolean;
  index: number;
  connector: string;
  isLast: boolean;
  config: FilterBuilderConfig;
}

const operatorOptions: Array<DropdownOption> = [
  { value: "=", label: "equals" },
  { value: "!=", label: "does not equal" },
  { value: "LIKE", label: "contains", description: "Substring match" },
  { value: "IN", label: "is one of", description: "Comma-separated values" },
];

/*
 * The operators a field offers. A field picked from a dropdown (Status, Span
 * Kind, Severity, the yes/no fields) holds one of a few stored values, so
 * "contains" means nothing there and is left out - unless the condition
 * already uses it, as a filter saved before this did, which still shows
 * what it is (#9214).
 */
export function getOperatorOptionsForField(
  field: FilterFieldDefinition | undefined,
  currentOperator: string,
): Array<DropdownOption> {
  if (field?.valueType !== "dropdown" || currentOperator === "LIKE") {
    return operatorOptions;
  }

  return operatorOptions.filter((option: DropdownOption): boolean => {
    return option.value !== "LIKE";
  });
}

/*
 * A dropdown field's values as the pickers offer them: each by its label
 * (Error, Client), storing its code (2, SPAN_KIND_CLIENT).
 */
export function getValueDropdownOptions(
  field: FilterFieldDefinition,
): Array<DropdownOption> {
  return (field.valueOptions || []).map(
    (o: FilterFieldValueOption): DropdownOption => {
      const option: DropdownOption = {
        value: o.value,
        label: o.label,
      };
      if (o.description) {
        option.description = o.description;
      }
      return option;
    },
  );
}

/*
 * The picks an "is one of" condition shows for its stored list ("0, 2"):
 * each code's option, so it reads Unset, Error. A value no option has (one
 * typed into the old text box, "INFO") stays, drawn as written, so saving
 * the filter again never drops it without anyone seeing.
 */
export function getPickedListOptions(
  value: string,
  options: Array<DropdownOption>,
): Array<DropdownOption> {
  return splitListValue(value).map((code: string): DropdownOption => {
    return (
      options.find((option: DropdownOption): boolean => {
        return option.value === code;
      }) || { value: code, label: code, isUserContent: true }
    );
  });
}

const FilterConditionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { condition, config } = props;

  const isAttributeField: boolean = condition.field.startsWith("attributes.");

  const fieldDefinition: FilterFieldDefinition | undefined = config.fields.find(
    (f: FilterFieldDefinition) => {
      return f.key === condition.field;
    },
  );

  const fieldDropdownOptions: Array<DropdownOption> = [
    ...config.fields.map((f: FilterFieldDefinition): DropdownOption => {
      const option: DropdownOption = {
        value: f.key,
        label: f.label,
      };
      if (f.description) {
        option.description = f.description;
      }
      return option;
    }),
  ];

  if (config.supportCustomAttributes) {
    fieldDropdownOptions.push({
      value: CUSTOM_ATTRIBUTE_VALUE,
      label: config.customAttributeLabel || "Custom Attribute...",
      description:
        config.customAttributeDescription ||
        translator.translateTemplate(
          "Filter on a custom {{entity}} attribute",
          {
            entity: translatableTerm(config.entityNameSingular, {
              inSentence: true,
            }),
          },
        ),
    });
  }

  const selectedFieldOption: DropdownOption | undefined = isAttributeField
    ? undefined
    : fieldDropdownOptions.find((opt: DropdownOption) => {
        return opt.value === condition.field;
      });

  const fieldOperatorOptions: Array<DropdownOption> =
    getOperatorOptionsForField(
      isAttributeField ? undefined : fieldDefinition,
      condition.operator,
    );

  const selectedOperatorOption: DropdownOption | undefined =
    fieldOperatorOptions.find((opt: DropdownOption) => {
      return opt.value === condition.operator;
    });

  const operatorHint: string | undefined =
    condition.operator === "LIKE"
      ? "Matches if the value contains this text. Use % for wildcards (e.g. %error%)"
      : condition.operator === "IN"
        ? "Comma-separated values"
        : undefined;

  const isFirst: boolean = props.index === 0;
  const connectorColor: string =
    props.connector === "AND" ? "text-indigo-600" : "text-amber-600";
  const connectorBgColor: string =
    props.connector === "AND"
      ? "bg-indigo-50 border-indigo-200"
      : "bg-amber-50 border-amber-200";
  const lineColor: string =
    props.connector === "AND" ? "bg-indigo-200" : "bg-amber-200";

  const renderValueInput: () => ReactElement = (): ReactElement => {
    if (isAttributeField || !fieldDefinition) {
      return (
        <div>
          <Input
            type={InputType.TEXT}
            placeholder="Enter value..."
            value={condition.value}
            onChange={(value: string) => {
              props.onChange({ ...condition, value });
            }}
          />
          {operatorHint && (
            <p className="mt-0.5 text-xs text-gray-500 leading-tight">
              {translator.translateText(operatorHint)}
            </p>
          )}
        </div>
      );
    }

    /*
     * The field's own placeholder is English, for Dropdown to look up; the
     * sentence around its label is worded here (#7682).
     */
    const valuePlaceholder: string =
      fieldDefinition.valuePlaceholder ||
      translator.translateTemplate("Select {{field}}...", {
        field: translatableTerm(fieldDefinition.label, {
          inSentence: true,
        }),
      });

    /*
     * "Is one of" on a dropdown field picks several of the same labels the
     * single pickers offer (Unset, Error) and stores their codes ("0, 2"),
     * where it was a text box that wanted the codes typed in (#9214).
     */
    if (
      fieldDefinition.valueType === "dropdown" &&
      fieldDefinition.valueOptions &&
      condition.operator === "IN"
    ) {
      const valueDropdownOptions: Array<DropdownOption> =
        getValueDropdownOptions(fieldDefinition);

      return (
        <div data-testid="filter-condition-value-list">
          <Dropdown
            isMultiSelect={true}
            options={valueDropdownOptions}
            value={getPickedListOptions(condition.value, valueDropdownOptions)}
            placeholder={valuePlaceholder}
            isPlaceholderTranslated={!fieldDefinition.valuePlaceholder}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              const picked: Array<string> = (
                Array.isArray(value) ? value : value ? [value] : []
              ).map((item: DropdownValue): string => {
                return item.toString();
              });

              props.onChange({
                ...condition,
                value: joinListValue(picked),
              });
            }}
          />
        </div>
      );
    }

    if (
      fieldDefinition.valueType === "dropdown" &&
      fieldDefinition.valueOptions &&
      (condition.operator === "=" || condition.operator === "!=")
    ) {
      const valueDropdownOptions: Array<DropdownOption> =
        getValueDropdownOptions(fieldDefinition);
      return (
        <Dropdown
          options={valueDropdownOptions}
          value={
            condition.value
              ? valueDropdownOptions.find((o: DropdownOption) => {
                  return o.value === condition.value;
                })
              : undefined
          }
          placeholder={valuePlaceholder}
          isPlaceholderTranslated={!fieldDefinition.valuePlaceholder}
          onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
            props.onChange({
              ...condition,
              value: value?.toString() || "",
            });
          }}
        />
      );
    }

    if (fieldDefinition.valueType === "boolean") {
      const boolChecked: boolean = condition.value === "true";
      return (
        <div className="flex items-center h-[38px]">
          <Toggle
            ariaLabel={fieldDefinition.label}
            value={boolChecked}
            onChange={(value: boolean) => {
              props.onChange({
                ...condition,
                value: value ? "true" : "false",
              });
            }}
          />
          <code className="ml-2 text-xs text-gray-500">
            {boolChecked ? "true" : "false"}
          </code>
        </div>
      );
    }

    if (fieldDefinition.valueType === "number") {
      return (
        <div>
          <Input
            type={InputType.NUMBER}
            placeholder={fieldDefinition.valuePlaceholder || "Enter number..."}
            value={condition.value}
            onChange={(value: string) => {
              props.onChange({ ...condition, value });
            }}
          />
          {operatorHint && (
            <p className="mt-0.5 text-xs text-gray-500 leading-tight">
              {translator.translateText(operatorHint)}
            </p>
          )}
        </div>
      );
    }

    return (
      <div>
        <Input
          type={InputType.TEXT}
          placeholder={fieldDefinition.valuePlaceholder || "Enter value..."}
          value={condition.value}
          onChange={(value: string) => {
            props.onChange({ ...condition, value });
          }}
        />
        {operatorHint && (
          <p className="mt-0.5 text-xs text-gray-500 leading-tight">
            {translator.translateText(operatorHint)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="relative flex">
      {/* Timeline column */}
      <div className="flex-shrink-0 w-16 flex flex-col items-center relative">
        {/* Top line segment (hidden for first) */}
        {!isFirst && <div className={`w-0.5 h-3 ${lineColor}`} />}
        {isFirst && <div className="h-3" />}

        {/* Node: "Where" dot or connector badge */}
        {isFirst ? (
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 border-2 border-gray-300">
            <svg
              className="w-3 h-3 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
          </div>
        ) : (
          <div
            className={`flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-bold border ${connectorBgColor} ${connectorColor}`}
          >
            {props.connector}
          </div>
        )}

        {/* Bottom line segment (hidden for last) */}
        {!props.isLast ? (
          <div className={`w-0.5 flex-1 ${lineColor}`} />
        ) : (
          <div className="flex-1" />
        )}
      </div>

      {/* Condition row */}
      <div className="flex-1 group pb-3 pt-0.5">
        <div className="relative rounded-lg border border-transparent hover:border-gray-200 hover:bg-gray-50/50 transition-all duration-150 p-3 -ml-1">
          {/* Delete button - top right */}
          {props.canDelete && (
            <button
              type="button"
              onClick={props.onDelete}
              aria-label={translator.translateText("Remove condition")}
              title={translator.translateText("Remove condition")}
              className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 transition-colors duration-150"
            >
              <Icon icon={IconProp.Trash} className="h-4 w-4" />
            </button>
          )}

          <div
            className={`flex flex-col gap-3 ${props.canDelete ? "pr-12" : ""}`}
          >
            {/* Field */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                {translator.translateText("Field")}
              </label>
              <Dropdown
                options={fieldDropdownOptions}
                value={selectedFieldOption}
                placeholder="Select field..."
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (value === CUSTOM_ATTRIBUTE_VALUE) {
                    props.onChange({
                      ...condition,
                      field: "attributes.",
                      value: "",
                    });
                  } else {
                    const field: string = value?.toString() || "";
                    const nextField: FilterFieldDefinition | undefined =
                      config.fields.find(
                        (f: FilterFieldDefinition): boolean => {
                          return f.key === field;
                        },
                      );
                    props.onChange({
                      ...condition,
                      field: field,
                      // "Contains" is not offered on a dropdown field.
                      operator:
                        nextField?.valueType === "dropdown" &&
                        condition.operator === "LIKE"
                          ? "="
                          : condition.operator,
                      value: "",
                    });
                  }
                }}
              />
            </div>

            {/* Custom attribute name */}
            {isAttributeField && (
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  {translator.translateText("Attribute")}
                </label>
                <Input
                  type={InputType.TEXT}
                  placeholder="attr name"
                  value={condition.field.replace("attributes.", "")}
                  onChange={(value: string) => {
                    props.onChange({
                      ...condition,
                      field: `attributes.${value}`,
                    });
                  }}
                />
              </div>
            )}

            {/* Operator */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                {translator.translateText("Operator")}
              </label>
              <Dropdown
                options={fieldOperatorOptions}
                value={selectedOperatorOption}
                placeholder="Select..."
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  const operator: string = value?.toString() || "=";
                  props.onChange({
                    ...condition,
                    operator: operator,
                    value: getValueForOperator(
                      condition.value,
                      operator,
                      isAttributeField ? undefined : fieldDefinition,
                    ),
                  });
                }}
              />
            </div>

            {/* Value */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                {translator.translateText("Value")}
              </label>
              {renderValueInput()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilterConditionElement;
