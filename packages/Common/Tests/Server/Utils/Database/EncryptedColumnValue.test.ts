import EncryptedColumnValue from "../../../../Server/Utils/Database/EncryptedColumnValue";
import Encryption from "../../../../Server/Utils/Encryption";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import URL from "../../../../Types/API/URL";
import {
  ENCRYPTED_VALUE_PREFIX,
  isEncryptedValue,
} from "../../../../Types/Database/EncryptedValue";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * ONE COLUMN KEPT ENCRYPTED AT REST, BY ITS SHAPE (#9013, #9014).
 *
 * A webhook's address is kept as a URL (TableColumnType.ShortURL/LongURL,
 * written and read through URL.getDatabaseTransformer), and a discovery
 * scan's SNMP credential sets as a JSON list of objects. DatabaseService
 * encrypted a JSON column's top-level values one by one and anything else
 * as a string, so neither could be encrypted: a URL would be taken apart
 * key by key, and each entry of a list handed to the cipher as an object.
 *
 * EncryptedColumnValue encrypts the text a URL column's transformer writes
 * and decrypts it before that transformer reads it, and the secret fields
 * inside each entry of a JSON list; the column's own transformer
 * (getEncryptedDatabaseTransformer) hands a ciphertext on untouched. A value
 * stored before its column was encrypted reads as it was.
 */

const SLACK_HOOK: string =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";

function urlColumn(
  type: TableColumnType = TableColumnType.LongURL,
): TableColumnMetadata {
  return { type: type, encrypted: true };
}

const SNMP_CONFIGS_COLUMN: TableColumnMetadata =
  new NetworkDeviceDiscoveryScan().getTableColumnMetadata("snmpConfigs");

const SNMP_V3_AUTH_COLUMN: TableColumnMetadata =
  new NetworkDevice().getTableColumnMetadata("snmpV3Auth");

const CONFIGS: Array<JSONObject> = [
  {
    id: "core",
    name: "Core switches",
    snmpVersion: "V3",
    snmpPort: 161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: "an auth passphrase",
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: "a privacy passphrase",
  },
  {
    id: "access",
    name: "Access switches",
    snmpVersion: "V2c",
    snmpCommunityString: "s3cr3t-community",
    snmpPort: 1161,
  },
  {
    id: "printers",
    snmpVersion: "V2c",
    snmpCommunityString: "",
  },
];

describe("a URL column", () => {
  test("stores the text its transformer writes, encrypted, and reads it back as the URL", async () => {
    for (const type of [TableColumnType.ShortURL, TableColumnType.LongURL]) {
      const stored: unknown = await EncryptedColumnValue.encrypt(
        urlColumn(type),
        URL.fromString(SLACK_HOOK),
      );

      expect(isEncryptedValue(stored)).toBe(true);
      expect(stored).not.toContain("hooks.slack.com");
      expect(await Encryption.decrypt(stored as string)).toBe(SLACK_HOOK);

      const read: unknown = await EncryptedColumnValue.decrypt(
        urlColumn(type),
        stored,
      );

      expect(read).toBeInstanceOf(URL);
      expect((read as URL).toString()).toBe(SLACK_HOOK);
      expect((read as URL).hostname.toString()).toBe("hooks.slack.com");
    }
  });

  test("takes an address given as text, held to the rule the transformer holds it to", async () => {
    const stored: unknown = await EncryptedColumnValue.encrypt(
      urlColumn(),
      SLACK_HOOK,
    );

    expect(await Encryption.decrypt(stored as string)).toBe(
      URL.fromString(SLACK_HOOK).toString(),
    );

    await expect(
      EncryptedColumnValue.encrypt(urlColumn(), "javascript:alert(1)"),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      EncryptedColumnValue.encrypt(
        urlColumn(),
        URL.fromStringLenient("https://tel:1234567890/"),
      ),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("hands a ciphertext on as it is: a value read as stored is never encrypted twice", async () => {
    const ciphertext: string = await Encryption.encrypt(SLACK_HOOK);

    expect(await EncryptedColumnValue.encrypt(urlColumn(), ciphertext)).toBe(
      ciphertext,
    );
  });

  test("an address stored before the column was encrypted reads as the URL the transformer made of it", async () => {
    const legacy: URL = URL.fromString(SLACK_HOOK);

    expect(await EncryptedColumnValue.decrypt(urlColumn(), legacy)).toBe(
      legacy,
    );
  });

  test("the column's transformer hands a ciphertext on, and reads and writes anything else as a URL column does", async () => {
    const transformer: ValueTransformer = URL.getEncryptedDatabaseTransformer();
    const plain: ValueTransformer = URL.getDatabaseTransformer();
    const ciphertext: string = await Encryption.encrypt(SLACK_HOOK);

    expect(transformer.to(ciphertext)).toBe(ciphertext);
    expect(transformer.from(ciphertext)).toBe(ciphertext);

    // Handed its own output, it hands it back (a query transformed twice).
    expect(transformer.to(transformer.to(ciphertext))).toBe(ciphertext);

    // Anything else: as URL.getDatabaseTransformer.
    expect(transformer.to(URL.fromString(SLACK_HOOK))).toBe(
      plain.to(URL.fromString(SLACK_HOOK)),
    );
    expect((transformer.from(SLACK_HOOK) as URL).toString()).toBe(
      (plain.from(SLACK_HOOK) as URL).toString(),
    );
    expect(transformer.to(undefined)).toBeUndefined();
    expect(transformer.to(null)).toBeNull();
    expect(transformer.from(null)).toBeNull();
  });

  test("the transformer of a column that is not encrypted still reads a ciphertext as an address: only an encrypted column hands one on", async () => {
    const ciphertext: string = await Encryption.encrypt(SLACK_HOOK);
    const read: unknown = URL.getDatabaseTransformer().from(ciphertext);

    expect(read).toBeInstanceOf(URL);
    expect(read).not.toBe(ciphertext);
  });
});

describe("a JSON list with encrypted fields (a scan's SNMP credential sets)", () => {
  test("encrypts the community string and v3 keys inside each entry, and leaves the rest as written", async () => {
    const stored: Array<JSONObject> = (await EncryptedColumnValue.encrypt(
      SNMP_CONFIGS_COLUMN,
      CONFIGS,
    )) as Array<JSONObject>;

    expect(stored).toHaveLength(3);

    expect(isEncryptedValue(stored[0]!["snmpV3AuthKey"])).toBe(true);
    expect(isEncryptedValue(stored[0]!["snmpV3PrivKey"])).toBe(true);
    expect(isEncryptedValue(stored[1]!["snmpCommunityString"])).toBe(true);

    // What says how a set authenticates, and which it is, stays readable.
    for (const field of [
      "id",
      "name",
      "snmpVersion",
      "snmpPort",
      "snmpV3SecurityLevel",
      "snmpV3Username",
      "snmpV3AuthProtocol",
      "snmpV3PrivProtocol",
    ]) {
      expect(stored[0]![field]).toEqual(CONFIGS[0]![field]);
    }

    // An empty credential stays empty, and a missing one missing.
    expect(stored[2]!["snmpCommunityString"]).toBe("");
    expect("snmpV3AuthKey" in stored[1]!).toBe(false);

    expect(JSON.stringify(stored)).not.toContain("s3cr3t-community");
    expect(JSON.stringify(stored)).not.toContain("passphrase");
  });

  test("reads back exactly the list written", async () => {
    const stored: unknown = await EncryptedColumnValue.encrypt(
      SNMP_CONFIGS_COLUMN,
      CONFIGS,
    );

    expect(
      await EncryptedColumnValue.decrypt(SNMP_CONFIGS_COLUMN, stored),
    ).toEqual(CONFIGS);
  });

  test("never changes the list it was given: a hook holding it still reads it as written", async () => {
    const given: Array<JSONObject> = JSON.parse(JSON.stringify(CONFIGS));

    await EncryptedColumnValue.encrypt(SNMP_CONFIGS_COLUMN, given);

    expect(given).toEqual(CONFIGS);
  });

  test("a list stored before the column was encrypted reads as written, and one half encrypted reads whole", async () => {
    expect(
      await EncryptedColumnValue.decrypt(SNMP_CONFIGS_COLUMN, CONFIGS),
    ).toEqual(CONFIGS);

    const half: Array<JSONObject> = JSON.parse(JSON.stringify(CONFIGS));
    half[1]!["snmpCommunityString"] =
      await Encryption.encrypt("s3cr3t-community");

    expect(
      await EncryptedColumnValue.decrypt(SNMP_CONFIGS_COLUMN, half),
    ).toEqual(CONFIGS);
  });

  test("a field encrypted already is not encrypted again", async () => {
    const once: unknown = await EncryptedColumnValue.encrypt(
      SNMP_CONFIGS_COLUMN,
      CONFIGS,
    );
    const twice: unknown = await EncryptedColumnValue.encrypt(
      SNMP_CONFIGS_COLUMN,
      once,
    );

    expect(twice).toEqual(once);
    expect(
      await EncryptedColumnValue.decrypt(SNMP_CONFIGS_COLUMN, twice),
    ).toEqual(CONFIGS);
  });

  test("an entry that is not an object, and a value that is not a list, are left as they are", async () => {
    const odd: Array<unknown> = ["text", 7, null, [1, 2], { snmpPort: 161 }];

    expect(
      await EncryptedColumnValue.encrypt(SNMP_CONFIGS_COLUMN, odd),
    ).toEqual(odd);
    expect(
      await EncryptedColumnValue.encrypt(SNMP_CONFIGS_COLUMN, "a string"),
    ).toBe("a string");
  });
});

describe("a JSON object with encrypted fields (a device's legacy snmpV3Auth)", () => {
  const V3_AUTH: JSONObject = {
    securityLevel: "authPriv",
    username: "monitoring",
    authProtocol: "SHA",
    authKey: "an auth passphrase",
    privProtocol: "AES",
    privKey: "a privacy passphrase",
  };

  test("keeps its keys encrypted and the rest as written, and reads back as written", async () => {
    const stored: JSONObject = (await EncryptedColumnValue.encrypt(
      SNMP_V3_AUTH_COLUMN,
      V3_AUTH,
    )) as JSONObject;

    expect(isEncryptedValue(stored["authKey"])).toBe(true);
    expect(isEncryptedValue(stored["privKey"])).toBe(true);
    expect(stored["username"]).toBe("monitoring");
    expect(stored["securityLevel"]).toBe("authPriv");

    expect(
      await EncryptedColumnValue.decrypt(SNMP_V3_AUTH_COLUMN, stored),
    ).toEqual(V3_AUTH);
  });
});

describe("the columns' declarations", () => {
  test("a scan's list and a device's legacy object name the secret fields of their entries", () => {
    expect(SNMP_CONFIGS_COLUMN.encrypted).toBe(true);
    expect([...(SNMP_CONFIGS_COLUMN.encryptedFields || [])].sort()).toEqual([
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
    ]);
    expect(SNMP_V3_AUTH_COLUMN.encrypted).toBe(true);
    expect([...(SNMP_V3_AUTH_COLUMN.encryptedFields || [])].sort()).toEqual([
      "authKey",
      "privKey",
    ]);
  });

  test("a status page subscriber's webhooks are URL columns kept encrypted", () => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();

    for (const column of [
      "subscriberWebhook",
      "slackIncomingWebhookUrl",
      "microsoftTeamsIncomingWebhookUrl",
    ]) {
      const metadata: TableColumnMetadata =
        subscriber.getTableColumnMetadata(column);

      expect({ column, encrypted: metadata.encrypted }).toEqual({
        column,
        encrypted: true,
      });
      expect(EncryptedColumnValue.getPropertyTransformer(metadata)).not.toBe(
        null,
      );
    }
  });
});

describe("text and other JSON, as before", () => {
  test("text is encrypted whole, and a value written before reads as itself", async () => {
    const column: TableColumnMetadata = {
      type: TableColumnType.VeryLongText,
      encrypted: true,
    };
    const stored: unknown = await EncryptedColumnValue.encrypt(
      column,
      "public",
    );

    expect((stored as string).startsWith(ENCRYPTED_VALUE_PREFIX)).toBe(true);
    expect(await EncryptedColumnValue.decrypt(column, stored)).toBe("public");
    expect(await EncryptedColumnValue.decrypt(column, "public")).toBe("public");
  });

  test("a ciphertext a broken write wrapped in a HashedString envelope reads as its value", async () => {
    const column: TableColumnMetadata = {
      type: TableColumnType.VeryLongText,
      encrypted: true,
    };
    const ciphertext: string = await Encryption.encrypt("a signing secret");

    expect(
      await EncryptedColumnValue.decrypt(
        column,
        JSON.stringify({ _type: "HashedString", value: ciphertext }),
      ),
    ).toBe("a signing secret");
  });

  test("a JSON map has each value encrypted, into a new map, and a list of text stays a list", async () => {
    const column: TableColumnMetadata = {
      type: TableColumnType.JSON,
      encrypted: true,
    };
    const map: JSONObject = { accessKey: "AKIA...", secretKey: "s3cr3t" };
    const stored: JSONObject = (await EncryptedColumnValue.encrypt(
      column,
      map,
    )) as JSONObject;

    expect(map).toEqual({ accessKey: "AKIA...", secretKey: "s3cr3t" });
    expect(isEncryptedValue(stored["secretKey"])).toBe(true);
    expect(await EncryptedColumnValue.decrypt(column, stored)).toEqual(map);

    const list: unknown = await EncryptedColumnValue.encrypt(column, [
      "one",
      "two",
    ]);

    expect(Array.isArray(list)).toBe(true);
    expect(await EncryptedColumnValue.decrypt(column, list)).toEqual([
      "one",
      "two",
    ]);
  });
});
