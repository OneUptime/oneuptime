import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Google SecOps poll job is SCHEDULED AT ALL, and it is scheduled the way
 * the connector needs.
 *
 * The customer whose connector never polled diagnosed it as "OneUptime's
 * background worker isn't executing the Google SecOps poll job". That half of
 * their report was never wrong in principle - it just was not the whole story
 * (the actual outage was an unguarded lastError write that threw out of the
 * poll loop, covered by the GoogleSecOpsPoller / ConnectorErrorMessage
 * suites). But nothing in this repo pinned the scheduling half, and the
 * scheduling half is one line: `import "./Jobs/SecurityEvents/
 * PollGoogleSecOpsConnections"` in App/FeatureSet/Workers/Index.ts.
 *
 * That line is load-bearing, not documentation. RunCron registers a job
 * PURELY as a module side effect: importing the job file is what calls
 * JobDictionary.setJobFunction and Queue.addJob. A job file nothing imports is
 * therefore never scheduled AND cannot even be enqueued by name, because the
 * Worker consumer looks the function up in JobDictionary and finds nothing.
 * Deleting that single import reproduces the customer's exact symptom -
 * lastPolledAt stays null forever, lastError stays null forever, no log line
 * anywhere - while every other test in the repo, including every poller test,
 * stays green, because they all import the poller directly.
 *
 * What is pinned here:
 *   1. the job module is imported by App/FeatureSet/Workers/Index.ts (matched
 *      by MODULE PATH, so reformatting the import cannot fake a pass and
 *      moving the job file cannot silently invalidate the check),
 *   2. the registered name is exactly "SecurityEvents:PollGoogleSecOpsConnections"
 *      and the schedule is the EVERY_MINUTE constant itself, not a pasted cron
 *      string that could drift away from it,
 *   3. importing the module really does put a runnable function and a timeout
 *      into JobDictionary - the dictionary the Worker consumer reads,
 *   4. that function delegates to GoogleSecOpsPoller.pollAllDueConnections,
 *      which is the entry point every poller test drives; without this link
 *      those suites prove nothing about production,
 *   5. runOnStartup is false and the timeout is comfortably larger than one
 *      tick, so a slow poll is not killed mid-run.
 *
 * Unlike the sibling suites under Tests/Workers/Jobs, this file does NOT mock
 * FeatureSet/Workers/Utils/Cron. Mocking Cron would only prove that the job
 * file calls a function; the failure being guarded against lives in what
 * RunCron does with those arguments, so the REAL RunCron and the REAL
 * JobDictionary run here and only the queue underneath them is replaced.
 */

// --- Recorders the hoisted jest.mock factories below close over. ------------

/*
 * The queue is the only thing stubbed out under the real RunCron. Left real it
 * would drag in bullmq, which is ESM and unmapped in App's jest config (see
 * Common/Tests/__mocks__/bullmq.js for the same problem solved there), and
 * then reach for Redis. It must RESOLVE, not merely return: RunCron attaches a
 * .catch() to the returned promise, and a non-thenable there would throw
 * inside RunCron's own try/catch and be silently logged instead of surfacing.
 */
const mockAddJob: jest.Mock = jest.fn().mockResolvedValue(undefined);

/*
 * The poller itself is stubbed so importing the job file does not pull the
 * whole security-event ingestion graph in, and so the delegation in test 4 is
 * observable rather than inferred.
 */
const mockPollAllDueConnections: jest.Mock = jest.fn();

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
  "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller",
  () => {
    return {
      __esModule: true,
      default: {
        pollAllDueConnections: mockPollAllDueConnections,
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
 * Imported AFTER the mocks and after the `mock*` bindings they close over:
 * TypeScript emits each require where its import statement sits, so an import
 * hoisted above those consts would run the factories while the consts are
 * still in their temporal dead zone. The job import is last of all - it is the
 * one whose side effect this whole file is about.
 */
import GoogleSecOpsPoller from "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import logger from "Common/Server/Utils/Logger";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/SecurityEvents/PollGoogleSecOpsConnections";

/*
 * Frozen the moment the module graph has settled. Registration happens exactly
 * once, at import time, so these calls can never be re-recorded; copying them
 * out keeps a later mock reset from erasing the only evidence there is.
 */
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const poller: { pollAllDueConnections: jest.Mock } =
  GoogleSecOpsPoller as unknown as { pollAllDueConnections: jest.Mock };

// --- Derived constants. -----------------------------------------------------

const JOB_NAME: string = "SecurityEvents:PollGoogleSecOpsConnections";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

const WORKERS_INDEX_PATH: string = path.join(WORKERS_DIR, "Index.ts");

const JOB_FILE_PATH: string = path.join(
  WORKERS_DIR,
  "Jobs",
  "SecurityEvents",
  "PollGoogleSecOpsConnections.ts",
);

const APP_DIR: string = path.resolve(__dirname, "../..");

const APP_INDEX_PATH: string = path.join(APP_DIR, "Index.ts");

/*
 * The specifier Index.ts must contain, COMPUTED from where the job file
 * actually is rather than pasted. Move the job file and this recomputes, so
 * the assertion below fails for the right reason (the index still points at
 * the old path) instead of passing on a stale literal.
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

/*
 * One tick of this job's schedule, in milliseconds, derived rather than
 * asserted: a five-field cron has MINUTE granularity, so the fastest such
 * expression can fire is once a minute. The field-shape assertion in the
 * schedule test is what licenses this - if EVERY_MINUTE ever became a
 * six-field, second-granularity expression (the shape EVERY_TEN_SECONDS and
 * friends use), that test fails first and this number is never quietly wrong.
 */
const TICK_INTERVAL_IN_MS: number =
  OneUptimeDate.convertMinutesToMilliseconds(1);

/*
 * JobDictionary hands out a default timeout for names it was never told about.
 * Read it from JobDictionary itself, under a name nothing registers, so the
 * "a timeout was actually registered" assertion compares against the real
 * fallback instead of a literal that a change to JobDictionary would silently
 * invalidate.
 */
const UNREGISTERED_JOB_NAME: string =
  "SecurityEvents:PollGoogleSecOpsConnections:NotARealJob";

const DEFAULT_JOB_TIMEOUT_IN_MS: number = JobDictionary.getTimeoutInMs(
  UNREGISTERED_JOB_NAME,
);

beforeEach(() => {
  /*
   * Only the poller is reset. mockAddJob deliberately is NOT: its calls were
   * all made at import time and are already snapshotted above.
   */
  poller.pollAllDueConnections.mockReset();
  poller.pollAllDueConnections.mockResolvedValue(undefined);
});

describe("PollGoogleSecOpsConnections - the job is wired into the worker at all", () => {
  test("App/FeatureSet/Workers/Index.ts imports the job module, without which it never runs", () => {
    /*
     * The single line whose deletion reproduces the customer's outage. Every
     * other test in this file imports the job module directly, so every other
     * test would still pass with this import missing; reading the index as
     * TEXT is the only assertion here that can fail for the right reason.
     */
    expect(fs.existsSync(JOB_FILE_PATH)).toBe(true);

    const specifier: string = moduleSpecifierFor(WORKERS_DIR, JOB_FILE_PATH);

    expect(specifier).toBe("./Jobs/SecurityEvents/PollGoogleSecOpsConnections");

    const indexSource: string = readSource(WORKERS_INDEX_PATH);

    /*
     * Matched as a top-level side-effect import statement with tolerant
     * whitespace and either quote style, so prettier reflowing the file cannot
     * break the test and a mention inside a comment cannot fake a pass.
     */
    const sideEffectImport: RegExp = new RegExp(
      `^\\s*import\\s+["']${escapeForRegExp(specifier)}["']\\s*;?\\s*$`,
      "m",
    );

    expect(indexSource).toMatch(sideEffectImport);
  });

  test("the import is unconditional, so DISABLE_QUEUE_WORKERS cannot skip the scheduling", () => {
    /*
     * The other half of the customer's report. The docs' troubleshooting
     * advice leans on this split, so pin what the code actually does:
     * DisableQueueWorkers gates ONLY the queue CONSUMER
     * (QueueWorker.getWorker), inside WorkersFeatureSet.init. The job imports
     * are top-level ES imports that run on module load, in both the "api" and
     * "worker" roles, so an api-role process still writes the repeatable job
     * definition and still populates JobDictionary. A connector that never
     * polls is therefore never explained by DISABLE_QUEUE_WORKERS on its own -
     * only by nothing DRAINING the queue.
     */
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

    // The flag is read exactly once, so there is no second, hidden gate.
    expect(
      indexSource.match(/if\s*\(\s*DisableQueueWorkers\s*\)/g),
    ).toHaveLength(1);
  });

  test("App/Index.ts loads the workers feature set in every role", () => {
    /*
     * Workers/Index.ts only schedules anything if something imports IT. App's
     * single entrypoint does so unconditionally and calls init() with no role
     * gate - which is what makes the previous test's claim true end to end.
     */
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

    // No role flag anywhere near it: the api role loads the workers too.
    expect(appIndexSource).not.toContain("DisableQueueWorkers");
  });
});

describe("PollGoogleSecOpsConnections - registration", () => {
  test("registering the job logged no error, so nothing was silently swallowed", () => {
    /*
     * RunCron wraps its whole body in try/catch and only logs. A registration
     * that threw would leave the job unscheduled and look identical from the
     * outside, so check the swallow path stayed cold before trusting anything
     * else below.
     */
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  test("puts a runnable function in JobDictionary under the exact job name", () => {
    /*
     * JobDictionary is the dictionary the Worker consumer reads: it takes the
     * name off the queue job and looks the function up here. A mismatch
     * between the registered name and the enqueued name means the consumer
     * throws BadDataException on every tick, so the exact string matters.
     */
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    expect(typeof jobFunction).toBe("function");
  });

  test("schedules the job once, on EVERY_MINUTE, under that same name", () => {
    /*
     * The schedule is compared against the CronTime constant the job imports,
     * never against a pasted "* * * * *": if EVERY_MINUTE is ever retimed, the
     * job follows it and this test follows both.
     */
    expect(registrationAddJobCalls).toHaveLength(1);

    const call: Array<unknown> = registrationAddJobCalls[0]!;

    // Queue.addJob(queueName, jobId, jobName, data, options)
    expect(call[0]).toBe("Worker");
    expect(call[2]).toBe(JOB_NAME);
    expect(call[4]).toEqual({ scheduleAt: EVERY_MINUTE });

    /*
     * Licenses TICK_INTERVAL_IN_MS above: five fields, all wildcards, i.e. the
     * fastest a minute-granularity cron can fire. A six-field (second
     * granularity) expression would fail here rather than quietly making the
     * timeout comparison below compare against the wrong interval.
     */
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
     * runOnStartup: true makes RunCron issue a SECOND, unscheduled addJob so
     * the job fires on every boot. For this job that would mean every deploy,
     * crash-loop and scale-up kicking off a fresh full poll of every due
     * connection, on top of whatever the minute schedule already started - a
     * self-inflicted thundering herd against the Chronicle API, which rate
     * limits. Exactly one call, and it scheduled rather than fired.
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

    /*
     * Proves a timeout was REGISTERED rather than defaulted: JobDictionary
     * returns its own fallback for unknown names, so an equal value would be
     * indistinguishable from the job never calling setTimeoutInMs at all.
     */
    expect(DEFAULT_JOB_TIMEOUT_IN_MS).toBeGreaterThan(0);
    expect(timeoutInMs).not.toBe(DEFAULT_JOB_TIMEOUT_IN_MS);
    expect(timeoutInMs).toBeGreaterThan(DEFAULT_JOB_TIMEOUT_IN_MS);

    /*
     * The relationship, not the literal. One tick polls EVERY due connection,
     * and each connection costs a Google token exchange plus one or more
     * Chronicle HTTP round trips plus a telemetry-store write, so a busy
     * instance's tick is minutes long, not seconds. A timeout at or below the
     * tick interval would have QueueWorker kill the run mid-poll - and since
     * per-connection cursors only advance on success, the same slow connection
     * would be retried and killed forever while the ones behind it in the loop
     * never got reached. Several ticks of headroom is what keeps that from
     * being possible.
     */
    expect(timeoutInMs).toBeGreaterThan(TICK_INTERVAL_IN_MS);
    expect(timeoutInMs / TICK_INTERVAL_IN_MS).toBeGreaterThanOrEqual(5);
  });
});

describe("PollGoogleSecOpsConnections - what the registered function does", () => {
  test("delegates to GoogleSecOpsPoller.pollAllDueConnections", async () => {
    /*
     * The link that makes the poller suites mean something for production.
     * Every GoogleSecOpsPoller test drives pollAllDueConnections directly; if
     * the cron handler called anything else, all of that coverage would be
     * describing code the worker never reaches.
     */
    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    await jobFunction();

    expect(poller.pollAllDueConnections).toHaveBeenCalledTimes(1);

    // The poller owns its own query for due connections; the job passes nothing.
    expect(poller.pollAllDueConnections.mock.calls[0]).toEqual([]);
  });

  test("awaits the poll, so a failed tick is a failed job rather than a silent one", async () => {
    /*
     * If the handler fired the poll off without awaiting it, it would resolve
     * immediately and BullMQ would record a successful tick no matter what
     * happened afterwards - the rejection would surface only as an
     * unhandled promise rejection, in a process where nothing is watching for
     * one. Pinning that the rejection propagates keeps a broken poll visible.
     */
    const failure: Error = new Error("poll failed");

    poller.pollAllDueConnections.mockRejectedValue(failure);

    const jobFunction: PromiseVoidFunction =
      JobDictionary.getJobFunction(JOB_NAME);

    await expect(jobFunction()).rejects.toThrow(failure);
  });
});
