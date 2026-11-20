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

/*
 * The tokens presented to OneUptime that #9012 left as written, each for its
 * reason: a token that proves nothing, or one whose use ends within a day.
 */
const NOT_A_CREDENTIAL: string =
  "not a credential: turning the notice on needs a signed-in member who may change it already; the token only proves a preview was asked for, and is cleared when it is used (#9012)";
const DELIVERY_REPORT_TOKEN: string =
  "lets Twilio report how one message was delivered, and nothing once the log holds its final status - within minutes; the logs are deleted after three days on OneUptime Cloud (#9012)";
const CONFIRMATION_LINK_TOKEN: string =
  "confirms one subscription, only for a day after its link is sent, and confirming only lets the page send to the contact that signed up (#9012)";

const NOT_ENCRYPTED_YET: Readonly<Record<string, string>> = {
  "OpenStackProjectNotice.previewToken": NOT_A_CREDENTIAL,
  "SmsLog.statusCallbackToken": DELIVERY_REPORT_TOKEN,
  "CallLog.statusCallbackToken": DELIVERY_REPORT_TOKEN,
  "StatusPageSubscriber.subscriptionConfirmationToken": CONFIRMATION_LINK_TOKEN,
  // Kept as their hash by StatusPagePrivateUserService, in a text column.
  "StatusPagePrivateUser.resetPasswordToken":
    "stored as the token's hash (StatusPagePrivateUserService), never as the token",
  "StatusPagePrivateUser.magicLinkToken":
    "stored as the token's hash (StatusPagePrivateUserService), never as the token",
  // A dashboard's private users' reset links (#10250), kept the same way.
  "DashboardPrivateUser.resetPasswordToken":
    "stored as the token's hash (PrivateUserServiceBase, DashboardPrivateUserAuthentication), never as the token",
  "FormPrivateUser.resetPasswordToken":
    "stored as the token's hash (PrivateUserServiceBase, FormPrivateUserAuthentication), never as the token",
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

/*
 * THE KEYS AND TOKENS PRESENTED TO ONEUPTIME (#9012): each is kept encrypted,
 * so the people who may read it see it again - or, a SCIM bearer token,
 * only as its hash - and one a request names its record by alone has a
 * lookup hash beside it, which nobody reads or writes through the API.
 */
describe("the keys presented to OneUptime, at rest", () => {
  const ENCRYPTED: Array<string> = [
    "Probe.key",
    "Runner.key",
    "AIAgent.key",
    "TelemetryIngestionKey.secretKey",
    "IoTDeviceCredential.secretKey",
    "Monitor.serverMonitorSecretKey",
    "Monitor.incomingRequestSecretKey",
    "Monitor.incomingEmailSecretKey",
    "Workflow.webhookSecretKey",
    "Workflow.incomingEmailSecretKey",
    "Runbook.webhookSecretKey",
    "StatusPage.embeddedOverallStatusToken",
    "DataProduct.badgeToken",
    "StatusPageSubscriber.unsubscribeToken",
  ];

  const HASHED: Array<string> = [
    "ProjectSCIM.bearerToken",
    "StatusPageSCIM.bearerToken",
  ];

  // A request presents the key alone: the record is found by its hash.
  const LOOKUP_HASHES: Record<string, string> = {
    "TelemetryIngestionKey.secretKey": "secretKeyHash",
    "Monitor.serverMonitorSecretKey": "serverMonitorSecretKeyHash",
    "Monitor.incomingRequestSecretKey": "incomingRequestSecretKeyHash",
    "Monitor.incomingEmailSecretKey": "incomingEmailSecretKeyHash",
    "Workflow.webhookSecretKey": "webhookSecretKeyHash",
    "Workflow.incomingEmailSecretKey": "incomingEmailSecretKeyHash",
  };

  interface PresentedKeyColumn {
    name: string;
    metadata: TableColumnMetadata;
    model: DatabaseBaseModel;
  }

  function presentedKeyColumns(): Array<PresentedKeyColumn> {
    const found: Array<PresentedKeyColumn> = [];

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        if (metadata?.presentedKey) {
          found.push({
            name: `${model.tableName}.${column}`,
            metadata: metadata,
            model: model,
          });
        }
      }
    }

    return found;
  }

  const presented: Array<PresentedKeyColumn> = presentedKeyColumns();

  test("are every key the issue listed that is protected, and no other", () => {
    expect(
      presented
        .map((column: PresentedKeyColumn): string => {
          return column.name;
        })
        .sort(),
    ).toEqual([...ENCRYPTED, ...HASHED].sort());
  });

  test("are encrypted - each but a SCIM bearer token, which is kept as its hash", () => {
    for (const column of presented) {
      expect({
        name: column.name,
        encrypted: Boolean(column.metadata.encrypted),
        hashed: column.metadata.type === TableColumnType.HashedString,
      }).toEqual({
        name: column.name,
        encrypted: ENCRYPTED.includes(column.name),
        hashed: HASHED.includes(column.name),
      });
    }
  });

  test("a key a request names its record by alone has its lookup hash, which nobody reads or writes", () => {
    for (const column of presented) {
      const lookupHashColumn: string | undefined =
        column.metadata.lookupHashColumn;

      expect({ name: column.name, lookupHashColumn: lookupHashColumn }).toEqual(
        {
          name: column.name,
          lookupHashColumn: LOOKUP_HASHES[column.name],
        },
      );

      if (!lookupHashColumn) {
        continue;
      }

      const hashMetadata: TableColumnMetadata =
        column.model.getTableColumnMetadata(lookupHashColumn);

      expect(hashMetadata.type).toBe(TableColumnType.HashedString);
      expect(hashMetadata.computed).toBe(true);
      expect(hashMetadata.hideColumnInDocumentation).toBe(true);
      expect(
        column.model.getColumnAccessControlForAllColumns()[lookupHashColumn],
      ).toEqual({ create: [], read: [], update: [] });
    }
  });

  test("a SCIM bearer token is read by nobody, master admins included", () => {
    for (const name of HASHED) {
      const column: PresentedKeyColumn | undefined = presented.find(
        (candidate: PresentedKeyColumn): boolean => {
          return candidate.name === name;
        },
      );

      expect(
        column!.model.getColumnAccessControlForAllColumns()["bearerToken"]!
          .read,
      ).toEqual([]);
    }
  });
});
