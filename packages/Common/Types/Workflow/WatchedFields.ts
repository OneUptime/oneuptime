/*
 * The columns an On Update trigger's Fields to watch (stored as "listen-on")
 * hears a change to.
 *
 * An update is reported with the columns it changed (DatabaseService's
 * getChangedColumns): a record's own columns, a relation to many records by
 * the relation's name ("labels"), and a relation to one record by the column
 * holding its ID ("currentIncidentStateId") - never by the relation itself.
 * The old field list offered "Current Incident State" in Listen on, and a
 * workflow watching it was never run: nothing ever reports the relation by
 * that name. So a relation to one record is heard as its ID column too, and
 * the field list stores the ID column for it (ModelFieldPicker).
 *
 * Pure: no server, no DOM.
 */

import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";

type GetWatchedColumnsFunction = (data: {
  // The stored Fields to watch: { columnName: true, ... }.
  listenOn: JSONObject;
  model: BaseModel;
}) => Array<string>;

/**
 * Every column whose change means one of the watched fields changed: each
 * key as written, and for a relation to one record, the column holding its
 * ID as well. Every key counts, as it always has, whatever it is set to.
 */
export const getWatchedColumns: GetWatchedColumnsFunction = (data: {
  listenOn: JSONObject;
  model: BaseModel;
}): Array<string> => {
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(data.model);
  const watched: Array<string> = [];

  for (const key of Object.keys(data.listenOn || {})) {
    if (!watched.includes(key)) {
      watched.push(key);
    }

    const column: TableColumnMetadata | undefined = columns[key];
    const idColumn: string | undefined = column?.manyToOneRelationColumn;

    if (
      column &&
      column.type === TableColumnType.Entity &&
      idColumn &&
      !watched.includes(idColumn)
    ) {
      watched.push(idColumn);
    }
  }

  return watched;
};
