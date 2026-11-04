import { describe, expect, test } from "@jest/globals";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  BACKOFF_BASE_IN_MS,
  MAX_BACKOFF_IN_MS,
  MAX_RETRY_DELAY_IN_MS,
  OpenStackBackoffEntry,
  OpenStackBackoffMemory,
  RETRY_BASE_DELAY_IN_MS,
  computeBackoffInMs,
  computeRetryDelayInMs,
  parseRetryAfter,
} from "../../../Utils/OpenStack/OpenStackBackoff";

/*
 * Staying out of the way of a cloud that is struggling: a request tried again later, and
 * a service asked less and less often.
 */

const NOW: number = Date.parse("2026-11-04T12:00:00.000Z");

describe("Retry-After", () => {
  test.each([
    ["seconds", "30", 30_000],
    ["seconds with spaces", " 5 ", 5000],
    ["no seconds", "0", 0],
    ["an array of one", ["7"], 7000],
    ["a date ahead", "Wed, 04 Nov 2026 12:00:10 GMT", 10_000],
    ["a date already gone", "Wed, 04 Nov 2026 11:59:00 GMT", 0],
  ])("%s", (_name: string, value: string | Array<string>, expected: number) => {
    expect(parseRetryAfter(value, NOW)).toBe(expected);
  });

  test.each([
    ["nothing", undefined],
    ["blank", "   "],
    ["words", "soon"],
    ["a negative", "-5"],
  ])("%s says nothing usable", (_name: string, value: string | undefined) => {
    expect(parseRetryAfter(value, NOW)).toBeNull();
  });
});

describe("waiting to try one request again", () => {
  test("what the service asked for wins", () => {
    expect(
      computeRetryDelayInMs({
        attempt: 1,
        retryAfter: "12",
        now: NOW,
        random: 0,
      }),
    ).toBe(12_000);
  });

  test("however long it asks for, a collection only holds still for so long", () => {
    expect(
      computeRetryDelayInMs({
        attempt: 1,
        retryAfter: "3600",
        now: NOW,
        random: 0,
      }),
    ).toBe(MAX_RETRY_DELAY_IN_MS);
  });

  test("without one it doubles, each wait somewhere in the upper half so retries spread", () => {
    expect(
      computeRetryDelayInMs({
        attempt: 1,
        retryAfter: undefined,
        now: NOW,
        random: 0,
      }),
    ).toBe(RETRY_BASE_DELAY_IN_MS / 2);
    expect(
      computeRetryDelayInMs({
        attempt: 1,
        retryAfter: undefined,
        now: NOW,
        random: 1,
      }),
    ).toBe(RETRY_BASE_DELAY_IN_MS);
    expect(
      computeRetryDelayInMs({
        attempt: 2,
        retryAfter: undefined,
        now: NOW,
        random: 1,
      }),
    ).toBe(RETRY_BASE_DELAY_IN_MS * 2);
  });
});

describe("leaving something alone for a while", () => {
  test("each failure in a row doubles the wait", () => {
    const delays: Array<number> = [1, 2, 3, 4].map((failures: number) => {
      return computeBackoffInMs({
        failures: failures,
        baseInMs: BACKOFF_BASE_IN_MS,
        maxInMs: MAX_BACKOFF_IN_MS,
        random: 0.5,
      });
    });

    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000]);
  });

  test("it stops growing at half an hour", () => {
    expect(
      computeBackoffInMs({
        failures: 1000,
        baseInMs: BACKOFF_BASE_IN_MS,
        maxInMs: MAX_BACKOFF_IN_MS,
        random: 0.5,
      }),
    ).toBe(MAX_BACKOFF_IN_MS);
  });

  test("a jitter keeps clouds behind one Keystone from coming back together", () => {
    const at: (random: number) => number = (random: number): number => {
      return computeBackoffInMs({
        failures: 1,
        baseInMs: 100_000,
        maxInMs: MAX_BACKOFF_IN_MS,
        random: random,
      });
    };

    expect(at(0)).toBe(80_000);
    expect(at(1)).toBe(120_000);
  });
});

describe("what failed lately", () => {
  const failure: (now: number) => {
    now: number;
    random: number;
    baseInMs: number;
    maxInMs: number;
    code: OpenStackCollectionErrorCode;
    message: string;
  } = (now: number) => {
    return {
      now: now,
      random: 0.5,
      baseInMs: BACKOFF_BASE_IN_MS,
      maxInMs: MAX_BACKOFF_IN_MS,
      code: OpenStackCollectionErrorCode.KeystoneFailing,
      message: "Keystone is failing.",
    };
  };

  test("something that failed is held back until its time, and remembers why", () => {
    const memory: OpenStackBackoffMemory = new OpenStackBackoffMemory();

    memory.recordFailure("k", failure(NOW));

    expect(memory.check("k", NOW + 59_000)).toMatchObject({
      failures: 1,
      code: OpenStackCollectionErrorCode.KeystoneFailing,
      message: "Keystone is failing.",
    });
    expect(memory.check("k", NOW + 60_000)).toBeNull();
  });

  test("failing again waits longer, and working forgets it all", () => {
    const memory: OpenStackBackoffMemory = new OpenStackBackoffMemory();

    memory.recordFailure("k", failure(NOW));

    const second: OpenStackBackoffEntry = memory.recordFailure(
      "k",
      failure(NOW + 60_000),
    );

    expect(second.failures).toBe(2);
    expect(second.nextTryAt).toBe(NOW + 60_000 + 120_000);

    memory.recordSuccess("k");
    expect(memory.check("k", NOW)).toBeNull();

    expect(memory.recordFailure("k", failure(NOW)).failures).toBe(1);
  });

  test("something that never failed may be tried", () => {
    expect(new OpenStackBackoffMemory().check("k", NOW)).toBeNull();
  });

  test("it holds a bounded amount, oldest out first", () => {
    const memory: OpenStackBackoffMemory = new OpenStackBackoffMemory();

    for (let i: number = 0; i < 2100; i++) {
      memory.recordFailure(`k${i}`, failure(NOW));
    }

    expect(memory.size()).toBe(2000);
    expect(memory.check("k0", NOW)).toBeNull();
    expect(memory.check("k2099", NOW)).not.toBeNull();
  });
});
