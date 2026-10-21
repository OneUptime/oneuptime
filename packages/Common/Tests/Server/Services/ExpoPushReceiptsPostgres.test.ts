import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import Entities from "../../../Models/DatabaseModels/Index";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import Redis from "../../../Server/Infrastructure/Redis";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import {
  ExpoPushReceiptQueue,
  PendingExpoPushReceipt,
} from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import ExpoPushReceiptService from "../../../Server/Services/ExpoPushReceiptService";
import PushNotificationLogService from "../../../Server/Services/PushNotificationLogService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import UserPushService from "../../../Server/Services/UserPushService";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import FakeSortedSetRedis from "../TestingUtils/Redis/FakeSortedSetRedis";
import { Expo, ExpoPushReceipt } from "expo-server-sdk";
import { DataSource } from "typeorm";

/*
 * Expo push receipts against a migrated Postgres: what reading a receipt
 * does to the rows people see.
 *
 * Opt in with RUN_POSTGRES_EXPO_PUSH_RECEIPTS_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_EXPO_PUSH_RECEIPTS_TESTS=true \
 *   EXPO_PUSH_RECEIPTS_TEST_DATABASE_HOST=127.0.0.1 \
 *   EXPO_PUSH_RECEIPTS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/ExpoPushReceiptsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database. It works
 * on structure-only clones (LIKE ... INCLUDING ALL) of UserPush,
 * PushNotificationLog and UserOnCallLogTimeline in a uniquely named schema
 * that is dropped afterwards; every row is synthetic. Expo is stood in for,
 * and the receipts queue is the real one on an in-memory Redis.
 *
 * What it pins, as Postgres runs the queries:
 *   - a receipt saying DeviceNotRegistered stops every phone and tablet
 *     registered with the token being verified - every account, every
 *     project - and nothing else: not another token's device, not a browser,
 *     and a device marked already stays as it is. Paging and readiness,
 *     which read only verified devices, no longer find it;
 *   - the push log and the page's on-call timeline row that said the push
 *     was sent say it was not delivered, and why; a row acknowledged
 *     meanwhile, and a log that already said it failed, are left alone;
 *   - a phone whose app registered the token again after the push was sent
 *     stays verified, and the page still says it was not delivered;
 *   - a phone that names the token it had before carries the new one on its
 *     own device, in that project only, with nobody else's touched.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_EXPO_PUSH_RECEIPTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "UserPush",
  "PushNotificationLog",
  "UserOnCallLogTimeline",
];

type MockedFn = ReturnType<typeof jest.fn>;

const MINUTE: number = 60 * 1000;

const GONE_TOKEN: string = "ExponentPushToken[postgres-gone-000001]";
const OTHER_TOKEN: string = "ExponentPushToken[postgres-other-00002]";
const OLD_TOKEN: string = "ExponentPushToken[postgres-old-0000003]";
const NEW_TOKEN: string = "ExponentPushToken[postgres-new-0000004]";

const GONE_PAGE_MESSAGE: string =
  "Push notification not delivered. Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid. The device is marked as not receiving notifications; open the mobile app on it to register it again.";

describePostgres("Expo push receipts against Postgres", () => {
  const schema: string = `expo_push_receipts_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  const userA: ObjectID = ObjectID.generate();
  const userB: ObjectID = ObjectID.generate();
  const projectOne: ObjectID = ObjectID.generate();
  const projectTwo: ObjectID = ObjectID.generate();

  let database: DataSource;
  let redis: FakeSortedSetRedis;
  let queue: ExpoPushReceiptQueue;
  let expoReceipts: Map<string, ExpoPushReceipt>;
  let now: number;

  async function seedDevice(data: {
    userId: ObjectID;
    projectId: ObjectID;
    deviceToken: string;
    deviceType: PushDeviceType;
    isVerified: boolean;
    isCriticalAlertEnabled?: boolean;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."UserPush"
       ("_id", "userId", "projectId", "deviceToken", "deviceType", "deviceName", "isVerified", "isCriticalAlertEnabled", "version")
       VALUES ($1, $2, $3, $4, $5, 'Pixel 8', $6, $7, 1)`,
      [
        id.toString(),
        data.userId.toString(),
        data.projectId.toString(),
        data.deviceToken,
        data.deviceType,
        data.isVerified,
        Boolean(data.isCriticalAlertEnabled),
      ],
    );

    return id;
  }

  async function seedPushLog(status: string): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."PushNotificationLog"
       ("_id", "projectId", "title", "deviceType", "status", "statusMessage", "version")
       VALUES ($1, $2, 'Incident #42', 'ios', $3, 'Push notification sent', 1)`,
      [id.toString(), projectOne.toString(), status],
    );

    return id;
  }

  async function seedTimeline(status: string): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."UserOnCallLogTimeline"
       ("_id", "userId", "projectId", "userNotificationLogId", "onCallDutyPolicyId",
        "onCallDutyPolicyExecutionLogId", "onCallDutyPolicyExecutionLogTimelineId",
        "userNotificationEventType", "onCallDutyPolicyEscalationRuleId",
        "statusMessage", "status", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Incident Created', $8, $9, $10, 1)`,
      [
        id.toString(),
        userA.toString(),
        projectOne.toString(),
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        status === "Sent"
          ? "Push notification sent successfully"
          : "Notification Acknowledged",
        status,
      ],
    );

    return id;
  }

  async function deviceRow(id: ObjectID): Promise<{
    deviceToken: string;
    deviceType: string;
    deviceName: string;
    isVerified: boolean;
    isCriticalAlertEnabled: boolean;
    userId: string;
    projectId: string;
  }> {
    const rows: Array<{
      deviceToken: string;
      deviceType: string;
      deviceName: string;
      isVerified: boolean;
      isCriticalAlertEnabled: boolean;
      userId: string;
      projectId: string;
    }> = await database.query(
      `SELECT * FROM "${schema}"."UserPush" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  async function statusOf(
    table: string,
    id: ObjectID,
  ): Promise<{ status: string; statusMessage: string }> {
    const rows: Array<{ status: string; statusMessage: string }> =
      await database.query(
        `SELECT "status", "statusMessage" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id.toString()],
      );

    return rows[0]!;
  }

  async function keepReceipt(
    receiptId: string,
    deviceToken: string,
    rows: { logId?: ObjectID; timelineId?: ObjectID } = {},
  ): Promise<void> {
    const receipt: PendingExpoPushReceipt = {
      receiptId: receiptId,
      deviceToken: deviceToken,
      via: "expo",
      sentAt: now - 20 * MINUTE,
      attempts: 0,
      ...(rows.logId ? { pushNotificationLogId: rows.logId.toString() } : {}),
      ...(rows.timelineId
        ? { userOnCallLogTimelineId: rows.timelineId.toString() }
        : {}),
    };

    await queue.add([receipt], receipt.sentAt);
  }

  async function readReceipts(): Promise<void> {
    await ExpoPushReceiptService.checkDueReceipts({
      queue: queue,
      now: () => {
        return now;
      },
    });
  }

  // What paging and readiness read: a person's verified devices in a project.
  async function verifiedDevicesOf(
    userId: ObjectID,
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const devices: Array<UserPush> = await UserPushService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        deviceToken: true,
        deviceType: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return devices
      .map((device: UserPush): string => {
        return `${device.deviceType}:${device.deviceToken}`;
      })
      .sort();
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["EXPO_PUSH_RECEIPTS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EXPO_PUSH_RECEIPTS_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EXPO_PUSH_RECEIPTS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // An update of a push log starts its workflows and realtime events.
    for (const service of [
      UserPushService,
      PushNotificationLogService,
      UserOnCallLogTimelineService,
    ]) {
      jest
        .spyOn(
          service as unknown as {
            onTriggerWorkflow: () => Promise<void>;
          },
          "onTriggerWorkflow",
        )
        .mockResolvedValue(undefined);
      jest
        .spyOn(
          service as unknown as {
            onTriggerRealtime: () => Promise<void>;
          },
          "onTriggerRealtime",
        )
        .mockResolvedValue(undefined);
    }

    jest
      .spyOn(PushNotificationService, "hasExpoAccessToken")
      .mockReturnValue(true);

    jest
      .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
      .mockImplementation((async (ids: Array<string>) => {
        const answer: { [id: string]: ExpoPushReceipt } = {};

        for (const id of ids) {
          const receipt: ExpoPushReceipt | undefined = expoReceipts.get(id);

          if (receipt) {
            answer[id] = receipt;
          }
        }

        return answer;
      }) as never);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }

    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );

    redis = new FakeSortedSetRedis();
    (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
    (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

    queue = new ExpoPushReceiptQueue({ keyPrefix: `${schema}-receipts` });
    expoReceipts = new Map<string, ExpoPushReceipt>();
    now = Date.now();
  });

  test("DeviceNotRegistered in a receipt stops every phone with the token being paged, and nothing else", async () => {
    const goneIphone: ObjectID = await seedDevice({
      userId: userA,
      projectId: projectOne,
      deviceToken: GONE_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
    });
    // The same phone, signed in to another account in another project.
    const goneOtherAccount: ObjectID = await seedDevice({
      userId: userB,
      projectId: projectTwo,
      deviceToken: GONE_TOKEN,
      deviceType: PushDeviceType.Android,
      isVerified: true,
    });
    const otherPhone: ObjectID = await seedDevice({
      userId: userA,
      projectId: projectOne,
      deviceToken: OTHER_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
    });
    // A browser is never an Expo push token's device.
    const browser: ObjectID = await seedDevice({
      userId: userA,
      projectId: projectOne,
      deviceToken: GONE_TOKEN,
      deviceType: PushDeviceType.Web,
      isVerified: true,
    });

    expect(await verifiedDevicesOf(userA, projectOne)).toEqual([
      `ios:${GONE_TOKEN}`,
      `ios:${OTHER_TOKEN}`,
      `web:${GONE_TOKEN}`,
    ]);

    await keepReceipt("5c2f1e0a-0000-4000-8000-000000000001", GONE_TOKEN);
    expoReceipts.set("5c2f1e0a-0000-4000-8000-000000000001", {
      status: "error",
      message: `"${GONE_TOKEN}" is not a registered push notification recipient`,
      details: { error: "DeviceNotRegistered" },
    });

    await readReceipts();

    expect((await deviceRow(goneIphone)).isVerified).toBe(false);
    expect((await deviceRow(goneOtherAccount)).isVerified).toBe(false);
    expect((await deviceRow(otherPhone)).isVerified).toBe(true);
    expect((await deviceRow(browser)).isVerified).toBe(true);

    // Marked, not deleted: the device, and its rules, are still there.
    expect((await deviceRow(goneIphone)).deviceToken).toBe(GONE_TOKEN);

    // Paging and readiness no longer find the gone phone.
    expect(await verifiedDevicesOf(userA, projectOne)).toEqual([
      `ios:${OTHER_TOKEN}`,
      `web:${GONE_TOKEN}`,
    ]);
    expect(await verifiedDevicesOf(userB, projectTwo)).toEqual([]);
  });

  test("the push log and the page's timeline row say it was not delivered; an acknowledged page and a failed log are left alone", async () => {
    const sentLog: ObjectID = await seedPushLog("Success");
    const failedLog: ObjectID = await seedPushLog("Error");
    const sentPage: ObjectID = await seedTimeline("Sent");
    const acknowledgedPage: ObjectID = await seedTimeline("Acknowledged");

    await seedDevice({
      userId: userA,
      projectId: projectOne,
      deviceToken: GONE_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
    });

    await keepReceipt("5c2f1e0a-0000-4000-8000-000000000011", GONE_TOKEN, {
      logId: sentLog,
      timelineId: sentPage,
    });
    await keepReceipt("5c2f1e0a-0000-4000-8000-000000000012", OTHER_TOKEN, {
      logId: failedLog,
      timelineId: acknowledgedPage,
    });

    expoReceipts.set("5c2f1e0a-0000-4000-8000-000000000011", {
      status: "error",
      message: "not registered",
      details: { error: "DeviceNotRegistered" },
    });
    expoReceipts.set("5c2f1e0a-0000-4000-8000-000000000012", {
      status: "error",
      message: "Too many messages",
      details: { error: "MessageRateExceeded" },
    });

    await readReceipts();

    expect(await statusOf("PushNotificationLog", sentLog)).toEqual({
      status: "Error",
      statusMessage: GONE_PAGE_MESSAGE,
    });
    expect(await statusOf("UserOnCallLogTimeline", sentPage)).toEqual({
      status: "Error",
      statusMessage: GONE_PAGE_MESSAGE,
    });

    expect(await statusOf("PushNotificationLog", failedLog)).toEqual({
      status: "Error",
      statusMessage: "Push notification sent",
    });
    expect(await statusOf("UserOnCallLogTimeline", acknowledgedPage)).toEqual({
      status: "Acknowledged",
      statusMessage: "Notification Acknowledged",
    });
  });

  test("a phone whose app registered the token again after the push stays verified; the page still says it was not delivered", async () => {
    const phone: ObjectID = await seedDevice({
      userId: userA,
      projectId: projectOne,
      deviceToken: GONE_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
    });
    const sentPage: ObjectID = await seedTimeline("Sent");

    await keepReceipt("5c2f1e0a-0000-4000-8000-000000000021", GONE_TOKEN, {
      timelineId: sentPage,
    });
    expoReceipts.set("5c2f1e0a-0000-4000-8000-000000000021", {
      status: "error",
      message: "not registered",
      details: { error: "DeviceNotRegistered" },
    });

    // Reinstalled and signed in again after the page went out.
    await queue.noteTokenRegistered(GONE_TOKEN, now - 5 * MINUTE);

    await readReceipts();

    expect((await deviceRow(phone)).isVerified).toBe(true);
    expect(await statusOf("UserOnCallLogTimeline", sentPage)).toEqual({
      status: "Error",
      statusMessage:
        "Push notification not delivered. Expo said this device was not registered for push notifications when it was sent (DeviceNotRegistered). The mobile app has registered the device again since then, so it still receives notifications.",
    });
  });

  test("a phone that names its old token carries the new one on its own device, in that project only", async () => {
    const mine: ObjectID = await seedDevice({
      userId: userA,
      projectId: projectOne,
      deviceToken: OLD_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: false,
      isCriticalAlertEnabled: false,
    });
    const mineInAnotherProject: ObjectID = await seedDevice({
      userId: userA,
      projectId: projectTwo,
      deviceToken: OLD_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
    });
    const somebodyElses: ObjectID = await seedDevice({
      userId: userB,
      projectId: projectOne,
      deviceToken: OLD_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
    });

    const renewed: UserPush | null = await UserPushService.renewExpoPushDevice({
      userId: userA,
      projectId: projectOne,
      previousDeviceToken: OLD_TOKEN,
      deviceToken: NEW_TOKEN,
      deviceType: PushDeviceType.iOS,
      deviceName: "iPhone 16",
      isCriticalAlertEnabled: true,
    });

    expect(renewed?._id?.toString()).toBe(mine.toString());

    expect(await deviceRow(mine)).toEqual(
      expect.objectContaining({
        deviceToken: NEW_TOKEN,
        deviceType: PushDeviceType.iOS,
        deviceName: "iPhone 16",
        isVerified: true,
        isCriticalAlertEnabled: true,
      }),
    );
    // The project's own device only, and only this person's.
    expect((await deviceRow(mineInAnotherProject)).deviceToken).toBe(OLD_TOKEN);
    expect((await deviceRow(somebodyElses)).deviceToken).toBe(OLD_TOKEN);

    // Nothing is left to renew a second time.
    expect(
      await UserPushService.renewExpoPushDevice({
        userId: userA,
        projectId: projectOne,
        previousDeviceToken: OLD_TOKEN,
        deviceToken: NEW_TOKEN,
        deviceType: PushDeviceType.iOS,
        deviceName: "iPhone 16",
        isCriticalAlertEnabled: true,
      }),
    ).toBeNull();

    // Nothing created, nothing deleted.
    const counted: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS "count" FROM "${schema}"."UserPush"`,
    );

    expect(counted[0]!.count).toBe("3");
  });

  /*
   * An iPad set up from an iPhone's backup reports the iPhone's token. The
   * iPhone still receives notifications, so its device is not taken over:
   * the iPad gets a device of its own, and the iPhone is still paged.
   */
  test("a device with the old token that still receives notifications is not taken over", async () => {
    const stillInUse: ObjectID = await seedDevice({
      userId: userA,
      projectId: projectOne,
      deviceToken: OLD_TOKEN,
      deviceType: PushDeviceType.iOS,
      isVerified: true,
      isCriticalAlertEnabled: true,
    });

    expect(
      await UserPushService.renewExpoPushDevice({
        userId: userA,
        projectId: projectOne,
        previousDeviceToken: OLD_TOKEN,
        deviceToken: NEW_TOKEN,
        deviceType: PushDeviceType.iOS,
        deviceName: "iPad",
        isCriticalAlertEnabled: false,
      }),
    ).toBeNull();

    expect(await deviceRow(stillInUse)).toEqual(
      expect.objectContaining({
        deviceToken: OLD_TOKEN,
        deviceName: "Pixel 8",
        isVerified: true,
        isCriticalAlertEnabled: true,
      }),
    );
    expect(await verifiedDevicesOf(userA, projectOne)).toEqual([
      `ios:${OLD_TOKEN}`,
    ]);
  });
});
