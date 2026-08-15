import { EVERY_DAY } from "Common/Utils/CronTime";
import { FindOperator } from "typeorm";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The two database retention sweeps, and the evidence that neither of them is
 * dead code.
 *
 * A cost audit flagged HardDelete:HardDeleteItemsInDatabase as a dead sweep
 * doing zero-yield scans and proposed deleting it. It is not dead. It is the
 * ONLY thing in the repo that ever hard-deletes a soft-deleted row: every
 * other delete path writes "deletedAt" and stops there. Removing it would
 * mean rows marked deleted are retained forever — a storage leak and, for
 * anything holding personal data, a deletion promise the product stops
 * keeping.
 *
 * What the audit measured is the gate, not deadness. Both sweeps are keyed off
 * IsBillingEnabled (BILLING_ENABLED=true), which is a deployment flag, not a
 * compile-time constant: the retention windows the second sweep reads are set
 * inside `if (IsBillingEnabled)` in each service's constructor, and the first
 * sweep returns before touching the database at all when it is off. So on a
 * self-hosted install the sweeps already cost nothing, and on a
 * billing-enabled install the scans are the purge doing its job.
 *
 * These tests pin all of that so the deletion is not proposed again, and so a
 * future edit cannot quietly drop one of the two registrations.
 */

type CronHandler = () => Promise<void>;

type CapturedJob = {
  options: { schedule: string; runOnStartup: boolean };
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
        options: { schedule: string; runOnStartup: boolean },
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
import OneUptimeDate from "Common/Types/Date";
import AlertLabelRule from "Common/Models/DatabaseModels/AlertLabelRule";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";

const SOFT_DELETE_SWEEP: string = "HardDelete:HardDeleteItemsInDatabase";
const RETENTION_SWEEP: string = "HardDelete:HardDeleteOlderItemsInDatabase";

type FakeService = DatabaseService<never> & { hardDeleteBy: jest.Mock };

/*
 * A real DatabaseService, because the sweeps filter on
 * `service instanceof DatabaseService` — a plain object literal would be
 * skipped and every assertion below would pass vacuously.
 */
function fakeService(options: {
  modelType: { new (): never };
  doNotAllowDelete?: boolean;
  retentionColumn?: string;
  retentionDays?: number;
  deletedPerCall?: Array<number>;
  throws?: boolean;
}): FakeService {
  const service: FakeService = new DatabaseService(
    options.modelType,
  ) as FakeService;

  service.doNotAllowDelete = options.doNotAllowDelete === true;

  if (options.retentionColumn && options.retentionDays) {
    service.hardDeleteItemsOlderThanInDays(
      options.retentionColumn,
      options.retentionDays,
    );
  }

  const remaining: Array<number> = [...(options.deletedPerCall || [0])];

  service.hardDeleteBy = jest.fn(async (): Promise<number> => {
    if (options.throws) {
      throw new Error("boom");
    }

    return remaining.length > 0 ? (remaining.shift() as number) : 0;
  });

  return service;
}

function runSweep(jobName: string): Promise<void> {
  return mockCapturedJobs[jobName]!.run();
}

type DeleteCall = { query: Record<string, unknown> };

function firstQuery(service: FakeService): Record<string, unknown> {
  const call: DeleteCall = service.hardDeleteBy.mock
    .calls[0]![0] as unknown as DeleteCall;

  return call.query;
}

/*
 * QueryHelper.lessThan() builds a TypeORM Raw operator: the comparison lives
 * in the generated SQL and the boundary in the bound parameters.
 */
function boundDate(operator: unknown): Date {
  const findOperator: FindOperator<Date> = operator as FindOperator<Date>;

  return Object.values(
    findOperator.objectLiteralParameters as Record<string, Date>,
  )[0] as Date;
}

function sqlOf(operator: unknown): string {
  const findOperator: FindOperator<Date> = operator as FindOperator<Date>;

  return findOperator.getSql!("col");
}

function daysAgo(date: Date): number {
  return Math.round(
    (OneUptimeDate.getCurrentDate().getTime() - date.getTime()) /
      (1000 * 60 * 60 * 24),
  );
}

beforeEach(() => {
  mockBillingEnabled = true;
  mockServices.length = 0;
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
});

describe("the soft-delete purge is live work, not a dead sweep", () => {
  test("it hard-deletes rows soft-deleted more than 30 days ago", async () => {
    const service: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalled();

    const query: Record<string, unknown> = firstQuery(service);

    expect(Object.keys(query)).toEqual(["deletedAt"]);
    expect(sqlOf(query["deletedAt"])).toContain("<");
    expect(daysAgo(boundDate(query["deletedAt"]))).toBe(30);
  });

  test("it deletes as root — soft-deleted rows are invisible otherwise", async () => {
    const service: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    const call: { props: { isRoot: boolean } } = service.hardDeleteBy.mock
      .calls[0]![0] as unknown as { props: { isRoot: boolean } };

    expect(call.props.isRoot).toBe(true);
  });

  /*
   * The drain loop. hardDeleteBy is capped at LIMIT_MAX per call, so a
   * backlog larger than one page has to be walked down across calls or the
   * purge never catches up.
   */
  test("it keeps deleting until a pass yields nothing", async () => {
    const service: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
      deletedPerCall: [1000, 1000, 17, 0],
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalledTimes(4);
  });

  test("it skips services marked do-not-delete", async () => {
    const protectedService: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
      doNotAllowDelete: true,
    });
    const ordinaryService: FakeService = fakeService({
      modelType: WhatsAppLog as unknown as { new (): never },
    });
    mockServices.push(protectedService, ordinaryService);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(protectedService.hardDeleteBy).not.toHaveBeenCalled();
    expect(ordinaryService.hardDeleteBy).toHaveBeenCalled();
  });

  test("it ignores non-database entries in the service list", async () => {
    const notAService: { hardDeleteBy: jest.Mock } = {
      hardDeleteBy: jest.fn(),
    };
    mockServices.push(notAService);

    await expect(runSweep(SOFT_DELETE_SWEEP)).resolves.toBeUndefined();
    expect(notAService.hardDeleteBy).not.toHaveBeenCalled();
  });

  /*
   * One bad table must not stop the purge for the other 264. The sweep runs
   * once a day, so a service that aborted the loop would defer every table
   * after it by a full day, every day.
   */
  test("one failing service does not abort the rest of the pass", async () => {
    const failing: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
      throws: true,
    });
    const healthy: FakeService = fakeService({
      modelType: WhatsAppLog as unknown as { new (): never },
    });
    mockServices.push(failing, healthy);

    await expect(runSweep(SOFT_DELETE_SWEEP)).resolves.toBeUndefined();
    expect(healthy.hardDeleteBy).toHaveBeenCalled();
  });

  /*
   * The audit's "zero-yield scans" measured this branch. With billing off the
   * sweep issues no query at all, so there is nothing to save by deleting it;
   * with billing on the queries are the purge working.
   */
  test("it touches the database not at all when billing is disabled", async () => {
    mockBillingEnabled = false;

    const service: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
    });
    mockServices.push(service);

    await runSweep(SOFT_DELETE_SWEEP);

    expect(service.hardDeleteBy).not.toHaveBeenCalled();
  });
});

describe("the per-model retention sweep", () => {
  test("deletes by the column and window the service declared", async () => {
    const service: FakeService = fakeService({
      modelType: WhatsAppLog as unknown as { new (): never },
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
   * Its windows are set inside `if (IsBillingEnabled)` in each service
   * constructor, so with billing off no service declares one and the sweep
   * is a pure in-memory walk — the `continue` below, 265 times.
   */
  test("skips services with no retention window declared", async () => {
    const service: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
    });
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    expect(service.hardDeleteBy).not.toHaveBeenCalled();
  });

  test("skips a service with a column but no window", async () => {
    const service: FakeService = fakeService({
      modelType: AlertLabelRule as unknown as { new (): never },
    });
    service.hardDeleteItemByColumnName = "createdAt";
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    expect(service.hardDeleteBy).not.toHaveBeenCalled();
  });

  test("drains a service with more than one page of expired rows", async () => {
    const service: FakeService = fakeService({
      modelType: WhatsAppLog as unknown as { new (): never },
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
      modelType: AlertLabelRule as unknown as { new (): never },
      retentionColumn: "createdAt",
      retentionDays: 30,
      throws: true,
    });
    const healthy: FakeService = fakeService({
      modelType: WhatsAppLog as unknown as { new (): never },
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
      modelType: WhatsAppLog as unknown as { new (): never },
      retentionColumn: "createdAt",
      retentionDays: 3,
    });
    mockServices.push(service);

    await runSweep(RETENTION_SWEEP);

    expect(service.hardDeleteBy).toHaveBeenCalled();
  });
});

describe("nothing else purges soft-deleted rows", () => {
  /*
   * The load-bearing claim behind "do not delete this job". If another sweep
   * ever takes over the deletedAt purge, this test should be updated
   * deliberately — not silently outvoted.
   */
  test("the soft-delete purge is the only deletedAt-driven hard delete in Workers", () => {
    const jobsRoot: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "FeatureSet",
      "Workers",
      "Jobs",
    );

    const filesQueryingDeletedAt: Array<string> = [];

    const walk: (dir: string) => void = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(full);
          continue;
        }

        if (!entry.name.endsWith(".ts")) {
          continue;
        }

        if (fs.readFileSync(full, "utf8").includes("deletedAt:")) {
          filesQueryingDeletedAt.push(path.relative(jobsRoot, full));
        }
      }
    };

    walk(jobsRoot);

    expect(filesQueryingDeletedAt).toEqual([
      path.join("HardDelete", "HardDeleteItemsInDatabase.ts"),
    ]);
  });
});
