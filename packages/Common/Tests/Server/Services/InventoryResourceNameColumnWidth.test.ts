import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import KubernetesContainer from "../../../Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "../../../Models/DatabaseModels/KubernetesResource";
import PodmanResource from "../../../Models/DatabaseModels/PodmanResource";
import { MigrationName1776504277320 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1776504277320-MigrationName";
import { MigrationName1777571961028 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1777571961028-MigrationName";
import { MigrationName1781750000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1781750000000-MigrationName";
import { WidenInventoryResourceNameColumns1785930000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1785930000000-WidenInventoryResourceNameColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ColumnType from "../../../Types/Database/ColumnType";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * Follow-up to issue #3006, same overflow class but on the bulk-upsert
 * inventory paths, where the blast radius is much worse. Those services
 * hand-build `INSERT ... ON CONFLICT` strings and flush them through
 * `manager.query()` in chunks of 500 rows, so ONE value past
 * varchar(100) raises 22001 and aborts the ENTIRE multi-row INSERT —
 * up to 500 inventory rows dropped per flush, silently.
 *
 * The columns that actually overflow in the field:
 *   - PodmanResource.name / .imageName — full image references
 *     (registry host + org + repo + tag) run well past 100 chars.
 *   - KubernetesResource.name, KubernetesContainer.podName — Kubernetes
 *     DNS-subdomain names go to 253 chars, and generated pod names
 *     (deployment + replicaset hash + pod hash) routinely clear 100.
 *   - KubernetesResource.controllerDeploymentName — written from the
 *     `k8s.deployment.name` resource attribute, same bound.
 *
 * Three things have to line up for the fix to hold, and a regression in
 * any one of them silently reintroduces the bug:
 *   1. the entities declare varchar(500) (LongText) columns,
 *   2. the migration actually widens the existing columns in Postgres,
 *      and its down() can narrow back without exploding on rows written
 *      since, and
 *   3. the migration is registered in SchemaMigrations/Index.ts — an
 *      unregistered migration is dead code that never runs on boot.
 *
 * Pure metadata/mocks — no Postgres connection anywhere.
 */

// Kubernetes caps DNS-subdomain names (pods, deployments) at 253 chars.
const KUBERNETES_NAME_CEILING: number = 253;

interface WidenedColumn {
  label: string;
  table: string;
  target: unknown;
  newInstance: () => BaseModel;
  /** The migration whose DDL first declared this column at varchar(100). */
  createdBy: () => MigrationInterface;
  propertyName: string;
  nullable: boolean;
}

const WIDENED_COLUMNS: Array<WidenedColumn> = [
  {
    label: "PodmanResource.name",
    table: "PodmanResource",
    target: PodmanResource,
    newInstance: (): BaseModel => {
      return new PodmanResource();
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1781750000000();
    },
    propertyName: "name",
    nullable: false,
  },
  {
    label: "PodmanResource.imageName",
    table: "PodmanResource",
    target: PodmanResource,
    newInstance: (): BaseModel => {
      return new PodmanResource();
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1781750000000();
    },
    propertyName: "imageName",
    nullable: true,
  },
  {
    label: "KubernetesResource.name",
    table: "KubernetesResource",
    target: KubernetesResource,
    newInstance: (): BaseModel => {
      return new KubernetesResource();
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1776504277320();
    },
    propertyName: "name",
    nullable: false,
  },
  {
    label: "KubernetesResource.controllerDeploymentName",
    table: "KubernetesResource",
    target: KubernetesResource,
    newInstance: (): BaseModel => {
      return new KubernetesResource();
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1777571961028();
    },
    propertyName: "controllerDeploymentName",
    nullable: true,
  },
  {
    label: "KubernetesContainer.podName",
    table: "KubernetesContainer",
    target: KubernetesContainer,
    newInstance: (): BaseModel => {
      return new KubernetesContainer();
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1777571961028();
    },
    propertyName: "podName",
    nullable: false,
  },
];

function columnArgs(column: WidenedColumn): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === column.target;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === column.propertyName;
    });

  if (!args) {
    throw new Error(`${column.label} has no TypeORM @Column metadata`);
  }

  return args;
}

function makeQueryRunner(): { runner: QueryRunner; query: jest.Mock } {
  const query: jest.Mock = jest.fn().mockResolvedValue(undefined);
  return { runner: { query } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("widened inventory entity declarations", () => {
  test.each(WIDENED_COLUMNS)(
    "$label is a LongText varchar(500) column",
    (column: WidenedColumn) => {
      const args: ColumnMetadataArgs = columnArgs(column);
      expect(args.options.type).toBe(ColumnType.LongText);
      expect(args.options.length).toBe(ColumnLength.LongText);
      expect(ColumnLength.LongText).toBe(500);
    },
  );

  test.each(WIDENED_COLUMNS)(
    "$label keeps its original nullability, so the widening is type-only",
    (column: WidenedColumn) => {
      expect(columnArgs(column).options.nullable).toBe(column.nullable);
    },
  );

  test.each(WIDENED_COLUMNS)(
    "$label reports TableColumnType.LongText",
    (column: WidenedColumn) => {
      const metadata: TableColumnMetadata = column
        .newInstance()
        .getTableColumnMetadata(column.propertyName);
      expect(metadata.type).toBe(TableColumnType.LongText);
    },
  );

  test.each(WIDENED_COLUMNS)(
    "$label clears the 253-char Kubernetes name ceiling",
    (column: WidenedColumn) => {
      const metadata: TableColumnMetadata = column
        .newInstance()
        .getTableColumnMetadata(column.propertyName);
      const maxLength: number | undefined = getMaxLengthFromTableColumnType(
        metadata.type,
      );

      expect(maxLength).toBe(500);
      expect(maxLength as number).toBeGreaterThanOrEqual(
        KUBERNETES_NAME_CEILING,
      );
    },
  );

  test.each(WIDENED_COLUMNS)(
    "$label stays readable on relation queries",
    (column: WidenedColumn) => {
      const metadata: TableColumnMetadata = column
        .newInstance()
        .getTableColumnMetadata(column.propertyName);
      expect(metadata.canReadOnRelationQuery).toBe(true);
    },
  );

  test("these columns would all have been rejected under the old ShortText declaration", () => {
    /*
     * Guards the premise of the fix: 100 really was the bound that a
     * 253-char pod name and a long GHCR image reference blew through.
     */
    expect(getMaxLengthFromTableColumnType(TableColumnType.ShortText)).toBe(
      100,
    );
    expect(ColumnLength.ShortText).toBeLessThan(KUBERNETES_NAME_CEILING);
  });
});

describe("WidenInventoryResourceNameColumns1785930000000 SQL contract", () => {
  const migration: WidenInventoryResourceNameColumns1785930000000 =
    new WidenInventoryResourceNameColumns1785930000000();

  test("up() widens exactly the five offending columns to varchar(500)", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    expect(executedSql(query)).toEqual([
      `ALTER TABLE "PodmanResource" ALTER COLUMN "name" TYPE character varying(500)`,
      `ALTER TABLE "PodmanResource" ALTER COLUMN "imageName" TYPE character varying(500)`,
      `ALTER TABLE "KubernetesResource" ALTER COLUMN "name" TYPE character varying(500)`,
      `ALTER TABLE "KubernetesResource" ALTER COLUMN "controllerDeploymentName" TYPE character varying(500)`,
      `ALTER TABLE "KubernetesContainer" ALTER COLUMN "podName" TYPE character varying(500)`,
    ]);
  });

  test("up() only ever widens — it never drops or deletes", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    for (const sql of executedSql(query)) {
      expect(sql).toContain("ALTER COLUMN");
      expect(sql).not.toContain("DROP");
      expect(sql).not.toContain("DELETE");
    }
  });

  test("up() touches no table outside the three inventory tables", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const tables: Set<string> = new Set(
      WIDENED_COLUMNS.map((column: WidenedColumn) => {
        return column.table;
      }),
    );

    for (const sql of executedSql(query)) {
      const matched: Array<string> = Array.from(tables).filter(
        (table: string) => {
          return sql.includes(`"${table}"`);
        },
      );
      expect(matched).toHaveLength(1);
    }
  });

  test("down() clips oversized rows BEFORE narrowing, so the revert cannot fail", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.down(runner);

    const statements: Array<string> = executedSql(query);
    const firstNarrowIndex: number = statements.findIndex((sql: string) => {
      return sql.includes("character varying(100)");
    });
    expect(firstNarrowIndex).toBeGreaterThan(0);

    for (const column of WIDENED_COLUMNS) {
      const clipIndex: number = statements.findIndex((sql: string) => {
        return (
          sql.startsWith(`UPDATE "${column.table}"`) &&
          sql.includes(`SET "${column.propertyName}" = LEFT(`) &&
          sql.includes("100")
        );
      });

      expect(clipIndex).toBeGreaterThanOrEqual(0);
      expect(clipIndex).toBeLessThan(firstNarrowIndex);
    }
  });

  test("down() resolves unique-index collisions before it clips", async () => {
    /*
     * "name" / "podName" are part of UNIQUE indexes. Two rows whose
     * names differ only past character 100 would collide once clipped,
     * so the dedupe DELETEs have to land before the clipping UPDATEs.
     */
    const { runner, query } = makeQueryRunner();
    await migration.down(runner);

    const statements: Array<string> = executedSql(query);
    const deleteIndexes: Array<number> = [];
    statements.forEach((sql: string, index: number) => {
      if (sql.startsWith("DELETE FROM")) {
        deleteIndexes.push(index);
      }
    });
    const firstClipIndex: number = statements.findIndex((sql: string) => {
      return sql.startsWith("UPDATE");
    });

    // One dedupe per uniquely-indexed table.
    expect(deleteIndexes).toHaveLength(3);
    expect(firstClipIndex).toBeGreaterThanOrEqual(0);
    for (const deleteIndex of deleteIndexes) {
      expect(deleteIndex).toBeLessThan(firstClipIndex);
      expect(statements[deleteIndex]).toContain("LEFT(");
    }
  });

  test("down() narrows every widened column back to varchar(100)", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.down(runner);

    const statements: Array<string> = executedSql(query);
    for (const column of WIDENED_COLUMNS) {
      expect(statements).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(100)`,
      );
    }
  });

  test.each(WIDENED_COLUMNS)(
    "down() restores $label to exactly the width its creating migration used",
    async (column: WidenedColumn) => {
      const { runner: createRunner, query: createQuery } = makeQueryRunner();
      await column.createdBy().up(createRunner);

      /*
       * Scope the search to the statement that declares THIS table. A
       * bare substring search for `"name" character varying(100)` is
       * satisfied by any of the dozens of unrelated tables in the same
       * migration, which makes the precondition unfalsifiable.
       *
       * The original DDL declared varchar(100) — the revert must match,
       * or a rollback leaves the schema drifted from the entities.
       */
      const declaringStatement: string | undefined = executedSql(
        createQuery,
      ).find((sql: string) => {
        return (
          (sql.startsWith(`CREATE TABLE "${column.table}" (`) ||
            sql.startsWith(`ALTER TABLE "${column.table}" ADD `)) &&
          sql.includes(`"${column.propertyName}" character varying(100)`)
        );
      });

      expect(declaringStatement).toBeDefined();

      const { runner: downRunner, query: downQuery } = makeQueryRunner();
      await migration.down(downRunner);

      expect(executedSql(downQuery)).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(100)`,
      );
    },
  );

  test("up() and down() touch exactly the same set of columns", async () => {
    const { runner: upRunner, query: upQuery } = makeQueryRunner();
    await migration.up(upRunner);
    const { runner: downRunner, query: downQuery } = makeQueryRunner();
    await migration.down(downRunner);

    const alteredColumns: (statements: Array<string>) => Array<string> = (
      statements: Array<string>,
    ): Array<string> => {
      return statements
        .filter((sql: string) => {
          return sql.startsWith("ALTER TABLE");
        })
        .map((sql: string) => {
          const match: RegExpMatchArray | null = sql.match(
            /ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)"/,
          );
          return match ? `${match[1]}.${match[2]}` : sql;
        })
        .sort();
    };

    expect(alteredColumns(executedSql(downQuery))).toEqual(
      alteredColumns(executedSql(upQuery)),
    );
  });

  test("the class name carries its own timestamp, matching the file name", () => {
    expect(migration.name).toBe(
      "WidenInventoryResourceNameColumns1785930000000",
    );
  });
});

describe("migration and entity declarations agree", () => {
  /*
   * The failure this catches: widening the entity but not the migration
   * (or vice versa). Postgres would keep rejecting long values while the
   * model claims they fit, and CI's schema-drift check is the only other
   * thing standing between that and production.
   */
  const migration: WidenInventoryResourceNameColumns1785930000000 =
    new WidenInventoryResourceNameColumns1785930000000();

  test("the migration widens exactly the columns the entities declare as LongText", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const widenedByMigration: Array<string> = executedSql(query)
      .map((sql: string) => {
        const match: RegExpMatchArray | null = sql.match(
          /ALTER TABLE "(\w+)" ALTER COLUMN "(\w+)" TYPE character varying\(500\)/,
        );
        return match ? `${match[1]}.${match[2]}` : "";
      })
      .filter((entry: string) => {
        return entry.length > 0;
      })
      .sort();

    const declaredByEntities: Array<string> = WIDENED_COLUMNS.map(
      (column: WidenedColumn) => {
        return `${column.table}.${column.propertyName}`;
      },
    ).sort();

    expect(widenedByMigration).toEqual(declaredByEntities);
  });

  test("every column the migration widens really is varchar(500) on the entity", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    for (const column of WIDENED_COLUMNS) {
      const args: ColumnMetadataArgs = columnArgs(column);
      expect(args.options.length).toBe(500);
      expect(executedSql(query)).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(${args.options.length})`,
      );
    }
  });
});

describe("WidenInventoryResourceNameColumns1785930000000 registration", () => {
  test("is registered in SchemaMigrations/Index.ts", () => {
    expect(SchemaMigrations).toContain(
      WidenInventoryResourceNameColumns1785930000000,
    );
  });

  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return migration === WidenInventoryResourceNameColumns1785930000000;
      },
    ).length;
    expect(occurrences).toBe(1);
  });

  test.each([
    ["KubernetesResource", MigrationName1776504277320],
    ["KubernetesContainer", MigrationName1777571961028],
    ["PodmanResource", MigrationName1781750000000],
  ])(
    "runs after the migration that created %s",
    (_table: string, createMigration: unknown) => {
      /*
       * TypeORM executes registered migrations in array order. Widening
       * a column on a table that does not exist yet fails, so every
       * CREATE TABLE must come first.
       */
      const createIndex: number = SchemaMigrations.indexOf(
        createMigration as never,
      );
      const widenIndex: number = SchemaMigrations.indexOf(
        WidenInventoryResourceNameColumns1785930000000,
      );

      expect(createIndex).toBeGreaterThanOrEqual(0);
      expect(widenIndex).toBeGreaterThan(createIndex);
    },
  );
});
