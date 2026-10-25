import { describe, expect, test } from "@jest/globals";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import ApiKey from "../../Models/DatabaseModels/ApiKey";
import AuditLogExport from "../../Models/DatabaseModels/AuditLogExport";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../Models/DatabaseModels/Monitor";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import {
  AUDIT_LOG_REDACTED_VALUE,
  getAuditLogRedactedColumns,
  redactAuditLogValue,
} from "../../Types/AuditLog/AuditLogRedaction";
import { getColumnAccessControlForAllColumns } from "../../Types/Database/AccessControl/ColumnAccessControl";

/*
 * NO AUDIT LOG ENTRY CARRIES A SECRET.
 *
 * The audit log is read by roles that may not read every field it records
 * (Read Audit Log, Settings Admin), and the Enterprise Edition exports it out
 * of OneUptime. So for every audited model, a column that looks like a
 * secret - stored encrypted or hashed, or named like a password, a token, a
 * key or a credential - must reach an entry either not at all (nobody may
 * read it: read [], or ignored) or as "[REDACTED]" (encrypted, hashed, or
 * listed in @EnableAuditLog({ redactColumns })).
 *
 * The sweep found six that reached entries with their values when the
 * audit log export was built: an API key's key, a monitor's three secret
 * keys and a status page's embed token and (hashed) master password.
 *
 * The columns below look like secrets by name and are not: each says why.
 */

type ModelType = { new (): BaseModel };

const SECRET_LOOKING_NAME: RegExp =
  /secret|password|token|apikey|privatekey|credential/i;

const NOT_SECRETS: Record<string, string> = {
  "ApiKeyCustomRole.apiKey":
    "the relation to the API key row: recorded as the row's id and name, never the key",
  "ApiKeyCustomRole.apiKeyId": "the API key row's id, not the key",
  "StatusPage.enableMasterPassword": "a switch",
  "VMwareVCenter.isVCenterPasswordSet":
    "a switch saying whether a password is set",
  "VMwareVCenter.vcenterCredentialsUpdatedAt":
    "when the credentials last changed",
};

interface SecretLookingColumn {
  name: string;
  isLeftOut: boolean;
  isRedacted: boolean;
}

function secretLookingColumns(): Array<SecretLookingColumn> {
  const found: Array<SecretLookingColumn> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: BaseModel = new modelType();

    if (!model.enableAuditLogOn) {
      continue;
    }

    const access: Record<string, { read?: Array<unknown> }> =
      getColumnAccessControlForAllColumns(model) as Record<
        string,
        { read?: Array<unknown> }
      >;
    const ignored: Array<string> = model.enableAuditLogOn.ignoreColumns || [];
    const redacted: Set<string> = getAuditLogRedactedColumns(model);
    const encryptedOrHashed: Array<string> = [
      ...model.getEncryptedColumns().columns,
      ...model.getHashedColumns().columns,
    ];

    for (const column of model.getTableColumns().columns) {
      if (
        !SECRET_LOOKING_NAME.test(column) &&
        !encryptedOrHashed.includes(column)
      ) {
        continue;
      }

      const read: Array<unknown> | undefined = access[column]?.read;

      found.push({
        name: `${model.tableName}.${column}`,
        isLeftOut:
          (Array.isArray(read) && read.length === 0) ||
          ignored.includes(column),
        isRedacted: redacted.has(column),
      });
    }
  }

  return found;
}

describe("audit log entries carry no secrets", () => {
  const columns: Array<SecretLookingColumn> = secretLookingColumns();

  test("the sweep reads the audited models (it is not vacuous)", () => {
    expect(columns.length).toBeGreaterThanOrEqual(10);
  });

  test("every secret-looking column of an audited model is left out or redacted", () => {
    const reaching: Array<string> = columns
      .filter((column: SecretLookingColumn): boolean => {
        return (
          !column.isLeftOut && !column.isRedacted && !NOT_SECRETS[column.name]
        );
      })
      .map((column: SecretLookingColumn): string => {
        return column.name;
      });

    expect(reaching).toEqual([]);
  });

  test("every column said not to be a secret still exists and still reaches entries", () => {
    for (const name of Object.keys(NOT_SECRETS)) {
      const column: SecretLookingColumn | undefined = columns.find(
        (candidate: SecretLookingColumn): boolean => {
          return candidate.name === name;
        },
      );

      expect([name, Boolean(column)]).toEqual([name, true]);
      expect([name, column!.isLeftOut || column!.isRedacted]).toEqual([
        name,
        false,
      ]);
      expect(NOT_SECRETS[name]!.length).toBeGreaterThan(5);
    }
  });

  test("the six secrets the sweep found are redacted", () => {
    expect(getAuditLogRedactedColumns(new ApiKey()).has("apiKey")).toBe(true);

    const monitor: Set<string> = getAuditLogRedactedColumns(new Monitor());

    expect(monitor.has("serverMonitorSecretKey")).toBe(true);
    expect(monitor.has("incomingRequestSecretKey")).toBe(true);
    expect(monitor.has("incomingEmailSecretKey")).toBe(true);

    const statusPage: Set<string> = getAuditLogRedactedColumns(
      new StatusPage(),
    );

    expect(statusPage.has("embeddedOverallStatusToken")).toBe(true);
    // Hashed, so redacted without being listed.
    expect(statusPage.has("masterPassword")).toBe(true);
  });

  test("an audit log export's own credentials never reach its audit entries", () => {
    const access: Record<string, { read?: Array<unknown> }> =
      getColumnAccessControlForAllColumns(new AuditLogExport()) as Record<
        string,
        { read?: Array<unknown> }
      >;

    expect(access["secrets"]?.read).toEqual([]);
    expect(
      getAuditLogRedactedColumns(new AuditLogExport()).has("secrets"),
    ).toBe(true);
  });

  test("a redacted value is the marker, and nothing stays nothing", () => {
    expect(AUDIT_LOG_REDACTED_VALUE).toBe("[REDACTED]");
    expect(redactAuditLogValue("c3d4e5f6-a7b8-9012-cdef-123456789012")).toBe(
      "[REDACTED]",
    );
    expect(redactAuditLogValue({ nested: "x" })).toBe("[REDACTED]");
    expect(redactAuditLogValue(null)).toBeNull();
    expect(redactAuditLogValue(undefined)).toBeNull();
  });
});
