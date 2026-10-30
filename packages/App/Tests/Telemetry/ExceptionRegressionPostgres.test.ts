import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import Entities from "Common/Models/DatabaseModels/Index";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { DataSource } from "Common/node_modules/typeorm";

/*
 * A RESOLVED EXCEPTION THAT COMES BACK, ON POSTGRES.
 *
 * The exception group upsert (ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch)
 * is one INSERT ... ON CONFLICT DO UPDATE, and what it does to a resolved
 * row is the whole of regression detection:
 *
 *   - an occurrence that happened after the exception was resolved reopens
 *     it and stamps regressedAt - the exception reads Regressed;
 *   - one that happened before (a backed-up queue delivering it late) does
 *     not: the fix did not fail, and who resolved it, and when, stay;
 *   - resolved in the next release, the release it was resolved after does
 *     not reopen it (old pods during a rollout), nor does an occurrence that
 *     names no release; any other release does;
 *   - the last seen release only moves with the latest occurrence, so an
 *     out-of-order batch cannot roll it back.
 *
 * It used to reopen on every occurrence and record nothing. The unit suites
 * fake `manager.query`, so only a real Postgres runs the CASEs.
 *
 * Opt in with RUN_POSTGRES_EXCEPTION_REGRESSION_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The migrated
 * TelemetryException's STRUCTURE (its unique index on the conflict key
 * included) is cloned into a unique schema that is dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * EXCEPTION_REGRESSION_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * EXCEPTION_REGRESSION_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EXCEPTION_REGRESSION_TESTS"] === "true"
    ? describe
    : describe.skip;

const MINUTE_MS: number = 60 * 1000;

interface GroupRow {
  _id: string;
  isResolved: boolean;
  isArchived: boolean;
  occuranceCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstSeenInRelease: string | null;
  lastSeenInRelease: string | null;
  markedAsResolvedAt: Date | null;
  markedAsResolvedByUserId: string | null;
  resolvedInReleaseAfter: string | null;
  regressedAt: Date | null;
}

describePostgres("exception regressions against Postgres", () => {
  const schema: string = `exception_regression_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const serviceId: ObjectID = ObjectID.generate();
  const resolverId: ObjectID = ObjectID.generate();
  let database: DataSource;

  function minutesAgo(minutes: number): Date {
    return new Date(Date.now() - minutes * MINUTE_MS);
  }

  function occurrence(
    fingerprint: string,
    overrides: Partial<TelemetryExceptionPayload> = {},
  ): TelemetryExceptionPayload {
    return {
      fingerprint: fingerprint,
      projectId: projectId,
      primaryEntityId: serviceId,
      primaryEntityType: ServiceType.OpenTelemetry,
      exceptionType: "TypeError",
      message: "Cannot read properties of undefined (reading 'id')",
      stackTrace: "TypeError: x\n    at checkout (cart.js:10:5)",
      ...overrides,
    };
  }

  async function ingest(
    payloads: Array<TelemetryExceptionPayload>,
  ): Promise<void> {
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(payloads);
  }

  async function read(fingerprint: string): Promise<GroupRow> {
    const rows: Array<GroupRow> = await database.query(
      `SELECT "_id", "isResolved", "isArchived", "occuranceCount",
              "firstSeenAt", "lastSeenAt", "firstSeenInRelease",
              "lastSeenInRelease", "markedAsResolvedAt",
              "markedAsResolvedByUserId", "resolvedInReleaseAfter",
              "regressedAt"
       FROM "${schema}"."TelemetryException"
       WHERE "projectId" = $1 AND "primaryEntityId" = $2 AND "fingerprint" = $3`,
      [projectId.toString(), serviceId.toString(), fingerprint],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  // A person resolving it, as the API writes it.
  async function resolve(
    fingerprint: string,
    data: { at: Date; inReleaseAfter?: string | undefined; archive?: boolean },
  ): Promise<void> {
    await database.query(
      `UPDATE "${schema}"."TelemetryException"
       SET "isResolved" = true, "markedAsResolvedAt" = $4,
           "markedAsResolvedByUserId" = $5, "resolvedInReleaseAfter" = $6,
           "regressedAt" = NULL, "isArchived" = $7
       WHERE "projectId" = $1 AND "primaryEntityId" = $2 AND "fingerprint" = $3`,
      [
        projectId.toString(),
        serviceId.toString(),
        fingerprint,
        data.at,
        resolverId.toString(),
        data.inReleaseAfter ?? null,
        data.archive === true,
      ],
    );
  }

  function expectNow(value: Date | null): void {
    expect(value).not.toBeNull();
    expect(Math.abs(new Date(value!).getTime() - Date.now())).toBeLessThan(
      5 * MINUTE_MS,
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["EXCEPTION_REGRESSION_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EXCEPTION_REGRESSION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EXCEPTION_REGRESSION_TEST_DATABASE_NAME"] ||
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
      `CREATE TABLE "${schema}"."TelemetryException" (LIKE public."TelemetryException" INCLUDING ALL)`,
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: database.manager,
    } as never);
    await database.query(`DELETE FROM "${schema}"."TelemetryException"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a new exception is kept by its occurrences' own times and releases", async () => {
    await ingest([
      occurrence("fp-new", { occurredAt: minutesAgo(30), release: "2.3.1" }),
      occurrence("fp-new", { occurredAt: minutesAgo(5), release: "2.3.2" }),
    ]);

    const row: GroupRow = await read("fp-new");
    expect(row.isResolved).toBe(false);
    expect(row.occuranceCount).toBe(2);
    expect(Math.abs(row.firstSeenAt!.getTime() - minutesAgo(30).getTime()))
      .toBeLessThan(MINUTE_MS);
    expect(Math.abs(row.lastSeenAt!.getTime() - minutesAgo(5).getTime()))
      .toBeLessThan(MINUTE_MS);
    expect(row.firstSeenInRelease).toBe("2.3.1");
    expect(row.lastSeenInRelease).toBe("2.3.2");
    expect(row.regressedAt).toBeNull();
  });

  test("an occurrence after the resolve reopens it as Regressed", async () => {
    await ingest([occurrence("fp-back", { occurredAt: minutesAgo(120) })]);
    await resolve("fp-back", { at: minutesAgo(60) });

    await ingest([occurrence("fp-back", { occurredAt: minutesAgo(1) })]);

    const row: GroupRow = await read("fp-back");
    expect(row.isResolved).toBe(false);
    expectNow(row.regressedAt);
    expect(row.markedAsResolvedAt).toBeNull();
    expect(row.markedAsResolvedByUserId).toBeNull();
    expect(row.occuranceCount).toBe(2);
  });

  test("an occurrence from before the resolve, delivered late, does not reopen it", async () => {
    await ingest([occurrence("fp-late", { occurredAt: minutesAgo(120) })]);
    const resolvedAt: Date = minutesAgo(60);
    await resolve("fp-late", { at: resolvedAt });

    // Happened 90 minutes ago, before the resolve; reaches ingest now.
    await ingest([occurrence("fp-late", { occurredAt: minutesAgo(90) })]);

    const row: GroupRow = await read("fp-late");
    expect(row.isResolved).toBe(true);
    expect(row.regressedAt).toBeNull();
    expect(row.markedAsResolvedAt!.getTime()).toBe(resolvedAt.getTime());
    expect(row.markedAsResolvedByUserId).toBe(resolverId.toString());
    // Still counted, and seen at its own time.
    expect(row.occuranceCount).toBe(2);
    expect(Math.abs(row.lastSeenAt!.getTime() - minutesAgo(90).getTime()))
      .toBeLessThan(MINUTE_MS);
  });

  test("resolved in the next release: its own release and a release-less occurrence do not reopen it, the next release does", async () => {
    await ingest([
      occurrence("fp-rollout", { occurredAt: minutesAgo(120), release: "2.3.1" }),
    ]);
    await resolve("fp-rollout", { at: minutesAgo(60), inReleaseAfter: "2.3.1" });

    // Old pods still on 2.3.1 during the rollout.
    await ingest([
      occurrence("fp-rollout", { occurredAt: minutesAgo(10), release: "2.3.1" }),
    ]);
    let row: GroupRow = await read("fp-rollout");
    expect(row.isResolved).toBe(true);
    expect(row.resolvedInReleaseAfter).toBe("2.3.1");
    expect(row.regressedAt).toBeNull();

    // An occurrence that cannot say which release it came from.
    await ingest([occurrence("fp-rollout", { occurredAt: minutesAgo(8) })]);
    row = await read("fp-rollout");
    expect(row.isResolved).toBe(true);

    // The next release still throws it: the fix did not ship.
    await ingest([
      occurrence("fp-rollout", { occurredAt: minutesAgo(2), release: "2.3.2" }),
    ]);
    row = await read("fp-rollout");
    expect(row.isResolved).toBe(false);
    expectNow(row.regressedAt);
    expect(row.resolvedInReleaseAfter).toBeNull();
    expect(row.markedAsResolvedAt).toBeNull();
    expect(row.lastSeenInRelease).toBe("2.3.2");
    expect(row.occuranceCount).toBe(4);
  });

  test("an exception nobody resolved never reads as Regressed", async () => {
    await ingest([occurrence("fp-open", { occurredAt: minutesAgo(30) })]);
    await ingest([occurrence("fp-open", { occurredAt: minutesAgo(1) })]);

    const row: GroupRow = await read("fp-open");
    expect(row.isResolved).toBe(false);
    expect(row.regressedAt).toBeNull();
  });

  test("an archived exception that comes back stays archived, and reads Regressed", async () => {
    await ingest([occurrence("fp-archived", { occurredAt: minutesAgo(120) })]);
    await resolve("fp-archived", { at: minutesAgo(60), archive: true });

    await ingest([occurrence("fp-archived", { occurredAt: minutesAgo(1) })]);

    const row: GroupRow = await read("fp-archived");
    expect(row.isArchived).toBe(true);
    expect(row.isResolved).toBe(false);
    expectNow(row.regressedAt);
  });

  test("a row resolved before resolution times were kept reopens on any occurrence", async () => {
    await ingest([occurrence("fp-legacy", { occurredAt: minutesAgo(120) })]);
    await database.query(
      `UPDATE "${schema}"."TelemetryException" SET "isResolved" = true, "markedAsResolvedAt" = NULL
       WHERE "fingerprint" = 'fp-legacy'`,
    );

    await ingest([occurrence("fp-legacy", { occurredAt: minutesAgo(100) })]);

    const row: GroupRow = await read("fp-legacy");
    expect(row.isResolved).toBe(false);
    expectNow(row.regressedAt);
  });

  test("an out-of-order batch does not roll the last seen release back", async () => {
    await ingest([
      occurrence("fp-order", { occurredAt: minutesAgo(5), release: "2.3.2" }),
    ]);
    await ingest([
      occurrence("fp-order", { occurredAt: minutesAgo(20), release: "2.3.1" }),
    ]);

    const row: GroupRow = await read("fp-order");
    expect(row.lastSeenInRelease).toBe("2.3.2");
    expect(Math.abs(row.lastSeenAt!.getTime() - minutesAgo(5).getTime()))
      .toBeLessThan(MINUTE_MS);
    expect(Math.abs(row.firstSeenAt!.getTime() - minutesAgo(20).getTime()))
      .toBeLessThan(MINUTE_MS);
  });

  test("a regression is stamped once per comeback: an open exception's later occurrences keep its time", async () => {
    await ingest([occurrence("fp-twice", { occurredAt: minutesAgo(120) })]);
    await resolve("fp-twice", { at: minutesAgo(60) });
    await ingest([occurrence("fp-twice", { occurredAt: minutesAgo(3) })]);

    const first: Date = (await read("fp-twice")).regressedAt!;
    await database.query(
      `UPDATE "${schema}"."TelemetryException" SET "regressedAt" = $1 WHERE "fingerprint" = 'fp-twice'`,
      [minutesAgo(3)],
    );

    await ingest([occurrence("fp-twice", { occurredAt: minutesAgo(1) })]);

    const row: GroupRow = await read("fp-twice");
    expect(first).not.toBeNull();
    expect(Math.abs(row.regressedAt!.getTime() - minutesAgo(3).getTime()))
      .toBeLessThan(MINUTE_MS);
  });
});
