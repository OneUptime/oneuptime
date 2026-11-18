import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OpenStackProjectNoticeService from "Common/Server/Services/OpenStackProjectNoticeService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import DatabaseBaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OpenStackProjectNotice from "Common/Models/DatabaseModels/OpenStackProjectNotice";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import EncryptSnmpCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptSnmpCredentials";
import EncryptWebhookAddresses from "../../../FeatureSet/Workers/DataMigrations/EncryptWebhookAddresses";
import MaskWebhookAddressesInLogs from "../../../FeatureSet/Workers/DataMigrations/MaskWebhookAddressesInLogs";
import { ColumnToEncrypt } from "../../../FeatureSet/Workers/Utils/EncryptColumnInPlace";
import { encryptInPlaceADayLater } from "./Fixtures/CredentialsAtRestPass";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE DATA MIGRATIONS BEHIND #9013 AND #9014, with the repositories stubbed
 * so the real migrate() and the CredentialsAtRest:EncryptInPlace job's real
 * pass run without Postgres (on Postgres:
 * EncryptWebhookAddressesAndSnmpCredentialsPostgres,
 * CredentialsAtRestPostgres):
 *
 *   - EncryptWebhookAddresses names the webhook addresses stored as
 *     written - status page subscribers' Slack, Microsoft Teams and webhook
 *     addresses, webhook notification methods', OpenStack notices' and the
 *     copy each keeps of its previewed recipient, custom channels'
 *     addresses and signing secrets;
 *   - EncryptSnmpCredentials names network devices' and discovery scans'
 *     SNMP credentials, all eight columns, the JSON ones field by field in
 *     their own shape;
 *   - MaskWebhookAddressesInLogs masks the addresses the webhook log and
 *     the on-call log kept.
 *
 * The first two change nothing at the upgrade (#9266), so a server of the
 * release before posts to every address and polls every device as it did;
 * a day later the job's pass encrypts each value still stored as written.
 * Each is registered once, before the last slot; the pass encrypts exactly
 * the columns its models declare encrypted; each write is held to the
 * value read; a second pass rewrites nothing; a table that cannot be read,
 * or a row that cannot be written, costs the others nothing; and no log
 * line carries a value.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;
const SELECT_START: RegExp = /^\s*SELECT/i;
const UPDATE_START: RegExp = /^\s*UPDATE/i;

const SLACK_HOOK: string =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
const TEAMS_HOOK: string =
  "https://example.webhook.office.com/webhookb2/00000000-0000-0000-0000-000000000000@0000/IncomingWebhook/abcdef/0000";
const SUBSCRIBER_HOOK: string = "https://hooks.example.com/status?token=s3cr3t";
const METHOD_HOOK: string = "https://discord.com/api/webhooks/123/abcdefSECRET";
const NOTICE_HOOK: string = "https://notices.example.com/openstack/s3cr3t-path";
const CHANNEL_HOOK: string = "https://pager.example.internal/oneuptime";
const CHANNEL_SECRET: string = "a".repeat(64);
const COMMUNITY: string = "s3cr3t-community";
const AUTH_KEY: string = "an auth passphrase";
const PRIV_KEY: string = "a privacy passphrase";

type StoredRow = Record<string, unknown>;

interface QueryCall {
  table: string;
  sql: string;
  params: Array<unknown> | undefined;
}

interface TableStub {
  rows: Array<StoredRow>;
  failRead?: boolean;
  failUpdateForId?: string;
}

type TableName =
  | "StatusPageSubscriber"
  | "UserWebhook"
  | "OpenStackProjectNotice"
  | "CustomNotificationChannel"
  | "NetworkDevice"
  | "NetworkDeviceDiscoveryScan"
  | "WebhookLog"
  | "UserOnCallLogTimeline";

const SERVICES: Record<TableName, { getRepository: () => unknown }> = {
  StatusPageSubscriber: StatusPageSubscriberService,
  UserWebhook: UserWebhookService,
  OpenStackProjectNotice: OpenStackProjectNoticeService,
  CustomNotificationChannel: CustomNotificationChannelService,
  NetworkDevice: NetworkDeviceService,
  NetworkDeviceDiscoveryScan: NetworkDeviceDiscoveryScanService,
  WebhookLog: WebhookLogService,
  UserOnCallLogTimeline: UserOnCallLogTimelineService,
};

// The column a page reads: `SELECT "_id", "<column>"...`.
function columnRead(sql: string): string {
  return sql.match(/SELECT "_id", "([A-Za-z0-9]+)"/)![1]!;
}

function afterIdOf(sql: string, params: Array<unknown>): string | null {
  if (!sql.includes(`"_id" >`)) {
    return null;
  }

  return String(params[params.length - 1]);
}

// Each table answered as Postgres answers the statements the migrations send.
function stubTables(tables: Partial<Record<TableName, TableStub>>): {
  calls: Array<QueryCall>;
  stubs: Record<TableName, TableStub>;
} {
  const calls: Array<QueryCall> = [];
  const stubs: Record<TableName, TableStub> = {} as Record<
    TableName,
    TableStub
  >;

  for (const table of Object.keys(SERVICES) as Array<TableName>) {
    const stub: TableStub = tables[table] || { rows: [] };
    stubs[table] = stub;

    const repository: unknown = {
      metadata: { tableName: table },
      manager: {
        query: async (
          sql: string,
          params: Array<unknown> = [],
        ): Promise<unknown> => {
          calls.push({ table, sql, params });

          if (SELECT_START.test(sql)) {
            if (stub.failRead) {
              throw new Error("read failed");
            }

            const column: string = columnRead(sql);
            const afterId: string | null = afterIdOf(sql, params);
            const isTextPage: boolean = sql.includes("NOT LIKE $1");

            return stub.rows
              .filter((row: StoredRow): boolean => {
                const value: unknown = row[column];

                if (afterId !== null && String(row["_id"]) <= afterId) {
                  return false;
                }

                if (isTextPage) {
                  return (
                    typeof value === "string" &&
                    value !== "" &&
                    !Encryption.looksEncrypted(value)
                  );
                }

                return value !== null && value !== undefined;
              })
              .sort((a: StoredRow, b: StoredRow): number => {
                return String(a["_id"]) < String(b["_id"]) ? -1 : 1;
              })
              .map((row: StoredRow): StoredRow => {
                return JSON.parse(JSON.stringify(row));
              });
          }

          if (UPDATE_START.test(sql)) {
            if (
              stub.failUpdateForId &&
              params.some((param: unknown): boolean => {
                return (
                  param === stub.failUpdateForId ||
                  (Array.isArray(param) && param.includes(stub.failUpdateForId))
                );
              })
            ) {
              // As TypeORM's QueryFailedError carries the query's parameters.
              const error: Error & { parameters?: Array<unknown> } = new Error(
                `write failed for ${JSON.stringify(params)}`,
              );
              error.parameters = params;
              throw error;
            }

            applyUpdate(stub, sql, params);
          }

          return [];
        },
      },
    };

    jest
      .spyOn(SERVICES[table], "getRepository")
      .mockReturnValue(repository as never);
  }

  return { calls, stubs };
}

// What an UPDATE the migrations send does to the rows, as Postgres does it.
function applyUpdate(
  stub: TableStub,
  sql: string,
  params: Array<unknown>,
): void {
  const textUpdate: RegExpMatchArray | null = sql.match(
    /^UPDATE "\w+" SET "(\w+)" = \$1 WHERE "_id" = \$2 AND "\1" = \$3$/,
  );

  if (textUpdate) {
    const column: string = textUpdate[1]!;

    for (const row of stub.rows) {
      if (String(row["_id"]) === params[1] && row[column] === params[2]) {
        row[column] = params[0];
      }
    }

    return;
  }

  const jsonUpdate: RegExpMatchArray | null = sql.match(
    /^UPDATE "\w+" SET "(\w+)" = \$1::jsonb WHERE "_id" = \$2 AND "\1" = \$3::jsonb$/,
  );

  if (jsonUpdate) {
    const column: string = jsonUpdate[1]!;

    for (const row of stub.rows) {
      if (
        String(row["_id"]) === params[1] &&
        JSON.stringify(row[column]) === params[2]
      ) {
        row[column] = JSON.parse(String(params[0]));
      }
    }

    return;
  }

  if (sql.includes(`UPDATE "WebhookLog"`)) {
    const [ids, urls, messages, wasUrls, wasMessages] = params as Array<
      Array<string | null>
    >;

    ids!.forEach((id: string | null, index: number): void => {
      for (const row of stub.rows) {
        if (
          String(row["_id"]) === id &&
          row["webhookUrl"] === wasUrls![index] &&
          (row["statusMessage"] ?? null) === wasMessages![index]
        ) {
          row["webhookUrl"] = urls![index];
          row["statusMessage"] = messages![index];
        }
      }
    });

    return;
  }

  if (sql.includes(`UPDATE "UserOnCallLogTimeline"`)) {
    for (const row of stub.rows) {
      if (new RegExp(String(params[1])).test(String(row["statusMessage"]))) {
        row["statusMessage"] = params[0];
      }
    }

    return;
  }

  throw new Error(`an unexpected statement: ${sql}`);
}

function updateCalls(calls: Array<QueryCall>): Array<QueryCall> {
  return calls.filter((call: QueryCall): boolean => {
    return UPDATE_START.test(call.sql);
  });
}

function registeredMigrations(): Array<string> {
  const index: string = fs.readFileSync(
    path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  return Array.from(index.matchAll(NEW_MIGRATION_CALL)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function targetNames(targets: Array<ColumnToEncrypt>): Array<string> {
  return targets.map((target: ColumnToEncrypt): string => {
    return `${(target.repository as unknown as { metadata: { tableName: string } }).metadata.tableName}.${target.column}`;
  });
}

// Every log line written, as one text.
function everythingLogged(): string {
  return [logger.error, logger.info, logger.debug, logger.warn]
    .flatMap((spy: unknown): Array<unknown> => {
      return (spy as jest.Mock).mock.calls.flat();
    })
    .map((value: unknown): string => {
      return typeof value === "string" ? value : JSON.stringify(value);
    })
    .join("\n");
}

const SNMP_CONFIGS: Array<JSONObject> = [
  {
    id: "access",
    name: "Access switches",
    snmpVersion: "V2c",
    snmpCommunityString: COMMUNITY,
    snmpPort: 161,
  },
  {
    id: "core",
    snmpVersion: "V3",
    snmpV3Username: "monitoring",
    snmpV3AuthKey: AUTH_KEY,
    snmpV3PrivKey: PRIV_KEY,
  },
];

const V3_AUTH: JSONObject = {
  securityLevel: "authPriv",
  username: "monitoring",
  authProtocol: "SHA",
  authKey: AUTH_KEY,
  privProtocol: "AES",
  privKey: PRIV_KEY,
};

function webhookTablesAsWritten(): Partial<Record<TableName, TableStub>> {
  return {
    StatusPageSubscriber: {
      rows: [
        { _id: "a-slack", slackIncomingWebhookUrl: SLACK_HOOK },
        { _id: "b-teams", microsoftTeamsIncomingWebhookUrl: TEAMS_HOOK },
        { _id: "c-webhook", subscriberWebhook: SUBSCRIBER_HOOK },
        { _id: "d-email", subscriberWebhook: null },
      ],
    },
    UserWebhook: {
      rows: [{ _id: "method", webhookUrl: METHOD_HOOK }],
    },
    OpenStackProjectNotice: {
      rows: [
        {
          _id: "notice",
          webhookUrl: NOTICE_HOOK,
          previewedRecipient: `webhook:${NOTICE_HOOK}`,
        },
      ],
    },
    CustomNotificationChannel: {
      rows: [
        { _id: "channel", webhookUrl: CHANNEL_HOOK, secret: CHANNEL_SECRET },
      ],
    },
  };
}

function snmpTablesAsWritten(): Partial<Record<TableName, TableStub>> {
  return {
    NetworkDevice: {
      rows: [
        { _id: "a-v2c", snmpCommunityString: COMMUNITY },
        {
          _id: "b-v3",
          snmpV3AuthKey: AUTH_KEY,
          snmpV3PrivKey: PRIV_KEY,
        },
        { _id: "c-legacy", snmpV3Auth: JSON.parse(JSON.stringify(V3_AUTH)) },
        { _id: "d-ping", snmpCommunityString: "" },
      ],
    },
    NetworkDeviceDiscoveryScan: {
      rows: [
        {
          _id: "scan",
          snmpConfigs: JSON.parse(JSON.stringify(SNMP_CONFIGS)),
          snmpCommunityString: COMMUNITY,
        },
        { _id: "scan-icmp", snmpConfigs: null },
      ],
    },
  };
}

beforeEach(() => {
  jest.spyOn(logger, "info").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("registering them", () => {
  test("each is registered once, after #8989's credentials and before the last slot", () => {
    const registered: Array<string> = registeredMigrations();

    for (const name of [
      "EncryptWebhookAddresses",
      "EncryptSnmpCredentials",
      "MaskWebhookAddressesInLogs",
    ]) {
      expect(
        registered.filter((candidate: string): boolean => {
          return candidate === name;
        }),
      ).toHaveLength(1);
      expect(registered.indexOf(name)).toBeGreaterThan(
        registered.indexOf("EncryptProjectCredentials"),
      );
      expect(registered.indexOf(name)).toBeLessThan(registered.length - 1);
    }

    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("each has the name it is recorded under", () => {
    expect(new EncryptWebhookAddresses().name).toBe("EncryptWebhookAddresses");
    expect(new EncryptSnmpCredentials().name).toBe("EncryptSnmpCredentials");
    expect(new MaskWebhookAddressesInLogs().name).toBe(
      "MaskWebhookAddressesInLogs",
    );
  });

  test("the upgrade's runs of the two that encrypt change nothing: a server of the release before reads every address and credential as written", async () => {
    const { calls } = stubTables({
      ...webhookTablesAsWritten(),
      ...snmpTablesAsWritten(),
    });

    await new EncryptWebhookAddresses().migrate();
    await new EncryptSnmpCredentials().migrate();

    expect(calls).toEqual([]);
  });

  test("rollback changes nothing", async () => {
    const { calls } = stubTables({});

    await new EncryptWebhookAddresses().rollback();
    await new EncryptSnmpCredentials().rollback();
    await new MaskWebhookAddressesInLogs().rollback();

    expect(calls).toEqual([]);
  });
});

describe("EncryptWebhookAddresses", () => {
  test("encrypts every column its models declare encrypted for #9013, and nothing else", () => {
    stubTables({});

    expect(targetNames(EncryptWebhookAddresses.getTargets())).toEqual([
      "StatusPageSubscriber.slackIncomingWebhookUrl",
      "StatusPageSubscriber.microsoftTeamsIncomingWebhookUrl",
      "StatusPageSubscriber.subscriberWebhook",
      "UserWebhook.webhookUrl",
      "OpenStackProjectNotice.webhookUrl",
      "OpenStackProjectNotice.previewedRecipient",
      "CustomNotificationChannel.webhookUrl",
      "CustomNotificationChannel.secret",
    ]);

    const declared: Array<string> = (
      [
        new StatusPageSubscriber(),
        new OpenStackProjectNotice(),
        new CustomNotificationChannel(),
      ] as Array<DatabaseBaseModel>
    )
      .flatMap((model: DatabaseBaseModel): Array<string> => {
        return model.getEncryptedColumns().columns.map((column: string) => {
          return `${model.tableName}.${column}`;
        });
      })
      .filter((column: string): boolean => {
        // A key presented to OneUptime, #9012's to protect (PresentedKeys).
        return column !== "StatusPageSubscriber.unsubscribeToken";
      });

    // UserWebhook.secret was #8989's (EncryptProjectCredentials).
    expect([...declared, "UserWebhook.webhookUrl"].sort()).toEqual(
      targetNames(EncryptWebhookAddresses.getTargets()).sort(),
    );
    expect(new UserWebhook().getEncryptedColumns().columns.sort()).toEqual([
      "secret",
      "webhookUrl",
    ]);
  });

  test("encrypts each address as written, held to the value read, and each decrypts back to it", async () => {
    const { calls, stubs } = stubTables(webhookTablesAsWritten());

    await encryptInPlaceADayLater("EncryptWebhookAddresses");

    const updates: Array<QueryCall> = updateCalls(calls);

    expect(
      updates.map((call: QueryCall): string => {
        return `${call.table}:${String(call.params![1])}`;
      }),
    ).toEqual([
      "StatusPageSubscriber:a-slack",
      "StatusPageSubscriber:b-teams",
      "StatusPageSubscriber:c-webhook",
      "UserWebhook:method",
      "OpenStackProjectNotice:notice",
      "OpenStackProjectNotice:notice",
      "CustomNotificationChannel:channel",
      "CustomNotificationChannel:channel",
    ]);

    for (const update of updates) {
      // Held to the value read: the plaintext is the third parameter.
      expect(update.sql).toMatch(/AND "\w+" = \$3$/);
      expect(Encryption.looksEncrypted(String(update.params![0]))).toBe(true);
      expect(await Encryption.decrypt(String(update.params![0]))).toBe(
        update.params![2],
      );
    }

    const subscribers: Array<StoredRow> = stubs.StatusPageSubscriber.rows;

    expect(
      await Encryption.decrypt(
        String(subscribers[0]!["slackIncomingWebhookUrl"]),
      ),
    ).toBe(SLACK_HOOK);
    expect(
      await Encryption.decrypt(
        String(subscribers[1]!["microsoftTeamsIncomingWebhookUrl"]),
      ),
    ).toBe(TEAMS_HOOK);
    expect(
      await Encryption.decrypt(String(subscribers[2]!["subscriberWebhook"])),
    ).toBe(SUBSCRIBER_HOOK);
    expect(subscribers[3]!["subscriberWebhook"]).toBeNull();
    expect(
      await Encryption.decrypt(
        String(stubs.OpenStackProjectNotice.rows[0]!["previewedRecipient"]),
      ),
    ).toBe(`webhook:${NOTICE_HOOK}`);
    expect(
      await Encryption.decrypt(
        String(stubs.CustomNotificationChannel.rows[0]!["secret"]),
      ),
    ).toBe(CHANNEL_SECRET);
  });

  test("a second run rewrites nothing, and an address saved encrypted meanwhile is left as its save stored it", async () => {
    const saved: string = await Encryption.encrypt(SLACK_HOOK);
    const { calls } = stubTables({
      ...webhookTablesAsWritten(),
      StatusPageSubscriber: {
        rows: [{ _id: "saved", slackIncomingWebhookUrl: saved }],
      },
    });

    await encryptInPlaceADayLater("EncryptWebhookAddresses");
    const first: number = updateCalls(calls).length;

    calls.length = 0;
    await encryptInPlaceADayLater("EncryptWebhookAddresses");

    expect(first).toBe(5);
    expect(updateCalls(calls)).toEqual([]);
  });

  test("a table it cannot read, or a row it cannot write, costs the others nothing, and no address is logged", async () => {
    const tables: Partial<Record<TableName, TableStub>> =
      webhookTablesAsWritten();
    tables.StatusPageSubscriber!.failRead = true;
    tables.UserWebhook!.failUpdateForId = "method";

    const { stubs } = stubTables(tables);

    await encryptInPlaceADayLater("EncryptWebhookAddresses");

    expect(stubs.UserWebhook.rows[0]!["webhookUrl"]).toBe(METHOD_HOOK);
    expect(
      Encryption.looksEncrypted(
        String(stubs.OpenStackProjectNotice.rows[0]!["webhookUrl"]),
      ),
    ).toBe(true);
    expect(
      Encryption.looksEncrypted(
        String(stubs.CustomNotificationChannel.rows[0]!["webhookUrl"]),
      ),
    ).toBe(true);

    const logged: string = everythingLogged();

    expect(logged).toContain("EncryptWebhookAddresses");
    expect(logged).toContain("method");
    for (const address of [SLACK_HOOK, TEAMS_HOOK, METHOD_HOOK, NOTICE_HOOK]) {
      expect(logged).not.toContain(address);
    }
  });
});

describe("EncryptSnmpCredentials", () => {
  test("encrypts all eight SNMP columns, the JSON ones by the fields their models name", () => {
    stubTables({});

    const targets: Array<ColumnToEncrypt> = EncryptSnmpCredentials.getTargets();

    expect(targetNames(targets)).toEqual([
      "NetworkDevice.snmpCommunityString",
      "NetworkDevice.snmpV3AuthKey",
      "NetworkDevice.snmpV3PrivKey",
      "NetworkDevice.snmpV3Auth",
      "NetworkDeviceDiscoveryScan.snmpCommunityString",
      "NetworkDeviceDiscoveryScan.snmpV3AuthKey",
      "NetworkDeviceDiscoveryScan.snmpV3PrivKey",
      "NetworkDeviceDiscoveryScan.snmpConfigs",
    ]);

    for (const [model, columns] of [
      [
        new NetworkDevice(),
        ["snmpCommunityString", "snmpV3AuthKey", "snmpV3PrivKey", "snmpV3Auth"],
      ],
      [
        new NetworkDeviceDiscoveryScan(),
        [
          "snmpCommunityString",
          "snmpV3AuthKey",
          "snmpV3PrivKey",
          "snmpConfigs",
        ],
      ],
    ] as Array<[DatabaseBaseModel, Array<string>]>) {
      expect([...model.getEncryptedColumns().columns].sort()).toEqual(
        [...columns].sort(),
      );
    }

    expect(targets[3]!.jsonFields).toEqual(["authKey", "privKey"]);
    expect(targets[7]!.jsonFields).toEqual([
      "snmpCommunityString",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
    ]);
    expect(targets[0]!.jsonFields).toBeUndefined();
  });

  test("encrypts the text columns whole, and the secret fields inside each JSON entry, keeping the rest as written", async () => {
    const { calls, stubs } = stubTables(snmpTablesAsWritten());

    await encryptInPlaceADayLater("EncryptSnmpCredentials");

    const devices: Array<StoredRow> = stubs.NetworkDevice.rows;

    expect(
      await Encryption.decrypt(String(devices[0]!["snmpCommunityString"])),
    ).toBe(COMMUNITY);
    expect(await Encryption.decrypt(String(devices[1]!["snmpV3AuthKey"]))).toBe(
      AUTH_KEY,
    );
    expect(await Encryption.decrypt(String(devices[1]!["snmpV3PrivKey"]))).toBe(
      PRIV_KEY,
    );
    expect(devices[3]!["snmpCommunityString"]).toBe("");

    const legacy: JSONObject = devices[2]!["snmpV3Auth"] as JSONObject;

    expect(legacy["username"]).toBe("monitoring");
    expect(legacy["securityLevel"]).toBe("authPriv");
    expect(await Encryption.decrypt(String(legacy["authKey"]))).toBe(AUTH_KEY);
    expect(await Encryption.decrypt(String(legacy["privKey"]))).toBe(PRIV_KEY);

    const scan: StoredRow = stubs.NetworkDeviceDiscoveryScan.rows[0]!;
    const configs: Array<JSONObject> = scan["snmpConfigs"] as Array<JSONObject>;

    expect(configs).toHaveLength(2);
    expect(configs[0]!["name"]).toBe("Access switches");
    expect(configs[0]!["snmpPort"]).toBe(161);
    expect(
      await Encryption.decrypt(String(configs[0]!["snmpCommunityString"])),
    ).toBe(COMMUNITY);
    expect(await Encryption.decrypt(String(configs[1]!["snmpV3AuthKey"]))).toBe(
      AUTH_KEY,
    );
    expect(await Encryption.decrypt(String(configs[1]!["snmpV3PrivKey"]))).toBe(
      PRIV_KEY,
    );
    expect(await Encryption.decrypt(String(scan["snmpCommunityString"]))).toBe(
      COMMUNITY,
    );
    expect(stubs.NetworkDeviceDiscoveryScan.rows[1]!["snmpConfigs"]).toBeNull();

    // A JSON write is held to the JSON read.
    const jsonWrites: Array<QueryCall> = updateCalls(calls).filter(
      (call: QueryCall): boolean => {
        return call.sql.includes("::jsonb");
      },
    );

    expect(jsonWrites).toHaveLength(2);
    expect(JSON.parse(String(jsonWrites[1]!.params![2]))).toEqual(SNMP_CONFIGS);
  });

  test("a list half encrypted is finished, its encrypted entries left as they are, and a second run rewrites nothing", async () => {
    const encryptedCommunity: string = await Encryption.encrypt(COMMUNITY);
    const half: Array<JSONObject> = JSON.parse(JSON.stringify(SNMP_CONFIGS));
    half[0]!["snmpCommunityString"] = encryptedCommunity;

    const { calls, stubs } = stubTables({
      NetworkDeviceDiscoveryScan: {
        rows: [{ _id: "scan", snmpConfigs: half }],
      },
    });

    await encryptInPlaceADayLater("EncryptSnmpCredentials");

    const configs: Array<JSONObject> = stubs.NetworkDeviceDiscoveryScan
      .rows[0]!["snmpConfigs"] as Array<JSONObject>;

    expect(configs[0]!["snmpCommunityString"]).toBe(encryptedCommunity);
    expect(
      Encryption.looksEncrypted(String(configs[1]!["snmpV3AuthKey"])),
    ).toBe(true);

    calls.length = 0;
    await encryptInPlaceADayLater("EncryptSnmpCredentials");

    expect(updateCalls(calls)).toEqual([]);
  });

  test("a scan it cannot write costs the others nothing, and no credential is logged", async () => {
    const tables: Partial<Record<TableName, TableStub>> = snmpTablesAsWritten();
    tables.NetworkDeviceDiscoveryScan!.failUpdateForId = "scan";

    const { stubs } = stubTables(tables);

    await encryptInPlaceADayLater("EncryptSnmpCredentials");

    expect(
      Encryption.looksEncrypted(
        String(stubs.NetworkDevice.rows[0]!["snmpCommunityString"]),
      ),
    ).toBe(true);
    expect(
      (
        stubs.NetworkDeviceDiscoveryScan.rows[0]![
          "snmpConfigs"
        ] as Array<JSONObject>
      )[0]!["snmpCommunityString"],
    ).toBe(COMMUNITY);

    const logged: string = everythingLogged();

    expect(logged).toContain("EncryptSnmpCredentials");
    for (const secret of [COMMUNITY, AUTH_KEY, PRIV_KEY]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("MaskWebhookAddressesInLogs", () => {
  function logTables(): Partial<Record<TableName, TableStub>> {
    return {
      WebhookLog: {
        rows: [
          {
            _id: "a",
            webhookUrl: SLACK_HOOK,
            statusMessage: "Webhook delivered successfully (HTTP 200).",
          },
          {
            _id: "b",
            webhookUrl: METHOD_HOOK,
            statusMessage: `Could not reach ${METHOD_HOOK}.`,
          },
          {
            _id: "c",
            webhookUrl: "https://hooks.example.com/•••",
            statusMessage: null,
          },
        ],
      },
      UserOnCallLogTimeline: {
        rows: [
          {
            _id: "sending",
            statusMessage: `Sending webhook to ${METHOD_HOOK}.`,
          },
          { _id: "named", statusMessage: "Sending webhook to My Slack." },
          { _id: "sent", statusMessage: "Webhook delivered (HTTP 200)." },
        ],
      },
    };
  }

  test("masks each address the webhook log kept, and an address its error quotes, in one statement a page", async () => {
    const { calls, stubs } = stubTables(logTables());

    await new MaskWebhookAddressesInLogs().migrate();

    const logs: Array<StoredRow> = stubs.WebhookLog.rows;

    expect(logs[0]!["webhookUrl"]).toBe("https://hooks.slack.com/•••");
    expect(logs[0]!["statusMessage"]).toBe(
      "Webhook delivered successfully (HTTP 200).",
    );
    expect(logs[1]!["webhookUrl"]).toBe("https://discord.com/•••");
    expect(logs[1]!["statusMessage"]).toBe(
      "Could not reach https://discord.com/•••.",
    );
    expect(logs[2]!["webhookUrl"]).toBe("https://hooks.example.com/•••");

    const logWrites: Array<QueryCall> = updateCalls(calls).filter(
      (call: QueryCall): boolean => {
        return call.table === "WebhookLog";
      },
    );

    // One statement for the page, naming only the rows it changes.
    expect(logWrites).toHaveLength(1);
    expect(logWrites[0]!.params![0]).toEqual(["a", "b"]);
  });

  test('a page\'s webhook line that names an address reads "Sending webhook."; one naming the webhook is kept', async () => {
    const { stubs } = stubTables(logTables());

    await new MaskWebhookAddressesInLogs().migrate();

    expect(
      stubs.UserOnCallLogTimeline.rows.map((row: StoredRow): unknown => {
        return row["statusMessage"];
      }),
    ).toEqual([
      "Sending webhook.",
      "Sending webhook to My Slack.",
      "Webhook delivered (HTTP 200).",
    ]);
  });

  test("a second run rewrites no log", async () => {
    const { calls } = stubTables(logTables());

    await new MaskWebhookAddressesInLogs().migrate();
    calls.length = 0;
    await new MaskWebhookAddressesInLogs().migrate();

    expect(
      updateCalls(calls).filter((call: QueryCall): boolean => {
        return call.table === "WebhookLog";
      }),
    ).toEqual([]);
  });

  test("a page it cannot write is left as it was, and no address is logged", async () => {
    const tables: Partial<Record<TableName, TableStub>> = logTables();
    tables.WebhookLog!.failUpdateForId = "a";

    const { stubs } = stubTables(tables);

    await new MaskWebhookAddressesInLogs().migrate();

    expect(stubs.WebhookLog.rows[0]!["webhookUrl"]).toBe(SLACK_HOOK);

    const logged: string = everythingLogged();

    expect(logged).toContain("MaskWebhookAddressesInLogs");
    expect(logged).not.toContain(SLACK_HOOK);
    expect(logged).not.toContain(METHOD_HOOK);
  });
});
