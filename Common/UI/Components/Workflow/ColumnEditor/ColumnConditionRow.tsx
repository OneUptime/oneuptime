/*
 * One condition of a query: column, comparison, value.
 *
 * A condition genuinely picks its subject, so this row keeps a column picker -
 * but a picker of real columns, not a text box. The comparison list is filtered
 * by the column's type, so a Boolean column no longer offers "starts with" and
 * an ID column no longer offers "greater than".
 */

import IconProp from "../../../../Types/Icon/IconProp";
import Button, { ButtonStyleType } from "../../Button/Button";
import {
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  getOperatorOption,
} from "../../Dictionary/DictionaryFilterOperator";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "../../Dropdown/Dropdown";
import AutocompleteTextInput from "../../AutocompleteTextInput/AutocompleteTextInput";
import { ModelSchemaColumn } from "../ModelSchema";
import { columnTypeLabel, controlForColumn } from "./ColumnControl";
import { operatorLabelFor, operatorsForControl } from "./ColumnOperators";
import {
  ColumnValueMode,
  ModelColumnControl,
  ModelColumnRow,
} from "./ColumnRow";
import { rowIssue } from "./ColumnRowSerialization";
import ColumnValueInput from "./ColumnValueInput";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  row: ModelColumnRow;
  column: ModelSchemaColumn | undefined;
  /** Every column the model describes, for this row's own picker. */
  columns: Array<ModelSchemaColumn>;
  suggestions?: Array<string> | undefined;
  onChange: (row: ModelColumnRow) => void;
  onRemove: () => void;
}

const ColumnConditionRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const control: ModelColumnControl = controlForColumn(props.column);
  const operatorOption: DictionaryFilterOperatorOption = getOperatorOption(
    props.row.operator,
  );
  const issue: string | null = rowIssue(props.row, props.column);
  const isUnknownColumn: boolean = !props.column && props.row.columnId !== "";

  /*
   * The title alone is the label, with the column name carried in the option's
   * second line and repeated as a chip under the picker once it is chosen.
   * Putting both in the label - "Created At · createdAt" - is what a select
   * ellipsizes first, and the name is exactly the half that gets cut.
   */
  const columnOptions: Array<DropdownOption> = props.columns.map(
    (column: ModelSchemaColumn) => {
      return {
        value: column.id,
        label: column.title,
        description: `${column.id} · ${
          column.description || columnTypeLabel(column)
        }`,
      };
    },
  );

  /*
   * A stored condition can name a column this endpoint does not describe - the
   * runner accepts more names than the schema surfaces. Keep it in the list so
   * the row shows what it is filtering on rather than an empty picker.
   */
  if (
    isUnknownColumn &&
    !columnOptions.some((option: DropdownOption) => {
      return option.value === props.row.columnId;
    })
  ) {
    columnOptions.unshift({
      value: props.row.columnId,
      label: props.row.columnId,
      description: "Not a column on this model",
    });
  }

  const operatorOptions: Array<DropdownOption> = operatorsForControl(
    control,
    props.row.operator,
  ).map((operator: DictionaryFilterOperator) => {
    return {
      value: operator,
      label: operatorLabelFor(operator, control),
    };
  });

  /*
   * Proportional column widths rather than fixed ones. A picker showing
   * "Created At · createdAt" and a comparison reading "is on or before" both
   * outgrow any rem figure that also leaves room for the value, and the settings
   * panel is a different width on every screen. ModelQueryBuilder's header row
   * repeats this template and has to stay in step with it.
   */
  const rowGridClass: string =
    "group grid grid-cols-1 items-start gap-2 px-3 py-2.5 transition-colors hover:bg-gray-50/60 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.3fr)_auto]";

  return (
    <div className={rowGridClass} data-testid="model-column-row">
      <div className="min-w-0">
        {props.columns.length === 0 ? (
          <AutocompleteTextInput
            value={props.row.columnId}
            placeholder="Column name"
            outerDivClassName="relative w-full"
            disableSpellCheck={true}
            onChange={(value: string) => {
              props.onChange({ ...props.row, columnId: value });
            }}
          />
        ) : (
          <Dropdown
            options={columnOptions}
            placeholder="Column"
            className="relative w-full overflow-visible rounded-md"
            isMultiSelect={false}
            ariaLabel="Column"
            dataTestId={`model-column-picker-${props.row.columnId}`}
            value={columnOptions.find((option: DropdownOption) => {
              return option.value === props.row.columnId;
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              /*
               * The dropdown is always clearable and hands back null. The row
               * stays - a condition being retargeted is not a condition being
               * deleted - and an empty column is dropped on serialization.
               */
              props.onChange({
                ...props.row,
                columnId:
                  value === null || Array.isArray(value) ? "" : String(value),
              });
            }}
          />
        )}
        {isUnknownColumn ? (
          <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
            Not a column on this model
          </span>
        ) : (
          props.column && (
            <span className="mt-1 inline-block truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-500">
              {props.row.columnId}
            </span>
          )
        )}
      </div>

      <Dropdown
        options={operatorOptions}
        className="relative w-full overflow-visible rounded-md"
        isMultiSelect={false}
        ariaLabel="Comparison"
        dataTestId={`model-column-operator-${props.row.columnId}`}
        value={operatorOptions.find((option: DropdownOption) => {
          return option.value === props.row.operator;
        })}
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (value === null || Array.isArray(value)) {
            return;
          }

          const nextOperator: DictionaryFilterOperator =
            value as DictionaryFilterOperator;
          const nextOption: DictionaryFilterOperatorOption =
            getOperatorOption(nextOperator);

          /*
           * The value is cleared when the shape of the input changes, so a
           * scalar is never shipped where a list is expected, or the other way
           * round.
           */
          props.onChange({
            ...props.row,
            operator: nextOperator,
            text: nextOption.hidesValueInput ? "" : props.row.text,
            values: nextOption.expectsMultiValue ? props.row.values : [],
          });
        }}
      />

      <div className="min-w-0">
        <ColumnValueInput
          control={control}
          valueMode={props.row.valueMode}
          text={props.row.text}
          values={props.row.values}
          operatorOption={operatorOption}
          placeholder={props.column?.example || props.column?.placeholder}
          suggestions={props.suggestions}
          dataTestId={`model-column-value-${props.row.columnId}`}
          onTextChange={(text: string) => {
            props.onChange({ ...props.row, text: text });
          }}
          onValuesChange={(values: Array<string>) => {
            props.onChange({ ...props.row, values: values });
          }}
          onValueModeChange={(valueMode: ColumnValueMode) => {
            props.onChange({ ...props.row, valueMode: valueMode });
          }}
        />

        {props.row.valueMode === ColumnValueMode.Raw && (
          <p className="mt-1 text-[11px] text-amber-600">
            Kept exactly as it was saved.
          </p>
        )}

        {issue && <p className="mt-1 text-[11px] text-red-500">{issue}</p>}
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

export default ColumnConditionRow;
