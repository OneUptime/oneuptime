import fs from "fs";
import path from "path";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";

/*
 * MessageQueue:CleanupStaleResources is the only scheduled caller of the
 * Queues auto-archive sweep: archiving discovered queues nobody has seen or
 * touched for days. These tests drive full ticks and pin the contract the
 * job's header promises:
 *
 *   1. it registers under its documented name, every five minutes, not on
 *      startup — and the worker Index imports it (an unimported job never
 *      registers);
 *   2. the sweep runs on every tick, with no arguments: the window, the
 *      "untouched" definition, the batch size and the SQL are the service's
 *      (pinned in the MessageQueueService tests);
 *   3. a failing sweep is logged and the handler never throws;
 *   4. it reports what changed, and stays quiet when nothing did.
 *
 * The service is replaced with a factory here so no DatabaseService — and so
 * no Postgres / Redis — is loaded.
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

jest.mock("Common/Server/Services/MessageQueueService", () => {
  return {
    __esModule: true,
    default: {
      autoArchiveStaleMessageQueues: jest.fn(),
    },
  };
});

import MessageQueueService from "Common/Server/Services/MessageQueueService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/MessageQueue/CleanupStaleResources";

const JOB_NAME: string = "MessageQueue:CleanupStaleResources";

interface ServiceMock {
  autoArchiveStaleMessageQueues: jest.Mock;
}

interface LoggerMock {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

const service: ServiceMock = MessageQueueService as unknown as ServiceMock;
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
  service.autoArchiveStaleMessageQueues.mockResolvedValue(0);
});

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, and not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("registers exactly one job", () => {
    expect(Object.keys(mockCapturedJobs)).toEqual([JOB_NAME]);
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

    expect(
      source.split('import "./Jobs/MessageQueue/CleanupStaleResources";')
        .length - 1,
    ).toBe(1);
  });
});

describe("the sweep runs on every tick", () => {
  test("the auto-archive sweep runs once per tick", async () => {
    await runTick();

    expect(service.autoArchiveStaleMessageQueues).toHaveBeenCalledTimes(1);
  });

  test("the sweep is called with no arguments — all policy lives in the service", async () => {
    await runTick();

    expect(service.autoArchiveStaleMessageQueues).toHaveBeenCalledWith();
  });

  test("a second tick runs the sweep again (nothing is remembered between ticks)", async () => {
    await runTick();
    await runTick();

    expect(service.autoArchiveStaleMessageQueues).toHaveBeenCalledTimes(2);
  });

  test("the next tick runs even after a failed one", async () => {
    service.autoArchiveStaleMessageQueues
      .mockRejectedValueOnce(new Error("postgres down"))
      .mockResolvedValueOnce(2);

    await runTick();
    await runTick();

    expect(service.autoArchiveStaleMessageQueues).toHaveBeenCalledTimes(2);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("auto-archived 2 stale discovered queue(s)"),
    );
  });
});

describe("failures are contained", () => {
  test("a failing sweep is logged with its reason and the handler never throws", async () => {
    service.autoArchiveStaleMessageQueues.mockRejectedValue(
      new Error("postgres down"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "MessageQueue:CleanupStaleResources: autoArchiveStaleMessageQueues failed",
      ),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("postgres down"),
    );
    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });

  test("a rejection that is not an Error is logged as text", async () => {
    service.autoArchiveStaleMessageQueues.mockRejectedValue("not an Error");

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("not an Error"),
    );
  });

  test("a sweep that throws synchronously is contained too", async () => {
    service.autoArchiveStaleMessageQueues.mockImplementation(() => {
      throw new Error("sync boom");
    });

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("sync boom"),
    );
  });
});

describe("reporting", () => {
  test("logs one debug line with the count when something was archived", async () => {
    service.autoArchiveStaleMessageQueues.mockResolvedValue(7);

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      "MessageQueue:CleanupStaleResources: auto-archived 7 stale discovered queue(s)",
    );
  });

  test("stays quiet when nothing changed", async () => {
    await runTick();

    expect(mockedLogger.debug).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
    expect(mockedLogger.info).not.toHaveBeenCalled();
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });
});
