import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import InstanceTokenSigningKey from "../../Models/DatabaseModels/InstanceTokenSigningKey";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import TableColumnType from "../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * InstanceTokenSigningKey holds the key an installation whose
 * ENCRYPTION_SECRET is unset or a shipped placeholder signs every token with.
 * Whoever reads it can sign in as anybody, so what is pinned here is that
 * nothing but the server itself, as root, can reach it:
 *
 *   - it has no CRUD route, and no permission opens any operation on the
 *     table or on any column;
 *   - it is not offered as MCP tools, documented as an API, or a workflow
 *     trigger or step;
 *   - it holds exactly one column of its own, long enough for a 64-character
 *     key, stored as written (encrypting it with a public key would hide
 *     nothing).
 */

type ModelType = { new (): BaseModel };

const NO_ACCESS: ColumnAccessControl = { create: [], read: [], update: [] };

const BASE_COLUMNS: Array<string> = new BaseModel().getTableColumns().columns;

const model: InstanceTokenSigningKey = new InstanceTokenSigningKey();

function typeormColumn(propertyName: string): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (entry: ColumnMetadataArgs): boolean => {
        return (
          entry.target === InstanceTokenSigningKey &&
          entry.propertyName === propertyName
        );
      },
    );

  if (!column) {
    throw new Error(`InstanceTokenSigningKey.${propertyName} has no @Column`);
  }

  return column;
}

describe("InstanceTokenSigningKey", () => {
  test("is a registered model with a table of its own", () => {
    expect(model.tableName).toBe("InstanceTokenSigningKey");

    const owners: Array<string> = (AllModelTypes as Array<ModelType>)
      .filter((candidate: ModelType): boolean => {
        return new candidate().tableName === "InstanceTokenSigningKey";
      })
      .map((candidate: ModelType): string => {
        return candidate.name;
      });

    expect(owners).toEqual(["InstanceTokenSigningKey"]);
  });

  test("has no CRUD route", () => {
    expect(model.getCrudApiPath()).toBeFalsy();
  });

  test("grants no permission any operation on the table", () => {
    expect(model.createRecordPermissions).toEqual([]);
    expect(model.readRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
  });

  test("denies every operation on every column", () => {
    const accessControl: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of model.getTableColumns().columns) {
      const control: ColumnAccessControl | undefined = accessControl[column];

      if (!control) {
        expect(column).toBe("version");
        continue;
      }

      expect({ column, control }).toEqual({ column, control: NO_ACCESS });
    }
  });

  test("is not offered as MCP tools, documented as an API, or used by workflows", () => {
    expect(model.enableMCP).toBeFalsy();
    expect(model.enableDocumentation).toBeFalsy();
    expect(model.enableWorkflowOn).toBeFalsy();
    expect(model.requiresEnterprise).toBeFalsy();
  });

  test("belongs to no project or user", () => {
    expect(model.getTenantColumn()).toBeFalsy();
    expect(model.getUserColumn()).toBeFalsy();
  });

  test("holds exactly the signing key, required, and long enough for 64 characters", () => {
    expect(
      model.getTableColumns().columns.filter((column: string): boolean => {
        return !BASE_COLUMNS.includes(column);
      }),
    ).toEqual(["signingKey"]);

    expect(model.getTableColumnMetadata("signingKey").type).toBe(
      TableColumnType.ShortText,
    );
    expect(model.getTableColumnMetadata("signingKey").required).toBe(true);
    expect(typeormColumn("signingKey").options.nullable).toBe(false);
    expect(
      Number(typeormColumn("signingKey").options.length),
    ).toBeGreaterThanOrEqual(64);
  });

  test("stores the key as written: encrypting it with a public key would hide nothing", () => {
    expect(model.getTableColumnMetadata("signingKey").encrypted).toBeFalsy();
    expect(model.getTableColumnMetadata("signingKey").type).not.toBe(
      TableColumnType.HashedString,
    );
  });
});
