import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DefaultNamingStrategy,
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Project from "../../../../Models/DatabaseModels/Project";
import RumSessionPin from "../../../../Models/DatabaseModels/RumSessionPin";
import RumSessionReplayView from "../../../../Models/DatabaseModels/RumSessionReplayView";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddResolvedRecordRetention1809110600000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809110600000-AddResolvedRecordRetention";
import { AddIndexesForIncidentAndAlertDeletes1809110700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809110700000-AddIndexesForIncidentAndAlertDeletes";
import {
  DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM,
  DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
} from "../../../../Types/Retention/ResolvedRecordRetention";

/*
 * The migrations behind deleting resolved incidents and alerts a project no
 * longer keeps (issue #6903), run against a fake QueryRunner so up() and
 * down() are told apart:
 *
 *   - AddResolvedRecordRetention: the project's two lengths at 0 - keep
 *     every one - for every project, so an upgrade deletes nothing, and the
 *     postmortem switch on; constant defaults, metadata only on Postgres 11
 *     and later, so no table is rewritten;
 *   - AddIndexesForIncidentAndAlertDeletes: an index on every column that
 *     points at an incident, an alert or an episode and had none - the
 *     foreign keys a cascaded delete follows, which read the whole table
 *     for every row deleted without one - built online (outside a
 *     transaction, CONCURRENTLY through OnlineDdl), each named as its
 *     entity's index so the drift check finds nothing to generate.
 *
 * The drift check and ResolvedRecordRetentionPostgres run them for real.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

interface OurMigration {
  timestamp: string;
  baseName: string;
  migration: MigrationInterface;
}

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const MIGRATIONS: Array<OurMigration> = [
  {
    timestamp: "1809110600000",
    baseName: "AddResolvedRecordRetention",
    migration: new AddResolvedRecordRetention1809110600000(),
  },
  {
    timestamp: "1809110700000",
    baseName: "AddIndexesForIncidentAndAlertDeletes",
    migration: new AddIndexesForIncidentAndAlertDeletes1809110700000(),
  },
];

// A column a delete of an incident, an alert or an episode cascades to, that had no index.
interface IndexedColumn {
  table: string;
  column: string;
  entity: unknown;
  name: string;
}

const INDEXED_COLUMNS: Array<IndexedColumn> = [
  {
    table: "RumSessionReplayView",
    column: "linkedIncidentId",
    entity: RumSessionReplayView,
    name: "IDX_4215567ecaeb1db1ef3d6cc2e6",
  },
  {
    table: "RumSessionPin",
    column: "incidentId",
    entity: RumSessionPin,
    name: "IDX_336ded09ba7bfaab73f0d05850",
  },
  {
    table: "RumSessionPin",
    column: "alertId",
    entity: RumSessionPin,
    name: "IDX_e0815e51bbeb69666c0030d256",
  },
  {
    table: "OnCallDutyPolicyExecutionLog",
    column: "triggeredByIncidentId",
    entity: OnCallDutyPolicyExecutionLog,
    name: "IDX_a230899d6c2b16621954c46fb1",
  },
  {
    table: "OnCallDutyPolicyExecutionLog",
    column: "triggeredByAlertId",
    entity: OnCallDutyPolicyExecutionLog,
    name: "IDX_b495684ae5b9c2a5b8dba6c1d4",
  },
  {
    table: "UserOnCallLog",
    column: "triggeredByIncidentId",
    entity: UserOnCallLog,
    name: "IDX_eeb0dd05d1dec542c3de5fb507",
  },
  {
    table: "UserOnCallLog",
    column: "triggeredByAlertId",
    entity: UserOnCallLog,
    name: "IDX_0ee3711cdc64957845d9d028c3",
  },
  {
    table: "UserOnCallLog",
    column: "triggeredByAlertEpisodeId",
    entity: UserOnCallLog,
    name: "IDX_114aa962f2bc3c6736a1469df3",
  },
  {
    table: "UserOnCallLog",
    column: "triggeredByIncidentEpisodeId",
    entity: UserOnCallLog,
    name: "IDX_587fec46a331e53d72bb6c72fd",
  },
  {
    table: "SecurityCase",
    column: "incidentId",
    entity: SecurityCase,
    name: "IDX_cdb94d76dcf480f39d0785a9fc",
  },
];

async function statementsOf(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;

  jest.spyOn(OnlineDdl, "createIndex").mockImplementation((async (
    _queryRunner: unknown,
    statement: string,
  ) => {
    statements.push(`online: ${statement}`);
  }) as never);
  jest.spyOn(OnlineDdl, "dropIndex").mockImplementation((async (
    _queryRunner: unknown,
    statement: string,
  ) => {
    statements.push(`online: ${statement}`);
  }) as never);

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddResolvedRecordRetention1809110600000", () => {
  const migration: MigrationInterface =
    new AddResolvedRecordRetention1809110600000();

  test("adds both lengths at 0 - keep every one - and the postmortem switch on, for every project", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `ALTER TABLE "Project" ADD "incidentRetentionInDays" integer NOT NULL DEFAULT '0'`,
      `ALTER TABLE "Project" ADD "keepIncidentsWithCompletedPostmortem" boolean NOT NULL DEFAULT true`,
      `ALTER TABLE "Project" ADD "alertRetentionInDays" integer NOT NULL DEFAULT '0'`,
    ]);
  });

  test("the defaults it writes are the ones the model and the setting say", async () => {
    const statements: Array<string> = await statementsOf(migration, "up");
    const project: Project = new Project();

    expect(statements[0]).toContain(
      `DEFAULT '${DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS}'`,
    );
    expect(statements[1]).toContain(
      `DEFAULT ${DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM}`,
    );
    expect(statements[2]).toContain(
      `DEFAULT '${DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS}'`,
    );

    for (const column of ["incidentRetentionInDays", "alertRetentionInDays"]) {
      expect(project.getTableColumnMetadata(column).defaultValue).toBe(
        DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS,
      );
    }

    expect(
      project.getTableColumnMetadata("keepIncidentsWithCompletedPostmortem")
        .defaultValue,
    ).toBe(DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM);
  });

  test("an upgrade deletes nothing: every project starts at 0", async () => {
    for (const statement of (await statementsOf(migration, "up")).filter(
      (sql: string) => {
        return sql.includes("RetentionInDays");
      },
    )) {
      expect(statement).toMatch(/DEFAULT '0'$/);
    }
  });

  test("rewrites no row and builds no index: constant defaults are metadata", async () => {
    for (const statement of await statementsOf(migration, "up")) {
      expect(statement).not.toMatch(
        /INDEX|CONSTRAINT|FOREIGN KEY|UPDATE |DELETE |now\(\)/i,
      );
    }
  });

  test("down drops the three columns, the last added first", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "Project" DROP COLUMN "alertRetentionInDays"`,
      `ALTER TABLE "Project" DROP COLUMN "keepIncidentsWithCompletedPostmortem"`,
      `ALTER TABLE "Project" DROP COLUMN "incidentRetentionInDays"`,
    ]);
  });
});

describe("AddIndexesForIncidentAndAlertDeletes1809110700000", () => {
  const migration: AddIndexesForIncidentAndAlertDeletes1809110700000 =
    new AddIndexesForIncidentAndAlertDeletes1809110700000();

  test("runs outside a transaction, so the indexes are built online", () => {
    expect(migration.transaction).toBe(false);
  });

  test("builds one index a column, through OnlineDdl only", async () => {
    const statements: Array<string> = await statementsOf(migration, "up");

    expect(statements).toHaveLength(INDEXED_COLUMNS.length);

    for (const statement of statements) {
      expect(statement.startsWith("online: CREATE INDEX ")).toBe(true);
    }

    expect(statements.sort()).toEqual(
      INDEXED_COLUMNS.map(({ table, column, name }: IndexedColumn): string => {
        return `online: CREATE INDEX "${name}" ON "${table}" ("${column}") `;
      }).sort(),
    );
  });

  test("down drops every one of them online", async () => {
    expect((await statementsOf(migration, "down")).sort()).toEqual(
      INDEXED_COLUMNS.map(({ name }: IndexedColumn): string => {
        return `online: DROP INDEX "public"."${name}"`;
      }).sort(),
    );
  });

  test.each(INDEXED_COLUMNS)(
    "$table.$column: the entity has the index, named as TypeORM names it, so the drift check generates nothing",
    ({ table, column, entity, name }: IndexedColumn) => {
      const indexes: Array<IndexMetadataArgs> = getMetadataArgsStorage()
        .indices.filter((index: IndexMetadataArgs): boolean => {
          return index.target === entity;
        })
        .filter((index: IndexMetadataArgs): boolean => {
          const columns: unknown = index.columns;

          return (
            (Array.isArray(columns) && columns.join(",") === column) ||
            (index as unknown as { propertyName?: string }).propertyName ===
              column
          );
        });

      expect(indexes.length).toBeGreaterThanOrEqual(1);
      expect(new DefaultNamingStrategy().indexName(table, [column])).toBe(name);
    },
  );
});

describe("the two, registered", () => {
  const names: Array<string> = SchemaMigrations.map(
    (migration: { name: string }): string => {
      return migration.name;
    },
  );

  test.each(MIGRATIONS)(
    "$baseName is registered once, under its own name, and its file is named for it",
    ({ timestamp, baseName, migration }: OurMigration): void => {
      const className: string = `${baseName}${timestamp}`;

      expect(
        names.filter((name: string): boolean => {
          return name === className;
        }),
      ).toHaveLength(1);
      expect((migration as unknown as { name: string }).name).toBe(className);
      expect(
        fs.existsSync(
          path.join(MIGRATION_DIRECTORY, `${timestamp}-${baseName}.ts`),
        ),
      ).toBe(true);
    },
  );

  test("run in order - the columns, then the indexes - after every migration before them", () => {
    const positions: Array<number> = MIGRATIONS.map(
      ({ timestamp, baseName }: OurMigration): number => {
        return names.indexOf(`${baseName}${timestamp}`);
      },
    );

    expect(positions[1]).toBe(positions[0]! + 1);

    const before: Array<number> = names
      .slice(0, positions[0])
      .map((name: string): number => {
        return Number(TRAILING_TIMESTAMP.exec(name)?.[1] || 0);
      });

    expect(before.length).toBeGreaterThan(100);
    expect(Math.max(...before)).toBeLessThan(Number(MIGRATIONS[0]!.timestamp));
  });
});
