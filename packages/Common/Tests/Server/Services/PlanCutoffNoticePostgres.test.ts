import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectService from "../../../Server/Services/ProjectService";
import PlanDowngradeOwnerNotice, {
  AlreadyBelowPlanNoticeSummary,
  PlanDowngradeNoticeOutcome,
} from "../../../Server/Utils/Billing/PlanDowngradeOwnerNotice";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { DataSource } from "typeorm";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * The plan cut-off notice on a migrated Postgres: the SQL the unit suites
 * stand in for (ProjectServicePlanCutoffNotice, PlanDowngradeOwnerNotice).
 *
 *   - ProjectService.claimPlanCutoffNotice, the one conditional UPDATE that
 *     decides "the owners of a project already below the plan are told
 *     once" - even when workers race for it - and its release and record;
 *   - the one-time notice end to end (notifyProjectsAlreadyBelowPlan, the
 *     data migration NotifyOwnersOfStoppedApiKeysAndScim): which projects
 *     are read, which are told, and that a second run tells no one.
 *
 * Opt in with RUN_POSTGRES_PLAN_CUTOFF_NOTICE_TESTS=true and
 * PLAN_CUTOFF_NOTICE_TEST_DATABASE_HOST/PORT/NAME pointing at a database the
 * migrations ran on. Every write goes to a schema of its own, made of
 * structure-only copies of the migrated tables (no rows are read or written
 * outside it).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PLAN_CUTOFF_NOTICE_TESTS"] === "true"
    ? describe
    : describe.skip;

// The plans OneUptime Cloud sells, as config.env names them.
const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PLAN_ID: Record<string, string> = {
  Free: "price_free_month",
  Growth: "price_growth_year",
  Scale: "price_scale_month",
};

describe("the plan cut-off notice on Postgres", () => {
  test("opt-in: set RUN_POSTGRES_PLAN_CUTOFF_NOTICE_TESTS=true to run against a migrated database", () => {
    expect(typeof describePostgres).toBe("function");
  });
});

describePostgres("the plan cut-off notice on Postgres", () => {
  const schema: string = `plan_cutoff_notice_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  const savedPlanEnvironment: Record<string, string | undefined> = {};
  let sentTo: Array<{ projectId: string; subject: string; html: string }> = [];
  // Projects whose owners' emails the mail service takes none of.
  let undeliverable: Set<string> = new Set<string>();
  // Projects with no owners (no accepted member of an owner team).
  let ownerless: Set<string> = new Set<string>();

  beforeAll(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SUBSCRIPTION_PLAN_")) {
        savedPlanEnvironment[key] = process.env[key];
        delete process.env[key];
      }
    }
    Object.assign(process.env, PLAN_ENVIRONMENT);

    database = new DataSource({
      type: "postgres",
      host: process.env["PLAN_CUTOFF_NOTICE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PLAN_CUTOFF_NOTICE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PLAN_CUTOFF_NOTICE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [
      "Project",
      "ApiKey",
      "ProjectSCIM",
      "StatusPageSCIM",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);

    for (const key of Object.keys(PLAN_ENVIRONMENT)) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(savedPlanEnvironment)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    sentTo = [];
    undeliverable = new Set<string>();
    ownerless = new Set<string>();
    setTestBillingEnabled(true);

    // Owners live in team tables this suite does not copy.
    jest
      .spyOn(ProjectService, "getOwners")
      .mockImplementation(async (projectId: ObjectID): Promise<Array<User>> => {
        if (ownerless.has(projectId.toString().toLowerCase())) {
          return [];
        }

        const owner: User = new User(ObjectID.generate());
        owner.email = new Email("owner@acme.example");
        return [owner];
      });

    jest
      .spyOn(ProjectService, "sendEmailToOwnersAndWait")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          owners: Array<User>;
          subject: string;
          message: string;
        }): Promise<number> => {
          if (undeliverable.has(data.projectId.toString().toLowerCase())) {
            return 0;
          }

          sentTo.push({
            projectId: data.projectId.toString(),
            subject: data.subject,
            html: data.message,
          });
          return data.owners.length;
        },
      );
  });

  afterEach(() => {
    (ProjectService.getOwners as unknown as jest.SpyInstance).mockRestore();
    (
      ProjectService.sendEmailToOwnersAndWait as unknown as jest.SpyInstance
    ).mockRestore();
  });

  async function seedProject(
    values: {
      plan?: string;
      deleted?: boolean;
      toldAt?: Date;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "paymentProviderPlanId", "deletedAt", "planCutoffNoticeSentAt") VALUES ($1, $2, $3, 1, $4, $5, $6)`,
      [
        id.toString(),
        "Acme Production",
        `acme-${id.toString()}`,
        values.plan ? PLAN_ID[values.plan] : null,
        values.deleted ? new Date() : null,
        values.toldAt || null,
      ],
    );

    return id;
  }

  async function seedApiKey(
    projectId: ObjectID,
    expiresInDays: number,
  ): Promise<void> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."ApiKey" ("_id", "name", "slug", "version", "apiKey", "expiresAt", "projectId") VALUES ($1, 'Terraform', $2, 1, $3, $4, $5)`,
      [
        id.toString(),
        `terraform-${id.toString()}`,
        ObjectID.generate().toString(),
        new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
        projectId.toString(),
      ],
    );
  }

  async function seedScim(
    projectId: ObjectID,
    table: "ProjectSCIM" | "StatusPageSCIM",
  ): Promise<void> {
    if (table === "ProjectSCIM") {
      await database.query(
        `INSERT INTO "${schema}"."ProjectSCIM" ("_id", "name", "version", "bearerToken", "projectId") VALUES ($1, 'Okta', 1, $2, $3)`,
        [
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          projectId.toString(),
        ],
      );
      return;
    }

    await database.query(
      `INSERT INTO "${schema}"."StatusPageSCIM" ("_id", "name", "version", "bearerToken", "projectId", "statusPageId") VALUES ($1, 'Entra ID', 1, $2, $3, $4)`,
      [
        ObjectID.generate().toString(),
        ObjectID.generate().toString(),
        projectId.toString(),
        ObjectID.generate().toString(),
      ],
    );
  }

  async function toldAt(projectId: ObjectID): Promise<Date | null> {
    const rows: Array<{ planCutoffNoticeSentAt: Date | null }> =
      await database.query(
        `SELECT "planCutoffNoticeSentAt" FROM "${schema}"."Project" WHERE "_id" = $1`,
        [projectId.toString()],
      );

    return rows[0]?.planCutoffNoticeSentAt || null;
  }

  describe("the claim", () => {
    test("the first claim writes the moment and wins; every later one loses and writes nothing", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Free" });
      const first: Date = new Date("2026-10-07T08:00:00.000Z");

      expect(
        await ProjectService.claimPlanCutoffNotice({ projectId, now: first }),
      ).toBe(true);
      expect(await toldAt(projectId)).toEqual(first);

      expect(
        await ProjectService.claimPlanCutoffNotice({
          projectId,
          now: new Date("2026-10-08T08:00:00.000Z"),
        }),
      ).toBe(false);
      expect(await toldAt(projectId)).toEqual(first);
    });

    test("workers racing for the same project: exactly one wins", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Free" });
      const at: Date = new Date("2026-10-07T12:00:00.000Z");

      const results: Array<boolean> = await Promise.all(
        Array.from({ length: 10 }, () => {
          return ProjectService.claimPlanCutoffNotice({ projectId, now: at });
        }),
      );

      expect(
        results.filter((won: boolean) => {
          return won;
        }),
      ).toHaveLength(1);
    });

    test("a deleted project is never claimed", async () => {
      const projectId: ObjectID = await seedProject({
        plan: "Free",
        deleted: true,
      });

      expect(
        await ProjectService.claimPlanCutoffNotice({
          projectId,
          now: new Date(),
        }),
      ).toBe(false);
      expect(await toldAt(projectId)).toBeNull();
    });

    test("giving back the claim made empties it, so the next run wins again", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Free" });
      const at: Date = new Date("2026-10-07T12:00:00.000Z");

      await ProjectService.claimPlanCutoffNotice({ projectId, now: at });
      await ProjectService.releasePlanCutoffNotice({
        projectId,
        claimedAt: at,
      });

      expect(await toldAt(projectId)).toBeNull();
      expect(
        await ProjectService.claimPlanCutoffNotice({
          projectId,
          now: new Date("2026-10-07T13:00:00.000Z"),
        }),
      ).toBe(true);
    });

    test("giving back another moment's claim changes nothing: one written since stays", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Free" });
      const at: Date = new Date("2026-10-07T12:00:00.000Z");

      await ProjectService.claimPlanCutoffNotice({ projectId, now: at });
      await ProjectService.releasePlanCutoffNotice({
        projectId,
        claimedAt: new Date("2026-10-07T11:00:00.000Z"),
      });

      expect(await toldAt(projectId)).toEqual(at);
    });

    test("a plan change that told the owners records it, and the one-time notice then loses", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Free" });
      const at: Date = new Date("2026-10-07T09:30:00.000Z");

      await ProjectService.markPlanCutoffNoticeSent({ projectId, now: at });

      expect(await toldAt(projectId)).toEqual(at);
      expect(
        await ProjectService.claimPlanCutoffNotice({
          projectId,
          now: new Date(),
        }),
      ).toBe(false);
    });
  });

  describe("the one-time notice, end to end", () => {
    test("tells the owners of each project below its plan once, and a second run tells no one", async () => {
      // Below Growth, with a live key: told.
      const freeWithKeys: ObjectID = await seedProject({ plan: "Free" });
      await seedApiKey(freeWithKeys, 30);
      await seedApiKey(freeWithKeys, 60);

      // Below Growth, with only an expired key: nothing to stop.
      const freeExpired: ObjectID = await seedProject({ plan: "Free" });
      await seedApiKey(freeExpired, -1);

      // Below Scale, with a project SCIM connection: told.
      const growthScim: ObjectID = await seedProject({ plan: "Growth" });
      await seedScim(growthScim, "ProjectSCIM");
      await seedApiKey(growthScim, 30);

      // Below Scale, with a status page's SCIM connection: told.
      const growthStatusPageScim: ObjectID = await seedProject({
        plan: "Growth",
      });
      await seedScim(growthStatusPageScim, "StatusPageSCIM");

      // On Scale: everything works, nothing to tell.
      const scale: ObjectID = await seedProject({ plan: "Scale" });
      await seedApiKey(scale, 30);
      await seedScim(scale, "ProjectSCIM");

      // Told already, by a plan change.
      const toldBefore: ObjectID = await seedProject({
        plan: "Free",
        toldAt: new Date("2026-10-07T09:00:00.000Z"),
      });
      await seedApiKey(toldBefore, 30);

      // Gone, and never given a plan.
      const deleted: ObjectID = await seedProject({
        plan: "Free",
        deleted: true,
      });
      await seedApiKey(deleted, 30);
      const noPlan: ObjectID = await seedProject({});
      await seedApiKey(noPlan, 30);

      const first: AlreadyBelowPlanNoticeSummary =
        await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan();

      expect(first).toEqual({
        projects: 7,
        told: 3,
        alreadyTold: 1,
        nothingStopped: 1,
        noPlan: 2,
        noOwners: 0,
        failed: 0,
      });

      expect(
        sentTo
          .map((sent: { projectId: string }) => {
            return sent.projectId.toLowerCase();
          })
          .sort(),
      ).toEqual(
        [freeWithKeys, growthScim, growthStatusPageScim]
          .map((id: ObjectID) => {
            return id.toString().toLowerCase();
          })
          .sort(),
      );

      const freeEmail: { subject: string; html: string } = sentTo.find(
        (sent: { projectId: string }) => {
          return (
            sent.projectId.toLowerCase() ===
            freeWithKeys.toString().toLowerCase()
          );
        },
      )!;

      expect(freeEmail.subject).toBe(
        "API keys stopped working in Acme Production",
      );
      expect(freeEmail.html).toContain(
        "The project&#39;s 2 API keys stopped working",
      );

      const growthEmail: { subject: string; html: string } = sentTo.find(
        (sent: { projectId: string }) => {
          return (
            sent.projectId.toLowerCase() === growthScim.toString().toLowerCase()
          );
        },
      )!;

      expect(growthEmail.subject).toBe(
        "SCIM stopped adding people in Acme Production",
      );

      for (const projectId of [
        freeWithKeys,
        growthScim,
        growthStatusPageScim,
      ]) {
        expect(await toldAt(projectId)).not.toBeNull();
      }

      expect(await toldAt(freeExpired)).toBeNull();
      expect(await toldAt(scale)).toBeNull();

      // Run again - a second worker, a restarted migration: nobody twice.
      sentTo = [];

      const second: AlreadyBelowPlanNoticeSummary =
        await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan();

      expect(sentTo).toEqual([]);
      expect(second.told).toBe(0);
      expect(second.alreadyTold).toBe(4);
    });

    test("two workers running it at once tell each project's owners once", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Free" });
      await seedApiKey(projectId, 30);

      const outcomes: Array<PlanDowngradeNoticeOutcome> = await Promise.all([
        PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
        PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
        PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
      ]);

      expect(
        outcomes.filter((outcome: PlanDowngradeNoticeOutcome) => {
          return outcome === PlanDowngradeNoticeOutcome.Told;
        }),
      ).toHaveLength(1);
      expect(sentTo).toHaveLength(1);
    });

    test("a project whose owners' emails all fail is given back on the row, and the next run tells them", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Free" });
      await seedApiKey(projectId, 30);
      undeliverable.add(projectId.toString().toLowerCase());

      expect(
        await PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
      ).toBe(PlanDowngradeNoticeOutcome.Failed);
      expect(await toldAt(projectId)).toBeNull();

      // The mail service is back: running it again tells them, once.
      undeliverable.clear();

      expect(
        await PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
      ).toBe(PlanDowngradeNoticeOutcome.Told);
      expect(await toldAt(projectId)).not.toBeNull();
      expect(sentTo).toHaveLength(1);

      expect(
        await PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
      ).toBe(PlanDowngradeNoticeOutcome.AlreadyTold);
      expect(sentTo).toHaveLength(1);
    });

    test("a project with no owners is left unclaimed, so a run after an owner joins tells them", async () => {
      const projectId: ObjectID = await seedProject({ plan: "Growth" });
      await seedScim(projectId, "ProjectSCIM");
      ownerless.add(projectId.toString().toLowerCase());

      expect(
        await PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
      ).toBe(PlanDowngradeNoticeOutcome.NoOwners);
      expect(await toldAt(projectId)).toBeNull();
      expect(sentTo).toEqual([]);

      ownerless.clear();

      expect(
        await PlanDowngradeOwnerNotice.notifyIfAlreadyBelowPlan({ projectId }),
      ).toBe(PlanDowngradeNoticeOutcome.Told);
      expect(await toldAt(projectId)).not.toBeNull();
    });

    test("billing off reads nothing and sends nothing", async () => {
      setTestBillingEnabled(false);

      const projectId: ObjectID = await seedProject({ plan: "Free" });
      await seedApiKey(projectId, 30);

      expect(
        (await PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan())
          .projects,
      ).toBe(0);
      expect(sentTo).toEqual([]);
      expect(await toldAt(projectId)).toBeNull();
    });
  });
});
