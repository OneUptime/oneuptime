import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Security Event Connections poll job is SCHEDULED AT ALL, and it is
 * scheduled the way the framework needs.
 *
 * Mirrors PollGoogleSecOpsConnectionsJob.test.ts: RunCron registers a job
 * purely as a module side effect, so the single line
 * `import "./Jobs/SecurityEvents/PollSecurityEventConnections"` in
 * App/FeatureSet/Workers/Index.ts is what makes every managed connector in
 * this framework poll. Delete it and every connection sits at
 * lastPolledAt = null forever while every poller test stays green. So the
 * index is read as text, the real RunCron and the real JobDictionary run,
 * and only the queue underneath them is replaced.
 */

const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined);
const mockEnqueueDueConnections: jest.Mock = jest.fn();

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    /*
     * Mirrors the real QueueName enum members. Cron.ts reads
     * `options.queueName || QueueName.Worker`, so an undefined member here
     * would throw inside RunCron's swallow-everything catch and turn a broken
     * registration into a silent one - exactly the failure mode under test.
     */
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: {
      addJob: mockAddJob,
    },
  };
});

jest.mock(
  "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor",
  () => {
    return {
      __esModule: true,
      default: {
        enqueueDueConnections: mockEnqueueDueConnections,
      },
    };
  },
);

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

/*
 * Imported AFTER the mocks and after the `mock*` bindings they close over;
 * the job import is last of all - it is the one whose side effect this whole
 * file is about.
 */
import SecurityEventConnectionRunExecutor from "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/SecurityEvents/PollSecurityEventConnections";

/*
 * Frozen the moment the module graph has settled. Registration happens
 * exactly once, at import time, so these calls can never be re-recorded.
 */
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const executor: { enqueueDueConnections: jest.Mock } =
  SecurityEventConnectionRunExecutor as unknown as {
    enqueueDueConnections: jest.Mock;
  };

const JOB_NAME: string = "SecurityEvents:PollSecurityEventConnections";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");

const JOB_FILE_PATH: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "SecurityEvents",
  "PollSecurityEventConnections.ts",
);

const RUN_JOB_FILE_PATH: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "SecurityEvents",
  "RunSecurityEventConnection.ts",
);

const APP_DIR: string = path.resolve(__dirname, "../..");

const APP_INDEX_PATH: string = path.join(APP_DIR, "Index.ts");

/*
 * The specifier Index.ts must contain, COMPUTED from where the job file
 * actually is rather than pasted, so moving the file fails the assertion
 * for the right reason.
 */
function moduleSpecifierFor(fromDir: string, filePath: string): string {
  const relative: string = path
    .relative(fromDir, filePath)
    .split(path.sep)
    .join("/")
    .replace(/\.tsx?$/, "");

  return relative.startsWith(".") ? relative : "./" + relative;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, { encoding: "utf-8" });
}

function sideEffectImportOf(specifier: string): RegExp {
  /*
   * A top-level side-effect import with tolerant whitespace and either quote
   * style, so prettier cannot break the test and a comment cannot fake it.
   */
  return new RegExp(
    `^\\s*import\\s+["']${escapeForRegExp(specifier)}["']\\s*;?\\s*$`,
    "m",
  );
}

/*
 * One tick of this job's schedule, derived rather than asserted: a
 * five-field cron has minute granularity (the schedule test pins the shape).
 */
const TICK_INTERVAL_IN_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(1);

/*
 * JobDictionary's fallback timeout, read under a name nothing registers, so
 * "a timeout was actually registered" compares against the real default.
 */
const UNREGISTERED_JOB_NAME: string =
  "SecurityEvents:PollSecurityEventConnections:NotARealJob";

const DEFAULT_JOB_TIMEOUT_IN_MS: number = JobDictionary.getTimeoutInMs(
  UNREGISTERED_JOB_NAME,
);

beforeEach(() => {
  executor.enqueueDueConnections.mockReset();
  executor.enqueueDueConnections.mockResolvedValue(undefined);
});

describe("PollSecurityEventConnections - the job is wired into the worker at all", () => {
  test("App/FeatureSet/Workers/Index.ts imports the poll job module, without which it never runs", () => {
    expect(fs.existsSync(JOB_FILE_PATH)).toBe(true);

    const specifier: string = moduleSpecifierFor(WORKERS_DIR, JOB_FILE_PATH);

    expect(specifier).toBe(
      "./Jobs/SecurityEvents/PollSecurityEventConnections",
    );

    expect(readSource(WORKERS_INDEX_PATH)).toMatch(
      sideEffectImportOf(specifier),
    );
  });

  test("App/FeatureSet/Workers/Index.ts also imports the run job module, or queued runs have no consumer function", () => {
    /*
     * The poll job only ENQUEUES; the run job is what JobDictionary hands
     * the Worker consumer for SecurityEvents:RunSecurityEventConnection.
     * Without this import every scheduled poll is queued, never executed,
     * and expires twenty minutes later blaming worker health.
     */
    expect(fs.existsSync(RUN_JOB_FILE_PATH)).toBe(true);

    const specifier: string = moduleSpecifierFor(
      WORKERS_DIR,
      RUN_JOB_FILE_PATH,
    );

    expect(specifier).toBe("./Jobs/SecurityEvents/RunSecurityEventConnection");

    expect(readSource(WORKERS_INDEX_PATH)).toMatch(
      sideEffectImportOf(specifier),
    );
  });

  test("the import is unconditional, so DISABLE_QUEUE_WORKERS cannot skip the scheduling", () => {
    const indexSource: string = readSource(WORKERS_INDEX_PATH);

    const specifier: string = moduleSpecifierFor(WORKERS_DIR, JOB_FILE_PATH);

    const importIndex: number = indexSource.indexOf(`import "${specifier}"`);

    expect(importIndex).toBeGreaterThan(-1);

    const gate: RegExpMatchArray | null = indexSource.match(
      /if\s*\(\s*DisableQueueWorkers\s*\)/,
    );

    expect(gate).not.toBeNull();

    const gateIndex: number = gate!.index as number;

    // The job import sits above the gate, at module top level, not inside it.
    expect(importIndex).toBeLessThan(gateIndex);

    // And what the gate actually guards is the consumer, nothing else.
    expect(indexSource.slice(gateIndex)).toContain("QueueWorker.getWorker(");

    expect(
      indexSource.match(/if\s*\(\s*DisableQueueWorkers\s*\)/g),
    ).toHaveLength(1);
  });

  test("App/Index.ts loads the workers feature set in every role", () => {
    const appIndexSource: string = readSource(APP_INDEX_PATH);

    const workersIndexSpecifier: string = moduleSpecifierFor(
      APP_DIR,
      WORKERS_INDEX_PATH,
    );

    expect(workersIndexSpecifier).toBe("./FeatureSet/Workers/Index");

    expect(appIndexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+\\w+\\s+from\\s+["']${escapeForRegExp(
          workersIndexSpecifier,
        )}["']\\s*;?\\s*$`,
        "m",
      ),
    );

    expect(appIndexSource).toMatch(/WorkersRoutes\s*\.\s*init\s*\(/);

    expect(appIndexSource).not.toContain("DisableQueueWorkers");
  });
});

describe("PollSecurityEventConnections - registration", () => {
  test("registering the job logged no error, so nothing was silently swallowed", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("puts a runnable function in JobDictionary under the exact job name", () => {
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    expect(typeof jobFunction).toBe("function");
  });

  test("the scheduler id the platform health check looks for is this job name with ':' sanitized", () => {
    /*
     * ConnectorPlatformHealth reports "Poll scheduler: not registered" when
     * neither "SecurityEvents-PollSecurityEventConnections" nor the Google
     * id is among the queue's job schedulers. Queue.sanitizeJobId turns the
     * ":" into "-", so the job name here and the id there must agree.
     */
    expect(JOB_NAME.replace(/:/g, "-")).toBe(
      "SecurityEvents-PollSecurityEventConnections",
    );
  });

  test("schedules the job once, on EVERY_MINUTE, under that same name", () => {
    expect(registrationAddJobCalls).toHaveLength(1);

    const call: Array<unknown> = registrationAddJobCalls[0]!;

    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(call[0]).toBe("Worker");
    expect(call[2]).toBe(JOB_NAME);
    expect(call[4]).toEqual({ scheduleAt: EVERY_MINUTE });

    const fields: Array<string> = EVERY_MINUTE.trim().split(/\s+/);

    expect(fields).toHaveLength(5);
    expect(
      fields.every((field: string) => {
        return field === "*";
      }),
    ).toBe(true);
  });

  test("never runs on startup - one addJob call, and it carries a schedule", () => {
    /*
     * runOnStartup: true would make every deploy, crash-loop and scale-up
     * enqueue a poll for every due connection on top of the minute schedule,
     * against rate-limited vendor APIs.
     */
    expect(registrationAddJobCalls).toHaveLength(1);

    const options: { scheduleAt?: string } = registrationAddJobCalls[0]![4] as {
      scheduleAt?: string;
    };

    expect(options.scheduleAt).toBe(EVERY_MINUTE);
  });

  test("registers a timeout of its own that comfortably outlasts one tick", () => {
    const timeoutInMs: number = JobDictionary.getTimeoutInMs(JOB_NAME);

    expect(Number.isFinite(timeoutInMs)).toBe(true);
    expect(timeoutInMs).toBeGreaterThan(0);

    expect(DEFAULT_JOB_TIMEOUT_IN_MS).toBeGreaterThan(0);
    expect(timeoutInMs).not.toBe(DEFAULT_JOB_TIMEOUT_IN_MS);
    expect(timeoutInMs).toBeGreaterThan(DEFAULT_JOB_TIMEOUT_IN_MS);

    /*
     * One tick sweeps stale runs and enqueues every due connection; the
     * database round trips add up on a busy instance, so several ticks of
     * headroom keep QueueWorker from killing the sweep mid-loop.
     */
    expect(timeoutInMs).toBeGreaterThan(TICK_INTERVAL_IN_MS);
    expect(timeoutInMs / TICK_INTERVAL_IN_MS).toBeGreaterThanOrEqual(5);
  });
});

describe("PollSecurityEventConnections - what the registered function does", () => {
  test("delegates to SecurityEventConnectionRunExecutor.enqueueDueConnections", async () => {
    /*
     * Scheduled work must use the same admission control, run history and
     * worker routing as manual operations; calling the poller directly would
     * omit every scheduled attempt from the diagnostics UI.
     */
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    await jobFunction();

    expect(executor.enqueueDueConnections).toHaveBeenCalledTimes(1);
    expect(executor.enqueueDueConnections.mock.calls[0]).toEqual([]);
  });

  test("awaits the sweep, so a failed tick is a failed job rather than a silent one", async () => {
    const failure: Error = new Error("sweep failed");

    executor.enqueueDueConnections.mockRejectedValue(failure);

    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
