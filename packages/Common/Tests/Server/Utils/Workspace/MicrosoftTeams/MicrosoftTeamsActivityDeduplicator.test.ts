import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import Redis, { ClientType } from "../../../../../Server/Infrastructure/Redis";
import logger, { LogAttributes } from "../../../../../Server/Utils/Logger";
import MicrosoftTeamsActivityDeduplicator from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsActivityDeduplicator";
import DatabaseNotConnectedException from "../../../../../Types/Exception/DatabaseNotConnectedException";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * Issue #4111: in Microsoft Teams every error bubble showed up twice. The bot
 * replied and then rethrew, the CloudAdapter answered Teams with HTTP 500, and
 * Teams delivered the same activity (same id) again, so the handler failed
 * and replied a second time. Teams also redelivers an activity the bot is
 * slow to answer, and a redelivered form submit would create a second
 * incident. MicrosoftTeamsActivityDeduplicator.claim() is the guard in front
 * of handleBotMessageActivity: the first delivery of
 * "<conversation id>|<activity id>" is processed, every later one is dropped
 * for ten minutes.
 *
 * The claim is a Redis SET NX, so a redelivery that lands on another App
 * instance is caught too, and this process remembers every claim it makes
 * besides. That memory is consulted first: an activity claimed here is
 * refused here whatever Redis says (Redis may have been down for the first
 * delivery, or have lost the key since). Redis is asked about every delivery
 * all the same, so the other instances learn of the claim. When Redis is down
 * (GlobalCache throws DatabaseNotConnectedException) or hangs, this process's
 * memory decides, and a hung Redis may hold a reply up by two seconds at
 * most. claim() is called before handleBotMessageActivity's try block, so it
 * must never reject: otherwise every message would get the generic error
 * reply while Redis misbehaves.
 *
 * Falling back to memory means a redelivery that reaches another instance is
 * handled twice, so a process with a Redis client logs the fallback at error
 * level, classed as infrastructure, at most once a minute. A process without
 * one (a script, or this test file) has no other instance to share with and
 * only logs it at debug.
 *
 * The in-process claims are a static cache shared by every test in this
 * file, so each test claims activity ids of its own. The time of the last
 * logged fallback is static too, so each test that gives the process a Redis
 * client runs on a clock of its own (see startClockOfItsOwn).
 */

const CLAIM_NAMESPACE: string = "microsoft-teams-inbound-activity";
const CLAIM_TTL_IN_SECONDS: number = 10 * 60;
const CLAIM_TTL_IN_MS: number = CLAIM_TTL_IN_SECONDS * 1000;
const REDIS_CLAIM_TIMEOUT_IN_MS: number = 2000;

const PERSONAL_CHAT_ID: string =
  "a:1pQ3dFxkGqKZ8Yv0cWm7bT2nR5sL9hJ4uE6oA-personal";
const CHANNEL_THREAD_ID: string =
  "19:7b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e@thread.tacv2;messageid=1727712000000";

type SetStringIfNotExists = typeof GlobalCache.setStringIfNotExists;

let lastActivityNumber: number = 0;

// Teams activity ids look like "1727712345678"; every call returns a new one.
function nextActivityId(): string {
  lastActivityNumber += 1;
  return `17277123${String(lastActivityNumber).padStart(5, "0")}`;
}

function buildActivity(data: {
  id: string;
  conversationId: string;
}): JSONObject {
  return {
    type: "message",
    id: data.id,
    text: "create incident",
    conversation: { id: data.conversationId },
    from: {
      id: "29:1Hk8-teams-user",
      aadObjectId: "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    },
  };
}

// A message activity no earlier test has claimed.
function newActivity(conversationId?: string): JSONObject {
  return buildActivity({
    id: nextActivityId(),
    conversationId: conversationId || PERSONAL_CHAT_ID,
  });
}

function claimKeyOf(activity: JSONObject): string {
  return `${(activity["conversation"] as JSONObject)["id"] as string}|${
    activity["id"] as string
  }`;
}

function claim(activity: JSONObject): Promise<boolean> {
  return MicrosoftTeamsActivityDeduplicator.claim(activity);
}

// What GlobalCache.setStringIfNotExists throws while Redis is not connected.
function cacheNotConnected(): DatabaseNotConnectedException {
  return new DatabaseNotConnectedException("Cache is not connected");
}

function redisIsDown(): SpyInstance<SetStringIfNotExists> {
  return jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockRejectedValue(cacheNotConnected());
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (reason: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

// A Redis call that never answers: the connection hangs.
function redisHangs(): SpyInstance<SetStringIfNotExists> {
  return jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(() => {
      return deferred<boolean>().promise;
    });
}

// Runs every promise callback that is already due (fake timers stay put).
async function flushPromises(): Promise<void> {
  for (let turn: number = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
}

let lastClockStartedAt: number = Date.parse("2031-01-01T00:00:00.000Z");

/*
 * Fake timers starting a day after the last test that called this, so no
 * minute an earlier test's logged fallback began is still running. Returns
 * the start.
 */
function startClockOfItsOwn(): number {
  lastClockStartedAt += 24 * 60 * 60 * 1000;
  jest.useFakeTimers({ now: lastClockStartedAt });
  return lastClockStartedAt;
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsActivityDeduplicator.getClaimKey", () => {
  test("keys an activity by its conversation id and its activity id", () => {
    expect(
      MicrosoftTeamsActivityDeduplicator.getClaimKey(
        buildActivity({
          id: "1727712345678",
          conversationId: PERSONAL_CHAT_ID,
        }),
      ),
    ).toBe(`${PERSONAL_CHAT_ID}|1727712345678`);

    expect(
      MicrosoftTeamsActivityDeduplicator.getClaimKey(
        buildActivity({
          id: "1727712345678",
          conversationId: CHANNEL_THREAD_ID,
        }),
      ),
    ).toBe(`${CHANNEL_THREAD_ID}|1727712345678`);
  });

  test("an activity without an id has no key, whatever its conversation", () => {
    expect(
      MicrosoftTeamsActivityDeduplicator.getClaimKey({
        type: "message",
        conversation: { id: PERSONAL_CHAT_ID },
      }),
    ).toBeNull();

    expect(
      MicrosoftTeamsActivityDeduplicator.getClaimKey({
        type: "message",
        id: "",
        conversation: { id: PERSONAL_CHAT_ID },
      }),
    ).toBeNull();

    expect(MicrosoftTeamsActivityDeduplicator.getClaimKey({})).toBeNull();
  });

  test("an activity with an id but no conversation is still keyed by its id", () => {
    expect(
      MicrosoftTeamsActivityDeduplicator.getClaimKey({
        type: "message",
        id: "1727712345678",
      }),
    ).toBe("|1727712345678");

    expect(
      MicrosoftTeamsActivityDeduplicator.getClaimKey({
        type: "message",
        id: "1727712345678",
        conversation: {},
      }),
    ).toBe("|1727712345678");
  });
});

describe("MicrosoftTeamsActivityDeduplicator.claim while Redis cannot be reached", () => {
  let redis: SpyInstance<SetStringIfNotExists>;

  beforeEach(() => {
    redis = redisIsDown();
  });

  test("the first delivery is claimed and every redelivery of it is refused", async () => {
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(true);
    expect(await claim(activity)).toBe(false);
    expect(await claim({ ...activity })).toBe(false);

    // Redis was asked first; its failure is what sent the claim to memory.
    expect(redis).toHaveBeenNthCalledWith(
      1,
      CLAIM_NAMESPACE,
      claimKeyOf(activity),
      "1",
      { expiresInSeconds: CLAIM_TTL_IN_SECONDS },
    );
  });

  test("two deliveries of one activity at the same moment: exactly one is claimed", async () => {
    const activity: JSONObject = newActivity();

    expect(
      await Promise.all([claim(activity), claim({ ...activity })]),
    ).toEqual([true, false]);
  });

  test("the same activity id in another conversation is another activity", async () => {
    const activityId: string = nextActivityId();

    expect(
      await claim(
        buildActivity({ id: activityId, conversationId: PERSONAL_CHAT_ID }),
      ),
    ).toBe(true);
    expect(
      await claim(
        buildActivity({ id: activityId, conversationId: CHANNEL_THREAD_ID }),
      ),
    ).toBe(true);

    // Each is still a single claim of its own.
    expect(
      await claim(
        buildActivity({ id: activityId, conversationId: CHANNEL_THREAD_ID }),
      ),
    ).toBe(false);
  });

  test("another activity in the same conversation is claimed", async () => {
    expect(await claim(newActivity(PERSONAL_CHAT_ID))).toBe(true);
    expect(await claim(newActivity(PERSONAL_CHAT_ID))).toBe(true);
  });

  test("an activity without an id is always processed, and Redis is not asked", async () => {
    const withoutId: JSONObject = {
      type: "message",
      text: "create incident",
      conversation: { id: PERSONAL_CHAT_ID },
    };
    const withEmptyId: JSONObject = { ...withoutId, id: "" };

    expect(await claim(withoutId)).toBe(true);
    expect(await claim(withoutId)).toBe(true);
    expect(await claim(withEmptyId)).toBe(true);
    expect(await claim(withEmptyId)).toBe(true);

    expect(redis).not.toHaveBeenCalled();
  });

  test("a failing Redis does not hold the reply up: no wait for the two-second timeout", async () => {
    jest.useFakeTimers();

    const claimed: Promise<boolean> = claim(newActivity());

    // Nothing is advanced: the claim settles on the Redis failure alone.
    expect(await claimed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("the claim lasts ten minutes, then the same activity can be claimed again", async () => {
    const claimedAt: number = Date.parse("2026-10-01T18:00:00.000Z");
    jest.useFakeTimers({ now: claimedAt });

    const activity: JSONObject = newActivity();
    expect(await claim(activity)).toBe(true);

    /*
     * Ten minutes from the claim: the redelivery refused at 9:59 does not
     * extend it, as a refused SET NX leaves the Redis key's expiry alone.
     */
    jest.setSystemTime(claimedAt + CLAIM_TTL_IN_MS - 1000);
    expect(await claim(activity)).toBe(false);

    jest.setSystemTime(claimedAt + CLAIM_TTL_IN_MS + 1000);
    expect(await claim(activity)).toBe(true);

    // The new claim holds in its turn.
    expect(await claim(activity)).toBe(false);
  });
});

/*
 * "Not connected" is only one way GlobalCache fails. ioredis rejects with
 * errors of its own, a replica answers writes with READONLY during a
 * failover, and the @CaptureSpan decorator wraps setStringIfNotExists in a
 * plain (not async) function, so a telemetry fault throws before any promise
 * exists. None of them may escape claim(): it runs outside
 * handleBotMessageActivity's try block.
 */
describe("MicrosoftTeamsActivityDeduplicator.claim never rejects, whatever GlobalCache fails with", () => {
  interface RedisFailure {
    name: string;
    fail: (redis: SpyInstance<SetStringIfNotExists>) => void;
  }

  const failures: Array<RedisFailure> = [
    {
      name: "a synchronous throw, before any promise exists",
      fail: (redis: SpyInstance<SetStringIfNotExists>): void => {
        redis.mockImplementation(() => {
          throw new Error("Could not start the span");
        });
      },
    },
    {
      name: "ioredis's own error",
      fail: (redis: SpyInstance<SetStringIfNotExists>): void => {
        redis.mockRejectedValue(new Error("Connection is closed."));
      },
    },
    {
      name: "a READONLY reply during a failover",
      fail: (redis: SpyInstance<SetStringIfNotExists>): void => {
        redis.mockRejectedValue(
          new Error("READONLY You can't write against a read only replica."),
        );
      },
    },
    {
      name: "a rejection that is not an Error",
      fail: (redis: SpyInstance<SetStringIfNotExists>): void => {
        redis.mockRejectedValue("ETIMEDOUT");
      },
    },
  ];

  test.each(failures)(
    "$name: this process's memory decides, at once and without a timer left behind",
    async (failure: RedisFailure) => {
      jest.useFakeTimers();
      const redis: SpyInstance<SetStringIfNotExists> = jest.spyOn(
        GlobalCache,
        "setStringIfNotExists",
      );
      failure.fail(redis);
      const activity: JSONObject = newActivity();

      // No time is advanced: the failure alone settles each claim.
      await expect(claim(activity)).resolves.toBe(true);
      await expect(claim(activity)).resolves.toBe(false);
      await expect(claim(newActivity())).resolves.toBe(true);

      expect(redis).toHaveBeenNthCalledWith(
        1,
        CLAIM_NAMESPACE,
        claimKeyOf(activity),
        "1",
        { expiresInSeconds: CLAIM_TTL_IN_SECONDS },
      );
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});

describe("MicrosoftTeamsActivityDeduplicator.claim while Redis answers", () => {
  test("returns Redis's answer, and claims the activity's key for ten minutes", async () => {
    const redis: SpyInstance<SetStringIfNotExists> = jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const activity: JSONObject = newActivity(CHANNEL_THREAD_ID);

    expect(await claim(activity)).toBe(true);
    expect(await claim(activity)).toBe(false);

    expect(redis).toHaveBeenNthCalledWith(
      1,
      CLAIM_NAMESPACE,
      claimKeyOf(activity),
      "1",
      { expiresInSeconds: CLAIM_TTL_IN_SECONDS },
    );
  });

  test("an activity another App instance already claimed is refused on its first delivery here", async () => {
    const redis: SpyInstance<SetStringIfNotExists> = jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(false);
    const activity: JSONObject = newActivity(CHANNEL_THREAD_ID);

    // This process has never seen it, so the refusal can only be Redis's.
    expect(await claim(activity)).toBe(false);
    expect(redis).toHaveBeenCalledTimes(1);
    expect(redis).toHaveBeenCalledWith(
      CLAIM_NAMESPACE,
      claimKeyOf(activity),
      "1",
      { expiresInSeconds: CLAIM_TTL_IN_SECONDS },
    );
  });

  test("a Redis claim is remembered here, so a Redis outage right after it does not let the redelivery through", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValueOnce(true)
      .mockRejectedValue(cacheNotConnected());
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(true);
    expect(await claim(activity)).toBe(false);
    expect(await claim(activity)).toBe(false);
  });

  test("a refusal from Redis is remembered here too", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValueOnce(false)
      .mockRejectedValue(cacheNotConnected());
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(false);
    expect(await claim(activity)).toBe(false);
  });

  test("what is remembered from Redis lapses after ten minutes, like the Redis key", async () => {
    const claimedAt: number = Date.parse("2026-10-01T18:00:00.000Z");
    jest.useFakeTimers({ now: claimedAt });
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValueOnce(true)
      .mockRejectedValue(cacheNotConnected());
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(true);

    // Refused from memory, which does not push the lapse back.
    jest.setSystemTime(claimedAt + CLAIM_TTL_IN_MS - 1000);
    expect(await claim(activity)).toBe(false);

    jest.setSystemTime(claimedAt + CLAIM_TTL_IN_MS + 1000);
    expect(await claim(activity)).toBe(true);
  });

  test("the two-second race timer is cleared as soon as Redis answers", async () => {
    jest.useFakeTimers();
    jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);

    const claimed: Promise<boolean> = claim(newActivity());

    // The race timeout is armed while Redis is being asked...
    expect(jest.getTimerCount()).toBe(1);

    // ...and gone once it has answered, without any time passing.
    expect(await claimed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("the two-second race timer is cleared as soon as Redis fails", async () => {
    jest.useFakeTimers();
    redisIsDown();

    const claimed: Promise<boolean> = claim(newActivity());
    expect(jest.getTimerCount()).toBe(1);

    expect(await claimed).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("MicrosoftTeamsActivityDeduplicator.claim while Redis hangs", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  test("this process's memory decides after two seconds, not before", async () => {
    const redis: SpyInstance<SetStringIfNotExists> = redisHangs();
    const activity: JSONObject = newActivity();

    let answer: boolean | undefined = undefined;
    const claimed: Promise<void> = claim(activity).then((value: boolean) => {
      answer = value;
    });

    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS - 1);
    await flushPromises();
    expect(answer).toBeUndefined();

    jest.advanceTimersByTime(1);
    await claimed;
    expect(answer).toBe(true);

    expect(redis).toHaveBeenCalledTimes(1);
    expect(redis).toHaveBeenCalledWith(
      CLAIM_NAMESPACE,
      claimKeyOf(activity),
      "1",
      { expiresInSeconds: CLAIM_TTL_IN_SECONDS },
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a redelivery during the same hang is refused from memory", async () => {
    redisHangs();
    const activity: JSONObject = newActivity();

    const first: Promise<boolean> = claim(activity);
    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    expect(await first).toBe(true);

    const redelivery: Promise<boolean> = claim(activity);
    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    expect(await redelivery).toBe(false);

    expect(jest.getTimerCount()).toBe(0);
  });

  test("two deliveries racing through the same hang: exactly one is claimed", async () => {
    redisHangs();
    const activity: JSONObject = newActivity();

    const first: Promise<boolean> = claim(activity);
    const second: Promise<boolean> = claim({ ...activity });
    expect(jest.getTimerCount()).toBe(2);

    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);

    expect([await first, await second]).toEqual([true, false]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a Redis answer that turns up after the fallback changes nothing", async () => {
    const lateAnswer: Deferred<boolean> = deferred<boolean>();
    const lateFailure: Deferred<boolean> = deferred<boolean>();
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockReturnValueOnce(lateAnswer.promise)
      .mockReturnValueOnce(lateFailure.promise)
      .mockRejectedValue(cacheNotConnected());
    const activity: JSONObject = newActivity();
    const otherActivity: JSONObject = newActivity();

    const claimed: Promise<boolean> = claim(activity);
    const otherClaimed: Promise<boolean> = claim(otherActivity);
    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    expect(await claimed).toBe(true);
    expect(await otherClaimed).toBe(true);

    // Redis finally answers the first, and the second fails, too late.
    lateAnswer.resolve(false);
    lateFailure.reject(new Error("Connection is closed."));
    await flushPromises();

    expect(jest.getTimerCount()).toBe(0);
    // This process's memory still holds both claims.
    expect(await claim(activity)).toBe(false);
    expect(await claim(otherActivity)).toBe(false);
  });
});

describe("MicrosoftTeamsActivityDeduplicator.claim while Redis hangs, on the real clock", () => {
  test("the reply waits about two seconds for Redis, then this process's memory decides", async () => {
    redisHangs();
    const activity: JSONObject = newActivity();

    const startedAt: number = Date.now();
    const claimed: boolean = await claim(activity);
    const waitedInMs: number = Date.now() - startedAt;

    expect(claimed).toBe(true);
    // A timer may fire a millisecond early by the wall clock.
    expect(waitedInMs).toBeGreaterThanOrEqual(REDIS_CLAIM_TIMEOUT_IN_MS - 50);
    // Generous for a busy CI runner; a real hang would sit out the test timeout.
    expect(waitedInMs).toBeLessThan(REDIS_CLAIM_TIMEOUT_IN_MS + 5000);
  });
});

/*
 * This process's memory knows every activity it has claimed in the last ten
 * minutes, whichever way the claim was made. A delivery of one of them is a
 * redelivery, so it must be refused even when Redis, asked again, has no
 * record of the first delivery: Redis was down (or hung) when the first one
 * came in and is back for the redelivery, or it lost the key in a restart or
 * an eviction. That is "a single instance is still covered", the promise the
 * in-process fallback makes; a redelivered form submit would otherwise create
 * a second incident.
 */
describe("MicrosoftTeamsActivityDeduplicator.claim when Redis has no record of a claim this process made", () => {
  test("a redelivery claimed here while Redis was down is refused when Redis is back", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValueOnce(cacheNotConnected())
      // Back, and the first delivery never reached it.
      .mockResolvedValue(true);
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(true);
    expect(await claim(activity)).toBe(false);
  });

  test("a redelivery claimed here through Redis is refused after Redis lost the key", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValueOnce(true)
      // Restarted without persistence (or evicted the key).
      .mockResolvedValue(true);
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(true);
    expect(await claim(activity)).toBe(false);
  });
});

/*
 * This process's memory decides first, and Redis is asked about every
 * delivery all the same: a claim this process made while Redis could not
 * take it still reaches Redis with the next delivery, so a redelivery that
 * lands on another App instance after that is refused there too.
 */
describe("MicrosoftTeamsActivityDeduplicator.claim asks Redis about every delivery, after this process's memory", () => {
  test("Redis is asked about each delivery with an id, repeats included, and memory has the last word", async () => {
    const redis: SpyInstance<SetStringIfNotExists> = jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValueOnce(cacheNotConnected())
      // Back, without the first delivery's claim: it takes it now.
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(true);
    expect(await claim(activity)).toBe(false);
    expect(await claim({ ...activity })).toBe(false);

    expect(redis).toHaveBeenCalledTimes(3);
    for (let call: number = 1; call <= 3; call++) {
      expect(redis).toHaveBeenNthCalledWith(
        call,
        CLAIM_NAMESPACE,
        claimKeyOf(activity),
        "1",
        { expiresInSeconds: CLAIM_TTL_IN_SECONDS },
      );
    }
  });

  test("a first delivery Redis hung on, which is what makes Teams redeliver, is refused on the redelivery when Redis is back, and Redis takes the claim then", async () => {
    jest.useFakeTimers();
    const redis: SpyInstance<SetStringIfNotExists> = jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockReturnValueOnce(deferred<boolean>().promise)
      // Back, with no record of the first delivery.
      .mockResolvedValueOnce(true);
    const activity: JSONObject = newActivity();

    const first: Promise<boolean> = claim(activity);
    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    expect(await first).toBe(true);

    // Teams redelivers the activity the bot was slow to answer.
    expect(await claim(activity)).toBe(false);

    expect(redis).toHaveBeenCalledTimes(2);
    expect(redis).toHaveBeenNthCalledWith(
      2,
      CLAIM_NAMESPACE,
      claimKeyOf(activity),
      "1",
      { expiresInSeconds: CLAIM_TTL_IN_SECONDS },
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a delivery racing the first is refused by memory, even if Redis were to take both claims", async () => {
    const firstAnswer: Deferred<boolean> = deferred<boolean>();
    const secondAnswer: Deferred<boolean> = deferred<boolean>();
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockReturnValueOnce(firstAnswer.promise)
      .mockReturnValueOnce(secondAnswer.promise);
    const activity: JSONObject = newActivity();

    // Both are asked of Redis before either answer is in.
    const first: Promise<boolean> = claim(activity);
    const second: Promise<boolean> = claim({ ...activity });

    secondAnswer.resolve(true);
    expect(await second).toBe(false);

    firstAnswer.resolve(true);
    expect(await first).toBe(true);
  });
});

describe("MicrosoftTeamsActivityDeduplicator logs a fallback to this process's memory", () => {
  const FALLBACK_LOG_INTERVAL_IN_MS: number = 60 * 1000;
  // Spelled out, not ErrorClass.Infrastructure: the value is what an operator filters on.
  const INFRASTRUCTURE: LogAttributes = { "error.class": "infrastructure" };
  const REFUSED: string = "Redis refused the claim";
  const TIMED_OUT: string = "Redis did not answer within 2000 ms";

  let errorLog: SpyInstance<typeof logger.error>;
  let debugLog: SpyInstance<typeof logger.debug>;

  beforeEach(() => {
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
    debugLog = jest.spyOn(logger, "debug").mockImplementation((): void => {});
  });

  // An App instance: connected to Redis, which other instances share.
  function withRedisClient(): void {
    jest.spyOn(Redis, "getClient").mockReturnValue({} as ClientType);
  }

  // A script or a test: this process never had a Redis client.
  function withoutRedisClient(): void {
    jest.spyOn(Redis, "getClient").mockReturnValue(null);
  }

  function fellBack(reason: string): string {
    return `Microsoft Teams activity dedupe fell back to this process's memory (${reason}); a Teams redelivery that reaches another App instance may be handled twice.`;
  }

  function usingMemory(reason: string): string {
    return `Microsoft Teams activity dedupe is using this process's memory: ${reason}`;
  }

  test("with a Redis client, a claim Redis refused is logged at error level as infrastructure, and so is the error it refused with", async () => {
    startClockOfItsOwn();
    withRedisClient();
    const refusal: DatabaseNotConnectedException = cacheNotConnected();
    jest.spyOn(GlobalCache, "setStringIfNotExists").mockRejectedValue(refusal);

    expect(await claim(newActivity())).toBe(true);

    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenNthCalledWith(
      1,
      fellBack(REFUSED),
      INFRASTRUCTURE,
    );
    expect(errorLog).toHaveBeenNthCalledWith(2, refusal, INFRASTRUCTURE);
    // The very error, with its class and stack, not a copy of its message.
    expect(errorLog.mock.calls[1]?.[0]).toBe(refusal);
    expect(debugLog).not.toHaveBeenCalled();
  });

  test("with a Redis client, a Redis that does not answer is logged when the two seconds are up, with no error to go with it", async () => {
    startClockOfItsOwn();
    withRedisClient();
    redisHangs();

    const claimed: Promise<boolean> = claim(newActivity());

    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS - 1);
    expect(errorLog).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(await claimed).toBe(true);

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(fellBack(TIMED_OUT), INFRASTRUCTURE);
    expect(debugLog).not.toHaveBeenCalled();
  });

  interface Refusal {
    name: string;
    thrown: unknown;
    // Thrown before any promise exists, as @CaptureSpan can.
    isSynchronous: boolean;
  }

  const refusals: Array<Refusal> = [
    {
      name: "a synchronous throw",
      thrown: new Error("Could not start the span"),
      isSynchronous: true,
    },
    {
      name: "ioredis's own error",
      thrown: new Error("Connection is closed."),
      isSynchronous: false,
    },
    {
      name: "a READONLY reply during a failover",
      thrown: new Error(
        "READONLY You can't write against a read only replica.",
      ),
      isSynchronous: false,
    },
    {
      name: "a rejection that is not an Error",
      thrown: "ETIMEDOUT",
      isSynchronous: false,
    },
  ];

  test.each(refusals)(
    "with a Redis client, $name is logged as a refusal, with what was thrown",
    async (refusal: Refusal) => {
      startClockOfItsOwn();
      withRedisClient();
      const redis: SpyInstance<SetStringIfNotExists> = jest.spyOn(
        GlobalCache,
        "setStringIfNotExists",
      );

      if (refusal.isSynchronous) {
        redis.mockImplementation((): Promise<boolean> => {
          throw refusal.thrown;
        });
      } else {
        redis.mockRejectedValue(refusal.thrown);
      }

      expect(await claim(newActivity())).toBe(true);

      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        fellBack(REFUSED),
        INFRASTRUCTURE,
      );
      expect(errorLog).toHaveBeenNthCalledWith(
        2,
        refusal.thrown,
        INFRASTRUCTURE,
      );
      expect(errorLog.mock.calls[1]?.[0]).toBe(refusal.thrown);
    },
  );

  test("with a Redis client, a rejection without a reason is logged as the fallback alone", async () => {
    startClockOfItsOwn();
    withRedisClient();
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(undefined);

    expect(await claim(newActivity())).toBe(true);

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(fellBack(REFUSED), INFRASTRUCTURE);
  });

  test("at most once a minute: until a minute after the last logged fallback the next ones only go to debug", async () => {
    const startedAt: number = startClockOfItsOwn();
    withRedisClient();
    redisIsDown();

    expect(await claim(newActivity())).toBe(true);
    expect(errorLog).toHaveBeenCalledTimes(2);

    jest.setSystemTime(startedAt + 1000);
    expect(await claim(newActivity())).toBe(true);
    jest.setSystemTime(startedAt + FALLBACK_LOG_INTERVAL_IN_MS - 1);
    expect(await claim(newActivity())).toBe(true);

    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(debugLog).toHaveBeenCalledTimes(2);
    expect(debugLog).toHaveBeenNthCalledWith(1, usingMemory(REFUSED));
    expect(debugLog).toHaveBeenNthCalledWith(2, usingMemory(REFUSED));

    // The minute runs from the one logged, not from the ones sent to debug.
    jest.setSystemTime(startedAt + FALLBACK_LOG_INTERVAL_IN_MS);
    expect(await claim(newActivity())).toBe(true);

    expect(errorLog).toHaveBeenCalledTimes(4);
    expect(errorLog).toHaveBeenNthCalledWith(
      3,
      fellBack(REFUSED),
      INFRASTRUCTURE,
    );
    expect(debugLog).toHaveBeenCalledTimes(2);
  });

  test("the minute is shared by a refused claim and a Redis that does not answer", async () => {
    const startedAt: number = startClockOfItsOwn();
    withRedisClient();
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValueOnce(cacheNotConnected())
      .mockReturnValueOnce(deferred<boolean>().promise);

    expect(await claim(newActivity())).toBe(true);
    expect(errorLog).toHaveBeenCalledTimes(2);

    jest.setSystemTime(startedAt + 30 * 1000);
    const claimed: Promise<boolean> = claim(newActivity());
    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    expect(await claimed).toBe(true);

    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(debugLog).toHaveBeenCalledTimes(1);
    expect(debugLog).toHaveBeenCalledWith(usingMemory(TIMED_OUT));
  });

  test("without a Redis client a fallback only goes to debug, and does not start the minute", async () => {
    startClockOfItsOwn();
    withoutRedisClient();
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValueOnce(cacheNotConnected())
      .mockReturnValueOnce(deferred<boolean>().promise)
      .mockRejectedValueOnce(cacheNotConnected());

    expect(await claim(newActivity())).toBe(true);
    const claimed: Promise<boolean> = claim(newActivity());
    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    expect(await claimed).toBe(true);

    expect(errorLog).not.toHaveBeenCalled();
    expect(debugLog).toHaveBeenCalledTimes(2);
    expect(debugLog).toHaveBeenNthCalledWith(1, usingMemory(REFUSED));
    expect(debugLog).toHaveBeenNthCalledWith(2, usingMemory(TIMED_OUT));

    // Moments later, with a client, the first fallback is logged at once.
    withRedisClient();
    expect(await claim(newActivity())).toBe(true);

    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenNthCalledWith(
      1,
      fellBack(REFUSED),
      INFRASTRUCTURE,
    );
  });

  test("a Redis failure that turns up after the two seconds is not logged again", async () => {
    startClockOfItsOwn();
    withRedisClient();
    const lateFailure: Deferred<boolean> = deferred<boolean>();
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockReturnValueOnce(lateFailure.promise);

    const claimed: Promise<boolean> = claim(newActivity());
    jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    expect(await claimed).toBe(true);
    expect(errorLog).toHaveBeenCalledTimes(1);

    lateFailure.reject(new Error("Connection is closed."));
    await flushPromises();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(debugLog).not.toHaveBeenCalled();
  });

  test("a Redis that answers is not logged at all", async () => {
    startClockOfItsOwn();
    withRedisClient();
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const activity: JSONObject = newActivity();

    expect(await claim(activity)).toBe(true);
    expect(await claim(activity)).toBe(false);

    expect(errorLog).not.toHaveBeenCalled();
    expect(debugLog).not.toHaveBeenCalled();
  });
});

/*
 * The fallback is logged from inside claim(): from the catch that takes a
 * Redis refusal, and from the timer that stands in for a Redis answer.
 * Redis.getClient is wrapped by @CaptureSpan just as GlobalCache is, so the
 * telemetry fault behind the synchronous throw above can make it throw as
 * well. Logging a fallback must not turn into a way for claim() to reject, or
 * for the timer to throw before it hands the decision to memory.
 */
describe("MicrosoftTeamsActivityDeduplicator.claim when logging the fallback throws", () => {
  function getClientThrows(): void {
    jest.spyOn(Redis, "getClient").mockImplementation((): ClientType | null => {
      throw new Error("Could not start the span");
    });
  }

  test("a claim Redis refused still resolves, from memory", async () => {
    getClientThrows();
    redisIsDown();
    const activity: JSONObject = newActivity();

    await expect(claim(activity)).resolves.toBe(true);
    await expect(claim(activity)).resolves.toBe(false);
  });

  test("a Redis that does not answer still leaves the decision to memory after two seconds", async () => {
    jest.useFakeTimers();
    getClientThrows();
    redisHangs();

    let answer: boolean | undefined = undefined;
    void claim(newActivity()).then((value: boolean) => {
      answer = value;
    });

    // On the real clock a throw here is an uncaught exception.
    expect(() => {
      jest.advanceTimersByTime(REDIS_CLAIM_TIMEOUT_IN_MS);
    }).not.toThrow();
    await flushPromises();

    expect(answer).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
