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

export interface FilterConditionData {
  field: string;
  operator: string;
  value: string;
}

export interface ComponentProps {
  condition: FilterConditionData;
  onChange: (condition: FilterConditionData) => void;
  onDelete: () => void;
  canDelete: boolean;
  index: number;
  connector: string;
}

const fieldOptions: Array<DropdownOption> = [
  {
    value: "severityText",
    label: "Severity",
    description: "Log severity level (e.g. ERROR, WARNING, INFO)",
  },
  {
    value: "body",
    label: "Log Body",
    description: "The log message content",
  },
  {
    value: "serviceId",
    label: "Service ID",
    description: "The service that produced the log",
  },
];

const operatorOptions: Array<DropdownOption> = [
  { value: "=", label: "equals" },
  { value: "!=", label: "does not equal" },
  { value: "LIKE", label: "contains", description: "Use % as wildcard" },
  { value: "IN", label: "is one of", description: "Comma-separated values" },
];

const severityOptions: Array<DropdownOption> = [
  { value: "TRACE", label: "TRACE" },
  { value: "DEBUG", label: "DEBUG" },
  { value: "INFO", label: "INFO" },
  { value: "WARNING", label: "WARNING" },
  { value: "ERROR", label: "ERROR" },
  { value: "FATAL", label: "FATAL" },
];

const FilterConditionElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { condition } = props;

  const isAttributeField: boolean = condition.field.startsWith("attributes.");
  const selectedFieldOption: DropdownOption | undefined = isAttributeField
    ? undefined
    : fieldOptions.find((opt: DropdownOption) => {
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

  // Row prefix: "Where" for first row, connector for subsequent
  const rowPrefix: string = props.index === 0 ? "Where" : props.connector;

  return (
    <div className="group flex items-start gap-3 py-3">
      {/* Row prefix label */}
      <div className="flex-shrink-0 w-14 pt-1.5">
        <span
          className={`inline-block text-xs font-semibold uppercase tracking-wide ${
            props.index === 0
              ? "text-gray-400"
              : props.connector === "AND"
                ? "text-indigo-500"
                : "text-amber-500"
          }`}
        >
          {rowPrefix}
        </span>
      </div>

      {/* Condition fields - inline row */}
      <div className="flex-1 flex items-start gap-2 flex-wrap">
        {/* Field */}
        <div className="w-40">
          <Dropdown
            options={[
              ...fieldOptions,
              {
                value: "__custom_attribute__",
                label: "Custom Attribute...",
                description: "Filter on a custom log attribute",
              },
            ]}
            value={selectedFieldOption}
            placeholder="Select field..."
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              if (value === "__custom_attribute__") {
                props.onChange({
                  ...condition,
                  field: "attributes.",
                });
              } else {
                props.onChange({
                  ...condition,
                  field: value?.toString() || "",
                });
              }
            }}
          />
        </div>

        {/* Custom attribute name */}
        {isAttributeField && (
          <div className="w-32">
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
        <div className="w-44">
          <Dropdown
            options={operatorOptions}
            value={selectedOperatorOption}
            placeholder="Select..."
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              props.onChange({
                ...condition,
                operator: value?.toString() || "=",
              });
            }}
          />
        </div>

        {/* Value */}
        <div className="flex-1 min-w-[160px]">
          {condition.field === "severityText" ? (
            <Dropdown
              options={severityOptions}
              value={
                condition.value
                  ? { value: condition.value, label: condition.value }
                  : undefined
              }
              placeholder="Select severity..."
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                props.onChange({
                  ...condition,
                  value: value?.toString() || "",
                });
              }}
            />
          ) : (
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
                <p className="mt-0.5 text-[11px] text-gray-400 leading-tight">
                  {operatorHint}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete */}
      <div className="flex-shrink-0 pt-0.5">
        {props.canDelete ? (
          <Button
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={props.onDelete}
            tooltip="Remove condition"
          />
        ) : (
          // Spacer to keep alignment when delete is hidden
          <div className="w-8" />
        )}
      </div>
    </div>
  );
};

export default FilterConditionElement;
