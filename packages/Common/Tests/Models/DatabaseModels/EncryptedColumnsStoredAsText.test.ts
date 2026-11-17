import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * EVERY ENCRYPTED COLUMN IS STORED WHERE ITS CIPHERTEXT FITS (#9267).
 *
 * DatabaseService encrypts a column marked `encrypted: true` on every write,
 * and holds the value to its type's length as written, before it encrypts
 * it (assertFitsBeforeEncrypted): the length check after it leaves encrypted
 * columns out, as a ciphertext is longer than its value (a 500-character
 * value is about 700 stored). So a value that fits its type, in a column
 * of that length - a varchar(500) - would be refused by Postgres, in an
 * error that names no field. Every encrypted column is therefore stored
 * with no length at all: text, jsonb for JSON, or a varchar with no length
 * (which Postgres bounds no more than text). The limit a person meets is
 * the type's, on the value as written.
 */

type ModelType = { new (): DatabaseBaseModel };

// The storage types with no length of their own.
const UNBOUNDED_TYPES: ReadonlyArray<string> = ["text", "jsonb", "varchar"];

// The column as TypeORM creates it.
function storedColumnOf(
  modelType: ModelType,
  column: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs): boolean => {
      return (
        candidate.target === modelType && candidate.propertyName === column
      );
    })
    .pop();
}

describe("every encrypted column of every model", () => {
  test("has no length of its own, so a ciphertext of a value that fits its type fits it", () => {
    const tooNarrow: Array<string> = [];
    let checked: number = 0;

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();

      for (const column of model.getEncryptedColumns().columns) {
        const stored: ColumnMetadataArgs | undefined = storedColumnOf(
          modelType,
          column,
        );

        checked++;

        if (
          !stored ||
          !UNBOUNDED_TYPES.includes(String(stored.options.type)) ||
          stored.options.length !== undefined
        ) {
          tooNarrow.push(
            `${model.tableName}.${column} (${String(stored?.options.type)}${
              stored?.options.length ? `(${stored.options.length})` : ""
            })`,
          );
        }
      }
    }

    // The sweep reads every model's encrypted columns, not none.
    expect(checked).toBeGreaterThan(50);
    expect(tooNarrow).toEqual([]);
  });
});

describe("ProjectCallSMSConfig.twilioAuthToken", () => {
  const metadata: TableColumnMetadata =
    new ProjectCallSMSConfig().getTableColumnMetadata("twilioAuthToken");

  test("is kept encrypted, in a text column", () => {
    const stored: ColumnMetadataArgs | undefined = storedColumnOf(
      ProjectCallSMSConfig,
      "twilioAuthToken",
    );

    expect(metadata.encrypted).toBe(true);
    expect(stored?.options.type).toBe("text");
    expect(stored?.options.length).toBeUndefined();
    expect(stored?.options.nullable).toBe(true);
    expect(Boolean(stored?.options.unique)).toBe(false);
  });

  test("still takes a token of up to 500 characters as written, as its varchar did", () => {
    expect(getMaxLengthFromTableColumnType(metadata.type)).toBe(
      ColumnLength.LongText,
    );
    expect(ColumnLength.LongText).toBe(500);
  });
});
