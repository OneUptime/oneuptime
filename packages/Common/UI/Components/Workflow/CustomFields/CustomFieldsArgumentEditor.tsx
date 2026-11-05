/*
 * A step's own setting that holds custom fields and nothing else, as JSON whose
 * keys are their names: From Another Tool's Custom Fields. The record editor,
 * with only the record's custom fields to offer, reading and writing the setting
 * as it has always been stored - {"caseNumber": "CAS-1"}, with no customFields
 * around it. Whatever cannot be read that way stays the JSON it was.
 */

import { JSONObject } from "../../../../Types/JSON";
import { CUSTOM_FIELDS_COLUMN } from "../../../../Types/Workflow/CustomFieldsColumn";
import ModelColumnEditor, {
  ModelColumnEditorMode,
  RecordIntent,
} from "../ModelColumnEditor";
import { WorkflowViewOnlyContext } from "../WorkflowViewOnly";
import React, {
  FunctionComponent,
  ReactElement,
  useContext,
  useMemo,
} from "react";

type WrapFunction = (value: unknown) => string | JSONObject | null | undefined;

/*
 * The setting as the record editor reads a record: a bag under its column. Text
 * that is no JSON object goes through as it is, which the editor then keeps as
 * JSON, saying why.
 */
export const wrapCustomFieldsValue: WrapFunction = (
  value: unknown,
): string | JSONObject | null | undefined => {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  let parsed: unknown = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return typeof value === "string" ? value : String(value);
  }

  return JSON.stringify({ [CUSTOM_FIELDS_COLUMN]: parsed });
};

type UnwrapFunction = (value: string) => string;

// What the record editor wrote, as the setting stores it.
export const unwrapCustomFieldsValue: UnwrapFunction = (
  value: string,
): string => {
  if (value.trim() === "") {
    return "";
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      (parsed as JSONObject)[CUSTOM_FIELDS_COLUMN] &&
      typeof (parsed as JSONObject)[CUSTOM_FIELDS_COLUMN] === "object"
    ) {
      return JSON.stringify((parsed as JSONObject)[CUSTOM_FIELDS_COLUMN]);
    }
  } catch {
    // Being typed as JSON, and not JSON yet: kept as it is.
  }

  return value;
};

export interface ComponentProps {
  // The table of the records whose custom fields these are.
  tableName: string;
  initialValue: unknown;
  onChange: (value: string) => void;
  error?: string | undefined;
  placeholder?: string | undefined;
  tabIndex?: number | undefined;
}

const CustomFieldsArgumentEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // In a view the editor holds itself still, and nothing here is a change.
  const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);

  const initialValue: string | JSONObject | null | undefined = useMemo(() => {
    return wrapCustomFieldsValue(props.initialValue);
  }, []);

  return (
    <ModelColumnEditor
      tableName={props.tableName}
      mode={ModelColumnEditorMode.Record}
      recordIntent={RecordIntent.Update}
      customFieldsOnly={true}
      initialValue={initialValue}
      onChange={(value: string) => {
        if (!isViewOnly) {
          props.onChange(unwrapCustomFieldsValue(value));
        }
      }}
      error={props.error}
      placeholder={props.placeholder}
      tabIndex={props.tabIndex}
    />
  );
};

export default CustomFieldsArgumentEditor;
