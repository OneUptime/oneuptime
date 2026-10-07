import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import BillingService from "../../../Server/Services/BillingService";
import NotificationService from "../../../Server/Services/NotificationService";
import ProjectService from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import BalanceAdjustmentType from "../../../Types/Billing/BalanceAdjustmentType";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The balance SMS, calls, WhatsApp and Telegram are paid from, on a migrated
 * Postgres: the SQL the unit suites stand in for.
 *
 *   - a recharge's credit is one statement that adds to whatever the
 *     balance is now: a message's cost taken while the payment provider
 *     answered is kept, and two recharges side by side both land (it used to
 *     write back "the balance read before the charge + the amount");
 *   - a message's cost is one statement that takes from whatever the balance
 *     is now, and answers what it became: messages sent together all pay
 *     (each used to write back "the balance it read - its cost");
 *   - Auto Recharge charges the card once however many messages find the
 *     balance low together (each used to charge it), and without the
 *     recharge lock it charges nothing;
 *   - the owners' low-balance email is claimed by one conditional UPDATE, so
 *     messages that find the balance used up together email them once, and
 *     a recharge (or a master admin adding balance) re-arms it.
 *
 * The payment provider, the shared cache and the lock are fakes (the lock is
 * a real mutual exclusion, in process); the project row is Postgres.
 *
 * Opt in with RUN_POSTGRES_MESSAGING_BALANCE_TESTS=true and
 * MESSAGING_BALANCE_TEST_DATABASE_HOST/PORT/NAME pointing at a database the
 * migrations ran on. Every write goes to a schema of its own, made of a
 * structure-only copy of the migrated Project table.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MESSAGING_BALANCE_TESTS"] === "true"
    ? describe
    : describe.skip;

// The balance is only charged where OneUptime bills (OneUptime Cloud).
jest.mock("../../../Server/BillingConfig", () => {
  return {
    __esModule: true,
    default: {
      IsBillingEnabled: true,
      BillingPublicKey: "pk_test_messaging_balance_postgres",
      BillingPrivateKey: "sk_test_messaging_balance_postgres",
      BillingWebhookSecret: "whsec_test_messaging_balance_postgres",
    },
  };
});

describe("The SMS and call balance on Postgres", () => {
  test("opt-in: set RUN_POSTGRES_MESSAGING_BALANCE_TESTS=true to run against a migrated database", () => {
    expect(typeof describePostgres).toBe("function");
  });
});

interface BalanceRow {
  smsOrCallCurrentBalanceInUSDCents: number;
  lowCallAndSMSBalanceNotificationSentToOwners: boolean;
  failedCallAndSMSBalanceChargeNotificationSentToOwners: boolean;
  notEnabledSmsOrCallNotificationSentToOwners: boolean;
  version: number;
  updatedAt: Date;
}

describePostgres("The SMS and call balance on Postgres", () => {
  const schema: string = `messaging_balance_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  // The fakes: what the payment provider charged, the cache and the lock.
  let charges: Array<number> = [];
  let chargeDelayInMs: number = 30;
  let cache: Map<string, string> = new Map<string, string>();
  let isCacheConnected: boolean = true;
  const heldLocks: Set<string> = new Set<string>();
  const lockQueues: Map<string, Array<() => void>> = new Map();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["MESSAGING_BALANCE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MESSAGING_BALANCE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MESSAGING_BALANCE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."Project" (LIKE public."Project" INCLUDING ALL)`,
    );

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    charges = [];
    chargeDelayInMs = 30;
    cache = new Map<string, string>();
    isCacheConnected = true;

    jest.spyOn(BillingService, "hasPaymentMethods").mockResolvedValue(true);
    jest
      .spyOn(BillingService, "generateInvoiceAndChargeCustomer")
      .mockImplementation((async (
        _customerId: string,
        _itemText: string,
        amountInUsd: number,
      ) => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, chargeDelayInMs);
        });
        charges.push(amountInUsd);
      }) as never);
    jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockResolvedValue(undefined);

    jest.spyOn(Redis, "isConnected").mockImplementation((): boolean => {
      return isCacheConnected;
    });
    jest.spyOn(GlobalCache, "getString").mockImplementation((async (
      namespace: string,
      key: string,
    ) => {
      return cache.get(`${namespace}-${key}`) || null;
    }) as never);
    jest.spyOn(GlobalCache, "setString").mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
    ) => {
      cache.set(`${namespace}-${key}`, value);
    }) as never);
    jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
      namespace: string,
      key: string,
    ) => {
      cache.delete(`${namespace}-${key}`);
    }) as never);
    jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);

    jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
      key: string;
      namespace: string;
    }) => {
      if (!isCacheConnected) {
        throw new Error("Redis client is not connected");
      }

      const name: string = `${data.namespace}-${data.key}`;

      while (heldLocks.has(name)) {
        await new Promise<void>((resolve: () => void) => {
          const queue: Array<() => void> = lockQueues.get(name) || [];
          queue.push(resolve);
          lockQueues.set(name, queue);
        });
      }

      heldLocks.add(name);
      return { name } as unknown as SemaphoreMutex;
    }) as never);
    jest.spyOn(Semaphore, "release").mockImplementation((async (
      mutex: SemaphoreMutex,
    ) => {
      const name: string = (mutex as unknown as { name: string }).name;
      heldLocks.delete(name);
      lockQueues.get(name)?.shift()?.();
    }) as never);

    // The failures below are deliberate; their log lines are not under test.
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    // Keep the data source mocks of beforeAll; drop the per-test spies.
    for (const spy of [
      BillingService.hasPaymentMethods,
      BillingService.generateInvoiceAndChargeCustomer,
      ProjectService.sendEmailToProjectOwners,
      Redis.isConnected,
      GlobalCache.getString,
      GlobalCache.setString,
      GlobalCache.deleteKey,
      GlobalCache.setStringIfNotExists,
      Semaphore.lock,
      Semaphore.release,
      logger.error,
    ]) {
      const mock: { mockRestore?: () => void } = spy as unknown as {
        mockRestore?: () => void;
      };
      mock.mockRestore?.();
    }
  });

  async function seedProject(
    values: {
      balanceInUSDCents?: number;
      autoRecharge?: boolean;
      lowBalanceToldOwners?: boolean;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "paymentProviderCustomerId", "smsOrCallCurrentBalanceInUSDCents", "enableAutoRechargeSmsOrCallBalance", "autoRechargeSmsOrCallByBalanceInUSD", "autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD", "lowCallAndSMSBalanceNotificationSentToOwners", "failedCallAndSMSBalanceChargeNotificationSentToOwners", "notEnabledSmsOrCallNotificationSentToOwners", "deletedAt") VALUES ($1, $2, $3, 1, $4, $5, $6, 20, 10, $7, true, true, $8)`,
      [
        id.toString(),
        "Acme Production",
        `acme-${id.toString()}`,
        "cus_messaging_balance_postgres",
        values.balanceInUSDCents ?? 0,
        values.autoRecharge ?? false,
        values.lowBalanceToldOwners ?? false,
        values.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function rowOf(projectId: ObjectID): Promise<BalanceRow> {
    const rows: Array<BalanceRow> = await database.query(
      `SELECT "smsOrCallCurrentBalanceInUSDCents", "lowCallAndSMSBalanceNotificationSentToOwners", "failedCallAndSMSBalanceChargeNotificationSentToOwners", "notEnabledSmsOrCallNotificationSentToOwners", "version", "updatedAt" FROM "${schema}"."Project" WHERE "_id" = $1`,
      [projectId.toString()],
    );

    return rows[0]!;
  }

  // Whatever else takes from the balance, in one statement of its own.
  async function takeFromBalanceElsewhere(
    projectId: ObjectID,
    amountInUSDCents: number,
  ): Promise<void> {
    await database.query(
      `UPDATE "${schema}"."Project" SET "smsOrCallCurrentBalanceInUSDCents" = "smsOrCallCurrentBalanceInUSDCents" - $1 WHERE "_id" = $2`,
      [amountInUSDCents, projectId.toString()],
    );
  }

  function wait(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }

  describe("a recharge's credit: one statement that adds", () => {
    test("a message's cost taken while the card was charged is kept", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 500,
      });
      chargeDelayInMs = 60;

      const recharge: Promise<number> = NotificationService.rechargeBalance(
        projectId,
        20,
        { sendOwnerConfirmationEmail: false },
      );

      await wait(20);
      await takeFromBalanceElsewhere(projectId, 7);

      // Was 2500: the recharge wrote back what it read before the charge.
      expect(await recharge).toBe(500 - 7 + 2000);
      expect((await rowOf(projectId)).smsOrCallCurrentBalanceInUSDCents).toBe(
        2493,
      );
    });

    test("two recharges by hand, side by side: both charges land as balance", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 0,
      });

      await Promise.all([
        NotificationService.rechargeBalance(projectId, 20, {
          sendOwnerConfirmationEmail: false,
        }),
        NotificationService.rechargeBalance(projectId, 30, {
          sendOwnerConfirmationEmail: false,
        }),
      ]);

      expect(
        [...charges].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual([20, 30]);
      expect((await rowOf(projectId)).smsOrCallCurrentBalanceInUSDCents).toBe(
        5000,
      );
    });

    test("the credit re-arms the owners' notices in the same statement", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 0,
        lowBalanceToldOwners: true,
      });

      await NotificationService.rechargeBalance(projectId, 20, {
        sendOwnerConfirmationEmail: false,
      });

      const row: BalanceRow = await rowOf(projectId);
      expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(2000);
      expect(row.lowCallAndSMSBalanceNotificationSentToOwners).toBe(false);
      expect(row.failedCallAndSMSBalanceChargeNotificationSentToOwners).toBe(
        false,
      );
      expect(row.notEnabledSmsOrCallNotificationSentToOwners).toBe(false);
    });

    test("ProjectService.creditSmsOrCallBalanceInUSDCents answers the balance it left", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: -3,
      });

      expect(
        await ProjectService.creditSmsOrCallBalanceInUSDCents({
          projectId,
          amountInUSDCents: 2000,
        }),
      ).toBe(1997);
    });
  });

  describe("a message's cost: one statement that takes", () => {
    test("twenty messages sent together all pay, and each is told the balance it left", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 1000,
      });

      const balances: Array<number | null> = await Promise.all(
        Array.from({ length: 20 }, () => {
          return ProjectService.deductSmsOrCallBalanceInUSDCents({
            projectId,
            amountInUSDCents: 7,
          });
        }),
      );

      // Was 993: each wrote back the balance it read, less its own cost.
      expect((await rowOf(projectId)).smsOrCallCurrentBalanceInUSDCents).toBe(
        1000 - 20 * 7,
      );

      // One statement each: every caller saw a balance of its own.
      expect(new Set(balances).size).toBe(20);
      expect(Math.min(...(balances as Array<number>))).toBe(860);
    });

    test("the cost is owed: the last cents spent twice leave the balance below zero, not forgiven", async () => {
      const projectId: ObjectID = await seedProject({ balanceInUSDCents: 5 });

      await Promise.all([
        ProjectService.deductSmsOrCallBalanceInUSDCents({
          projectId,
          amountInUSDCents: 5,
        }),
        ProjectService.deductSmsOrCallBalanceInUSDCents({
          projectId,
          amountInUSDCents: 5,
        }),
      ]);

      expect((await rowOf(projectId)).smsOrCallCurrentBalanceInUSDCents).toBe(
        -5,
      );
    });

    test("a message that went out re-arms the 'channel is off' notice, in the same statement", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 100,
      });

      expect(
        await ProjectService.deductSmsOrCallBalanceInUSDCents({
          projectId,
          amountInUSDCents: 10,
        }),
      ).toBe(90);

      const row: BalanceRow = await rowOf(projectId);
      expect(row.notEnabledSmsOrCallNotificationSentToOwners).toBe(false);
      // The low-balance notice is re-armed by a recharge, not by a send.
      expect(row.failedCallAndSMSBalanceChargeNotificationSentToOwners).toBe(
        true,
      );
    });

    test("no version bump: a message never fights somebody saving the project", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 100,
      });
      const before: BalanceRow = await rowOf(projectId);

      await ProjectService.deductSmsOrCallBalanceInUSDCents({
        projectId,
        amountInUSDCents: 10,
      });

      expect((await rowOf(projectId)).version).toBe(before.version);
    });

    test("a project that is gone answers nothing", async () => {
      expect(
        await ProjectService.deductSmsOrCallBalanceInUSDCents({
          projectId: ObjectID.generate(),
          amountInUSDCents: 10,
        }),
      ).toBeNull();
    });
  });

  describe("Auto Recharge when messages find the balance low", () => {
    test("ten messages at once: the card is charged once, and the row holds exactly its credit", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 0,
        autoRecharge: true,
      });

      const balances: Array<number> = await Promise.all(
        Array.from({ length: 10 }, () => {
          return NotificationService.rechargeIfBalanceIsLow(projectId);
        }),
      );

      // Was ten charges of 20 USD, and 20 USD of balance.
      expect(charges).toEqual([20]);
      expect((await rowOf(projectId)).smsOrCallCurrentBalanceInUSDCents).toBe(
        2000,
      );
      expect(new Set(balances)).toEqual(new Set([2000]));
    });

    test("messages sent while it charges the card pay from the balance as well", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 900,
        autoRecharge: true,
      });
      chargeDelayInMs = 60;

      const recharge: Promise<number> =
        NotificationService.rechargeIfBalanceIsLow(projectId);

      await wait(20);
      await Promise.all([
        ProjectService.deductSmsOrCallBalanceInUSDCents({
          projectId,
          amountInUSDCents: 7,
        }),
        ProjectService.deductSmsOrCallBalanceInUSDCents({
          projectId,
          amountInUSDCents: 35,
        }),
      ]);

      expect(await recharge).toBe(900 - 7 - 35 + 2000);
      expect(charges).toEqual([20]);
    });

    test("without the recharge lock (the shared cache is down) nothing is charged, and the balance is answered as it is", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 300,
        autoRecharge: true,
      });
      isCacheConnected = false;

      expect(await NotificationService.rechargeIfBalanceIsLow(projectId)).toBe(
        300,
      );
      expect(charges).toEqual([]);
      expect((await rowOf(projectId)).smsOrCallCurrentBalanceInUSDCents).toBe(
        300,
      );
    });

    test("Auto Recharge off: nothing is charged, the row is untouched", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: -35,
      });

      expect(await NotificationService.rechargeIfBalanceIsLow(projectId)).toBe(
        -35,
      );
      expect(charges).toEqual([]);
    });
  });

  describe("ProjectService.claimSmsOrCallLowBalanceNotice: the owners are told once each time it runs out", () => {
    test("the first claim sets the flag and wins; every later one loses", async () => {
      const projectId: ObjectID = await seedProject();

      expect(
        await ProjectService.claimSmsOrCallLowBalanceNotice(projectId),
      ).toBe(true);
      expect(
        (await rowOf(projectId)).lowCallAndSMSBalanceNotificationSentToOwners,
      ).toBe(true);
      expect(
        await ProjectService.claimSmsOrCallLowBalanceNotice(projectId),
      ).toBe(false);
    });

    test("messages racing: exactly one wins", async () => {
      const projectId: ObjectID = await seedProject();

      const results: Array<boolean> = await Promise.all(
        Array.from({ length: 8 }, () => {
          return ProjectService.claimSmsOrCallLowBalanceNotice(projectId);
        }),
      );

      expect(
        results.filter((won: boolean) => {
          return won;
        }),
      ).toHaveLength(1);
    });

    test("a deleted project is never told", async () => {
      const projectId: ObjectID = await seedProject({ deleted: true });

      expect(
        await ProjectService.claimSmsOrCallLowBalanceNotice(projectId),
      ).toBe(false);
    });

    test("a passive write: no version or updatedAt change", async () => {
      const projectId: ObjectID = await seedProject();
      const before: BalanceRow = await rowOf(projectId);

      await ProjectService.claimSmsOrCallLowBalanceNotice(projectId);

      const after: BalanceRow = await rowOf(projectId);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    test("a recharge re-arms it: told again the next time it runs out", async () => {
      const projectId: ObjectID = await seedProject({
        lowBalanceToldOwners: true,
      });

      expect(
        await ProjectService.claimSmsOrCallLowBalanceNotice(projectId),
      ).toBe(false);

      await NotificationService.rechargeBalance(projectId, 20, {
        sendOwnerConfirmationEmail: false,
      });

      expect(
        await ProjectService.claimSmsOrCallLowBalanceNotice(projectId),
      ).toBe(true);
    });

    test("a master admin adding balance re-arms it too", async () => {
      const projectId: ObjectID = await seedProject({
        lowBalanceToldOwners: true,
      });

      await ProjectService.adjustBalance({
        projectId,
        balanceType: ProjectBalanceType.SmsOrCall,
        adjustmentType: BalanceAdjustmentType.Add,
        amountInUSDCents: 500,
        reason: "Goodwill credit",
      });

      expect(
        await ProjectService.claimSmsOrCallLowBalanceNotice(projectId),
      ).toBe(true);
    });

    test("the AI credits' notice is a different flag: claiming one leaves the other", async () => {
      const projectId: ObjectID = await seedProject();

      expect(
        await ProjectService.claimSmsOrCallLowBalanceNotice(projectId),
      ).toBe(true);
      expect(await ProjectService.claimAiCreditsUsedUpNotice(projectId)).toBe(
        true,
      );
    });
  });
});
