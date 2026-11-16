import AlertLabelRule from "../../../../Models/DatabaseModels/AlertLabelRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WhatsAppLog from "../../../../Models/DatabaseModels/WhatsAppLog";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import TablePurgeWalk, {
  TablePurgeOfTable,
  TablePurgeSummary,
  getPurgedTableName,
  readPurgedCount,
} from "../../../../Server/Utils/Retention/TablePurgeWalk";
import { describe, expect, test } from "@jest/globals";

/*
 * THE WALK THE DAILY PURGES SHARE (Server/Utils/Retention/TablePurgeWalk):
 * the soft-delete purge (#6528) and the purge by age (#8894) hand it their
 * tables and how one batch goes. Pinned here on its own, over batches that
 * are plain functions: a table goes a batch at a time until a batch removes
 * nothing; a run drains for its budget, then gives each table left one
 * batch; the deadline stops it before its next table; a table that fails is
 * handed back and the rest go on. SoftDeletedRowsPurge.test and
 * OlderRowsPurge.test pin the same through each purge.
 */

const MINUTE_MS: number = 60 * 1000;

function service(model: unknown = AlertLabelRule): DatabaseService<BaseModel> {
  return new DatabaseService<BaseModel>(model as { new (): BaseModel });
}

/*
 * A backlog that never ends, as far as any run goes: a full batch each call,
 * then nothing after 1000 calls - so a walk that never stops draining fails
 * its test instead of hanging it. Says how many calls it answered.
 */
function endlessBacklog(): {
  purgeBatch: () => Promise<number>;
  calls: () => number;
} {
  let calls: number = 0;

  return {
    purgeBatch: async (): Promise<number> => {
      calls += 1;
      return calls > 1000 ? 0 : 1000;
    },
    calls: (): number => {
      return calls;
    },
  };
}

// A clock that moves only when a batch says so.
function clockAt(start: number): {
  now: () => Date;
  advance: (ms: number) => void;
} {
  let time: number = start;

  return {
    now: (): Date => {
      return new Date(time);
    },
    advance: (ms: number): void => {
      time += ms;
    },
  };
}

describe("readPurgedCount", () => {
  test.each([
    [7, 7],
    [2.9, 2],
    ["12", 12],
    [0, 0],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [undefined, 0],
    [null, 0],
    [{}, 0],
  ])("reads %p as %p", (value: unknown, count: number) => {
    expect(readPurgedCount(value)).toBe(count);
  });
});

describe("getPurgedTableName", () => {
  test("the model's table", () => {
    expect(getPurgedTableName(service(WhatsAppLog))).toBe("WhatsAppLog");
  });

  test("the model's name when the model names no table, and a placeholder when there is none", () => {
    const unnamed: DatabaseService<BaseModel> = service();
    unnamed.getModel = (): BaseModel => {
      return { tableName: "" } as unknown as BaseModel;
    };

    expect(getPurgedTableName(unnamed)).toBe("AlertLabelRule");

    unnamed.modelType = undefined as unknown as { new (): BaseModel };

    expect(getPurgedTableName(unnamed)).toBe("unknown table");
  });
});

describe("one table", () => {
  test("goes a batch at a time until a batch removes nothing, however short a batch is", async () => {
    const answers: Array<unknown> = [1000, 3, "2", 0, 1000];

    const result: TablePurgeOfTable = await TablePurgeWalk.purgeTable({
      purgeBatch: async (): Promise<number> => {
        return answers.shift() as number;
      },
      isOutOfTime: (): boolean => {
        return false;
      },
    });

    expect(result).toEqual({ purged: 1005, isCutShort: false });
    // The batch after the empty one is never asked for.
    expect(answers).toEqual([1000]);
  });

  test("gets one batch however late it starts, and is cut short only if that batch removed something", async () => {
    const backlog: ReturnType<typeof endlessBacklog> = endlessBacklog();

    expect(
      await TablePurgeWalk.purgeTable({
        purgeBatch: backlog.purgeBatch,
        isOutOfTime: (): boolean => {
          return true;
        },
      }),
    ).toEqual({ purged: 1000, isCutShort: true });
    expect(backlog.calls()).toBe(1);

    expect(
      await TablePurgeWalk.purgeTable({
        purgeBatch: async (): Promise<number> => {
          return 0;
        },
        isOutOfTime: (): boolean => {
          return true;
        },
      }),
    ).toEqual({ purged: 0, isCutShort: false });
  });

  test("a backlog drains until the run is out of time: the batch that finds it so is the last", async () => {
    const backlog: ReturnType<typeof endlessBacklog> = endlessBacklog();
    let checks: number = 0;

    expect(
      await TablePurgeWalk.purgeTable({
        purgeBatch: backlog.purgeBatch,
        isOutOfTime: (): boolean => {
          checks += 1;
          return checks >= 4;
        },
      }),
    ).toEqual({ purged: 4000, isCutShort: true });
    expect(backlog.calls()).toBe(4);
  });

  test("throws a batch that fails", async () => {
    await expect(
      TablePurgeWalk.purgeTable({
        purgeBatch: async (): Promise<number> => {
          throw new Error("deadlock detected");
        },
        isOutOfTime: (): boolean => {
          return false;
        },
      }),
    ).rejects.toThrow("deadlock detected");
  });
});

describe("a run", () => {
  test("takes the tables in order, and adds up what went from which", async () => {
    const order: Array<string> = [];
    const first: DatabaseService<BaseModel> = service(AlertLabelRule);
    const second: DatabaseService<BaseModel> = service(WhatsAppLog);
    const clock: ReturnType<typeof clockAt> = clockAt(0);

    const summary: TablePurgeSummary = await TablePurgeWalk.run({
      services: [first, second],
      purgeTable: async (
        table: DatabaseService<BaseModel>,
      ): Promise<TablePurgeOfTable> => {
        order.push(getPurgedTableName(table));
        return { purged: table === first ? 4 : 0, isCutShort: false };
      },
      onTableFailed: (): void => {
        throw new Error("no table fails here");
      },
      now: clock.now,
      timeBudgetMs: MINUTE_MS,
    });

    expect(order).toEqual(["AlertLabelRule", "WhatsAppLog"]);
    expect(summary).toEqual({
      tables: 2,
      purged: 4,
      purgedTables: [{ table: "AlertLabelRule", purged: 4 }],
      failedTables: 0,
      isCutShort: false,
    });
  });

  test("hands each table a check that says when the budget, counted from the run's start, is spent", async () => {
    const clock: ReturnType<typeof clockAt> = clockAt(1_000_000);
    const checks: Array<boolean> = [];

    await TablePurgeWalk.run({
      services: [service()],
      purgeTable: async (
        _table: DatabaseService<BaseModel>,
        isOutOfTime: () => boolean,
      ): Promise<TablePurgeOfTable> => {
        checks.push(isOutOfTime());
        clock.advance(5 * MINUTE_MS - 1);
        checks.push(isOutOfTime());
        clock.advance(1);
        checks.push(isOutOfTime());
        return { purged: 0, isCutShort: false };
      },
      onTableFailed: (): void => {
        return undefined;
      },
      now: clock.now,
      timeBudgetMs: 5 * MINUTE_MS,
    });

    expect(checks).toEqual([false, false, true]);
  });

  test("drains for its budget, then gives each table left one batch", async () => {
    const clock: ReturnType<typeof clockAt> = clockAt(0);
    const backlogs: Array<ReturnType<typeof endlessBacklog>> = [
      endlessBacklog(),
      endlessBacklog(),
      endlessBacklog(),
    ];
    const tables: Array<DatabaseService<BaseModel>> = [
      service(),
      service(WhatsAppLog),
      service(),
    ];

    const summary: TablePurgeSummary = await TablePurgeWalk.run({
      services: tables,
      purgeTable: (
        table: DatabaseService<BaseModel>,
        isOutOfTime: () => boolean,
      ): Promise<TablePurgeOfTable> => {
        const backlog: ReturnType<typeof endlessBacklog> =
          backlogs[tables.indexOf(table)]!;

        return TablePurgeWalk.purgeTable({
          // Each batch takes a minute.
          purgeBatch: async (): Promise<number> => {
            clock.advance(MINUTE_MS);
            return await backlog.purgeBatch();
          },
          isOutOfTime,
        });
      },
      onTableFailed: (): void => {
        return undefined;
      },
      now: clock.now,
      timeBudgetMs: 5 * MINUTE_MS,
    });

    expect(
      backlogs.map((backlog: ReturnType<typeof endlessBacklog>): number => {
        return backlog.calls();
      }),
    ).toEqual([5, 1, 1]);
    expect(summary.purged).toBe(7000);
    expect(summary.isCutShort).toBe(true);
  });

  test("a table cut short says the run was", async () => {
    const summary: TablePurgeSummary = await TablePurgeWalk.run({
      services: [service(), service(WhatsAppLog)],
      purgeTable: async (
        table: DatabaseService<BaseModel>,
      ): Promise<TablePurgeOfTable> => {
        return {
          purged: 1000,
          isCutShort: getPurgedTableName(table) === "AlertLabelRule",
        };
      },
      onTableFailed: (): void => {
        return undefined;
      },
      now: clockAt(0).now,
      timeBudgetMs: MINUTE_MS,
    });

    expect(summary.isCutShort).toBe(true);
    expect(summary.tables).toBe(2);
  });

  test("the deadline stops it before its next table, and the tables left are not started", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const started: Array<string> = [];

    const summary: TablePurgeSummary = await TablePurgeWalk.run({
      services: [service(), service(WhatsAppLog), service()],
      purgeTable: async (
        table: DatabaseService<BaseModel>,
        isOutOfTime: () => boolean,
      ): Promise<TablePurgeOfTable> => {
        started.push(getPurgedTableName(table));
        deadline.end(new Error("The run lost its lock."));
        // The table's own check sees the deadline too.
        expect(isOutOfTime()).toBe(true);
        return { purged: 10, isCutShort: true };
      },
      onTableFailed: (): void => {
        return undefined;
      },
      now: clockAt(0).now,
      deadline,
      timeBudgetMs: 60 * MINUTE_MS,
    });

    expect(started).toEqual(["AlertLabelRule"]);
    expect(summary).toEqual({
      tables: 1,
      purged: 10,
      purgedTables: [{ table: "AlertLabelRule", purged: 10 }],
      failedTables: 0,
      isCutShort: true,
    });
  });

  test("a table that fails is handed back with its error, counted, and the rest go on", async () => {
    const failing: DatabaseService<BaseModel> = service();
    const healthy: DatabaseService<BaseModel> = service(WhatsAppLog);
    const failures: Array<[DatabaseService<BaseModel>, unknown]> = [];

    const summary: TablePurgeSummary = await TablePurgeWalk.run({
      services: [failing, healthy],
      purgeTable: async (
        table: DatabaseService<BaseModel>,
      ): Promise<TablePurgeOfTable> => {
        if (table === failing) {
          throw new Error("connection reset");
        }

        return { purged: 6, isCutShort: false };
      },
      onTableFailed: (table: DatabaseService<BaseModel>, error: unknown) => {
        failures.push([table, error]);
      },
      now: clockAt(0).now,
      timeBudgetMs: MINUTE_MS,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]![0]).toBe(failing);
    expect((failures[0]![1] as Error).message).toBe("connection reset");
    expect(summary).toEqual({
      tables: 2,
      purged: 6,
      purgedTables: [{ table: "WhatsAppLog", purged: 6 }],
      failedTables: 1,
      isCutShort: false,
    });
  });

  test("with no table, does nothing and is not cut short, even past its deadline", async () => {
    const deadline: JobDeadline = new JobDeadline();
    deadline.end(new Error("The job ran out of time."));

    expect(
      await TablePurgeWalk.run({
        services: [],
        purgeTable: async (): Promise<TablePurgeOfTable> => {
          throw new Error("never called");
        },
        onTableFailed: (): void => {
          return undefined;
        },
        now: clockAt(0).now,
        deadline,
        timeBudgetMs: MINUTE_MS,
      }),
    ).toEqual({
      tables: 0,
      purged: 0,
      purgedTables: [],
      failedTables: 0,
      isCutShort: false,
    });
  });
});
