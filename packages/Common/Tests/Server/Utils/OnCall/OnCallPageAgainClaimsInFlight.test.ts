import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import OnCallPageAgainClaimsInFlight, {
  OnCallPageAgainClaim,
} from "../../../../Server/Utils/OnCall/OnCallPageAgainClaimsInFlight";
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
 * THE PAGES AGAIN BETWEEN THEIR CLOCK STOP AND THEIR START, KEPT IN REDIS
 * (issue #8549).
 *
 * Each page again is kept from just before its clock stop until its start
 * is kept; the page-again tick settles one still here two minutes after
 * its claim. Nothing here throws: a Redis that is down keeps nothing, and
 * one that cannot be read is never written over.
 */

const RUN: ObjectID = new ObjectID("85490000-0000-4000-8000-0000000000a1");
const OTHER_RUN: ObjectID = new ObjectID(
  "85490000-0000-4000-8000-0000000000a2",
);
const CLAIMED: Date = new Date("2026-11-15T03:10:00.000Z");
const MINUTE: number = 60 * 1000;
const KEY: string = "on-call-pages-again-in-flight-claims";

function claim(data: Partial<OnCallPageAgainClaim> = {}): OnCallPageAgainClaim {
  return {
    claimedAt: CLAIMED,
    clockStartedAt: new Date(CLAIMED.getTime() - 30 * MINUTE),
    pageAgainNumber: 1,
    startAtRuleId: "85490000-0000-4000-8000-0000000000b1",
    acknowledgedByUserId: "85490000-0000-4000-8000-0000000000c1",
    minutes: 30,
    dueAt: new Date(CLAIMED.getTime() - 10 * 1000),
    pageAgainRunId: null,
    ...data,
  };
}

let kept: Map<string, string>;
let isRedisDown: boolean;
let isReadDown: boolean;

beforeEach(() => {
  kept = new Map();
  isRedisDown = false;
  isReadDown = false;

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);

  const down: () => void = () => {
    if (isRedisDown) {
      throw new Error("Cache is not connected");
    }
  };

  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    down();

    if (isReadDown) {
      throw new Error("Read timed out");
    }

    return kept.get(`${namespace}-${key}`) || null;
  }) as never);

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    down();
    kept.set(`${namespace}-${key}`, value);
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

describe("OnCallPageAgainClaimsInFlight", () => {
  test("keeps a page again as it goes on, and reads it back as kept", async () => {
    await OnCallPageAgainClaimsInFlight.keep(RUN, claim());
    await OnCallPageAgainClaimsInFlight.keep(
      RUN,
      claim({ pageAgainRunId: "85490000-0000-4000-8000-0000000000d1" }),
    );

    const claims: Map<string, OnCallPageAgainClaim> =
      await OnCallPageAgainClaimsInFlight.readAll();

    expect([...claims.keys()]).toEqual([RUN.toString()]);
    expect(claims.get(RUN.toString())).toEqual(
      claim({ pageAgainRunId: "85490000-0000-4000-8000-0000000000d1" }),
    );
  });

  test("keeps the pages again of different runs side by side, and forgets one without the other", async () => {
    await OnCallPageAgainClaimsInFlight.keep(RUN, claim());
    await OnCallPageAgainClaimsInFlight.keep(
      OTHER_RUN,
      claim({ pageAgainNumber: 2 }),
    );

    await OnCallPageAgainClaimsInFlight.forget(RUN);

    const claims: Map<string, OnCallPageAgainClaim> =
      await OnCallPageAgainClaimsInFlight.readAll();

    expect([...claims.keys()]).toEqual([OTHER_RUN.toString()]);
    expect(claims.get(OTHER_RUN.toString())!.pageAgainNumber).toBe(2);
  });

  test("forgetting the last one leaves nothing in Redis", async () => {
    await OnCallPageAgainClaimsInFlight.keep(RUN, claim());
    await OnCallPageAgainClaimsInFlight.forget(RUN);

    expect(kept.has(KEY)).toBe(false);
    expect((await OnCallPageAgainClaimsInFlight.readAll()).size).toBe(0);
  });

  test("a read that fails writes nothing, so the other pages again in flight are not lost", async () => {
    await OnCallPageAgainClaimsInFlight.keep(OTHER_RUN, claim());

    isReadDown = true;
    await OnCallPageAgainClaimsInFlight.keep(RUN, claim());
    isReadDown = false;

    const claims: Map<string, OnCallPageAgainClaim> =
      await OnCallPageAgainClaimsInFlight.readAll();

    expect([...claims.keys()]).toEqual([OTHER_RUN.toString()]);
  });

  test("is settled two minutes after its claim, with a tick's slack - not before", () => {
    const at: (ms: number) => Date = (ms: number): Date => {
      return new Date(CLAIMED.getTime() + ms);
    };

    expect(OnCallPageAgainClaimsInFlight.isToSettle(claim(), at(MINUTE))).toBe(
      false,
    );
    expect(
      OnCallPageAgainClaimsInFlight.isToSettle(claim(), at(90 * 1000 - 1)),
    ).toBe(false);
    expect(
      OnCallPageAgainClaimsInFlight.isToSettle(claim(), at(90 * 1000)),
    ).toBe(true);
    expect(
      OnCallPageAgainClaimsInFlight.isToSettle(claim(), at(2 * MINUTE)),
    ).toBe(true);
  });

  test("an entry that is not a page again, or a value that cannot be read, is passed over", async () => {
    kept.set(
      KEY,
      JSON.stringify({
        [RUN.toString()]: { claimedAt: "soon", pageAgainNumber: 1 },
        [OTHER_RUN.toString()]: {
          claimedAt: CLAIMED.getTime(),
          clockStartedAt: CLAIMED.getTime() - 30 * MINUTE,
          pageAgainNumber: 1,
          startAtRuleId: null,
          acknowledgedByUserId: null,
          minutes: 30,
          dueAt: CLAIMED.getTime(),
          pageAgainRunId: null,
        },
      }),
    );

    const claims: Map<string, OnCallPageAgainClaim> =
      await OnCallPageAgainClaimsInFlight.readAll();

    expect([...claims.keys()]).toEqual([OTHER_RUN.toString()]);
    expect(claims.get(OTHER_RUN.toString())!.startAtRuleId).toBeNull();

    kept.set(KEY, "{not json");
    expect((await OnCallPageAgainClaimsInFlight.readAll()).size).toBe(0);
  });

  test("never throws when Redis is down: keeps nothing, reads nothing", async () => {
    isRedisDown = true;

    await expect(
      OnCallPageAgainClaimsInFlight.keep(RUN, claim()),
    ).resolves.toBeUndefined();
    await expect(
      OnCallPageAgainClaimsInFlight.forget(RUN),
    ).resolves.toBeUndefined();
    expect((await OnCallPageAgainClaimsInFlight.readAll()).size).toBe(0);
  });
});
