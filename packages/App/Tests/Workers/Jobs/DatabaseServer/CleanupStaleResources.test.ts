import fs from "fs";
import path from "path";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * DatabaseServer:CleanupStaleResources is the only scheduled caller of the
 * two Databases sweeps: flipping databases whose collector went quiet to
 * "disconnected", and auto-archiving discovered databases nobody has seen
 * or touched for days. These tests drive one full tick and pin the
 * contract the job's header promises:
 *
 *   1. it registers under its documented name, every five minutes, not on
 *      startup — and the worker Index imports it (an unimported job never
 *      registers);
 *   2. both sweeps run on every tick, the disconnect sweep first;
 *   3. each sweep sits in its own try: one failing is logged and the other
 *      still runs, and the handler never throws;
 *   4. it reports what changed once, and stays quiet when nothing did.
 *
 * The thresholds, the "untouched" definition and the SQL are the service's
 * (pinned in the DatabaseServerService tests); the service is replaced with
 * a factory here so no DatabaseService — and so no Postgres / Redis — is
 * loaded.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, CronOptions> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
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

jest.mock("Common/Server/Services/DatabaseServerService", () => {
  return {
    __esModule: true,
    default: {
      markDisconnectedDatabaseServers: jest.fn(),
      autoArchiveStaleDatabaseServers: jest.fn(),
    },
  };
});

import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/DatabaseServer/CleanupStaleResources";

const JOB_NAME: string = "DatabaseServer:CleanupStaleResources";

interface ServiceMock {
  markDisconnectedDatabaseServers: jest.Mock;
  autoArchiveStaleDatabaseServers: jest.Mock;
}

interface LoggerMock {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

const service: ServiceMock = DatabaseServerService as unknown as ServiceMock;
const mockedLogger: LoggerMock = logger as unknown as LoggerMock;

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];
  if (!handler) {
    throw new Error(
      `Cron handler ${JOB_NAME} was not registered - the RunCron mock never saw it.`,
    );
  }
  await handler();
}

beforeEach(() => {
  jest.resetAllMocks();
  service.markDisconnectedDatabaseServers.mockResolvedValue(0);
  service.autoArchiveStaleDatabaseServers.mockResolvedValue(0);
});

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, and not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("is imported by the worker Index — an unimported job never registers", () => {
    const indexPath: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "FeatureSet",
      "Workers",
      "Index.ts",
    );
    const source: string = fs.readFileSync(indexPath, "utf8");

    expect(source).toContain(
      'import "./Jobs/DatabaseServer/CleanupStaleResources";',
    );
  });
});

describe("both sweeps run on every tick", () => {
  test("the disconnect sweep and the auto-archive sweep each run once", async () => {
    await runTick();

    expect(service.markDisconnectedDatabaseServers).toHaveBeenCalledTimes(1);
    expect(service.autoArchiveStaleDatabaseServers).toHaveBeenCalledTimes(1);
  });

  test("the disconnect sweep runs first", async () => {
    await runTick();

    expect(
      service.markDisconnectedDatabaseServers.mock.invocationCallOrder[0],
    ).toBeLessThan(
      service.autoArchiveStaleDatabaseServers.mock.invocationCallOrder[0]!,
    );
  });

  test("the sweeps are called with no arguments — all policy lives in the service", async () => {
    await runTick();

    expect(service.markDisconnectedDatabaseServers).toHaveBeenCalledWith();
    expect(service.autoArchiveStaleDatabaseServers).toHaveBeenCalledWith();
  });

  test("a second tick runs both sweeps again (nothing is remembered between ticks)", async () => {
    await runTick();
    await runTick();

    expect(service.markDisconnectedDatabaseServers).toHaveBeenCalledTimes(2);
    expect(service.autoArchiveStaleDatabaseServers).toHaveBeenCalledTimes(2);
  });
});

describe("each sweep is isolated", () => {
  test("a failing disconnect sweep is logged and the auto-archive still runs", async () => {
    service.markDisconnectedDatabaseServers.mockRejectedValue(
      new Error("redis exploded"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(service.autoArchiveStaleDatabaseServers).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("markDisconnectedDatabaseServers failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("redis exploded"),
    );
  });

  test("a failing auto-archive is logged and the disconnect sweep still ran", async () => {
    service.autoArchiveStaleDatabaseServers.mockRejectedValue(
      new Error("postgres down"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(service.markDisconnectedDatabaseServers).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("autoArchiveStaleDatabaseServers failed"),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("postgres down"),
    );
  });

  test("both failing still never throws, and each failure is logged once", async () => {
    service.markDisconnectedDatabaseServers.mockRejectedValue(
      new Error("redis exploded"),
    );
    service.autoArchiveStaleDatabaseServers.mockRejectedValue("not an Error");

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(2);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("not an Error"),
    );
  });

  test("a sweep that throws synchronously is contained too", async () => {
    service.markDisconnectedDatabaseServers.mockImplementation(() => {
      throw new Error("sync boom");
    });

    await expect(runTick()).resolves.toBeUndefined();

    expect(service.autoArchiveStaleDatabaseServers).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("sync boom"),
    );
  });
});

describe("reporting", () => {
  test("logs one debug line with both counts when something changed", async () => {
    service.markDisconnectedDatabaseServers.mockResolvedValue(3);
    service.autoArchiveStaleDatabaseServers.mockResolvedValue(7);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("marked 3 database(s) disconnected"),
    );
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("auto-archived 7 stale discovered database(s)"),
    );
  });

  test("reports an archive-only tick", async () => {
    service.autoArchiveStaleDatabaseServers.mockResolvedValue(1);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("marked 0 database(s) disconnected"),
    );
  });

  test("still reports the other sweep's count when one failed", async () => {
    service.markDisconnectedDatabaseServers.mockRejectedValue(
      new Error("redis exploded"),
    );
    service.autoArchiveStaleDatabaseServers.mockResolvedValue(2);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("auto-archived 2"),
    );
  });

  test("stays quiet when nothing changed", async () => {
    await runTick();

    expect(mockedLogger.debug).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});
