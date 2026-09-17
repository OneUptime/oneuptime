import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import cron from "node-cron";
import logger from "../../../Server/Utils/Logger";
import BasicCron from "../../../Server/Utils/BasicCron";

/*
 * The wrapper every scheduled job in the app is registered through.
 *
 * Its job is not scheduling — node-cron does that — it is making sure one bad
 * run cannot end the schedule. A cron callback that throws takes its timer
 * with it, so a job that failed once at 03:00 would simply never run again,
 * and nothing would say so: the next morning looks exactly like a night with
 * nothing to do. That is why the tick is wrapped, and it is the behaviour
 * worth pinning here.
 *
 * The startup run is deliberately NOT inside that guard, and the asymmetry is
 * the interesting part of this module — see the last block.
 */

jest.mock("node-cron", () => {
  return { __esModule: true, default: { schedule: jest.fn() } };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

const mockedCron: { schedule: jest.Mock } = cron as unknown as {
  schedule: jest.Mock;
};

const mockedLogger: { debug: jest.Mock; error: jest.Mock } =
  logger as unknown as { debug: jest.Mock; error: jest.Mock };

const EVERY_FIVE_MINUTES: string = "*/5 * * * *";

/*
 * The run function BasicCron is handed. jest.Mock's first type parameter is
 * the RETURN type, so this is "a mock taking no arguments and answering with
 * a promise" - named once here rather than restated at every call site.
 */
type RunMock = jest.Mock<Promise<void>, []>;

function succeedingRun(): RunMock {
  const mock: RunMock = jest.fn() as unknown as RunMock;
  mock.mockImplementation((): Promise<void> => {
    return Promise.resolve();
  });
  return mock;
}

function failingRun(message: string): RunMock {
  const mock: RunMock = jest.fn() as unknown as RunMock;
  mock.mockImplementation((): Promise<void> => {
    return Promise.reject(new Error(message));
  });
  return mock;
}

/*
 * BasicCron is declared as returning void but its implementation is async, so
 * every call site here goes through this. That mismatch is not incidental
 * tidying - it is the reason a startup failure reaches callers as an
 * unhandled rejection rather than a thrown error, which the last test covers.
 */
function startCron(data: {
  jobName: string;
  schedule: string;
  runOnStartup: boolean;
  runFunction: RunMock;
}): Promise<void> {
  return BasicCron({
    jobName: data.jobName,
    options: {
      schedule: data.schedule,
      runOnStartup: data.runOnStartup,
    },
    runFunction: data.runFunction as never,
  }) as unknown as Promise<void>;
}

/*
 * The callback node-cron was handed. Invoking it is what "the schedule fired"
 * means, without waiting five real minutes for it.
 */
function scheduledTick(): () => Promise<void> {
  return mockedCron.schedule.mock.calls[0]![1] as () => Promise<void>;
}

describe("BasicCron", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("registration", () => {
    test("registers the job on the schedule it was given", async () => {
      const run: RunMock = succeedingRun();

      await startCron({
        jobName: "TestJob",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: false,
        runFunction: run,
      });

      expect(mockedCron.schedule).toHaveBeenCalledTimes(1);
      expect(mockedCron.schedule.mock.calls[0]![0]).toBe(EVERY_FIVE_MINUTES);
    });

    /*
     * Registering must not run the job. A job that ran once per process start
     * would fire on every rolling restart and every replica.
     */
    test("registering alone does not run the job", async () => {
      const run: RunMock = succeedingRun();

      await startCron({
        jobName: "TestJob",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: false,
        runFunction: run,
      });

      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("a scheduled run", () => {
    test("runs the job when the schedule fires", async () => {
      const run: RunMock = succeedingRun();

      await startCron({
        jobName: "TestJob",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: false,
        runFunction: run,
      });

      await scheduledTick()();

      expect(run).toHaveBeenCalledTimes(1);
    });

    /*
     * The whole point of the wrapper. An unhandled throw inside a node-cron
     * callback ends that timer, so the job silently stops running for the
     * lifetime of the process - and a job that never runs looks identical to
     * a job with nothing to do.
     */
    test("a throwing run is swallowed, so the schedule survives it", async () => {
      const run: RunMock = failingRun("job blew up");

      await startCron({
        jobName: "TestJob",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: false,
        runFunction: run,
      });

      await expect(scheduledTick()()).resolves.toBeUndefined();
      expect(mockedLogger.error).toHaveBeenCalled();
    });

    test("a failed run does not stop later runs from firing", async () => {
      const run: RunMock = succeedingRun();
      run.mockImplementationOnce((): Promise<void> => {
        return Promise.reject(new Error("first run blew up"));
      });

      await startCron({
        jobName: "TestJob",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: false,
        runFunction: run,
      });

      await scheduledTick()();
      await scheduledTick()();

      expect(run).toHaveBeenCalledTimes(2);
    });

    /*
     * The job's name is what makes a line in the log attributable to one of
     * many scheduled jobs. Logged without it, a failure says only that
     * something somewhere failed.
     */
    test("the job's name is in what it logs", async () => {
      const run: RunMock = succeedingRun();

      await startCron({
        jobName: "DistinctiveJobName",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: false,
        runFunction: run,
      });

      await scheduledTick()();

      const logged: string = mockedLogger.debug.mock.calls
        .map((callArgs: Array<unknown>): string => {
          return String(callArgs[0]);
        })
        .join("\n");

      expect(logged).toContain("DistinctiveJobName");
    });
  });

  describe("the startup run", () => {
    test("runs the job immediately when asked to", async () => {
      const run: RunMock = succeedingRun();

      await startCron({
        jobName: "TestJob",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: true,
        runFunction: run,
      });

      expect(run).toHaveBeenCalledTimes(1);
    });

    /*
     * The startup run is in addition to the schedule, not instead of it - a
     * job that ran once at boot and was never registered would go quiet after
     * the first tick.
     */
    test("it still registers the recurring schedule", async () => {
      const run: RunMock = succeedingRun();

      await startCron({
        jobName: "TestJob",
        schedule: EVERY_FIVE_MINUTES,
        runOnStartup: true,
        runFunction: run,
      });

      expect(mockedCron.schedule).toHaveBeenCalledTimes(1);

      await scheduledTick()();

      expect(run).toHaveBeenCalledTimes(2);
    });

    /*
     * DELIBERATE ASYMMETRY, pinned so a later reader does not "fix" it by
     * reflex: unlike a scheduled tick, a startup failure is NOT swallowed. It
     * rejects out of BasicCron.
     *
     * That is the right way round. A scheduled run fails against a live
     * system and the next tick is a genuine retry, so surviving it is what
     * keeps the job alive. A startup run fails against a process that is
     * still coming up - usually because configuration or a dependency is
     * wrong - and a boot that swallowed that would come up looking healthy
     * with a job that never worked.
     *
     * Note the callers' side of this: BasicCronFunction is typed as returning
     * void, so a caller that does not await gets an unhandled rejection
     * rather than a thrown error. Loud either way, which is the intent.
     */
    test("a startup failure propagates rather than being swallowed", async () => {
      const run: RunMock = failingRun("bad configuration at boot");

      await expect(
        startCron({
          jobName: "TestJob",
          schedule: EVERY_FIVE_MINUTES,
          runOnStartup: true,
          runFunction: run,
        }),
      ).rejects.toThrow("bad configuration at boot");
    });
  });
});
