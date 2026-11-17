import AllModelTypes from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY SECRET A PROJECT STORES IS KEPT ENCRYPTED OR HASHED AT REST, OR
 * SAYS WHY NOT.
 *
 * A backup or a dump of the database is a copy of every project's
 * credentials. A credential OneUptime uses to call out - a mail server's
 * password, a chat bot's token, a data source's or a cloud's credentials,
 * an LLM provider's key, an SSO client secret, a webhook signing secret -
 * is kept encrypted (`encrypted: true`: DatabaseService encrypts it on
 * write and decrypts it on read). One OneUptime only checks - a password,
 * an API key - is kept as its hash. The audit for #8989 found the SMTP
 * password and OAuth client secret, the Slack, Microsoft Teams and
 * Mattermost tokens, the code repositories' webhook secrets and the
 * webhook notification methods' signing secrets stored as written; they
 * are encrypted now (ProjectCredentialsAtRest). So are, since #9013 and
 * #9014, the webhook addresses a project stores and its network devices'
 * and discovery scans' SNMP credentials (WebhookAddressesAndSnmpAtRest).
 *
 * This holds every column of every project's table that the API calls a
 * secret (ModelSchema.isSecretColumn) to being encrypted, hashed, or
 * listed below with why it is not yet, and the issue that will change it.
 * A new secret column is encrypted or hashed, or goes here with its issue.
 */

type ModelType = { new (): DatabaseBaseModel };

// Presented to OneUptime, which checks it: stored hashed is its protection.
const CHECKED_NOT_USED: string =
  "presented to OneUptime, which checks it, often by looking the row up by its value: it is to be stored hashed, not encrypted (#9012)";

const NOT_ENCRYPTED_YET: Readonly<Record<string, string>> = {
  "Probe.key": CHECKED_NOT_USED,
  "Runner.key": CHECKED_NOT_USED,
  "AIAgent.key": CHECKED_NOT_USED,
  "TelemetryIngestionKey.secretKey": CHECKED_NOT_USED,
  "IoTDeviceCredential.secretKey": CHECKED_NOT_USED,
  "Monitor.serverMonitorSecretKey": CHECKED_NOT_USED,
  "Monitor.incomingRequestSecretKey": CHECKED_NOT_USED,
  "Monitor.incomingEmailSecretKey": CHECKED_NOT_USED,
  "Workflow.webhookSecretKey": CHECKED_NOT_USED,
  "Workflow.incomingEmailSecretKey": CHECKED_NOT_USED,
  "Runbook.webhookSecretKey": CHECKED_NOT_USED,
  "ProjectSCIM.bearerToken": CHECKED_NOT_USED,
  "StatusPageSCIM.bearerToken": CHECKED_NOT_USED,
  "StatusPage.embeddedOverallStatusToken": CHECKED_NOT_USED,
  "DataProduct.badgeToken": CHECKED_NOT_USED,
  "OpenStackProjectNotice.previewToken": CHECKED_NOT_USED,
  "SmsLog.statusCallbackToken": CHECKED_NOT_USED,
  "CallLog.statusCallbackToken": CHECKED_NOT_USED,
  "StatusPageSubscriber.subscriptionConfirmationToken": CHECKED_NOT_USED,
  "StatusPageSubscriber.unsubscribeToken": CHECKED_NOT_USED,
  // Kept as their hash by StatusPagePrivateUserService, in a text column.
  "StatusPagePrivateUser.resetPasswordToken":
    "stored as the token's hash (StatusPagePrivateUserService), never as the token",
  "StatusPagePrivateUser.magicLinkToken":
    "stored as the token's hash (StatusPagePrivateUserService), never as the token",
  "UserPush.deviceToken":
    "a device's push registration: it addresses the device through OneUptime's own push credentials, and signs in to nothing",
};

interface SecretColumn {
  name: string;
  isEncrypted: boolean;
  isHashed: boolean;
}

// Every secret column of a table a project's records are kept in.
function projectSecretColumns(): Array<SecretColumn> {
  const found: Array<SecretColumn> = [];

  for (const modelType of AllModelTypes as Array<ModelType>) {
    const model: DatabaseBaseModel = new modelType();

    if (model.getTenantColumn() !== "projectId") {
      continue;
    }

    for (const column of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      if (!metadata || !ModelSchema.isSecretColumn(metadata)) {
        continue;
      }

      found.push({
        name: `${model.tableName}.${column}`,
        isEncrypted: Boolean(metadata.encrypted),
        isHashed: metadata.type === TableColumnType.HashedString,
      });
    }
  }

  return found;
}

describe("a project's secrets at rest", () => {
  const columns: Array<SecretColumn> = projectSecretColumns();

  test("the sweep reads every project's table (it is not vacuous)", () => {
    expect(columns.length).toBeGreaterThanOrEqual(80);
    expect(
      columns.map((column: SecretColumn): string => {
        return column.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "ProjectSMTPConfig.password",
        "ProjectSMTPConfig.clientSecret",
        "WorkspaceProjectAuthToken.authToken",
        "WorkspaceUserAuthToken.authToken",
        "LlmProvider.apiKey",
        "ProjectOIDC.clientSecret",
        "ProjectCallSMSConfig.twilioAuthToken",
        "ApiKey.apiKey",
      ]),
    );
  });

  test("every secret a project stores is encrypted or hashed, or says why not and which issue changes it", () => {
    const storedAsWritten: Array<string> = columns
      .filter((column: SecretColumn): boolean => {
        return (
          !column.isEncrypted &&
          !column.isHashed &&
          !NOT_ENCRYPTED_YET[column.name]
        );
      })
      .map((column: SecretColumn): string => {
        return column.name;
      });

    expect(storedAsWritten).toEqual([]);
  });

  test("every column listed is still a secret stored as written: one encrypted or hashed since leaves the list", () => {
    for (const name of Object.keys(NOT_ENCRYPTED_YET)) {
      const column: SecretColumn | undefined = columns.find(
        (candidate: SecretColumn): boolean => {
          return candidate.name === name;
        },
      );

      expect({ name, isASecret: Boolean(column) }).toEqual({
        name,
        isASecret: true,
      });
      expect({
        name,
        isKeptAsWritten: !column!.isEncrypted && !column!.isHashed,
      }).toEqual({ name, isKeptAsWritten: true });
      expect(NOT_ENCRYPTED_YET[name]!.length).toBeGreaterThan(20);
    }
  });

  test("what #9013 and #9014 encrypted - webhook addresses, SNMP credentials - is not on the list", () => {
    for (const name of [
      "StatusPageSubscriber.subscriberWebhook",
      "StatusPageSubscriber.slackIncomingWebhookUrl",
      "StatusPageSubscriber.microsoftTeamsIncomingWebhookUrl",
      "OpenStackProjectNotice.webhookUrl",
      "UserWebhook.webhookUrl",
      "NetworkDevice.snmpCommunityString",
      "NetworkDevice.snmpV3Auth",
      "NetworkDevice.snmpV3AuthKey",
      "NetworkDevice.snmpV3PrivKey",
      "NetworkDeviceDiscoveryScan.snmpConfigs",
      "NetworkDeviceDiscoveryScan.snmpCommunityString",
      "NetworkDeviceDiscoveryScan.snmpV3AuthKey",
      "NetworkDeviceDiscoveryScan.snmpV3PrivKey",
    ]) {
      expect({ name, listed: Boolean(NOT_ENCRYPTED_YET[name]) }).toEqual({
        name,
        listed: false,
      });
      expect({
        name,
        isEncrypted: columns.find((column: SecretColumn): boolean => {
          return column.name === name;
        })?.isEncrypted,
      }).toEqual({ name, isEncrypted: true });
    }
  });

  test("what #8989 encrypted is not on the list", () => {
    for (const name of [
      "ProjectSMTPConfig.password",
      "ProjectSMTPConfig.clientSecret",
      "WorkspaceProjectAuthToken.authToken",
      "WorkspaceUserAuthToken.authToken",
      "CodeRepository.secretToken",
      "UserWebhook.secret",
    ]) {
      expect({ name, listed: Boolean(NOT_ENCRYPTED_YET[name]) }).toEqual({
        name,
        listed: false,
      });
      expect(
        columns.find((column: SecretColumn): boolean => {
          return column.name === name;
        })?.isEncrypted,
      ).toBe(true);
    }
  });
});
