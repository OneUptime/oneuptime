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
import AddColumnPicker from "./AddColumnPicker";
import { isOfferableColumn, jsonOnlyColumns } from "./ColumnControl";
import ColumnFieldRow from "./ColumnFieldRow";
import { ModelColumnRow, makeColumnRow } from "./ColumnRow";
import { ColumnUse } from "./ColumnUse";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  rows: Array<ModelColumnRow>;
  columns: Array<ModelSchemaColumn>;
  /*
   * Create or Update. It decides which fields are offered: a create offers
   * what may be set on a new record, an update what may be changed on one
   * that exists - and neither offers what OneUptime fills in itself.
   */
  use: ColumnUse.Create | ColumnUse.Update;
  onChange: (rows: Array<ModelColumnRow>) => void;
}

const ModelRecordForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * The row just added from the picker, so its value control can take focus.
   * Without it the picker's list closes and focus falls to the document body,
   * which for a keyboard user means starting again from the top of the panel.
   */
  const [justAddedKey, setJustAddedKey] = useState<string>("");

  /*
   * Only a create has required fields: an update writes whichever columns it
   * names and leaves the rest of the record as it was.
   */
  const requiredColumnIds: Array<string> =
    props.use === ColumnUse.Create
      ? requiredWritableColumns(props.columns).map(
          (column: ModelSchemaColumn) => {
            return column.id;
          },
        )
      : [];

  const usedColumnIds: Array<string> = props.rows.map((row: ModelColumnRow) => {
    return row.columnId;
  });

  const offerableColumns: Array<ModelSchemaColumn> = props.columns.filter(
    (column: ModelSchemaColumn) => {
      return (
        isOfferableColumn(column, props.use) &&
        !usedColumnIds.includes(column.id)
      );
    },
  );

  const unofferableColumnTitles: Array<string> = jsonOnlyColumns(
    props.columns,
    props.use,
  ).map((column: ModelSchemaColumn) => {
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
                  key={row.key}
                  row={row}
                  column={findColumn(props.columns, row.columnId)}
                  knownColumnIds={knownColumnIds}
                  isRequired={requiredColumnIds.includes(row.columnId)}
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
        )}

        <div className="border-t border-gray-100 bg-gray-50/40 px-3 py-2.5">
          <AddColumnPicker
            columns={offerableColumns}
            use={props.use}
            requiredColumnIds={requiredColumnIds}
            triggerLabel="Add a field"
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
