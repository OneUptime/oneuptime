import ActiveMonitorLimitUtil, {
  ActiveMonitorLimitKind,
  ActiveMonitorLimitStatus,
  ActiveMonitorPlanLimit,
  NO_ACTIVE_MONITOR_LIMIT,
} from "../../../Types/Monitor/ActiveMonitorLimit";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The arithmetic of a plan's limit on active monitors, shared by the server
 * that holds creates to it and the dashboard that says so before anyone
 * fills in a form: which limit a project is held to, how much room it has,
 * whether it is at or past it, and the JSON the dashboard reads it from.
 */

const PLAN_500: ActiveMonitorPlanLimit = {
  limit: 500,
  kind: ActiveMonitorLimitKind.Plan,
};

const FREE_10: ActiveMonitorPlanLimit = {
  limit: 10,
  kind: ActiveMonitorLimitKind.FreePlan,
};

function status(
  limit: ActiveMonitorPlanLimit | null,
  activeMonitors: number | null,
): ActiveMonitorLimitStatus {
  return { limit: limit, activeMonitors: activeMonitors };
}

describe("the project's own limit, as the Project row holds it", () => {
  test("a whole number of at least 1 is a limit", () => {
    expect(ActiveMonitorLimitUtil.getProjectLimit(500)).toBe(500);
    expect(ActiveMonitorLimitUtil.getProjectLimit(1)).toBe(1);
  });

  /*
   * A reseller plan with no Monitor Limit writes nothing, or 0, onto the
   * project: neither is a limit, exactly as with the reseller plan's seat
   * limit (TeamMemberService).
   */
  test.each([undefined, null, 0, -5, 2.5, Number.NaN])(
    "%p is no limit",
    (value: number | null | undefined) => {
      expect(ActiveMonitorLimitUtil.getProjectLimit(value)).toBeNull();
    },
  );
});

describe("the limit a project is held to", () => {
  test("is the lower of its own plan's and the Free plan's", () => {
    expect(ActiveMonitorLimitUtil.getLowerLimit([PLAN_500, FREE_10])).toEqual(
      FREE_10,
    );
    expect(
      ActiveMonitorLimitUtil.getLowerLimit([
        { limit: 5, kind: ActiveMonitorLimitKind.Plan },
        FREE_10,
      ]),
    ).toEqual({ limit: 5, kind: ActiveMonitorLimitKind.Plan });
  });

  test("is the project's own on a tie, whose words fit a plan it bought", () => {
    expect(
      ActiveMonitorLimitUtil.getLowerLimit([
        FREE_10,
        { limit: 10, kind: ActiveMonitorLimitKind.Plan },
      ]),
    ).toEqual({ limit: 10, kind: ActiveMonitorLimitKind.Plan });
  });

  test("is whichever one there is, or none", () => {
    expect(ActiveMonitorLimitUtil.getLowerLimit([null, PLAN_500])).toEqual(
      PLAN_500,
    );
    expect(ActiveMonitorLimitUtil.getLowerLimit([FREE_10, null])).toEqual(
      FREE_10,
    );
    expect(ActiveMonitorLimitUtil.getLowerLimit([null, null])).toBeNull();
    expect(ActiveMonitorLimitUtil.getLowerLimit([])).toBeNull();
  });
});

describe("room under the limit", () => {
  test("is what is left, and never less than nothing", () => {
    expect(
      ActiveMonitorLimitUtil.getRoom({ limit: 500, activeMonitors: 498 }),
    ).toBe(2);
    expect(
      ActiveMonitorLimitUtil.getRoom({ limit: 500, activeMonitors: 500 }),
    ).toBe(0);
    // The project in the support report: 2,881 active on a plan of 500.
    expect(
      ActiveMonitorLimitUtil.getRoom({ limit: 500, activeMonitors: 2881 }),
    ).toBe(0);
  });

  test("lets the last monitor in, and not one more", () => {
    expect(
      ActiveMonitorLimitUtil.hasRoomFor({
        limit: 500,
        activeMonitors: 499,
        adding: 1,
      }),
    ).toBe(true);
    expect(
      ActiveMonitorLimitUtil.hasRoomFor({
        limit: 500,
        activeMonitors: 500,
        adding: 1,
      }),
    ).toBe(false);
    expect(
      ActiveMonitorLimitUtil.hasRoomFor({
        limit: 500,
        activeMonitors: 2881,
        adding: 1,
      }),
    ).toBe(false);
  });

  test("counts every monitor a write adds at once", () => {
    expect(
      ActiveMonitorLimitUtil.hasRoomFor({
        limit: 500,
        activeMonitors: 498,
        adding: 2,
      }),
    ).toBe(true);
    expect(
      ActiveMonitorLimitUtil.hasRoomFor({
        limit: 500,
        activeMonitors: 498,
        adding: 3,
      }),
    ).toBe(false);
  });

  test("a limit of 0 has room for nothing", () => {
    expect(
      ActiveMonitorLimitUtil.hasRoomFor({
        limit: 0,
        activeMonitors: 0,
        adding: 1,
      }),
    ).toBe(false);
  });
});

describe("at the limit, and past it", () => {
  test("a project with no limit is neither", () => {
    expect(
      ActiveMonitorLimitUtil.isAtOrOverLimit(NO_ACTIVE_MONITOR_LIMIT),
    ).toBe(false);
    expect(ActiveMonitorLimitUtil.isOverLimit(NO_ACTIVE_MONITOR_LIMIT)).toBe(
      false,
    );
  });

  test("under it is neither", () => {
    expect(ActiveMonitorLimitUtil.isAtOrOverLimit(status(PLAN_500, 499))).toBe(
      false,
    );
    expect(ActiveMonitorLimitUtil.isOverLimit(status(PLAN_500, 499))).toBe(
      false,
    );
  });

  test("exactly at it is at, not past", () => {
    expect(ActiveMonitorLimitUtil.isAtOrOverLimit(status(PLAN_500, 500))).toBe(
      true,
    );
    expect(ActiveMonitorLimitUtil.isOverLimit(status(PLAN_500, 500))).toBe(
      false,
    );
  });

  test("past it is both", () => {
    expect(ActiveMonitorLimitUtil.isAtOrOverLimit(status(PLAN_500, 2881))).toBe(
      true,
    );
    expect(ActiveMonitorLimitUtil.isOverLimit(status(PLAN_500, 2881))).toBe(
      true,
    );
  });

  test("a limit with nothing counted is neither", () => {
    expect(ActiveMonitorLimitUtil.isAtOrOverLimit(status(PLAN_500, null))).toBe(
      false,
    );
  });
});

describe("the JSON the dashboard reads", () => {
  test("round-trips a limit and its count", () => {
    for (const value of [
      status(PLAN_500, 2881),
      status(FREE_10, 10),
      status({ limit: 0, kind: ActiveMonitorLimitKind.FreePlan }, 0),
      NO_ACTIVE_MONITOR_LIMIT,
    ]) {
      expect(
        ActiveMonitorLimitUtil.fromJSON(ActiveMonitorLimitUtil.toJSON(value)),
      ).toEqual(value);
    }
  });

  test("writes exactly the limit, its kind and the count", () => {
    expect(ActiveMonitorLimitUtil.toJSON(status(PLAN_500, 2881))).toEqual({
      limit: { limit: 500, kind: "Plan" },
      activeMonitors: 2881,
    });
    expect(ActiveMonitorLimitUtil.toJSON(NO_ACTIVE_MONITOR_LIMIT)).toEqual({
      limit: null,
      activeMonitors: null,
    });
  });

  /*
   * A notice is never drawn from a value nobody can vouch for: anything
   * malformed reads as no limit, and the dashboard says nothing.
   */
  test.each([
    ["nothing", undefined],
    ["null", null],
    ["no limit", { limit: null, activeMonitors: 3 }],
    ["a limit with no count", { limit: { limit: 5, kind: "Plan" } }],
    [
      "a kind this version does not know",
      { limit: { limit: 5, kind: "Enterprise" }, activeMonitors: 3 },
    ],
    [
      "a limit written as text",
      { limit: { limit: "500", kind: "Plan" }, activeMonitors: 3 },
    ],
    [
      "a count written as text",
      { limit: { limit: 500, kind: "Plan" }, activeMonitors: "2881" },
    ],
    [
      "a negative count",
      { limit: { limit: 500, kind: "Plan" }, activeMonitors: -1 },
    ],
    [
      "a fractional limit",
      { limit: { limit: 2.5, kind: "Plan" }, activeMonitors: 1 },
    ],
    ["a list", { limit: [500], activeMonitors: 1 }],
  ])("reads %s as no limit", (_name: string, json: unknown) => {
    expect(
      ActiveMonitorLimitUtil.fromJSON(json as JSONObject | null | undefined),
    ).toEqual(NO_ACTIVE_MONITOR_LIMIT);
  });
});
