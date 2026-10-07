import Entities from "../../../Models/DatabaseModels/Index";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import logger from "../../../Server/Utils/Logger";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The Cloud Resource sweeps EXECUTED on Postgres. The unit suite
 * (CloudResourceServiceMonitoredResources) pins the SQL each one sends;
 * only a real database shows what those statements do to real rows:
 *
 *   - "Not reporting": a discovered resource whose metrics stopped is marked
 *     disconnected, an environment never is (it has a sweep of its own);
 *   - auto-archive: a resource silent for the archive period is archived
 *     and marked autoArchivedAt, oldest first - including one that never
 *     reported at all - and never an environment, nor a resource a person
 *     restored while it was silent;
 *   - restore: a resource the sweep archived comes back as soon as it
 *     reports again; one a person archived stays archived;
 *   - the budget's count is live resources only.
 *
 * Opt in with RUN_POSTGRES_CLOUD_RESOURCE_SWEEP_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The CloudResource
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema) that is dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from CLOUD_RESOURCE_SWEEP_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from CLOUD_RESOURCE_SWEEP_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_CLOUD_RESOURCE_SWEEP_TESTS"] === "true"
    ? describe
    : describe.skip;

// Columns a fixture row must fill; every other NOT NULL is relaxed.
const KEPT_NOT_NULL: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "version",
  "projectId",
  "isArchived",
  "cloudResourceKind",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

interface FixtureRow {
  name: string;
  kind: CloudResourceKind;
  status: "connected" | "disconnected";
  // Minutes ago; null for a row that never reported.
  lastSeenMinutesAgo: number | null;
  isArchived: boolean;
  // Minutes ago; null when the sweep never archived it.
  autoArchivedMinutesAgo: number | null;
  createdMinutesAgo: number;
  projectId?: ObjectID;
}

interface StateRow {
  name: string;
  otelCollectorStatus: string;
  isArchived: boolean;
  autoArchived: boolean;
  archivedAt: Date | null;
}

const MINUTE: number = 1;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

describePostgres("Cloud Resource sweeps against Postgres", () => {
  const schema: string = `cloud_resource_sweeps_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  const savedEnv: NodeJS.ProcessEnv = { ...process.env };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["CLOUD_RESOURCE_SWEEP_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["CLOUD_RESOURCE_SWEEP_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CLOUD_RESOURCE_SWEEP_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."CloudResource" (LIKE public."CloudResource" INCLUDING ALL)`,
    );
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'CloudResource' AND is_nullable = 'NO'`,
      [schema],
    );
    for (const column of columns) {
      if (!KEPT_NOT_NULL.includes(column.column_name)) {
        await database.query(
          `ALTER TABLE "${schema}"."CloudResource" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }
    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  });

  afterAll(async () => {
    process.env = { ...savedEnv };
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    delete process.env["CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS"];
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(logger, "error").mockImplementation((message: unknown) => {
      throw new Error(`a sweep logged an error: ${String(message)}`);
    });
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`DELETE FROM "${schema}"."CloudResource"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insert(rows: Array<FixtureRow>): Promise<void> {
    for (const row of rows) {
      await database.query(
        `INSERT INTO "${schema}"."CloudResource"
           ("_id", "version", "projectId", "name", "slug", "resourceIdentifier",
            "cloudResourceKind", "otelCollectorStatus", "lastSeenAt",
            "isArchived", "archivedAt", "autoArchivedAt", "createdAt")
         VALUES ($1, 1, $2, $3, $3, $4, $5, $6,
                 CASE WHEN $7::int IS NULL THEN NULL ELSE now() - make_interval(mins => $7::int) END,
                 $8,
                 CASE WHEN $8 THEN now() - interval '1 day' ELSE NULL END,
                 CASE WHEN $9::int IS NULL THEN NULL ELSE now() - make_interval(mins => $9::int) END,
                 now() - make_interval(mins => $10::int))`,
        [
          ObjectID.generate().toString(),
          (row.projectId || PROJECT_ID).toString(),
          row.name,
          row.kind === CloudResourceKind.Resource
            ? `azure:${row.name}`
            : `aws_ecs|${row.name}|us-east-1`,
          row.kind,
          row.status,
          row.lastSeenMinutesAgo,
          row.isArchived,
          row.autoArchivedMinutesAgo,
          row.createdMinutesAgo,
        ],
      );
    }
  }

  async function state(): Promise<Record<string, StateRow>> {
    const rows: Array<StateRow> = await database.query(
      `SELECT "name", "otelCollectorStatus", "isArchived",
              "autoArchivedAt" IS NOT NULL AS "autoArchived", "archivedAt"
       FROM "${schema}"."CloudResource" ORDER BY "name"`,
    );
    return Object.fromEntries(
      rows.map((row: StateRow): [string, StateRow] => {
        return [row.name, row];
      }),
    );
  }

  function resource(
    name: string,
    overrides: Partial<FixtureRow> = {},
  ): FixtureRow {
    return {
      name,
      kind: CloudResourceKind.Resource,
      status: "connected",
      lastSeenMinutesAgo: 5 * MINUTE,
      isArchived: false,
      autoArchivedMinutesAgo: null,
      createdMinutesAgo: 30 * DAY,
      ...overrides,
    };
  }

  function environment(
    name: string,
    overrides: Partial<FixtureRow> = {},
  ): FixtureRow {
    return {
      ...resource(name, overrides),
      kind: CloudResourceKind.Environment,
    };
  }

  describe("Not reporting", () => {
    test("marks a resource silent for an hour disconnected, and nothing else", async () => {
      await insert([
        resource("silent", { lastSeenMinutesAgo: 2 * HOUR }),
        resource("reporting", { lastSeenMinutesAgo: 10 * MINUTE }),
        resource("just-under", { lastSeenMinutesAgo: 59 * MINUTE }),
        environment("environment-silent", { lastSeenMinutesAgo: 2 * HOUR }),
      ]);

      await expect(
        CloudResourceService.markUnreportedMonitoredResources(),
      ).resolves.toBe(1);

      const rows: Record<string, StateRow> = await state();
      expect(rows["silent"]!.otelCollectorStatus).toBe("disconnected");
      expect(rows["reporting"]!.otelCollectorStatus).toBe("connected");
      expect(rows["just-under"]!.otelCollectorStatus).toBe("connected");
      expect(rows["environment-silent"]!.otelCollectorStatus).toBe("connected");
    });

    test("a second run changes nothing", async () => {
      await insert([resource("silent", { lastSeenMinutesAgo: 2 * HOUR })]);

      await CloudResourceService.markUnreportedMonitoredResources();

      await expect(
        CloudResourceService.markUnreportedMonitoredResources(),
      ).resolves.toBe(0);
    });
  });

  describe("auto-archive", () => {
    test("archives resources silent for the archive period, oldest first, never an environment", async () => {
      await insert([
        resource("silent-8-days", { lastSeenMinutesAgo: 8 * DAY }),
        resource("never-reported", {
          lastSeenMinutesAgo: null,
          createdMinutesAgo: 9 * DAY,
        }),
        resource("silent-6-days", { lastSeenMinutesAgo: 6 * DAY }),
        resource("new-never-reported", {
          lastSeenMinutesAgo: null,
          createdMinutesAgo: HOUR,
        }),
        environment("environment-silent-30-days", {
          lastSeenMinutesAgo: 30 * DAY,
        }),
      ]);

      await expect(
        CloudResourceService.archiveUnseenMonitoredResources(),
      ).resolves.toBe(2);

      const rows: Record<string, StateRow> = await state();
      for (const name of ["silent-8-days", "never-reported"]) {
        expect(rows[name]).toMatchObject({
          isArchived: true,
          autoArchived: true,
          otelCollectorStatus: "disconnected",
        });
        expect(rows[name]!.archivedAt).not.toBeNull();
      }
      for (const name of [
        "silent-6-days",
        "new-never-reported",
        "environment-silent-30-days",
      ]) {
        expect(rows[name]).toMatchObject({
          isArchived: false,
          autoArchived: false,
        });
      }
    });

    test("follows CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS", async () => {
      process.env["CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS"] = "2";
      await insert([
        resource("silent-3-days", { lastSeenMinutesAgo: 3 * DAY }),
        resource("silent-1-day", { lastSeenMinutesAgo: DAY }),
      ]);

      await expect(
        CloudResourceService.archiveUnseenMonitoredResources(),
      ).resolves.toBe(1);

      expect((await state())["silent-3-days"]!.isArchived).toBe(true);
    });

    test("leaves a resource a person restored while it was silent", async () => {
      await insert([
        resource("restored-by-a-person", {
          lastSeenMinutesAgo: 8 * DAY,
          autoArchivedMinutesAgo: DAY,
        }),
      ]);

      await expect(
        CloudResourceService.archiveUnseenMonitoredResources(),
      ).resolves.toBe(0);
      expect((await state())["restored-by-a-person"]!.isArchived).toBe(false);
    });

    test("a resource a person archived is not archived again", async () => {
      await insert([
        resource("archived-by-a-person", {
          lastSeenMinutesAgo: 8 * DAY,
          isArchived: true,
        }),
      ]);

      await expect(
        CloudResourceService.archiveUnseenMonitoredResources(),
      ).resolves.toBe(0);
      expect((await state())["archived-by-a-person"]!.autoArchived).toBe(false);
    });
  });

  describe("restore", () => {
    test("brings back a resource the sweep archived once it reports, never one a person archived", async () => {
      await insert([
        resource("swept-now-reporting", {
          isArchived: true,
          autoArchivedMinutesAgo: DAY,
          lastSeenMinutesAgo: MINUTE,
        }),
        resource("swept-still-silent", {
          isArchived: true,
          autoArchivedMinutesAgo: DAY,
          lastSeenMinutesAgo: 8 * DAY,
        }),
        resource("archived-by-a-person-reporting", {
          isArchived: true,
          lastSeenMinutesAgo: MINUTE,
        }),
        resource("restored-by-a-person-reporting", {
          autoArchivedMinutesAgo: 2 * DAY,
          lastSeenMinutesAgo: MINUTE,
        }),
      ]);

      await expect(
        CloudResourceService.restoreReportingMonitoredResources(),
      ).resolves.toBe(1);

      const rows: Record<string, StateRow> = await state();
      expect(rows["swept-now-reporting"]).toMatchObject({
        isArchived: false,
        autoArchived: false,
        archivedAt: null,
      });
      expect(rows["swept-still-silent"]).toMatchObject({
        isArchived: true,
        autoArchived: true,
      });
      expect(rows["archived-by-a-person-reporting"]).toMatchObject({
        isArchived: true,
        autoArchived: false,
      });
      // Its mark is forgotten once it reports, so the sweep may archive it again later.
      expect(rows["restored-by-a-person-reporting"]).toMatchObject({
        isArchived: false,
        autoArchived: false,
      });
    });

    test("a full worker pass: restore first, then archive, leaves a reporting resource live", async () => {
      await insert([
        resource("swept-now-reporting", {
          isArchived: true,
          autoArchivedMinutesAgo: DAY,
          lastSeenMinutesAgo: MINUTE,
        }),
        resource("silent", { lastSeenMinutesAgo: 8 * DAY }),
      ]);

      await CloudResourceService.restoreReportingMonitoredResources();
      await CloudResourceService.archiveUnseenMonitoredResources();

      const rows: Record<string, StateRow> = await state();
      expect(rows["swept-now-reporting"]!.isArchived).toBe(false);
      expect(rows["silent"]!.isArchived).toBe(true);
    });
  });

  describe("the budget's count", () => {
    test("counts the project's live resources only", async () => {
      await insert([
        resource("live-1"),
        resource("live-2", { status: "disconnected" }),
        resource("archived", { isArchived: true }),
        environment("environment"),
        resource("other-project", { projectId: OTHER_PROJECT_ID }),
      ]);

      await expect(
        CloudResourceService.countLiveMonitoredResources(PROJECT_ID),
      ).resolves.toBe(2);
    });
  });

  describe("a person archiving a resource", () => {
    test("forgets the sweep's mark, so their archive is never undone", async () => {
      await insert([
        resource("swept-then-archived-by-a-person", {
          isArchived: true,
          autoArchivedMinutesAgo: DAY,
          lastSeenMinutesAgo: MINUTE,
        }),
      ]);
      const rows: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."CloudResource"`,
      );

      await (
        CloudResourceService as unknown as {
          forgetAutoArchive: (ids: Array<ObjectID>) => Promise<void>;
        }
      ).forgetAutoArchive([new ObjectID(rows[0]!._id)]);
      await CloudResourceService.restoreReportingMonitoredResources();

      expect((await state())["swept-then-archived-by-a-person"]).toMatchObject({
        isArchived: true,
        autoArchived: false,
      });
    });
  });

  describe("finding a resource's row", () => {
    test("finds an archived row by its identifier, in any case", async () => {
      await insert([resource("vm-1", { isArchived: true })]);

      const row: CloudResource | null = await (
        CloudResourceService as unknown as {
          findMonitoredResourceRow: (
            projectId: ObjectID,
            identifier: string,
          ) => Promise<CloudResource | null>;
        }
      ).findMonitoredResourceRow(PROJECT_ID, "AZURE:VM-1");

      expect(row).not.toBeNull();
      expect(row!.isArchived).toBe(true);
      expect(row!.cloudResourceKind).toBe(CloudResourceKind.Resource);
    });
  });
});
