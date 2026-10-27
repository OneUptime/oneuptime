import { describe, expect, test } from "@jest/globals";
import {
  SHIFT_HAND_OFF_TOLERANCE_MS,
  UPCOMING_SHIFTS_FOLD_MINIMUM_HIDDEN,
  UPCOMING_SHIFTS_SHOWN_AT_FIRST,
  UpcomingShiftSpan,
  buildUpcomingShiftSpans,
  getCoverWindowForSpan,
  getShiftSpanKey,
  getUpcomingShiftsFold,
  isDefaultLayerName,
  isUpcomingShiftsFoldable,
  shouldShowLayerName,
  shouldShowProjectNames,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/UpcomingShiftSpans";
import { getUpcomingShiftsWindow } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/CalendarFeed/CalendarFeedUtil";
import {
  MaterializedShiftJson,
  MaterializedShiftOverrideJson,
  MaterializedShiftPolicyVariant,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import { UserOverrideCoverWindow } from "../../../Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * THE UPCOMING SHIFTS LIST JOINS BACK-TO-BACK TURNS INTO ONE STRETCH.
 *
 * /my-shifts sends one shift per rotation turn, so a person alone on a
 * daily rotation got thirty identical rows a month (the maintainer's
 * screenshot: "17:20 - Oct 15 2026, 17:20 BST · Team AWeekly" thirty
 * times). The card now joins touching shifts that nothing a reader could
 * tell apart separates - same project, schedule, layer, person, cover and
 * policy - and keeps everything else apart. These pin each of those rules,
 * the "on call now" and "may continue" flags, which rows name their layer
 * or project, what Get cover covers for a joined span, and the fold.
 */

const PROJECT: string = "0d600000-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "0d600000-0000-4000-8000-000000000002";
const SCHEDULE: string = "0d600000-0000-4000-8000-000000000011";
const OTHER_SCHEDULE: string = "0d600000-0000-4000-8000-000000000012";
const ME: string = "0d600000-0000-4000-8000-0000000000a1";
const BOB: string = "0d600000-0000-4000-8000-0000000000b2";
const ANA: string = "0d600000-0000-4000-8000-0000000000c3";
const POLICY: string = "0d600000-0000-4000-8000-000000000021";
const OTHER_POLICY: string = "0d600000-0000-4000-8000-000000000022";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// 15:00 UTC on 14 October 2026: 16:00 in London, in summer time.
const NOW: Date = new Date("2026-10-14T15:00:00.000Z");

function at(offset: number): string {
  return new Date(NOW.getTime() + offset).toISOString();
}

function shift(
  overrides: Partial<MaterializedShiftJson> & { shiftKey: string },
): MaterializedShiftJson {
  return {
    contentHash: "hash",
    projectId: PROJECT,
    projectName: "OneUptime Telemetry",
    scheduleId: SCHEDULE,
    scheduleName: "Team AWeekly",
    scheduleTimezone: "Europe/London",
    userId: ME,
    userName: "Valeria",
    start: at(DAY),
    end: at(DAY + 8 * HOUR),
    coverageSeconds: 8 * 3600,
    layerId: `${SCHEDULE}-layer-1`,
    layerName: "Layer 1",
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-10-01T00:00:00.000Z",
    shiftConfigVersion: 1,
    ...overrides,
  };
}

// `count` back-to-back turns of `length`, the first starting at `first`.
function turns(
  first: number,
  length: number,
  count: number,
  fields?: Partial<MaterializedShiftJson>,
): Array<MaterializedShiftJson> {
  const result: Array<MaterializedShiftJson> = [];

  for (let index: number = 0; index < count; index++) {
    const start: number = first + index * length;

    result.push(
      shift({
        shiftKey: `${fields?.scheduleId || SCHEDULE}:${start}`,
        start: at(start),
        end: at(start + length),
        ...fields,
      }),
    );
  }

  return result;
}

function keysOf(spans: Array<UpcomingShiftSpan>): Array<Array<string>> {
  return spans.map((span: UpcomingShiftSpan): Array<string> => {
    return span.shifts.map((item: MaterializedShiftJson): string => {
      return item.shiftKey;
    });
  });
}

const coveringFor: (
  userId: string,
  name: string,
  start: number,
  end: number,
) => MaterializedShiftOverrideJson = (
  userId: string,
  name: string,
  start: number,
  end: number,
): MaterializedShiftOverrideJson => {
  return {
    originalUserId: userId,
    originalUserName: name,
    overrideStartsAt: at(start),
    overrideEndsAt: at(end),
  };
};

describe("back-to-back shifts read as one stretch on call", () => {
  test("the maintainer's month: thirty daily 24-hour turns of one person are one span", () => {
    // On call since 16:20 UTC (17:20 in London) yesterday, a turn a day.
    const firstStart: number = -(22 * HOUR + 40 * MINUTE);
    const shifts: Array<MaterializedShiftJson> = turns(firstStart, DAY, 31);

    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      shifts,
      NOW,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]!.shifts).toHaveLength(31);
    expect(spans[0]!.start.toISOString()).toBe(at(firstStart));
    expect(spans[0]!.end.toISOString()).toBe(at(firstStart + 31 * DAY));
    expect(spans[0]!.isOnCallNow).toBe(true);
    expect(spans[0]!.key).toBe(shifts[0]!.shiftKey);
  });

  test("a gap between two shifts keeps them apart", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a", start: at(DAY), end: at(DAY + 8 * HOUR) }),
        shift({
          shiftKey: "b",
          start: at(DAY + 9 * HOUR),
          end: at(DAY + 17 * HOUR),
        }),
      ],
      NOW,
    );

    expect(keysOf(spans)).toEqual([["a"], ["b"]]);
  });

  test("a hand-off within a minute of the end touches; a minute and a second does not", () => {
    const end: number = DAY + 8 * HOUR;

    const within: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a", start: at(DAY), end: at(end) }),
        shift({
          shiftKey: "b",
          start: at(end + SHIFT_HAND_OFF_TOLERANCE_MS),
          end: at(end + 8 * HOUR),
        }),
      ],
      NOW,
    );

    const past: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a", start: at(DAY), end: at(end) }),
        shift({
          shiftKey: "b",
          start: at(end + SHIFT_HAND_OFF_TOLERANCE_MS + 1000),
          end: at(end + 8 * HOUR),
        }),
      ],
      NOW,
    );

    expect(SHIFT_HAND_OFF_TOLERANCE_MS).toBe(60 * 1000);
    expect(keysOf(within)).toEqual([["a", "b"]]);
    expect(keysOf(past)).toEqual([["a"], ["b"]]);
  });

  test("a hand-over to another layer of the same schedule is a boundary", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "weekdays", start: at(DAY), end: at(2 * DAY) }),
        shift({
          shiftKey: "weekend",
          start: at(2 * DAY),
          end: at(3 * DAY),
          layerId: `${SCHEDULE}-layer-2`,
          layerName: "Weekend",
        }),
      ],
      NOW,
    );

    expect(keysOf(spans)).toEqual([["weekdays"], ["weekend"]]);
  });

  test("touching shifts of two schedules, or two projects, stay apart", () => {
    const schedules: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a", start: at(DAY), end: at(2 * DAY) }),
        shift({
          shiftKey: "b",
          start: at(2 * DAY),
          end: at(3 * DAY),
          scheduleId: OTHER_SCHEDULE,
          scheduleName: "Database",
        }),
      ],
      NOW,
    );

    const projects: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a", start: at(DAY), end: at(2 * DAY) }),
        shift({
          shiftKey: "b",
          start: at(2 * DAY),
          end: at(3 * DAY),
          projectId: OTHER_PROJECT,
          projectName: "Payments",
        }),
      ],
      NOW,
    );

    expect(keysOf(schedules)).toEqual([["a"], ["b"]]);
    expect(keysOf(projects)).toEqual([["a"], ["b"]]);
  });

  test("your own shift and one you cover for someone else stay apart, however they touch", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "own", start: at(DAY), end: at(2 * DAY) }),
        shift({
          shiftKey: "cover",
          start: at(2 * DAY),
          end: at(3 * DAY),
          override: coveringFor(BOB, "Bob", 2 * DAY, 3 * DAY),
        }),
      ],
      NOW,
    );

    expect(keysOf(spans)).toEqual([["own"], ["cover"]]);
    expect(spans[0]!.coveringFor).toBeNull();
    expect(spans[1]!.coveringFor).toBe("Bob");
  });

  test("cover for the same person joins; cover for two different people does not", () => {
    const same: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({
          shiftKey: "a",
          start: at(DAY),
          end: at(2 * DAY),
          override: coveringFor(BOB, "Bob", DAY, 2 * DAY),
        }),
        shift({
          shiftKey: "b",
          start: at(2 * DAY),
          end: at(3 * DAY),
          override: coveringFor(BOB, "Bob", 2 * DAY, 3 * DAY),
        }),
      ],
      NOW,
    );

    const different: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({
          shiftKey: "a",
          start: at(DAY),
          end: at(2 * DAY),
          override: coveringFor(BOB, "Bob", DAY, 2 * DAY),
        }),
        shift({
          shiftKey: "b",
          start: at(2 * DAY),
          end: at(3 * DAY),
          override: coveringFor(ANA, "Ana", 2 * DAY, 3 * DAY),
        }),
      ],
      NOW,
    );

    expect(keysOf(same)).toEqual([["a", "b"]]);
    expect(keysOf(different)).toEqual([["a"], ["b"]]);
    expect(
      different.map((span: UpcomingShiftSpan): string | null => {
        return span.coveringFor;
      }),
    ).toEqual(["Bob", "Ana"]);
  });

  test("an override that names you as the original is your own shift, not cover", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a", start: at(DAY), end: at(2 * DAY) }),
        shift({
          shiftKey: "b",
          start: at(2 * DAY),
          end: at(3 * DAY),
          override: coveringFor(ME, "Valeria", 2 * DAY, 3 * DAY),
        }),
      ],
      NOW,
    );

    expect(keysOf(spans)).toEqual([["a", "b"]]);
    expect(spans[0]!.coveringFor).toBeNull();
  });

  test("a shift that exists only on one policy joins only that policy's shifts", () => {
    const variant: (policyId: string) => MaterializedShiftPolicyVariant = (
      policyId: string,
    ): MaterializedShiftPolicyVariant => {
      return {
        policyId: policyId,
        policyName: policyId === POLICY ? "Checkout" : "Billing",
        globalUserId: BOB,
      };
    };

    const plainThenVariant: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "plain", start: at(DAY), end: at(2 * DAY) }),
        shift({
          shiftKey: "variant",
          start: at(2 * DAY),
          end: at(3 * DAY),
          policyVariantOf: variant(POLICY),
        }),
      ],
      NOW,
    );

    const samePolicy: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({
          shiftKey: "a",
          start: at(DAY),
          end: at(2 * DAY),
          policyVariantOf: variant(POLICY),
        }),
        shift({
          shiftKey: "b",
          start: at(2 * DAY),
          end: at(3 * DAY),
          policyVariantOf: variant(POLICY),
        }),
      ],
      NOW,
    );

    const twoPolicies: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({
          shiftKey: "a",
          start: at(DAY),
          end: at(2 * DAY),
          policyVariantOf: variant(POLICY),
        }),
        shift({
          shiftKey: "b",
          start: at(2 * DAY),
          end: at(3 * DAY),
          policyVariantOf: variant(OTHER_POLICY),
        }),
      ],
      NOW,
    );

    expect(keysOf(plainThenVariant)).toEqual([["plain"], ["variant"]]);
    expect(keysOf(samePolicy)).toEqual([["a", "b"]]);
    expect(samePolicy[0]!.policyVariant?.policyName).toBe("Checkout");
    expect(keysOf(twoPolicies)).toEqual([["a"], ["b"]]);
  });

  test("two schedules' turns interleaved in time each join their own", () => {
    const database: Partial<MaterializedShiftJson> = {
      scheduleId: OTHER_SCHEDULE,
      scheduleName: "Database",
      layerId: `${OTHER_SCHEDULE}-layer-1`,
    };

    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [...turns(DAY, DAY, 3), ...turns(DAY + 12 * HOUR, DAY, 3, database)],
      NOW,
    );

    expect(spans).toHaveLength(2);
    expect(spans[0]!.scheduleName).toBe("Team AWeekly");
    expect(spans[0]!.shifts).toHaveLength(3);
    expect(spans[1]!.scheduleName).toBe("Database");
    expect(spans[1]!.shifts).toHaveLength(3);
    expect(spans[1]!.end.toISOString()).toBe(at(DAY + 12 * HOUR + 3 * DAY));
  });

  test("overlapping shifts of one stretch never shorten it", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "long", start: at(DAY), end: at(3 * DAY) }),
        shift({
          shiftKey: "inside",
          start: at(2 * DAY),
          end: at(2 * DAY + HOUR),
        }),
      ],
      NOW,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]!.end.toISOString()).toBe(at(3 * DAY));
  });

  test("the merge key names everything that keeps two shifts apart", () => {
    const own: string = getShiftSpanKey(shift({ shiftKey: "a" }));
    const cover: string = getShiftSpanKey(
      shift({ shiftKey: "b", override: coveringFor(BOB, "Bob", 0, HOUR) }),
    );

    expect(own).toBe(
      [PROJECT, SCHEDULE, `${SCHEDULE}-layer-1`, ME, "own", ""].join("|"),
    );
    expect(cover).toContain(`covering:${BOB}`);
  });
});

describe("what is upcoming", () => {
  test("shifts that have ended are left out; the one under way is on call now", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "ended", start: at(-9 * HOUR), end: at(-HOUR) }),
        shift({ shiftKey: "ends-now", start: at(-8 * HOUR), end: at(0) }),
        shift({ shiftKey: "running", start: at(-2 * HOUR), end: at(6 * HOUR) }),
        shift({ shiftKey: "later", start: at(DAY), end: at(DAY + HOUR) }),
      ],
      NOW,
    );

    expect(keysOf(spans)).toEqual([["running"], ["later"]]);
    expect(spans[0]!.isOnCallNow).toBe(true);
    expect(spans[1]!.isOnCallNow).toBe(false);
  });

  test("a shift starting this very moment is on call now", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [shift({ shiftKey: "now", start: at(0), end: at(HOUR) })],
      NOW,
    );

    expect(spans[0]!.isOnCallNow).toBe(true);
  });

  test("a key the server sent twice is one shift", () => {
    const twice: MaterializedShiftJson = shift({ shiftKey: "same" });

    expect(buildUpcomingShiftSpans([twice, { ...twice }], NOW)).toHaveLength(1);
    expect(
      buildUpcomingShiftSpans([twice, { ...twice }], NOW)[0]!.shifts,
    ).toHaveLength(1);
  });

  test("a shift without a real window is not listed", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "garbage", start: "not a date" }),
        shift({ shiftKey: "empty", start: "" }),
        shift({ shiftKey: "backwards", start: at(DAY), end: at(DAY - HOUR) }),
        shift({ shiftKey: "instant", start: at(DAY), end: at(DAY) }),
        shift({ shiftKey: "fine" }),
      ],
      NOW,
    );

    expect(keysOf(spans)).toEqual([["fine"]]);
  });

  test("spans come in start order, ties by key, and the input is left as it was", () => {
    const input: Array<MaterializedShiftJson> = [
      shift({ shiftKey: "z", start: at(3 * DAY), end: at(3 * DAY + HOUR) }),
      shift({
        shiftKey: "b",
        start: at(DAY),
        end: at(DAY + HOUR),
        scheduleId: OTHER_SCHEDULE,
      }),
      shift({ shiftKey: "a", start: at(DAY), end: at(DAY + HOUR) }),
    ];

    expect(keysOf(buildUpcomingShiftSpans(input, NOW))).toEqual([
      ["a"],
      ["b"],
      ["z"],
    ]);
    expect(
      input.map((item: MaterializedShiftJson): string => {
        return item.shiftKey;
      }),
    ).toEqual(["z", "b", "a"]);
  });

  test("a shift across the 30-day edge is listed whole: its real end, not the window's", () => {
    const windowEnd: Date = getUpcomingShiftsWindow(NOW).to;
    const start: number = 29 * DAY + 18 * HOUR;

    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [shift({ shiftKey: "edge", start: at(start), end: at(start + 2 * DAY) })],
      NOW,
      windowEnd,
    );

    expect(spans[0]!.end.getTime()).toBeGreaterThan(windowEnd.getTime());
    expect(spans[0]!.end.toISOString()).toBe(at(start + 2 * DAY));
  });
});

describe("a stretch still going at the end of the window may continue", () => {
  const windowEnd: Date = getUpcomingShiftsWindow(NOW).to;

  test("back-to-back turns past the window's end may continue: the next turn is out of sight", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      turns(-HOUR, DAY, 31),
      NOW,
      windowEnd,
    );

    expect(spans).toHaveLength(1);
    expect(spans[0]!.mayContinue).toBe(true);
  });

  test("one turn across the end ends when it says", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({
          shiftKey: "single",
          start: at(29 * DAY),
          end: at(31 * DAY),
        }),
      ],
      NOW,
      windowEnd,
    );

    expect(spans[0]!.mayContinue).toBe(false);
  });

  test("back-to-back turns that end inside the window are complete", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      turns(DAY, DAY, 5),
      NOW,
      windowEnd,
    );

    expect(spans[0]!.mayContinue).toBe(false);
  });

  test("without a window, nothing is said to continue", () => {
    expect(
      buildUpcomingShiftSpans(turns(-HOUR, DAY, 31), NOW)[0]!.mayContinue,
    ).toBe(false);
  });
});

describe("which rows name their layer and their project", () => {
  test("the default name of a new layer is recognised, whatever its spacing or case", () => {
    for (const name of ["Layer 1", "layer 12", "  Layer   3  ", "LAYER 2"]) {
      expect({ name, isDefault: isDefaultLayerName(name) }).toEqual({
        name,
        isDefault: true,
      });
    }

    for (const name of [
      "Weekdays",
      "Layer One",
      "Layer 1a",
      "Layers 1",
      "Primary Layer 1",
      "Layer",
      "",
      "1",
    ]) {
      expect({ name, isDefault: isDefaultLayerName(name) }).toEqual({
        name,
        isDefault: false,
      });
    }
  });

  test("a layer's own name is shown; 'Layer 1' on a one-layer schedule is not", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "default" }),
        shift({
          shiftKey: "named",
          start: at(3 * DAY),
          end: at(3 * DAY + HOUR),
          scheduleId: OTHER_SCHEDULE,
          layerId: `${OTHER_SCHEDULE}-layer-1`,
          layerName: "Weekdays",
        }),
      ],
      NOW,
    );

    expect(shouldShowLayerName(spans[0]!, spans)).toBe(false);
    expect(shouldShowLayerName(spans[1]!, spans)).toBe(true);
  });

  test("default names are shown where they tell two of your layers on one schedule apart", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "one" }),
        shift({
          shiftKey: "two",
          start: at(3 * DAY),
          end: at(3 * DAY + HOUR),
          layerId: `${SCHEDULE}-layer-2`,
          layerName: "Layer 2",
        }),
        shift({
          shiftKey: "elsewhere",
          start: at(4 * DAY),
          end: at(4 * DAY + HOUR),
          scheduleId: OTHER_SCHEDULE,
          layerId: `${OTHER_SCHEDULE}-layer-1`,
          layerName: "Layer 1",
        }),
      ],
      NOW,
    );

    expect(shouldShowLayerName(spans[0]!, spans)).toBe(true);
    expect(shouldShowLayerName(spans[1]!, spans)).toBe(true);
    // Another schedule's one layer stays unnamed.
    expect(shouldShowLayerName(spans[2]!, spans)).toBe(false);
  });

  test("a span without a layer name has none to show", () => {
    const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [shift({ shiftKey: "legacy", layerName: "", layerId: "" })],
      NOW,
    );

    expect(spans[0]!.layerName).toBeNull();
    expect(shouldShowLayerName(spans[0]!, spans)).toBe(false);
  });

  test("project names only where the list holds more than one project", () => {
    const one: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a" }),
        shift({ shiftKey: "b", start: at(3 * DAY), end: at(3 * DAY + HOUR) }),
      ],
      NOW,
    );

    const two: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
      [
        shift({ shiftKey: "a" }),
        shift({
          shiftKey: "b",
          start: at(3 * DAY),
          end: at(3 * DAY + HOUR),
          projectId: OTHER_PROJECT,
          projectName: "Payments",
        }),
      ],
      NOW,
    );

    expect(shouldShowProjectNames(one)).toBe(false);
    expect(shouldShowProjectNames(two)).toBe(true);
    expect(shouldShowProjectNames([])).toBe(false);
  });
});

describe("what Get cover covers", () => {
  function cover(
    shifts: Array<MaterializedShiftJson>,
  ): UserOverrideCoverWindow | null {
    return getCoverWindowForSpan(buildUpcomingShiftSpans(shifts, NOW)[0]!, NOW);
  }

  test("a joined span is covered whole, as its row shows it", () => {
    const window: UserOverrideCoverWindow | null = cover(turns(DAY, DAY, 7));

    expect(window?.startsAt.toISOString()).toBe(at(DAY));
    expect(window?.endsAt.toISOString()).toBe(at(8 * DAY));
  });

  test("the span you are on call for is covered from now", () => {
    const window: UserOverrideCoverWindow | null = cover(
      turns(-5 * HOUR, DAY, 3),
    );

    expect(window?.startsAt.toISOString()).toBe(NOW.toISOString());
    expect(window?.endsAt.toISOString()).toBe(at(-5 * HOUR + 3 * DAY));
  });

  test("nothing for cover you give someone else: overrides do not chain", () => {
    expect(
      cover([
        shift({
          shiftKey: "cover",
          override: coveringFor(BOB, "Bob", DAY, DAY + 8 * HOUR),
        }),
      ]),
    ).toBeNull();
  });

  test("nothing for a span without a project", () => {
    expect(cover([shift({ shiftKey: "orphan", projectId: "" })])).toBeNull();
  });

  test("nothing once the span has ended", () => {
    const span: UpcomingShiftSpan = buildUpcomingShiftSpans(
      [shift({ shiftKey: "soon", start: at(HOUR), end: at(2 * HOUR) })],
      NOW,
    )[0]!;

    expect(
      getCoverWindowForSpan(span, new Date(NOW.getTime() + 3 * HOUR)),
    ).toBeNull();
  });
});

describe("the fold", () => {
  test("six rows show at first, and a fold opens only when it hides three or more", () => {
    expect(UPCOMING_SHIFTS_SHOWN_AT_FIRST).toBe(6);
    expect(UPCOMING_SHIFTS_FOLD_MINIMUM_HIDDEN).toBe(3);

    expect(getUpcomingShiftsFold({ total: 0, isExpanded: false })).toEqual({
      shown: 0,
      hidden: 0,
    });
    expect(getUpcomingShiftsFold({ total: 8, isExpanded: false })).toEqual({
      shown: 8,
      hidden: 0,
    });
    expect(getUpcomingShiftsFold({ total: 9, isExpanded: false })).toEqual({
      shown: 6,
      hidden: 3,
    });
    expect(getUpcomingShiftsFold({ total: 22, isExpanded: false })).toEqual({
      shown: 6,
      hidden: 16,
    });
  });

  test("opened, it shows every row", () => {
    expect(getUpcomingShiftsFold({ total: 22, isExpanded: true })).toEqual({
      shown: 22,
      hidden: 0,
    });
  });

  test("only a list that folds has a control for it", () => {
    expect(isUpcomingShiftsFoldable(8)).toBe(false);
    expect(isUpcomingShiftsFoldable(9)).toBe(true);
    expect(isUpcomingShiftsFoldable(0)).toBe(false);
  });
});

describe("cost", () => {
  test("a year of hourly shifts joins in well under a second", () => {
    const shifts: Array<MaterializedShiftJson> = turns(-HOUR, HOUR, 24 * 365);

    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        const spans: Array<UpcomingShiftSpan> = buildUpcomingShiftSpans(
          shifts,
          NOW,
        );

        expect(spans).toHaveLength(1);
      },
      limitInMs: 1000,
    });
    expect(timed.inMs).toBeLessThan(1000);
  });
});
