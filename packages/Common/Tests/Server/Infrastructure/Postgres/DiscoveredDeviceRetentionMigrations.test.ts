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
import NetworkEndpoint from "../../../../Models/DatabaseModels/NetworkEndpoint";
import Project from "../../../../Models/DatabaseModels/Project";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDiscoveredDeviceRetention1809080463890 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809080463890-AddDiscoveredDeviceRetention";
import { AddNetworkEndpointLastSeenIndex1809080463891 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809080463891-AddNetworkEndpointLastSeenIndex";
import { KeepEditedDiscoveredDevices1809080463892 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809080463892-KeepEditedDiscoveredDevices";
import { DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS } from "../../../../Types/NetworkDevice/DiscoveredDeviceRetention";

/*
 * The migrations behind removing discovered devices nothing sees any more
 * (issue #6389), run against a fake QueryRunner so up() and down() are told
 * apart:
 *
 *   - AddDiscoveredDeviceRetention: the project's setting, 30 for every
 *     project, and the endpoint's editedAt - a constant default and a
 *     nullable column, metadata only on Postgres 11 and later;
 *   - AddNetworkEndpointLastSeenIndex: the index the job reads, built
 *     online (outside a transaction, CONCURRENTLY through OnlineDdl), named
 *     as the entity's index so the drift check finds nothing to generate;
 *   - KeepEditedDiscoveredDevices: the devices people changed before the
 *     upgrade (version above 0: only TypeORM, so only the API, writes
 *     more than 0) are marked edited, so the first run keeps them.
 *
 * The drift check and the Postgres suites run them for real.
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

// A registered migration's name ends with its 13-figure number.
const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

const MIGRATIONS: Array<OurMigration> = [
  {
    timestamp: "1809080463890",
    baseName: "AddDiscoveredDeviceRetention",
    migration: new AddDiscoveredDeviceRetention1809080463890(),
  },
  {
    timestamp: "1809080463891",
    baseName: "AddNetworkEndpointLastSeenIndex",
    migration: new AddNetworkEndpointLastSeenIndex1809080463891(),
  },
  {
    timestamp: "1809080463892",
    baseName: "KeepEditedDiscoveredDevices",
    migration: new KeepEditedDiscoveredDevices1809080463892(),
  },
];

const INDEX_NAME: string = "IDX_aabb790d91b44c32192ba02414";

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

describe("AddDiscoveredDeviceRetention1809080463890", () => {
  const migration: MigrationInterface =
    new AddDiscoveredDeviceRetention1809080463890();

  test("adds the project's setting at 30 days for every project, and the endpoint's editedAt", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `ALTER TABLE "Project" ADD "discoveredDeviceRetentionInDays" integer NOT NULL DEFAULT '30'`,
      `ALTER TABLE "NetworkEndpoint" ADD "editedAt" TIMESTAMP WITH TIME ZONE`,
    ]);
  });

  test("the default it writes is the one the model and the setting say", async () => {
    const [projectColumn]: Array<string> = await statementsOf(migration, "up");

    expect(projectColumn).toContain(
      `DEFAULT '${DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS}'`,
    );
    expect(
      new Project().getTableColumnMetadata("discoveredDeviceRetentionInDays")
        .defaultValue,
    ).toBe(DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS);
  });

  test("rewrites no row and builds no index: a constant default and a nullable column are metadata", async () => {
    for (const statement of await statementsOf(migration, "up")) {
      expect(statement).not.toMatch(
        /INDEX|CONSTRAINT|FOREIGN KEY|UPDATE |DELETE |now\(\)/i,
      );
    }
  });

  test("down drops both columns, the endpoint's first", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `ALTER TABLE "NetworkEndpoint" DROP COLUMN "editedAt"`,
      `ALTER TABLE "Project" DROP COLUMN "discoveredDeviceRetentionInDays"`,
    ]);
  });
});

describe("AddNetworkEndpointLastSeenIndex1809080463891", () => {
  const migration: AddNetworkEndpointLastSeenIndex1809080463891 =
    new AddNetworkEndpointLastSeenIndex1809080463891();

  test("runs outside a transaction, so the index is built online", () => {
    expect(migration.transaction).toBe(false);
  });

  test("builds the live rows' index by project and last seen, through OnlineDdl only", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `online: CREATE INDEX "${INDEX_NAME}" ON "NetworkEndpoint" ("projectId", "lastSeenAt") WHERE "deletedAt" IS NULL`,
    ]);
  });

  test("down drops it online", async () => {
    expect(await statementsOf(migration, "down")).toEqual([
      `online: DROP INDEX "public"."${INDEX_NAME}"`,
    ]);
  });

  test("its name is the one TypeORM gives the entity's index, so the drift check generates nothing", () => {
    const indexes: Array<IndexMetadataArgs> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs): boolean => {
        return index.target === NetworkEndpoint;
      })
      .filter((index: IndexMetadataArgs): boolean => {
        const columns: unknown = index.columns;

        return (
          Array.isArray(columns) && columns.join(",") === "projectId,lastSeenAt"
        );
      });

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.where).toBe(`"deletedAt" IS NULL`);
    expect(indexes[0]!.unique).toBeFalsy();
    expect(
      new DefaultNamingStrategy().indexName(
        "NetworkEndpoint",
        ["projectId", "lastSeenAt"],
        `"deletedAt" IS NULL`,
      ),
    ).toBe(INDEX_NAME);
  });
});

describe("KeepEditedDiscoveredDevices1809080463892", () => {
  const migration: MigrationInterface =
    new KeepEditedDiscoveredDevices1809080463892();

  test("marks the live devices the API wrote as edited, when they were last changed", async () => {
    expect(await statementsOf(migration, "up")).toEqual([
      `UPDATE "NetworkEndpoint" SET "editedAt" = "updatedAt" WHERE "deletedAt" IS NULL AND "editedAt" IS NULL AND "version" > 0`,
    ]);
  });

  test("runs in a transaction of its own, and changes nothing a second time", async () => {
    expect(
      (migration as unknown as { transaction?: boolean }).transaction,
    ).toBeUndefined();
    // Only rows without editedAt are written: a second run finds none.
    expect((await statementsOf(migration, "up"))[0]).toContain(
      `"editedAt" IS NULL`,
    );
  });

  test("down has nothing to undo: the column goes with the migration before it", async () => {
    expect(await statementsOf(migration, "down")).toEqual([]);
  });
});

describe("the three, registered", () => {
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

  test("run in order - the columns, then the index, then the backfill - after every migration before them", () => {
    const positions: Array<number> = MIGRATIONS.map(
      ({ timestamp, baseName }: OurMigration): number => {
        return names.indexOf(`${baseName}${timestamp}`);
      },
    );

    expect(positions[0]).toBeGreaterThan(
      names.indexOf("AddProjectAiRunLimits1809080210000"),
    );
    expect(positions[1]).toBe(positions[0]! + 1);
    expect(positions[2]).toBe(positions[1]! + 1);

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });
    const ours: Array<number> = MIGRATIONS.map(
      ({ timestamp }: OurMigration): number => {
        return Number(timestamp);
      },
    );

    // Each timestamp is a file of its own, and later than every other file before it.
    for (const timestamp of ours) {
      expect(
        timestamps.filter((value: number): boolean => {
          return value === timestamp;
        }),
      ).toHaveLength(1);
    }

    // Newer than every migration registered before them.
    const before: Array<number> = names
      .slice(0, positions[0])
      .map((name: string): number => {
        return Number(TRAILING_TIMESTAMP.exec(name)?.[1] || 0);
      });

    expect(before.length).toBeGreaterThan(100);
    expect(Math.max(...before)).toBeLessThan(Math.min(...ours));
  });
});
