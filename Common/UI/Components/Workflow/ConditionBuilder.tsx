import DataReferenceInput from "./DataReferenceInput";
import {
  ConditionOperator,
  ConditionValueType,
} from "../../../Types/Workflow/Components/Condition";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { NodeDataProp } from "../../../Types/Workflow/Component";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * A single, readable condition editor for the If / Else step. It replaces the
 * five stacked fields (Input 1 Type / Input 1 / Operator / Input 2 Type /
 * Input 2) with one card, but writes exactly those same argument ids — so the
 * server evaluator (Common/Server/Types/Workflow/Components/Conditions/IfElse)
 * is untouched. The value-type selectors are demoted to a compact "treated as"
 * dropdown (defaulting to Text, matching the server default).
 */

export interface ComponentProps {
  arguments: JSONObject;
  onArgumentsChange: (patch: JSONObject) => void;
  onValidityChange?: ((hasError: boolean) => void) | undefined;
  components: Array<NodeDataProp>;
  upstreamComponentIds?: Set<string> | undefined;
  currentComponentId?: string | undefined;
  workflowId: ObjectID;
}

interface Option {
  label: string;
  value: string;
}

const VALUE_TYPE_OPTIONS: Array<Option> = [
  { label: "Text", value: ConditionValueType.Text },
  { label: "Number", value: ConditionValueType.Number },
  { label: "True / False", value: ConditionValueType.Boolean },
  { label: "Null", value: ConditionValueType.Null },
  { label: "Undefined", value: ConditionValueType.Undefined },
];

const OPERATOR_OPTIONS: Array<Option> = [
  { label: "is equal to", value: ConditionOperator.EqualTo },
  { label: "is not equal to", value: ConditionOperator.NotEqualTo },
  { label: "is greater than", value: ConditionOperator.GreaterThan },
  {
    label: "is greater than or equal to",
    value: ConditionOperator.GreaterThanOrEqualTo,
  },
  { label: "is less than", value: ConditionOperator.LessThan },
  {
    label: "is less than or equal to",
    value: ConditionOperator.LessThanOrEqualTo,
  },
  { label: "contains", value: ConditionOperator.Contains },
  { label: "does not contain", value: ConditionOperator.DoesNotContain },
  { label: "starts with", value: ConditionOperator.StartsWith },
  { label: "ends with", value: ConditionOperator.EndsWith },
];

const inputClass: string =
  "block w-full rounded-md border border-gray-300 py-2 px-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const selectClass: string =
  "rounded-md border border-gray-300 py-2 px-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

const ConditionBuilder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type GetArgFunction = (key: string) => string;

  const getArg: GetArgFunction = (key: string): string => {
    return props.arguments && props.arguments[key]
      ? String(props.arguments[key])
      : "";
  };

  const input1: string = getArg("input-1");
  const input2: string = getArg("input-2");
  const operator: string = getArg("operator") || ConditionOperator.EqualTo;
  const input1Type: string = getArg("input-1-type") || ConditionValueType.Text;
  const input2Type: string = getArg("input-2-type") || ConditionValueType.Text;

  // Required inputs must be filled for the condition to be valid.
  useEffect(() => {
    props.onValidityChange?.(input1.trim() === "" || input2.trim() === "");
  }, [input1, input2]);

  // Clear the error if this editor unmounts (e.g. the panel closes).
  useEffect(() => {
    return () => {
      props.onValidityChange?.(false);
    };
  }, []);

  type UpdateFunction = (key: string, value: string) => void;

  const update: UpdateFunction = (key: string, value: string): void => {
    props.onArgumentsChange({ [key]: value });
  };

  type ValueRowProps = {
    label: string;
    valueKey: string;
    typeKey: string;
    value: string;
    valueType: string;
    placeholder: string;
  };

  const renderValueRow: (rowProps: ValueRowProps) => ReactElement = (
    rowProps: ValueRowProps,
  ): ReactElement => {
    return (
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {rowProps.label}
        </label>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={rowProps.value}
            placeholder={rowProps.placeholder}
            aria-label={rowProps.label}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              update(rowProps.valueKey, e.target.value);
            }}
          />
          <select
            className={selectClass}
            value={rowProps.valueType}
            title="Treated as"
            aria-label={`${rowProps.label} treated as`}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              update(rowProps.typeKey, e.target.value);
            }}
          >
            {VALUE_TYPE_OPTIONS.map((option: Option) => {
              return (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              );
            })}
          </select>
        </div>
        <DataReferenceInput
          value={rowProps.value}
          components={props.components}
          upstreamComponentIds={props.upstreamComponentIds}
          currentComponentId={props.currentComponentId}
          workflowId={props.workflowId}
          onChange={(newValue: string) => {
            update(rowProps.valueKey, newValue);
          }}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Runs the <span className="font-medium text-green-600">Yes</span> branch
        when the condition is true, otherwise the{" "}
        <span className="font-medium text-gray-600">No</span> branch.
      </p>

      {renderValueRow({
        label: "Value",
        valueKey: "input-1",
        typeKey: "input-1-type",
        value: input1,
        valueType: input1Type,
        placeholder: "A value, or insert data from a step",
      })}

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          Condition
        </label>
        <select
          className={`${selectClass} w-full`}
          value={operator}
          aria-label="Condition"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            update("operator", e.target.value);
          }}
        >
          {OPERATOR_OPTIONS.map((option: Option) => {
            return (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            );
          })}
        </select>
      </div>

      {renderValueRow({
        label: "Compare with",
        valueKey: "input-2",
        typeKey: "input-2-type",
        value: input2,
        valueType: input2Type,
        placeholder: "A value, or insert data from a step",
      })}
    </div>
  );
};

export default ConditionBuilder;
