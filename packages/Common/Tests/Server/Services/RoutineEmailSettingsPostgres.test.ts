import RoutineEmailSettingsService from "../../../Server/Services/RoutineEmailSettingsService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Entities from "../../../Models/DatabaseModels/Index";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../../Types/NotificationSetting/RoutineEmailEvents";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_NOTIFICATION_TESTS=true and the normal database
 * credentials. Uses the local development Postgres port unless overridden by
 * NOTIFICATION_TEST_DATABASE_HOST / NOTIFICATION_TEST_DATABASE_PORT.
 * All writes go to a uniquely named schema; no project data is modified.
 * Cloning the production table also verifies the statements against its actual
 * defaults and column types rather than a hand-maintained test schema.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_NOTIFICATION_TESTS"] === "true"
    ? describe
    : describe.skip;

const USER_ID: ObjectID = ObjectID.generate();
const OTHER_USER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();
const ROUTINE_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION;
const CHANNELS: Array<string> = [
  "alertBySMS",
  "alertByCall",
  "alertByPush",
  "alertByWhatsApp",
  "alertByTelegram",
  "alertBySlack",
  "alertByMicrosoftTeams",
  "alertByWebhook",
];

interface StoredSetting {
  _id: string;
  userId: string;
  projectId: string;
  eventType: NotificationSettingEventType;
  alertByEmail: boolean;
  version: number;
  deletedAt: Date | null;
  [key: string]: unknown;
}

describePostgres("reduce routine emails against Postgres", () => {
  const schema: string = `routine_email_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["NOTIFICATION_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["NOTIFICATION_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database: process.env["DATABASE_NAME"] || "oneuptimedb",
      entities: Entities,
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."UserNotificationSetting" (LIKE public."UserNotificationSetting" INCLUDING ALL)`,
    );
    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  beforeEach(async () => {
    await database.query(`TRUNCATE "${schema}"."UserNotificationSetting"`);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  async function seed(data: {
    eventType: NotificationSettingEventType;
    email?: boolean;
    userId?: ObjectID;
    projectId?: ObjectID;
    deleted?: boolean;
  }): Promise<StoredSetting> {
    const rows: Array<StoredSetting> = await database.query(
      `INSERT INTO "UserNotificationSetting"
       ("userId", "projectId", "eventType", "alertByEmail", "version", "deletedAt", ${CHANNELS.map(
         (channel: string) => {
           return `"${channel}"`;
         },
       ).join(", ")})
       VALUES ($1, $2, $3, $4, 1, $5, ${CHANNELS.map(() => {
         return "true";
       }).join(", ")})
       RETURNING *`,
      [
        (data.userId || USER_ID).toString(),
        (data.projectId || PROJECT_ID).toString(),
        data.eventType,
        data.email ?? true,
        data.deleted ? new Date() : null,
      ],
    );
    return rows[0]!;
  }

  async function rows(): Promise<Array<StoredSetting>> {
    return await database.query(
      'SELECT * FROM "UserNotificationSetting" ORDER BY "_id"',
    );
  }

  async function apply(): Promise<void> {
    await RoutineEmailSettingsService.reduceRoutineEmails({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
  }

  test("creates a persisted opt-out for every missing routine event", async () => {
    await apply();
    const settings: Array<StoredSetting> = await rows();
    expect(settings).toHaveLength(ROUTINE_EMAIL_EVENT_TYPES.length);
    expect(
      new Set(
        settings.map((setting: StoredSetting) => {
          return setting.eventType;
        }),
      ),
    ).toEqual(new Set(ROUTINE_EMAIL_EVENT_TYPES));
    for (const setting of settings) {
      expect(setting.userId).toBe(USER_ID.toString());
      expect(setting.projectId).toBe(PROJECT_ID.toString());
      expect(setting["createdByUserId"]).toBe(USER_ID.toString());
      expect(setting.alertByEmail).toBe(false);
      expect(setting.version).toBe(1);
      for (const channel of CHANNELS) {
        expect(setting[channel]).toBe(false);
      }
    }
  });

  test("disables only email while preserving every other channel on existing rows", async () => {
    for (const eventType of ROUTINE_EMAIL_EVENT_TYPES) {
      await seed({ eventType });
    }
    await apply();
    const settings: Array<StoredSetting> = await rows();
    expect(settings).toHaveLength(ROUTINE_EMAIL_EVENT_TYPES.length);
    for (const setting of settings) {
      expect(setting.alertByEmail).toBe(false);
      expect(setting.version).toBe(2);
      for (const channel of CHANNELS) {
        expect(setting[channel]).toBe(true);
      }
    }
  });

  test("preserves every non-routine event, including existing opt-outs", async () => {
    const preserved: Array<StoredSetting> = [];
    for (const eventType of Object.values(NotificationSettingEventType)) {
      if (!ROUTINE_EMAIL_EVENT_TYPES.includes(eventType)) {
        preserved.push(await seed({ eventType }));
        preserved.push(await seed({ eventType, email: false }));
      }
    }
    await apply();
    const settings: Array<StoredSetting> = await rows();
    for (const before of preserved) {
      expect(
        settings.find((setting: StoredSetting) => {
          return setting._id === before._id;
        }),
      ).toEqual(before);
    }
  });

  test("does not create missing incident, alert or on-call preferences", async () => {
    await apply();
    for (const setting of await rows()) {
      expect(ROUTINE_EMAIL_EVENT_TYPES).toContain(setting.eventType);
    }
  });

  test("preserves an event introduced after this preset was defined", async () => {
    const futureEvent: StoredSetting = await seed({
      eventType: "Future notification event" as NotificationSettingEventType,
    });
    await apply();
    expect(
      (await rows()).find((setting: StoredSetting) => {
        return setting._id === futureEvent._id;
      }),
    ).toEqual(futureEvent);
  });

  test("leaves other users and projects unchanged", async () => {
    const preserved: Array<StoredSetting> = [
      await seed({ eventType: ROUTINE_EVENT, userId: OTHER_USER_ID }),
      await seed({ eventType: ROUTINE_EVENT, projectId: OTHER_PROJECT_ID }),
      await seed({
        eventType: ROUTINE_EVENT,
        userId: OTHER_USER_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ];
    await apply();
    const settings: Array<StoredSetting> = await rows();
    for (const before of preserved) {
      expect(
        settings.find((setting: StoredSetting) => {
          return setting._id === before._id;
        }),
      ).toEqual(before);
    }
  });

  test("repeated requests do not create duplicates or change row versions and timestamps", async () => {
    await seed({ eventType: ROUTINE_EVENT });
    await apply();
    const first: Array<StoredSetting> = await rows();
    await apply();
    expect(await rows()).toEqual(first);
  });

  test("later default seeding respects every persisted opt-out", async () => {
    await apply();
    const before: Array<StoredSetting> = await rows();
    for (const eventType of ROUTINE_EMAIL_EVENT_TYPES) {
      await UserNotificationSettingService.ensureSettingExistsForUser({
        userId: USER_ID,
        projectId: PROJECT_ID,
        eventType: eventType,
      });
    }
    expect(await rows()).toEqual(before);
  });

  test("simultaneous requests create only one live row per routine event", async () => {
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        return apply();
      }),
    );
    const settings: Array<StoredSetting> = await rows();
    expect(settings).toHaveLength(ROUTINE_EMAIL_EVENT_TYPES.length);
    expect(
      new Set(
        settings.map((setting: StoredSetting) => {
          return setting.eventType;
        }),
      ).size,
    ).toBe(ROUTINE_EMAIL_EVENT_TYPES.length);
    expect(
      settings.every((setting: StoredSetting) => {
        return setting.alertByEmail === false;
      }),
    ).toBe(true);
  });

  test("disables all live historical duplicates for the same event", async () => {
    const first: StoredSetting = await seed({ eventType: ROUTINE_EVENT });
    const second: StoredSetting = await seed({ eventType: ROUTINE_EVENT });
    await apply();
    const settings: Array<StoredSetting> = await rows();
    for (const id of [first._id, second._id]) {
      expect(
        settings.find((setting: StoredSetting) => {
          return setting._id === id;
        })?.alertByEmail,
      ).toBe(false);
    }
    expect(settings).toHaveLength(ROUTINE_EMAIL_EVENT_TYPES.length + 1);
  });

  test("retains deleted history and creates a new live opt-out", async () => {
    const deleted: StoredSetting = await seed({
      eventType: ROUTINE_EVENT,
      deleted: true,
    });
    await apply();
    const settings: Array<StoredSetting> = await rows();
    expect(
      settings.find((setting: StoredSetting) => {
        return setting._id === deleted._id;
      }),
    ).toEqual(deleted);
    expect(
      settings.filter((setting: StoredSetting) => {
        return (
          setting.eventType === ROUTINE_EVENT && setting.deletedAt === null
        );
      }),
    ).toEqual([expect.objectContaining({ alertByEmail: false })]);
  });

  test("rolls back existing changes when inserting a missing preference fails", async () => {
    const original: StoredSetting = await seed({ eventType: ROUTINE_EVENT });
    // A database constraint supplies a real statement failure after UPDATE.
    await database.query(
      'ALTER TABLE "UserNotificationSetting" ADD CONSTRAINT "fail_missing_preferences" CHECK ("eventType" = \'Send incident note posted notification when I am the owner of the incident\')',
    );
    try {
      await expect(apply()).rejects.toThrow();
      expect(await rows()).toEqual([original]);
    } finally {
      await database.query(
        'ALTER TABLE "UserNotificationSetting" DROP CONSTRAINT "fail_missing_preferences"',
      );
    }
    // The failed transaction also releases the advisory lock, so retry works.
    await apply();
    expect(await rows()).toHaveLength(ROUTINE_EMAIL_EVENT_TYPES.length);
  });
});
