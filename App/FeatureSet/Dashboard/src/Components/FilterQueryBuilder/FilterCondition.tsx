import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  FilterBuilderConfig,
  FilterConditionData,
  FilterFieldDefinition,
  FilterFieldValueOption,
} from "./Types";

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
  { value: "LIKE", label: "contains", description: "Use % as wildcard" },
  { value: "IN", label: "is one of", description: "Comma-separated values" },
];

const FilterConditionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
        `Filter on a custom ${config.entityNameSingular} attribute`,
    });
  }

  const selectedFieldOption: DropdownOption | undefined = isAttributeField
    ? undefined
    : fieldDropdownOptions.find((opt: DropdownOption) => {
        return opt.value === condition.field;
      });

  const selectedOperatorOption: DropdownOption | undefined =
    operatorOptions.find((opt: DropdownOption) => {
      return opt.value === condition.operator;
    });

  const operatorHint: string | undefined =
    condition.operator === "LIKE"
      ? "Use % as wildcard (e.g. %error%)"
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
            <p className="mt-0.5 text-[10px] text-gray-400 leading-tight">
              {operatorHint}
            </p>
          )}
        </div>
      );
    }

    if (
      fieldDefinition.valueType === "dropdown" &&
      fieldDefinition.valueOptions &&
      (condition.operator === "=" || condition.operator === "!=")
    ) {
      const valueDropdownOptions: Array<DropdownOption> =
        fieldDefinition.valueOptions.map(
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
          placeholder={
            fieldDefinition.valuePlaceholder ||
            `Select ${fieldDefinition.label.toLowerCase()}...`
          }
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
            value={boolChecked}
            onChange={(value: boolean) => {
              props.onChange({
                ...condition,
                value: value ? "true" : "false",
              });
            }}
          />
          <span className="ml-2 text-xs text-gray-500">
            {boolChecked ? "true" : "false"}
          </span>
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
            <p className="mt-0.5 text-[10px] text-gray-400 leading-tight">
              {operatorHint}
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
          <p className="mt-0.5 text-[10px] text-gray-400 leading-tight">
            {operatorHint}
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
            className={`flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${connectorBgColor} ${connectorColor}`}
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
        <div className="flex items-start gap-2 rounded-lg border border-transparent hover:border-gray-200 hover:bg-gray-50/50 transition-all duration-150 p-2 -ml-1">
          {/* Field */}
          <div className="w-40 flex-shrink-0">
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
              Field
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
                  props.onChange({
                    ...condition,
                    field: value?.toString() || "",
                    value: "",
                  });
                }
              }}
            />
          </div>

          {/* Custom attribute name */}
          {isAttributeField && (
            <div className="w-32 flex-shrink-0">
              <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
                Attribute
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
          <div className="w-40 flex-shrink-0">
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
              Operator
            </label>
            <Dropdown
              options={operatorOptions}
              value={selectedOperatorOption}
              placeholder="Select..."
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                props.onChange({
                  ...condition,
                  operator: value?.toString() || "=",
                });
              }}
            />
          </div>

          {/* Value */}
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">
              Value
            </label>
            {renderValueInput()}
          </div>

          {/* Delete - uses same label spacer as other columns to align */}
          <div className="flex-shrink-0">
            <label className="block text-[10px] font-medium text-transparent uppercase tracking-wider mb-1">
              &nbsp;
            </label>
            {props.canDelete ? (
              <Button
                icon={IconProp.Trash}
                buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                buttonSize={ButtonSize.Small}
                onClick={props.onDelete}
                tooltip="Remove condition"
              />
            ) : (
              <div className="w-8" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilterConditionElement;
