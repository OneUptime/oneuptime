import Entities from "../../../Models/DatabaseModels/Index";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MailService from "../../../Server/Services/MailService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService, {
  ALREADY_SUBSCRIBED_MESSAGE,
  CONTACT_ALREADY_SUBSCRIBED_MESSAGE,
} from "../../../Server/Services/StatusPageSubscriberService";
import logger from "../../../Server/Utils/Logger";
import SubscriberContactSql from "../../../Server/Utils/StatusPage/SubscriberContactSql";
import StatusPageSubscriberWebhookUtil from "../../../Server/Utils/StatusPageSubscriberWebhook";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import SubscriberContactKey from "../../../Types/StatusPage/SubscriberContactKey";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  // The Free plan's allowance, pinned: an install can change it.
  Object.defineProperty(mocked, "AllowedSubscribersCountInFreePlan", {
    enumerable: true,
    value: 100,
  });

  return mocked;
});

/*
 * ONE CONTACT ONCE PER STATUS PAGE, HELD BY A REAL, MIGRATED POSTGRES.
 *
 * A status page takes each phone number, email address and webhook once,
 * however it is written (SubscriberContactKey): asked in the subscriber's
 * onBeforeCreate, and again in its INSERT's own transaction, under the
 * page's lock - or, on the Free plan, the project's
 * (StatusPageSubscriberService.getCreateLimit, ProjectLimitLock). Only
 * Postgres can show the two together: creates of one number written twelve
 * ways, held once every one of them has passed the early check until all
 * have, still leave one subscriber; and the SQL that reads a stored number's
 * line (SubscriberContactSql) finds what SubscriberContactKey says it should.
 *
 * Every create goes through the real service, as a visitor signing up
 * (createFromStatusPageSignUp) or the team adding a subscriber. Email, SMS,
 * webhooks, live updates and workflows are stood in for.
 *
 * Opt in with RUN_POSTGRES_SUBSCRIBER_CONTACT_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database, right after its drift check. Every table's STRUCTURE is cloned
 * into a unique schema (first on the search_path), dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * SUBSCRIBER_CONTACT_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * SUBSCRIBER_CONTACT_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SUBSCRIBER_CONTACT_TESTS"] === "true"
    ? describe
    : describe.skip;

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
};

const SCHEMA_NAME_DASHES: RegExp = /-/g;

// More creates at once than the connection pool has connections.
const RACING_CREATES: number = 12;
const POOL_SIZE: number = 10;

// +1 (415) 555-0100, twelve ways.
const ONE_NUMBER: Array<string> = [
  "+14155550100",
  "14155550100",
  "+(141)55550100",
  "(141)55550100",
  "+141-555-50100",
  "141-555-50100",
  "+141.555.50100",
  "141 555 50100",
  "0014155550100",
  "(001)4155550100",
  "+(141) 555 50100",
  "141\t555\t50100",
];

// One webhook, twelve ways.
const ONE_WEBHOOK: Array<string> = [
  "https://subscriber.example.net/hook",
  "https://SUBSCRIBER.example.net/hook",
  "https://subscriber.EXAMPLE.net/hook",
  "https://subscriber.example.NET/hook",
  "https://subscriber.example.net:443/hook",
  "https://subscriber.example.net/hook#a",
  "https://subscriber.example.net/hook#b",
  "HTTPS://subscriber.example.net/hook",
  "https://subscriber.example.net/%68ook",
  "https://subscriber.example.net/h%6Fok",
  "https://subscriber.example.net/%68%6f%6f%6b",
  "https://subscriber.example.net/./hook",
];

interface Outcome {
  created: number;
  refusals: Array<string>;
}

describePostgres(
  "one contact once per status page, on a migrated Postgres",
  () => {
    const schema: string = `subscriber_contact_${ObjectID.generate()
      .toString()
      .replace(SCHEMA_NAME_DASHES, "")}`;

    const savedPlanEnvironment: Record<string, string | undefined> = {};

    let database: DataSource;
    let projectId: ObjectID;
    let pageId: ObjectID;
    let otherPageId: ObjectID;

    beforeAll(async () => {
      for (const [key, value] of Object.entries(PLAN_ENVIRONMENT)) {
        savedPlanEnvironment[key] = process.env[key];
        process.env[key] = value;
      }

      database = new DataSource({
        type: "postgres",
        host:
          process.env["SUBSCRIBER_CONTACT_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SUBSCRIBER_CONTACT_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SUBSCRIBER_CONTACT_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema},public`,
          max: POOL_SIZE,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      const tables: Array<string> = (
        await database.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'migrations'`,
        )
      ).map((row: { table_name: string }): string => {
        return row.table_name;
      });

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    }, 300000);

    afterAll(async () => {
      for (const [key, value] of Object.entries(savedPlanEnvironment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      setTestBillingEnabled(true);

      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
      jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never);
      jest
        .spyOn(StatusPageSubscriberWebhookUtil, "sendWebhookNotification")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
        .mockResolvedValue(undefined);
      jest
        .spyOn(StatusPageService, "getStatusPageURL")
        .mockResolvedValue("https://status.acme.com");

      // A project and its pages of their own per test.
      projectId = ObjectID.generate();
      pageId = ObjectID.generate();
      otherPageId = ObjectID.generate();
    });

    afterEach(async () => {
      // What a create leaves running after it returns ends first.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 1000);
      });
      jest.restoreAllMocks();
      setTestBillingEnabled(false);
    });

    async function insertProjectAndPages(
      plan: "free" | "growth",
    ): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug", "paymentProviderPlanId", "enableSmsNotifications") VALUES ($1, 1, 'Acme', $2, $3, true)`,
        [
          projectId.toString(),
          `acme-${projectId.toString()}`,
          `price_${plan}_month`,
        ],
      );

      for (const [id, slug] of [
        [pageId, "page-a"],
        [otherPageId, "page-b"],
      ] as Array<[ObjectID, string]>) {
        await database.query(
          `INSERT INTO "${schema}"."StatusPage" ("_id", "version", "projectId", "name", "slug", "pageTitle") VALUES ($1, 1, $2, $3, $4, 'Acme Status')`,
          [id.toString(), projectId.toString(), slug, `${slug}-${id}`],
        );
      }
    }

    async function subscribersOf(id: ObjectID): Promise<number> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count" FROM "${schema}"."StatusPageSubscriber" WHERE "statusPageId" = $1 AND "deletedAt" IS NULL`,
        [id.toString()],
      );

      return rows[0]?.count ?? 0;
    }

    function subscriberOf(
      contact: Partial<StatusPageSubscriber>,
      statusPageId: ObjectID = pageId,
    ): StatusPageSubscriber {
      const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
      subscriber.projectId = projectId;
      subscriber.statusPageId = statusPageId;
      Object.assign(subscriber, contact);
      return subscriber;
    }

    function signUp(subscriber: StatusPageSubscriber): Promise<unknown> {
      subscriber.sendYouHaveSubscribedMessage = true;
      return StatusPageSubscriberService.createFromStatusPageSignUp(subscriber);
    }

    function teamAdd(subscriber: StatusPageSubscriber): Promise<unknown> {
      return StatusPageSubscriberService.create({
        data: subscriber,
        props: { isRoot: true },
      });
    }

    /*
     * Holds every create once its own checks and hooks have passed - the
     * early check of its contact among them - until `count` of them have
     * got there, then lets them all go at once. Past it, only the check
     * under the page's lock stands between them and the table.
     */
    function holdCreatesUntilAllPassedTheirChecks(count: number): void {
      let arrived: number = 0;
      let release: () => void = (): void => {
        return;
      };
      const allArrived: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          release = resolve;
        },
      );

      jest
        .spyOn(
          StatusPageSubscriberService as unknown as {
            onCreatePermitted: () => Promise<void>;
          },
          "onCreatePermitted",
        )
        .mockImplementation(async (): Promise<void> => {
          arrived++;

          if (arrived === count) {
            release();
          }

          await allArrived;
        });
    }

    async function createAtOnce(data: {
      count: number;
      hold: boolean;
      create: (index: number) => Promise<unknown>;
    }): Promise<Outcome> {
      if (data.hold) {
        holdCreatesUntilAllPassedTheirChecks(data.count);
      }

      const results: Array<PromiseSettledResult<unknown>> =
        await Promise.allSettled(
          Array.from(
            { length: data.count },
            (_value: unknown, index: number) => {
              return data.create(index);
            },
          ),
        );

      return {
        created: results.filter(
          (result: PromiseSettledResult<unknown>): boolean => {
            return result.status === "fulfilled";
          },
        ).length,
        refusals: results
          .filter((result: PromiseSettledResult<unknown>): boolean => {
            return result.status === "rejected";
          })
          .map((result: PromiseSettledResult<unknown>): string => {
            const reason: unknown = (result as { reason: unknown }).reason;
            expect(reason).toBeInstanceOf(BadDataException);
            return (reason as Error).message;
          }),
      };
    }

    test("the SQL reads a stored number's line as SubscriberContactKey does", async () => {
      await insertProjectAndPages("growth");

      const stored: Array<string> = [
        ...ONE_NUMBER,
        "+14155550101",
        "4155550100",
        "+4414155550100",
        "+0014155550100",
      ];

      for (const phone of stored) {
        await database.query(
          `INSERT INTO "${schema}"."StatusPageSubscriber" ("_id", "version", "projectId", "statusPageId", "subscriberPhone", "unsubscribeToken") VALUES ($1, 1, $2, $3, $4, $5)`,
          [
            ObjectID.generate().toString(),
            projectId.toString(),
            pageId.toString(),
            phone,
            "5c".repeat(32),
          ],
        );
      }

      for (const asked of [
        "+14155550100",
        "0014155550100",
        "4155550100",
        "+4414155550100",
        "+14155550101",
      ]) {
        const found: Array<StatusPageSubscriber> =
          await StatusPageSubscriberService.findBy({
            query: {
              statusPageId: pageId,
              subscriberPhone: SubscriberContactSql.onPhoneLine(asked),
            },
            select: { _id: true, subscriberPhone: true },
            limit: 100,
            skip: 0,
            props: { isRoot: true },
          });

        expect([
          asked,
          found
            .map((row: StatusPageSubscriber): string => {
              return row.subscriberPhone!.toString();
            })
            .sort(),
        ]).toEqual([
          asked,
          stored
            .filter((phone: string): boolean => {
              return SubscriberContactKey.isSamePhone(phone, asked);
            })
            .map((phone: string): string => {
              return new Phone(phone).toString();
            })
            .sort(),
        ]);
      }
    });

    test("twelve visitors sign one number up, twelve ways, held until all passed the early check: one subscriber", async () => {
      await insertProjectAndPages("growth");

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        hold: true,
        create: (index: number): Promise<unknown> => {
          return signUp(
            subscriberOf({ subscriberPhone: new Phone(ONE_NUMBER[index]!) }),
          );
        },
      });

      expect(outcome.created).toBe(1);
      expect(outcome.refusals).toEqual(
        Array.from({ length: RACING_CREATES - 1 }, (): string => {
          return ALREADY_SUBSCRIBED_MESSAGE;
        }),
      );
      expect(await subscribersOf(pageId)).toBe(1);
    });

    test("the team adding one webhook twelve ways, held the same: one subscriber", async () => {
      await insertProjectAndPages("growth");

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        hold: true,
        create: (index: number): Promise<unknown> => {
          return teamAdd(
            subscriberOf({
              subscriberWebhook: URL.fromString(ONE_WEBHOOK[index]!),
            }),
          );
        },
      });

      expect(outcome.created).toBe(1);
      expect(outcome.refusals).toEqual(
        Array.from({ length: RACING_CREATES - 1 }, (): string => {
          return CONTACT_ALREADY_SUBSCRIBED_MESSAGE;
        }),
      );
      expect(await subscribersOf(pageId)).toBe(1);
    });

    test("sent at the same moment, with nothing holding them: one subscriber", async () => {
      await insertProjectAndPages("growth");

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        hold: false,
        create: (index: number): Promise<unknown> => {
          return signUp(
            subscriberOf({ subscriberPhone: new Phone(ONE_NUMBER[index]!) }),
          );
        },
      });

      expect(outcome.created).toBe(1);
      expect(await subscribersOf(pageId)).toBe(1);
    });

    test("twelve different numbers, held the same: twelve subscribers", async () => {
      await insertProjectAndPages("growth");

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        hold: true,
        create: (index: number): Promise<unknown> => {
          return signUp(
            subscriberOf({
              subscriberPhone: new Phone(
                `+1415555${String(index).padStart(4, "0")}`,
              ),
            }),
          );
        },
      });

      expect(outcome.created).toBe(RACING_CREATES);
      expect(await subscribersOf(pageId)).toBe(RACING_CREATES);
    });

    test("one number on two pages at once: a subscriber of each", async () => {
      await insertProjectAndPages("growth");

      const outcome: Outcome = await createAtOnce({
        count: 2,
        hold: true,
        create: (index: number): Promise<unknown> => {
          return signUp(
            subscriberOf(
              { subscriberPhone: new Phone(ONE_NUMBER[index]!) },
              index === 0 ? pageId : otherPageId,
            ),
          );
        },
      });

      expect(outcome.created).toBe(2);
      expect(await subscribersOf(pageId)).toBe(1);
      expect(await subscribersOf(otherPageId)).toBe(1);
    });

    test("on the Free plan, under the project's lock: one subscriber", async () => {
      await insertProjectAndPages("free");

      const outcome: Outcome = await createAtOnce({
        count: RACING_CREATES,
        hold: true,
        create: (index: number): Promise<unknown> => {
          return signUp(
            subscriberOf({ subscriberPhone: new Phone(ONE_NUMBER[index]!) }),
          );
        },
      });

      expect(outcome.created).toBe(1);
      expect(await subscribersOf(pageId)).toBe(1);
    });

    test("a number that cancelled is no clash: it signs up again under another spelling, and the cancelled row goes", async () => {
      await insertProjectAndPages("growth");

      const cancelledId: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."StatusPageSubscriber" ("_id", "version", "projectId", "statusPageId", "subscriberPhone", "isUnsubscribed", "unsubscribeToken") VALUES ($1, 1, $2, $3, '14155550100', true, $4)`,
        [cancelledId, projectId.toString(), pageId.toString(), "5c".repeat(32)],
      );

      await signUp(
        subscriberOf({ subscriberPhone: new Phone("+141 555 50100") }),
      );

      const rows: Array<{ _id: string; isUnsubscribed: boolean }> =
        await database.query(
          `SELECT "_id", "isUnsubscribed" FROM "${schema}"."StatusPageSubscriber" WHERE "statusPageId" = $1 AND "deletedAt" IS NULL`,
          [pageId.toString()],
        );

      expect(rows).toHaveLength(1);
      expect(rows[0]!._id).not.toBe(cancelledId);
      expect(rows[0]!.isUnsubscribed).toBe(false);
    });
  },
);
