import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A TABLE'S "DONE" ROW IS NEVER TAKEN FOR A DATA MIGRATION (issue #6942).
 *
 * The Workers job Monitor:ClearStoredLogScreenshots records each table it
 * has finished clearing as a row of the DataMigrations table, named
 * ClearStoredLogScreenshots:<table> (StoredLogScreenshots.markTableDone),
 * written as the data migration runner writes a migration it ran. That is
 * safe only while the runner asks for each of its own migrations by name and
 * reads nothing else from the table, and while no migration is ever given a
 * done row's name: then a done row neither skips a migration nor stands for
 * one. Both are pinned here, against the real runner, with its list and its
 * reads replaced as in MigrationRunnerConcurrency.test.ts.
 */

/*
 * `any` rather than jest.Mock: the runner is driven through @jest/globals,
 * whose Mock<> generics do not line up with the ambient @types/jest ones.
 */
interface FakeMigration {
  name: string;
  migrate: any;
  rollback: any;
  runsInClusterMode: any;
}

const dataMigrations: Array<FakeMigration> = [];

jest.mock("../../../FeatureSet/Workers/DataMigrations/Index", () => {
  return { __esModule: true, default: dataMigrations };
});

jest.mock("Common/Server/Infrastructure/PostgresDatabase", () => {
  return {
    __esModule: true,
    default: {
      getDataSource: (): unknown => {
        return {};
      },
    },
  };
});

const findOneBy: any = jest.fn();
const create: any = jest.fn();

jest.mock("Common/Server/Services/DataMigrationService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return findOneBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return create(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Database/MigrationFailureLog", () => {
  return {
    __esModule: true,
    MigrationFailureType: { DataMigration: "DataMigration" },
    recordMigrationFailure: jest.fn(async (): Promise<void> => {}),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
const RunDatabaseMigrations: () => Promise<void> =
  require("../../../FeatureSet/Workers/Utils/DataMigration").default;
const StoredLogScreenshots: {
  STORED_LOG_TABLES: ReadonlyArray<string>;
  DONE_MARKER_PREFIX: string;
  getDoneMarkerName: (table: string) => string;
} = require("Common/Server/Utils/Retention/StoredLogScreenshots");
/* eslint-enable @typescript-eslint/no-require-imports */
/* eslint-enable @typescript-eslint/no-var-requires */

const DONE_MARKERS: Array<string> = StoredLogScreenshots.STORED_LOG_TABLES.map(
  (table: string): string => {
    return StoredLogScreenshots.getDoneMarkerName(table);
  },
);

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function buildMigration(name: string): FakeMigration {
  return {
    name: name,
    migrate: jest.fn(async (): Promise<void> => {}),
    rollback: jest.fn(async (): Promise<void> => {}),
    runsInClusterMode: jest.fn((): boolean => {
      return true;
    }),
  };
}

describe("a table's done row in DataMigrations", () => {
  beforeEach(() => {
    dataMigrations.length = 0;
    findOneBy.mockReset();
    create.mockReset();
    create.mockResolvedValue({});
  });

  test("is never taken for a migration that ran: the runner asks for each of its own by name, and runs the ones it does not find", async () => {
    // Every done row is in the table, and nothing else.
    findOneBy.mockImplementation(
      async (findBy: { query: { name: string } }): Promise<unknown> => {
        return DONE_MARKERS.includes(findBy.query.name)
          ? { name: findBy.query.name, executed: true }
          : null;
      },
    );

    const first: FakeMigration = buildMigration("AddSomethingNew");
    const second: FakeMigration = buildMigration("BackfillSomethingElse");
    dataMigrations.push(first, second);

    await RunDatabaseMigrations();

    expect(first.migrate).toHaveBeenCalledTimes(1);
    expect(second.migrate).toHaveBeenCalledTimes(1);
    expect(
      findOneBy.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { query: unknown }).query;
      }),
    ).toEqual([
      { name: "AddSomethingNew", executed: true },
      { name: "BackfillSomethingElse", executed: true },
    ]);
    // Each recorded as it ran, under its own name.
    expect(
      create.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { data: { name: string } }).data.name;
      }),
    ).toEqual(["AddSomethingNew", "BackfillSomethingElse"]);
  });

  test("names no data migration: no migration is, or will be taken for, a table's done row", () => {
    expect(StoredLogScreenshots.DONE_MARKER_PREFIX).toBe(
      "ClearStoredLogScreenshots:",
    );

    const sources: Array<string> = fs
      .readdirSync(DATA_MIGRATIONS_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".ts");
      })
      .map((file: string): string => {
        return fs.readFileSync(path.join(DATA_MIGRATIONS_DIR, file), "utf8");
      });

    expect(sources.length).toBeGreaterThan(100);

    for (const source of sources) {
      expect(source).not.toContain("ClearStoredLogScreenshots");
    }
  });
});
