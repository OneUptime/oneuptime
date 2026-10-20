import RunbookApprovalsMove, {
  RUNBOOKS_WITH_OLD_APPROVALS_SQL,
  RunbookApprovalsMoveSummary,
  RunbookApprovalsQuery,
  UPDATE_RUNBOOK_APPROVAL_STEPS_SQL,
  readUpdatedCount,
} from "../../../../Server/Utils/Runbook/RunbookApprovalsMove";
import logger from "../../../../Server/Utils/Logger";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import {
  APPROVAL_AFTER_LAST_STEP_TITLE,
  stepRequiresApprovalBeforeRunning,
} from "../../../../Types/Runbook/RunbookStepApproval";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * EVERY STORED RUNBOOK ASKS FOR ITS APPROVALS BEFORE THE STEP THEY GUARD,
 * once (RunbookApprovalsMove, run by the Workers' data migration
 * MoveRunbookApprovalsBeforeTheirSteps).
 *
 * Here against a database answered in memory, the way Postgres answers the
 * two statements (the read and the compare-and-set write); the same move
 * against a real migrated Postgres is RunbookApprovalsMovePostgres. Pinned:
 * what is read, what is written and when nothing is, that the write is a
 * compare-and-set on the steps read, that a runbook saved meanwhile is left
 * as saved, that one runbook's failure costs no other its move, that a
 * failed read stops the run, and that a second run moves nothing.
 */

interface StoredRunbook {
  _id: string;
  steps: unknown;
  deletedAt?: Date | undefined;
  version: number;
}

const RUNBOOK_A: string = "20000000-0000-4000-8000-00000000000a";
const RUNBOOK_B: string = "20000000-0000-4000-8000-00000000000b";
const RUNBOOK_C: string = "20000000-0000-4000-8000-00000000000c";
const RUNBOOK_D: string = "20000000-0000-4000-8000-00000000000d";

function step(
  id: string,
  type: RunbookStepType,
  order: number,
  overrides: Partial<RunbookStep> = {},
): RunbookStep {
  return {
    id,
    order,
    type,
    title: `Step ${id}`,
    config: {} as RunbookStep["config"],
    ...overrides,
  };
}

/*
 * The Runbook table, as Postgres answers the move's two statements: the
 * read returns the live runbooks whose steps' text names the old flag, the
 * write lands only on a live runbook whose steps still equal the ones read,
 * and answers as TypeORM's Postgres driver answers an UPDATE: [rows, count].
 */
class Table {
  public rows: Array<StoredRunbook> = [];
  public calls: Array<{ sql: string; parameters: Array<unknown> }> = [];
  // Called before each write, so a test can change a row underneath it.
  public beforeWrite: ((id: string) => void) | null = null;
  public failWriteOf: string | null = null;

  public query: RunbookApprovalsQuery = async (
    sql: string,
    parameters: Array<unknown> = [],
  ): Promise<unknown> => {
    this.calls.push({ sql, parameters });

    if (sql === RUNBOOKS_WITH_OLD_APPROVALS_SQL) {
      return this.rows
        .filter((row: StoredRunbook) => {
          return (
            !row.deletedAt &&
            row.steps !== null &&
            JSON.stringify(row.steps).includes('"requireApproval"')
          );
        })
        .map((row: StoredRunbook) => {
          return { _id: row._id, steps: JSON.parse(JSON.stringify(row.steps)) };
        });
    }

    if (sql === UPDATE_RUNBOOK_APPROVAL_STEPS_SQL) {
      const [next, id, expected] = parameters as [string, string, string];

      this.beforeWrite?.(id);

      if (this.failWriteOf === id) {
        throw new Error("connection reset");
      }

      const row: StoredRunbook | undefined = this.rows.find(
        (candidate: StoredRunbook) => {
          return candidate._id === id && !candidate.deletedAt;
        },
      );

      if (!row || JSON.stringify(row.steps) !== expected) {
        return [[], 0];
      }

      row.steps = JSON.parse(next);
      row.version++;

      return [[{ _id: id }], 1];
    }

    throw new Error(`Unexpected statement: ${sql}`);
  };

  public stepsOf(id: string): Array<RunbookStep> {
    return this.rows.find((row: StoredRunbook) => {
      return row._id === id;
    })!.steps as Array<RunbookStep>;
  }

  public writes(): Array<{ sql: string; parameters: Array<unknown> }> {
    return this.calls.filter((call: { sql: string }) => {
      return call.sql === UPDATE_RUNBOOK_APPROVAL_STEPS_SQL;
    });
  }
}

describe("moving every stored runbook's approvals before their steps", () => {
  let table: Table;

  beforeEach(() => {
    table = new Table();
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads only the live runbooks whose steps name the old flag, by their text first", () => {
    expect(RUNBOOKS_WITH_OLD_APPROVALS_SQL).toBe(
      `SELECT "_id", "steps" FROM "Runbook" WHERE "deletedAt" IS NULL AND "steps" IS NOT NULL AND "steps"::text LIKE '%"requireApproval"%' ORDER BY "_id"`,
    );
  });

  test("writes the moved steps only over the steps it read, and bumps the version", () => {
    expect(UPDATE_RUNBOOK_APPROVAL_STEPS_SQL).toBe(
      `UPDATE "Runbook" SET "steps" = $1::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $2 AND "deletedAt" IS NULL AND "steps" = $3::jsonb RETURNING "_id"`,
    );
  });

  test("an approval after step N becomes one before step N+1; after the last step, a Manual step at the end", async () => {
    table.rows.push(
      {
        _id: RUNBOOK_A,
        version: 3,
        steps: [
          step("a1", RunbookStepType.Bash, 0, { requireApproval: true }),
          step("a2", RunbookStepType.Kubernetes, 1),
          step("a3", RunbookStepType.HttpRequest, 2, {
            requireApproval: false,
          }),
        ],
      },
      {
        _id: RUNBOOK_B,
        version: 1,
        steps: [
          step("b1", RunbookStepType.Bash, 0),
          step("b2", RunbookStepType.AI, 1, { requireApproval: true }),
        ],
      },
    );

    const summary: RunbookApprovalsMoveSummary =
      await RunbookApprovalsMove.moveAll(table.query);

    expect(summary).toEqual({
      runbooksMoved: 2,
      approvalsMoved: 2,
      approvalStepsAdded: 1,
      runbooksChangedMeanwhile: 0,
      runbooksFailed: 0,
    });

    const a: Array<RunbookStep> = table.stepsOf(RUNBOOK_A);
    expect(
      a.map((each: RunbookStep) => {
        return [each.id, stepRequiresApprovalBeforeRunning(each)];
      }),
    ).toEqual([
      ["a1", false],
      ["a2", true],
      ["a3", false],
    ]);
    // The old flag is gone from every step of a runbook it moved, false ones too.
    expect(JSON.stringify(a)).not.toContain('"requireApproval"');

    const b: Array<RunbookStep> = table.stepsOf(RUNBOOK_B);
    expect(b).toHaveLength(3);
    expect(b[2]).toMatchObject({
      id: "b2-approval",
      type: RunbookStepType.Manual,
      title: APPROVAL_AFTER_LAST_STEP_TITLE,
      order: 2,
    });

    expect(
      table.rows.map((row: StoredRunbook) => {
        return row.version;
      }),
    ).toEqual([4, 2]);
  });

  test("the write is a compare-and-set on exactly the steps that were read", async () => {
    const steps: Array<RunbookStep> = [
      step("a1", RunbookStepType.Bash, 0, { requireApproval: true }),
      step("a2", RunbookStepType.Bash, 1),
    ];
    table.rows.push({ _id: RUNBOOK_A, version: 1, steps });

    await RunbookApprovalsMove.moveAll(table.query);

    const [write] = table.writes();
    expect(write!.parameters[1]).toBe(RUNBOOK_A);
    expect(JSON.parse(write!.parameters[2] as string)).toEqual(steps);
    expect(JSON.parse(write!.parameters[0] as string)[1]).toMatchObject({
      id: "a2",
      requireApprovalBeforeRunning: true,
    });
  });

  test("a runbook with nothing to move is read but never written: old flags all false, or only on Manual steps", async () => {
    table.rows.push(
      {
        _id: RUNBOOK_A,
        version: 1,
        steps: [
          step("a1", RunbookStepType.Bash, 0, { requireApproval: false }),
          step("a2", RunbookStepType.Bash, 1, { requireApproval: false }),
        ],
      },
      {
        _id: RUNBOOK_B,
        version: 1,
        steps: [
          step("b1", RunbookStepType.Manual, 0, { requireApproval: true }),
          step("b2", RunbookStepType.Bash, 1),
        ],
      },
      {
        _id: RUNBOOK_C,
        version: 1,
        steps: [
          step("c1", RunbookStepType.Bash, 0, {
            requireApprovalBeforeRunning: true,
          }),
        ],
      },
    );
    const before: string = JSON.stringify(table.rows);

    const summary: RunbookApprovalsMoveSummary =
      await RunbookApprovalsMove.moveAll(table.query);

    expect(summary.runbooksMoved).toBe(0);
    expect(table.writes()).toEqual([]);
    expect(JSON.stringify(table.rows)).toBe(before);
  });

  test("a deleted runbook is not read, so not moved", async () => {
    table.rows.push({
      _id: RUNBOOK_A,
      version: 1,
      deletedAt: new Date(),
      steps: [
        step("a1", RunbookStepType.Bash, 0, { requireApproval: true }),
        step("a2", RunbookStepType.Bash, 1),
      ],
    });

    await RunbookApprovalsMove.moveAll(table.query);

    expect(table.writes()).toEqual([]);
    expect(table.stepsOf(RUNBOOK_A)[0]!.requireApproval).toBe(true);
  });

  test("steps the driver hands over as JSON text are read too; text that is not steps is left alone", async () => {
    table.rows.push({
      _id: RUNBOOK_A,
      version: 1,
      steps: [],
    });

    const query: RunbookApprovalsQuery = async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      if (sql === RUNBOOKS_WITH_OLD_APPROVALS_SQL) {
        return [
          {
            _id: RUNBOOK_A,
            steps: JSON.stringify([
              step("a1", RunbookStepType.Bash, 0, { requireApproval: true }),
              step("a2", RunbookStepType.Bash, 1),
            ]),
          },
          { _id: RUNBOOK_B, steps: '{"requireApproval": true' },
          { _id: RUNBOOK_C, steps: '{"requireApproval": true}' },
        ];
      }

      table.calls.push({ sql, parameters: parameters || [] });
      return [[{ _id: RUNBOOK_A }], 1];
    };

    const summary: RunbookApprovalsMoveSummary =
      await RunbookApprovalsMove.moveAll(query);

    expect(summary.runbooksMoved).toBe(1);
    expect(summary.runbooksFailed).toBe(0);
    expect(table.writes()).toHaveLength(1);
    expect(table.writes()[0]!.parameters[1]).toBe(RUNBOOK_A);
  });

  test("a runbook saved between the read and the write is left as that save wrote it", async () => {
    table.rows.push({
      _id: RUNBOOK_A,
      version: 5,
      steps: [
        step("a1", RunbookStepType.Bash, 0, { requireApproval: true }),
        step("a2", RunbookStepType.Bash, 1),
      ],
    });

    const saved: Array<RunbookStep> = [
      step("a1", RunbookStepType.Bash, 0),
      step("a2", RunbookStepType.Bash, 1, {
        requireApprovalBeforeRunning: false,
      }),
    ];

    table.beforeWrite = (id: string): void => {
      const row: StoredRunbook = table.rows.find((candidate: StoredRunbook) => {
        return candidate._id === id;
      })!;
      row.steps = saved;
      row.version = 6;
    };

    const summary: RunbookApprovalsMoveSummary =
      await RunbookApprovalsMove.moveAll(table.query);

    expect(summary).toMatchObject({
      runbooksMoved: 0,
      runbooksChangedMeanwhile: 1,
    });
    expect(table.stepsOf(RUNBOOK_A)).toEqual(saved);
    expect(table.rows[0]!.version).toBe(6);
  });

  test("one runbook that cannot be written costs no other its move", async () => {
    for (const id of [RUNBOOK_A, RUNBOOK_B, RUNBOOK_C]) {
      table.rows.push({
        _id: id,
        version: 1,
        steps: [
          step(`${id}-1`, RunbookStepType.Bash, 0, { requireApproval: true }),
          step(`${id}-2`, RunbookStepType.Bash, 1),
        ],
      });
    }
    table.failWriteOf = RUNBOOK_B;

    const summary: RunbookApprovalsMoveSummary =
      await RunbookApprovalsMove.moveAll(table.query);

    expect(summary).toMatchObject({ runbooksMoved: 2, runbooksFailed: 1 });
    expect(table.stepsOf(RUNBOOK_A)[1]!.requireApprovalBeforeRunning).toBe(
      true,
    );
    expect(table.stepsOf(RUNBOOK_B)[0]!.requireApproval).toBe(true);
    expect(table.stepsOf(RUNBOOK_C)[1]!.requireApprovalBeforeRunning).toBe(
      true,
    );
    expect(logger.error).toHaveBeenCalled();
  });

  test("a failed read is not swallowed: nothing was moved, so the migration runs again", async () => {
    const query: RunbookApprovalsQuery = async (): Promise<unknown> => {
      throw new Error("relation is locked");
    };

    await expect(RunbookApprovalsMove.moveAll(query)).rejects.toThrow(
      "relation is locked",
    );
  });

  test("a second run moves nothing, and writes nothing", async () => {
    table.rows.push(
      {
        _id: RUNBOOK_A,
        version: 1,
        steps: [
          step("a1", RunbookStepType.Bash, 0, { requireApproval: true }),
          step("a2", RunbookStepType.Manual, 1),
          step("a3", RunbookStepType.Bash, 2, { requireApproval: true }),
        ],
      },
      {
        _id: RUNBOOK_D,
        version: 1,
        steps: [
          step("d1", RunbookStepType.Bash, 0, { requireApproval: true }),
          step("d2", RunbookStepType.Bash, 1),
        ],
      },
    );

    await RunbookApprovalsMove.moveAll(table.query);
    const afterFirst: string = JSON.stringify(table.rows);
    const writesAfterFirst: number = table.writes().length;

    const second: RunbookApprovalsMoveSummary =
      await RunbookApprovalsMove.moveAll(table.query);

    expect(writesAfterFirst).toBe(2);
    expect(second).toEqual({
      runbooksMoved: 0,
      approvalsMoved: 0,
      approvalStepsAdded: 0,
      runbooksChangedMeanwhile: 0,
      runbooksFailed: 0,
    });
    expect(table.writes()).toHaveLength(2);
    expect(JSON.stringify(table.rows)).toBe(afterFirst);
  });

  test("no runbook at all: nothing to do", async () => {
    await expect(RunbookApprovalsMove.moveAll(table.query)).resolves.toEqual({
      runbooksMoved: 0,
      approvalsMoved: 0,
      approvalStepsAdded: 0,
      runbooksChangedMeanwhile: 0,
      runbooksFailed: 0,
    });
  });
});

describe("how many rows an UPDATE wrote", () => {
  test("as TypeORM's Postgres driver answers: [rows, count]", () => {
    expect(readUpdatedCount([[{ _id: RUNBOOK_A }], 1])).toBe(1);
    expect(readUpdatedCount([[], 0])).toBe(0);
  });

  test("as a plain driver answers: the rows RETURNING gave back", () => {
    expect(readUpdatedCount([{ _id: RUNBOOK_A }])).toBe(1);
    expect(readUpdatedCount([{ _id: RUNBOOK_A }, { _id: RUNBOOK_B }])).toBe(
      2,
    );
    expect(readUpdatedCount([])).toBe(0);
  });

  test("anything else wrote nothing", () => {
    expect(readUpdatedCount(undefined)).toBe(0);
    expect(readUpdatedCount(null)).toBe(0);
    expect(readUpdatedCount({ rowCount: 1 })).toBe(0);
  });
});
