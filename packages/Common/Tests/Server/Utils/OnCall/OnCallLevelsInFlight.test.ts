import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import OnCallLevelsInFlight, {
  OnCallLevelInFlight,
} from "../../../../Server/Utils/OnCall/OnCallLevelsInFlight";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN ESCALATION LEVEL WHILE IT PAGES, KEPT IN REDIS (issue #8406).
 *
 * A level is kept while it pages its people, with a sign of life after
 * each, and stopped if its paging fails: one that stopped, or shows no sign
 * of life for two minutes, never finished, and the policy-run worker
 * resumes it. Nothing here throws: a Redis that is down keeps nothing.
 */

const RUN: ObjectID = new ObjectID("84060000-0000-4000-8000-0000000000a1");
const OTHER_RUN: ObjectID = new ObjectID(
  "84060000-0000-4000-8000-0000000000a2",
);
const STARTED: Date = new Date("2026-11-15T03:10:00.000Z");
const MINUTE: number = 60 * 1000;

function level(data: Partial<OnCallLevelInFlight> = {}): OnCallLevelInFlight {
  return {
    ruleId: "84060000-0000-4000-8000-0000000000b1",
    startedAt: STARTED,
    heartbeatAt: STARTED,
    stopped: false,
    ...data,
  };
}

let kept: Map<string, string>;
let isRedisDown: boolean;

beforeEach(() => {
  kept = new Map();
  isRedisDown = false;

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);

  const down: () => void = () => {
    if (isRedisDown) {
      throw new Error("Cache is not connected");
    }
  };

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    down();
    kept.set(`${namespace}-${key}`, value);
  }) as never);

  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    namespace: string,
    keys: Array<string>,
  ) => {
    down();
    return keys.map((key: string) => {
      return kept.get(`${namespace}-${key}`) || null;
    });
  }) as never);

  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    down();
    kept.delete(`${namespace}-${key}`);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a level in flight", () => {
  test("is read back as it was kept, one round trip for a page of runs", async () => {
    await OnCallLevelsInFlight.keep(RUN, level({ stopped: true }));

    const read: Map<string, OnCallLevelInFlight> =
      await OnCallLevelsInFlight.read([RUN, null, OTHER_RUN]);

    expect(GlobalCache.getStrings).toHaveBeenCalledTimes(1);
    expect(Array.from(read.keys())).toEqual([RUN.toString()]);
    expect(read.get(RUN.toString())).toEqual(level({ stopped: true }));
  });

  test("is forgotten once every person it names was handed a page", async () => {
    await OnCallLevelsInFlight.keep(RUN, level());
    await OnCallLevelsInFlight.forget(RUN);

    expect((await OnCallLevelsInFlight.read([RUN])).size).toBe(0);
  });

  test("a Redis that is down keeps nothing, reads none, and never throws", async () => {
    isRedisDown = true;

    await expect(
      OnCallLevelsInFlight.keep(RUN, level()),
    ).resolves.toBeUndefined();
    await expect(OnCallLevelsInFlight.forget(RUN)).resolves.toBeUndefined();
    await expect(OnCallLevelsInFlight.read([RUN])).resolves.toEqual(new Map());
  });

  test.each([
    ["nothing", null],
    ["not JSON", "{oops"],
    ["no rule", JSON.stringify({ startedAt: 1, heartbeatAt: 1 })],
    [
      "a moment that is not one",
      JSON.stringify({ ruleId: "r", startedAt: "soon", heartbeatAt: 1 }),
    ],
  ])("is none for %s", (_name: string, value: string | null) => {
    expect(OnCallLevelsInFlight.fromCacheValue(value)).toBeNull();
  });
});

describe("whether a level is resumed", () => {
  test("one still paging - a sign of life within two minutes - is left to it", () => {
    expect(
      OnCallLevelsInFlight.isToResume(
        level(),
        new Date(STARTED.getTime() + 2 * MINUTE - 1),
      ),
    ).toBe(false);
  });

  test("one with no sign of life for two minutes never finished: its process stopped", () => {
    expect(
      OnCallLevelsInFlight.isToResume(
        level(),
        new Date(STARTED.getTime() + 2 * MINUTE),
      ),
    ).toBe(true);
  });

  test("one whose paging failed is resumed at once", () => {
    expect(
      OnCallLevelsInFlight.isToResume(level({ stopped: true }), STARTED),
    ).toBe(true);
  });

  test("a sign of life keeps a long level from being resumed while it pages", () => {
    const late: Date = new Date(STARTED.getTime() + 5 * MINUTE);

    expect(
      OnCallLevelsInFlight.isToResume(
        level({ heartbeatAt: new Date(late.getTime() - MINUTE) }),
        late,
      ),
    ).toBe(false);
  });
});
