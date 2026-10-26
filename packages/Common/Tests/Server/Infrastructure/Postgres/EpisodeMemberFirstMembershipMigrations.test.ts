import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import AlertEpisodeMember from "../../../../Models/DatabaseModels/AlertEpisodeMember";
import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddEpisodeMemberFirstMembership1807800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807800000000-AddEpisodeMemberFirstMembership";
import { AddEpisodeMemberFirstMembershipIndexes1807810000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1807810000000-AddEpisodeMemberFirstMembershipIndexes";
import { INCIDENT_FIRST_MEMBERSHIP_INDEX } from "../../../../Server/Services/IncidentEpisodeMemberService";
import { ALERT_FIRST_MEMBERSHIP_INDEX } from "../../../../Server/Services/AlertEpisodeMemberService";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * ONE FIRST MEMBERSHIP PER INCIDENT, AND PER ALERT.
 *
 * Two adds of an incident (or an alert) that is in no episode, at the same
 * moment, both passed the check that keeps it in one episode while its
 * project asks for that. Each member now says whether it was its record's
 * first ("isFirstMembership"), and a partial unique index takes one first
 * membership per record: the add that loses is refused by the database, and
 * checked again by its service.
 *
 * Pinned here without a database: what each migration runs, that the index
 * build is online (its own migration, outside a transaction), that the
 * statements are the ones the models declare, and where both are
 * registered. The schema drift check holds them together on Postgres, and
 * EpisodeMembersBulkAddPostgres races two adds against a migrated database.
 */

interface Kind {
  table: string;
  model: { new (): BaseModel };
  recordColumn: string;
  indexName: string;
}

const KINDS: Array<Kind> = [
  {
    table: "AlertEpisodeMember",
    model: AlertEpisodeMember,
    recordColumn: "alertId",
    indexName: ALERT_FIRST_MEMBERSHIP_INDEX,
  },
  {
    table: "IncidentEpisodeMember",
    model: IncidentEpisodeMember,
    recordColumn: "incidentId",
    indexName: INCIDENT_FIRST_MEMBERSHIP_INDEX,
  },
];

const PREDICATE: string = '"isFirstMembership" = true AND "deletedAt" IS NULL';

type MigrationClass = { name: string };

const registered: Array<string> = (
  Migrations as unknown as Array<MigrationClass>
).map((migration: MigrationClass): string => {
  return migration.name;
});

const TIMESTAMP_PATTERN: RegExp = /(\d{13})$/;

function timestampOf(name: string): number | null {
  const stamp: RegExpMatchArray | null = name.match(TIMESTAMP_PATTERN);

  return stamp ? Number(stamp[1]) : null;
}

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * What up() or down() hands OnlineDdl to build or drop online, statement by
 * statement - and what it runs itself, which an online migration does not.
 */
async function recordOnline(direction: "up" | "down"): Promise<{
  built: Array<string>;
  dropped: Array<string>;
  plain: Array<string>;
}> {
  const built: Array<string> = [];
  const dropped: Array<string> = [];

  jest.spyOn(OnlineDdl, "createIndex").mockImplementation((async (
    _queryRunner: unknown,
    statement: string,
  ) => {
    built.push(statement);
  }) as never);
  jest.spyOn(OnlineDdl, "dropIndex").mockImplementation((async (
    _queryRunner: unknown,
    statement: string,
  ) => {
    dropped.push(statement);
  }) as never);

  const plain: Array<string> = await recordQueries(
    new AddEpisodeMemberFirstMembershipIndexes1807810000000(),
    direction,
  );

  return { built, dropped, plain };
}

// What up() or down() sends, on a database that answers every read with nothing.
async function recordQueries(
  migration: {
    up: (queryRunner: QueryRunner) => Promise<void>;
    down: (queryRunner: QueryRunner) => Promise<void>;
  },
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    isTransactionActive: false,
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

  return statements;
}

describe("the models", () => {
  test.each(KINDS)(
    "$table declares isFirstMembership: a switch the server alone writes, hidden from the API",
    (kind: Kind) => {
      const model: BaseModel = new kind.model();
      const column: TableColumnMetadata =
        model.getTableColumnMetadata("isFirstMembership");

      expect(column.type).toBe(TableColumnType.Boolean);
      expect(column.computed).toBe(true);
      expect(column.hideColumnInDocumentation).toBe(true);
      expect(column.required).toBe(true);
      expect(column.defaultValue).toBe(false);

      // Nobody writes or reads it through the API: the server decides it.
      expect(
        model.getColumnAccessControlForAllColumns()["isFirstMembership"],
      ).toEqual({ create: [], read: [], update: [] });
    },
  );

  test.each(KINDS)(
    "$table declares one partial unique index over its record, by the name the services recover from",
    (kind: Kind) => {
      const declared: Array<IndexMetadataArgs> =
        getMetadataArgsStorage().indices.filter(
          (index: IndexMetadataArgs): boolean => {
            return index.target === kind.model && index.name === kind.indexName;
          },
        );

      expect(declared).toHaveLength(1);
      expect(declared[0]!.unique).toBe(true);
      expect(declared[0]!.columns).toEqual([kind.recordColumn]);
      expect(declared[0]!.where).toBe(PREDICATE);
      expect(kind.indexName).toBe(`IDX_${kind.table}_first_membership`);
    },
  );
});

describe("AddEpisodeMemberFirstMembership: the columns", () => {
  test("adds both columns NOT NULL DEFAULT false: no member made before is a first, and no row is rewritten", async () => {
    expect(
      await recordQueries(
        new AddEpisodeMemberFirstMembership1807800000000(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "AlertEpisodeMember" ADD "isFirstMembership" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "IncidentEpisodeMember" ADD "isFirstMembership" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("down drops them again", async () => {
    expect(
      await recordQueries(
        new AddEpisodeMemberFirstMembership1807800000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "IncidentEpisodeMember" DROP COLUMN "isFirstMembership"`,
      `ALTER TABLE "AlertEpisodeMember" DROP COLUMN "isFirstMembership"`,
    ]);
  });

  test("builds no index: that is the next migration's, online", async () => {
    const statements: Array<string> = await recordQueries(
      new AddEpisodeMemberFirstMembership1807800000000(),
      "up",
    );

    for (const statement of statements) {
      expect(statement).not.toContain("INDEX");
    }
  });
});

describe("AddEpisodeMemberFirstMembershipIndexes: the indexes, online", () => {
  test("runs outside a transaction, as CREATE INDEX CONCURRENTLY must", () => {
    expect(
      new AddEpisodeMemberFirstMembershipIndexes1807810000000().transaction,
    ).toBe(false);
  });

  test.each(KINDS)(
    "hands OnlineDdl $table's index exactly as its model declares it, and runs nothing else",
    async (kind: Kind) => {
      const { built, plain } = await recordOnline("up");

      expect(built).toContain(
        `CREATE UNIQUE INDEX "${kind.indexName}" ON "${kind.table}" ("${kind.recordColumn}") WHERE ${PREDICATE}`,
      );
      expect(built).toHaveLength(2);
      expect(plain).toEqual([]);
    },
  );

  test("OnlineDdl reads each statement as a unique index it can build online", () => {
    for (const kind of KINDS) {
      expect(() => {
        OnlineDdl.parseCreateIndex(
          `CREATE UNIQUE INDEX "${kind.indexName}" ON "${kind.table}" ("${kind.recordColumn}") WHERE ${PREDICATE}`,
        );
      }).not.toThrow();
    }
  });

  test("down drops both indexes, online", async () => {
    const { dropped, plain } = await recordOnline("down");

    expect(dropped).toEqual([
      `DROP INDEX "public"."${INCIDENT_FIRST_MEMBERSHIP_INDEX}"`,
      `DROP INDEX "public"."${ALERT_FIRST_MEMBERSHIP_INDEX}"`,
    ]);
    expect(plain).toEqual([]);
  });
});

describe("registration", () => {
  const NAMES: Array<string> = [
    "AddEpisodeMemberFirstMembership1807800000000",
    "AddEpisodeMemberFirstMembershipIndexes1807810000000",
  ];

  test("both are registered, the columns first, the indexes right after", () => {
    const columns: number = registered.indexOf(NAMES[0]!);
    const indexes: number = registered.indexOf(NAMES[1]!);

    expect(columns).toBeGreaterThan(-1);
    expect(indexes).toBe(columns + 1);
  });

  test("their names carry their files' timestamps", () => {
    expect(new AddEpisodeMemberFirstMembership1807800000000().name).toBe(
      NAMES[0],
    );
    expect(new AddEpisodeMemberFirstMembershipIndexes1807810000000().name).toBe(
      NAMES[1],
    );

    for (const name of NAMES) {
      const stamp: number | null = timestampOf(name);

      expect(stamp).not.toBeNull();
      expect(
        fs.readdirSync(MIGRATIONS_DIR).some((file: string): boolean => {
          return file.startsWith(`${stamp}-`);
        }),
      ).toBe(true);
    }
  });

  test("each comes after every migration registered before it", () => {
    for (const name of NAMES) {
      const position: number = registered.indexOf(name);
      const stamp: number = timestampOf(name)!;

      for (const earlier of registered.slice(0, position)) {
        const earlierStamp: number | null = timestampOf(earlier);

        if (earlierStamp !== null) {
          expect([earlier, earlierStamp < stamp]).toEqual([earlier, true]);
        }
      }
    }
  });
});
