import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AIBillingService from "../../../Server/Services/AIBillingService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import AiCreditsUsedUpOwnerNotice, {
  AiCreditsUsedUpNoticeOutcome,
} from "../../../Server/Utils/AI/AiCreditsUsedUpOwnerNotice";
import BalanceAdjustmentType from "../../../Types/Billing/BalanceAdjustmentType";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * When a project's AI credits run out, on a migrated Postgres: the SQL the
 * unit suites stand in for.
 *
 *   - ProjectService.claimAiCreditsUsedUpNotice, the one conditional UPDATE
 *     that decides "the owners are told once each time the AI credits run
 *     out" - even when servers race for it - and that a recharge re-arms;
 *   - the recharge's credit, one atomic add: the cost of AI calls billed
 *     while the payment provider answered is kept, and two recharges both
 *     land;
 *   - Auto Recharge before a call, end to end on the row: charged once
 *     however many callers ask together;
 *   - the owners' notice end to end, from the row to one email.
 *
 * The payment provider, the shared cache and the lock are fakes (the lock is
 * a real mutual exclusion, in process); the project row is Postgres.
 *
 * Opt in with RUN_POSTGRES_AI_CREDITS_TESTS=true and
 * AI_CREDITS_TEST_DATABASE_HOST/PORT/NAME pointing at a database the
 * migrations ran on. Every write goes to a schema of its own, made of a
 * structure-only copy of the migrated Project table.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_AI_CREDITS_TESTS"] === "true"
    ? describe
    : describe.skip;

// AI credits are only recharged where OneUptime bills (OneUptime Cloud).
jest.mock("../../../Server/BillingConfig", () => {
  return {
    __esModule: true,
    default: {
      IsBillingEnabled: true,
      BillingPublicKey: "pk_test_ai_credits_postgres",
      BillingPrivateKey: "sk_test_ai_credits_postgres",
      BillingWebhookSecret: "whsec_test_ai_credits_postgres",
    },
  };
});

describe("AI credits running out on Postgres", () => {
  test("opt-in: set RUN_POSTGRES_AI_CREDITS_TESTS=true to run against a migrated database", () => {
    expect(typeof describePostgres).toBe("function");
  });
});

describePostgres("AI credits running out on Postgres", () => {
  const schema: string = `ai_credits_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  // The fakes: what the payment provider charged, and the lock.
  let charges: Array<number> = [];
  let chargeDelayInMs: number = 30;
  let cache: Map<string, string> = new Map<string, string>();
  const heldLocks: Set<string> = new Set<string>();
  const lockQueues: Map<string, Array<() => void>> = new Map();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["AI_CREDITS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["AI_CREDITS_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AI_CREDITS_TEST_DATABASE_NAME"] ||
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

    // The shared cache is up: the recharge lock is taken from it.
    jest.spyOn(Redis, "isConnected").mockReturnValue(true);
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
      told?: boolean;
      deleted?: boolean;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "paymentProviderCustomerId", "aiCurrentBalanceInUSDCents", "enableAutoRechargeAiBalance", "autoAiRechargeByBalanceInUSD", "autoRechargeAiWhenCurrentBalanceFallsInUSD", "lowAiBalanceNotificationSentToOwners", "deletedAt") VALUES ($1, $2, $3, 1, $4, $5, $6, 20, 10, $7, $8)`,
      [
        id.toString(),
        "Acme Production",
        `acme-${id.toString()}`,
        "cus_ai_credits_postgres",
        values.balanceInUSDCents ?? 0,
        values.autoRecharge ?? false,
        values.told ?? false,
        values.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function rowOf(projectId: ObjectID): Promise<{
    aiCurrentBalanceInUSDCents: number;
    lowAiBalanceNotificationSentToOwners: boolean;
    version: number;
    updatedAt: Date;
  }> {
    const rows: Array<{
      aiCurrentBalanceInUSDCents: number;
      lowAiBalanceNotificationSentToOwners: boolean;
      version: number;
      updatedAt: Date;
    }> = await database.query(
      `SELECT "aiCurrentBalanceInUSDCents", "lowAiBalanceNotificationSentToOwners", "version", "updatedAt" FROM "${schema}"."Project" WHERE "_id" = $1`,
      [projectId.toString()],
    );

    return rows[0]!;
  }

  describe("ProjectService.claimAiCreditsUsedUpNotice: once each time they run out", () => {
    test("the first claim sets the flag and wins; every later one loses and writes nothing", async () => {
      const projectId: ObjectID = await seedProject();

      expect(await ProjectService.claimAiCreditsUsedUpNotice(projectId)).toBe(
        true,
      );
      expect(
        (await rowOf(projectId)).lowAiBalanceNotificationSentToOwners,
      ).toBe(true);
      expect(await ProjectService.claimAiCreditsUsedUpNotice(projectId)).toBe(
        false,
      );
    });

    test("servers racing: exactly one wins", async () => {
      const projectId: ObjectID = await seedProject();

      const results: Array<boolean> = await Promise.all(
        Array.from({ length: 8 }, () => {
          return ProjectService.claimAiCreditsUsedUpNotice(projectId);
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

      expect(await ProjectService.claimAiCreditsUsedUpNotice(projectId)).toBe(
        false,
      );
    });

    test("a passive write: no version or updatedAt change", async () => {
      const projectId: ObjectID = await seedProject();
      const before: { version: number; updatedAt: Date } =
        await rowOf(projectId);

      await ProjectService.claimAiCreditsUsedUpNotice(projectId);

      const after: { version: number; updatedAt: Date } =
        await rowOf(projectId);
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    test("a recharge re-arms it: told again the next time they run out", async () => {
      const projectId: ObjectID = await seedProject({ told: true });

      expect(await ProjectService.claimAiCreditsUsedUpNotice(projectId)).toBe(
        false,
      );

      await AIBillingService.rechargeBalance(projectId, 20, {
        sendOwnerConfirmationEmail: false,
      });

      expect(
        (await rowOf(projectId)).lowAiBalanceNotificationSentToOwners,
      ).toBe(false);
      expect(await ProjectService.claimAiCreditsUsedUpNotice(projectId)).toBe(
        true,
      );
    });

    test("a master admin adding credits re-arms it too", async () => {
      const projectId: ObjectID = await seedProject({ told: true });

      await ProjectService.adjustBalance({
        projectId,
        balanceType: ProjectBalanceType.AI,
        adjustmentType: BalanceAdjustmentType.Add,
        amountInUSDCents: 500,
        reason: "Goodwill credit",
      });

      expect(
        (await rowOf(projectId)).lowAiBalanceNotificationSentToOwners,
      ).toBe(false);
    });
  });

  describe("the recharge's credit: one atomic add", () => {
    test("the cost of an AI call billed while the card was charged is kept", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 100,
      });
      chargeDelayInMs = 60;

      const recharge: Promise<number> = AIBillingService.rechargeBalance(
        projectId,
        20,
        { sendOwnerConfirmationEmail: false },
      );

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
      await ProjectService.deductAiBalanceInUSDCents({
        projectId,
        amountInUSDCents: 40,
      });

      expect(await recharge).toBe(100 - 40 + 2000);
      expect((await rowOf(projectId)).aiCurrentBalanceInUSDCents).toBe(2060);
    });

    test("two recharges by hand, side by side: both charges land as credits", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 0,
      });

      await Promise.all([
        AIBillingService.rechargeBalance(projectId, 20, {
          sendOwnerConfirmationEmail: false,
        }),
        AIBillingService.rechargeBalance(projectId, 30, {
          sendOwnerConfirmationEmail: false,
        }),
      ]);

      expect(charges.sort()).toEqual([20, 30]);
      expect((await rowOf(projectId)).aiCurrentBalanceInUSDCents).toBe(5000);
    });
  });

  describe("Auto Recharge when the credits are used up", () => {
    test("ten callers at once: one charge, and the row holds exactly its credit", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: 0,
        autoRecharge: true,
      });

      const balances: Array<number> = await Promise.all(
        Array.from({ length: 10 }, () => {
          return AIBillingService.rechargeIfBalanceIsLow(projectId);
        }),
      );

      expect(charges).toEqual([20]);
      expect((await rowOf(projectId)).aiCurrentBalanceInUSDCents).toBe(2000);
      expect(new Set(balances)).toEqual(new Set([2000]));
    });

    test("Auto Recharge off: nothing is charged, the row is untouched", async () => {
      const projectId: ObjectID = await seedProject({
        balanceInUSDCents: -35,
      });

      expect(await AIBillingService.rechargeIfBalanceIsLow(projectId)).toBe(
        -35,
      );
      expect(charges).toEqual([]);
    });
  });

  describe("the owners' notice, from the row to one email", () => {
    test("used up: every check finds them used up, the owners are emailed once", async () => {
      const projectId: ObjectID = await seedProject({ balanceInUSDCents: 0 });

      const outcomes: Array<AiCreditsUsedUpNoticeOutcome> = [];

      for (let check: number = 0; check < 4; check++) {
        outcomes.push(
          await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId }),
        );
      }

      expect(outcomes).toEqual([
        AiCreditsUsedUpNoticeOutcome.Told,
        AiCreditsUsedUpNoticeOutcome.AlreadyTold,
        AiCreditsUsedUpNoticeOutcome.AlreadyTold,
        AiCreditsUsedUpNoticeOutcome.AlreadyTold,
      ]);
      expect(ProjectService.sendEmailToProjectOwners).toHaveBeenCalledTimes(1);
      expect(
        (ProjectService.sendEmailToProjectOwners as unknown as jest.SpyInstance)
          .mock.calls[0]![1],
      ).toBe("AI credits used up for Acme Production");
    });

    test("credits left: nobody is told, and the flag stays down", async () => {
      const projectId: ObjectID = await seedProject({ balanceInUSDCents: 1 });

      expect(
        await AiCreditsUsedUpOwnerNotice.notifyIfUsedUp({ projectId }),
      ).toBe(AiCreditsUsedUpNoticeOutcome.NotUsedUp);
      expect(
        (await rowOf(projectId)).lowAiBalanceNotificationSentToOwners,
      ).toBe(false);
    });
  });
});
