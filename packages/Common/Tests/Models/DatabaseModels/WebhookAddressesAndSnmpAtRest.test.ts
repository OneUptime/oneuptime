import AllModelTypes from "../../../Models/DatabaseModels/Index";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import WebhookLog from "../../../Models/DatabaseModels/WebhookLog";
import EncryptedColumnValue from "../../../Server/Utils/Database/EncryptedColumnValue";
import { getAuditLogRedactedColumns } from "../../../Types/AuditLog/AuditLogRedaction";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { ENCRYPTED_VALUE_PREFIX } from "../../../Types/Database/EncryptedValue";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import { ModelSchema } from "../../../Utils/Schema/ModelSchema";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * THE WEBHOOK ADDRESSES A PROJECT STORES (#9013) AND NETWORK DEVICES' AND
 * DISCOVERY SCANS' SNMP CREDENTIALS (#9014) ARE KEPT ENCRYPTED AT REST.
 *
 * A Slack, Microsoft Teams or Discord incoming webhook carries its secret
 * in its path, so whoever holds the address posts into the channel; a
 * community string or an SNMP v3 passphrase reads or changes a network
 * device. They were stored as written, so a backup or a database dump held
 * them in plain text. Each is `encrypted: true` now - DatabaseService
 * encrypts it on every write and decrypts it on every read - in a column a
 * ciphertext fits, never read through a relation, never carried by an audit
 * log entry, and read by whom it was read by before: only encryption at
 * rest changes. A URL column's transformer hands a ciphertext on untouched,
 * and a JSON list keeps its secrets encrypted inside each entry. All eight
 * SNMP columns are encrypted together, so no copy of a credential stays
 * as written beside its encrypted one.
 */

type ModelType = { new (): DatabaseBaseModel };

const TEAM_READS_SUBSCRIBERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.StatusPageAdmin,
  Permission.StatusPageMember,
  Permission.StatusPageViewer,
  Permission.ReadStatusPageSubscriber,
];

/*
 * Each list with its product's levels (#10289), which read what the roles
 * they follow read: OpenStack's Viewer reads a notice's webhook as Viewer
 * does, and Network's Viewer is kept from the SNMP keys as Viewer is.
 */
const OPENSTACK_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadOpenStackCloud,
  Permission.OpenStackAdmin,
  Permission.OpenStackMember,
  Permission.OpenStackViewer,
];

const DEVICE_SECRET_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.ReadNetworkDevice,
  Permission.NetworkAdmin,
  Permission.NetworkMember,
];

const SCAN_SECRET_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.ReadNetworkDeviceDiscoveryScan,
  Permission.NetworkAdmin,
  Permission.NetworkMember,
];

interface EncryptedColumn {
  name: string;
  modelType: ModelType;
  column: string;
  // Who reads it through the API, as before it was encrypted.
  readers: Array<Permission>;
  // The column's value is a URL, which its transformer writes as text.
  isUrl: boolean;
}

const COLUMNS: Array<EncryptedColumn> = [
  {
    name: "StatusPageSubscriber.subscriberWebhook",
    modelType: StatusPageSubscriber,
    column: "subscriberWebhook",
    readers: TEAM_READS_SUBSCRIBERS,
    isUrl: true,
  },
  {
    name: "StatusPageSubscriber.slackIncomingWebhookUrl",
    modelType: StatusPageSubscriber,
    column: "slackIncomingWebhookUrl",
    readers: [],
    isUrl: true,
  },
  {
    name: "StatusPageSubscriber.microsoftTeamsIncomingWebhookUrl",
    modelType: StatusPageSubscriber,
    column: "microsoftTeamsIncomingWebhookUrl",
    readers: [],
    isUrl: true,
  },
  {
    name: "UserWebhook.webhookUrl",
    modelType: UserWebhook,
    column: "webhookUrl",
    readers: [Permission.CurrentUser],
    isUrl: false,
  },
  {
    name: "OpenStackProjectNotice.webhookUrl",
    modelType: OpenStackProjectNotice,
    column: "webhookUrl",
    readers: OPENSTACK_READERS,
    isUrl: true,
  },
  {
    name: "OpenStackProjectNotice.previewedRecipient",
    modelType: OpenStackProjectNotice,
    column: "previewedRecipient",
    readers: [],
    isUrl: false,
  },
  {
    name: "CustomNotificationChannel.webhookUrl",
    modelType: CustomNotificationChannel,
    column: "webhookUrl",
    readers: [],
    isUrl: false,
  },
  {
    name: "CustomNotificationChannel.secret",
    modelType: CustomNotificationChannel,
    column: "secret",
    readers: [],
    isUrl: false,
  },
  ...["snmpCommunityString", "snmpV3AuthKey", "snmpV3PrivKey"].map(
    (column: string): EncryptedColumn => {
      return {
        name: `NetworkDevice.${column}`,
        modelType: NetworkDevice,
        column: column,
        readers: DEVICE_SECRET_READERS,
        isUrl: false,
      };
    },
  ),
  {
    name: "NetworkDevice.snmpV3Auth",
    modelType: NetworkDevice,
    column: "snmpV3Auth",
    /*
     * Narrowed to the readers of the keys it carries: Viewer and Settings
     * Viewer read the legacy object's authKey and privKey here, where the
     * device's own snmpV3AuthKey and snmpV3PrivKey were kept from them.
     */
    readers: DEVICE_SECRET_READERS,
    isUrl: false,
  },
  ...[
    "snmpConfigs",
    "snmpCommunityString",
    "snmpV3AuthKey",
    "snmpV3PrivKey",
  ].map((column: string): EncryptedColumn => {
    return {
      name: `NetworkDeviceDiscoveryScan.${column}`,
      modelType: NetworkDeviceDiscoveryScan,
      column: column,
      readers: SCAN_SECRET_READERS,
      isUrl: false,
    };
  }),
];

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

const A_CIPHERTEXT: string = `${ENCRYPTED_VALUE_PREFIX}+aCiphertextOfAnAddress/0123456789abcdef==`;

describe.each(COLUMNS)("$name", (encrypted: EncryptedColumn) => {
  const metadata: TableColumnMetadata =
    new encrypted.modelType().getTableColumnMetadata(encrypted.column);

  test("is kept encrypted at rest, and the API calls it a secret", () => {
    expect(metadata.encrypted).toBe(true);
    expect(ModelSchema.isSecretColumn(metadata)).toBe(true);
    expect(EncryptedColumnValue.isStorable(metadata)).toBe(true);
  });

  test("is stored in a text or JSON column, which a ciphertext fits", () => {
    const column: ColumnMetadataArgs | undefined = storedColumnOf(
      encrypted.modelType,
      encrypted.column,
    );

    expect(["text", "jsonb"]).toContain(column?.options.type);
    expect(column?.options.length).toBeUndefined();
    expect(Boolean(column?.options.unique)).toBe(false);
  });

  test("is never read through a relation, where a request could ask for it decrypted", () => {
    expect(Boolean(metadata.canReadOnRelationQuery)).toBe(false);
  });

  test("is read by whom it was read by before: only encryption at rest changes", () => {
    const access: ColumnAccessControl | null =
      new encrypted.modelType().getColumnAccessControlFor(encrypted.column);

    expect([...access!.read].sort()).toEqual([...encrypted.readers].sort());
  });

  test("an audit log entry never carries its value", () => {
    expect(
      getAuditLogRedactedColumns(new encrypted.modelType()).has(
        encrypted.column,
      ),
    ).toBe(true);
  });

  test("a URL's transformer hands a ciphertext on untouched, both ways", () => {
    const transformer: ValueTransformer | undefined = storedColumnOf(
      encrypted.modelType,
      encrypted.column,
    )?.options.transformer as ValueTransformer | undefined;

    if (!encrypted.isUrl) {
      expect(EncryptedColumnValue.getPropertyTransformer(metadata)).toBeNull();
      return;
    }

    expect(
      EncryptedColumnValue.getPropertyTransformer(metadata),
    ).not.toBeNull();
    expect(transformer!.to(A_CIPHERTEXT)).toBe(A_CIPHERTEXT);
    expect(transformer!.from(A_CIPHERTEXT)).toBe(A_CIPHERTEXT);
  });
});

describe("the SNMP credentials", () => {
  test("all eight are encrypted together, the devices' and the scans' they are copied from", () => {
    for (const [modelType, columns] of [
      [
        NetworkDevice,
        ["snmpCommunityString", "snmpV3Auth", "snmpV3AuthKey", "snmpV3PrivKey"],
      ],
      [
        NetworkDeviceDiscoveryScan,
        [
          "snmpConfigs",
          "snmpCommunityString",
          "snmpV3AuthKey",
          "snmpV3PrivKey",
        ],
      ],
    ] as Array<[ModelType, Array<string>]>) {
      expect([...new modelType().getEncryptedColumns().columns].sort()).toEqual(
        [...columns].sort(),
      );
    }
  });

  test("the JSON ones keep their secrets encrypted inside each entry, and the rest as written", () => {
    expect(
      new NetworkDeviceDiscoveryScan().getTableColumnMetadata("snmpConfigs")
        .encryptedFields,
    ).toEqual(["snmpCommunityString", "snmpV3AuthKey", "snmpV3PrivKey"]);
    expect(
      new NetworkDevice().getTableColumnMetadata("snmpV3Auth").encryptedFields,
    ).toEqual(["authKey", "privKey"]);
  });
});

describe("a webhook notification method's address", () => {
  test("is read by the member it belongs to alone, and the rule tables name it by its name", () => {
    const model: UserWebhook = new UserWebhook();

    expect(model.getColumnAccessControlFor("webhookUrl")!.read).toEqual([
      Permission.CurrentUser,
    ]);
    expect(model.getTableColumnMetadata("name").canReadOnRelationQuery).toBe(
      true,
    );
  });
});

describe("the webhook log", () => {
  test("keeps an address it masks, so it is no secret and needs no encryption", () => {
    const metadata: TableColumnMetadata =
      new WebhookLog().getTableColumnMetadata("webhookUrl");

    expect(Boolean(metadata.encrypted)).toBe(false);
    expect(metadata.description).toContain("scheme, host and port");
  });
});

describe("every encrypted column of every model", () => {
  test("is of a type DatabaseService can keep encrypted: text, JSON, a URL or an id", () => {
    const unstorable: Array<string> = [];

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();

      for (const column of model.getEncryptedColumns().columns) {
        if (
          !EncryptedColumnValue.isStorable(model.getTableColumnMetadata(column))
        ) {
          unstorable.push(`${model.tableName}.${column}`);
        }
      }
    }

    expect(unstorable).toEqual([]);
  });

  test("whose value a transformer writes is a URL whose transformer hands a ciphertext on, or an id read into one that holds it", () => {
    const misread: Array<string> = [];

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();

      for (const column of model.getEncryptedColumns().columns) {
        const transformer: ValueTransformer | undefined = storedColumnOf(
          modelType,
          column,
        )?.options.transformer as ValueTransformer | undefined;

        if (!transformer) {
          continue;
        }

        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);

        /*
         * A key presented to OneUptime kept in an id-typed column (#9012):
         * read into an ObjectID that holds the ciphertext as its text,
         * which a read decrypts (EncryptedColumnValue.decrypt).
         */
        if (metadata.type === TableColumnType.ObjectID) {
          const read: unknown = transformer.from(A_CIPHERTEXT);

          if (!(read instanceof ObjectID) || read.toString() !== A_CIPHERTEXT) {
            misread.push(`${model.tableName}.${column}`);
          }

          continue;
        }

        if (
          !EncryptedColumnValue.getPropertyTransformer(metadata) ||
          transformer.to(A_CIPHERTEXT) !== A_CIPHERTEXT ||
          transformer.from(A_CIPHERTEXT) !== A_CIPHERTEXT
        ) {
          misread.push(`${model.tableName}.${column}`);
        }
      }
    }

    expect(misread).toEqual([]);
  });
});
