import CustomNotificationChannel from "Common/Models/DatabaseModels/CustomNotificationChannel";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import OpenStackProjectNotice from "Common/Models/DatabaseModels/OpenStackProjectNotice";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserWebhook from "Common/Models/DatabaseModels/UserWebhook";
import CustomNotificationChannelService from "Common/Server/Services/CustomNotificationChannelService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import OpenStackProjectNoticeService from "Common/Server/Services/OpenStackProjectNoticeService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import WebhookService from "Common/Server/Services/WebhookService";
import ModelPermission from "Common/Server/Types/Database/Permissions/Index";
import BlockedProjectNotifications from "Common/Server/Utils/Notification/BlockedProjectNotifications";
import Encryption from "Common/Server/Utils/Encryption";
import NetworkDeviceHydrationUtil, {
  ResolvedDeviceSnmpCredentials,
  ResolvedSnmpCredentialsForBatch,
} from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import OpenStackProjectNoticeSender from "Common/Server/Utils/OpenStack/OpenStackProjectNoticeSender";
import SafeWebhookRequest from "Common/Server/Utils/SafeWebhookRequest";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import ObjectID from "Common/Types/ObjectID";
import { isOpenStackProjectNoticeArmed } from "Common/Types/OpenStack/OpenStackProjectNotice";
import API from "Common/Utils/API";
import EncryptSnmpCredentials from "../../../FeatureSet/Workers/DataMigrations/EncryptSnmpCredentials";
import EncryptWebhookAddresses from "../../../FeatureSet/Workers/DataMigrations/EncryptWebhookAddresses";
import { encryptInPlaceADayLater } from "./Fixtures/CredentialsAtRestPass";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY SENDER AND EVERY POLL READS A WEBHOOK'S ADDRESS, OR A DEVICE'S SNMP
 * CREDENTIALS, AS WRITTEN - BEFORE THE DATA MIGRATIONS ENCRYPT THEM AND
 * AFTER (#9013, #9014).
 *
 * The tables are in memory, behind the real services, holding each value as
 * the column's transformer hands it over: a URL column's address as a URL
 * while it is stored as written, as its ciphertext once encrypted. Each use
 * reads them as it does - a status page's subscribers through
 * getSubscribersByStatusPage, a notification rule's webhook through its
 * userWebhook relation, an OpenStack notice and a custom channel by id, a
 * device through the poll's own select and resolver, a scan through the
 * probe's - and sends through the real senders, with only what is outside
 * OneUptime stood in for: the HTTP requests (API.post, SafeWebhookRequest).
 *
 * Each sends once with the rows as written, then the real
 * EncryptWebhookAddresses and EncryptSnmpCredentials run over the same rows
 * (their SQL answered as Postgres answers it), and each sends again: to the
 * same address, with the same credentials - never the ciphertext stored.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

const PROJECT_ID: string = "90130000-0000-4000-8000-0000000000a1";
const PAGE_ID: string = "90130000-0000-4000-8000-0000000000a2";
const USER_ID: string = "90130000-0000-4000-8000-0000000000a3";
const SLACK_SUBSCRIBER_ID: string = "90130000-0000-4000-8000-0000000000b1";
const TEAMS_SUBSCRIBER_ID: string = "90130000-0000-4000-8000-0000000000b2";
const WEBHOOK_SUBSCRIBER_ID: string = "90130000-0000-4000-8000-0000000000b3";
const METHOD_ID: string = "90130000-0000-4000-8000-0000000000c1";
const RULE_ID: string = "90130000-0000-4000-8000-0000000000c2";
const NOTICE_ID: string = "90130000-0000-4000-8000-0000000000d1";
const CHANNEL_ID: string = "90130000-0000-4000-8000-0000000000e1";
const V2C_DEVICE_ID: string = "90140000-0000-4000-8000-0000000000f1";
const V3_DEVICE_ID: string = "90140000-0000-4000-8000-0000000000f2";
const LEGACY_DEVICE_ID: string = "90140000-0000-4000-8000-0000000000f3";
const SCAN_ID: string = "90140000-0000-4000-8000-0000000000f4";

const SLACK_HOOK: string =
  "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX";
const TEAMS_HOOK: string =
  "https://example.webhook.office.com/webhookb2/00000000-0000-0000-0000-000000000000@0000/IncomingWebhook/abcdef/0000";
const SUBSCRIBER_HOOK: string = "https://hooks.example.com/status?token=s3cr3t";
const METHOD_HOOK: string = "https://discord.com/api/webhooks/123/abcdefSECRET";
const SIGNING_SECRET: string = "a webhook signing secret";
const NOTICE_HOOK: string = "https://notices.example.com/openstack/s3cr3t-path";
const CHANNEL_HOOK: string = "https://pager.example.internal/oneuptime";
const CHANNEL_SECRET: string = "c".repeat(64);
const COMMUNITY: string = "s3cr3t-community";
const AUTH_KEY: string = "an auth passphrase";
const PRIV_KEY: string = "a privacy passphrase";

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
    snmpV3SecurityLevel: "authPriv",
    snmpV3Username: "monitoring",
    snmpV3AuthProtocol: "SHA",
    snmpV3AuthKey: AUTH_KEY,
    snmpV3PrivProtocol: "AES",
    snmpV3PrivKey: PRIV_KEY,
  },
];

interface Tables {
  subscribers: InMemoryTable;
  webhooks: InMemoryTable;
  notices: InMemoryTable;
  channels: InMemoryTable;
  devices: InMemoryTable;
  scans: InMemoryTable;
}

let tables: Tables;

// The rows as they were stored: each address and credential as written.
function useTablesAsWritten(): Tables {
  return {
    subscribers: useInMemoryTable(StatusPageSubscriberService, [
      {
        _id: SLACK_SUBSCRIBER_ID,
        projectId: new ObjectID(PROJECT_ID),
        statusPageId: new ObjectID(PAGE_ID),
        isUnsubscribed: false,
        isSubscriptionConfirmed: true,
        unsubscribeToken: "1a".repeat(32),
        slackIncomingWebhookUrl: URL.fromString(SLACK_HOOK),
      },
      {
        _id: TEAMS_SUBSCRIBER_ID,
        projectId: new ObjectID(PROJECT_ID),
        statusPageId: new ObjectID(PAGE_ID),
        isUnsubscribed: false,
        isSubscriptionConfirmed: true,
        unsubscribeToken: "2b".repeat(32),
        microsoftTeamsIncomingWebhookUrl: URL.fromString(TEAMS_HOOK),
      },
      {
        _id: WEBHOOK_SUBSCRIBER_ID,
        projectId: new ObjectID(PROJECT_ID),
        statusPageId: new ObjectID(PAGE_ID),
        isUnsubscribed: false,
        isSubscriptionConfirmed: true,
        unsubscribeToken: "3c".repeat(32),
        isAddedByTeam: true,
        subscriberWebhook: URL.fromString(SUBSCRIBER_HOOK),
      },
    ]),
    webhooks: useInMemoryTable(UserWebhookService, [
      {
        _id: METHOD_ID,
        projectId: new ObjectID(PROJECT_ID),
        userId: new ObjectID(USER_ID),
        name: "My Discord",
        webhookUrl: METHOD_HOOK,
        secret: SIGNING_SECRET,
      },
    ]),
    notices: useInMemoryTable(OpenStackProjectNoticeService, [
      {
        _id: NOTICE_ID,
        projectId: new ObjectID(PROJECT_ID),
        openStackProjectId: "os-project",
        webhookUrl: URL.fromString(NOTICE_HOOK),
        isEnabled: true,
        previewSeenAt: new Date("2026-11-01T00:00:00.000Z"),
        previewedRecipient: `webhook:${URL.fromString(NOTICE_HOOK).toString()}`,
      },
    ]),
    channels: useInMemoryTable(CustomNotificationChannelService, [
      {
        _id: CHANNEL_ID,
        name: "Pager",
        webhookUrl: CHANNEL_HOOK,
        secret: CHANNEL_SECRET,
      },
    ]),
    devices: useInMemoryTable(NetworkDeviceService, [
      {
        _id: V2C_DEVICE_ID,
        projectId: new ObjectID(PROJECT_ID),
        hostname: "10.0.0.1",
        snmpVersion: "V2c",
        snmpCommunityString: COMMUNITY,
      },
      {
        _id: V3_DEVICE_ID,
        projectId: new ObjectID(PROJECT_ID),
        hostname: "10.0.0.2",
        snmpVersion: "V3",
        snmpV3SecurityLevel: "authPriv",
        snmpV3Username: "monitoring",
        snmpV3AuthProtocol: "SHA",
        snmpV3AuthKey: AUTH_KEY,
        snmpV3PrivProtocol: "AES",
        snmpV3PrivKey: PRIV_KEY,
      },
      {
        _id: LEGACY_DEVICE_ID,
        projectId: new ObjectID(PROJECT_ID),
        hostname: "10.0.0.3",
        snmpVersion: "V3",
        snmpV3Auth: {
          securityLevel: "authPriv",
          username: "legacy",
          authProtocol: "SHA",
          authKey: AUTH_KEY,
          privProtocol: "AES",
          privKey: PRIV_KEY,
        },
      },
    ]),
    scans: useInMemoryTable(NetworkDeviceDiscoveryScanService, [
      {
        _id: SCAN_ID,
        projectId: new ObjectID(PROJECT_ID),
        cidr: "10.0.0.0/24",
        isSnmpEnabled: true,
        snmpConfigs: JSON.parse(JSON.stringify(SNMP_CONFIGS)),
        snmpVersion: "V2c",
        snmpCommunityString: COMMUNITY,
        snmpPort: 161,
      },
    ]),
  };
}

const TEXT_PAGE: RegExp =
  /^SELECT "_id", "(\w+)" FROM "(\w+)" WHERE "\1" IS NOT NULL AND "\1" <> '' AND "\1" NOT LIKE \$1(?: AND "_id" > \$2)? ORDER BY "_id" ASC LIMIT (\d+)$/;
const JSON_PAGE: RegExp =
  /^SELECT "_id", "(\w+)" FROM "(\w+)" WHERE "\1" IS NOT NULL(?: AND "_id" > \$1)? ORDER BY "_id" ASC LIMIT (\d+)$/;
const TEXT_WRITE: RegExp =
  /^UPDATE "(\w+)" SET "(\w+)" = \$1 WHERE "_id" = \$2 AND "\2" = \$3$/;
const JSON_WRITE: RegExp =
  /^UPDATE "(\w+)" SET "(\w+)" = \$1::jsonb WHERE "_id" = \$2 AND "\2" = \$3::jsonb$/;

/*
 * The statements EncryptColumnInPlace sends, answered over `table` as
 * Postgres answers them. A URL column holds its text in Postgres: a URL row
 * reads back as it, and an encrypted one is handed over as the ciphertext
 * the column's transformer hands on. Anything else fails the test.
 */
function answerMigrationSql(
  tableName: string,
  table: InMemoryTable,
): (sql: string, params?: Array<unknown>) => Promise<unknown> {
  const byId: (a: StoredRow, b: StoredRow) => number = (
    a: StoredRow,
    b: StoredRow,
  ): number => {
    return String(a["_id"]) < String(b["_id"]) ? -1 : 1;
  };

  return async (sql: string, params: Array<unknown> = []): Promise<unknown> => {
    const textPage: RegExpMatchArray | null = sql.match(TEXT_PAGE);

    if (textPage) {
      expect(textPage[2]).toBe(tableName);
      const column: string = textPage[1]!;
      const afterId: string | undefined =
        params.length > 1 ? String(params[1]) : undefined;

      return table.rows
        .filter((row: StoredRow): boolean => {
          const text: string =
            row[column] === null || row[column] === undefined
              ? ""
              : String(row[column]);

          return (
            text !== "" &&
            !Encryption.looksEncrypted(text) &&
            (afterId === undefined || String(row["_id"]) > afterId)
          );
        })
        .sort(byId)
        .slice(0, Number(textPage[3]))
        .map((row: StoredRow): StoredRow => {
          return { _id: String(row["_id"]), [column]: String(row[column]) };
        });
    }

    const jsonPage: RegExpMatchArray | null = sql.match(JSON_PAGE);

    if (jsonPage) {
      expect(jsonPage[2]).toBe(tableName);
      const column: string = jsonPage[1]!;
      const afterId: string | undefined =
        params.length > 0 ? String(params[0]) : undefined;

      return table.rows
        .filter((row: StoredRow): boolean => {
          return (
            row[column] !== null &&
            row[column] !== undefined &&
            (afterId === undefined || String(row["_id"]) > afterId)
          );
        })
        .sort(byId)
        .slice(0, Number(jsonPage[3]))
        .map((row: StoredRow): StoredRow => {
          return {
            _id: String(row["_id"]),
            [column]: JSON.parse(JSON.stringify(row[column])),
          };
        });
    }

    const textWrite: RegExpMatchArray | null = sql.match(TEXT_WRITE);

    if (textWrite) {
      expect(textWrite[1]).toBe(tableName);
      const column: string = textWrite[2]!;

      for (const row of table.rows) {
        if (
          String(row["_id"]) === params[1] &&
          String(row[column]) === params[2]
        ) {
          row[column] = params[0];
        }
      }

      return [];
    }

    const jsonWrite: RegExpMatchArray | null = sql.match(JSON_WRITE);

    if (jsonWrite) {
      expect(jsonWrite[1]).toBe(tableName);
      const column: string = jsonWrite[2]!;

      for (const row of table.rows) {
        if (
          String(row["_id"]) === params[1] &&
          JSON.stringify(row[column]) === params[2]
        ) {
          row[column] = JSON.parse(String(params[0]));
        }
      }

      return [];
    }

    throw new Error(`an unexpected statement: ${sql}`);
  };
}

/*
 * Runs `step` over the tables, their SQL answered as Postgres's: the real
 * data migrations at the upgrade, or the CredentialsAtRest:EncryptInPlace
 * job's real pass a day later.
 */
async function withMigrationSql(step: () => Promise<void>): Promise<void> {
  const attached: Array<[InMemoryTable, string]> = [
    [tables.subscribers, "StatusPageSubscriber"],
    [tables.webhooks, "UserWebhook"],
    [tables.notices, "OpenStackProjectNotice"],
    [tables.channels, "CustomNotificationChannel"],
    [tables.devices, "NetworkDevice"],
    [tables.scans, "NetworkDeviceDiscoveryScan"],
  ];

  for (const [table, tableName] of attached) {
    const repository: Record<string, unknown> =
      table.repository as unknown as Record<string, unknown>;

    repository["metadata"] = { tableName: tableName };
    repository["manager"] = { query: answerMigrationSql(tableName, table) };
  }

  try {
    await step();
  } finally {
    for (const [table] of attached) {
      const repository: Record<string, unknown> =
        table.repository as unknown as Record<string, unknown>;

      delete repository["metadata"];
      delete repository["manager"];
    }
  }
}

/*
 * The upgrade (#9266): the data migrations change nothing - every value
 * stays as written, which a server of the release before reads as it is,
 * while the upgrade rolls out.
 */
async function upgrade(): Promise<void> {
  const asWritten: string = JSON.stringify(everyRow());

  await withMigrationSql(async (): Promise<void> => {
    await new EncryptWebhookAddresses().migrate();
    await new EncryptSnmpCredentials().migrate();
  });

  expect(JSON.stringify(everyRow())).toBe(asWritten);
}

// A day after the upgrade: the job's pass encrypts every value as written.
async function encryptADayLater(): Promise<void> {
  await withMigrationSql(async (): Promise<void> => {
    await encryptInPlaceADayLater(new EncryptWebhookAddresses().name);
    await encryptInPlaceADayLater(new EncryptSnmpCredentials().name);
  });
}

// The upgrade, then the day after it.
async function migrate(): Promise<void> {
  await upgrade();
  await encryptADayLater();
}

function everyRow(): Array<Array<StoredRow>> {
  return [
    tables.subscribers.rows,
    tables.webhooks.rows,
    tables.notices.rows,
    tables.channels.rows,
    tables.devices.rows,
    tables.scans.rows,
  ];
}

/*
 * What `send` sent with the rows as written; what it sends with them during
 * the upgrade, when they are as written still - the same; and what it sends
 * again with the same rows once the job has encrypted them, a day later.
 */
async function beforeAndAfter<T>(
  send: () => Promise<T>,
): Promise<{ before: T; after: T }> {
  const before: T = await send();

  await upgrade();

  expect(await send()).toEqual(before);

  await encryptADayLater();

  const after: T = await send();

  return { before, after };
}

// Where each request went: API.post's url, or the target SafeWebhookRequest dialled.
let posted: Array<{ url: string; data: unknown }> = [];

beforeEach(() => {
  tables = useTablesAsWritten();
  posted = [];

  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: URL;
    data: unknown;
  }): Promise<HTTPResponse<JSONObject>> => {
    posted.push({ url: String(request.url), data: request.data });
    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);

  jest.spyOn(SafeWebhookRequest, "resolveTarget").mockImplementation((async (
    url: unknown,
  ): Promise<unknown> => {
    return { url: String(url), addresses: [] };
  }) as never);

  jest.spyOn(SafeWebhookRequest, "send").mockImplementation((async (target: {
    url: string;
  }): Promise<HTTPResponse<JSONObject>> => {
    posted.push({ url: target.url, data: null });
    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);

  jest
    .spyOn(BlockedProjectNotifications, "getRefusal")
    .mockResolvedValue(null as never);

  // The page's restrictions on who it takes are another suite's.
  jest
    .spyOn(
      StatusPageSubscriberService as unknown as {
        getSubscriberRestrictionQuery: () => unknown;
      },
      "getSubscriberRestrictionQuery",
    )
    .mockReturnValue({});

  jest
    .spyOn(DatabaseService.prototype, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdatePermissionByModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ModelPermission, "checkUpdateQueryPermissions")
    .mockImplementation(((_modelType: unknown, query: unknown) => {
      return Promise.resolve(query);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function expectStoredEncrypted(
  row: StoredRow | undefined,
  column: string,
  asWritten: string,
): Promise<void> {
  const stored: string = String(row![column]);

  expect(Encryption.looksEncrypted(stored)).toBe(true);
  expect(stored).not.toContain(asWritten);
  expect(await Encryption.decrypt(stored)).toBe(asWritten);
}

describe("a status page's Slack, Microsoft Teams and webhook subscribers", () => {
  // Every subscriber job's read, then each channel's real sender.
  async function notifyEverySubscriber(): Promise<Array<string>> {
    posted = [];

    const subscribers: Array<StatusPageSubscriber> =
      await StatusPageSubscriberService.getSubscribersByStatusPage(
        new ObjectID(PAGE_ID),
        { isRoot: true },
      );

    expect(subscribers).toHaveLength(3);

    for (const subscriber of subscribers) {
      if (subscriber.slackIncomingWebhookUrl) {
        await SlackUtil.sendMessageToChannelViaIncomingWebhook({
          url: subscriber.slackIncomingWebhookUrl,
          text: "Checkout API is down",
        });
      }

      if (subscriber.microsoftTeamsIncomingWebhookUrl) {
        await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
          url: subscriber.microsoftTeamsIncomingWebhookUrl,
          text: "Checkout API is down",
        });
      }

      if (subscriber.subscriberWebhook) {
        await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
          webhookUrl: subscriber.subscriberWebhook,
          isAddedByTeam: subscriber.isAddedByTeam === true,
          payload: {
            eventType: "IncidentCreated",
            statusPageId: PAGE_ID,
            statusPageName: "Acme Status",
            statusPageUrl: "https://status.example.com",
            unsubscribeUrl: "https://status.example.com/unsubscribe",
            data: {},
          },
        });
      }
    }

    return posted
      .map((post: { url: string }): string => {
        return post.url;
      })
      .sort();
  }

  test("are each posted to at the address as written, before and after the migration", async () => {
    const sent: { before: Array<string>; after: Array<string> } =
      await beforeAndAfter(notifyEverySubscriber);

    const asWritten: Array<string> = [
      URL.fromString(SLACK_HOOK).toString(),
      URL.fromString(TEAMS_HOOK).toString(),
      URL.fromString(SUBSCRIBER_HOOK).toString(),
    ].sort();

    expect(sent.before).toEqual(asWritten);
    expect(sent.after).toEqual(asWritten);

    await expectStoredEncrypted(
      tables.subscribers.get(SLACK_SUBSCRIBER_ID),
      "slackIncomingWebhookUrl",
      URL.fromString(SLACK_HOOK).toString(),
    );
    await expectStoredEncrypted(
      tables.subscribers.get(TEAMS_SUBSCRIBER_ID),
      "microsoftTeamsIncomingWebhookUrl",
      URL.fromString(TEAMS_HOOK).toString(),
    );
    await expectStoredEncrypted(
      tables.subscribers.get(WEBHOOK_SUBSCRIBER_ID),
      "subscriberWebhook",
      URL.fromString(SUBSCRIBER_HOOK).toString(),
    );
  });

  test("an address saved after the migration is stored encrypted, and is the one posted to", async () => {
    await migrate();

    const replacement: string =
      "https://hooks.slack.com/services/T0AFTER/B0AFTER/after-the-migration";

    /*
     * Written through DatabaseService's own update, as every write of the
     * column is (the subscriber service's hooks, about the page and its
     * other subscribers, are other suites').
     */
    const writer: DatabaseService<StatusPageSubscriber> =
      new DatabaseService<StatusPageSubscriber>(StatusPageSubscriber);
    jest
      .spyOn(writer, "getRepository")
      .mockReturnValue(tables.subscribers.repository as never);

    await writer.updateOneById({
      id: new ObjectID(SLACK_SUBSCRIBER_ID),
      data: { slackIncomingWebhookUrl: URL.fromString(replacement) } as never,
      props: { isRoot: true },
    });

    await expectStoredEncrypted(
      tables.subscribers.get(SLACK_SUBSCRIBER_ID),
      "slackIncomingWebhookUrl",
      URL.fromString(replacement).toString(),
    );

    expect(await notifyEverySubscriber()).toContain(
      URL.fromString(replacement).toString(),
    );
  });
});

describe("a member's webhook notification method", () => {
  test("is posted to at its address as written, signed with its secret, before and after", async () => {
    const send: () => Promise<JSONObject> = async (): Promise<JSONObject> => {
      jest.mocked(API.post).mockClear();

      const webhook: UserWebhook | null = await UserWebhookService.findOneById({
        id: new ObjectID(METHOD_ID),
        select: { webhookUrl: true, secret: true, name: true },
        props: { isRoot: true },
      });

      await WebhookService.sendWebhook({
        url: webhook!.webhookUrl!,
        eventType: "on-call.incident.created",
        payload: { message: "Checkout API is down" },
        secret: webhook!.secret || undefined,
      });

      return (
        jest.mocked(API.post).mock.calls[0]![0] as unknown as {
          data: JSONObject;
        }
      ).data;
    };

    const sent: { before: JSONObject; after: JSONObject } =
      await beforeAndAfter(send);

    for (const side of [sent.before, sent.after]) {
      expect(side).toMatchObject({ url: METHOD_HOOK, secret: SIGNING_SECRET });
    }

    await expectStoredEncrypted(
      tables.webhooks.get(METHOD_ID),
      "webhookUrl",
      METHOD_HOOK,
    );
  });

  test("a notification rule reads it through its relation as written, before and after", async () => {
    // A rule's row with its webhook joined in, as Postgres hands it over each read.
    const rules: InMemoryTable = useInMemoryTable(UserNotificationRuleService, [
      { _id: RULE_ID, projectId: new ObjectID(PROJECT_ID) },
    ]);
    const join: () => void = (): void => {
      rules.rows[0]!["userWebhook"] = {
        ...tables.webhooks.get(METHOD_ID)!,
      };
    };

    const read: () => Promise<string | undefined> = async (): Promise<
      string | undefined
    > => {
      join();

      const rule: UserNotificationRule | null =
        await UserNotificationRuleService.findOneById({
          id: new ObjectID(RULE_ID),
          select: {
            userWebhook: { webhookUrl: true, name: true, secret: true },
          },
          props: { isRoot: true },
        });

      return rule?.userWebhook?.webhookUrl;
    };

    const urls: { before: string | undefined; after: string | undefined } =
      await beforeAndAfter(read);

    expect(urls).toEqual({ before: METHOD_HOOK, after: METHOD_HOOK });
  });
});

describe("an OpenStack project's notice", () => {
  test("stays armed for the recipient previewed, and posts to the address as written, before and after", async () => {
    const send: () => Promise<{
      armed: boolean;
      url: string;
    }> = async (): Promise<{ armed: boolean; url: string }> => {
      posted = [];

      const notice: OpenStackProjectNotice | null =
        await OpenStackProjectNoticeService.findOneById({
          id: new ObjectID(NOTICE_ID),
          select: {
            _id: true,
            openStackProjectId: true,
            webhookUrl: true,
            isEnabled: true,
            previewedRecipient: true,
            previewSeenAt: true,
          },
          props: { isRoot: true },
        });

      const armed: boolean = isOpenStackProjectNoticeArmed({
        id: NOTICE_ID,
        openStackProjectId: notice!.openStackProjectId!,
        webhookUrl: notice!.webhookUrl?.toString(),
        isEnabled: notice!.isEnabled,
        previewedRecipient: notice!.previewedRecipient,
        previewSeenAt: notice!.previewSeenAt,
      });

      await (
        OpenStackProjectNoticeSender as unknown as {
          sendWebhook: (data: unknown) => Promise<unknown>;
        }
      ).sendWebhook({
        row: { _id: "delivery", projectId: new ObjectID(PROJECT_ID) },
        webhookUrl: notice!.webhookUrl!,
        message: { webhook: { title: "Nova is down" } },
      });

      return { armed, url: posted[0]!.url };
    };

    const sent: {
      before: { armed: boolean; url: string };
      after: { armed: boolean; url: string };
    } = await beforeAndAfter(send);

    const asWritten: string = URL.fromString(NOTICE_HOOK).toString();

    expect(sent.before).toEqual({ armed: true, url: asWritten });
    expect(sent.after).toEqual({ armed: true, url: asWritten });

    await expectStoredEncrypted(
      tables.notices.get(NOTICE_ID),
      "webhookUrl",
      asWritten,
    );
    await expectStoredEncrypted(
      tables.notices.get(NOTICE_ID),
      "previewedRecipient",
      `webhook:${asWritten}`,
    );
  });
});

describe("a custom notification channel", () => {
  test("is read with its address and signing secret as written, before and after", async () => {
    const read: () => Promise<JSONObject> = async (): Promise<JSONObject> => {
      // What the Enterprise Edition's sender reads (CustomChannelSender).
      const channel: CustomNotificationChannel | null =
        await CustomNotificationChannelService.findOneById({
          id: new ObjectID(CHANNEL_ID),
          select: { _id: true, name: true, webhookUrl: true, secret: true },
          props: { isRoot: true },
        });

      return {
        webhookUrl: channel!.webhookUrl!,
        secret: channel!.secret!,
      };
    };

    const sides: { before: JSONObject; after: JSONObject } =
      await beforeAndAfter(read);

    for (const side of [sides.before, sides.after]) {
      expect(side).toEqual({
        webhookUrl: CHANNEL_HOOK,
        secret: CHANNEL_SECRET,
      });
    }

    await expectStoredEncrypted(
      tables.channels.get(CHANNEL_ID),
      "webhookUrl",
      CHANNEL_HOOK,
    );
    await expectStoredEncrypted(
      tables.channels.get(CHANNEL_ID),
      "secret",
      CHANNEL_SECRET,
    );
  });
});

describe("a network device's poll", () => {
  // The poll's own read and resolver, and the config the probe is handed.
  async function pollConfigs(): Promise<
    Record<string, MonitorStepSnmpMonitor>
  > {
    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {},
      select: NetworkDeviceHydrationUtil.snmpConfigSelect,
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    const resolved: ResolvedSnmpCredentialsForBatch =
      await NetworkDeviceHydrationUtil.resolveSnmpCredentials(devices);

    const configs: Record<string, MonitorStepSnmpMonitor> = {};

    for (const device of devices) {
      const credentials: ResolvedDeviceSnmpCredentials =
        resolved.byDeviceId.get(device.id!.toString())!;

      /*
       * Walked: the devices with their own credentials. The legacy object's
       * device has no v3 username of its own, so its poll pings it; a
       * Network Device monitor's hydration builds its config from the
       * object all the same, with the same builder.
       */
      if (device.id!.toString() !== LEGACY_DEVICE_ID) {
        expect(credentials.pollMode).toBe("snmp");
      }

      configs[device.id!.toString()] =
        NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
          hostname: device.hostname!,
          credentials: credentials.carrier,
          oids: [],
          monitorInterfaces: true,
        });
    }

    return configs;
  }

  test("walks each device with its community string and v3 keys as written, the legacy object's too, before and after", async () => {
    const polls: {
      before: Record<string, MonitorStepSnmpMonitor>;
      after: Record<string, MonitorStepSnmpMonitor>;
    } = await beforeAndAfter(pollConfigs);

    for (const configs of [polls.before, polls.after]) {
      expect(configs[V2C_DEVICE_ID]!.communityString).toBe(COMMUNITY);
      expect(configs[V3_DEVICE_ID]!.snmpV3Auth).toMatchObject({
        username: "monitoring",
        authKey: AUTH_KEY,
        privKey: PRIV_KEY,
      });
      expect(configs[LEGACY_DEVICE_ID]!.snmpV3Auth).toMatchObject({
        username: "legacy",
        authKey: AUTH_KEY,
        privKey: PRIV_KEY,
      });
    }

    await expectStoredEncrypted(
      tables.devices.get(V2C_DEVICE_ID),
      "snmpCommunityString",
      COMMUNITY,
    );
    await expectStoredEncrypted(
      tables.devices.get(V3_DEVICE_ID),
      "snmpV3PrivKey",
      PRIV_KEY,
    );

    const legacy: JSONObject = tables.devices.get(LEGACY_DEVICE_ID)![
      "snmpV3Auth"
    ] as JSONObject;

    expect(legacy["username"]).toBe("legacy");
    expect(Encryption.looksEncrypted(String(legacy["authKey"]))).toBe(true);
    expect(Encryption.looksEncrypted(String(legacy["privKey"]))).toBe(true);
  });
});

describe("a discovery scan the probe sweeps", () => {
  test("hands the probe its credential sets and flattened credentials as written, before and after", async () => {
    const read: () => Promise<JSONObject> = async (): Promise<JSONObject> => {
      const scan: NetworkDeviceDiscoveryScan | null =
        await NetworkDeviceDiscoveryScanService.findOneById({
          id: new ObjectID(SCAN_ID),
          select: {
            snmpConfigs: true,
            snmpCommunityString: true,
            snmpV3AuthKey: true,
            snmpV3PrivKey: true,
          },
          props: { isRoot: true },
        });

      return {
        snmpConfigs: scan!.snmpConfigs as unknown as Array<JSONObject>,
        snmpCommunityString: scan!.snmpCommunityString!,
      };
    };

    const sides: { before: JSONObject; after: JSONObject } =
      await beforeAndAfter(read);

    for (const side of [sides.before, sides.after]) {
      expect(side).toEqual({
        snmpConfigs: SNMP_CONFIGS,
        snmpCommunityString: COMMUNITY,
      });
    }

    const stored: Array<JSONObject> = tables.scans.get(SCAN_ID)![
      "snmpConfigs"
    ] as Array<JSONObject>;

    expect(
      Encryption.looksEncrypted(String(stored[0]!["snmpCommunityString"])),
    ).toBe(true);
    expect(stored[0]!["name"]).toBe("Access switches");
    await expectStoredEncrypted(
      tables.scans.get(SCAN_ID),
      "snmpCommunityString",
      COMMUNITY,
    );
  });
});
