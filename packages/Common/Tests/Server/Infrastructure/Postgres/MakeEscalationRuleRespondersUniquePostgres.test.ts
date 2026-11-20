import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import { MakeEscalationRuleRespondersUnique1809187100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187100000-MakeEscalationRuleRespondersUnique";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import PostgresErrorTranslator from "../../../../Server/Utils/Database/PostgresErrorTranslator";
import logger from "../../../../Server/Utils/Logger";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import {
  ESCALATION_RULE_SCHEDULE_INDEX,
  ESCALATION_RULE_TEAM_INDEX,
  ESCALATION_RULE_USER_INDEX,
} from "../../../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * MakeEscalationRuleRespondersUnique on a real, migrated Postgres (#10411):
 * the people, teams and schedules escalation rules had more than once - as
 * the API, Terraform and two adds at the same moment wrote them - are left
 * once, the oldest row of each kept and the others soft-deleted, and each
 * table gets the partial unique index that refuses a second row from then
 * on.
 *
 * What it must not touch is seeded beside the copies: the same person on
 * another rule, a row deleted before, rows that name nobody, a schedule
 * paged both ways by one rule. Nothing refers to these rows by a foreign
 * key (checked here against public), so a soft delete leaves every other
 * table as it was. Run a second time it changes nothing - not one row is
 * written - and a table with no copies is read and left alone.
 *
 * Opt in with RUN_POSTGRES_ESCALATION_RULE_RESPONDER_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The three tables'
 * structure is cloned into a unique schema, dropped afterwards, and the
 * clones' unique indexes dropped, so they start as the tables were before
 * the migration; every row is synthetic. Credentials from DATABASE_USERNAME
 * / DATABASE_PASSWORD, database from
 * ESCALATION_RULE_RESPONDER_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from ESCALATION_RULE_RESPONDER_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_ESCALATION_RULE_RESPONDER_TESTS"] === "true"
    ? describe
    : describe.skip;

interface ResponderTable {
  table: string;
  index: string;
  column: string;
}

const USERS: ResponderTable = {
  table: "OnCallDutyPolicyEscalationRuleUser",
  index: ESCALATION_RULE_USER_INDEX,
  column: "userId",
};
const TEAMS: ResponderTable = {
  table: "OnCallDutyPolicyEscalationRuleTeam",
  index: ESCALATION_RULE_TEAM_INDEX,
  column: "teamId",
};
const SCHEDULES: ResponderTable = {
  table: "OnCallDutyPolicyEscalationRuleSchedule",
  index: ESCALATION_RULE_SCHEDULE_INDEX,
  column: "onCallDutyPolicyScheduleId",
};
const TABLES: Array<ResponderTable> = [USERS, TEAMS, SCHEDULES];

const projectId: string = ObjectID.generate().toString();
const policyId: string = ObjectID.generate().toString();
const level1: string = ObjectID.generate().toString();
const level2: string = ObjectID.generate().toString();
const ana: string = ObjectID.generate().toString();
const bo: string = ObjectID.generate().toString();
const platform: string = ObjectID.generate().toString();
const primary: string = ObjectID.generate().toString();

// A row's id, by what it is in the seed.
const ids: Record<string, string> = {};

function idOf(name: string): string {
  if (!ids[name]) {
    ids[name] = ObjectID.generate().toString();
  }

  return ids[name]!;
}

interface StoredRow {
  _id: string;
  deletedAt: Date | null;
  xmin: string;
}

describePostgres("MakeEscalationRuleRespondersUnique against Postgres", () => {
  const schema: string = `rule_responders_unique_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  function quoted(table: string): string {
    return `"${schema}"."${table}"`;
  }

  async function runMigration(): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await new MakeEscalationRuleRespondersUnique1809187100000().up(
        queryRunner,
      );
    } finally {
      await queryRunner.query(`SET search_path TO DEFAULT`);
      await queryRunner.release();
    }
  }

  async function seed(data: {
    table: ResponderTable;
    name: string;
    rule: string;
    responder: string | null;
    createdAt: string;
    deletedAt?: string | undefined;
    pageNextInRotation?: boolean | undefined;
  }): Promise<void> {
    const isSchedule: boolean = data.table === SCHEDULES;

    await database.query(
      `INSERT INTO ${quoted(data.table.table)} ("_id", "version", "projectId", "onCallDutyPolicyId", "onCallDutyPolicyEscalationRuleId", "${data.table.column}", "createdAt", "deletedAt"${isSchedule ? `, "pageNextInRotation"` : ""})
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7${isSchedule ? ", $8" : ""})`,
      [
        idOf(data.name),
        projectId,
        policyId,
        data.rule,
        data.responder,
        data.createdAt,
        data.deletedAt || null,
        ...(isSchedule ? [Boolean(data.pageNextInRotation)] : []),
      ],
    );
  }

  async function rowsOf(table: ResponderTable): Promise<Array<StoredRow>> {
    return await database.query(
      `SELECT "_id", "deletedAt", xmin::text AS "xmin" FROM ${quoted(table.table)} ORDER BY "_id"`,
    );
  }

  // The rows of a table left in the index - not deleted - by their seed names.
  async function liveNames(table: ResponderTable): Promise<Array<string>> {
    const live: Set<string> = new Set<string>(
      (await rowsOf(table))
        .filter((row: StoredRow): boolean => {
          return row.deletedAt === null;
        })
        .map((row: StoredRow): string => {
          return row._id;
        }),
    );

    return Object.keys(ids)
      .filter((name: string): boolean => {
        return live.has(ids[name]!);
      })
      .sort();
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["ESCALATION_RULE_RESPONDER_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["ESCALATION_RULE_RESPONDER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["ESCALATION_RULE_RESPONDER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE ${quoted(table.table)} (LIKE public."${table.table}" INCLUDING ALL)`,
      );
    }

    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  });

  beforeEach(async () => {
    for (const name of Object.keys(ids)) {
      delete ids[name];
    }

    for (const table of TABLES) {
      await database.query(`DELETE FROM ${quoted(table.table)}`);

      // Built by the migration under test: each table starts without it.
      const unique: Array<{ indexname: string }> = await database.query(
        `SELECT indexname FROM pg_indexes
            WHERE schemaname = $1 AND tablename = $2
              AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%WHERE%'`,
        [schema, table.table],
      );
      for (const index of unique) {
        await database.query(`DROP INDEX "${schema}"."${index.indexname}"`);
      }
    }

    // Ana three times on Level 1 (the oldest made second), once on Level 2.
    await seed({
      table: USERS,
      name: "ana level 1, newer",
      rule: level1,
      responder: ana,
      createdAt: "2026-01-02T00:00:00Z",
    });
    await seed({
      table: USERS,
      name: "ana level 1, oldest",
      rule: level1,
      responder: ana,
      createdAt: "2026-01-01T00:00:00Z",
    });
    await seed({
      table: USERS,
      name: "ana level 1, newest",
      rule: level1,
      responder: ana,
      createdAt: "2026-01-03T00:00:00Z",
    });
    await seed({
      table: USERS,
      name: "ana level 2",
      rule: level2,
      responder: ana,
      createdAt: "2026-01-04T00:00:00Z",
    });
    // Bo once, and a copy deleted before (older): it stays as it is.
    await seed({
      table: USERS,
      name: "bo level 1",
      rule: level1,
      responder: bo,
      createdAt: "2026-01-05T00:00:00Z",
    });
    await seed({
      table: USERS,
      name: "bo level 1, deleted before",
      rule: level1,
      responder: bo,
      createdAt: "2025-12-31T00:00:00Z",
      deletedAt: "2026-01-06T00:00:00Z",
    });
    // Two rows that name nobody: no copies of anyone.
    await seed({
      table: USERS,
      name: "nobody one",
      rule: level1,
      responder: null,
      createdAt: "2026-01-07T00:00:00Z",
    });
    await seed({
      table: USERS,
      name: "nobody two",
      rule: level1,
      responder: null,
      createdAt: "2026-01-08T00:00:00Z",
    });

    // Platform twice on Level 1, made at the same moment: the lower id stays.
    const [first, second]: Array<string> = [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ].sort();
    ids["platform, lower id"] = first!;
    ids["platform, higher id"] = second!;
    await seed({
      table: TEAMS,
      name: "platform, higher id",
      rule: level1,
      responder: platform,
      createdAt: "2026-02-01T00:00:00Z",
    });
    await seed({
      table: TEAMS,
      name: "platform, lower id",
      rule: level1,
      responder: platform,
      createdAt: "2026-02-01T00:00:00Z",
    });

    // Primary twice paging whoever is on call, and once its next in rotation.
    await seed({
      table: SCHEDULES,
      name: "primary on call, oldest",
      rule: level1,
      responder: primary,
      createdAt: "2026-03-01T00:00:00Z",
    });
    await seed({
      table: SCHEDULES,
      name: "primary on call, newer",
      rule: level1,
      responder: primary,
      createdAt: "2026-03-02T00:00:00Z",
    });
    await seed({
      table: SCHEDULES,
      name: "primary next in rotation",
      rule: level1,
      responder: primary,
      createdAt: "2026-03-03T00:00:00Z",
      pageNextInRotation: true,
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("nothing refers to these rows by a foreign key, so a soft delete reaches no other table", async () => {
    const references: Array<{ count: number }> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM pg_constraint
          WHERE contype = 'f' AND confrelid = ANY (ARRAY[
            'public."OnCallDutyPolicyEscalationRuleUser"'::regclass,
            'public."OnCallDutyPolicyEscalationRuleTeam"'::regclass,
            'public."OnCallDutyPolicyEscalationRuleSchedule"'::regclass
          ])`,
    );

    expect(references[0]!.count).toBe(0);
  });

  test("keeps the oldest row of each responder a rule had more than once, and soft-deletes the others", async () => {
    await runMigration();

    expect(await liveNames(USERS)).toEqual([
      "ana level 1, oldest",
      "ana level 2",
      "bo level 1",
      "nobody one",
      "nobody two",
    ]);
    expect(await liveNames(TEAMS)).toEqual(["platform, lower id"]);
    expect(await liveNames(SCHEDULES)).toEqual([
      "primary next in rotation",
      "primary on call, oldest",
    ]);

    // Soft-deleted: every row is still there.
    expect(await rowsOf(USERS)).toHaveLength(8);
    expect(await rowsOf(TEAMS)).toHaveLength(2);
    expect(await rowsOf(SCHEDULES)).toHaveLength(3);

    // A row deleted before keeps when it was deleted.
    const before: StoredRow | undefined = (await rowsOf(USERS)).find(
      (row: StoredRow): boolean => {
        return row._id === ids["bo level 1, deleted before"];
      },
    );
    expect(new Date(before!.deletedAt!).toISOString()).toBe(
      "2026-01-06T00:00:00.000Z",
    );
  });

  test("builds each partial unique index, valid, by its own name", async () => {
    await runMigration();

    for (const table of TABLES) {
      const index: Array<{ valid: boolean; definition: string }> =
        await database.query(
          `SELECT i.indisvalid AS "valid", pg_get_indexdef(i.indexrelid) AS "definition"
               FROM pg_index i
               JOIN pg_class c ON c.oid = i.indexrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1 AND c.relname = $2`,
          [schema, table.index],
        );

      expect(index).toHaveLength(1);
      expect(index[0]!.valid).toBe(true);
      expect(index[0]!.definition).toContain("CREATE UNIQUE INDEX");
      expect(index[0]!.definition).toContain(`WHERE ("deletedAt" IS NULL)`);
    }
  });

  test("from then on Postgres refuses another copy, and a deleted copy holds no place", async () => {
    await runMigration();

    const refused: unknown = await seed({
      table: USERS,
      name: "ana level 1, added after",
      rule: level1,
      responder: ana,
      createdAt: "2026-04-01T00:00:00Z",
    }).catch((error: unknown) => {
      return error;
    });

    expect(
      PostgresErrorTranslator.isUniqueViolationOf(
        refused,
        ESCALATION_RULE_USER_INDEX,
      ),
    ).toBe(true);

    await expect(
      seed({
        table: USERS,
        name: "ana level 1, deleted copy",
        rule: level1,
        responder: ana,
        createdAt: "2026-04-02T00:00:00Z",
        deletedAt: "2026-04-03T00:00:00Z",
      }),
    ).resolves.toBeUndefined();
  });

  test("run a second time, it changes nothing: not one row is written", async () => {
    await runMigration();

    const after: Array<Array<StoredRow>> = [];
    for (const table of TABLES) {
      after.push(await rowsOf(table));
    }

    await runMigration();

    for (const [index, table] of TABLES.entries()) {
      // The same rows, the same deletedAt, the same row versions (xmin).
      expect(await rowsOf(table)).toEqual(after[index]);
    }
  });

  test("a table with no copies is read, and written nowhere", async () => {
    await database.query(`DELETE FROM ${quoted(TEAMS.table)}`);
    await seed({
      table: TEAMS,
      name: "platform once",
      rule: level1,
      responder: platform,
      createdAt: "2026-02-01T00:00:00Z",
    });
    const before: Array<StoredRow> = await rowsOf(TEAMS);

    await runMigration();

    expect(await rowsOf(TEAMS)).toEqual(before);
  });

  test("the level reads each person once: the rows a page is sent from", async () => {
    await runMigration();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    try {
      // As OnCallDutyPolicyEscalationRuleService reads a level before it pages it.
      const users: Array<OnCallDutyPolicyEscalationRuleUser> =
        await OnCallDutyPolicyEscalationRuleUserService.findBy({
          query: { onCallDutyPolicyEscalationRuleId: new ObjectID(level1) },
          props: { isRoot: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          select: { userId: true },
        });

      expect(
        users
          .map((row: OnCallDutyPolicyEscalationRuleUser): string => {
            return row.userId?.toString() || "nobody";
          })
          .sort(),
      ).toEqual([ana, bo, "nobody", "nobody"].sort());

      expect(
        (
          await OnCallDutyPolicyEscalationRuleTeamService.countBy({
            query: { onCallDutyPolicyEscalationRuleId: new ObjectID(level1) },
            props: { isRoot: true },
          })
        ).toNumber(),
      ).toBe(1);
      expect(
        (
          await OnCallDutyPolicyEscalationRuleScheduleService.countBy({
            query: {
              onCallDutyPolicyEscalationRuleId: new ObjectID(level1),
            },
            props: { isRoot: true },
          })
        ).toNumber(),
      ).toBe(2);
    } finally {
      (PostgresAppInstance.getDataSource as unknown as jest.Mock).mockRestore();
      (PostgresAppInstance.isConnected as unknown as jest.Mock).mockRestore();
    }
  });
});
