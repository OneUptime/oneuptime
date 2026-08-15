/*
 * One field of a record: the column's real name and description on the left,
 * the value on the right.
 *
 * This is a settings form, not a table of key/value pairs, because the keys are
 * not the builder's to invent - they are the model's columns, and the model has
 * already said what each one is called and what it means.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import AutocompleteTextInput from "../../AutocompleteTextInput/AutocompleteTextInput";
import Button, { ButtonStyleType } from "../../Button/Button";
import { ModelSchemaColumn } from "../ModelSchema";
import { columnTypeLabel, controlForColumn } from "./ColumnControl";
import {
  ColumnValueMode,
  ModelColumnControl,
  ModelColumnRow,
} from "./ColumnRow";
import { rowIssue } from "./ColumnRowSerialization";
import ColumnValueInput from "./ColumnValueInput";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  row: ModelColumnRow;
  /** Undefined when the stored key is not a column this model describes. */
  column: ModelSchemaColumn | undefined;
  /** Every column id, offered as autocomplete when a key has to be retyped. */
  knownColumnIds: Array<string>;
  isRequired: boolean;
  suggestions?: Array<string> | undefined;
  onChange: (row: ModelColumnRow) => void;
  onRemove: () => void;
}

const ColumnFieldRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const labelId: string = useId();
  const control: ModelColumnControl = controlForColumn(props.column);
  const issue: string | null = rowIssue(props.row, props.column);
  const isUnknownColumn: boolean = !props.column;
  const typeLabel: string = columnTypeLabel(props.column);

  /*
   * An empty required field is worth pointing at, but only quietly: the step
   * cannot be saved without it anyway (form validation reads the whole value),
   * and a red row for something the builder has not reached yet reads as an
   * error they made.
   */
  const isEmptyRequired: boolean =
    props.isRequired && props.row.text === "" && props.row.values.length === 0;

  return (
    <div
      className="group relative grid grid-cols-1 items-start gap-x-4 gap-y-2 px-3 py-3 transition-colors hover:bg-gray-50/60 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
      data-testid="model-column-row"
    >
      {isEmptyRequired && (
        <span
          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-amber-400"
          aria-hidden="true"
        />
      )}

      <div className="min-w-0">
        {isUnknownColumn ? (
          <div>
            <AutocompleteTextInput
              value={props.row.columnId}
              placeholder="Column name"
              suggestions={props.knownColumnIds}
              outerDivClassName="relative w-full"
              className="block w-full rounded-md border border-amber-300 bg-white py-1.5 pl-2 pr-2 font-mono text-xs text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              disableSpellCheck={true}
              onChange={(value: string) => {
                props.onChange({ ...props.row, columnId: value });
              }}
            />
            <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
              Not a column on this model
            </span>
          </div>
        ) : (
          <>
            <label
              id={labelId}
              className="block truncate text-sm font-medium text-gray-900"
            >
              {props.column?.title}
              {props.isRequired && (
                <span className="ml-0.5 text-red-500" aria-hidden="true">
                  *
                </span>
              )}
            </label>
            {/*
              The column name and its type share a line. Stacked they made every
              field four lines tall, and the two together are one fact: what this
              key is called on the wire, and what shape of value it takes.

              The type is dropped when it would only repeat the field's own name -
              a column called "Color" does not need "Color" printed under it.
            */}
            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono">
                {props.row.columnId}
              </span>
              {typeLabel.toLowerCase() !==
                (props.column?.title || "").toLowerCase() && (
                <span className="truncate text-gray-400">{typeLabel}</span>
              )}
            </span>
            {/*
              Wrapped rather than truncated. This sentence is the model's own
              explanation of the field and is often the only thing that settles
              what to type; cutting it off mid-word and hiding the rest behind a
              hover is not a real answer inside a modal.
            */}
            {props.column?.description && (
              <span className="mt-1 block text-xs leading-snug text-gray-500">
                {props.column.description}
              </span>
            )}
          </>
        )}
      </div>

      <div className="min-w-0">
        <ColumnValueInput
          control={control}
          valueMode={props.row.valueMode}
          text={props.row.text}
          values={props.row.values}
          placeholder={props.column?.example || props.column?.placeholder}
          suggestions={props.suggestions}
          ariaLabelledby={isUnknownColumn ? undefined : labelId}
          dataTestId={`model-column-value-${props.row.columnId}`}
          onTextChange={(text: string) => {
            props.onChange({ ...props.row, text: text, isSeeded: false });
          }}
          onValuesChange={(values: Array<string>) => {
            props.onChange({ ...props.row, values: values, isSeeded: false });
          }}
          onValueModeChange={(valueMode: ColumnValueMode) => {
            props.onChange({
              ...props.row,
              valueMode: valueMode,
              isSeeded: false,
            });
          }}
        />

        {props.row.valueMode === ColumnValueMode.Raw && (
          <p className="mt-1 text-[11px] text-amber-600">
            Kept exactly as it was saved. Editing it rewrites it in this
            column&apos;s own type.
          </p>
        )}

        {issue && <p className="mt-1 text-[11px] text-red-500">{issue}</p>}

        {props.column?.isTenantColumn && (
          <p className="mt-1 text-[11px] text-gray-500">
            The workflow sets this itself and ignores what you type here.
          </p>
        )}
      </div>

      <div className="flex items-center pt-1">
        <Button
          buttonStyle={ButtonStyleType.ICON}
          icon={IconProp.Trash}
          title="Remove"
          dataTestId={`model-column-remove-${props.row.columnId}`}
          className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={props.onRemove}
        />
      </div>
    </div>
  );
};

export default ColumnFieldRow;
