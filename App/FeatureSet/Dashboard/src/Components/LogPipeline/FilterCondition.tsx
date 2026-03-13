import React, { FunctionComponent, ReactElement } from "react";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";

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

  return (
    <div className="rounded-md p-4 bg-gray-50 border-gray-200 border-solid border">
      <div className="grid grid-cols-12 gap-3 items-end">
        {/* Field selector */}
        <div className="col-span-3">
          <FieldLabelElement title="Field" />
          <div className="mt-1">
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
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
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
        </div>

        {/* Custom attribute name input */}
        {isAttributeField && (
          <div className="col-span-2">
            <FieldLabelElement title="Attribute Name" />
            <div className="mt-1">
              <Input
                type={InputType.TEXT}
                placeholder="e.g. service"
                value={condition.field.replace("attributes.", "")}
                onChange={(value: string) => {
                  props.onChange({
                    ...condition,
                    field: `attributes.${value}`,
                  });
                }}
              />
            </div>
          </div>
        )}

        {/* Operator selector */}
        <div className={isAttributeField ? "col-span-2" : "col-span-3"}>
          <FieldLabelElement title="Condition" />
          <div className="mt-1">
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
        </div>

        {/* Value input */}
        <div className={isAttributeField ? "col-span-4" : "col-span-5"}>
          <FieldLabelElement
            title="Value"
            description={
              condition.operator === "LIKE"
                ? "Use % as wildcard (e.g. %error%)"
                : condition.operator === "IN"
                  ? "Comma-separated values"
                  : undefined
            }
          />
          <div className="mt-1">
            {condition.field === "severityText" ? (
              <Dropdown
                options={[
                  { value: "TRACE", label: "TRACE" },
                  { value: "DEBUG", label: "DEBUG" },
                  { value: "INFO", label: "INFO" },
                  { value: "WARNING", label: "WARNING" },
                  { value: "ERROR", label: "ERROR" },
                  { value: "FATAL", label: "FATAL" },
                ]}
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
              <Input
                type={InputType.TEXT}
                placeholder="Enter value..."
                value={condition.value}
                onChange={(value: string) => {
                  props.onChange({ ...condition, value });
                }}
              />
            )}
          </div>
        </div>

        {/* Delete button */}
        <div className="col-span-1 flex justify-end">
          <Button
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            buttonSize={ButtonSize.Small}
            onClick={props.onDelete}
            disabled={!props.canDelete}
            tooltip="Remove this condition"
          />
        </div>
      </div>
    </div>
  );
};

export default FilterConditionElement;
