import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import InstanceSamlSigningKey from "../../Models/DatabaseModels/InstanceSamlSigningKey";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import TableColumnType from "../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * InstanceSamlSigningKey holds the key pair the installation signs its SAML
 * sign-out messages with (#9603). Whoever reads its private key can sign a
 * sign-out request every identity provider that trusts OneUptime takes, so
 * what is pinned here is that nothing but the server itself, as root, can
 * reach it:
 *
 *   - it has no CRUD route, and no permission opens any operation on the
 *     table or on any column;
 *   - it is not offered as MCP tools, documented as an API, or a workflow
 *     trigger or step;
 *   - it holds exactly the private key - encrypted at rest - and the
 *     certificate, each long enough for a PEM.
 *
 * The certificate is public, and served by a route of its own.
 */

type ModelType = { new (): BaseModel };

const NO_ACCESS: ColumnAccessControl = { create: [], read: [], update: [] };

const BASE_COLUMNS: Array<string> = new BaseModel().getTableColumns().columns;

const model: InstanceSamlSigningKey = new InstanceSamlSigningKey();

function typeormColumn(propertyName: string): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (entry: ColumnMetadataArgs): boolean => {
        return (
          entry.target === InstanceSamlSigningKey &&
          entry.propertyName === propertyName
        );
      },
    );

  if (!column) {
    throw new Error(`InstanceSamlSigningKey.${propertyName} has no @Column`);
  }

  return column;
}

describe("InstanceSamlSigningKey", () => {
  test("is a registered model with a table of its own", () => {
    expect(model.tableName).toBe("InstanceSamlSigningKey");

    const owners: Array<string> = (AllModelTypes as Array<ModelType>)
      .filter((candidate: ModelType): boolean => {
        return new candidate().tableName === "InstanceSamlSigningKey";
      })
      .map((candidate: ModelType): string => {
        return candidate.name;
      });

    expect(owners).toEqual(["InstanceSamlSigningKey"]);
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
    expect(model.isMasterAdminApiDocs).toBeFalsy();
    expect(model.enableWorkflowOn).toBeFalsy();
    expect(model.requiresEnterprise).toBeFalsy();
  });

  test("streams no change to a realtime listener", () => {
    expect(model.enableRealtimeEventsOn).toBeFalsy();
  });

  test("belongs to no project or user", () => {
    expect(model.getTenantColumn()).toBeFalsy();
    expect(model.getUserColumn()).toBeFalsy();
  });

  test("holds exactly the private key and the certificate, both required, as long as a PEM needs", () => {
    expect(
      model.getTableColumns().columns.filter((column: string): boolean => {
        return !BASE_COLUMNS.includes(column);
      }),
    ).toEqual(["privateKey", "certificate"]);

    for (const column of ["privateKey", "certificate"]) {
      expect(model.getTableColumnMetadata(column).type).toBe(
        TableColumnType.VeryLongText,
      );
      expect(model.getTableColumnMetadata(column).required).toBe(true);
      expect(typeormColumn(column).options.nullable).toBe(false);
      expect(typeormColumn(column).options.type).toBe("text");
    }
  });

  test("keeps the private key encrypted at rest, and the public certificate as it is", () => {
    expect(model.getTableColumnMetadata("privateKey").encrypted).toBe(true);
    expect(model.getTableColumnMetadata("certificate").encrypted).toBeFalsy();
  });
});
