import DataSource from "../../../Models/DatabaseModels/DataSource";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * The entire mechanism keeping data source credentials out of API
 * responses is (a) `encrypted: true` so they're ciphertext at rest and
 * (b) `read: []` so the CRUD layer never serves the (auto-decrypted)
 * plaintext. Decryption happens automatically on every server-side find,
 * so a single permission added to a secret column's read list would leak
 * plaintext credentials to that role. These tests pin both properties.
 */

const SECRET_COLUMNS: Array<string> = ["password", "apiToken", "customHeaders"];

describe("DataSource model credential columns", () => {
  const model: DataSource = new DataSource();
  const accessControl: Record<string, ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  it("encrypts every secret column at rest", () => {
    const encryptedColumns: Array<string> = model.getEncryptedColumns().columns;

    for (const column of SECRET_COLUMNS) {
      expect(encryptedColumns).toContain(column);
    }
  });

  it("never exposes a secret column through the CRUD read path", () => {
    for (const column of SECRET_COLUMNS) {
      const columnAccessControl: ColumnAccessControl | undefined =
        accessControl[column];
      expect(columnAccessControl).toBeDefined();
      expect(columnAccessControl!.read).toEqual([]);
    }
  });

  it("keeps secret columns writable so users can set and rotate them", () => {
    for (const column of SECRET_COLUMNS) {
      const columnAccessControl: ColumnAccessControl | undefined =
        accessControl[column];
      expect(columnAccessControl!.create.length).toBeGreaterThan(0);
      expect(columnAccessControl!.update.length).toBeGreaterThan(0);
    }
  });

  it("keeps non-secret connection columns readable for the settings UI", () => {
    for (const column of [
      "name",
      "dataSourceType",
      "url",
      "databaseHost",
      "databasePort",
      "databaseName",
      "username",
    ]) {
      const columnAccessControl: ColumnAccessControl | undefined =
        accessControl[column];
      expect(columnAccessControl).toBeDefined();
      expect(columnAccessControl!.read).toContain(Permission.ReadDataSource);
    }
  });

  it("lets project viewers read the table so dashboards render for them", () => {
    const tableReadPermissions: Array<Permission> = model.getReadPermissions();
    expect(tableReadPermissions).toContain(Permission.Viewer);
    expect(tableReadPermissions).toContain(Permission.ProjectMember);
  });
});
