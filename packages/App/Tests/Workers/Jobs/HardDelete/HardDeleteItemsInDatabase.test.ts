import { EVERY_DAY } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The two database retention sweeps, what each deletes on which
 * installation, and the evidence that neither of them is dead code.
 *
 * OneUptime's own deletes (DatabaseService.deleteBy and the rest) remove a
 * row at once, with a hard DELETE. A row is only marked deleted ("deletedAt"
 * set) by OneUptime's own schedule - the hourly age-out of the discovered
 * devices nothing sees any more (DiscoveredDeviceAgeOut, NetworkEndpoint,
 * since #6506) - by a migration (the duplicates RestoreDroppedUniqueIndexes
 * set aside, the SNMP monitors AddNetworkDeviceTables retired), or by a write
 * from outside the app. HardDelete:HardDeleteItemsInDatabase is the ONLY
 * thing in the repo that removes those rows for good, 30 days after they
 * were deleted (SoftDeletedRowsPurge). Without it, rows marked deleted are
 * kept forever - a storage leak, and for anything holding personal data a
 * deletion promise the product stops keeping. A cost audit once proposed
 * deleting it as a dead sweep doing zero-yield scans; what it measured was
 * the billing gate, not deadness.
 *
 * Which tables each installation purges (issue #6528):
 *
 *   - Where billing is on (BILLING_ENABLED=true, OneUptime Cloud): every
 *     service's soft-deleted rows, as since 2023.
 *   - Everywhere else (self-hosted): only the services whose rows OneUptime
 *     soft deletes on its own (DatabaseService
 *     .purgesSoftDeletedRowsOnEveryInstall, NetworkEndpointService). Until
 *     #6528 the sweep returned before touching the database at all there,
 *     so a busy network's aged-out devices piled up for good. Purging every
 *     table there too is the maintainer's call, so it does not.
 *   - Never a service marked doNotAllowDelete.
 *
 * The rows go 1000 a statement, until a batch removes nothing, within a
 * time budget a run, with the job's timeout above it, so a backlog of
 * millions drains over a few days without long locks. Once the budget is
 * spent each table left still gets one batch, so none waits behind another.
 *
 * The second sweep has no gate of its own: each service declares its
 * retention window in its constructor, most of them inside
 * `if (IsBillingEnabled)` (OneUptime Cloud only), some for every install
 * (sessions, test runs, OAuth grants).
 *
 * These tests pin all of that through the job's own handlers - with the
 * real purge, over fake services - so the deletion is not proposed again,
 * and so a future edit cannot quietly drop one of the two registrations.
 * SoftDeletedRowsPurge's own suite covers the purge's parts, and its
 * Postgres suite the statements against a migrated database.
 */

type CronHandler = (deadline?: unknown) => Promise<void>;

type CapturedOptions = {
  schedule: string;
  runOnStartup: boolean;
  timeoutInMS?: number;
};

type CapturedJob = {
  options: CapturedOptions;
  run: CronHandler;
};

const mockCapturedJobs: Record<string, CapturedJob> = {};

// Services the sweeps iterate. Mutated per test; the reference is stable.
const mockServices: Array<unknown> = [];

let mockBillingEnabled: boolean = true;

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CapturedOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options: options, run: runFunction };
      },
    ),
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

jest.mock("Common/Server/Services/Index", () => {
  return {
    __esModule: true,
    default: mockServices,
  };
});

/*
 * Only the billing flag is swapped; every other value stays real, because the
 * service layer under test reads a lot of this module.
 *
 * It has to be an accessor, not a value, and it has to be installed with
 * defineProperty rather than a getter in an object literal: TypeScript's
 * object spread compiles to Object.assign, which READS every accessor it
 * copies and flattens it to whatever it returned at that moment. A live
 * accessor is what lets one file cover both sides of the gate, because the
 * sweep reads the binding when it runs rather than when it was imported.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    IsDevelopment: false,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

/*
 * Imported AFTER the mocks above, and after the `mock*` bindings they close
 * over: TypeScript emits requires where the import sits, so anything hoisted
 * above those `let`/`const`s would touch them in their temporal dead zone.
 */
import "../../../../FeatureSet/Workers/Jobs/HardDelete/HardDeleteItemsInDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import SoftDeletedRowsPurge, {
  SOFT_DELETED_ROWS_PURGE_BATCH_SIZE,
  SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS,
  SOFT_DELETED_ROWS_RETENTION_IN_DAYS,
} from "Common/Server/Utils/Retention/SoftDeletedRowsPurge";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import AlertLabelRule from "Common/Models/DatabaseModels/AlertLabelRule";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";

const SOFT_DELETE_SWEEP: string = "HardDelete:HardDeleteItemsInDatabase";
const RETENTION_SWEEP: string = "HardDelete:HardDeleteOlderItemsInDatabase";

const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;

// Calls a fake's "endless" backlog answers, far more than any run makes.
const MAX_ENDLESS_CALLS: number = 1000;

// The purge's clock, pinned per test (SoftDeletedRowsPurge.now).
const START: Date = new Date("2026-11-16T03:00:00.000Z");
let clock: Date = START;
const realNow: () => Date = SoftDeletedRowsPurge.now;

type FakeService = DatabaseService<never> & { hardDeleteBy: jest.Mock };

type ModelType = { new (): never };

/*
 * A real DatabaseService, because the sweeps filter on
 * `service instanceof DatabaseService` — a plain object literal would be
 * skipped and every assertion below would pass vacuously.
 */
function fakeService(options: {
  modelType: ModelType;
  doNotAllowDelete?: boolean;
  // OneUptime soft deletes its rows on its own: purged on every install.
  purgesOnEveryInstall?: boolean;
  retentionColumn?: string;
  retentionDays?: number;
  // What each call removes, in order; 0 once they run out.
  deletedPerCall?: Array<number>;
  // A backlog that never ends: every call removes a full batch.
  isEndless?: boolean;
  // How far the purge's clock moves during each call.
  minutesPerCall?: number;
  // Called during each call, with the call's number (1-based).
  onCall?: (call: number) => void;
  throws?: boolean;
}): FakeService {
  const service: FakeService = new DatabaseService(
    options.modelType,
  ) as FakeService;

  service.doNotAllowDelete = options.doNotAllowDelete === true;
  service.purgesSoftDeletedRowsOnEveryInstall =
    options.purgesOnEveryInstall === true;

  if (options.retentionColumn && options.retentionDays) {
    service.hardDeleteItemsOlderThanInDays(
      options.retentionColumn,
      options.retentionDays,
    );
  }

  const remaining: Array<number> = [...(options.deletedPerCall || [0])];
  let calls: number = 0;

  service.hardDeleteBy = jest.fn(async (): Promise<number> => {
    calls += 1;

    if (options.minutesPerCall) {
      clock = new Date(clock.getTime() + options.minutesPerCall * MINUTE_MS);
    }

    options.onCall?.(calls);

    if (options.throws) {
      throw new Error("boom");
    }

    /*
     * Endless as far as any run goes; it runs out after MAX_ENDLESS_CALLS,
     * so a purge that never stops fails its test instead of hanging it.
     */
    if (options.isEndless) {
      return calls > MAX_ENDLESS_CALLS ? 0 : SOFT_DELETED_ROWS_PURGE_BATCH_SIZE;
    }

    return remaining.length > 0 ? (remaining.shift() as number) : 0;
  });

  return service;
}

function runSweep(jobName: string, deadline?: JobDeadline): Promise<void> {
  return mockCapturedJobs[jobName]!.run(deadline);
}

type DeleteCall = {
  query: Record<string, unknown>;
  props: { isRoot?: boolean };
  limit: number;
  skip: number;
};

function callOf(service: FakeService, index: number = 0): DeleteCall {
  return service.hardDeleteBy.mock.calls[index]![0] as unknown as DeleteCall;
}

function firstQuery(service: FakeService): Record<string, unknown> {
  return callOf(service).query;
}

/*
 * QueryHelper.lessThan() builds a TypeORM Raw operator: the comparison lives
 * in the generated SQL and the boundary in the bound parameters.
 *
 * The shape is described structurally rather than imported from typeorm --
 * typeorm is a Common dependency, not an App one, so importing it here
 * compiles locally through the hoisted tree but breaks `cd packages/App && tsc`
 * in CI.
 */
type RawFindOperator = {
  objectLiteralParameters?: Record<string, Date>;
  getSql?: (alias: string) => string;
};

function boundDate(operator: unknown): Date {
  const findOperator: RawFindOperator = operator as RawFindOperator;

  return Object.values(
    findOperator.objectLiteralParameters as Record<string, Date>,
  )[0] as Date;
}

function sqlOf(operator: unknown): string {
  const findOperator: RawFindOperator = operator as RawFindOperator;

  return findOperator.getSql!("col");
}

function daysAgo(date: Date): number {
  return Math.round(
    (OneUptimeDate.getCurrentDate().getTime() - date.getTime()) /
      (1000 * 60 * 60 * 24),
  );
}

function infoLogs(): Array<string> {
  return (logger.info as jest.Mock).mock.calls.map(
    (call: Array<unknown>): string => {
      return String(call[0]);
    },
  );
}

function errorLogs(): Array<unknown> {
  return (logger.error as jest.Mock).mock.calls.map(
    (call: Array<unknown>): unknown => {
      return call[0];
    },
  );
}

const asModel: (model: unknown) => ModelType = (model: unknown): ModelType => {
  return model as ModelType;
};

beforeEach(() => {
  mockBillingEnabled = true;
  mockServices.length = 0;
  clock = START;
  SoftDeletedRowsPurge.now = (): Date => {
    return clock;
  };
  jest.clearAllMocks();
});

afterEach(() => {
  SoftDeletedRowsPurge.now = realNow;
  jest.restoreAllMocks();
});

describe("both sweeps are registered", () => {
  /*
   * The over-deletion guard. If a cleanup ever removes one of these
   * registrations, or the file stops being imported, this fails.
   */
  test("the soft-delete purge is registered", () => {
    expect(mockCapturedJobs[SOFT_DELETE_SWEEP]).toBeDefined();
  });

  test("the per-model retention sweep is registered", () => {
    expect(mockCapturedJobs[RETENTION_SWEEP]).toBeDefined();
  });

  test("the file is wired into the Workers entry point", () => {
    const workersIndex: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "FeatureSet",
        "Workers",
        "Index.ts",
      ),
      "utf8",
    );

    expect(workersIndex).toContain(
      'import "./Jobs/HardDelete/HardDeleteItemsInDatabase"',
    );
  });

  test.each([SOFT_DELETE_SWEEP, RETENTION_SWEEP])(
    "%s runs daily outside development, and not on startup",
    (jobName: string) => {
      /*
       * Daily, not per-minute: these walk every service in the process, so
       * the schedule is the only thing keeping the cost bounded.
       */
      expect(mockCapturedJobs[jobName]!.options.schedule).toBe(EVERY_DAY);
      expect(mockCapturedJobs[jobName]!.options.runOnStartup).toBe(false);
    },
  );

  /*
   * The run spends its budget, then gives each table left one batch; the
   * time limit is above that, so the batch in flight and those batches
   * finish rather than run on past a failed job (the default limit is five
   * minutes, less than the budget).
   */
  test("the soft-delete purge's time limit is its budget and ten minutes more", () => {
    const timeoutInMS: number | undefined =
      mockCapturedJobs[SOFT_DELETE_SWEEP]!.options.timeoutInMS;

    expect(SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS).toBe(20 * MINUTE_MS);
    expect(timeoutInMS).toBe(
      SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS + 10 * MINUTE_MS,
    );
    expect(timeoutInMS!).toBeGreaterThan(
      SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS,
    );
  });
});

describe("which tables the soft-delete purge takes", () => {
  test("with billing on, every database service is purged, as always", async () => {
    mockBillingEnabled = true;

    const ordinary: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    const another: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
    });
    const optedIn: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      purgesOnEveryInstall: true,
    });
    mockServices.push(ordinary, another, optedIn);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(ordinary.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(another.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(optedIn.hardDeleteBy).toHaveBeenCalledTimes(1);
  });

  /*
   * A self-hosted install: what OneUptime soft deletes on its own goes, and
   * no other table is read at all - purging everything there is the
   * maintainer's call (#6528).
   */
  test("with billing off, only the services whose rows OneUptime soft deletes on its own are purged", async () => {
    mockBillingEnabled = false;

    const ordinary: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [5, 0],
    });
    const optedIn: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      purgesOnEveryInstall: true,
      deletedPerCall: [5, 0],
    });
    mockServices.push(ordinary, optedIn);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(ordinary.hardDeleteBy).not.toHaveBeenCalled();
    expect(optedIn.hardDeleteBy).toHaveBeenCalledTimes(2);
  });

  test("with billing off, the discovered devices are purged: NetworkEndpointService opts in", async () => {
    mockBillingEnabled = false;

    expect(NetworkEndpointService.purgesSoftDeletedRowsOnEveryInstall).toBe(
      true,
    );

    const hardDeleteBy: jest.SpyInstance = jest
      .spyOn(NetworkEndpointService, "hardDeleteBy")
      .mockResolvedValue(0);
    const ordinary: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    mockServices.push(ordinary, NetworkEndpointService);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(ordinary.hardDeleteBy).not.toHaveBeenCalled();
  });

  test("a service opts in only by saying so: the default is off", () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });

    expect(
      new DatabaseService(asModel(AlertLabelRule))
        .purgesSoftDeletedRowsOnEveryInstall,
    ).toBe(false);
    expect(service.purgesSoftDeletedRowsOnEveryInstall).toBe(false);
  });

  test.each([true, false])(
    "services marked do-not-delete are skipped, opted in or not (billing on: %s)",
    async (billing: boolean) => {
      mockBillingEnabled = billing;

      const protectedService: FakeService = fakeService({
        modelType: asModel(AlertLabelRule),
        doNotAllowDelete: true,
      });
      const protectedOptedIn: FakeService = fakeService({
        modelType: asModel(AlertLabelRule),
        doNotAllowDelete: true,
        purgesOnEveryInstall: true,
      });
      const ordinaryOptedIn: FakeService = fakeService({
        modelType: asModel(WhatsAppLog),
        purgesOnEveryInstall: true,
      });
      mockServices.push(protectedService, protectedOptedIn, ordinaryOptedIn);

      await runSweep(SOFT_DELETE_SWEEP);

      expect(protectedService.hardDeleteBy).not.toHaveBeenCalled();
      expect(protectedOptedIn.hardDeleteBy).not.toHaveBeenCalled();
      expect(ordinaryOptedIn.hardDeleteBy).toHaveBeenCalled();
    },
  );

  test("it ignores non-database entries in the service list", async () => {
    const notAService: {
      hardDeleteBy: jest.Mock;
      purgesSoftDeletedRowsOnEveryInstall: boolean;
    } = {
      hardDeleteBy: jest.fn(),
      purgesSoftDeletedRowsOnEveryInstall: true,
    };
    mockServices.push(notAService);

    await expect(runSweep(SOFT_DELETE_SWEEP)).resolves.toBeUndefined();
    expect(notAService.hardDeleteBy).not.toHaveBeenCalled();
  });

  test("it reads the billing flag when it runs, not when it was imported", async () => {
    const optedOut: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    mockServices.push(optedOut);

    mockBillingEnabled = false;
    await runSweep(SOFT_DELETE_SWEEP);
    expect(optedOut.hardDeleteBy).not.toHaveBeenCalled();

    mockBillingEnabled = true;
    await runSweep(SOFT_DELETE_SWEEP);
    expect(optedOut.hardDeleteBy).toHaveBeenCalledTimes(1);
  });
});

describe("what one batch of the soft-delete purge asks for", () => {
  test("it hard-deletes rows soft-deleted more than 30 days ago", async () => {
    SoftDeletedRowsPurge.now = realNow;

    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalled();

    const query: Record<string, unknown> = firstQuery(service);

    expect(SOFT_DELETED_ROWS_RETENTION_IN_DAYS).toBe(30);
    expect(Object.keys(query)).toEqual(["deletedAt"]);
    expect(sqlOf(query["deletedAt"])).toMatch(/^\(col < :\w+\)$/);
    expect(daysAgo(boundDate(query["deletedAt"]))).toBe(30);
  });

  test("the cut-off is exactly 30 days before the run's clock, on every batch", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [10, 10, 0],
      minutesPerCall: 1,
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(3);

    // Each batch is cut off from the clock as it starts.
    for (const [index, startedAt] of [
      START,
      new Date(START.getTime() + MINUTE_MS),
      new Date(START.getTime() + 2 * MINUTE_MS),
    ].entries()) {
      expect(boundDate(callOf(service, index).query["deletedAt"])).toEqual(
        new Date(startedAt.getTime() - 30 * DAY_MS),
      );
    }
  });

  test("it deletes as root — soft-deleted rows are invisible otherwise", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(callOf(service).props.isRoot).toBe(true);
  });

  /*
   * A statement deletes 1000 rows at most, not LIMIT_MAX: a backlog of
   * millions of aged-out devices goes in short statements with short locks.
   */
  test("each batch takes 1000 rows at most, from the first row due", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [1000, 1000, 0],
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(SOFT_DELETED_ROWS_PURGE_BATCH_SIZE).toBe(1000);
    expect(SOFT_DELETED_ROWS_PURGE_BATCH_SIZE).toBeLessThan(LIMIT_MAX);

    for (let index: number = 0; index < 3; index++) {
      expect(callOf(service, index).limit).toBe(1000);
      expect(callOf(service, index).skip).toBe(0);
    }
  });

  // hardDeleteBy rewrites what it is handed; a batch must never inherit that.
  test("each batch is handed a request of its own", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [3, 0],
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(callOf(service, 0)).not.toBe(callOf(service, 1));
    expect(callOf(service, 0).query).not.toBe(callOf(service, 1).query);
  });
});

describe("how much the soft-delete purge does in a run", () => {
  /*
   * The drain loop. Each batch is capped, so a backlog larger than one batch
   * has to be walked down across calls or the purge never catches up.
   */
  test("it keeps deleting until a batch yields nothing", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [1000, 1000, 17, 0],
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(4);
  });

  /*
   * NetworkSiteService and NetworkSiteTypeService purge leaves first: a
   * call removes the leaves it finds, fewer than a batch, and the next call
   * the level above. Only a call that removes nothing ends a table.
   */
  test("a batch smaller than the batch size does not end the table", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [3, 2, 1, 0],
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(4);
  });

  test("a table with nothing due costs one batch", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(1);
  });

  /*
   * The time budget: a backlog that never ends stops once 20 minutes are
   * spent, and every table after it still gets one batch, so none waits
   * behind another's backlog. What is left goes the next day.
   */
  test("a run stops draining once its budget is spent, and each table left still gets one batch", async () => {
    const backlog: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      isEndless: true,
      minutesPerCall: 1,
    });
    const secondBacklog: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      isEndless: true,
      minutesPerCall: 1,
    });
    const empty: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    mockServices.push(backlog, secondBacklog, empty);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(backlog.hardDeleteBy).toHaveBeenCalledTimes(
      SOFT_DELETED_ROWS_PURGE_TIME_BUDGET_MS / MINUTE_MS,
    );
    expect(secondBacklog.hardDeleteBy).toHaveBeenCalledTimes(1);
    expect(empty.hardDeleteBy).toHaveBeenCalledTimes(1);

    expect(infoLogs()).toEqual([
      `Soft-deleted rows: deleted ${21 * 1000} rows for good that were deleted more than 30 days ago (AlertLabelRule: 20000, WhatsAppLog: 1000); the rest wait for the next run.`,
    ]);
  });

  test("within its budget, a run drains every table", async () => {
    const first: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [1000, 1000, 1000, 0],
      minutesPerCall: 1,
    });
    const second: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      deletedPerCall: [1000, 500, 0],
      minutesPerCall: 1,
    });
    mockServices.push(first, second);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(first.hardDeleteBy).toHaveBeenCalledTimes(4);
    expect(second.hardDeleteBy).toHaveBeenCalledTimes(3);
    expect(infoLogs()).toEqual([
      "Soft-deleted rows: deleted 4500 rows for good that were deleted more than 30 days ago (AlertLabelRule: 3000, WhatsAppLog: 1500).",
    ]);
  });

  // The deadline RunCron hands the job: its time limit, or a lost lock.
  test("a deadline that has passed stops the run before its first batch", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      deletedPerCall: [1000, 0],
    });
    mockServices.push(service);

    const deadline: JobDeadline = new JobDeadline();
    deadline.end(new Error("The run lost its lock."));

    await runSweep(SOFT_DELETE_SWEEP, deadline);

    expect(service.hardDeleteBy).not.toHaveBeenCalled();
    expect(infoLogs()).toEqual([
      "Soft-deleted rows: deleted 0 rows for good that were deleted more than 30 days ago; the rest wait for the next run.",
    ]);
  });

  test("a deadline that passes mid-run stops it after the batch in flight", async () => {
    const deadline: JobDeadline = new JobDeadline();

    const first: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      isEndless: true,
      onCall: (call: number): void => {
        if (call === 2) {
          deadline.end(new Error("The job ran out of time."));
        }
      },
    });
    const second: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      deletedPerCall: [10, 0],
    });
    mockServices.push(first, second);

    await runSweep(SOFT_DELETE_SWEEP, deadline);

    expect(first.hardDeleteBy).toHaveBeenCalledTimes(2);
    expect(second.hardDeleteBy).not.toHaveBeenCalled();
  });

  /*
   * One bad table must not stop the purge for the others. The sweep runs
   * once a day, so a service that aborted the loop would defer every table
   * after it by a full day, every day.
   */
  test("one failing service is logged and does not abort the rest of the pass", async () => {
    const failing: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      throws: true,
    });
    const healthy: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      deletedPerCall: [4, 0],
    });
    mockServices.push(failing, healthy);

    await expect(runSweep(SOFT_DELETE_SWEEP)).resolves.toBeUndefined();

    expect(healthy.hardDeleteBy).toHaveBeenCalledTimes(2);
    expect(errorLogs()[0]).toBe(
      "Soft-deleted rows: deleting the AlertLabelRule rows deleted more than 30 days ago failed. They are tried again next run.",
    );
    expect((errorLogs()[1] as Error).message).toBe("boom");
    expect(infoLogs()).toEqual([
      "Soft-deleted rows: deleted 4 rows for good that were deleted more than 30 days ago (WhatsAppLog: 4); 1 tables failed and are tried again next run.",
    ]);
  });

  test("a run that had nothing to purge logs nothing", async () => {
    mockServices.push(
      fakeService({ modelType: asModel(AlertLabelRule) }),
      fakeService({ modelType: asModel(WhatsAppLog) }),
    );

    await runSweep(SOFT_DELETE_SWEEP);

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("a purge that throws is logged, never thrown at the queue", async () => {
    jest
      .spyOn(SoftDeletedRowsPurge, "run")
      .mockRejectedValue(new Error("Postgres is down"));

    await expect(runSweep(SOFT_DELETE_SWEEP)).resolves.toBeUndefined();

    expect(errorLogs()[0]).toBe(
      "Soft-deleted rows: deleting the rows deleted more than 30 days ago failed.",
    );
    expect((errorLogs()[1] as Error).message).toBe("Postgres is down");
  });

  test("it hands the purge the services, the billing flag and its deadline", async () => {
    const run: jest.SpyInstance = jest
      .spyOn(SoftDeletedRowsPurge, "run")
      .mockResolvedValue({
        tables: 0,
        purged: 0,
        purgedTables: [],
        failedTables: 0,
        isCutShort: false,
      });
    const deadline: JobDeadline = new JobDeadline();

    mockBillingEnabled = false;
    await runSweep(SOFT_DELETE_SWEEP, deadline);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({
      services: mockServices,
      isBillingEnabled: false,
      deadline: deadline,
    });
    expect((run.mock.calls[0]![0] as { services: unknown }).services).toBe(
      mockServices,
    );
  });
});

describe("the per-model retention sweep", () => {
  test("deletes by the column and window the service declared", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      retentionColumn: "createdAt",
      retentionDays: 3,
    });
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    const query: Record<string, unknown> = firstQuery(service);

    expect(Object.keys(query)).toEqual(["createdAt"]);
    expect(daysAgo(boundDate(query["createdAt"]))).toBe(3);
  });

  /*
   * Most windows are set inside `if (IsBillingEnabled)` in each service
   * constructor, so with billing off most services declare none, and for
   * those the sweep is a pure in-memory walk — the `continue` below.
   */
  test("skips services with no retention window declared", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    expect(service.hardDeleteBy).not.toHaveBeenCalled();
  });

  test("skips a service with a column but no window", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
    });
    service.hardDeleteItemByColumnName = "createdAt";
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    expect(service.hardDeleteBy).not.toHaveBeenCalled();
  });

  test("drains a service with more than one page of expired rows", async () => {
    const service: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      retentionColumn: "createdAt",
      retentionDays: 3,
      deletedPerCall: [1000, 5, 0],
    });
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(3);
  });

  test("one failing service does not abort the rest of the pass", async () => {
    const failing: FakeService = fakeService({
      modelType: asModel(AlertLabelRule),
      retentionColumn: "createdAt",
      retentionDays: 30,
      throws: true,
    });
    const healthy: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      retentionColumn: "createdAt",
      retentionDays: 3,
    });
    mockServices.push(failing, healthy);

    await expect(runSweep(RETENTION_SWEEP)).resolves.toBeUndefined();
    expect(healthy.hardDeleteBy).toHaveBeenCalled();
  });

  /*
   * This sweep has no gate of its own: the gate is in the services. Pinned
   * because it is the difference between the two jobs, and the reason the
   * audit's "gated off" reading does not transfer from one to the other.
   */
  test("runs on its declared windows regardless of the billing flag", async () => {
    mockBillingEnabled = false;

    const service: FakeService = fakeService({
      modelType: asModel(WhatsAppLog),
      retentionColumn: "createdAt",
      retentionDays: 3,
    });
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalled();
  });
});

describe("nothing else purges soft-deleted rows", () => {
  const appRoot: string = path.join(__dirname, "..", "..", "..", "..");
  const repositoryRoot: string = path.join(appRoot, "..", "..");

  // A query that compares "deletedAt" with a value: one that picks deleted rows by age.
  const QUERY_BY_DELETED_AT: RegExp =
    /deletedAt"?\s*:\s*(QueryHelper\.|LessThan|MoreThan|Not\(|Raw\()/;

  const filesQueryingDeletedAt: (root: string) => Array<string> = (
    root: string,
  ): Array<string> => {
    const found: Array<string> = [];

    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") {
            walk(full);
          }
          continue;
        }

        if (!entry.name.endsWith(".ts")) {
          continue;
        }

        if (QUERY_BY_DELETED_AT.test(fs.readFileSync(full, "utf8"))) {
          found.push(path.relative(repositoryRoot, full));
        }
      }
    };

    walk(root);

    return found;
  };

  /*
   * The load-bearing claim behind "do not delete this job". If another sweep
   * ever takes over the deletedAt purge, this test should be updated
   * deliberately — not silently outvoted.
   */
  test("the soft-delete purge is the only deletedAt-driven hard delete in Workers and the server code", () => {
    expect([
      ...filesQueryingDeletedAt(
        path.join(appRoot, "FeatureSet", "Workers", "Jobs"),
      ),
      ...filesQueryingDeletedAt(
        path.join(repositoryRoot, "packages", "Common", "Server"),
      ),
    ]).toEqual([
      path.join(
        "packages",
        "Common",
        "Server",
        "Utils",
        "Retention",
        "SoftDeletedRowsPurge.ts",
      ),
    ]);
  });

  test("the job runs that purge, and no deletedAt query of its own", () => {
    const job: string = fs.readFileSync(
      path.join(
        appRoot,
        "FeatureSet",
        "Workers",
        "Jobs",
        "HardDelete",
        "HardDeleteItemsInDatabase.ts",
      ),
      "utf8",
    );

    expect(job).toContain("SoftDeletedRowsPurge.run({");
    expect(job).not.toMatch(QUERY_BY_DELETED_AT);
  });
});
