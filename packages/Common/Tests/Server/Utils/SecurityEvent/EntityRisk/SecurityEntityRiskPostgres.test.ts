import Entities from "../../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import SecurityEntityRiskService from "../../../../../Server/Services/SecurityEntityRiskService";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
} from "../../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityEntityRiskRecorder from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { SecurityRiskFinding } from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import logger from "../../../../../Server/Utils/Logger";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  ENTITY_RISK_HISTORY_IN_DAYS,
  ENTITY_RISK_WINDOW_IN_DAYS,
  SecurityEntityCriticality,
} from "../../../../../Types/SecurityCase/SecurityEntityRisk";
import { getJestSpyOn } from "../../../../Spy";
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

/*
 * Entity risk against a real Postgres: the rows the recorder writes and
 * reads through the real services - the sources and the history as jsonb,
 * the entity's key read back with IN, the refresh's "riskExpiresAt <= now",
 * forgetting with "lastRiskAt < a month ago", the criticality list read
 * from its own table - and the unique (projectId, entityKey) index that
 * keeps one row per entity of a project. Only a real driver shows those
 * hold; the recorder's arithmetic is SecurityEntityRiskRecorder.test.ts's.
 *
 *   - a finding writes one row; the next finding about the same entity,
 *     whatever its case, reads that row and adds to it, and the risk that
 *     reaches the threshold hands one detection to the case ingest;
 *   - the same rule again counts once; a second case needs new sources;
 *   - the index refuses a second row for one entity of one project;
 *   - an Entity Criticality entry weighs the score once the project is
 *     worked out again;
 *   - the refresh lowers a score when its sources stop counting, and
 *     forgets an entity quiet for a month;
 *   - Reset Risk (deleting the row) starts the entity from zero.
 *
 * The lock (Redis) and the case ingest (its own tables) are stood in for.
 *
 * Opt in with RUN_POSTGRES_SECURITY_ENTITY_RISK_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The User, Project,
 * SecurityEntityRisk and SecurityEntityCriticality tables' STRUCTURE is
 * cloned into a unique schema that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * SECURITY_ENTITY_RISK_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * SECURITY_ENTITY_RISK_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: (name: string, suite: () => void) => void =
  process.env["RUN_POSTGRES_SECURITY_ENTITY_RISK_TESTS"] === "true"
    ? describe
    : describe.skip;

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

interface RiskRow {
  _id: string;
  entityType: string;
  entityValue: string;
  entityKey: string;
  riskScore: number;
  criticality: string | null;
  contributorCount: number;
  contributions: Array<Record<string, unknown>> | null;
  riskHistory: Array<{ day: string; score: number }> | null;
  firstRiskAt: Date | null;
  lastRiskAt: Date | null;
  riskExpiresAt: Date | null;
  riskCaseAt: Date | null;
}

describePostgres("entity risk, in Postgres", () => {
  const schema: string = `security_entity_risk_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  let database: DataSource;
  let signals: Array<SecurityDetectionSignal>;
  let now: Date;

  /*
   * User too: a delete reads the row with the people it names (who
   * deleted it) for the audit log, as every audited delete does.
   */
  const TABLES: Array<string> = [
    "User",
    "Project",
    "SecurityEntityRisk",
    "SecurityEntityCriticality",
  ];

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SECURITY_ENTITY_RISK_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["SECURITY_ENTITY_RISK_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SECURITY_ENTITY_RISK_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );

      // A fixture names only what the statements touch.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
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

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    now = NOW;
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return now;
    });

    // The project's lock is Redis's; one process here needs none.
    getJestSpyOn(Semaphore, "lock").mockResolvedValue({ id: "mutex" });
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);

    signals = [];
    getJestSpyOn(SecurityCaseIngest, "recordDetections").mockImplementation(
      async (handed: unknown): Promise<unknown> => {
        signals.push(...(handed as Array<SecurityDetectionSignal>));
        return { casesOpened: 0 };
      },
    );

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertProject(data: {
    isRiskCaseEnabled: boolean;
    threshold: number;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "enableSecurityRiskCases", "securityRiskCaseThreshold")
       VALUES ($1, $2, $3, $4)`,
      [
        id.toString(),
        `Project ${id.toString()}`,
        data.isRiskCaseEnabled,
        data.threshold,
      ],
    );

    return id;
  }

  async function insertCriticality(data: {
    projectId: ObjectID;
    value: string;
    criticality: SecurityEntityCriticality;
    entityType?: SecurityEntityType | null;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."SecurityEntityCriticality" ("_id", "projectId", "value", "entityType", "criticality", "version")
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [
        ObjectID.generate().toString(),
        data.projectId.toString(),
        data.value,
        data.entityType || null,
        data.criticality,
      ],
    );
  }

  async function rowsOf(projectId: ObjectID): Promise<Array<RiskRow>> {
    return await database.query(
      `SELECT "_id", "entityType", "entityValue", "entityKey", "riskScore", "criticality", "contributorCount", "contributions", "riskHistory", "firstRiskAt", "lastRiskAt", "riskExpiresAt", "riskCaseAt"
       FROM "${schema}"."SecurityEntityRisk" WHERE "projectId" = $1 ORDER BY "entityKey"`,
      [projectId.toString()],
    );
  }

  function finding(
    projectId: ObjectID,
    overrides: Partial<SecurityRiskFinding> = {},
  ): SecurityRiskFinding {
    return {
      projectId,
      source: SecurityDetectionSource.DetectionRule,
      sourceKey: "rule:11111111-1111-4111-8111-111111111111",
      sourceName: "Brute force",
      severity: OcsfSeverity.High,
      points: 50,
      entities: [
        { type: SecurityEntityType.User, value: "Alice@Corp.Example" },
      ],
      mitreTactics: ["TA0006"],
      mitreTechniques: ["T1110"],
      seenAt: new Date(now.getTime() - HOUR_IN_MS),
      ...overrides,
    };
  }

  test("a finding writes one row, the next about the same entity adds to it, and the threshold hands one detection over", async () => {
    const projectId: ObjectID = await insertProject({
      isRiskCaseEnabled: true,
      threshold: 100,
    });

    await SecurityEntityRiskRecorder.record([finding(projectId)]);

    let rows: Array<RiskRow> = await rowsOf(projectId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: SecurityEntityType.User,
      entityValue: "Alice@Corp.Example",
      entityKey: "alice@corp.example",
      riskScore: 50,
      contributorCount: 1,
      criticality: null,
      riskCaseAt: null,
    });
    // Its sources and its history, stored and read back as jsonb.
    expect(rows[0]!.contributions).toHaveLength(1);
    expect(rows[0]!.contributions![0]).toMatchObject({
      sourceKey: "rule:11111111-1111-4111-8111-111111111111",
      source: SecurityDetectionSource.DetectionRule,
      severity: OcsfSeverity.High,
      points: 50,
      hits: 1,
    });
    expect(rows[0]!.riskHistory).toEqual([{ day: "2026-10-14", score: 50 }]);
    // It next falls a week after its finding.
    expect(new Date(rows[0]!.riskExpiresAt!).getTime()).toBe(
      NOW.getTime() - HOUR_IN_MS + ENTITY_RISK_WINDOW_IN_DAYS * DAY_IN_MS,
    );
    expect(signals).toEqual([]);

    // Another rule, about the same user written another way: the same row.
    now = new Date(NOW.getTime() + HOUR_IN_MS);
    await SecurityEntityRiskRecorder.record([
      finding(projectId, {
        sourceKey: "rule:22222222-2222-4222-8222-222222222222",
        sourceName: "Impossible travel",
        entities: [
          { type: SecurityEntityType.User, value: "alice@corp.example" },
        ],
      }),
    ]);

    rows = await rowsOf(projectId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityValue: "Alice@Corp.Example",
      riskScore: 100,
      contributorCount: 2,
    });
    expect(rows[0]!.riskCaseAt).not.toBeNull();
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      source: SecurityDetectionSource.EntityRisk,
      title: "High risk — Alice@Corp.Example",
      severity: OcsfSeverity.High,
      groupValue: "Alice@Corp.Example",
    });

    // The first rule again counts once, and opens no second case.
    now = new Date(NOW.getTime() + 2 * HOUR_IN_MS);
    await SecurityEntityRiskRecorder.record([finding(projectId)]);

    rows = await rowsOf(projectId);

    expect(rows[0]).toMatchObject({ riskScore: 100, contributorCount: 2 });
    expect(
      rows[0]!.contributions!.find((source: Record<string, unknown>) => {
        return (
          source["sourceKey"] === "rule:11111111-1111-4111-8111-111111111111"
        );
      })?.["hits"],
    ).toBe(2);
    expect(signals).toHaveLength(1);
  });

  test("the index keeps one row per entity of a project, and another project has its own", async () => {
    const projectId: ObjectID = await insertProject({
      isRiskCaseEnabled: false,
      threshold: 100,
    });
    const otherProjectId: ObjectID = await insertProject({
      isRiskCaseEnabled: false,
      threshold: 100,
    });

    await SecurityEntityRiskRecorder.record([
      finding(projectId),
      finding(otherProjectId),
    ]);

    expect(await rowsOf(projectId)).toHaveLength(1);
    expect(await rowsOf(otherProjectId)).toHaveLength(1);

    let error: unknown = null;

    try {
      await database.query(
        `INSERT INTO "${schema}"."SecurityEntityRisk" ("_id", "projectId", "entityType", "entityValue", "entityKey", "version")
         VALUES ($1, $2, 'User', 'ALICE@corp.example', 'alice@corp.example', 1)`,
        [ObjectID.generate().toString(), projectId.toString()],
      );
    } catch (caught) {
      error = caught;
    }

    expect((error as { code?: string } | null)?.code).toBe("23505");
    // Risk cases off: scored and listed, no detection handed over.
    expect(signals).toEqual([]);
  });

  test("an Entity Criticality entry weighs the score once the project is worked out again", async () => {
    const projectId: ObjectID = await insertProject({
      isRiskCaseEnabled: true,
      threshold: 100,
    });

    await SecurityEntityRiskRecorder.record([finding(projectId)]);
    expect((await rowsOf(projectId))[0]!.riskScore).toBe(50);

    await insertCriticality({
      projectId,
      value: "alice@*",
      criticality: SecurityEntityCriticality.Extreme,
      entityType: SecurityEntityType.User,
    });
    // An entry for hosts only names no user.
    await insertCriticality({
      projectId,
      value: "alice@corp.example",
      criticality: SecurityEntityCriticality.Low,
      entityType: SecurityEntityType.Host,
    });

    expect(
      await SecurityEntityRiskRecorder.refreshProject({
        projectId,
        isWhole: true,
      }),
    ).toBe(1);

    const rows: Array<RiskRow> = await rowsOf(projectId);

    expect(rows[0]).toMatchObject({
      riskScore: 100,
      criticality: SecurityEntityCriticality.Extreme,
      contributorCount: 1,
    });
    // Weighed up to the threshold: the case opens, as from a new finding.
    expect(signals).toHaveLength(1);
    expect(signals[0]!.description).toContain(
      "Its criticality, Extreme, weighs its risk ×2.",
    );
  });

  test("the refresh lowers a score as its sources stop counting, and forgets an entity quiet for a month", async () => {
    const projectId: ObjectID = await insertProject({
      isRiskCaseEnabled: true,
      threshold: 100,
    });

    await SecurityEntityRiskRecorder.record([
      finding(projectId),
      finding(projectId, {
        sourceKey: "intel:99999999-9999-4999-8999-999999999999",
        source: SecurityDetectionSource.ThreatIntel,
        sourceName: "Abuse feed",
        severity: OcsfSeverity.Medium,
        points: 25,
        entities: [
          { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
        ],
        seenAt: new Date(NOW.getTime() - 3 * DAY_IN_MS),
      }),
    ]);

    expect(
      (await rowsOf(projectId)).map((row: RiskRow) => {
        return [row.entityKey, row.riskScore];
      }),
    ).toEqual([
      ["203.0.113.7", 25],
      ["alice@corp.example", 50],
    ]);

    // Five days on: the address's week is over, the user's is not.
    now = new Date(NOW.getTime() + 5 * DAY_IN_MS);
    expect(await SecurityEntityRiskRecorder.refreshDue()).toBe(1);

    let rows: Array<RiskRow> = await rowsOf(projectId);

    expect(rows[0]).toMatchObject({
      entityKey: "203.0.113.7",
      riskScore: 0,
      contributorCount: 0,
      riskExpiresAt: null,
    });
    // When it went quiet is kept: it is what forgetting reads.
    expect(new Date(rows[0]!.lastRiskAt!).getTime()).toBe(
      NOW.getTime() - 3 * DAY_IN_MS,
    );
    expect(rows[1]).toMatchObject({
      entityKey: "alice@corp.example",
      riskScore: 50,
    });

    // Nothing is due a minute later.
    now = new Date(now.getTime() + 60 * 1000);
    expect(await SecurityEntityRiskRecorder.refreshDue()).toBe(0);

    // A month after the address went quiet, it is forgotten; the user, at 0 too by then, stays.
    now = new Date(
      NOW.getTime() -
        3 * DAY_IN_MS +
        ENTITY_RISK_HISTORY_IN_DAYS * DAY_IN_MS +
        HOUR_IN_MS,
    );
    await SecurityEntityRiskRecorder.refreshDue();

    rows = await rowsOf(projectId);

    expect(
      rows.map((row: RiskRow) => {
        return [row.entityKey, row.riskScore];
      }),
    ).toEqual([["alice@corp.example", 0]]);
    expect(signals).toEqual([]);
  });

  test("Reset Risk deletes the row, and what is found next counts from zero", async () => {
    const projectId: ObjectID = await insertProject({
      isRiskCaseEnabled: true,
      threshold: 100,
    });

    await SecurityEntityRiskRecorder.record([
      finding(projectId),
      finding(projectId, {
        sourceKey: "rule:22222222-2222-4222-8222-222222222222",
      }),
    ]);

    const [row] = await rowsOf(projectId);

    expect(row).toMatchObject({ riskScore: 100 });
    expect(signals).toHaveLength(1);

    await SecurityEntityRiskService.deleteOneById({
      id: new ObjectID(row!._id),
      props: {
        isRoot: true,
      },
    });

    expect(await rowsOf(projectId)).toEqual([]);

    now = new Date(NOW.getTime() + HOUR_IN_MS);
    await SecurityEntityRiskRecorder.record([finding(projectId)]);

    const rows: Array<RiskRow> = await rowsOf(projectId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      riskScore: 50,
      contributorCount: 1,
      riskCaseAt: null,
    });
    expect(rows[0]!._id).not.toBe(row!._id);
    expect(signals).toHaveLength(1);
  });
});
