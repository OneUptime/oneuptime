import CacheGenerations, {
  DEFAULT_GENERATION,
  UNREACHABLE_GENERATION,
} from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import logger from "../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * CacheGenerations: how one change makes everything a cache kept under a
 * key unreachable, in the process that made it at once and in every other
 * through Redis - and never lost in the process that made it, whatever
 * Redis does: a write Redis does not take, a Redis that answers again with
 * the generation from before, a Redis that cannot be reached at all, a read
 * that was under way when the change was made.
 *
 * Redis is a stand-in: one map every "process" shares (each CacheGenerations
 * is a process's own state), whose reads and writes can be made to fail or
 * to wait.
 */

const NAMESPACE: string = "cache-generations-test";
const KEY: string = "generation-a";
const OTHER_KEY: string = "generation-b";
const TTL_SECONDS: number = 24 * 60 * 60;

// Redis as every process sees it, by namespaced key.
let redis: Map<string, string>;
let readsFail: boolean;
let writesFail: boolean;
let readCalls: number;
let writeCalls: Array<{ key: string; value: string; options: unknown }>;

// A read or write held until the test lets it go.
let heldReads: Array<() => void>;
let holdReads: boolean;
let heldWrites: Array<() => void>;
let holdWrites: boolean;

let now: number;

function process(): CacheGenerations {
  return new CacheGenerations({
    namespace: NAMESPACE,
    ttlSeconds: TTL_SECONDS,
    maxKeys: 100,
    description: "test entries",
  });
}

function storedGeneration(key: string = KEY): string | undefined {
  return redis.get(`${NAMESPACE}-${key}`);
}

// Lets the time a remembered shared part is kept go by.
function afterSharedReadTtl(): void {
  now += CacheGenerations.SHARED_READ_TTL_MS + 1;
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  redis = new Map();
  readsFail = false;
  writesFail = false;
  readCalls = 0;
  writeCalls = [];
  heldReads = [];
  holdReads = false;
  heldWrites = [];
  holdWrites = false;
  now = Date.UTC(2026, 9, 7, 12, 0, 0);

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        readCalls++;

        // What Redis holds when the read is asked, not when it answers.
        const value: string | null = redis.get(`${namespace}-${key}`) || null;
        const failing: boolean = readsFail;

        if (holdReads) {
          await new Promise<void>((resolve: () => void) => {
            heldReads.push(resolve);
          });
        }

        if (failing) {
          throw new Error("Cache is not connected");
        }

        return value;
      },
    );

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: unknown,
      ): Promise<void> => {
        writeCalls.push({ key, value, options });

        if (holdWrites) {
          await new Promise<void>((resolve: () => void) => {
            heldWrites.push(resolve);
          });
        }

        if (writesFail) {
          throw new Error("Cache is not connected");
        }

        redis.set(`${namespace}-${key}`, value);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CacheGenerations.get", () => {
  test("a key no change started a generation for reads as the default, in both parts", async () => {
    expect(await process().get(KEY)).toBe(
      `${DEFAULT_GENERATION}.${DEFAULT_GENERATION}`,
    );
  });

  test("asks Redis once per key for SHARED_READ_TTL_MS, not on every request", async () => {
    const here: CacheGenerations = process();

    await here.get(KEY);
    await here.get(KEY);
    await here.get(OTHER_KEY);

    expect(readCalls).toBe(2);

    afterSharedReadTtl();
    await here.get(KEY);

    expect(readCalls).toBe(3);
  });

  test("requests that ask together share one read of Redis", async () => {
    const here: CacheGenerations = process();

    const generations: Array<string> = await Promise.all([
      here.get(KEY),
      here.get(KEY),
      here.get(KEY),
    ]);

    expect(readCalls).toBe(1);
    expect(new Set(generations).size).toBe(1);
  });

  test("keys are kept apart: a change of one leaves the others", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(OTHER_KEY);

    await here.bump([KEY]);

    expect(await here.get(OTHER_KEY)).toBe(before);
  });
});

describe("CacheGenerations.bump while Redis takes it", () => {
  test("starts a new generation here at once, before Redis has answered", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    holdWrites = true;
    const bumping: Promise<void> = here.bump([KEY]);
    await settle();

    // The write is still under way: the change already counts here.
    expect(heldWrites).toHaveLength(1);
    expect(await here.get(KEY)).not.toBe(before);

    for (const release of heldWrites) {
      release();
    }
    await bumping;

    expect(await here.get(KEY)).not.toBe(before);
  });

  test("every other process sees it within SHARED_READ_TTL_MS, and this one shares their generation again", async () => {
    const here: CacheGenerations = process();
    const elsewhere: CacheGenerations = process();

    const before: string = await elsewhere.get(KEY);

    await here.bump([KEY]);

    // Elsewhere goes by what it read for a moment, then reads the change.
    expect(await elsewhere.get(KEY)).toBe(before);
    afterSharedReadTtl();

    const seenElsewhere: string = await elsewhere.get(KEY);

    expect(seenElsewhere).not.toBe(before);
    // Once Redis holds it, both keep their entries under one generation.
    expect(await here.get(KEY)).toBe(seenElsewhere);
    expect(seenElsewhere).toBe(`${storedGeneration()}.${DEFAULT_GENERATION}`);
  });

  test("writes each key once, with the generation's lifetime, every key together", async () => {
    const here: CacheGenerations = process();

    holdWrites = true;
    const bumping: Promise<void> = here.bump([KEY, OTHER_KEY, KEY]);
    await settle();

    // Both asked before either answered; the repeated key once.
    expect(heldWrites).toHaveLength(2);

    for (const release of heldWrites) {
      release();
    }
    await bumping;

    expect(
      writeCalls.map((call: { key: string }): string => {
        return call.key;
      }),
    ).toEqual([KEY, OTHER_KEY]);

    for (const call of writeCalls) {
      expect(call.options).toEqual({ expiresInSeconds: TTL_SECONDS });
      expect(call.value).toMatch(/^[0-9a-z]+-[0-9a-f]{12}$/);
    }
  });

  test("each change is a new, unpredictable generation: two in a row never bring back the first", async () => {
    const here: CacheGenerations = process();
    const seen: Set<string> = new Set([await here.get(KEY)]);

    for (let i: number = 0; i < 5; i++) {
      await here.bump([KEY]);
      seen.add(await here.get(KEY));
    }

    expect(seen.size).toBe(6);
  });

  test("a read that started before the change never decides after it", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    // A read under way, of Redis as it was before the change.
    afterSharedReadTtl();
    holdReads = true;
    const reading: Promise<string> = here.get(KEY);
    await settle();
    expect(heldReads).toHaveLength(1);

    holdReads = false;
    await here.bump([KEY]);

    for (const release of heldReads) {
      release();
    }

    // The request that asked before the change may get the old one...
    expect(await reading).toBe(before);
    // ...but nothing asked after it does.
    expect(await here.get(KEY)).not.toBe(before);
    expect(await here.get(KEY)).toBe(
      `${storedGeneration()}.${DEFAULT_GENERATION}`,
    );
  });
});

describe("CacheGenerations.bump when Redis does not take it", () => {
  test("the change still counts in this process, and Redis keeps the generation from before", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    writesFail = true;
    await here.bump([KEY]);

    expect(storedGeneration()).toBeUndefined();
    expect(await here.get(KEY)).not.toBe(before);
  });

  test("it still counts once Redis answers again with the generation from before, while Redis takes no write", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    writesFail = true;
    await here.bump([KEY]);
    const afterChange: string = await here.get(KEY);

    // Redis answers reads again, still with the generation from before.
    afterSharedReadTtl();

    const later: string = await here.get(KEY);

    expect(later).not.toBe(before);
    expect(later).toBe(afterChange);
  });

  test("it still counts through an outage, and once Redis answers again", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    readsFail = true;
    writesFail = true;
    afterSharedReadTtl();

    const inOutage: string = await here.get(KEY);
    await here.bump([KEY]);
    const changedInOutage: string = await here.get(KEY);

    expect(changedInOutage).not.toBe(inOutage);
    expect(changedInOutage).not.toBe(before);

    // Back, with the generation from before the outage.
    readsFail = false;
    afterSharedReadTtl();

    const back: string = await here.get(KEY);

    expect(back).not.toBe(before);
    expect(back).not.toBe(inOutage);
  });

  test("once Redis answers again it is written to Redis, so every other process sees it too", async () => {
    const here: CacheGenerations = process();
    const elsewhere: CacheGenerations = process();

    const before: string = await elsewhere.get(KEY);
    await here.get(KEY);

    writesFail = true;
    await here.bump([KEY]);
    expect(storedGeneration()).toBeUndefined();

    // Redis takes writes again: this process's next read of the key sends it.
    writesFail = false;
    afterSharedReadTtl();

    const here1: string = await here.get(KEY);

    expect(storedGeneration()).toBeDefined();
    expect(here1).toBe(`${storedGeneration()}.${DEFAULT_GENERATION}`);

    // Elsewhere sees it within SHARED_READ_TTL_MS, and shares it.
    afterSharedReadTtl();

    const seenElsewhere: string = await elsewhere.get(KEY);

    expect(seenElsewhere).not.toBe(before);
    expect(seenElsewhere).toBe(here1);
  });

  test("a write that keeps failing is tried again at most once per SHARED_READ_TTL_MS, and the change keeps counting", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    writesFail = true;
    await here.bump([KEY]);
    expect(writeCalls).toHaveLength(1);

    afterSharedReadTtl();

    // Many requests, one second: one more attempt.
    for (let i: number = 0; i < 10; i++) {
      expect(await here.get(KEY)).not.toBe(before);
    }

    expect(writeCalls).toHaveLength(2);

    afterSharedReadTtl();
    await Promise.all([here.get(KEY), here.get(KEY), here.get(KEY)]);

    expect(writeCalls).toHaveLength(3);
    expect(await here.get(KEY)).not.toBe(before);
  });

  test("nothing is written again while Redis cannot be reached", async () => {
    const here: CacheGenerations = process();

    readsFail = true;
    writesFail = true;
    await here.bump([KEY]);

    for (let i: number = 0; i < 3; i++) {
      afterSharedReadTtl();
      await here.get(KEY);
    }

    // The bump's own write only.
    expect(writeCalls).toHaveLength(1);
  });

  test("a later change Redis takes settles an earlier one it did not", async () => {
    const here: CacheGenerations = process();
    const elsewhere: CacheGenerations = process();

    await elsewhere.get(KEY);

    writesFail = true;
    await here.bump([KEY]);

    writesFail = false;
    await here.bump([KEY]);

    const settled: string = await here.get(KEY);

    // Nothing left to send: one write per change, none again.
    afterSharedReadTtl();
    await here.get(KEY);

    expect(writeCalls).toHaveLength(2);
    expect(settled).toBe(`${storedGeneration()}.${DEFAULT_GENERATION}`);

    afterSharedReadTtl();
    expect(await elsewhere.get(KEY)).toBe(settled);
  });

  test("an earlier change that lands after a later one failed keeps the later one counting here", async () => {
    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    // The first change's write waits; the second's fails meanwhile.
    holdWrites = true;
    const first: Promise<void> = here.bump([KEY]);
    await settle();

    holdWrites = false;
    writesFail = true;
    await here.bump([KEY]);
    const afterSecond: string = await here.get(KEY);

    // The first lands now, with its own token.
    writesFail = false;
    for (const release of heldWrites) {
      release();
    }
    await first;

    const now1: string = await here.get(KEY);

    expect(now1).not.toBe(before);
    // Redis holds the first change; the second still counts here on top.
    expect(now1).not.toBe(`${storedGeneration()}.${DEFAULT_GENERATION}`);
    expect(now1.endsWith(afterSecond.split(".")[1]!)).toBe(true);
  });
});

describe("CacheGenerations while Redis cannot be reached", () => {
  test("the shared part reads as UNREACHABLE, asked of Redis once per SHARED_READ_TTL_MS", async () => {
    const here: CacheGenerations = process();

    readsFail = true;

    const generations: Array<string> = await Promise.all([
      here.get(KEY),
      here.get(KEY),
    ]);
    await here.get(KEY);

    expect(readCalls).toBe(1);
    expect(generations[0]!.startsWith(UNREACHABLE_GENERATION)).toBe(true);

    afterSharedReadTtl();
    await here.get(KEY);

    expect(readCalls).toBe(2);
  });

  test("a generation read in an outage is never one read while Redis answers, either way", async () => {
    const here: CacheGenerations = process();

    const reachable: string = await here.get(KEY);

    readsFail = true;
    afterSharedReadTtl();

    const unreachable: string = await here.get(KEY);

    expect(unreachable).not.toBe(reachable);

    readsFail = false;
    afterSharedReadTtl();

    expect(await here.get(KEY)).toBe(reachable);
    expect(await here.get(KEY)).not.toBe(unreachable);
  });

  test("entries kept in one outage are not served in the next once a change came between", async () => {
    const here: CacheGenerations = process();
    const elsewhere: CacheGenerations = process();

    readsFail = true;
    const firstOutage: string = await here.get(KEY);

    // Between outages, another process changes the key, and this one reads it.
    readsFail = false;
    await elsewhere.bump([KEY]);
    afterSharedReadTtl();
    await here.get(KEY);

    readsFail = true;
    afterSharedReadTtl();

    expect(await here.get(KEY)).not.toBe(firstOutage);
  });

  test("an outage with no change between keeps the generation it had", async () => {
    const here: CacheGenerations = process();

    await here.get(KEY);

    readsFail = true;
    afterSharedReadTtl();
    const firstOutage: string = await here.get(KEY);

    readsFail = false;
    afterSharedReadTtl();
    await here.get(KEY);

    readsFail = true;
    afterSharedReadTtl();

    expect(await here.get(KEY)).toBe(firstOutage);
  });
});

describe("CacheGenerations never throws, and logs no key", () => {
  test("every way Redis can fail: reads and writes, and the request still gets a generation", async () => {
    const here: CacheGenerations = process();

    readsFail = true;
    writesFail = true;

    await expect(here.bump([KEY])).resolves.toBeUndefined();
    await expect(here.get(KEY)).resolves.toEqual(expect.any(String));

    readsFail = false;
    afterSharedReadTtl();

    await expect(here.get(KEY)).resolves.toEqual(expect.any(String));
  });

  test("a Redis that is not connected at all (GlobalCache throws)", async () => {
    jest.restoreAllMocks();
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Cache is not connected"));
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected"));

    const here: CacheGenerations = process();
    const before: string = await here.get(KEY);

    await expect(here.bump([KEY])).resolves.toBeUndefined();
    expect(await here.get(KEY)).not.toBe(before);
  });

  test("failures are logged at debug only, never naming a key", async () => {
    (logger.debug as unknown as Mock).mockClear();
    (logger.warn as unknown as Mock).mockClear();
    (logger.error as unknown as Mock).mockClear();

    const here: CacheGenerations = process();

    readsFail = true;
    writesFail = true;

    await here.get(KEY);
    await here.bump([KEY]);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();

    for (const call of (logger.debug as unknown as Mock).mock.calls) {
      expect(String(call[0])).not.toContain(KEY);
    }
  });
});

describe("CacheGenerations.clear", () => {
  test("forgets this process's parts, and a read under way when it clears does not come back", async () => {
    const here: CacheGenerations = process();

    writesFail = true;
    await here.bump([KEY]);
    const changed: string = await here.get(KEY);

    writesFail = false;
    afterSharedReadTtl();
    holdReads = true;
    const reading: Promise<string> = here.get(KEY);
    await settle();

    here.clear();
    redis.set(`${NAMESPACE}-${KEY}`, "after-clear");

    for (const release of heldReads) {
      release();
    }
    await reading;
    holdReads = false;

    // Read again from Redis, with no own part left.
    expect(await here.get(KEY)).toBe(`after-clear.${DEFAULT_GENERATION}`);
    expect(await here.get(KEY)).not.toBe(changed);
  });
});
