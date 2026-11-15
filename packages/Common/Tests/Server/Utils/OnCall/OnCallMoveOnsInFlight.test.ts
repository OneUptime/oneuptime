import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import OnCallMoveOnsInFlight, {
  OnCallMoveOnInFlight,
} from "../../../../Server/Utils/OnCall/OnCallMoveOnsInFlight";
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
 * A RUN'S MOVE ON WHILE IT IS UNDER WAY, KEPT IN REDIS (issue #8410).
 *
 * What giving a move on's claim back needs is kept from just before the
 * claim until the move is done; one still here two minutes after its claim
 * never finished, and the worker gives its claim back. Nothing here
 * throws: a Redis that is down keeps nothing.
 */

const RUN: ObjectID = new ObjectID("84100000-0000-4000-8000-0000000000a1");
const CLAIMED: Date = new Date("2026-11-15T03:10:00.000Z");
const MINUTE: number = 60 * 1000;

function moveOn(
  data: Partial<OnCallMoveOnInFlight> = {},
): OnCallMoveOnInFlight {
  return {
    claimedAt: CLAIMED,
    previousLastEscalationRuleExecutedAt: new Date(
      CLAIMED.getTime() - 10 * MINUTE,
    ),
    lastExecutedEscalationRuleId: "84100000-0000-4000-8000-0000000000b1",
    onCallPolicyExecutionRepeatCount: 1,
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

describe("a move on in flight", () => {
  test("is read back as it was kept", async () => {
    await OnCallMoveOnsInFlight.keep(RUN, moveOn());

    expect(
      (await OnCallMoveOnsInFlight.read([RUN, null])).get(RUN.toString()),
    ).toEqual(moveOn());
  });

  test("of a run that had no moment yet, nor a rule, reads back with none", async () => {
    const first: OnCallMoveOnInFlight = moveOn({
      previousLastEscalationRuleExecutedAt: null,
      lastExecutedEscalationRuleId: null,
      onCallPolicyExecutionRepeatCount: null,
    });

    await OnCallMoveOnsInFlight.keep(RUN, first);

    expect(
      (await OnCallMoveOnsInFlight.read([RUN])).get(RUN.toString()),
    ).toEqual(first);
  });

  test("is forgotten once the move is done", async () => {
    await OnCallMoveOnsInFlight.keep(RUN, moveOn());
    await OnCallMoveOnsInFlight.forget(RUN);

    expect((await OnCallMoveOnsInFlight.read([RUN])).size).toBe(0);
  });

  test("a Redis that is down keeps nothing, reads none, and never throws", async () => {
    isRedisDown = true;

    await expect(
      OnCallMoveOnsInFlight.keep(RUN, moveOn()),
    ).resolves.toBeUndefined();
    await expect(OnCallMoveOnsInFlight.forget(RUN)).resolves.toBeUndefined();
    await expect(OnCallMoveOnsInFlight.read([RUN])).resolves.toEqual(new Map());
  });

  test.each([
    ["nothing", null],
    ["not JSON", "{oops"],
    [
      "no claim moment",
      JSON.stringify({ previousLastEscalationRuleExecutedAt: null }),
    ],
    [
      "a previous moment that is not one",
      JSON.stringify({
        claimedAt: 1,
        previousLastEscalationRuleExecutedAt: "soon",
        lastExecutedEscalationRuleId: null,
        onCallPolicyExecutionRepeatCount: null,
      }),
    ],
  ])("is none for %s", (_name: string, value: string | null) => {
    expect(OnCallMoveOnsInFlight.fromCacheValue(value)).toBeNull();
  });
});

describe("whether a move on's claim is given back", () => {
  test("not while the move may still be under way: a tick after its claim", () => {
    expect(
      OnCallMoveOnsInFlight.isToGiveBack(
        moveOn(),
        new Date(CLAIMED.getTime() + MINUTE + 30 * 1000 - 1),
      ),
    ).toBe(false);
  });

  test("two minutes after its claim, it never finished", () => {
    expect(
      OnCallMoveOnsInFlight.isToGiveBack(
        moveOn(),
        new Date(CLAIMED.getTime() + 2 * MINUTE),
      ),
    ).toBe(true);
  });

  /*
   * A tick comes at about the same second of each minute: a claim taken a
   * moment into one tick is given back at the tick two minutes on, not a
   * third (issue #8515).
   */
  test("a claim taken a moment after a tick is given back at the tick two minutes on", () => {
    expect(
      OnCallMoveOnsInFlight.isToGiveBack(
        moveOn({ claimedAt: new Date(CLAIMED.getTime() + 1) }),
        new Date(CLAIMED.getTime() + 2 * MINUTE),
      ),
    ).toBe(true);
  });
});
