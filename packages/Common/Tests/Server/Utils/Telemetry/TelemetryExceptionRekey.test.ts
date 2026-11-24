import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import TelemetryExceptionRekey, {
  ExceptionRekeyOutcome,
  ExceptionRekeyResult,
  FORMER_FINGERPRINT_OWNER_SQL,
} from "../../../../Server/Utils/Telemetry/TelemetryExceptionRekey";
import logger from "../../../../Server/Utils/Logger";

/*
 * ---------------------------------------------------------------------------
 * MOVING AN EXCEPTION TO A PRIVATE FINGERPRINT ON ITS NEXT OCCURRENCE (#10619).
 *
 * An exception made before #10434 under an unkeyed hash of text a scrub rule
 * now hides keeps its row - id, state, history, counts - and takes the keyed
 * fingerprint of the same text; its old fingerprint is kept by a row of its
 * own, merged into the exception's group, so the occurrences recorded under
 * it are still the exception's. These hold the transaction's statements, in
 * order, with Postgres faked: ExceptionPrivateFingerprintPostgres.test.ts
 * runs them against a real one.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000010619";
const SERVICE_ID: string = "20000000-0000-4000-8000-000000010619";
const EXCEPTION_ID: string = "30000000-0000-4000-8000-000000010619";
const SURVIVOR_ID: string = "40000000-0000-4000-8000-000000010619";
const FROM: string = "a".repeat(64);
const TO: string = "b".repeat(64);

interface Statement {
  sql: string;
  params: Array<unknown>;
}

// What the fake database answers, statement by statement.
interface FakeDatabase {
  // The row under the old fingerprint, as the lock reads it.
  row?: Record<string, unknown> | undefined;
  // The fingerprint of the exception a former fingerprint is kept for.
  owner?: string | undefined;
  // Whether another row already has the keyed fingerprint.
  taken?: boolean | undefined;
  // Make the transaction fail.
  fails?: boolean | undefined;
}

let statements: Array<Statement>;
let database: FakeDatabase;

const SEEN: Record<string, unknown> = {
  primaryEntityType: "OpenTelemetry",
  exceptionType: "InvalidSsnError",
  firstSeenAt: new Date("2026-10-01T00:00:00Z"),
  lastSeenAt: new Date("2026-11-01T00:00:00Z"),
  firstSeenInRelease: "1.0.0",
  lastSeenInRelease: "1.4.0",
};

function fakeManager(): unknown {
  return {
    query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
      statements.push({ sql, params });

      if (database.fails && sql.startsWith("UPDATE")) {
        throw new Error("deadlock detected");
      }

      if (sql.includes("FOR UPDATE")) {
        return database.row ? [database.row] : [];
      }

      if (sql === FORMER_FINGERPRINT_OWNER_SQL) {
        return database.owner ? [{ fingerprint: database.owner }] : [];
      }

      if (
        sql.startsWith(`SELECT "_id"::text AS "id" FROM "TelemetryException"`)
      ) {
        return database.taken ? [{ id: "another" }] : [];
      }

      return [];
    },
  };
}

function rekey(): Promise<ExceptionRekeyResult> {
  return TelemetryExceptionRekey.rekey({
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    from: FROM,
    to: TO,
  });
}

function writes(): Array<Statement> {
  return statements.filter((statement: Statement): boolean => {
    return (
      statement.sql.startsWith("UPDATE") || statement.sql.startsWith("INSERT")
    );
  });
}

beforeEach(() => {
  statements = [];
  database = {};

  jest
    .spyOn(TelemetryExceptionService, "executeTransaction")
    .mockImplementation(((run: (manager: unknown) => Promise<unknown>) => {
      return run(fakeManager());
    }) as never);
  jest
    .spyOn(TelemetryExceptionService, "forgetGroupFingerprints")
    .mockResolvedValue(undefined as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an exception found under an unkeyed fingerprint of hidden text", () => {
  test("keeps its row and takes the keyed fingerprint, and its old one is kept by a row merged into it", async () => {
    database.row = { id: EXCEPTION_ID, mergedIntoId: null, ...SEEN };

    expect(await rekey()).toEqual({
      fingerprint: TO,
      outcome: ExceptionRekeyOutcome.Moved,
    });

    // Locked by its project, resource and fingerprint, then the target checked.
    expect(statements[0]!.sql).toContain("FOR UPDATE");
    expect(statements[0]!.params).toEqual([PROJECT_ID, SERVICE_ID, FROM]);
    expect(statements[1]!.params).toEqual([PROJECT_ID, SERVICE_ID, TO]);

    const [update, insert] = writes() as [Statement, Statement];

    expect(update.sql).toContain(`SET "fingerprint" = $1`);
    expect(update.params).toEqual([TO, EXCEPTION_ID]);

    // The old fingerprint: counts nothing itself, seen when the exception was.
    expect(insert.sql).toContain(`INSERT INTO "TelemetryException"`);
    expect(insert.sql).toContain(`"formerFingerprintOfTelemetryExceptionId"`);
    expect(insert.params).toEqual([
      PROJECT_ID,
      SERVICE_ID,
      "OpenTelemetry",
      FROM,
      "InvalidSsnError",
      SEEN["firstSeenAt"],
      SEEN["lastSeenAt"],
      "1.0.0",
      "1.4.0",
      EXCEPTION_ID,
      EXCEPTION_ID,
    ]);
    expect(insert.sql).toMatch(/VALUES \(.*, 0, false, false, false, 0,/);

    // Its group changed: every process reads it again.
    expect(
      TelemetryExceptionService.forgetGroupFingerprints,
    ).toHaveBeenCalledWith([PROJECT_ID]);
  });

  test("one merged into another: its old fingerprint is merged into that one, as nothing is merged into a merged exception", async () => {
    database.row = { id: EXCEPTION_ID, mergedIntoId: SURVIVOR_ID, ...SEEN };

    await rekey();

    const insert: Statement = writes()[1]!;
    expect(insert.params[9]).toBe(SURVIVOR_ID);
    expect(insert.params[10]).toBe(EXCEPTION_ID);
  });

  test("moved already by another occurrence: the exception's fingerprint now, and nothing written", async () => {
    // The lock finds no exception under the old fingerprint any more...
    database.row = undefined;
    database.owner = TO;

    expect(await rekey()).toEqual({
      fingerprint: TO,
      outcome: ExceptionRekeyOutcome.AlreadyMoved,
    });
    expect(writes()).toEqual([]);

    // ...or finds the row that keeps it.
    statements = [];
    database.row = {
      id: "50000000-0000-4000-8000-000000010619",
      mergedIntoId: EXCEPTION_ID,
      formerFingerprintOfId: EXCEPTION_ID,
      ...SEEN,
    };

    expect((await rekey()).outcome).toBe(ExceptionRekeyOutcome.AlreadyMoved);
    expect(writes()).toEqual([]);
    expect(
      TelemetryExceptionService.forgetGroupFingerprints,
    ).not.toHaveBeenCalled();
  });

  test("gone: the old fingerprint, and nothing written", async () => {
    expect(await rekey()).toEqual({
      fingerprint: FROM,
      outcome: ExceptionRekeyOutcome.NotFound,
    });
    expect(writes()).toEqual([]);
  });

  test("the keyed fingerprint taken by another exception: left as it is, never merged", async () => {
    database.row = { id: EXCEPTION_ID, mergedIntoId: null, ...SEEN };
    database.taken = true;

    expect(await rekey()).toEqual({
      fingerprint: FROM,
      outcome: ExceptionRekeyOutcome.TargetTaken,
    });
    expect(writes()).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a failed move keeps the old fingerprint for now, and never throws", async () => {
    database.row = { id: EXCEPTION_ID, mergedIntoId: null, ...SEEN };
    database.fails = true;

    expect(await rekey()).toEqual({
      fingerprint: FROM,
      outcome: ExceptionRekeyOutcome.Failed,
    });
    expect(
      TelemetryExceptionService.forgetGroupFingerprints,
    ).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("nothing to move to, or no exception named: not tried", async () => {
    for (const move of [
      { from: FROM, to: FROM },
      { from: "", to: TO },
      { from: FROM, to: "" },
    ]) {
      expect(
        (
          await TelemetryExceptionRekey.rekey({
            projectId: PROJECT_ID,
            primaryEntityId: SERVICE_ID,
            ...move,
          })
        ).outcome,
      ).toBe(ExceptionRekeyOutcome.NotFound);
    }

    expect(statements).toEqual([]);
  });
});
