jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import WorkflowService from "../../../../Server/Services/WorkflowService";
import HuntressConnectionsToWorkflows, {
  DROP_LEGACY_TABLES_SQL,
  LEGACY_CONNECTIONS_SQL,
  LEGACY_TABLES,
  LEGACY_TABLE_SQL,
  LegacyQuery,
  LegacyTablesDropSummary,
  UNMOVED_CONNECTIONS_SQL,
} from "../../../../Server/Utils/Huntress/HuntressConnectionsToWorkflows";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE LEGACY HUNTRESS TABLES GO ONCE EVERY CONNECTION HAS ITS WORKFLOW
 * (HuntressConnectionsToWorkflows.dropLegacyTables, run by the Workers'
 * data migration DropLegacyHuntressTables after the move).
 *
 * They go all four in one statement, and only when no connection in use
 * is without its workflow - its move failed, or the workflow was deleted
 * since - so nothing a connection was set up to do is lost. The move is
 * never run again here: it would make again a workflow someone deleted.
 *
 * The database is a fake that answers the statements by name; the same
 * runs against a migrated Postgres in HuntressPostgres.test.ts.
 */

interface FakeDatabase {
  hasConnectionTable: boolean;
  hasReportTable: boolean;
  unmoved: unknown;
  // The count fails: an Error, or "dropped meanwhile" by another runner.
  countFails: Error | "dropped-meanwhile" | null;
  dropFails: Error | null;
  statements: Array<string>;
}

let database: FakeDatabase;

function fakeQuery(): LegacyQuery {
  return async (sql: string): Promise<unknown> => {
    database.statements.push(sql);

    switch (sql) {
      case LEGACY_TABLE_SQL:
        return [
          {
            hasConnectionTable: database.hasConnectionTable,
            hasReportTable: database.hasReportTable,
          },
        ];
      case UNMOVED_CONNECTIONS_SQL:
        if (database.countFails === "dropped-meanwhile") {
          database.hasConnectionTable = false;
          database.hasReportTable = false;
          throw new Error('relation "HuntressConnection" does not exist');
        }

        if (database.countFails) {
          throw database.countFails;
        }

        return [{ unmoved: database.unmoved }];
      case DROP_LEGACY_TABLES_SQL:
        if (database.dropFails) {
          throw database.dropFails;
        }

        database.hasConnectionTable = false;
        database.hasReportTable = false;
        return [];
      default:
        throw new Error(`Unexpected statement: ${sql}`);
    }
  };
}

async function drop(): Promise<LegacyTablesDropSummary> {
  return await HuntressConnectionsToWorkflows.dropLegacyTables(fakeQuery());
}

beforeEach(() => {
  database = {
    hasConnectionTable: true,
    hasReportTable: true,
    unmoved: 0,
    countFails: null,
    dropFails: null,
    statements: [],
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every connection in use has its workflow", () => {
  test("the four tables go, in one statement", async () => {
    expect(await drop()).toEqual({ outcome: "dropped", unmoved: 0 });
    expect(database.statements).toEqual([
      LEGACY_TABLE_SQL,
      UNMOVED_CONNECTIONS_SQL,
      DROP_LEGACY_TABLES_SQL,
    ]);
  });

  test("the statement names all four, those that reference a connection first, and drops only what is there", () => {
    expect(LEGACY_TABLES).toEqual([
      "HuntressIncidentReport",
      "HuntressConnectionLabel",
      "HuntressConnectionOnCallDutyPolicy",
      "HuntressConnection",
    ]);
    expect(DROP_LEGACY_TABLES_SQL).toBe(
      'DROP TABLE IF EXISTS "HuntressIncidentReport", "HuntressConnectionLabel", "HuntressConnectionOnCallDutyPolicy", "HuntressConnection"',
    );
    // Never CASCADE: nothing else may go with them.
    expect(DROP_LEGACY_TABLES_SQL).not.toContain("CASCADE");
  });

  test("the move is not run again: no connection is read, no workflow made", async () => {
    const create: SpyInstance<typeof WorkflowService.create> = jest.spyOn(
      WorkflowService,
      "create",
    );

    await drop();

    expect(database.statements).not.toContain(LEGACY_CONNECTIONS_SQL);
    expect(create).not.toHaveBeenCalled();
  });

  test("run again once they are gone, nothing is read past the check and nothing dropped", async () => {
    await drop();
    database.statements = [];

    expect(await drop()).toEqual({ outcome: "no-tables", unmoved: 0 });
    expect(database.statements).toEqual([LEGACY_TABLE_SQL]);
  });
});

describe("a connection in use has no workflow", () => {
  test("all four stay, and the summary says how many such connections there are", async () => {
    database.unmoved = 2;

    expect(await drop()).toEqual({ outcome: "kept", unmoved: 2 });
    expect(database.statements).not.toContain(DROP_LEGACY_TABLES_SQL);
    expect(database.hasConnectionTable).toBe(true);
  });

  test("a count that is not a number keeps them too, as connections would", async () => {
    database.unmoved = "many";

    expect(await drop()).toEqual({ outcome: "kept", unmoved: 0 });
    expect(database.statements).not.toContain(DROP_LEGACY_TABLES_SQL);
  });

  test("the count is of connections in use that no workflow of their id is there for", () => {
    expect(UNMOVED_CONNECTIONS_SQL).toContain(
      '"connection"."deletedAt" IS NULL',
    );
    expect(UNMOVED_CONNECTIONS_SQL).toContain(
      'NOT EXISTS (SELECT 1 FROM "Workflow" "workflow" WHERE "workflow"."_id" = "connection"."_id")',
    );
    // A workflow of the connection's id is its own, whatever happened to it after.
    expect(UNMOVED_CONNECTIONS_SQL).not.toContain('"workflow"."deletedAt"');
  });
});

describe("no connections table", () => {
  test("an install that never had one, or dropped them: nothing is read past the check", async () => {
    database.hasConnectionTable = false;
    database.hasReportTable = false;

    expect(await drop()).toEqual({ outcome: "no-tables", unmoved: 0 });
    expect(database.statements).toEqual([LEGACY_TABLE_SQL]);
  });

  test("a report table left without it goes", async () => {
    database.hasConnectionTable = false;

    expect(await drop()).toEqual({ outcome: "dropped", unmoved: 0 });
    expect(database.statements).toEqual([
      LEGACY_TABLE_SQL,
      DROP_LEGACY_TABLES_SQL,
    ]);
  });
});

describe("two runners at once, and failures", () => {
  test("tables another runner dropped meanwhile are no failure", async () => {
    database.countFails = "dropped-meanwhile";

    expect(await drop()).toEqual({ outcome: "no-tables", unmoved: 0 });
    expect(database.statements).not.toContain(DROP_LEGACY_TABLES_SQL);
  });

  test("a count that fails while the tables are there reaches the caller, to be tried again", async () => {
    database.countFails = new Error("the database is down");

    await expect(drop()).rejects.toThrow("the database is down");
    expect(database.statements).not.toContain(DROP_LEGACY_TABLES_SQL);
  });

  test("a drop that fails reaches the caller", async () => {
    database.dropFails = new Error("lock timeout");

    await expect(drop()).rejects.toThrow("lock timeout");
  });
});
