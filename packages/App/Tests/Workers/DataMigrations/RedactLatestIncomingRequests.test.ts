import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import RedactLatestIncomingRequests, {
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/RedactLatestIncomingRequests";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";

/*
 * RedactLatestIncomingRequests (#6402): an Incoming Request monitor's
 * latest request was kept once, as it came, in the column everyone who can
 * read the monitor reads. The migration splits each monitor's request
 * (MonitorService.rewriteLatestIncomingRequestForReaders, whose write is
 * pinned in Common's MonitorKeepRequestContentRewrite and, against
 * Postgres, RedactLatestIncomingRequestsPostgres): the request as it came
 * moves beside the copy people read, and the copy is cut as the logs are.
 * Pinned here: which rows are read, that each is handed to the split, that
 * it walks the whole table a page at a time, and that a failing row holds
 * no other back.
 */
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

const MIGRATION_NAME: string = "RedactLatestIncomingRequests";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

interface StoredRow {
  _id: string;
  incomingMonitorRequest: unknown;
  deletedAt: Date | null;
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

interface StubbedTable {
  rows: Array<StoredRow>;
  statements: Array<Statement>;
}

// Ids that sort as text, as Postgres orders a uuid.
function idOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function stubTable(rows: Array<StoredRow>): StubbedTable {
  const table: StubbedTable = { rows: rows, statements: [] };

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      const statement: Statement = {
        sql: String(sql),
        parameters: (parameters as Array<unknown>) || [],
      };
      table.statements.push(statement);

      const limit: number = statement.parameters[0] as number;
      const after: string | undefined = statement.parameters[1] as
        | string
        | undefined;

      return table.rows
        .filter((row: StoredRow) => {
          return (
            row.incomingMonitorRequest !== null &&
            row.deletedAt === null &&
            (!after || row._id > after)
          );
        })
        .sort((a: StoredRow, b: StoredRow) => {
          return a._id < b._id ? -1 : 1;
        })
        .slice(0, limit)
        .map((row: StoredRow) => {
          return { _id: row._id };
        });
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: { query },
    } as never);

  return table;
}

function row(
  index: number,
  data: { request?: unknown; deletedAt?: Date | null } = {},
): StoredRow {
  return {
    _id: idOf(index),
    incomingMonitorRequest:
      data.request === undefined ? { requestMethod: "POST" } : data.request,
    deletedAt: data.deletedAt || null,
  };
}

describe("RedactLatestIncomingRequests", () => {
  const migration: RedactLatestIncomingRequests =
    new RedactLatestIncomingRequests();

  let split: SpyInstance<
    typeof MonitorService.rewriteLatestIncomingRequestForReaders
  >;

  function splitIds(): Array<string> {
    return split.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as ObjectID).toString();
    });
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    split = jest
      .spyOn(MonitorService, "rewriteLatestIncomingRequestForReaders")
      .mockResolvedValue(true);
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("is registered exactly once, before the last slot, which AddAuditLogMcpClientColumns keeps", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(
        instantiations.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 1,
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("rollback changes nothing", async () => {
      const table: StubbedTable = stubTable([row(1)]);

      await migration.rollback();

      expect(table.statements).toHaveLength(0);
      expect(split).not.toHaveBeenCalled();
    });
  });

  describe("what it reads", () => {
    test("the id alone of each monitor holding a request, deleted ones left out", async () => {
      const table: StubbedTable = stubTable([
        row(1),
        row(2, { request: null }),
        row(3, { deletedAt: new Date("2026-11-01T00:00:00.000Z") }),
        row(4),
      ]);

      await migration.migrate();

      expect(table.statements[0]!.sql).toBe(
        'SELECT "_id" FROM "Monitor" WHERE "incomingMonitorRequest" IS NOT NULL AND "deletedAt" IS NULL ORDER BY "_id" ASC LIMIT $1',
      );
      expect(table.statements[0]!.parameters).toEqual([PAGE_SIZE]);
      expect(splitIds()).toEqual([idOf(1), idOf(4)]);
    });

    test("it reads through the statement's parameters: no value is written into its text", async () => {
      const table: StubbedTable = stubTable(
        Array.from(
          { length: PAGE_SIZE + 1 },
          (_value: unknown, index: number) => {
            return row(index + 1);
          },
        ),
      );

      await migration.migrate();

      expect(table.statements[1]!.sql).toContain('AND "_id" > $2');
      expect(table.statements[1]!.sql).not.toContain(idOf(PAGE_SIZE));
      expect(table.statements[1]!.parameters).toEqual([
        PAGE_SIZE,
        idOf(PAGE_SIZE),
      ]);
    });
  });

  describe("what it writes", () => {
    test("hands each monitor to the one split, by its id", async () => {
      stubTable([row(1), row(2)]);

      await migration.migrate();

      expect(split).toHaveBeenCalledTimes(2);
      expect(split.mock.calls[0]![0]).toBeInstanceOf(ObjectID);
      expect(splitIds()).toEqual([idOf(1), idOf(2)]);
    });

    test("says how many it split and how many failed", async () => {
      stubTable([row(1), row(2), row(3)]);
      split
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error("could not write"));

      await migration.migrate();

      expect(logger.info).toHaveBeenCalledWith(
        "RedactLatestIncomingRequests: the latest request of 1 monitors split, 1 failed.",
      );
    });
  });

  describe("how it walks the table", () => {
    test("pages by id until a short page", async () => {
      const table: StubbedTable = stubTable(
        Array.from(
          { length: PAGE_SIZE * 2 + 3 },
          (_value: unknown, index: number) => {
            return row(index + 1);
          },
        ),
      );

      await migration.migrate();

      expect(table.statements).toHaveLength(3);
      expect(split).toHaveBeenCalledTimes(PAGE_SIZE * 2 + 3);
      expect(new Set(splitIds()).size).toBe(PAGE_SIZE * 2 + 3);
    });

    test("a full last page reads one more, empty page, and stops", async () => {
      const table: StubbedTable = stubTable(
        Array.from({ length: PAGE_SIZE }, (_value: unknown, index: number) => {
          return row(index + 1);
        }),
      );

      await migration.migrate();

      expect(table.statements).toHaveLength(2);
      expect(split).toHaveBeenCalledTimes(PAGE_SIZE);
    });

    test("keeps going after a monitor it cannot split, and logs which", async () => {
      stubTable([row(1), row(2), row(3)]);
      split.mockImplementation(async (monitorId: ObjectID) => {
        if (monitorId.toString() === idOf(2)) {
          throw new Error("could not write");
        }
        return true;
      });

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(splitIds()).toEqual([idOf(1), idOf(2), idOf(3)]);
      expect(logger.error).toHaveBeenCalledWith(
        `RedactLatestIncomingRequests: the latest request of monitor ${idOf(2)} was not split.`,
      );
    });

    test("a table with no request in it reads once and writes nothing", async () => {
      const table: StubbedTable = stubTable([row(1, { request: null })]);

      await migration.migrate();

      expect(table.statements).toHaveLength(1);
      expect(split).not.toHaveBeenCalled();
    });
  });
});
