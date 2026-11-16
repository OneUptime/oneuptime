import AlertLabelRule from "../../../../Models/DatabaseModels/AlertLabelRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WhatsAppLog from "../../../../Models/DatabaseModels/WhatsAppLog";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import Services from "../../../../Server/Services/Index";
import UserSessionService from "../../../../Server/Services/UserSessionService";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import OlderRowsPurge, {
  OLDER_ROWS_PURGE_BATCH_SIZE,
  OLDER_ROWS_PURGE_TIME_BUDGET_MS,
  OlderRowsPurgeOfTable,
  OlderRowsPurgeSummary,
} from "../../../../Server/Utils/Retention/OlderRowsPurge";
import { SOFT_DELETED_ROWS_PURGE_BATCH_SIZE } from "../../../../Server/Utils/Retention/SoftDeletedRowsPurge";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * DELETING THE ROWS OLDER THAN THEIR TABLE KEEPS THEM (issue #8894):
 * Server/Utils/Retention/OlderRowsPurge, which the daily Workers job
 * HardDelete:HardDeleteOlderItemsInDatabase runs.
 *
 * It used to delete 10,000 rows a statement (LIMIT_MAX) until a statement
 * deleted nothing, with no time budget: on a big table one DELETE and its
 * cascades held locks for long, and a backlog could outlive the job's time
 * limit, so the tables after it were never reached.
 *
 * Here, without a database, over services whose hardDeleteBy is a stand-in:
 * which services have rows to delete by age (a column and a window of more
 * than 0 days, nothing else), what a batch asks hardDeleteBy for (the rows
 * whose column is older than the service's own window, 1000 of them, as
 * OneUptime), and how a run walks the tables: each until a batch removes
 * nothing, within its time budget, every table left still getting one
 * batch, stopped by the job's deadline, one table's failure logged while the
 * rest go on. The job's own suite (App Tests/Workers/Jobs/HardDelete) pins
 * the wiring; OlderRowsPurgePostgres the statements on Postgres.
 */

type HardDeleteBy = (deleteBy: DeleteBy<BaseModel>) => Promise<number>;

type FakeService = DatabaseService<BaseModel> & {
  hardDeleteBy: Mock<HardDeleteBy>;
};

const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;
const START: Date = new Date("2026-11-16T03:00:00.000Z");

// Calls a fake's "endless" backlog answers, far more than any run makes.
const MAX_ENDLESS_CALLS: number = 1000;

let clock: Date = START;
const realNow: () => Date = OlderRowsPurge.now;
let errorLog: SpyInstance<typeof logger.error>;

function fakeService(options: {
  model?: { new (): BaseModel };
  // The column and the window the service declares; none when left out.
  column?: string;
  days?: number;
  // What each call answers, in order; 0 once they run out.
  answers?: Array<unknown>;
  // Every call answers a full batch.
  isEndless?: boolean;
  // How far the clock moves during each call.
  minutesPerCall?: number;
  // Called during each call, with its number (1-based).
  onCall?: (call: number) => void;
  // The call (1-based) that throws.
  throwsOnCall?: number;
}): FakeService {
  const service: FakeService = new DatabaseService<BaseModel>(
    (options.model || AlertLabelRule) as { new (): BaseModel },
  ) as FakeService;

  if (options.column !== undefined && options.days !== undefined) {
    service.hardDeleteItemsOlderThanInDays(options.column, options.days);
  }

  const answers: Array<unknown> = [...(options.answers || [0])];
  let calls: number = 0;

  service.hardDeleteBy = jest.fn<HardDeleteBy>(
    async (_deleteBy: DeleteBy<BaseModel>): Promise<number> => {
      calls += 1;

      if (options.minutesPerCall) {
        clock = new Date(clock.getTime() + options.minutesPerCall * MINUTE_MS);
      }

      options.onCall?.(calls);

      if (options.throwsOnCall === calls) {
        throw new Error("connection reset");
      }

      // Runs out after MAX_ENDLESS_CALLS: a purge that never stops fails, not hangs.
      if (options.isEndless) {
        return calls > MAX_ENDLESS_CALLS ? 0 : OLDER_ROWS_PURGE_BATCH_SIZE;
      }

      return (answers.length > 0 ? answers.shift() : 0) as number;
    },
  );

  return service;
}

// A service with a window, as most declare it: createdAt, 3 days.
function windowed(
  options: Omit<Parameters<typeof fakeService>[0], "column" | "days"> = {},
): FakeService {
  return fakeService({ column: "createdAt", days: 3, ...options });
}

function requestOf(
  service: FakeService,
  index: number = 0,
): DeleteBy<BaseModel> {
  return service.hardDeleteBy.mock.calls[index]![0];
}

function operatorOf(
  request: DeleteBy<BaseModel>,
  column: string,
): FindOperator<unknown> {
  return (request.query as Record<string, unknown>)[
    column
  ] as FindOperator<unknown>;
}

function cutoffOf(request: DeleteBy<BaseModel>, column: string): Date {
  return Object.values(
    operatorOf(request, column).objectLiteralParameters as Record<string, Date>,
  )[0] as Date;
}

const neverOutOfTime: () => boolean = (): boolean => {
  return false;
};

beforeEach(() => {
  clock = START;
  OlderRowsPurge.now = (): Date => {
    return clock;
  };
  errorLog = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  OlderRowsPurge.now = realNow;
  jest.restoreAllMocks();
});

describe("how much goes at a time", () => {
  test("a statement deletes 1000 rows at most, a tenth of what it used to (LIMIT_MAX)", () => {
    expect(OLDER_ROWS_PURGE_BATCH_SIZE).toBe(1000);
    expect(OLDER_ROWS_PURGE_BATCH_SIZE).toBeLessThan(LIMIT_MAX);
    expect(LIMIT_MAX / OLDER_ROWS_PURGE_BATCH_SIZE).toBe(10);
  });

  test("as many as the purge of soft-deleted rows deletes a statement", () => {
    expect(OLDER_ROWS_PURGE_BATCH_SIZE).toBe(
      SOFT_DELETED_ROWS_PURGE_BATCH_SIZE,
    );
  });

  test("a run drains backlogs for 20 minutes at most", () => {
    expect(OLDER_ROWS_PURGE_TIME_BUDGET_MS).toBe(20 * MINUTE_MS);
  });

  test.each([
    ["createdAt", 3],
    ["createdAt", 3 * 365],
    ["refreshTokenExpiresAt", 30],
    ["startsAt", 2],
  ])(
    "the cut-off of a table kept by %s for %p days is that many days before the clock",
    (column: string, days: number) => {
      expect(
        OlderRowsPurge.getCutoff(fakeService({ column: column, days: days })),
      ).toEqual(new Date(START.getTime() - days * DAY_MS));
    },
  );
});

describe("which services have rows to delete by age", () => {
  test("one that names a column and a window of more than 0 days", () => {
    expect(OlderRowsPurge.isPurged(windowed())).toBe(true);
    expect(
      OlderRowsPurge.isPurged(
        fakeService({ column: "refreshTokenExpiresAt", days: 30 }),
      ),
    ).toBe(true);
    expect(
      OlderRowsPurge.isPurged(fakeService({ column: "createdAt", days: 0.5 })),
    ).toBe(true);
  });

  test("one that declares no window", () => {
    expect(OlderRowsPurge.isPurged(fakeService({}))).toBe(false);
  });

  test("one with a column but no window, or a window but no column", () => {
    const columnOnly: FakeService = fakeService({});
    columnOnly.hardDeleteItemByColumnName = "createdAt";

    const windowOnly: FakeService = fakeService({});
    windowOnly.hardDeleteItemsOlderThanDays = 3;

    expect(OlderRowsPurge.isPurged(columnOnly)).toBe(false);
    expect(OlderRowsPurge.isPurged(windowOnly)).toBe(false);
  });

  /*
   * A window that is not a positive number of days would put the cut-off at
   * or after now, and take every row of the table.
   */
  test.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY, "3", null])(
    "never one whose window is %p",
    (days: unknown) => {
      const service: FakeService = fakeService({});
      service.hardDeleteItemByColumnName = "createdAt";
      service.hardDeleteItemsOlderThanDays = days as number;

      expect(OlderRowsPurge.isPurged(service)).toBe(false);
    },
  );

  test("nothing that is not a database service", () => {
    for (const entry of [
      undefined,
      null,
      {},
      {
        hardDeleteItemByColumnName: "createdAt",
        hardDeleteItemsOlderThanDays: 3,
        hardDeleteBy: jest.fn(),
      },
    ]) {
      expect(OlderRowsPurge.isPurged(entry)).toBe(false);
    }
  });

  test("the sessions keep their window on every install: 30 days after the refresh token expired", () => {
    expect(OlderRowsPurge.isPurged(UserSessionService)).toBe(true);
    expect(UserSessionService.hardDeleteItemByColumnName).toBe(
      "refreshTokenExpiresAt",
    );
    expect(UserSessionService.hardDeleteItemsOlderThanDays).toBe(30);
  });

  /*
   * The registry the job walks: every database service with a window, as
   * the services declare them, and nothing else. The windows are the
   * services' own; this only reads them.
   */
  test("of every service the job walks, those with a window, and only those", () => {
    const purged: Array<unknown> = Services.filter((service: unknown) => {
      return OlderRowsPurge.isPurged(service);
    });

    expect(purged.length).toBeGreaterThan(5);
    expect(purged).toContain(UserSessionService);
    expect(purged).toEqual(
      Services.filter((service: unknown) => {
        return (
          service instanceof DatabaseService &&
          Boolean(service.hardDeleteItemByColumnName) &&
          service.hardDeleteItemsOlderThanDays > 0
        );
      }),
    );
  });
});

describe("one batch", () => {
  test("asks for the rows whose column is older than the service's window, as OneUptime, 1000 at most, from the first", async () => {
    const service: FakeService = fakeService({
      column: "refreshTokenExpiresAt",
      days: 30,
      answers: [7],
    });

    expect(await OlderRowsPurge.purgeBatch(service)).toBe(7);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(1);

    const request: DeleteBy<BaseModel> = requestOf(service);

    expect(Object.keys(request.query)).toEqual(["refreshTokenExpiresAt"]);
    expect(
      operatorOf(request, "refreshTokenExpiresAt").getSql!("expires"),
    ).toMatch(/^\(expires < :\w+\)$/);
    expect(cutoffOf(request, "refreshTokenExpiresAt")).toEqual(
      new Date(START.getTime() - 30 * DAY_MS),
    );
    expect(request.props).toEqual({ isRoot: true });
    expect(request.limit).toBe(1000);
    expect(request.skip).toBe(0);
  });

  test("each service is cut off by its own window", async () => {
    const shortLived: FakeService = windowed({ answers: [1] });
    const longLived: FakeService = fakeService({
      column: "createdAt",
      days: 3 * 365,
      answers: [1],
    });

    await OlderRowsPurge.purgeBatch(shortLived);
    await OlderRowsPurge.purgeBatch(longLived);

    expect(cutoffOf(requestOf(shortLived), "createdAt")).toEqual(
      new Date(START.getTime() - 3 * DAY_MS),
    );
    expect(cutoffOf(requestOf(longLived), "createdAt")).toEqual(
      new Date(START.getTime() - 3 * 365 * DAY_MS),
    );
  });

  test("hands every batch a request of its own, cut off from the clock as it starts", async () => {
    const service: FakeService = windowed({ answers: [1, 1] });

    await OlderRowsPurge.purgeBatch(service);
    clock = new Date(START.getTime() + 5 * MINUTE_MS);
    await OlderRowsPurge.purgeBatch(service);

    expect(requestOf(service, 0)).not.toBe(requestOf(service, 1));
    expect(requestOf(service, 0).query).not.toBe(requestOf(service, 1).query);
    expect(cutoffOf(requestOf(service, 1), "createdAt")).toEqual(
      new Date(START.getTime() + 5 * MINUTE_MS - 3 * DAY_MS),
    );
  });

  test.each([
    [undefined, 0],
    [null, 0],
    [Number.NaN, 0],
    [-3, 0],
    [2.7, 2],
    ["12", 12],
  ])(
    "reads what hardDeleteBy answers (%p) as a count (%p)",
    async (answer: unknown, count: number) => {
      const service: FakeService = windowed({ answers: [answer] });

      expect(await OlderRowsPurge.purgeBatch(service)).toBe(count);
    },
  );
});

describe("one table", () => {
  test("goes a batch at a time until a batch removes nothing", async () => {
    const service: FakeService = windowed({
      answers: [1000, 1000, 400, 0],
    });

    const result: OlderRowsPurgeOfTable = await OlderRowsPurge.purgeTable({
      service: service,
      isOutOfTime: neverOutOfTime,
    });

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ purged: 2400, isCutShort: false });
  });

  // A state timeline keeps its current rows from a delete by query: a batch can come up short.
  test("a batch smaller than the batch size does not end it", async () => {
    const service: FakeService = windowed({ answers: [2, 1, 1, 0] });

    const result: OlderRowsPurgeOfTable = await OlderRowsPurge.purgeTable({
      service: service,
      isOutOfTime: neverOutOfTime,
    });

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ purged: 4, isCutShort: false });
  });

  test("one with nothing due costs one batch", async () => {
    const service: FakeService = windowed({});

    expect(
      await OlderRowsPurge.purgeTable({
        service: service,
        isOutOfTime: neverOutOfTime,
      }),
    ).toEqual({ purged: 0, isCutShort: false });
    expect(service.hardDeleteBy).toHaveBeenCalledTimes(1);
  });

  test("stops after the batch that finds the run out of time, and says rows may be left", async () => {
    const service: FakeService = windowed({ isEndless: true });
    let checks: number = 0;

    const result: OlderRowsPurgeOfTable = await OlderRowsPurge.purgeTable({
      service: service,
      isOutOfTime: (): boolean => {
        checks += 1;
        return checks >= 3;
      },
    });

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ purged: 3000, isCutShort: true });
  });

  test("gets one batch even when the run is out of time before it starts", async () => {
    const service: FakeService = windowed({ answers: [1000, 1000] });

    const result: OlderRowsPurgeOfTable = await OlderRowsPurge.purgeTable({
      service: service,
      isOutOfTime: (): boolean => {
        return true;
      },
    });

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ purged: 1000, isCutShort: true });
  });

  test("a table drained by its one batch is not cut short", async () => {
    const service: FakeService = windowed({ answers: [0] });

    expect(
      await OlderRowsPurge.purgeTable({
        service: service,
        isOutOfTime: (): boolean => {
          return true;
        },
      }),
    ).toEqual({ purged: 0, isCutShort: false });
  });

  test("throws a batch that fails, to the run", async () => {
    const service: FakeService = windowed({
      answers: [1000],
      throwsOnCall: 2,
    });

    await expect(
      OlderRowsPurge.purgeTable({
        service: service,
        isOutOfTime: neverOutOfTime,
      }),
    ).rejects.toThrow("connection reset");
    expect(service.hardDeleteBy).toHaveBeenCalledTimes(2);
  });
});

describe("a run", () => {
  test("works on every table with a window, in order, and on no other", async () => {
    const order: Array<string> = [];
    const first: FakeService = windowed({
      answers: [3, 0],
      onCall: (): void => {
        order.push("first");
      },
    });
    const noWindow: FakeService = fakeService({ answers: [9, 0] });
    const second: FakeService = fakeService({
      model: WhatsAppLog as unknown as { new (): BaseModel },
      column: "createdAt",
      days: 30,
      answers: [5, 0],
      onCall: (): void => {
        order.push("second");
      },
    });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [first, noWindow, { not: "a service" }, second],
    });

    expect(order).toEqual(["first", "first", "second", "second"]);
    expect(noWindow.hardDeleteBy).not.toHaveBeenCalled();
    expect(summary).toEqual({
      tables: 2,
      purged: 8,
      purgedTables: [
        { table: "AlertLabelRule", purged: 3 },
        { table: "WhatsAppLog", purged: 5 },
      ],
      failedTables: 0,
      isCutShort: false,
    });
  });

  test("with nothing due, says it purged nothing and was not cut short", async () => {
    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [windowed({}), windowed({})],
    });

    expect(summary).toEqual({
      tables: 2,
      purged: 0,
      purgedTables: [],
      failedTables: 0,
      isCutShort: false,
    });
  });

  test("with no table with a window, reads nothing", async () => {
    const noWindow: FakeService = fakeService({ answers: [5, 0] });

    expect(await OlderRowsPurge.run({ services: [noWindow] })).toEqual({
      tables: 0,
      purged: 0,
      purgedTables: [],
      failedTables: 0,
      isCutShort: false,
    });
    expect(noWindow.hardDeleteBy).not.toHaveBeenCalled();
  });

  test("drains for its budget, then gives each table left one batch", async () => {
    const backlog: FakeService = windowed({
      isEndless: true,
      minutesPerCall: 1,
    });
    const secondBacklog: FakeService = windowed({
      isEndless: true,
      minutesPerCall: 1,
    });
    const small: FakeService = windowed({ answers: [20, 0] });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [backlog, secondBacklog, small],
      timeBudgetMs: 5 * MINUTE_MS,
    });

    expect(backlog.hardDeleteBy).toHaveBeenCalledTimes(5);
    expect(secondBacklog.hardDeleteBy).toHaveBeenCalledTimes(1);
    // One batch: the 20 rows went, and whether more wait is for the next run.
    expect(small.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(summary.purged).toBe(5000 + 1000 + 20);
    expect(summary.tables).toBe(3);
    expect(summary.isCutShort).toBe(true);
  });

  // The old loop ran a backlog to its end before it looked at the next table.
  test("a backlog that never ends no longer keeps every table after it waiting", async () => {
    const backlog: FakeService = windowed({
      isEndless: true,
      minutesPerCall: 1,
    });
    const after: FakeService = windowed({ answers: [4, 0] });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [backlog, after],
    });

    expect(backlog.hardDeleteBy.mock.calls.length).toBeLessThan(
      MAX_ENDLESS_CALLS,
    );
    expect(after.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(summary.purgedTables[1]).toEqual({
      table: "AlertLabelRule",
      purged: 4,
    });
  });

  test("spends 20 minutes unless told otherwise", async () => {
    const backlog: FakeService = windowed({
      isEndless: true,
      minutesPerCall: 1,
    });

    await OlderRowsPurge.run({ services: [backlog] });

    expect(backlog.hardDeleteBy).toHaveBeenCalledTimes(20);
  });

  test("a deadline that has passed stops it before any table", async () => {
    const service: FakeService = windowed({ answers: [10, 0] });
    const deadline: JobDeadline = new JobDeadline();
    deadline.end(new Error("The run lost its lock."));

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [service],
      deadline: deadline,
    });

    expect(service.hardDeleteBy).not.toHaveBeenCalled();
    expect(summary).toEqual({
      tables: 0,
      purged: 0,
      purgedTables: [],
      failedTables: 0,
      isCutShort: true,
    });
  });

  test("a deadline that passes stops it after the batch in flight, and no table after is started", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const first: FakeService = windowed({
      isEndless: true,
      onCall: (call: number): void => {
        if (call === 3) {
          deadline.end(new Error("The job ran out of time."));
        }
      },
    });
    const second: FakeService = windowed({ answers: [10, 0] });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [first, second],
      deadline: deadline,
    });

    expect(first.hardDeleteBy).toHaveBeenCalledTimes(3);
    expect(second.hardDeleteBy).not.toHaveBeenCalled();
    expect(summary.purged).toBe(3000);
    expect(summary.tables).toBe(1);
    expect(summary.isCutShort).toBe(true);
  });

  test("a deadline that has not passed lets it finish", async () => {
    const service: FakeService = windowed({ answers: [10, 0] });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [service],
      deadline: new JobDeadline({
        endsAt: new Date(Date.now() + 60 * MINUTE_MS),
      }),
    });

    expect(summary.purged).toBe(10);
    expect(summary.isCutShort).toBe(false);
  });

  test("one table's failure is logged, counted, and the rest go on", async () => {
    const failing: FakeService = fakeService({
      column: "createdAt",
      days: 1095,
      answers: [1000],
      throwsOnCall: 2,
    });
    const healthy: FakeService = fakeService({
      model: WhatsAppLog as unknown as { new (): BaseModel },
      column: "createdAt",
      days: 3,
      answers: [6, 0],
    });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [failing, healthy],
    });

    expect(healthy.hardDeleteBy).toHaveBeenCalledTimes(2);
    expect(summary.failedTables).toBe(1);
    expect(summary.tables).toBe(2);
    expect(summary.purgedTables).toEqual([{ table: "WhatsAppLog", purged: 6 }]);
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(errorLog.mock.calls[0]![0]).toBe(
      "Retention: deleting the AlertLabelRule rows older than 1095 days failed. They are tried again next run.",
    );
    expect((errorLog.mock.calls[1]![0] as Error).message).toBe(
      "connection reset",
    );
  });
});
