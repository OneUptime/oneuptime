/*
 * Concrete values for the help on a database step, read off the model itself.
 *
 * The help used to say "Create writes new records. The fields are this
 * model's own columns" - true of every one of the 227 models and specific to
 * none. These read a model's real columns, so Find One Incident's example
 * reads the incident's title and Create Many Monitors' example is a monitor
 * with a name and a monitor type, using the example values the models already
 * carry for the API reference.
 *
 * The column rules mirror the record editor's (ColumnUse.ts and the
 * /model-schema endpoint): a create example never sets a column OneUptime
 * fills in itself, the project, a relation, or one the model will not let a
 * create set.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getModelTypeByName } from "../../../Models/DatabaseModels/Index";
import { ColumnAccessControl } from "../../BaseDatabase/AccessControl";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../Database/TableColumn";
import TableColumnType from "../../Database/TableColumnType";
import Dictionary from "../../Dictionary";
import { JSONObject, JSONValue } from "../../JSON";
import { isSystemColumnId } from "../SystemColumns";

/** One column, as the help talks about it. */
export interface ExampleColumn {
  /** The key a record, a query or a reference uses: "title". */
  id: string;
  /** What the dialog calls it: "Title". */
  title: string;
  /** A value to show for it. */
  example: JSONValue;
}

/*
 * The column that says which record this is, in the order a person would
 * look for one. A model with none of these is referred to by its ID.
 */
const DISPLAY_COLUMN_IDS: Array<string> = ["name", "title", "subject", "email"];

// The ID every record has, used when a model has no better column.
export const ID_COLUMN_ID: string = "_id";

// The placeholder the database steps' own Query box shows.
export const EXAMPLE_ID: string = "00000000-0000-0000-0000-000000000000";

export type GetWorkflowModelFunction = (tableName: string) => BaseModel | null;

/** The model a database step reads or writes, from its table name. */
export const getWorkflowModel: GetWorkflowModelFunction = (
  tableName: string,
): BaseModel | null => {
  const modelType: { new (): BaseModel } | null = getModelTypeByName(tableName);

  return modelType ? new modelType() : null;
};

type IsRelationTypeFunction = (type: TableColumnType) => boolean;

const isRelationType: IsRelationTypeFunction = (
  type: TableColumnType,
): boolean => {
  return (
    type === TableColumnType.Entity || type === TableColumnType.EntityArray
  );
};

type ColumnSummary = {
  id: string;
  metadata: TableColumnMetadata;
  canCreate: boolean;
  canUpdate: boolean;
  isSystem: boolean;
  isTenant: boolean;
  hasDefault: boolean;
};

type DescribeColumnsFunction = (model: BaseModel) => Array<ColumnSummary>;

const describeColumns: DescribeColumnsFunction = (
  model: BaseModel,
): Array<ColumnSummary> => {
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const accessControl: Dictionary<ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();
  const tenantColumn: string | null = model.getTenantColumn();

  return Object.keys(columns).map((id: string): ColumnSummary => {
    const metadata: TableColumnMetadata = columns[id] as TableColumnMetadata;
    const acl: ColumnAccessControl | undefined = accessControl[id];

    return {
      id: id,
      metadata: metadata,
      canCreate: Boolean(acl && acl.create && acl.create.length > 0),
      canUpdate: Boolean(acl && acl.update && acl.update.length > 0),
      isSystem:
        isSystemColumnId(id) ||
        Boolean(metadata.computed) ||
        Boolean(metadata.forceGetDefaultValueOnCreate),
      /*
       * The project column and the relation that shares it. The runner stamps
       * both, so no example should suggest setting either.
       */
      isTenant:
        Boolean(tenantColumn) &&
        (id === tenantColumn ||
          metadata.manyToOneRelationColumn === tenantColumn),
      hasDefault:
        Boolean(metadata.isDefaultValueColumn) ||
        metadata.defaultValue !== undefined,
    };
  });
};

type PlaceholderForTypeFunction = (metadata: TableColumnMetadata) => JSONValue;

// A value of the right kind, for a column the model gives no example for.
const placeholderForType: PlaceholderForTypeFunction = (
  metadata: TableColumnMetadata,
): JSONValue => {
  switch (metadata.type) {
    case TableColumnType.Boolean:
      return true;
    case TableColumnType.Number:
    case TableColumnType.SmallNumber:
    case TableColumnType.BigNumber:
    case TableColumnType.PositiveNumber:
    case TableColumnType.SmallPositiveNumber:
    case TableColumnType.BigPositiveNumber:
    case TableColumnType.Port:
      return 1;
    case TableColumnType.ObjectID:
      return EXAMPLE_ID;
    case TableColumnType.Date:
      return "2026-01-01T00:00:00.000Z";
    case TableColumnType.Color:
      return "#2563eb";
    case TableColumnType.Email:
      return "someone@example.com";
    default:
      return metadata.title ? `Example ${metadata.title}` : "Example";
  }
};

type ExampleValueFunction = (metadata: TableColumnMetadata) => JSONValue;

/*
 * The model's own example where it is a plain value. Objects and lists are
 * left out: a monitor's steps or a JSON blob would swamp a one-line example.
 */
const exampleValue: ExampleValueFunction = (
  metadata: TableColumnMetadata,
): JSONValue => {
  const example: unknown = metadata.example;

  /*
   * An ID in an example stands for one to paste in. The models' own example
   * IDs are opaque - some are not even hexadecimal - so every ID column shows
   * the same obvious placeholder instead.
   */
  if (metadata.type === TableColumnType.ObjectID) {
    return EXAMPLE_ID;
  }

  if (
    typeof example === "string" ||
    typeof example === "number" ||
    typeof example === "boolean"
  ) {
    return example;
  }

  return placeholderForType(metadata);
};

type ToExampleColumnFunction = (column: ColumnSummary) => ExampleColumn;

const toExampleColumn: ToExampleColumnFunction = (
  column: ColumnSummary,
): ExampleColumn => {
  return {
    id: column.id,
    title: column.metadata.title || column.id,
    example: exampleValue(column.metadata),
  };
};

export type GetDisplayColumnFunction = (model: BaseModel) => ExampleColumn;

/**
 * The column that names a record - an incident's title, a monitor's name -
 * or its ID when the model has no such column.
 */
export const getDisplayColumn: GetDisplayColumnFunction = (
  model: BaseModel,
): ExampleColumn => {
  const columns: Array<ColumnSummary> = describeColumns(model);

  for (const id of DISPLAY_COLUMN_IDS) {
    const column: ColumnSummary | undefined = columns.find(
      (candidate: ColumnSummary): boolean => {
        return candidate.id === id && !isRelationType(candidate.metadata.type);
      },
    );

    if (column) {
      return toExampleColumn(column);
    }
  }

  return { id: ID_COLUMN_ID, title: "ID", example: EXAMPLE_ID };
};

export type GetRequiredCreateColumnsFunction = (
  model: BaseModel,
) => Array<ExampleColumn>;

/**
 * The columns a create must be given, by the server's own rule: required and
 * without a default, less what OneUptime fills in and what a create may not
 * set. The record editor opens with a row for each of these.
 */
export const getRequiredCreateColumns: GetRequiredCreateColumnsFunction = (
  model: BaseModel,
): Array<ExampleColumn> => {
  return describeColumns(model)
    .filter((column: ColumnSummary): boolean => {
      return (
        Boolean(column.metadata.required) &&
        !column.hasDefault &&
        !column.isSystem &&
        !column.isTenant &&
        !isRelationType(column.metadata.type) &&
        column.canCreate
      );
    })
    .map(toExampleColumn);
};

// At most this many fields in an example record: enough to see the shape.
const MAX_EXAMPLE_FIELDS: number = 3;

export type GetExampleRecordFunction = (model: BaseModel) => JSONObject;

/**
 * A record that a create would accept: the required fields, then the column
 * that names a record, with the model's example values.
 */
export const getExampleRecord: GetExampleRecordFunction = (
  model: BaseModel,
): JSONObject => {
  const record: JSONObject = {};
  const columns: Array<ColumnSummary> = describeColumns(model);
  const display: ExampleColumn = getDisplayColumn(model);
  const displayColumn: ColumnSummary | undefined = columns.find(
    (column: ColumnSummary): boolean => {
      return column.id === display.id;
    },
  );

  const fields: Array<ExampleColumn> = getRequiredCreateColumns(model);

  if (
    displayColumn &&
    displayColumn.canCreate &&
    !displayColumn.isSystem &&
    !fields.some((field: ExampleColumn): boolean => {
      return field.id === display.id;
    })
  ) {
    fields.unshift(display);
  }

  for (const field of fields.slice(0, MAX_EXAMPLE_FIELDS)) {
    record[field.id] = field.example;
  }

  return record;
};

export type GetExampleUpdateFunction = (model: BaseModel) => JSONObject;

/**
 * One field an update could change, with a new value. Not the field that
 * names a record where there is another choice: the query example matches on
 * that one, and an update that sets the field it matched on to the value it
 * matched reads as if it did nothing. So the first other field an update may
 * set that the model gives a plain example for, else the naming field, else
 * any field an update may set.
 */
export const getExampleUpdate: GetExampleUpdateFunction = (
  model: BaseModel,
): JSONObject => {
  const columns: Array<ColumnSummary> = describeColumns(model).filter(
    (column: ColumnSummary): boolean => {
      return (
        column.canUpdate &&
        !column.isSystem &&
        !column.isTenant &&
        !isRelationType(column.metadata.type)
      );
    },
  );

  const display: ExampleColumn = getDisplayColumn(model);
  const chosen: ColumnSummary | undefined =
    columns.find((column: ColumnSummary): boolean => {
      const example: unknown = column.metadata.example;

      return (
        column.id !== display.id &&
        column.metadata.type !== TableColumnType.ObjectID &&
        (typeof example === "string" ||
          typeof example === "number" ||
          typeof example === "boolean")
      );
    }) ||
    columns.find((column: ColumnSummary): boolean => {
      return column.id === display.id;
    }) ||
    columns[0];

  if (!chosen) {
    return {};
  }

  return { [chosen.id]: exampleValue(chosen.metadata) };
};
