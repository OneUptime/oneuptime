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
import FieldError from "../../Forms/Fields/FieldError";
import { ModelSchemaColumn } from "../ModelSchema";
import {
  columnPickLabel,
  controlForColumn,
  getColumnTitle,
} from "./ColumnControl";
import { getCustomFieldName } from "../../../../Types/Workflow/CustomFieldsColumn";
import { CustomFieldRowCopy } from "../CustomFields/CustomFieldColumns";
import {
  ColumnValueMode,
  ModelColumnControl,
  ModelColumnRow,
  changeColumnRow,
} from "./ColumnRow";
import { isColumnDescriptionInformative } from "./ColumnPickerOptions";
import { rowIssue } from "./ColumnRowSerialization";
import { isSystemColumn } from "./ColumnUse";
import ColumnValueInput from "./ColumnValueInput";
import { WorkflowViewOnlyContext } from "../WorkflowViewOnly";
import React, {
  FunctionComponent,
  ReactElement,
  useContext,
  useId,
} from "react";
import { Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";

// The field, its value, and Remove at the end of the row.
export const FIELD_ROW_GRID_CLASS: string =
  "group relative grid grid-cols-1 items-start gap-x-4 gap-y-2 px-3 py-3 transition-colors hover:bg-gray-50/60 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]";

// On a view there is no Remove, nor a place kept for one.
export const FIELD_ROW_VIEW_GRID_CLASS: string =
  "group relative grid grid-cols-1 items-start gap-x-4 gap-y-2 px-3 py-3 transition-colors hover:bg-gray-50/60 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]";

export interface ComponentProps {
  row: ModelColumnRow;
  /** Undefined when the stored key is not a column this model describes. */
  column: ModelSchemaColumn | undefined;
  /** Every column id, offered as autocomplete when a key has to be retyped. */
  knownColumnIds: Array<string>;
  isRequired: boolean;
  /** Focused on mount, so a field added from the picker is ready to type into. */
  autoFocus?: boolean | undefined;
  onChange: (row: ModelColumnRow) => void;
  onRemove: () => void;
}

const ColumnFieldRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * A step opened to be read (WorkflowViewOnly): the field and its value,
   * with no Remove beside them - nothing here can change the record.
   */
  const isViewOnly: boolean = useContext(WorkflowViewOnlyContext);
  const labelId: string = useId();
  const control: ModelColumnControl = controlForColumn(props.column);
  const issue: string | null = rowIssue(props.row, props.column);
  /*
   * A custom field this project no longer has - it was deleted or renamed - is
   * still called by its name, and saved as it was: only the note under its value
   * says what became of it.
   */
  const customFieldName: string | null = getCustomFieldName(props.row.columnId);
  const isDeletedCustomField: boolean =
    !props.column && customFieldName !== null;
  const isUnknownColumn: boolean = !props.column && !isDeletedCustomField;
  const typeLabel: string = columnPickLabel(props.column);
  /*
   * The field's name, in the reader's language: the model's own, or what it
   * points at for a field picked from a list (Incident Severity).
   */
  const columnTitle: string =
    customFieldName !== null
      ? customFieldName
      : translator.translateText(getColumnTitle(props.column)) || "";

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
      className={isViewOnly ? FIELD_ROW_VIEW_GRID_CLASS : FIELD_ROW_GRID_CLASS}
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
                props.onChange(changeColumnRow(props.row, { columnId: value }));
              }}
            />
            <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
              {translator.translateText("Not a column on this model")}
            </span>
          </div>
        ) : (
          <>
            <label
              id={labelId}
              className="block truncate text-sm font-medium text-gray-900"
            >
              {columnTitle}
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
              {/* What it is called on the wire says nothing of a custom field. */}
              {customFieldName !== null ? (
                <span className="truncate rounded bg-gray-100 px-1.5 py-0.5">
                  {translator.translateText(CustomFieldRowCopy.chip)}
                </span>
              ) : (
                <span className="truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono">
                  {props.row.columnId}
                </span>
              )}
              {!isDeletedCustomField &&
                typeLabel.toLowerCase() !== columnTitle.toLowerCase() && (
                  <span className="truncate text-gray-400">{typeLabel}</span>
                )}
            </span>
            {/*
              Wrapped rather than truncated. This sentence is the model's own
              explanation of the field and is often the only thing that settles
              what to type; cutting it off mid-word and hiding the rest behind a
              hover is not a real answer inside a modal. Left out only where it
              is the field's name again ("Incident Severity ID").
            */}
            {props.column && isColumnDescriptionInformative(props.column) && (
              <span className="mt-1 block text-xs leading-snug text-gray-500">
                {translator.translateText(props.column.description)}
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
          linkedTableName={props.column?.linkedTableName}
          choices={props.column?.customField?.options}
          placeholder={props.column?.example || props.column?.placeholder}
          ariaLabelledby={isUnknownColumn ? undefined : labelId}
          autoFocus={props.autoFocus}
          dataTestId={`model-column-value-${props.row.columnId}`}
          onChange={(change: Partial<ModelColumnRow>) => {
            props.onChange(changeColumnRow(props.row, change));
          }}
        />

        {props.row.valueMode === ColumnValueMode.Raw && (
          <p className="mt-1 text-[11px] text-amber-600">
            {/* What editing it would do is no news on a view. */}
            {translator.translateText(
              isViewOnly
                ? "Kept exactly as it was saved."
                : "Kept exactly as it was saved. Editing it rewrites it in this column's own type.",
            )}
          </p>
        )}

        {/*
         * What is wrong with what was typed, drawn as every field's error is
         * (FieldError). Said politely: it comes and goes as the value is
         * typed, and saving still goes ahead (rowIssue).
         */}
        {issue && (
          <FieldError
            message={issue}
            className="mt-1 text-[11px]"
            announce="polite"
            dataTestId={`model-column-issue-${props.row.columnId}`}
          />
        )}

        {isDeletedCustomField && (
          <p
            className="mt-1 text-[11px] text-amber-600"
            data-testid="model-column-no-such-custom-field"
          >
            {translator.translateText(CustomFieldRowCopy.noSuchField)}
          </p>
        )}

        {props.column?.isTenantColumn && (
          <p className="mt-1 text-[11px] text-gray-500">
            {translator.translateText(
              "The workflow sets this itself and ignores what you type here.",
            )}
          </p>
        )}

        {/*
          The picker no longer offers these, but a workflow saved before it
          stopped can still hold one. The row stays - dropping a stored value
          is how an editor loses work - and says why it is not in the list.
        */}
        {props.column &&
          !props.column.isTenantColumn &&
          isSystemColumn(props.column) && (
            <p
              className="mt-1 text-[11px] text-gray-500"
              data-testid={`model-column-system-note-${props.row.columnId}`}
            >
              {translator.translateText(
                "OneUptime fills this in itself, so you can remove it.",
              )}
            </p>
          )}
      </div>

      {isViewOnly ? (
        <></>
      ) : (
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
      )}
    </div>
  );
};

export default ColumnFieldRow;
