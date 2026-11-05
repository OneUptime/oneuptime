/*
 * A step's own setting that names the project's records (Argument.linkedTable):
 * a Page step's Incident ID, From Another Tool's Severity and Labels. The same
 * list as a record's columns have (LinkedRecordInput), for the settings that
 * are stored as text: one value, or several separated by commas.
 *
 * A value from an earlier step is shown as its chip, with the way back to the
 * list beside it. Most of these settings are filled in that way, and { } is
 * right there beside the list for it.
 */

import { splitLinkedRecordIds } from "../../../../Types/Workflow/LinkedRecordValue";
import { containsTemplateExpression } from "../ValuePicker/TemplateText";
import ValueTextField from "../ValuePicker/ValueTextField";
import { WorkflowViewOnlyContext } from "../WorkflowViewOnly";
import LinkedRecordInput, { PickFromListButton } from "./LinkedRecordInput";
import { LinkedRecordSources } from "./UseLinkedRecords";
import React, { FunctionComponent, ReactElement, useContext } from "react";

export interface ComponentProps {
  tableName: string;
  value: unknown;
  onChange: (value: string) => void;
  // Several records, stored as text separated by commas.
  isList?: boolean | undefined;
  allowsAnyText?: boolean | undefined;
  ariaLabelledby?: string | undefined;
  placeholder?: string | undefined;
  error?: string | undefined;
  autoFocus?: boolean | undefined;
  tabIndex?: number | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  sources?: LinkedRecordSources | undefined;
}

const LinkedRecordField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);
  const text: string = typeof props.value === "string" ? props.value : "";
  const dataTestId: string = props.dataTestId || "linked-record-field";

  type RenderTextBoxFunction = () => ReactElement;

  const renderTextBox: RenderTextBoxFunction = (): ReactElement => {
    return (
      <ValueTextField
        value={text}
        onChange={props.onChange}
        multiline={false}
        placeholder={props.placeholder}
        ariaLabelledby={props.ariaLabelledby}
        error={props.error}
        autoFocus={props.autoFocus}
        tabIndex={props.tabIndex}
        dataTestId={dataTestId}
        onBlur={props.onBlur}
      />
    );
  };

  if (props.isList) {
    return (
      <LinkedRecordInput
        tableName={props.tableName}
        isList={true}
        values={splitLinkedRecordIds(text)}
        onChangeList={(values: Array<string>) => {
          props.onChange(values.join(","));
        }}
        onPickReference={(reference: string) => {
          props.onChange([...splitLinkedRecordIds(text), reference].join(","));
        }}
        renderFallback={renderTextBox}
        allowsAnyText={props.allowsAnyText}
        ariaLabelledby={props.ariaLabelledby}
        autoFocus={props.autoFocus}
        error={props.error}
        onBlur={props.onBlur}
        dataTestId={dataTestId}
        sources={props.sources}
      />
    );
  }

  if (containsTemplateExpression(text)) {
    return (
      <div className="flex w-full items-start gap-1.5">
        <div className="min-w-0 flex-1">{renderTextBox()}</div>
        {isViewOnly ? null : (
          <PickFromListButton
            dataTestId={`${dataTestId}-pick-from-list`}
            onClick={() => {
              props.onChange("");
            }}
          />
        )}
      </div>
    );
  }

  return (
    <LinkedRecordInput
      tableName={props.tableName}
      value={text}
      onChange={props.onChange}
      onPickReference={props.onChange}
      renderFallback={renderTextBox}
      allowsAnyText={props.allowsAnyText}
      ariaLabelledby={props.ariaLabelledby}
      autoFocus={props.autoFocus}
      error={props.error}
      onBlur={props.onBlur}
      dataTestId={dataTestId}
      sources={props.sources}
    />
  );
};

export default LinkedRecordField;
