import StatusPageSharedReads, {
  SharedRead,
  STATUS_PAGE_SHARED_READS_NAMESPACE,
} from "../../../../Server/Utils/StatusPage/StatusPageSharedReads";
import { JSONObject } from "../../../../Types/JSON";
import FakeGlobalCacheStrings from "../../TestingUtils/Redis/FakeGlobalCacheStrings";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A status page's overview and lists, built by one pod for every pod: kept
 * in Redis for the rest of their lifetime, the build claimed so the others
 * wait for it rather than build it too, and nothing ever served past the
 * lifetime of the build that made it. Redis is a stand-in every "pod"
 * shares; one that cannot be reached is each pod building its own.
 */

const KEY: string = "overview|page-1|generation-1";
const TTL_MS: number = 15_000;

const ENTRY_KEY: string = `${STATUS_PAGE_SHARED_READS_NAMESPACE}-${StatusPageSharedReads.entryKey(KEY)}`;
const CLAIM_KEY: string = `${STATUS_PAGE_SHARED_READS_NAMESPACE}-${StatusPageSharedReads.claimKey(KEY)}`;

const DEFAULTS: {
  wait: number;
  poll: number;
  maxBytes: number;
} = {
  wait: StatusPageSharedReads.BUILD_WAIT_MS,
  poll: StatusPageSharedReads.BUILD_POLL_MS,
  maxBytes: StatusPageSharedReads.MAX_ENTRY_BYTES,
};

let redis: FakeGlobalCacheStrings;

// A build that answers a new value each time, counting its calls.
function counter(): Mock<() => Promise<JSONObject>> {
  let built: number = 0;

  return jest.fn(async (): Promise<JSONObject> => {
    built++;
    return { build: built };
  });
}

async function read(
  build: () => Promise<JSONObject>,
  options?: { key?: string; expiresAt?: number },
): Promise<SharedRead<JSONObject>> {
  return await StatusPageSharedReads.getOrBuild<JSONObject>({
    key: options?.key || KEY,
    ttlMs: TTL_MS,
    expiresAt: options?.expiresAt,
    build: build,
    toJSON: (value: JSONObject): unknown => {
      return value;
    },
    fromJSON: (json: unknown): JSONObject => {
      if (!json || typeof json !== "object") {
        throw new Error("not a value");
      }
      return json as JSONObject;
    },
  });
}

// Lets the write the build started (not awaited) land.
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

function moveClock(ms: number): void {
  const now: number = Date.now() + ms;
  jest.spyOn(Date, "now").mockReturnValue(now);
}

beforeEach(() => {
  redis = new FakeGlobalCacheStrings().install();
  StatusPageSharedReads.BUILD_WAIT_MS = 300;
  StatusPageSharedReads.BUILD_POLL_MS = 10;
});

afterEach(() => {
  jest.restoreAllMocks();
  StatusPageSharedReads.BUILD_WAIT_MS = DEFAULTS.wait;
  StatusPageSharedReads.BUILD_POLL_MS = DEFAULTS.poll;
  StatusPageSharedReads.MAX_ENTRY_BYTES = DEFAULTS.maxBytes;
});

describe("StatusPageSharedReads.getOrBuild", () => {
  test("builds a value nobody has, writes it to Redis, and hands it out for the lifetime of its build", async () => {
    const build: Mock<() => Promise<JSONObject>> = counter();
    const before: number = Date.now();

    const first: SharedRead<JSONObject> = await read(build);
    await settle();

    expect(first.value).toEqual({ build: 1 });
    expect(first.expiresAt).toBeGreaterThanOrEqual(before + TTL_MS);
    expect(first.expiresAt).toBeLessThanOrEqual(Date.now() + TTL_MS);
    expect(JSON.parse(redis.peek(ENTRY_KEY)!)).toMatchObject({
      value: { build: 1 },
      expiresAt: first.expiresAt,
    });
  });

  test("a value another pod built is read, not built again - with the lifetime it was built with", async () => {
    const build: Mock<() => Promise<JSONObject>> = counter();

    const first: SharedRead<JSONObject> = await read(build);
    await settle();

    const elsewhere: SharedRead<JSONObject> = await read(build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(elsewhere.value).toEqual(first.value);
    expect(elsewhere.expiresAt).toBe(first.expiresAt);
  });

  test("a value whose lifetime ran out is built again", async () => {
    const build: Mock<() => Promise<JSONObject>> = counter();

    await read(build);
    await settle();

    moveClock(TTL_MS + 1);

    const again: SharedRead<JSONObject> = await read(build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(again.value).toEqual({ build: 2 });
  });

  test("a value read 10 s into its lifetime is served for the 5 s it has left, never a new 15 s", async () => {
    const build: Mock<() => Promise<JSONObject>> = counter();

    const built: SharedRead<JSONObject> = await read(build);
    await settle();

    moveClock(10_000);

    const later: SharedRead<JSONObject> = await read(build);

    expect(later.expiresAt).toBe(built.expiresAt);
    expect(later.expiresAt - Date.now()).toBeLessThanOrEqual(5_000);
  });

  test("pods that miss together build once: the others wait for the value the first claimed", async () => {
    let finish: (value: JSONObject) => void = (): void => {};
    const slowBuild: Mock<() => Promise<JSONObject>> = jest.fn(() => {
      return new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        finish = resolve;
      });
    });
    const otherBuild: Mock<() => Promise<JSONObject>> = counter();

    const claimant: Promise<SharedRead<JSONObject>> = read(slowBuild);
    await settle();

    // Another pod misses meanwhile: the build is claimed, so it waits.
    const waiter: Promise<SharedRead<JSONObject>> = read(otherBuild);
    await settle();

    finish({ built: "by the claimant" });

    expect((await claimant).value).toEqual({ built: "by the claimant" });
    expect((await waiter).value).toEqual({ built: "by the claimant" });
    expect(otherBuild).not.toHaveBeenCalled();
  });

  test("a build that fails is never written, and gives its claim up, so a waiting pod builds at once", async () => {
    const failing: Mock<() => Promise<JSONObject>> = jest.fn(async () => {
      throw new Error("Postgres is down");
    });

    await expect(read(failing)).rejects.toThrow("Postgres is down");
    await settle();

    expect(redis.peek(ENTRY_KEY)).toBeNull();
    expect(redis.peek(CLAIM_KEY)).toBeNull();

    const build: Mock<() => Promise<JSONObject>> = counter();
    const started: number = Date.now();

    expect((await read(build)).value).toEqual({ build: 1 });
    expect(Date.now() - started).toBeLessThan(
      StatusPageSharedReads.BUILD_WAIT_MS,
    );
  });

  test("a claim whose builder never writes is waited for BUILD_WAIT_MS at most, then the pod builds itself", async () => {
    redis.setRaw(CLAIM_KEY, "a pod that went away", 60);

    const build: Mock<() => Promise<JSONObject>> = counter();
    const started: number = Date.now();

    const value: SharedRead<JSONObject> = await read(build);

    expect(value.value).toEqual({ build: 1 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(
      StatusPageSharedReads.BUILD_WAIT_MS - 20,
    );
  });

  test("a value over MAX_ENTRY_BYTES is never written: each pod keeps its own", async () => {
    StatusPageSharedReads.MAX_ENTRY_BYTES = 64;

    const big: Mock<() => Promise<JSONObject>> = jest.fn(async () => {
      return { text: "x".repeat(200) };
    });

    expect((await read(big)).value).toEqual({ text: "x".repeat(200) });
    await settle();

    expect(redis.peek(ENTRY_KEY)).toBeNull();
  });

  test("while Redis cannot be reached, each pod builds its own and nothing throws", async () => {
    redis.isReachable = false;

    const build: Mock<() => Promise<JSONObject>> = counter();

    expect((await read(build)).value).toEqual({ build: 1 });
    expect((await read(build)).value).toEqual({ build: 2 });
  });

  test("a value that cannot be read back is built again", async () => {
    redis.setRaw(ENTRY_KEY, "not json");

    const build: Mock<() => Promise<JSONObject>> = counter();

    expect((await read(build)).value).toEqual({ build: 1 });
  });

  test("a value from a pod whose clock is far ahead is not believed", async () => {
    const future: number = Date.now() + 60_000;

    redis.setRaw(
      ENTRY_KEY,
      JSON.stringify({
        builtAt: future,
        expiresAt: future + TTL_MS,
        value: { from: "the future" },
      }),
    );

    const build: Mock<() => Promise<JSONObject>> = counter();

    expect((await read(build)).value).toEqual({ build: 1 });
  });

  test("a value is never served past its build's start plus the lifetime asked for, whatever it says", async () => {
    const now: number = Date.now();

    redis.setRaw(
      ENTRY_KEY,
      JSON.stringify({
        builtAt: now - TTL_MS - 1,
        expiresAt: now + 60 * 60 * 1000,
        value: { kept: "too long" },
      }),
    );

    const build: Mock<() => Promise<JSONObject>> = counter();

    expect((await read(build)).value).toEqual({ build: 1 });
  });

  test("expiresAt caps a value's lifetime: what belongs to another runs out with it", async () => {
    const build: Mock<() => Promise<JSONObject>> = counter();
    const ownerExpiresAt: number = Date.now() + 3_000;

    const value: SharedRead<JSONObject> = await read(build, {
      expiresAt: ownerExpiresAt,
    });
    await settle();

    expect(value.expiresAt).toBe(ownerExpiresAt);

    moveClock(3_001);

    expect((await read(build, { expiresAt: ownerExpiresAt })).value).toEqual({
      build: 2,
    });
  });

  test("a value shouldKeep refuses is handed out but never written, and its claim is let go", async () => {
    const value: SharedRead<JSONObject> =
      await StatusPageSharedReads.getOrBuild<JSONObject>({
        key: KEY,
        ttlMs: TTL_MS,
        build: async (): Promise<JSONObject> => {
          return { incidents: [] };
        },
        toJSON: (json: JSONObject): unknown => {
          return json;
        },
        fromJSON: (json: unknown): JSONObject => {
          return json as JSONObject;
        },
        shouldKeep: (json: JSONObject): boolean => {
          return (json["incidents"] as Array<unknown>).length > 0;
        },
      });
    await settle();

    expect(value.value).toEqual({ incidents: [] });
    expect(redis.peek(ENTRY_KEY)).toBeNull();
    expect(redis.peek(CLAIM_KEY)).toBeNull();
  });

  test("keeps each key apart", async () => {
    const build: Mock<() => Promise<JSONObject>> = counter();

    await read(build, { key: "overview|page-1|generation-1" });
    await settle();
    await read(build, { key: "overview|page-2|generation-1" });
    await settle();
    await read(build, { key: "overview|page-1|generation-2" });

    expect(build).toHaveBeenCalledTimes(3);
  });
});
