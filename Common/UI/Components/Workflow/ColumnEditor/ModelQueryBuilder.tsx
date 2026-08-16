/*
 * The query body: the conditions that decide which records a step acts on.
 *
 * Fully controlled, like the record form. One column header for the whole list
 * rather than a Key/Operator/Value label repeated above every row, which is
 * what made the old editor read as a spreadsheet.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import Icon from "../../Icon/Icon";
import { ModelSchemaColumn, findColumn } from "../ModelSchema";
import AddColumnDropdown from "./AddColumnDropdown";
import { isOfferableColumn } from "./ColumnControl";
import ColumnConditionRow from "./ColumnConditionRow";
import { ModelColumnRow, makeColumnRow } from "./ColumnRow";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  rows: Array<ModelColumnRow>;
  columns: Array<ModelSchemaColumn>;
  suggestions?: Array<string> | undefined;
  onChange: (rows: Array<ModelColumnRow>) => void;
}

const ModelQueryBuilder: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * The row just added from the picker, so its value control can take focus.
   * Without it the picker remounts to clear its own selection and focus falls
   * to the document body, which for a keyboard user means starting again from
   * the top of the panel.
   */
  const [justAddedKey, setJustAddedKey] = useState<string>("");

  const offerableColumns: Array<ModelSchemaColumn> = props.columns.filter(
    (column: ModelSchemaColumn) => {
      return isOfferableColumn(column);
    },
  );

  type ReplaceRowFunction = (index: number, row: ModelColumnRow) => void;

  const replaceRow: ReplaceRowFunction = (
    index: number,
    row: ModelColumnRow,
  ): void => {
    const next: Array<ModelColumnRow> = [...props.rows];
    next[index] = row;
    props.onChange(next);
  };

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
        {props.rows.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <Icon
              icon={IconProp.Filter}
              className="mx-auto h-6 w-6 text-gray-300"
            />
            <p className="mt-2 text-sm font-medium text-gray-700">
              No conditions yet
            </p>
            <p className="mt-1 text-xs text-gray-500">
              With no conditions this matches every record in the project.
            </p>
          </div>
        ) : (
          <>
            {/* Column widths must stay in step with ColumnConditionRow's grid. */}
            <div className="hidden border-b border-gray-100 bg-gray-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-400 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.3fr)_auto] sm:gap-2">
              <span>Column</span>
              <span>Comparison</span>
              <span>Value</span>
              <span className="w-8" />
            </div>
            <div className="divide-y divide-gray-100">
              {props.rows.map((row: ModelColumnRow, index: number) => {
                return (
                  <ColumnConditionRow
                    key={row.key}
                    row={row}
                    column={findColumn(props.columns, row.columnId)}
                    columns={offerableColumns}
                    suggestions={props.suggestions}
                    autoFocus={row.key === justAddedKey}
                    onChange={(nextRow: ModelColumnRow) => {
                      replaceRow(index, nextRow);
                    }}
                    onRemove={() => {
                      props.onChange(
                        props.rows.filter((_row: ModelColumnRow, i: number) => {
                          return i !== index;
                        }),
                      );
                    }}
                  />
                );
              })}
            </div>
          </>
        )}

        <div className="border-t border-gray-100 bg-gray-50/40 px-3 py-2.5">
          <AddColumnDropdown
            columns={offerableColumns.filter((column: ModelSchemaColumn) => {
              return !props.rows.some((row: ModelColumnRow) => {
                return row.columnId === column.id;
              });
            })}
            requiredColumnIds={[]}
            placeholder="Add a condition..."
            allowCustomColumn={true}
            dataTestId="model-column-add"
            onAdd={(columnId: string) => {
              const added: ModelColumnRow = makeColumnRow({
                columnId: columnId,
              });

              setJustAddedKey(added.key);
              props.onChange([...props.rows, added]);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default ModelQueryBuilder;
