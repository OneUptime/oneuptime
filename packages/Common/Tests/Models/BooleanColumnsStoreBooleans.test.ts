import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../Models/DatabaseModels/Index";
import ColumnType from "../../Types/Database/ColumnType";
import Dictionary from "../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";

/*
 * GUARD: EVERY SWITCH IS A POSTGRES BOOLEAN, AND EVERY POSTGRES BOOLEAN IS A
 * SWITCH.
 *
 * The API and DatabaseService turn a write's Boolean columns - the ones
 * @TableColumn calls TableColumnType.Boolean - into the JavaScript boolean
 * Postgres would store for them ("yes" is true, "off" is false), and refuse
 * a value it would refuse (Types/Database/BooleanColumnValue). That is only
 * what the database itself would have stored while each of those columns is
 * a plain `boolean` column with nothing in between:
 *
 *   - a Boolean column stored as text would keep "true" where it used to keep
 *     "yes" (File.isPublic was a varchar once: FileIsPublicBooleanMigration);
 *   - a transformer would be handed the boolean rather than what was sent;
 *   - a `boolean` column the metadata does not call Boolean would be left out
 *     of the coercion, its "false" read as text by every hook again.
 *
 * So every model is held to both directions here.
 */

interface BooleanColumn {
  table: string;
  column: string;
  databaseType: string;
  hasTransformer: boolean;
}

function columnArgsOf(
  modelType: DatabaseBaseModelType,
  propertyName: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs): boolean => {
      return (
        candidate.propertyName === propertyName &&
        typeof candidate.target === "function" &&
        (candidate.target === modelType ||
          modelType.prototype instanceof candidate.target)
      );
    })
    .pop();
}

function databaseTypeOf(args: ColumnMetadataArgs | undefined): string {
  if (!args) {
    return "(no @Column)";
  }

  const type: unknown = args.options.type;

  if (typeof type === "function") {
    return (type as { name?: string }).name || String(type);
  }

  return String(type);
}

function switchColumns(): Array<BooleanColumn> {
  const found: Array<BooleanColumn> = [];

  for (const modelType of Models as Array<DatabaseBaseModelType>) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const column of Object.keys(columns)) {
      if (columns[column]?.type !== TableColumnType.Boolean) {
        continue;
      }

      const args: ColumnMetadataArgs | undefined = columnArgsOf(
        modelType,
        column,
      );

      found.push({
        table: model.tableName || modelType.name,
        column,
        databaseType: databaseTypeOf(args),
        hasTransformer: Boolean(args?.options.transformer),
      });
    }
  }

  return found;
}

function databaseBooleanColumnsNotCalledSwitches(): Array<string> {
  const found: Array<string> = [];

  for (const modelType of Models as Array<DatabaseBaseModelType>) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const args of getMetadataArgsStorage().columns) {
      if (
        typeof args.target !== "function" ||
        !(
          args.target === modelType ||
          modelType.prototype instanceof args.target
        ) ||
        databaseTypeOf(args) !== ColumnType.Boolean
      ) {
        continue;
      }

      const metadata: TableColumnMetadata | undefined =
        columns[args.propertyName];

      if (metadata?.type !== TableColumnType.Boolean) {
        found.push(
          `${model.tableName || modelType.name}.${args.propertyName}: a boolean column @TableColumn calls ${
            metadata ? metadata.type : "nothing"
          }`,
        );
      }
    }
  }

  return found;
}

describe("GUARD: every switch is stored in a Postgres boolean column", () => {
  const columns: Array<BooleanColumn> = switchColumns();

  test("the check covers the models' switches", () => {
    expect(columns.length).toBeGreaterThan(600);
  });

  test("every Boolean column is a plain `boolean` column", () => {
    expect(
      columns
        .filter((column: BooleanColumn): boolean => {
          return column.databaseType !== ColumnType.Boolean;
        })
        .map((column: BooleanColumn): string => {
          return `${column.table}.${column.column} is stored as ${column.databaseType}`;
        }),
    ).toEqual([]);
  });

  test("none of them has a transformer between the write and the database", () => {
    expect(
      columns
        .filter((column: BooleanColumn): boolean => {
          return column.hasTransformer;
        })
        .map((column: BooleanColumn): string => {
          return `${column.table}.${column.column}`;
        }),
    ).toEqual([]);
  });

  test("and every boolean column is a Boolean column, so no switch is left out of the coercion", () => {
    expect(databaseBooleanColumnsNotCalledSwitches()).toEqual([]);
  });
});
