/*
 * ---------------------------------------------------------------------------
 * How long a command the code agent composes may run, and how its run is
 * kept alive while it does (Utils/AgentCommandLimits).
 *
 * A command gets two minutes unless the model asks for more, up to ten - a
 * slow install, build or test suite needs it, a hung dev server must not
 * take ten - or up to the project's own Time Limit per Command (issue
 * #6532), at most two hours. It never runs past the time its task has left,
 * nor past the run's own time limit. While it runs,
 * the run is reported alive every two minutes, well inside the server's
 * 12-minute stale-run sweeper, so a long command is never failed underneath
 * the Runner that is still running it.
 * ---------------------------------------------------------------------------
 */

import {
  AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS,
  AGENT_COMMAND_TIMEOUT_ARGUMENT,
  CEILING_AGENT_COMMAND_TIMEOUT_SECONDS,
  DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS,
  MAX_AGENT_COMMAND_TIMEOUT_SECONDS,
  MIN_AGENT_COMMAND_TIMEOUT_SECONDS,
  describeAgentCommandTimedOut,
  describeAgentCommandTimeout,
  getAgentCommandMaxSeconds,
  getAgentCommandTimeoutMs,
  getDefaultAgentCommandTimeoutSeconds,
  getRequestedAgentCommandTimeoutSeconds,
  startAgentCommandKeepAlive,
} from "../../Utils/AgentCommandLimits";
import {
  DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
  MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES,
} from "Common/Types/AI/AIAgentRunLimits";
import fs from "fs";
import path from "path";

// The server's stale-run sweeper fails a run quiet for this long.
const SWEEPER_MINUTES: number = 12;

describe("the limits themselves", () => {
  test("two minutes by default, ten at most unless the project says, two hours at the very most, a second at least", () => {
    expect(DEFAULT_AGENT_COMMAND_TIMEOUT_SECONDS).toBe(120);
    expect(MAX_AGENT_COMMAND_TIMEOUT_SECONDS).toBe(600);
    expect(CEILING_AGENT_COMMAND_TIMEOUT_SECONDS).toBe(7200);
    expect(MIN_AGENT_COMMAND_TIMEOUT_SECONDS).toBe(1);
    expect(AGENT_COMMAND_TIMEOUT_ARGUMENT).toBe("timeout_seconds");
  });

  test("they are the project setting's default and ceiling, in seconds", () => {
    expect(MAX_AGENT_COMMAND_TIMEOUT_SECONDS).toBe(
      DEFAULT_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES * 60,
    );
    expect(CEILING_AGENT_COMMAND_TIMEOUT_SECONDS).toBe(
      MAX_AI_RUN_COMMAND_TIME_LIMIT_IN_MINUTES * 60,
    );
  });

  /*
   * The point of the keep-alive: a command that runs its full ten minutes
   * is reported alive several times before the sweeper could fail its run,
   * even when one report is lost on the way.
   */
  test("the keep-alive beats well inside the stale-run sweeper's window", () => {
    expect(AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS).toBe(2 * 60 * 1000);
    expect(AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS * 2).toBeLessThan(
      SWEEPER_MINUTES * 60 * 1000,
    );
    expect(
      Math.floor(
        (MAX_AGENT_COMMAND_TIMEOUT_SECONDS * 1000) /
          AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS,
      ),
    ).toBeGreaterThanOrEqual(4);
  });

  /*
   * The sweeper's window is read off its own source, so a change to it
   * that leaves the keep-alive too slow fails here.
   */
  test("the sweeper's window is the one these limits are sized for", () => {
    const sweeper: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Workers",
        "Jobs",
        "AIChat",
        "TimeoutStuckRuns.ts",
      ),
      "utf-8",
    );

    expect(sweeper).toContain(
      `const RUN_HEARTBEAT_TIMEOUT_MINUTES: number = ${SWEEPER_MINUTES};`,
    );
  });
});

describe("the time limit the model asked for", () => {
  test.each([
    [undefined, 120],
    [null, 120],
    ["", 120],
    ["   ", 120],
    ["soon", 120],
    [{}, 120],
    [[], 120],
    [true, 120],
    [0, 120],
    [-30, 120],
    [Number.NaN, 120],
    [Number.POSITIVE_INFINITY, 120],
  ])(
    "%p asks for nothing: two minutes",
    (requested: unknown, seconds: number) => {
      expect(getRequestedAgentCommandTimeoutSeconds(requested)).toBe(seconds);
    },
  );

  test.each([
    [1, 1],
    [30, 30],
    [120, 120],
    [300, 300],
    [599, 599],
    [600, 600],
  ])("%p seconds is given as asked", (requested: number, seconds: number) => {
    expect(getRequestedAgentCommandTimeoutSeconds(requested)).toBe(seconds);
  });

  test.each([
    [601, 600],
    [3600, 600],
    [86400, 600],
    [Number.MAX_SAFE_INTEGER, 600],
  ])(
    "%p seconds is held to ten minutes",
    (requested: number, seconds: number) => {
      expect(getRequestedAgentCommandTimeoutSeconds(requested)).toBe(seconds);
    },
  );

  test("a fraction of a second is a second; a fraction is cut to whole seconds", () => {
    expect(getRequestedAgentCommandTimeoutSeconds(0.25)).toBe(1);
    expect(getRequestedAgentCommandTimeoutSeconds(299.9)).toBe(299);
  });

  test("a number written as text is read as that number", () => {
    expect(getRequestedAgentCommandTimeoutSeconds("300")).toBe(300);
    expect(getRequestedAgentCommandTimeoutSeconds(" 45 ")).toBe(45);
    expect(getRequestedAgentCommandTimeoutSeconds("9000")).toBe(600);
    expect(getRequestedAgentCommandTimeoutSeconds("300s")).toBe(120);
  });
});

describe("how long a command may run", () => {
  test("what the model asked for, in milliseconds, when the task has no deadline", () => {
    expect(getAgentCommandTimeoutMs({ requested: undefined })).toBe(120_000);
    expect(getAgentCommandTimeoutMs({ requested: 480 })).toBe(480_000);
    expect(getAgentCommandTimeoutMs({ requested: 5000 })).toBe(600_000);
  });

  test("never past the time the task has left", () => {
    expect(
      getAgentCommandTimeoutMs({ requested: 600, remainingMs: 90_500 }),
    ).toBe(90_500);
    expect(
      getAgentCommandTimeoutMs({ requested: undefined, remainingMs: 30_000 }),
    ).toBe(30_000);
  });

  test("the task's time left does not lengthen a command", () => {
    expect(
      getAgentCommandTimeoutMs({
        requested: undefined,
        remainingMs: 25 * 60 * 1000,
      }),
    ).toBe(120_000);
  });

  test("a command asked for at the very end still gets a second", () => {
    expect(getAgentCommandTimeoutMs({ requested: 300, remainingMs: 10 })).toBe(
      1000,
    );
    expect(
      getAgentCommandTimeoutMs({ requested: 300, remainingMs: -5000 }),
    ).toBe(1000);
  });

  test("a deadline that is not a number is not one", () => {
    expect(
      getAgentCommandTimeoutMs({ requested: 300, remainingMs: Number.NaN }),
    ).toBe(300_000);
  });
});

/*
 * THE CUSTOMER'S CASE (issue #6532): a repository whose test suite takes 25
 * minutes could never be checked - every command was stopped at ten. A
 * project's Time Limit per Command lets one run longer, up to two hours,
 * and never past the run's own time limit.
 */
describe("the most a command may be given: the project's Time Limit per Command", () => {
  test("no setting: ten minutes, as it is today", () => {
    expect(getAgentCommandMaxSeconds({})).toBe(600);
    expect(getAgentCommandMaxSeconds({ commandTimeLimitInMinutes: null })).toBe(
      600,
    );
    expect(
      getAgentCommandMaxSeconds({ commandTimeLimitInMinutes: undefined }),
    ).toBe(600);
  });

  test("a 30-minute setting: a command that asks for 25 minutes runs for 25, and one that asks for 40 is held to 30", () => {
    const maxSeconds: number = getAgentCommandMaxSeconds({
      commandTimeLimitInMinutes: 30,
    });

    expect(maxSeconds).toBe(1800);
    expect(getAgentCommandTimeoutMs({ requested: 25 * 60, maxSeconds })).toBe(
      25 * 60 * 1000,
    );
    expect(getAgentCommandTimeoutMs({ requested: 40 * 60, maxSeconds })).toBe(
      30 * 60 * 1000,
    );
    // Asking for nothing still gets two minutes: the setting is a most, not a default.
    expect(getAgentCommandTimeoutMs({ requested: undefined, maxSeconds })).toBe(
      120_000,
    );
  });

  test("never past the ceiling, whatever the server sends", () => {
    expect(getAgentCommandMaxSeconds({ commandTimeLimitInMinutes: 120 })).toBe(
      7200,
    );
    expect(
      getAgentCommandMaxSeconds({ commandTimeLimitInMinutes: 100_000 }),
    ).toBe(7200);
  });

  test("a setting that is not one is the default", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        getAgentCommandMaxSeconds({ commandTimeLimitInMinutes: value }),
      ).toBe(600);
    }
  });

  test("never past the run's own time limit, or a step's", () => {
    // A run of 20 minutes: a 60-minute setting gives a command 20 at most.
    expect(
      getAgentCommandMaxSeconds({
        commandTimeLimitInMinutes: 60,
        atMostMs: 20 * 60 * 1000,
      }),
    ).toBe(1200);
    // A run that has more time than the setting keeps the setting.
    expect(
      getAgentCommandMaxSeconds({
        commandTimeLimitInMinutes: 30,
        atMostMs: 120 * 60 * 1000,
      }),
    ).toBe(1800);
    // A time that is not one is not a limit.
    expect(
      getAgentCommandMaxSeconds({
        commandTimeLimitInMinutes: 30,
        atMostMs: Number.NaN,
      }),
    ).toBe(1800);
  });

  test("a project that shortened commands to a minute: a command that asks for nothing gets that minute", () => {
    const maxSeconds: number = getAgentCommandMaxSeconds({
      commandTimeLimitInMinutes: 1,
    });

    expect(maxSeconds).toBe(60);
    expect(getDefaultAgentCommandTimeoutSeconds(maxSeconds)).toBe(60);
    expect(getRequestedAgentCommandTimeoutSeconds(undefined, maxSeconds)).toBe(
      60,
    );
    expect(getRequestedAgentCommandTimeoutSeconds(600, maxSeconds)).toBe(60);
  });

  test("a command never runs past the task's time, whatever the setting", () => {
    expect(
      getAgentCommandTimeoutMs({
        requested: 100 * 60,
        maxSeconds: getAgentCommandMaxSeconds({
          commandTimeLimitInMinutes: 120,
        }),
        remainingMs: 7 * 60 * 1000,
      }),
    ).toBe(7 * 60 * 1000);
  });
});

describe("what the model is told", () => {
  test.each([
    [120_000, "2 minutes"],
    [60_000, "1 minute"],
    [600_000, "10 minutes"],
    [90_000, "90 seconds"],
    [1000, "1 second"],
    [45_400, "45 seconds"],
  ])("%p ms reads %p", (timeoutMs: number, words: string) => {
    expect(describeAgentCommandTimeout(timeoutMs)).toBe(words);
  });

  test("a command that ran out of time below the most it may get says how to ask for more", () => {
    expect(describeAgentCommandTimedOut({ timeoutMs: 120_000 })).toBe(
      "Command timed out after 2 minutes. If it needs longer, such as a slow install, build or test suite, run it again with timeout_seconds (at most 600).",
    );
  });

  test("the most it may ask for is the project's, when the project set one", () => {
    expect(
      describeAgentCommandTimedOut({ timeoutMs: 600_000, maxSeconds: 1800 }),
    ).toBe(
      "Command timed out after 10 minutes. If it needs longer, such as a slow install, build or test suite, run it again with timeout_seconds (at most 1800).",
    );
  });

  test("one that had all ten minutes is told to run a part of it, and of the setting that gives it longer", () => {
    expect(describeAgentCommandTimedOut({ timeoutMs: 600_000 })).toBe(
      "Command timed out after 10 minutes, the longest a command may run here. Run a smaller part of it, such as one test file or one package. If the whole of it must run, say so in your summary: the project's Time Limit per Command (Project Settings → AI → AI Features → More settings → Limits per run) lets a command run for up to 120 minutes.",
    );
  });

  test("one that had all of the project's 30 minutes is told the same", () => {
    expect(
      describeAgentCommandTimedOut({ timeoutMs: 1_800_000, maxSeconds: 1800 }),
    ).toContain(
      "Command timed out after 30 minutes, the longest a command may run here.",
    );
  });

  test("one that had the ceiling's two hours names no setting: none gives longer", () => {
    expect(
      describeAgentCommandTimedOut({ timeoutMs: 7_200_000, maxSeconds: 7200 }),
    ).toBe(
      "Command timed out after 120 minutes, the longest a command may run here. Run a smaller part of it, such as one test file or one package.",
    );
  });

  test("one given less than it asked for, at the task's end, is told that was all the time left", () => {
    expect(
      describeAgentCommandTimedOut({
        timeoutMs: 90_000,
        maxSeconds: 1800,
        heldToTimeLeft: true,
      }),
    ).toBe(
      "Command timed out after 90 seconds: that was all the time this task had left.",
    );
  });
});

/*
 * Jest 28 takes a config object; the installed @types/jest (27) only knows
 * the old "modern" | "legacy" argument, hence the cast. Node makes
 * globalThis.performance read-only, so it is not faked (as the Runner's job
 * suites do).
 */
function useFakeTimers(): void {
  (
    jest.useFakeTimers as unknown as (config: {
      doNotFake: Array<string>;
    }) => void
  )({ doNotFake: ["nextTick", "setImmediate", "performance"] });
}

describe("the keep-alive", () => {
  beforeEach(() => {
    useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("beats once an interval until it is stopped, and never after", async () => {
    const beat: jest.Mock = jest.fn().mockResolvedValue(undefined);

    const stop: () => void = startAgentCommandKeepAlive({ beat });

    // Nothing before the first interval: a short command reports nothing.
    jest.advanceTimersByTime(AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS - 1);
    expect(beat).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(beat).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS * 3);
    expect(beat).toHaveBeenCalledTimes(4);

    stop();

    jest.advanceTimersByTime(AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS * 10);
    expect(beat).toHaveBeenCalledTimes(4);
  });

  test("a ten-minute command is reported alive five times", () => {
    const beat: jest.Mock = jest.fn().mockResolvedValue(undefined);

    const stop: () => void = startAgentCommandKeepAlive({ beat });
    jest.advanceTimersByTime(MAX_AGENT_COMMAND_TIMEOUT_SECONDS * 1000);
    stop();

    expect(beat).toHaveBeenCalledTimes(5);
  });

  test("takes the interval it is given", () => {
    const beat: jest.Mock = jest.fn().mockResolvedValue(undefined);

    const stop: () => void = startAgentCommandKeepAlive({
      intervalMs: 1000,
      beat,
    });
    jest.advanceTimersByTime(3500);
    stop();

    expect(beat).toHaveBeenCalledTimes(3);
  });

  test("a beat that fails, or throws, is dropped and the next one still beats", async () => {
    let calls: number = 0;
    const beat: () => Promise<void> = (): Promise<void> => {
      calls++;

      if (calls === 1) {
        throw new Error("not even a promise");
      }

      if (calls === 2) {
        return Promise.reject(new Error("server unreachable"));
      }

      return Promise.resolve();
    };

    const stop: () => void = startAgentCommandKeepAlive({ beat });

    jest.advanceTimersByTime(AGENT_COMMAND_KEEP_ALIVE_INTERVAL_MS * 3);
    // Let the rejected beat's handler run: an unhandled rejection fails jest.
    await Promise.resolve();
    stop();

    expect(calls).toBe(3);
  });
});
