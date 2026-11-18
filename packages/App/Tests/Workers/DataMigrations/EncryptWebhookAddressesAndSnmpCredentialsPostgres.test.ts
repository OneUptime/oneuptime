import EncryptSnmpCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptSnmpCredentials";
import EncryptWebhookAddresses from "../../../FeatureSet/Workers/DataMigrations/EncryptWebhookAddresses";
import MaskWebhookAddressesInLogs from "../../../FeatureSet/Workers/DataMigrations/MaskWebhookAddressesInLogs";
import { encryptInPlaceADayLater } from "./Fixtures/CredentialsAtRestPass";
import Entities from "Common/Models/DatabaseModels/Index";
import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OpenStackProjectNotice from "Common/Models/DatabaseModels/OpenStackProjectNotice";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import { WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182950000 } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809182950000-WebhookAddressesAndSnmpCredentialsEncryptedColumns";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OpenStackProjectNoticeService from "Common/Server/Services/OpenStackProjectNoticeService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import WebhookAddressMask from "Common/Utils/WebhookAddressMask";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * WEBHOOK ADDRESSES AND SNMP CREDENTIALS THROUGH THE UPGRADE THAT ENCRYPTS
 * THEM, ON A REAL POSTGRES (#9013, #9014).
 *
 * On the tables as they were before the upgrade - a webhook notification
 * method's address a varchar(500), a community string a varchar(100) - with
 * every address and credential stored as written, the upgrade runs as it
 * does: the schema migration
 * (1809182950000-WebhookAddressesAndSnmpCredentialsEncryptedColumns), then
 * the EncryptWebhookAddresses, EncryptSnmpCredentials and
 * MaskWebhookAddressesInLogs data migrations, and a day later the
 * CredentialsAtRest:EncryptInPlace job's pass (#9266). Every reader reads
 * through the real services all along:
 *
 *   - before any of it, after the schema migration, after the data
 *     migrations and after the job, every address and credential reads as
 *     written - a URL as the URL written, a device's poll config with its
 *     keys, a scan's credential sets in their order and shape;
 *   - the schema migration and the data migrations keep every credential as
 *     written - what a server of the release before reads while the
 *     upgrade rolls out - and the logs keep a webhook's address by its
 *     scheme and host; the job leaves only ciphertext - in a JSON list, in
 *     each entry's secret fields alone - that decrypts to the value written;
 *   - a second run changes nothing, byte for byte; two runs at once encrypt
 *     each value once;
 *   - an address or a credential saved through a service afterwards is
 *     stored encrypted.
 *
 * Opt in with RUN_POSTGRES_WEBHOOK_SNMP_CREDENTIALS_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The tables' STRUCTURE
 * is cloned into a unique schema (search_path holds only that schema),
 * dropped afterwards; every row is synthetic. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * WEBHOOK_SNMP_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * WEBHOOK_SNMP_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_WEBHOOK_SNMP_CREDENTIALS_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "StatusPageSubscriber",
  "UserWebhook",
  "OpenStackProjectNotice",
  "CustomNotificationChannel",
  "NetworkDevice",
  "NetworkDeviceDiscoveryScan",
  "WebhookLog",
  "UserOnCallLogTimeline",
];

const PROJECT_ID: string = "90130000-0000-4000-8000-0000000006f1";
const USER_ID: string = "90130000-0000-4000-8000-0000000006f2";
const PAGE_ID: string = "90130000-0000-4000-8000-0000000006f3";
const CLOUD_ID: string = "90130000-0000-4000-8000-0000000006f4";
const PROBE_ID: string = "90140000-0000-4000-8000-0000000006f5";
const SUBSCRIBER_ID: string = "90130000-0000-4000-8000-0000000006a1";
const METHOD_ID: string = "90130000-0000-4000-8000-0000000006a2";
const NOTICE_ID: string = "90130000-0000-4000-8000-0000000006a3";
const CHANNEL_ID: string = "90130000-0000-4000-8000-0000000006a4";
const V2C_DEVICE_ID: string = "90140000-0000-4000-8000-0000000006b1";
const V3_DEVICE_ID: string = "90140000-0000-4000-8000-0000000006b2";
const LEGACY_DEVICE_ID: string = "90140000-0000-4000-8000-0000000006b3";
const SCAN_ID: string = "90140000-0000-4000-8000-0000000006b4";
const LOG_ID: string = "90130000-0000-4000-8000-0000000006c1";
const TIMELINE_ID: string = "90130000-0000-4000-8000-0000000006c2";

const SLACK_HOOK: string =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
const TEAMS_HOOK: string =
  "https://example.webhook.office.com/webhookb2/00000000-0000-0000-0000-000000000000@0000/IncomingWebhook/abcdef/0000";
const SUBSCRIBER_HOOK: string = "https://hooks.example.com/status?token=s3cr3t";
// As long as its old varchar(500) column took: only text holds it encrypted.
const METHOD_HOOK: string = `https://discord.com/api/webhooks/123/${"s".repeat(463)}`;
const NOTICE_HOOK: string = "https://notices.example.com/openstack/s3cr3t-path";
const NOTICE_RECIPIENT: string = "https://notices.example.com/openstack";
const CHANNEL_HOOK: string = "https://pager.example.internal/oneuptime";
const CHANNEL_SECRET: string = `c${"0".repeat(98)}c`;
// As long as its old varchar(100) column took.
const COMMUNITY: string = `c${"o".repeat(98)}y`;
const AUTH_KEY: string = "an auth passphrase";
const PRIV_KEY: string = "a privacy passphrase";
const LEGACY_AUTH_KEY: string = "a legacy auth passphrase";
const LEGACY_PRIV_KEY: string = "a legacy privacy passphrase";

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
    snmpPort: 161,
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: AUTH_KEY,
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: PRIV_KEY,
  },
];

const LEGACY_V3_AUTH: JSONObject = {
  username: "legacy",
  securityLevel: "authPriv",
  authProtocol: "SHA",
  authKey: LEGACY_AUTH_KEY,
  privProtocol: "AES",
  privKey: LEGACY_PRIV_KEY,
};

// Where each text value is, and what it holds as written.
const STORED_TEXT: Array<{
  table: string;
  id: string;
  column: string;
  written: string;
}> = [
  {
    table: "StatusPageSubscriber",
    id: SUBSCRIBER_ID,
    column: "slackIncomingWebhookUrl",
    written: SLACK_HOOK,
  },
  {
    table: "StatusPageSubscriber",
    id: SUBSCRIBER_ID,
    column: "microsoftTeamsIncomingWebhookUrl",
    written: TEAMS_HOOK,
  },
  {
    table: "StatusPageSubscriber",
    id: SUBSCRIBER_ID,
    column: "subscriberWebhook",
    written: SUBSCRIBER_HOOK,
  },
  {
    table: "UserWebhook",
    id: METHOD_ID,
    column: "webhookUrl",
    written: METHOD_HOOK,
  },
  {
    table: "OpenStackProjectNotice",
    id: NOTICE_ID,
    column: "webhookUrl",
    written: NOTICE_HOOK,
  },
  {
    table: "OpenStackProjectNotice",
    id: NOTICE_ID,
    column: "previewedRecipient",
    written: NOTICE_RECIPIENT,
  },
  {
    table: "CustomNotificationChannel",
    id: CHANNEL_ID,
    column: "webhookUrl",
    written: CHANNEL_HOOK,
  },
  {
    table: "CustomNotificationChannel",
    id: CHANNEL_ID,
    column: "secret",
    written: CHANNEL_SECRET,
  },
  {
    table: "NetworkDevice",
    id: V2C_DEVICE_ID,
    column: "snmpCommunityString",
    written: COMMUNITY,
  },
  {
    table: "NetworkDevice",
    id: V3_DEVICE_ID,
    column: "snmpV3AuthKey",
    written: AUTH_KEY,
  },
  {
    table: "NetworkDevice",
    id: V3_DEVICE_ID,
    column: "snmpV3PrivKey",
    written: PRIV_KEY,
  },
  {
    table: "NetworkDeviceDiscoveryScan",
    id: SCAN_ID,
    column: "snmpCommunityString",
    written: COMMUNITY,
  },
];

interface ReadThroughServices {
  slack: string | undefined;
  teams: string | undefined;
  subscriberWebhook: string | undefined;
  methodWebhook: string | undefined;
  noticeWebhook: string | undefined;
  noticeRecipient: string | undefined;
  channelWebhook: string | undefined;
  channelSecret: string | undefined;
  community: string | undefined;
  authKey: string | undefined;
  privKey: string | undefined;
  legacyV3Auth: JSONObject | undefined;
  scanConfigs: Array<JSONObject> | undefined;
  scanCommunity: string | undefined;
}

const AS_WRITTEN: ReadThroughServices = {
  slack: SLACK_HOOK,
  teams: TEAMS_HOOK,
  subscriberWebhook: SUBSCRIBER_HOOK,
  methodWebhook: METHOD_HOOK,
  noticeWebhook: NOTICE_HOOK,
  noticeRecipient: NOTICE_RECIPIENT,
  channelWebhook: CHANNEL_HOOK,
  channelSecret: CHANNEL_SECRET,
  community: COMMUNITY,
  authKey: AUTH_KEY,
  privKey: PRIV_KEY,
  legacyV3Auth: LEGACY_V3_AUTH,
  scanConfigs: SNMP_CONFIGS,
  scanCommunity: COMMUNITY,
};

/*
 * The upgrade's data migrations. The two that name the credentials change
 * nothing (#9266); the log mask masks.
 */
async function upgrade(): Promise<void> {
  await new EncryptWebhookAddresses().migrate();
  await new EncryptSnmpCredentials().migrate();
  await new MaskWebhookAddressesInLogs().migrate();
}

// A day later: the CredentialsAtRest:EncryptInPlace job's pass.
async function aDayLater(): Promise<void> {
  await encryptInPlaceADayLater(new EncryptWebhookAddresses().name);
  await encryptInPlaceADayLater(new EncryptSnmpCredentials().name);
}

describePostgres(
  "webhook addresses and SNMP credentials through their upgrade (Postgres)",
  () => {
    const schema: string = `webhook_snmp_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;

    async function withRunner(
      work: (queryRunner: QueryRunner) => Promise<void>,
    ): Promise<void> {
      const queryRunner: QueryRunner = database.createQueryRunner();

      try {
        await work(queryRunner);
      } finally {
        await queryRunner.release();
      }
    }

    async function stored(
      table: string,
      id: string,
      column: string,
    ): Promise<unknown> {
      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT "${column}" AS "value" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id],
      );

      return rows[0]!["value"] ?? null;
    }

    // Every value the upgrade may touch, as Postgres holds it.
    async function storedValues(): Promise<Array<unknown>> {
      const values: Array<unknown> = [];

      for (const value of STORED_TEXT) {
        values.push(await stored(value.table, value.id, value.column));
      }

      values.push(
        await stored("NetworkDevice", LEGACY_DEVICE_ID, "snmpV3Auth"),
      );
      values.push(
        await stored("NetworkDeviceDiscoveryScan", SCAN_ID, "snmpConfigs"),
      );
      values.push(await stored("WebhookLog", LOG_ID, "webhookUrl"));
      values.push(await stored("WebhookLog", LOG_ID, "statusMessage"));
      values.push(
        await stored("UserOnCallLogTimeline", TIMELINE_ID, "statusMessage"),
      );

      return values;
    }

    async function columnType(table: string, column: string): Promise<string> {
      const rows: Array<{ data_type: string; max: number | null }> =
        await database.query(
          `SELECT data_type, character_maximum_length AS "max" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schema, table, column],
        );

      return rows[0]!.max
        ? `${rows[0]!.data_type}(${rows[0]!.max})`
        : rows[0]!.data_type;
    }

    // Every reader, through the services, as the senders and the poll read.
    async function readThroughServices(): Promise<ReadThroughServices> {
      const subscriber: StatusPageSubscriber | null =
        await StatusPageSubscriberService.findOneById({
          id: new ObjectID(SUBSCRIBER_ID),
          select: {
            slackIncomingWebhookUrl: true,
            microsoftTeamsIncomingWebhookUrl: true,
            subscriberWebhook: true,
          },
          props: { isRoot: true },
        });
      const method: UserWebhook | null = await UserWebhookService.findOneById({
        id: new ObjectID(METHOD_ID),
        select: { webhookUrl: true },
        props: { isRoot: true },
      });
      const notice: OpenStackProjectNotice | null =
        await OpenStackProjectNoticeService.findOneById({
          id: new ObjectID(NOTICE_ID),
          select: { webhookUrl: true, previewedRecipient: true },
          props: { isRoot: true },
        });
      const channel: CustomNotificationChannel | null =
        await CustomNotificationChannelService.findOneById({
          id: new ObjectID(CHANNEL_ID),
          select: { webhookUrl: true, secret: true },
          props: { isRoot: true },
        });
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {},
        select: NetworkDeviceHydrationUtil.snmpConfigSelect,
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });
      const scan: NetworkDeviceDiscoveryScan | null =
        await NetworkDeviceDiscoveryScanService.findOneById({
          id: new ObjectID(SCAN_ID),
          select: { snmpConfigs: true, snmpCommunityString: true },
          props: { isRoot: true },
        });

      const device: (id: string) => NetworkDevice | undefined = (
        id: string,
      ): NetworkDevice | undefined => {
        return devices.find((each: NetworkDevice): boolean => {
          return each.id?.toString() === id;
        });
      };

      const asText: (value: URL | string | undefined) => string | undefined = (
        value: URL | string | undefined,
      ): string | undefined => {
        return value === undefined || value === null
          ? undefined
          : value.toString();
      };

      return {
        slack: asText(subscriber?.slackIncomingWebhookUrl),
        teams: asText(subscriber?.microsoftTeamsIncomingWebhookUrl),
        subscriberWebhook: asText(subscriber?.subscriberWebhook),
        methodWebhook: asText(method?.webhookUrl),
        noticeWebhook: asText(notice?.webhookUrl),
        noticeRecipient: notice?.previewedRecipient,
        channelWebhook: asText(channel?.webhookUrl),
        channelSecret: channel?.secret,
        community: device(V2C_DEVICE_ID)?.snmpCommunityString,
        authKey: device(V3_DEVICE_ID)?.snmpV3AuthKey,
        privKey: device(V3_DEVICE_ID)?.snmpV3PrivKey,
        legacyV3Auth: device(LEGACY_DEVICE_ID)?.snmpV3Auth as
          | JSONObject
          | undefined,
        scanConfigs: scan?.snmpConfigs as Array<JSONObject> | undefined,
        scanCommunity: scan?.snmpCommunityString,
      };
    }

    // The schema migration, unless a test before this one ran it.
    async function upgradeSchema(): Promise<void> {
      if ((await columnType("UserWebhook", "webhookUrl")) === "text") {
        return;
      }

      await withRunner(async (queryRunner: QueryRunner) => {
        await new WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182950000().up(
          queryRunner,
        );
      });
    }

    async function seedAsWritten(): Promise<void> {
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      await database.query(
        `INSERT INTO "${schema}"."StatusPageSubscriber" ("_id", "version", "projectId", "statusPageId", "slackIncomingWebhookUrl", "microsoftTeamsIncomingWebhookUrl", "subscriberWebhook") VALUES ($1, 1, $2, $3, $4, $5, $6)`,
        [
          SUBSCRIBER_ID,
          PROJECT_ID,
          PAGE_ID,
          SLACK_HOOK,
          TEAMS_HOOK,
          SUBSCRIBER_HOOK,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."UserWebhook" ("_id", "version", "projectId", "userId", "name", "webhookUrl") VALUES ($1, 1, $2, $3, 'My endpoint', $4)`,
        [METHOD_ID, PROJECT_ID, USER_ID, METHOD_HOOK],
      );
      await database.query(
        `INSERT INTO "${schema}"."OpenStackProjectNotice" ("_id", "version", "projectId", "openStackCloudId", "openStackProjectId", "webhookUrl", "previewedRecipient") VALUES ($1, 1, $2, $3, 'p-0001', $4, $5)`,
        [NOTICE_ID, PROJECT_ID, CLOUD_ID, NOTICE_HOOK, NOTICE_RECIPIENT],
      );
      await database.query(
        `INSERT INTO "${schema}"."CustomNotificationChannel" ("_id", "version", "name", "webhookUrl", "secret") VALUES ($1, 1, 'Pager bridge', $2, $3)`,
        [CHANNEL_ID, CHANNEL_HOOK, CHANNEL_SECRET],
      );
      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice" ("_id", "version", "projectId", "name", "slug", "hostname", "snmpVersion", "snmpCommunityString") VALUES ($1, 1, $2, 'access-sw-01', $3, '10.0.0.5', 'V2c', $4)`,
        [V2C_DEVICE_ID, PROJECT_ID, `access-sw-01-${V2C_DEVICE_ID}`, COMMUNITY],
      );
      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice" ("_id", "version", "projectId", "name", "slug", "hostname", "snmpVersion", "snmpV3SecurityLevel", "snmpV3Username", "snmpV3AuthProtocol", "snmpV3AuthKey", "snmpV3PrivProtocol", "snmpV3PrivKey") VALUES ($1, 1, $2, 'core-rtr-01', $3, '10.0.0.6', 'V3', 'authPriv', 'monitoring', 'SHA', $4, 'AES', $5)`,
        [
          V3_DEVICE_ID,
          PROJECT_ID,
          `core-rtr-01-${V3_DEVICE_ID}`,
          AUTH_KEY,
          PRIV_KEY,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."NetworkDevice" ("_id", "version", "projectId", "name", "slug", "hostname", "snmpVersion", "snmpV3Auth") VALUES ($1, 1, $2, 'legacy-sw-01', $3, '10.0.0.7', 'V3', $4::jsonb)`,
        [
          LEGACY_DEVICE_ID,
          PROJECT_ID,
          `legacy-sw-01-${LEGACY_DEVICE_ID}`,
          JSON.stringify(LEGACY_V3_AUTH),
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."NetworkDeviceDiscoveryScan" ("_id", "version", "projectId", "probeId", "cidr", "snmpConfigs", "snmpVersion", "snmpCommunityString") VALUES ($1, 1, $2, $3, '10.0.0.0/24', $4::jsonb, 'V2c', $5)`,
        [
          SCAN_ID,
          PROJECT_ID,
          PROBE_ID,
          JSON.stringify(SNMP_CONFIGS),
          COMMUNITY,
        ],
      );
      await database.query(
        `INSERT INTO "${schema}"."WebhookLog" ("_id", "version", "projectId", "webhookUrl", "status", "statusMessage") VALUES ($1, 1, $2, $3, 'Error', $4)`,
        [LOG_ID, PROJECT_ID, SLACK_HOOK, `connect ECONNREFUSED ${SLACK_HOOK}`],
      );
      await database.query(
        `INSERT INTO "${schema}"."UserOnCallLogTimeline" ("_id", "version", "userId", "projectId", "userNotificationLogId", "onCallDutyPolicyExecutionLogId", "onCallDutyPolicyExecutionLogTimelineId", "userNotificationEventType", "statusMessage", "status") VALUES ($1, 1, $2, $3, $4, $5, $6, 'Incident Created', $7, 'Sending')`,
        [
          TIMELINE_ID,
          USER_ID,
          PROJECT_ID,
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          `Sending webhook to ${METHOD_HOOK.substring(0, 400)}`,
        ],
      );
    }

    // Each stored value is a ciphertext that decrypts, once, to the value written.
    async function expectEncryptedOnce(): Promise<void> {
      for (const value of STORED_TEXT) {
        const text: string = String(
          await stored(value.table, value.id, value.column),
        );

        expect([
          value.table,
          value.column,
          Encryption.looksEncrypted(text),
        ]).toEqual([value.table, value.column, true]);
        expect(await Encryption.decrypt(text)).toBe(value.written);
      }

      const legacy: JSONObject = (await stored(
        "NetworkDevice",
        LEGACY_DEVICE_ID,
        "snmpV3Auth",
      )) as JSONObject;

      expect(legacy["username"]).toBe("legacy");
      expect(await Encryption.decrypt(String(legacy["authKey"]))).toBe(
        LEGACY_AUTH_KEY,
      );
      expect(await Encryption.decrypt(String(legacy["privKey"]))).toBe(
        LEGACY_PRIV_KEY,
      );

      const configs: Array<JSONObject> = (await stored(
        "NetworkDeviceDiscoveryScan",
        SCAN_ID,
        "snmpConfigs",
      )) as Array<JSONObject>;

      // The list's own shape: the names, versions and order as written.
      expect(
        configs.map((config: JSONObject) => {
          return [
            config["id"],
            config["snmpVersion"],
            config["snmpV3Username"],
          ];
        }),
      ).toEqual([
        ["access", "V2c", undefined],
        ["core", "V3", "monitoring"],
      ]);
      expect(
        await Encryption.decrypt(String(configs[0]!["snmpCommunityString"])),
      ).toBe(COMMUNITY);
      expect(
        await Encryption.decrypt(String(configs[1]!["snmpV3AuthKey"])),
      ).toBe(AUTH_KEY);
      expect(
        await Encryption.decrypt(String(configs[1]!["snmpV3PrivKey"])),
      ).toBe(PRIV_KEY);
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["WEBHOOK_SNMP_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["WEBHOOK_SNMP_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["WEBHOOK_SNMP_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The tables as they were before the upgrade.
      await withRunner(async (queryRunner: QueryRunner) => {
        await new WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182950000().down(
          queryRunner,
        );
      });
    }, 120000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the upgrade: every address and credential reads as written before, between and after, and is stored encrypted at the end", async () => {
      await seedAsWritten();

      // Before the upgrade, on the old columns.
      expect(await columnType("UserWebhook", "webhookUrl")).toBe(
        "character varying(500)",
      );
      expect(await columnType("NetworkDevice", "snmpCommunityString")).toBe(
        "character varying(100)",
      );
      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      // The schema migration keeps every value.
      const beforeSchema: Array<unknown> = await storedValues();

      await withRunner(async (queryRunner: QueryRunner) => {
        await new WebhookAddressesAndSnmpCredentialsEncryptedColumns1809182950000().up(
          queryRunner,
        );
      });

      expect(await columnType("UserWebhook", "webhookUrl")).toBe("text");
      expect(await columnType("NetworkDevice", "snmpCommunityString")).toBe(
        "text",
      );
      expect(await storedValues()).toEqual(beforeSchema);
      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      /*
       * The data migrations change no credential: a server of the release
       * before, still running while the upgrade rolls out, reads every one
       * as stored, as written. Only the logs are masked.
       */
      await upgrade();

      expect((await storedValues()).slice(0, -3)).toEqual(
        beforeSchema.slice(0, -3),
      );
      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      // A day later, the job leaves only ciphertext, of the values written.
      await aDayLater();

      await expectEncryptedOnce();

      // A 500-character address, stored as 704 characters: only text holds it.
      expect(
        String(await stored("UserWebhook", METHOD_ID, "webhookUrl")).length,
      ).toBe(704);

      expect(await readThroughServices()).toEqual(AS_WRITTEN);

      // The logs keep the address by its scheme and host alone.
      const masked: string = WebhookAddressMask.mask(SLACK_HOOK);

      expect(await stored("WebhookLog", LOG_ID, "webhookUrl")).toBe(masked);
      expect(await stored("WebhookLog", LOG_ID, "statusMessage")).toBe(
        `connect ECONNREFUSED ${masked}`,
      );
      expect(
        await stored("UserOnCallLogTimeline", TIMELINE_ID, "statusMessage"),
      ).toBe("Sending webhook.");

      // Run again, nothing changes, byte for byte.
      const afterOne: Array<unknown> = await storedValues();

      await upgrade();
      await aDayLater();

      expect(await storedValues()).toEqual(afterOne);
    });

    test("two runs at once encrypt each value once", async () => {
      await upgradeSchema();
      await seedAsWritten();

      await Promise.all([upgrade(), upgrade()]);
      await Promise.all([aDayLater(), aDayLater()]);

      await expectEncryptedOnce();
      expect(await readThroughServices()).toEqual(AS_WRITTEN);
    });

    test("an address or a credential saved through a service after the upgrade is stored encrypted, and read as saved", async () => {
      await upgradeSchema();
      await seedAsWritten();
      await upgrade();
      await aDayLater();

      // The address check a save runs, which asks DNS, is not what this is about.
      jest
        .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
        .mockResolvedValue(undefined as never);

      await UserWebhookService.updateOneById({
        id: new ObjectID(METHOD_ID),
        data: { webhookUrl: "https://hooks.example.com/after-the-upgrade" },
        props: { isRoot: true },
      });
      await NetworkDeviceService.updateOneById({
        id: new ObjectID(V2C_DEVICE_ID),
        data: { snmpCommunityString: "a community set after the upgrade" },
        props: { isRoot: true },
      });

      const address: string = String(
        await stored("UserWebhook", METHOD_ID, "webhookUrl"),
      );
      const community: string = String(
        await stored("NetworkDevice", V2C_DEVICE_ID, "snmpCommunityString"),
      );

      expect(Encryption.looksEncrypted(address)).toBe(true);
      expect(await Encryption.decrypt(address)).toBe(
        "https://hooks.example.com/after-the-upgrade",
      );
      expect(Encryption.looksEncrypted(community)).toBe(true);
      expect(await Encryption.decrypt(community)).toBe(
        "a community set after the upgrade",
      );

      const read: ReadThroughServices = await readThroughServices();

      expect(read.methodWebhook).toBe(
        "https://hooks.example.com/after-the-upgrade",
      );
      expect(read.community).toBe("a community set after the upgrade");
    });
  },
);
