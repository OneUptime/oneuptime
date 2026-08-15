/*
 * The record body: every field this step writes, as a form.
 *
 * Fully controlled - the rows live in ModelColumnEditor, so what is on screen
 * and what is stored on the argument can never drift apart.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import Icon from "../../Icon/Icon";
import {
  ModelSchemaColumn,
  findColumn,
  requiredWritableColumns,
} from "../ModelSchema";
import AddColumnDropdown from "./AddColumnDropdown";
import { isOfferableColumn } from "./ColumnControl";
import ColumnFieldRow from "./ColumnFieldRow";
import { ModelColumnRow, makeColumnRow } from "./ColumnRow";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  rows: Array<ModelColumnRow>;
  columns: Array<ModelSchemaColumn>;
  suggestions?: Array<string> | undefined;
  onChange: (rows: Array<ModelColumnRow>) => void;
}

const ModelRecordForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const requiredColumnIds: Array<string> = requiredWritableColumns(
    props.columns,
  ).map((column: ModelSchemaColumn) => {
    return column.id;
  });

  const usedColumnIds: Array<string> = props.rows.map((row: ModelColumnRow) => {
    return row.columnId;
  });

  const offerableColumns: Array<ModelSchemaColumn> = props.columns.filter(
    (column: ModelSchemaColumn) => {
      return isOfferableColumn(column) && !usedColumnIds.includes(column.id);
    },
  );

  /*
   * Named so the builder is not left wondering where a column went. Relations
   * and blobs cannot be a single box, and saying which ones is kinder than
   * silently offering a shorter list than the model has.
   */
  const unofferableColumnTitles: Array<string> = props.columns
    .filter((column: ModelSchemaColumn) => {
      return !isOfferableColumn(column) && !column.isTenantColumn;
    })
    .map((column: ModelSchemaColumn) => {
      return column.title;
    });

  const knownColumnIds: Array<string> = props.columns.map(
    (column: ModelSchemaColumn) => {
      return column.id;
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
              icon={IconProp.Database}
              className="mx-auto h-6 w-6 text-gray-300"
            />
            <p className="mt-2 text-sm font-medium text-gray-700">
              No fields set yet
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Pick a field below to start building this record.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {props.rows.map((row: ModelColumnRow, index: number) => {
              return (
                <ColumnFieldRow
                  key={`${row.columnId}-${index}`}
                  row={row}
                  column={findColumn(props.columns, row.columnId)}
                  knownColumnIds={knownColumnIds}
                  isRequired={requiredColumnIds.includes(row.columnId)}
                  suggestions={props.suggestions}
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
        )}

        <div className="border-t border-gray-100 bg-gray-50/40 px-3 py-2.5">
          <AddColumnDropdown
            columns={offerableColumns}
            requiredColumnIds={requiredColumnIds}
            placeholder="Add a field..."
            allowCustomColumn={true}
            dataTestId="model-column-add"
            onAdd={(columnId: string) => {
              props.onChange([
                ...props.rows,
                makeColumnRow({ columnId: columnId }),
              ]);
            }}
          />
        </div>
      </div>

      {unofferableColumnTitles.length > 0 && (
        <p className="mt-1.5 text-xs text-gray-400">
          {unofferableColumnTitles.slice(0, 3).join(", ")}
          {unofferableColumnTitles.length > 3
            ? ` and ${unofferableColumnTitles.length - 3} other field${
                unofferableColumnTitles.length - 3 === 1 ? "" : "s"
              }`
            : ""}{" "}
          can only be set with Edit as JSON.
        </p>
      )}
    </div>
  );
};

export default ModelRecordForm;
