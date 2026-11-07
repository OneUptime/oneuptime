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
import TableColumnType from "../../Types/Database/TableColumnType";

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
 * keys and a status page's embed token and (hashed) master password. When
 * every project-scoped model became audited (issue #6187,
 * Types/AuditLog/AuditLogCoverage) it found more: probes', runners' and AI
 * agents' keys, telemetry ingestion keys, a workflow's webhook and email
 * keys, SCIM bearer tokens, SMTP passwords, SNMP communities and keys, TLS
 * private keys of custom domains, a form's share key, and webhook addresses.
 *
 * A column whose type cannot hold a secret - a switch, a number, a date, a
 * reference to another row, an id - is not one, whatever it is called. The
 * columns below look like secrets by name, are of a type that could hold
 * one, and are not: each says why.
 */

type ModelType = { new (): BaseModel };

const SECRET_LOOKING_NAME: RegExp =
  /secret|password|passwd|passphrase|token|apikey|privatekey|privkey|authkey|credential|community|bearer|webhook|key$/i;

// Types whose values are never a secret.
const TYPES_THAT_HOLD_NO_SECRET: ReadonlySet<TableColumnType> =
  new Set<TableColumnType>([
    TableColumnType.Boolean,
    TableColumnType.Date,
    TableColumnType.Number,
    TableColumnType.SmallNumber,
    TableColumnType.BigNumber,
    TableColumnType.PositiveNumber,
    TableColumnType.SmallPositiveNumber,
    TableColumnType.BigPositiveNumber,
    TableColumnType.Entity,
    TableColumnType.EntityArray,
  ]);

const holdsNoSecretByType: (
  column: string,
  type: TableColumnType | undefined,
) => boolean = (column: string, type: TableColumnType | undefined): boolean => {
  if (type && TYPES_THAT_HOLD_NO_SECRET.has(type)) {
    return true;
  }

  // An id: another row's, not a key.
  return (
    type === TableColumnType.ObjectID &&
    (column.endsWith("Id") || column.endsWith("ID"))
  );
};

const NOT_SECRETS: Record<string, string> = {
  "AlertEpisode.groupingKey":
    "what the grouping rule grouped the episode's alerts by, worked out from their fields",
  "AlertMeasurement.key": "the name the measurement is charted under",
  "DataAsset.assetKey": "the table's name in its data store",
  "DataCheck.referenceTableKey": "the name of the table a check compares with",
  "DataSecurityIssue.issueKey":
    "what names the issue among a store's issues, worked out from the check and the store",
  "DataStore.storeKey": "what names the store among the project's stores",
  "DataStoreFinding.findingKey":
    "what names the finding among a store's findings, worked out from where it is",
  "IncidentEpisode.groupingKey":
    "what the grouping rule grouped the episode's incidents by, worked out from their fields",
  "IncidentMeasurement.key": "the name the measurement is charted under",
  "InventoryItem.entityKey":
    "what names the item among the project's inventory, as telemetry reports it",
  "InventoryItemRelationship.fromEntityKey":
    "the name of the item a relationship starts at",
  "InventoryItemRelationship.toEntityKey":
    "the name of the item a relationship ends at",
  "MetricPipelineRule.addAttributeKey":
    "the name of an attribute the rule adds",
  "MetricPipelineRule.renameFromKey":
    "the name of an attribute the rule renames",
  "MetricPipelineRule.renameToKey":
    "the new name of an attribute the rule renames",
  "NetworkTopologySuppression.nodeKey":
    "which node of the network map a suppression is for",
  "ScheduledMaintenanceMeasurement.key":
    "the name the measurement is charted under",
  "SecurityCase.groupingKey":
    "what the case's detections were grouped by, worked out from their fields",
  "SecurityEntityRisk.entityKey":
    "the entity a risk score is for (a user name, a host), as detections name it",
  "ApiKeyCustomRole.apiKey":
    "the relation to the API key row: recorded as the row's id and name, never the key",
  "ApiKeyCustomRole.apiKeyId": "the API key row's id, not the key",
  "StatusPage.enableMasterPassword": "a switch",
  "OpenStackCloud.isCredentialSet":
    "a switch saying whether a credential is saved",
  "OpenStackCloud.credentialsUpdatedAt": "when the credential last changed",
  "OpenStackCloud.credentialKind": "which of the two kinds of credential it is",
  "OpenStackCloud.applicationCredentialId":
    "what names the credential, as a user name does: the secret that goes with it is left out",
  "OpenStackCloudCheck.isCredentialSet":
    "a switch saying whether a credential is saved",
  "OpenStackCloudCheck.credentialsUpdatedAt":
    "when the credential last changed",
  "OpenStackCloudCheck.credentialKind":
    "which of the two kinds of credential it is",
  "OpenStackCloudCheck.applicationCredentialId":
    "what names the credential, as a user name does: the secret that goes with it is left out",
  "OpenStackCloudCheck.credentialProjectName":
    "the project the credential is scoped to, not the credential",
  "OpenStackCloudCheck.credentialProjectDomainName":
    "the domain of the project the credential is scoped to, not the credential",
  "VMwareVCenter.isVCenterPasswordSet":
    "a switch saying whether a password is set",
  "VMwareVCenter.vcenterCredentialsUpdatedAt":
    "when the credentials last changed",
};

interface SecretLookingColumn {
  name: string;
  isLeftOut: boolean;
  isRedacted: boolean;
  holdsNoSecretByType: boolean;
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
        holdsNoSecretByType: holdsNoSecretByType(
          column,
          model.getTableColumnMetadata(column)?.type,
        ),
      });
    }
  }

  return found;
}

describe("audit log entries carry no secrets", () => {
  const columns: Array<SecretLookingColumn> = secretLookingColumns();

  test("the sweep reads the audited models (it is not vacuous)", () => {
    expect(columns.length).toBeGreaterThanOrEqual(100);
  });

  test("every secret-looking column of an audited model is left out or redacted", () => {
    const reaching: Array<string> = columns
      .filter((column: SecretLookingColumn): boolean => {
        return (
          !column.isLeftOut &&
          !column.isRedacted &&
          !column.holdsNoSecretByType &&
          !NOT_SECRETS[column.name]
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

  test("the secrets found when every model became audited are recorded redacted or left out", () => {
    const secrets: Array<string> = [
      "Probe.key",
      "Runner.key",
      "AIAgent.key",
      "TelemetryIngestionKey.secretKey",
      "Workflow.webhookSecretKey",
      "Workflow.incomingEmailSecretKey",
      "ProjectSCIM.bearerToken",
      "StatusPageSCIM.bearerToken",
      "ProjectSMTPConfig.password",
      "ProjectSMTPConfig.clientSecret",
      "NetworkDevice.snmpCommunityString",
      "NetworkDevice.snmpV3AuthKey",
      "NetworkDevice.snmpV3PrivKey",
      "NetworkDeviceDiscoveryScan.snmpCommunityString",
      "NetworkDeviceDiscoveryScan.snmpV3AuthKey",
      "NetworkDeviceDiscoveryScan.snmpV3PrivKey",
      "StatusPageDomain.customCertificateKey",
      "DashboardDomain.customCertificateKey",
      "FormDomain.customCertificateKey",
      "Form.shareKey",
      "OpenStackProjectNotice.webhookUrl",
      "StatusPageSubscriber.subscriberWebhook",
      "IoTDeviceCredential.secretKey",
    ];

    for (const name of secrets) {
      const column: SecretLookingColumn | undefined = columns.find(
        (candidate: SecretLookingColumn): boolean => {
          return candidate.name === name;
        },
      );

      expect([name, Boolean(column)]).toEqual([name, true]);
      expect([name, column!.isLeftOut || column!.isRedacted]).toEqual([
        name,
        true,
      ]);
    }
  });

  test("a column of a type that cannot hold a secret is not one, whatever it is called", () => {
    expect(holdsNoSecretByType("isSecret", TableColumnType.Boolean)).toBe(true);
    expect(
      holdsNoSecretByType("oauthClientSecretExpiresAt", TableColumnType.Date),
    ).toBe(true);
    expect(
      holdsNoSecretByType("aiDailyTokenLimit", TableColumnType.Number),
    ).toBe(true);
    expect(holdsNoSecretByType("apiKey", TableColumnType.Entity)).toBe(true);
    expect(holdsNoSecretByType("apiKeyId", TableColumnType.ObjectID)).toBe(
      true,
    );
    // An ObjectID that is not an id is a key.
    expect(holdsNoSecretByType("secretKey", TableColumnType.ObjectID)).toBe(
      false,
    );
    expect(holdsNoSecretByType("bearerToken", TableColumnType.LongText)).toBe(
      false,
    );
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
