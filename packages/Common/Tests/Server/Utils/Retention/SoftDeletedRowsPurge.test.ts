import AlertLabelRule from "../../../../Models/DatabaseModels/AlertLabelRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WhatsAppLog from "../../../../Models/DatabaseModels/WhatsAppLog";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import Services from "../../../../Server/Services/Index";
import NetworkEndpointService, {
  Service as NetworkEndpointServiceClass,
} from "../../../../Server/Services/NetworkEndpointService";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import SoftDeletedRowsPurge, {
  SOFT_DELETED_ROWS_PURGE_BATCH_SIZE,
  SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS,
  SOFT_DELETED_ROWS_RETENTION_IN_DAYS,
  SoftDeletedRowsPurgeOfTable,
  SoftDeletedRowsPurgeSummary,
} from "../../../../Server/Utils/Retention/SoftDeletedRowsPurge";
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
 * DELETING FOR GOOD THE ROWS SOFT DELETED MORE THAN 30 DAYS AGO (issue
 * #6528): Server/Utils/Retention/SoftDeletedRowsPurge, which the daily
 * Workers job HardDelete:HardDeleteItemsInDatabase runs.
 *
 * Here, without a database, over services whose hardDeleteBy is a stand-in:
 * which services an installation purges (every one where billing is on,
 * only those whose rows OneUptime soft deletes on its own elsewhere - today
 * the discovered devices - and never a do-not-delete one), what a batch asks
 * hardDeleteBy for (rows deleted more than 30 days ago, 1000 of them, as
 * OneUptime), and how a run walks the tables: each until a batch removes
 * nothing, within its time budget, every table left still getting one
 * batch, stopped by the job's deadline, one table's failure logged while the
 * rest go on. The job's own suite (App Tests/Workers/Jobs/HardDelete) pins
 * the wiring; SoftDeletedRowsPurgePostgres the statements on Postgres.
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
const realNow: () => Date = SoftDeletedRowsPurge.now;
let errorLog: SpyInstance<typeof logger.error>;

function fakeService(options: {
  model?: { new (): BaseModel };
  doNotAllowDelete?: boolean;
  purgesOnEveryInstall?: boolean;
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

  service.doNotAllowDelete = options.doNotAllowDelete === true;
  service.purgesSoftDeletedRowsOnEveryInstall =
    options.purgesOnEveryInstall === true;

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
        return calls > MAX_ENDLESS_CALLS
          ? 0
          : SOFT_DELETED_ROWS_PURGE_BATCH_SIZE;
      }

      return (answers.length > 0 ? answers.shift() : 0) as number;
    },
  );

  return service;
}

function requestOf(
  service: FakeService,
  index: number = 0,
): DeleteBy<BaseModel> {
  return service.hardDeleteBy.mock.calls[index]![0];
}

function cutoffOf(request: DeleteBy<BaseModel>): Date {
  const operator: FindOperator<unknown> = (
    request.query as Record<string, unknown>
  )["deletedAt"] as FindOperator<unknown>;

  return Object.values(
    operator.objectLiteralParameters as Record<string, Date>,
  )[0] as Date;
}

const neverOutOfTime: () => boolean = (): boolean => {
  return false;
};

beforeEach(() => {
  clock = START;
  SoftDeletedRowsPurge.now = (): Date => {
    return clock;
  };
  errorLog = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  SoftDeletedRowsPurge.now = realNow;
  jest.restoreAllMocks();
});

describe("what is kept, and how much goes at a time", () => {
  test("a soft-deleted row is kept 30 days", () => {
    expect(SOFT_DELETED_ROWS_RETENTION_IN_DAYS).toBe(30);
  });

  test("a statement deletes 1000 rows at most, far fewer than LIMIT_MAX", () => {
    expect(SOFT_DELETED_ROWS_PURGE_BATCH_SIZE).toBe(1000);
    expect(SOFT_DELETED_ROWS_PURGE_BATCH_SIZE).toBeLessThan(LIMIT_MAX);
  });

  test("a run drains backlogs for 20 minutes at most", () => {
    expect(SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS).toBe(20 * MINUTE_MS);
  });

  test("the cut-off is 30 days before the clock", () => {
    expect(SoftDeletedRowsPurge.getCutoff()).toEqual(
      new Date(START.getTime() - 30 * DAY_MS),
    );
  });
});

describe("which services an installation purges", () => {
  test.each([
    // [billing, opted in, do not delete, purged]
    [true, false, false, true],
    [true, true, false, true],
    [true, false, true, false],
    [true, true, true, false],
    [false, false, false, false],
    [false, true, false, true],
    [false, false, true, false],
    [false, true, true, false],
  ])(
    "billing on: %s, opted in: %s, do not delete: %s -> purged: %s",
    (
      billing: boolean,
      optedIn: boolean,
      doNotAllowDelete: boolean,
      purged: boolean,
    ) => {
      const service: FakeService = fakeService({
        purgesOnEveryInstall: optedIn,
        doNotAllowDelete: doNotAllowDelete,
      });

      expect(SoftDeletedRowsPurge.isPurgedOnThisInstall(service, billing)).toBe(
        purged,
      );
    },
  );

  test.each([true, false])(
    "nothing that is not a database service is purged (billing on: %s)",
    (billing: boolean) => {
      for (const entry of [
        undefined,
        null,
        {},
        {
          purgesSoftDeletedRowsOnEveryInstall: true,
          hardDeleteBy: jest.fn(),
        },
      ]) {
        expect(SoftDeletedRowsPurge.isPurgedOnThisInstall(entry, billing)).toBe(
          false,
        );
      }
    },
  );

  test("a service opts in only by saying so: the default is off", () => {
    expect(
      new DatabaseService<BaseModel>(
        WhatsAppLog as unknown as { new (): BaseModel },
      ).purgesSoftDeletedRowsOnEveryInstall,
    ).toBe(false);
  });

  test("the discovered devices opt in, from the service's constructor", () => {
    expect(NetworkEndpointService.purgesSoftDeletedRowsOnEveryInstall).toBe(
      true,
    );
    expect(
      new NetworkEndpointServiceClass().purgesSoftDeletedRowsOnEveryInstall,
    ).toBe(true);
    expect(NetworkEndpointService.doNotAllowDelete).toBe(false);
  });

  /*
   * The registry the job walks. On a self-hosted install the purge takes the
   * discovered devices and nothing else: purging every table there is the
   * maintainer's call (#6528). A service whose rows OneUptime starts soft
   * deleting on its own opts in, and this list grows with it, deliberately.
   */
  test("with billing off, of every service the job walks, only the discovered devices are purged", () => {
    const purged: Array<unknown> = Services.filter((service: unknown) => {
      return SoftDeletedRowsPurge.isPurgedOnThisInstall(service, false);
    });

    expect(purged).toHaveLength(1);
    expect(purged[0]).toBe(NetworkEndpointService);
  });

  test("with billing on, every database service the job walks is purged but those that may not be deleted from", () => {
    const databaseServices: Array<DatabaseService<BaseModel>> = Services.filter(
      (service: unknown): service is DatabaseService<BaseModel> => {
        return service instanceof DatabaseService;
      },
    );
    const purged: Array<unknown> = Services.filter((service: unknown) => {
      return SoftDeletedRowsPurge.isPurgedOnThisInstall(service, true);
    });

    expect(databaseServices.length).toBeGreaterThan(100);
    expect(purged).toEqual(
      databaseServices.filter((service: DatabaseService<BaseModel>) => {
        return !service.doNotAllowDelete;
      }),
    );
    expect(purged).toContain(NetworkEndpointService);
  });
});

describe("one batch", () => {
  test("asks for the rows deleted more than 30 days ago, as OneUptime, 1000 at most, from the first", async () => {
    const service: FakeService = fakeService({ answers: [7] });

    expect(await SoftDeletedRowsPurge.purgeBatch(service)).toBe(7);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(1);

    const request: DeleteBy<BaseModel> = requestOf(service);
    const operator: FindOperator<unknown> = (
      request.query as Record<string, unknown>
    )["deletedAt"] as FindOperator<unknown>;

    expect(Object.keys(request.query)).toEqual(["deletedAt"]);
    expect(operator.getSql!("deleted")).toMatch(/^\(deleted < :\w+\)$/);
    expect(cutoffOf(request)).toEqual(new Date(START.getTime() - 30 * DAY_MS));
    expect(request.props).toEqual({ isRoot: true });
    expect(request.limit).toBe(1000);
    expect(request.skip).toBe(0);
  });

  test("hands every batch a request of its own, cut off from the clock as it starts", async () => {
    const service: FakeService = fakeService({ answers: [1, 1] });

    await SoftDeletedRowsPurge.purgeBatch(service);
    clock = new Date(START.getTime() + 5 * MINUTE_MS);
    await SoftDeletedRowsPurge.purgeBatch(service);

    expect(requestOf(service, 0)).not.toBe(requestOf(service, 1));
    expect(requestOf(service, 0).query).not.toBe(requestOf(service, 1).query);
    expect(cutoffOf(requestOf(service, 1))).toEqual(
      new Date(START.getTime() + 5 * MINUTE_MS - 30 * DAY_MS),
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
      const service: FakeService = fakeService({ answers: [answer] });

      expect(await SoftDeletedRowsPurge.purgeBatch(service)).toBe(count);
    },
  );
});

describe("one table", () => {
  test("goes a batch at a time until a batch removes nothing", async () => {
    const service: FakeService = fakeService({
      answers: [1000, 1000, 400, 0],
    });

    const result: SoftDeletedRowsPurgeOfTable =
      await SoftDeletedRowsPurge.purgeTable({
        service: service,
        isOutOfTime: neverOutOfTime,
      });

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ purged: 2400, isCutShort: false });
  });

  // NetworkSiteLeafPurge removes a tree a level a call, each call below the size.
  test("a batch smaller than the batch size does not end it", async () => {
    const service: FakeService = fakeService({ answers: [2, 1, 1, 0] });

    const result: SoftDeletedRowsPurgeOfTable =
      await SoftDeletedRowsPurge.purgeTable({
        service: service,
        isOutOfTime: neverOutOfTime,
      });

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ purged: 4, isCutShort: false });
  });

  test("one with nothing due costs one batch", async () => {
    const service: FakeService = fakeService({});

    expect(
      await SoftDeletedRowsPurge.purgeTable({
        service: service,
        isOutOfTime: neverOutOfTime,
      }),
    ).toEqual({ purged: 0, isCutShort: false });
    expect(service.hardDeleteBy).toHaveBeenCalledTimes(1);
  });

  test("stops after the batch that finds the run out of time, and says rows may be left", async () => {
    const service: FakeService = fakeService({ isEndless: true });
    let checks: number = 0;

    const result: SoftDeletedRowsPurgeOfTable =
      await SoftDeletedRowsPurge.purgeTable({
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
    const service: FakeService = fakeService({ answers: [1000, 1000] });

    const result: SoftDeletedRowsPurgeOfTable =
      await SoftDeletedRowsPurge.purgeTable({
        service: service,
        isOutOfTime: (): boolean => {
          return true;
        },
      });

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ purged: 1000, isCutShort: true });
  });

  test("a table drained by its one batch is not cut short", async () => {
    const service: FakeService = fakeService({ answers: [0] });

    expect(
      await SoftDeletedRowsPurge.purgeTable({
        service: service,
        isOutOfTime: (): boolean => {
          return true;
        },
      }),
    ).toEqual({ purged: 0, isCutShort: false });
  });

  test("throws a batch that fails, to the run", async () => {
    const service: FakeService = fakeService({
      answers: [1000],
      throwsOnCall: 2,
    });

    await expect(
      SoftDeletedRowsPurge.purgeTable({
        service: service,
        isOutOfTime: neverOutOfTime,
      }),
    ).rejects.toThrow("connection reset");
    expect(service.hardDeleteBy).toHaveBeenCalledTimes(2);
  });
});

describe("a run", () => {
  test("with billing on, works on every table in order", async () => {
    const order: Array<string> = [];
    const first: FakeService = fakeService({
      answers: [3, 0],
      onCall: (): void => {
        order.push("first");
      },
    });
    const second: FakeService = fakeService({
      model: WhatsAppLog as unknown as { new (): BaseModel },
      answers: [5, 0],
      onCall: (): void => {
        order.push("second");
      },
    });

    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      { services: [first, second], isBillingEnabled: true },
    );

    expect(order).toEqual(["first", "first", "second", "second"]);
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

  test("with billing off, works on the opted-in tables only", async () => {
    const ordinary: FakeService = fakeService({ answers: [3, 0] });
    const optedIn: FakeService = fakeService({
      model: WhatsAppLog as unknown as { new (): BaseModel },
      purgesOnEveryInstall: true,
      answers: [5, 0],
    });
    const protectedOptedIn: FakeService = fakeService({
      purgesOnEveryInstall: true,
      doNotAllowDelete: true,
      answers: [5, 0],
    });

    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      {
        services: [ordinary, optedIn, protectedOptedIn, { not: "a service" }],
        isBillingEnabled: false,
      },
    );

    expect(ordinary.hardDeleteBy).not.toHaveBeenCalled();
    expect(protectedOptedIn.hardDeleteBy).not.toHaveBeenCalled();
    expect(optedIn.hardDeleteBy).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      tables: 1,
      purged: 5,
      purgedTables: [{ table: "WhatsAppLog", purged: 5 }],
      failedTables: 0,
      isCutShort: false,
    });
  });

  test("with nothing due, says it purged nothing and was not cut short", async () => {
    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      {
        services: [fakeService({}), fakeService({})],
        isBillingEnabled: true,
      },
    );

    expect(summary).toEqual({
      tables: 2,
      purged: 0,
      purgedTables: [],
      failedTables: 0,
      isCutShort: false,
    });
  });

  test("drains for its budget, then gives each table left one batch", async () => {
    const backlog: FakeService = fakeService({
      isEndless: true,
      minutesPerCall: 1,
    });
    const secondBacklog: FakeService = fakeService({
      isEndless: true,
      minutesPerCall: 1,
    });
    const small: FakeService = fakeService({ answers: [20, 0] });

    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      {
        services: [backlog, secondBacklog, small],
        isBillingEnabled: true,
        timeBudgetMs: 5 * MINUTE_MS,
      },
    );

    expect(backlog.hardDeleteBy).toHaveBeenCalledTimes(5);
    expect(secondBacklog.hardDeleteBy).toHaveBeenCalledTimes(1);
    // One batch: the 20 rows went, and whether more wait is for the next run.
    expect(small.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(summary.purged).toBe(5000 + 1000 + 20);
    expect(summary.tables).toBe(3);
    expect(summary.isCutShort).toBe(true);
  });

  test("spends 20 minutes unless told otherwise", async () => {
    const backlog: FakeService = fakeService({
      isEndless: true,
      minutesPerCall: 1,
    });

    await SoftDeletedRowsPurge.run({
      services: [backlog],
      isBillingEnabled: true,
    });

    expect(backlog.hardDeleteBy).toHaveBeenCalledTimes(20);
  });

  test("a deadline that has passed stops it before any table", async () => {
    const service: FakeService = fakeService({ answers: [10, 0] });
    const deadline: JobDeadline = new JobDeadline();
    deadline.end(new Error("The run lost its lock."));

    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      {
        services: [service],
        isBillingEnabled: true,
        deadline: deadline,
      },
    );

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
    const first: FakeService = fakeService({
      isEndless: true,
      onCall: (call: number): void => {
        if (call === 3) {
          deadline.end(new Error("The job ran out of time."));
        }
      },
    });
    const second: FakeService = fakeService({ answers: [10, 0] });

    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      {
        services: [first, second],
        isBillingEnabled: true,
        deadline: deadline,
      },
    );

    expect(first.hardDeleteBy).toHaveBeenCalledTimes(3);
    expect(second.hardDeleteBy).not.toHaveBeenCalled();
    expect(summary.purged).toBe(3000);
    expect(summary.tables).toBe(1);
    expect(summary.isCutShort).toBe(true);
  });

  test("a deadline that has not passed lets it finish", async () => {
    const service: FakeService = fakeService({ answers: [10, 0] });

    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      {
        services: [service],
        isBillingEnabled: true,
        deadline: new JobDeadline({
          endsAt: new Date(Date.now() + 60 * MINUTE_MS),
        }),
      },
    );

    expect(summary.purged).toBe(10);
    expect(summary.isCutShort).toBe(false);
  });

  test("one table's failure is logged, counted, and the rest go on", async () => {
    const failing: FakeService = fakeService({
      answers: [1000],
      throwsOnCall: 2,
    });
    const healthy: FakeService = fakeService({
      model: WhatsAppLog as unknown as { new (): BaseModel },
      answers: [6, 0],
    });

    const summary: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      { services: [failing, healthy], isBillingEnabled: true },
    );

    expect(healthy.hardDeleteBy).toHaveBeenCalledTimes(2);
    expect(summary.failedTables).toBe(1);
    expect(summary.tables).toBe(2);
    expect(summary.purgedTables).toEqual([{ table: "WhatsAppLog", purged: 6 }]);
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(errorLog.mock.calls[0]![0]).toBe(
      "Soft-deleted rows: deleting the AlertLabelRule rows deleted more than 30 days ago failed. They are tried again next run.",
    );
    expect((errorLog.mock.calls[1]![0] as Error).message).toBe(
      "connection reset",
    );
  });
});
