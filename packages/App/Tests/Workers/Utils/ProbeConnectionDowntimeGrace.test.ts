/*
 * ProbeConnectionDowntimeGrace: the fleet-wide grace that keeps the
 * Probe:UpdateConnectionStatus worker from blaming probes for OneUptime's own
 * downtime (issue #2486).
 *
 * Why it exists: a probe is marked Disconnected once its lastAlive is 3
 * minutes stale, and every such flip fans out to owner notifications ("...
 * not being monitored"). OneUptime can only hear from a probe while it is
 * running, though. After a self-hosted upgrade or restart that kept the app
 * down for a few minutes, every probe's lastAlive is already stale, and the
 * first tick after the restart used to run before the probes' next request
 * landed: every probe flipped Disconnected, then Connected a minute later -
 * a message pair per probe for downtime that was the SERVER's, not the
 * probe's. So after a gap in the ticks, no probe is marked Disconnected for
 * one grace period.
 *
 * Why fleet-wide (Redis) and not per process: each tick runs on whichever
 * worker replica picks it up, and KEDA adds replicas under load. A
 * per-process grace restarted on every new replica, so each scale-out held
 * back disconnect detection again even though the fleet had been listening
 * all along. The state now lives in three cache keys:
 *   - "ticked-recently" (120s TTL), refreshed by every tick;
 *   - "disconnect-grace" (TTL = the grace), set by a tick that found
 *     "ticked-recently" gone. While it exists, the answer is false;
 *   - "disconnect-grace-cooldown" (10 minute TTL), set with it. While it
 *     exists no new grace starts, so ticks that keep arriving late cannot
 *     hold the grace on for good.
 *
 * GlobalCache is replaced by an in-memory fake that honours
 * expiresInSeconds against a fake clock the tests move by hand, so the
 * suite can let keys expire without waiting. The fake reads a key as gone
 * once its full TTL has elapsed (set at t with 180s: present at t+179s,
 * gone at t+180s). ProbeConnectionDowntimeGrace itself never reads a clock:
 * expiry is the cache's job, which is what makes it immune to replica
 * clock skew.
 *
 * These tests guard the move from the per-process ProbeConnectionStartupGrace
 * to this fleet-wide grace; none of them can pass against the old class (it
 * had no cache state, took the current time as an argument and answered
 * synchronously). The cooldown tests at the end guard the fix for a grace
 * that late ticks could otherwise hold on forever.
 */

interface MockCacheEntry {
  value: string;
  expiresAtMs: number;
}

interface MockCacheSetOptions {
  expiresInSeconds: number;
}

/*
 * The fake cache's state. Only read inside the fake's functions, which run
 * during the tests, never while the mocked module is being built.
 */
const mockCache: { nowMs: number; entries: Map<string, MockCacheEntry> } = {
  nowMs: 0,
  entries: new Map<string, MockCacheEntry>(),
};

// Mirrors GlobalCache: keys are `${namespace}-${key}`, default TTL 30 days.
function mockFakeGetString(
  namespace: string,
  key: string,
): Promise<string | null> {
  const entry: MockCacheEntry | undefined = mockCache.entries.get(
    `${namespace}-${key}`,
  );

  if (!entry || mockCache.nowMs >= entry.expiresAtMs) {
    return Promise.resolve(null);
  }

  return Promise.resolve(entry.value);
}

function mockFakeSetString(
  namespace: string,
  key: string,
  value: string,
  options?: MockCacheSetOptions,
): Promise<void> {
  const expiresInSeconds: number =
    options?.expiresInSeconds ?? 30 * 24 * 60 * 60;

  mockCache.entries.set(`${namespace}-${key}`, {
    value,
    expiresAtMs: mockCache.nowMs + expiresInSeconds * 1000,
  });

  return Promise.resolve();
}

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: jest.fn(),
      setString: jest.fn(),
    },
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

import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";
import ProbeConnectionDowntimeGrace from "../../../FeatureSet/Workers/Utils/ProbeConnectionDowntimeGrace";

interface GlobalCacheMock {
  getString: jest.Mock;
  setString: jest.Mock;
}

const globalCache: GlobalCacheMock = GlobalCache as unknown as GlobalCacheMock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

/*
 * The cache namespace and key names are pinned on purpose: during a rolling
 * upgrade old and new worker replicas share one Redis, and a renamed key
 * would make the new replicas see "no tick recently" and start a grace in
 * the middle of a healthy fleet.
 */
const CACHE_NAMESPACE: string = "probe-connection-status";
const TICKED_RECENTLY_KEY: string = "ticked-recently";
const DISCONNECT_GRACE_KEY: string = "disconnect-grace";
const GRACE_COOLDOWN_KEY: string = "disconnect-grace-cooldown";

const ONE_MINUTE_IN_SECONDS: number = 60;

// Where the fake clock starts in every test. Any instant will do.
const START_MS: number = Date.UTC(2026, 8, 22, 12, 0, 0);

async function tickAt(
  grace: ProbeConnectionDowntimeGrace,
  secondsAfterStart: number,
): Promise<boolean> {
  mockCache.nowMs = START_MS + secondsAfterStart * 1000;

  return grace.canMarkProbesDisconnected();
}

async function tickAtEach(
  grace: ProbeConnectionDowntimeGrace,
  secondsAfterStart: Array<number>,
): Promise<Array<boolean>> {
  const answers: Array<boolean> = [];

  for (const seconds of secondsAfterStart) {
    answers.push(await tickAt(grace, seconds));
  }

  return answers;
}

// Every minute from `from` to `to` seconds after start, both inclusive.
function everyMinute(from: number, to: number): Array<number> {
  const seconds: Array<number> = [];

  for (let at: number = from; at <= to; at += ONE_MINUTE_IN_SECONDS) {
    seconds.push(at);
  }

  return seconds;
}

/*
 * Seconds until the key expires, read straight from the fake's state, or
 * null if the key is absent or already expired at the current fake time.
 */
function secondsUntilExpiry(key: string): number | null {
  const entry: MockCacheEntry | undefined = mockCache.entries.get(
    `${CACHE_NAMESPACE}-${key}`,
  );

  if (!entry || mockCache.nowMs >= entry.expiresAtMs) {
    return null;
  }

  return (entry.expiresAtMs - mockCache.nowMs) / 1000;
}

// A fleet that has been ticking all along: the last tick was just now.
async function seedSteadyFleet(): Promise<void> {
  await mockFakeSetString(CACHE_NAMESPACE, TICKED_RECENTLY_KEY, "1", {
    expiresInSeconds: 120,
  });
}

interface SetStringCall {
  namespace: string;
  key: string;
  value: string;
  options: MockCacheSetOptions | undefined;
}

function setStringCalls(): Array<SetStringCall> {
  return globalCache.setString.mock.calls.map((args: Array<unknown>) => {
    return {
      namespace: args[0] as string,
      key: args[1] as string,
      value: args[2] as string,
      options: args[3] as MockCacheSetOptions | undefined,
    };
  });
}

function graceKeyWrites(): Array<SetStringCall> {
  return setStringCalls().filter((call: SetStringCall) => {
    return call.key === DISCONNECT_GRACE_KEY;
  });
}

function expectFailOpenWasLogged(error: Error): void {
  expect(mockedLogger.error).toHaveBeenCalledWith(
    expect.stringContaining("cache unavailable"),
    { service: "workers" },
  );
  expect(mockedLogger.error).toHaveBeenCalledWith(error, {
    service: "workers",
  });
}

describe("ProbeConnectionDowntimeGrace", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCache.nowMs = START_MS;
    mockCache.entries.clear();

    // mockReset also drops any leftover mock*Once from a failed test.
    globalCache.getString.mockReset().mockImplementation(mockFakeGetString);
    globalCache.setString.mockReset().mockImplementation(mockFakeSetString);
  });

  test("the very first tick after a gap (nothing in the cache) returns false and starts the grace", async () => {
    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    expect(await tickAt(grace, 0)).toBe(false);

    // The grace now runs for the full 3 minutes, and the tick was recorded.
    expect(secondsUntilExpiry(DISCONNECT_GRACE_KEY)).toBe(180);
    expect(secondsUntilExpiry(TICKED_RECENTLY_KEY)).toBe(120);
  });

  test("ticks inside the grace keep returning false and do not extend it", async () => {
    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    expect(await tickAtEach(grace, [0, 60, 120, 179])).toEqual([
      false,
      false,
      false,
      false,
    ]);

    /*
     * Only the tick that found the gap wrote the grace key: at T+2m59s it
     * still expires one second later, exactly where the first tick put it.
     */
    expect(graceKeyWrites()).toHaveLength(1);
    expect(secondsUntilExpiry(DISCONNECT_GRACE_KEY)).toBe(1);
  });

  test("once the grace key has expired, the next tick (ticks kept coming every minute) returns true, and so do later ones", async () => {
    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    expect(await tickAtEach(grace, everyMinute(0, 600))).toEqual([
      false, // T: the gap is found, the grace starts
      false, // T+1m
      false, // T+2m
      true, // T+3m: the grace key expired
      true,
      true,
      true,
      true,
      true,
      true,
      true, // T+10m
    ]);

    expect(graceKeyWrites()).toHaveLength(1);
  });

  test("a steady fleet (ticked-recently present, no grace key) gets true on every tick and never starts a grace", async () => {
    await seedSteadyFleet();

    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    const answers: Array<boolean> = await tickAtEach(
      grace,
      everyMinute(0, 900),
    );

    expect(answers).toHaveLength(16);
    expect(
      answers.every((answer: boolean) => {
        return answer;
      }),
    ).toBe(true);

    expect(graceKeyWrites()).toEqual([]);
    expect(secondsUntilExpiry(DISCONNECT_GRACE_KEY)).toBeNull();
  });

  test("every tick refreshes ticked-recently for MISSED_TICK_THRESHOLD_IN_SECONDS (120s); the grace key is written for graceInMinutes * 60", async () => {
    expect(ProbeConnectionDowntimeGrace.MISSED_TICK_THRESHOLD_IN_SECONDS).toBe(
      120,
    );

    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    // Three ticks inside the grace, then two after it.
    await tickAtEach(grace, everyMinute(0, 240));

    const tickedRecentlyWrite: SetStringCall = {
      namespace: CACHE_NAMESPACE,
      key: TICKED_RECENTLY_KEY,
      value: "1",
      options: { expiresInSeconds: 120 },
    };

    expect(setStringCalls()).toEqual([
      tickedRecentlyWrite,
      {
        namespace: CACHE_NAMESPACE,
        key: DISCONNECT_GRACE_KEY,
        value: "1",
        options: { expiresInSeconds: 180 },
      },
      {
        namespace: CACHE_NAMESPACE,
        key: GRACE_COOLDOWN_KEY,
        value: "1",
        options: { expiresInSeconds: 600 },
      },
      tickedRecentlyWrite,
      tickedRecentlyWrite,
      tickedRecentlyWrite,
      tickedRecentlyWrite,
    ]);

    // After the last tick (T+4m), ticked-recently runs until T+6m.
    expect(secondsUntilExpiry(TICKED_RECENTLY_KEY)).toBe(120);
  });

  test("one late tick (100s after the previous one) is not a gap: no grace", async () => {
    await seedSteadyFleet();

    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    expect(await tickAtEach(grace, [0, 60, 160, 220])).toEqual([
      true,
      true,
      true, // 100s after the previous tick: inside the 120s threshold
      true,
    ]);

    expect(graceKeyWrites()).toEqual([]);
  });

  test("a gap just over the threshold (2m01s without a tick) already counts as downtime", async () => {
    await seedSteadyFleet();

    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    expect(await tickAtEach(grace, [0, 121])).toEqual([true, false]);
    expect(graceKeyWrites()).toHaveLength(1);
  });

  test("a 5-minute gap in a steady fleet (an upgrade) returns false again and restarts the full grace", async () => {
    await seedSteadyFleet();

    const grace: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    expect(await tickAtEach(grace, [0, 60])).toEqual([true, true]);
    expect(graceKeyWrites()).toEqual([]);

    // The whole stack is down from T+1m to T+6m: no ticks at all.
    expect(await tickAt(grace, 360)).toBe(false);
    expect(secondsUntilExpiry(DISCONNECT_GRACE_KEY)).toBe(180);

    expect(await tickAtEach(grace, [420, 480, 540, 600])).toEqual([
      false,
      false,
      true, // one full grace after the ticks resumed
      true,
    ]);

    expect(graceKeyWrites()).toHaveLength(1);
  });

  test("the grace is fleet-wide: another replica sees the grace the first one started, and does not restart it", async () => {
    const replicaA: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);
    const replicaB: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    /*
     * The ticks land on alternating replicas, as the queue hands them out.
     * Replica B's very first tick (T+1m) is inside the grace A started, and
     * it must not start a grace of its own: a per-process grace would have
     * held B back until T+4m.
     */
    expect(await tickAt(replicaA, 0)).toBe(false);
    expect(await tickAt(replicaB, 60)).toBe(false);
    expect(await tickAt(replicaA, 120)).toBe(false);
    expect(await tickAt(replicaB, 180)).toBe(true);
    expect(await tickAt(replicaA, 240)).toBe(true);

    expect(graceKeyWrites()).toHaveLength(1);
  });

  test("a replica that joins a steady fleet (KEDA scale-out) gets true on its very first tick", async () => {
    const replicaA: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    // The fleet comes back from a restart and gets through its grace.
    expect(await tickAtEach(replicaA, everyMinute(0, 300))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);

    // A new replica is created at T+5m30s and takes the T+6m tick.
    const newReplica: ProbeConnectionDowntimeGrace =
      new ProbeConnectionDowntimeGrace(3);

    expect(await tickAt(newReplica, 360)).toBe(true);
    expect(graceKeyWrites()).toHaveLength(1);
  });

  test.each([3, 5])(
    "the grace length comes from the constructor (%i minutes)",
    async (graceInMinutes: number) => {
      const grace: ProbeConnectionDowntimeGrace =
        new ProbeConnectionDowntimeGrace(graceInMinutes);

      const graceInSeconds: number = graceInMinutes * ONE_MINUTE_IN_SECONDS;

      const answers: Array<boolean> = await tickAtEach(
        grace,
        everyMinute(0, graceInSeconds + ONE_MINUTE_IN_SECONDS),
      );

      // False for every minute of the grace, true from its end on.
      const expected: Array<boolean> = everyMinute(
        0,
        graceInSeconds + ONE_MINUTE_IN_SECONDS,
      ).map((seconds: number) => {
        return seconds >= graceInSeconds;
      });

      expect(answers).toEqual(expected);
      expect(
        answers.filter((answer: boolean) => {
          return !answer;
        }),
      ).toHaveLength(graceInMinutes);

      expect(graceKeyWrites()).toEqual([
        {
          namespace: CACHE_NAMESPACE,
          key: DISCONNECT_GRACE_KEY,
          value: "1",
          options: { expiresInSeconds: graceInSeconds },
        },
      ]);
    },
  );

  /*
   * Fail open: with no cache, disconnect detection goes ahead as it did
   * before the grace existed. Each case is set up so the answer WITHOUT the
   * failure would have been false, so a true can only come from the
   * fail-open path.
   */
  describe("when the cache fails, it fails open (true) and logs", () => {
    test("getString throws on the very first read", async () => {
      const error: Error = new Error("Cache is not connected");
      globalCache.getString.mockRejectedValueOnce(error);

      const grace: ProbeConnectionDowntimeGrace =
        new ProbeConnectionDowntimeGrace(3);

      expect(await tickAt(grace, 0)).toBe(true);
      expectFailOpenWasLogged(error);
    });

    test("setString throws while refreshing ticked-recently", async () => {
      const error: Error = new Error("Cache is not connected");
      globalCache.setString.mockRejectedValueOnce(error);

      const grace: ProbeConnectionDowntimeGrace =
        new ProbeConnectionDowntimeGrace(3);

      expect(await tickAt(grace, 0)).toBe(true);
      expectFailOpenWasLogged(error);
    });

    test("setString throws while starting the grace", async () => {
      const error: Error = new Error(
        "READONLY You can't write against a replica",
      );

      // The ticked-recently write goes through; the grace-key write fails.
      globalCache.setString
        .mockImplementationOnce(mockFakeSetString)
        .mockRejectedValueOnce(error);

      const grace: ProbeConnectionDowntimeGrace =
        new ProbeConnectionDowntimeGrace(3);

      expect(await tickAt(grace, 0)).toBe(true);
      expect(globalCache.setString).toHaveBeenCalledTimes(2);
      expectFailOpenWasLogged(error);
    });

    test("getString throws while reading the grace key, mid-grace", async () => {
      const grace: ProbeConnectionDowntimeGrace =
        new ProbeConnectionDowntimeGrace(3);

      expect(await tickAt(grace, 0)).toBe(false);
      expect(mockedLogger.error).not.toHaveBeenCalled();

      // The ticked-recently read goes through; the grace-key read fails.
      const error: Error = new Error("Connection is closed.");
      globalCache.getString
        .mockImplementationOnce(mockFakeGetString)
        .mockRejectedValueOnce(error);

      expect(await tickAt(grace, 60)).toBe(true);
      /*
       * Tick 1 read ticked-recently and the cooldown; tick 2 read
       * ticked-recently, then failed on the grace key.
       */
      expect(globalCache.getString).toHaveBeenCalledTimes(4);
      expectFailOpenWasLogged(error);

      // Once the cache answers again, the grace is still running.
      expect(await tickAt(grace, 120)).toBe(false);
    });
  });

  /*
   * Ticks that keep coming, but always more than 120s apart. A backed-up
   * Worker queue does exactly that: BullMQ only adds the next iteration of a
   * repeatable job when a worker picks up the current one, at the next cron
   * slot after that pickup, so a steady pickup delay of over two minutes
   * spaces the ticks three minutes apart. Every such tick finds
   * ticked-recently expired. Without the cooldown each one restarted the
   * grace, canMarkProbesDisconnected() stayed false forever, and no probe was
   * ever marked Disconnected however long it had been down.
   */
  describe("the cooldown: late ticks cannot hold the grace on for good", () => {
    test("ticks 3 minutes apart get at most one grace tick per 10-minute cooldown, and detection runs in between", async () => {
      const grace: ProbeConnectionDowntimeGrace =
        new ProbeConnectionDowntimeGrace(3);

      const tickTimes: Array<number> = [];

      // 30 minutes of ticks, one every 3 minutes.
      for (let at: number = 0; at <= 1800; at += 180) {
        tickTimes.push(at);
      }

      expect(await tickAtEach(grace, tickTimes)).toEqual([
        false, // T: gap, grace + cooldown start
        true, // T+3m: gap again, but the cooldown holds; the grace expired
        true,
        true, // T+9m
        false, // T+12m: the cooldown (T..T+10m) is over, a new grace starts
        true,
        true,
        true,
        false, // T+24m: the second cooldown (T+12m..T+22m) is over
        true,
        true, // T+30m
      ]);

      // One grace per cooldown window, never more.
      expect(graceKeyWrites()).toHaveLength(3);
    });

    test("a second outage inside the cooldown gets no second grace (the documented trade-off)", async () => {
      await seedSteadyFleet();

      const grace: ProbeConnectionDowntimeGrace =
        new ProbeConnectionDowntimeGrace(3);

      // First outage: no ticks between T and T+5m.
      expect(await tickAtEach(grace, [0, 300, 360, 420, 480])).toEqual([
        true,
        false,
        false,
        false,
        true,
      ]);

      // Second outage: no ticks between T+8m and T+13m, inside the cooldown.
      expect(await tickAt(grace, 780)).toBe(true);
      expect(graceKeyWrites()).toHaveLength(1);

      // A third outage after the cooldown ran out gets its grace again.
      expect(await tickAt(grace, 1200)).toBe(false);
      expect(graceKeyWrites()).toHaveLength(2);
    });

    test.each([
      [3, 600],
      [15, 900],
    ])(
      "the cooldown lasts 10 minutes, or the whole grace when that is longer (%i-minute grace -> %is)",
      async (graceInMinutes: number, cooldownInSeconds: number) => {
        expect(ProbeConnectionDowntimeGrace.GRACE_COOLDOWN_IN_SECONDS).toBe(
          600,
        );

        const grace: ProbeConnectionDowntimeGrace =
          new ProbeConnectionDowntimeGrace(graceInMinutes);

        expect(await tickAt(grace, 0)).toBe(false);
        expect(secondsUntilExpiry(GRACE_COOLDOWN_KEY)).toBe(cooldownInSeconds);
      },
    );
  });
});
