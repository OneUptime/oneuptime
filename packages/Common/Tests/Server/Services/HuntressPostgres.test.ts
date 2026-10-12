import Entities from "../../../Models/DatabaseModels/Index";
import HuntressConnection from "../../../Models/DatabaseModels/HuntressConnection";
import HuntressIncidentReport from "../../../Models/DatabaseModels/HuntressIncidentReport";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import HuntressConnectionService from "../../../Server/Services/HuntressConnectionService";
import HuntressIncidentReportService from "../../../Server/Services/HuntressIncidentReportService";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import HuntressIncidentReportOutcome from "../../../Types/Huntress/HuntressIncidentReportOutcome";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import { DataSource, Logger } from "typeorm";

/*
 * Huntress connections and incident reports against a migrated Postgres.
 *
 * Opt in with RUN_POSTGRES_HUNTRESS_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_HUNTRESS_TESTS=true \
 *   HUNTRESS_TEST_DATABASE_HOST=127.0.0.1 HUNTRESS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/HuntressPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml ("Test Huntress
 * connections and report claims on migrated Postgres"), right after that job
 * has applied every registered migration to an empty database.
 *
 * Why a real Postgres: "one incident per report" rests on the unique index
 * of the report claims table - project, Huntress account, report id - when
 * two deliveries of one report race past the lock. And the signing secret
 * is only as private as what is written to its column. The unit suites fake
 * the database; these run the production services against the migrated
 * tables, cloned structure-only (LIKE ... INCLUDING ALL: columns, defaults,
 * indexes, no foreign keys) into a uniquely named schema that is dropped
 * afterwards. Workflow triggers and realtime events, the services' only
 * side effects outside Postgres, are stubbed.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_HUNTRESS_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["HuntressConnection", "HuntressIncidentReport"];

class QueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

function svixSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64")}`;
}

describePostgres("Huntress against a migrated Postgres", () => {
  const schema: string = `huntress_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectA: ObjectID = ObjectID.generate();
  const projectB: ObjectID = ObjectID.generate();
  const recorder: QueryRecorder = new QueryRecorder();
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["HUNTRESS_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["HUNTRESS_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["HUNTRESS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logger: recorder,
      extra: { options: `-c search_path=${schema},public` },
    });

    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const service of [
      HuntressConnectionService,
      HuntressIncidentReportService,
    ]) {
      jest
        .spyOn(service, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(service, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
    }
  });

  beforeEach(async () => {
    recorder.failures = [];
    await database.query(
      TABLES.map((table: string): string => {
        return `DELETE FROM "${schema}"."${table}"`;
      }).join("; "),
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe("a connection's signing secret", () => {
    async function createConnection(secret: string): Promise<ObjectID> {
      const connection: HuntressConnection = new HuntressConnection();
      connection.projectId = projectA;
      connection.name = "Huntress";
      connection.signingSecret = secret;

      const created: HuntressConnection =
        await HuntressConnectionService.create({
          data: connection,
          props: { isRoot: true },
        });

      return created.id!;
    }

    async function storedRow(id: ObjectID): Promise<{
      signingSecret: string | null;
      isSigningSecretSet: boolean;
      lastError: string | null;
      lastErrorAt: Date | null;
    }> {
      const rows: Array<{
        signingSecret: string | null;
        isSigningSecretSet: boolean;
        lastError: string | null;
        lastErrorAt: Date | null;
      }> = await database.query(
        `SELECT "signingSecret", "isSigningSecretSet", "lastError", "lastErrorAt" FROM "${schema}"."HuntressConnection" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    test("is written encrypted, and read back as pasted only by the server", async () => {
      const secret: string = svixSecret();
      const id: ObjectID = await createConnection(secret);

      const row: {
        signingSecret: string | null;
        isSigningSecretSet: boolean;
      } = await storedRow(id);

      expect(row.isSigningSecretSet).toBe(true);
      expect(row.signingSecret).toBeTruthy();
      expect(row.signingSecret).not.toBe(secret);
      expect(row.signingSecret).not.toContain(secret.slice("whsec_".length));

      const read: HuntressConnection | null =
        await HuntressConnectionService.findOneById({
          id,
          select: { _id: true, signingSecret: true },
          props: { isRoot: true },
        });

      expect(read?.signingSecret).toBe(secret);
      expect(recorder.failures).toEqual([]);
    });

    test("a new secret replaces the old one and clears the refusal it fixed", async () => {
      const id: ObjectID = await createConnection(svixSecret());

      await database.query(
        `UPDATE "${schema}"."HuntressConnection" SET "lastError" = $1, "lastErrorAt" = now() WHERE "_id" = $2`,
        [
          "The request's signature does not match the signing secret.",
          id.toString(),
        ],
      );

      const before: { signingSecret: string | null } = await storedRow(id);
      const replacement: string = svixSecret();

      await HuntressConnectionService.updateOneById({
        id,
        data: { signingSecret: replacement },
        props: { isRoot: true },
      });

      const after: {
        signingSecret: string | null;
        isSigningSecretSet: boolean;
        lastError: string | null;
        lastErrorAt: Date | null;
      } = await storedRow(id);

      expect(after.signingSecret).not.toBe(before.signingSecret);
      expect(after.signingSecret).not.toBe(replacement);
      expect(after.isSigningSecretSet).toBe(true);
      expect(after.lastError).toBeNull();
      expect(after.lastErrorAt).toBeNull();

      const read: HuntressConnection | null =
        await HuntressConnectionService.findOneById({
          id,
          select: { _id: true, signingSecret: true },
          props: { isRoot: true },
        });

      expect(read?.signingSecret).toBe(replacement);
      expect(recorder.failures).toEqual([]);
    });

    test("an edit without a secret keeps the saved one and the last refusal", async () => {
      const secret: string = svixSecret();
      const id: ObjectID = await createConnection(secret);

      await database.query(
        `UPDATE "${schema}"."HuntressConnection" SET "lastError" = $1, "lastErrorAt" = now() WHERE "_id" = $2`,
        ["The request body is not valid JSON.", id.toString()],
      );

      const before: { signingSecret: string | null } = await storedRow(id);

      await HuntressConnectionService.updateOneById({
        id,
        data: { name: "Acme MSP" },
        props: { isRoot: true },
      });

      const after: {
        signingSecret: string | null;
        lastError: string | null;
      } = await storedRow(id);

      expect(after.signingSecret).toBe(before.signingSecret);
      expect(after.lastError).toBe("The request body is not valid JSON.");
      expect(recorder.failures).toEqual([]);
    });
  });

  describe("a report's claim", () => {
    function claim(data: {
      projectId: ObjectID;
      accountId: string;
      reportId: string;
    }): Promise<HuntressIncidentReport> {
      const row: HuntressIncidentReport = new HuntressIncidentReport();
      row.projectId = data.projectId;
      row.huntressAccountId = data.accountId;
      row.huntressIncidentReportId = data.reportId;
      row.outcome = HuntressIncidentReportOutcome.Opening;
      row.pagedOnCall = false;
      row.lastEventType = "incident_report.created";
      row.lastEventReceivedAt = new Date();
      row.appliedMessageIds = [] as unknown as JSONArray;

      return HuntressIncidentReportService.create({
        data: row,
        props: { isRoot: true },
      });
    }

    async function rowCount(): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT count(*) AS count FROM "${schema}"."HuntressIncidentReport"`,
      );

      return Number(rows[0]!.count);
    }

    test("two deliveries of one report racing to claim it: exactly one wins", async () => {
      const results: Array<PromiseSettledResult<HuntressIncidentReport>> =
        await Promise.allSettled([
          claim({ projectId: projectA, accountId: "5", reportId: "1234" }),
          claim({ projectId: projectA, accountId: "5", reportId: "1234" }),
        ]);

      expect(
        results.filter(
          (result: PromiseSettledResult<HuntressIncidentReport>): boolean => {
            return result.status === "fulfilled";
          },
        ),
      ).toHaveLength(1);

      const reasons: Array<unknown> = results
        .filter(
          (result: PromiseSettledResult<HuntressIncidentReport>): boolean => {
            return result.status === "rejected";
          },
        )
        .map(
          (result: PromiseSettledResult<HuntressIncidentReport>): unknown => {
            return result.status === "rejected" ? result.reason : null;
          },
        );

      // Refused by the unique index, as the processor reads it: a lost race.
      expect(reasons).toHaveLength(1);
      expect(PostgresErrorTranslator.isUniqueViolation(reasons[0])).toBe(true);
      expect(await rowCount()).toBe(1);

      // The race's loser is the statement Postgres refused; nothing else is.
      expect(recorder.failures).toHaveLength(1);
      recorder.failures = [];
    });

    test("the same report number from another account, or in another project, is its own report", async () => {
      await claim({ projectId: projectA, accountId: "5", reportId: "1234" });
      await claim({ projectId: projectA, accountId: "6", reportId: "1234" });
      await claim({ projectId: projectB, accountId: "5", reportId: "1234" });

      expect(await rowCount()).toBe(3);
      expect(recorder.failures).toEqual([]);
    });

    test("an account Huntress does not name is one account: its reports are still claimed once", async () => {
      await claim({ projectId: projectA, accountId: "", reportId: "77" });

      const second: unknown = await claim({
        projectId: projectA,
        accountId: "",
        reportId: "77",
      }).catch((error: unknown): unknown => {
        return error;
      });

      expect(PostgresErrorTranslator.isUniqueViolation(second)).toBe(true);
      expect(await rowCount()).toBe(1);

      recorder.failures = [];
    });

    test("remembers the message ids it applied, as a list of text", async () => {
      const created: HuntressIncidentReport = await claim({
        projectId: projectA,
        accountId: "5",
        reportId: "4321",
      });

      // Cast as the processor's own row update is: the JSON column's type is deep.
      const update: QueryDeepPartialEntity<HuntressIncidentReport> = {
        appliedMessageIds: ["msg_1", "msg_2"],
        outcome: HuntressIncidentReportOutcome.IncidentOpened,
      } as unknown as QueryDeepPartialEntity<HuntressIncidentReport>;

      await HuntressIncidentReportService.updateOneById({
        id: created.id!,
        data: update,
        props: { isRoot: true },
      });

      const read: HuntressIncidentReport | null =
        await HuntressIncidentReportService.findOneById({
          id: created.id!,
          select: { _id: true, appliedMessageIds: true, outcome: true },
          props: { isRoot: true },
        });

      expect(read?.appliedMessageIds).toEqual(["msg_1", "msg_2"]);
      expect(read?.outcome).toBe(HuntressIncidentReportOutcome.IncidentOpened);
      expect(recorder.failures).toEqual([]);
    });
  });
});
