/*
 * A step's own setting that names one of a record's custom fields: From Another
 * Tool's Outside ID Field. The project's fields by name, with { } beside them;
 * any other name can be typed, as a step may keep the value under a field nobody
 * has defined yet, and the setting's own default is one such name.
 */

import { DropdownOption } from "../../Dropdown/Dropdown";
import ListValueInput from "../LinkedRecord/ListValueInput";
import { WorkflowCustomField } from "./CustomFieldColumns";
import useCustomFields, { CustomFieldsState } from "./UseCustomFields";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  tableName: string;
  value: unknown;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  error?: string | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId: string;
}

const CustomFieldNameInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const customFields: CustomFieldsState = useCustomFields(props.tableName);

  const options: Array<DropdownOption> = useMemo(() => {
    return customFields.fields.map(
      (field: WorkflowCustomField): DropdownOption => {
        return { value: field.name, label: field.name, isUserContent: true };
      },
    );
  }, [customFields.fields]);

  const known: Map<string, DropdownOption> = useMemo(() => {
    return new Map<string, DropdownOption>(
      options.map((option: DropdownOption): [string, DropdownOption] => {
        return [String(option.value).toLowerCase(), option];
      }),
    );
  }, [options]);

  return (
    <ListValueInput
      options={options}
      known={known}
      value={typeof props.value === "string" ? props.value : ""}
      onChange={props.onChange}
      onPickReference={props.onChange}
      isLoading={customFields.isLoading}
      placeholder={props.placeholder}
      ariaLabelledby={props.ariaLabelledby}
      error={props.error}
      onBlur={props.onBlur}
      dataTestId={props.dataTestId}
    />
  );
};

export default CustomFieldNameInput;
