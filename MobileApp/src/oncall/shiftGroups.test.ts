import { describe, expect, test } from "@jest/globals";
import {
  anchorDay,
  buildCoverParams,
  canRequestCover,
  dayKey,
  dayLabel,
  describeCovering,
  describePolicyVariant,
  groupShiftsByDay,
  hasShiftEnded,
  isCoveringShift,
  isShiftActive,
  type ShiftDayGroup,
} from "./shiftGroups";
import type { MyOnCallShift } from "../api/types";

/*
 * Grouping is what keeps a fortnight of shifts readable, and the one grouping
 * rule that is not obvious is the anchor: a shift that started yesterday and
 * is still running belongs under "Today", because "what is on now" is the
 * question, and filing an active shift under a past day answers "what
 * happened".
 *
 * Everything here uses local-time constructors so the assertions hold in
 * whatever timezone the CI box is in.
 */

/* Tue 3 Mar 2026, noon, local time. */
const NOW: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

function shift(overrides: Partial<MyOnCallShift> = {}): MyOnCallShift {
  return {
    shiftKey: "schedule-1:1",
    contentHash: "h",
    projectId: "project-1",
    projectName: "Acme",
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    scheduleTimezone: null,
    userId: "user-me",
    userName: "Ada",
    start: new Date(2026, 2, 4, 9, 0).toISOString(),
    end: new Date(2026, 2, 4, 17, 0).toISOString(),
    coverageSeconds: 8 * 3600,
    policies: [],
    isPast: false,
    lastModifiedAt: new Date(2026, 2, 1).toISOString(),
    shiftConfigVersion: 1,
    ...overrides,
  };
}

describe("dayLabel", () => {
  test("Today, Tomorrow, Yesterday, then weekday + date", () => {
    expect(dayLabel(new Date(2026, 2, 3, 23, 59), NOW)).toBe("Today");
    expect(dayLabel(new Date(2026, 2, 4, 0, 1), NOW)).toBe("Tomorrow");
    expect(dayLabel(new Date(2026, 2, 2, 8, 0), NOW)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 2, 5, 9, 0), NOW)).toBe("Thu 5 Mar");
    expect(dayLabel(new Date(2026, 2, 12, 9, 0), NOW)).toBe("Thu 12 Mar");
  });
});

describe("dayKey", () => {
  test("is the zero-padded local date", () => {
    expect(dayKey(new Date(2026, 2, 3))).toBe("2026-03-03");
    expect(dayKey(new Date(2026, 11, 25))).toBe("2026-12-25");
  });
});

describe("isShiftActive / hasShiftEnded", () => {
  test("active means started and not yet ended", () => {
    const active: MyOnCallShift = shift({
      start: new Date(2026, 2, 3, 9, 0).toISOString(),
      end: new Date(2026, 2, 3, 17, 0).toISOString(),
    });

    expect(isShiftActive(active, NOW)).toBe(true);
    expect(hasShiftEnded(active, NOW)).toBe(false);
  });

  test("a shift ending exactly now has ended", () => {
    const ending: MyOnCallShift = shift({
      start: new Date(2026, 2, 3, 9, 0).toISOString(),
      end: new Date(NOW).toISOString(),
    });

    expect(isShiftActive(ending, NOW)).toBe(false);
    expect(hasShiftEnded(ending, NOW)).toBe(true);
  });

  test("a future shift is neither", () => {
    expect(isShiftActive(shift(), NOW)).toBe(false);
    expect(hasShiftEnded(shift(), NOW)).toBe(false);
  });
});

describe("anchorDay", () => {
  test("an active shift that started yesterday anchors to today", () => {
    const overnight: MyOnCallShift = shift({
      start: new Date(2026, 2, 2, 18, 0).toISOString(),
      end: new Date(2026, 2, 3, 18, 0).toISOString(),
    });

    expect(dayKey(anchorDay(overnight, NOW))).toBe("2026-03-03");
  });

  test("an ended shift keeps its real day", () => {
    const ended: MyOnCallShift = shift({
      start: new Date(2026, 2, 2, 9, 0).toISOString(),
      end: new Date(2026, 2, 2, 17, 0).toISOString(),
    });

    expect(dayKey(anchorDay(ended, NOW))).toBe("2026-03-02");
  });

  test("a future shift anchors to its start day", () => {
    expect(dayKey(anchorDay(shift(), NOW))).toBe("2026-03-04");
  });
});

describe("groupShiftsByDay", () => {
  test("groups by local day, in day order, shifts sorted by start", () => {
    const groups: ShiftDayGroup[] = groupShiftsByDay(
      [
        shift({
          shiftKey: "thu-late",
          start: new Date(2026, 2, 5, 17, 0).toISOString(),
          end: new Date(2026, 2, 5, 21, 0).toISOString(),
        }),
        shift({
          shiftKey: "today",
          start: new Date(2026, 2, 3, 13, 0).toISOString(),
          end: new Date(2026, 2, 3, 17, 0).toISOString(),
        }),
        shift({
          shiftKey: "thu-early",
          start: new Date(2026, 2, 5, 9, 0).toISOString(),
          end: new Date(2026, 2, 5, 12, 0).toISOString(),
        }),
      ],
      NOW,
    );

    expect(
      groups.map((group: ShiftDayGroup) => {
        return [
          group.label,
          group.shifts.map((entry: MyOnCallShift) => {
            return entry.shiftKey;
          }),
        ];
      }),
    ).toEqual([
      ["Today", ["today"]],
      ["Thu 5 Mar", ["thu-early", "thu-late"]],
    ]);
  });

  test("files an in-progress overnight shift under Today, not yesterday", () => {
    const groups: ShiftDayGroup[] = groupShiftsByDay(
      [
        shift({
          shiftKey: "overnight",
          start: new Date(2026, 2, 2, 18, 0).toISOString(),
          end: new Date(2026, 2, 3, 18, 0).toISOString(),
        }),
      ],
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Today");
    expect(groups[0]?.key).toBe("2026-03-03");
  });

  test("collapses a shift reported twice", () => {
    const groups: ShiftDayGroup[] = groupShiftsByDay(
      [shift({ shiftKey: "dup" }), shift({ shiftKey: "dup" })],
      NOW,
    );

    expect(groups[0]?.shifts).toHaveLength(1);
  });

  test("breaks a tie on start by schedule name", () => {
    const groups: ShiftDayGroup[] = groupShiftsByDay(
      [
        shift({ shiftKey: "z", scheduleName: "Zulu" }),
        shift({ shiftKey: "a", scheduleName: "Alpha" }),
      ],
      NOW,
    );

    expect(
      groups[0]?.shifts.map((entry: MyOnCallShift) => {
        return entry.scheduleName;
      }),
    ).toEqual(["Alpha", "Zulu"]);
  });

  test("an empty list yields no groups", () => {
    expect(groupShiftsByDay([], NOW)).toEqual([]);
  });

  test("does not mutate the input", () => {
    const input: MyOnCallShift[] = [
      shift({ shiftKey: "b", start: new Date(2026, 2, 6).toISOString() }),
      shift({ shiftKey: "a" }),
    ];

    groupShiftsByDay(input, NOW);

    expect(
      input.map((entry: MyOnCallShift) => {
        return entry.shiftKey;
      }),
    ).toEqual(["b", "a"]);
  });
});

describe("covering and policy variants", () => {
  const covering: MyOnCallShift = shift({
    override: {
      originalUserId: "user-2",
      originalUserName: "Priya Rao",
      overrideStartsAt: new Date(2026, 2, 4, 9, 0).toISOString(),
      overrideEndsAt: new Date(2026, 2, 4, 17, 0).toISOString(),
    },
  });

  test("a shift with an override block is held for somebody else", () => {
    expect(isCoveringShift(covering)).toBe(true);
    expect(describeCovering(covering)).toBe("Covering for Priya Rao");
    expect(isCoveringShift(shift())).toBe(false);
    expect(describeCovering(shift())).toBeNull();
  });

  test("a policy variant names its policy", () => {
    expect(
      describePolicyVariant(
        shift({
          policyVariantOf: {
            policyId: "policy-1",
            policyName: "Database",
            globalUserId: "user-2",
          },
        }),
      ),
    ).toBe("Only for Database");
    expect(describePolicyVariant(shift())).toBeNull();
  });
});

describe("canRequestCover", () => {
  test("yes for an upcoming or active shift of my own", () => {
    expect(canRequestCover(shift(), NOW)).toBe(true);
    expect(
      canRequestCover(
        shift({
          start: new Date(2026, 2, 3, 9, 0).toISOString(),
          end: new Date(2026, 2, 3, 17, 0).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  test("no once the shift has ended", () => {
    expect(
      canRequestCover(
        shift({
          start: new Date(2026, 2, 2, 9, 0).toISOString(),
          end: new Date(2026, 2, 2, 17, 0).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  test("no for a shift I am already covering for somebody else", () => {
    /*
     * An override on top of an override is not something the server chains;
     * offering it would create a record that changes nothing.
     */
    expect(
      canRequestCover(
        shift({
          override: {
            originalUserId: "user-2",
            originalUserName: "Priya",
            overrideStartsAt: "",
            overrideEndsAt: "",
          },
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("buildCoverParams", () => {
  test("carries project, schedule and the window as ISO strings", () => {
    const start: string = new Date(2026, 2, 4, 9, 0).toISOString();
    const end: string = new Date(2026, 2, 4, 17, 0).toISOString();

    expect(buildCoverParams(shift({ start, end }))).toEqual({
      projectId: "project-1",
      scheduleId: "schedule-1",
      scheduleName: "Primary",
      startsAt: start,
      endsAt: end,
    });
  });

  test("adds the policy only for a policy-variant shift", () => {
    expect(
      buildCoverParams(
        shift({
          policyVariantOf: {
            policyId: "policy-1",
            policyName: "Database",
            globalUserId: "user-2",
          },
        }),
      ).policyId,
    ).toBe("policy-1");

    expect("policyId" in buildCoverParams(shift())).toBe(false);
  });
});
