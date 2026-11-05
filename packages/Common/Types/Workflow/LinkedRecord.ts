/*
 * A SETTING THAT HOLDS ONE OF THE PROJECT'S RECORDS BY ITS ID.
 *
 * https://github.com/OneUptime/oneuptime/issues/5943 - Create One Incident's
 * Incident Severity asked for a UUID. A value from an earlier step fits a box
 * like that; a severity someone simply wants to choose does not, and they had
 * to go and find its ID on another page.
 *
 * So a column that points at another record says which table that record is
 * in, and the builder lists that table's records by name - while the value
 * written stays the ID, exactly what the step sent before, and a value from an
 * earlier step can still take its place. This module decides which columns
 * those are and which tables can be listed at all. It reads only the models'
 * own metadata, so a new model gets it without anything here changing, and
 * the server, the builder and the tests share one answer:
 *
 *   - a column holding the ID of a related record: incidentSeverityId;
 *   - a list of related records: an incident's labels or monitors;
 *   - a record's own ID, which a query matches on.
 *
 * The record's project is never one of them. A step stays in the project its
 * workflow runs in, and the run stamps that itself (ModelArguments).
 */

import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata, getTableColumns } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";
import Dictionary from "../Dictionary";
import { ID_COLUMN_ID, getDisplayColumn } from "./Documentation/ModelExamples";

/*
 * The project's people. A person is not a row of the project - the User model
 * reads only one's own account - so they are listed the way every people
 * picker lists them, through the project's teams (PeoplePickerKinds).
 */
export const LINKED_USER_TABLE_NAME: string = "User";

export interface LinkedRecordColumn {
  // The table of the record the column points at.
  tableName: string;
  /*
   * What to call the setting where it is one of those records rather than an
   * ID: Incident Severity, for Incident Severity ID. Left out for a record's
   * own ID, which stays what it is called.
   */
  title?: string | undefined;
}

const linkableByTable: Map<string, boolean> = new Map<string, boolean>();

export type IsLinkableModelFunction = (model: BaseModel) => boolean;

/**
 * Whether a model's records can be listed for someone to pick one: they belong
 * to a project, the API lists them to somebody, and there is something to call
 * each one other than its ID. A file has no list; a status page's resource is
 * named by nothing of its own.
 */
export const isLinkableModel: IsLinkableModelFunction = (
  model: BaseModel,
): boolean => {
  const tableName: string = model.tableName || "";

  if (!tableName) {
    return false;
  }

  if (tableName === LINKED_USER_TABLE_NAME) {
    return true;
  }

  const cached: boolean | undefined = linkableByTable.get(tableName);

  if (cached !== undefined) {
    return cached;
  }

  const tenantColumn: string | null = model.getTenantColumn();

  const isLinkable: boolean =
    Boolean(tenantColumn) &&
    // A project is its own tenant: nothing in a project picks another one.
    tenantColumn !== ID_COLUMN_ID &&
    Boolean(model.getCrudApiPath()) &&
    model.getReadPermissions().length > 0 &&
    getDisplayColumn(model).id !== ID_COLUMN_ID;

  linkableByTable.set(tableName, isLinkable);

  return isLinkable;
};

type RelatedModelFunction = (column: TableColumnMetadata) => BaseModel | null;

const relatedModelOf: RelatedModelFunction = (
  column: TableColumnMetadata,
): BaseModel | null => {
  return column.modelType ? new column.modelType() : null;
};

export type GetLinkedRecordColumnFunction = (
  model: BaseModel,
  columnId: string,
) => LinkedRecordColumn | null;

/**
 * The record a column of a model points at, or null for a column that points
 * at none, or at one that cannot be listed.
 */
export const getLinkedRecordColumn: GetLinkedRecordColumnFunction = (
  model: BaseModel,
  columnId: string,
): LinkedRecordColumn | null => {
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const column: TableColumnMetadata | undefined = columns[columnId];

  if (!column) {
    return null;
  }

  const tenantColumn: string | null = model.getTenantColumn();

  if (columnId === tenantColumn) {
    return null;
  }

  if (column.manyToOneRelationColumn === tenantColumn && tenantColumn) {
    return null;
  }

  // A list of related records, written as a list of their IDs.
  if (column.type === TableColumnType.EntityArray) {
    const related: BaseModel | null = relatedModelOf(column);

    return related && isLinkableModel(related)
      ? { tableName: related.tableName as string, title: column.title }
      : null;
  }

  if (column.type !== TableColumnType.ObjectID) {
    return null;
  }

  // The record's own ID: a query picks a record by it.
  if (columnId === ID_COLUMN_ID) {
    return isLinkableModel(model)
      ? { tableName: model.tableName as string }
      : null;
  }

  // The relation this column holds the ID of.
  for (const relationId of Object.keys(columns)) {
    const relation: TableColumnMetadata | undefined = columns[relationId];

    if (
      !relation ||
      relation.type !== TableColumnType.Entity ||
      relation.manyToOneRelationColumn !== columnId
    ) {
      continue;
    }

    const related: BaseModel | null = relatedModelOf(relation);

    return related && isLinkableModel(related)
      ? { tableName: related.tableName as string, title: relation.title }
      : null;
  }

  return null;
};
