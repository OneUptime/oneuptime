/**
 * EXHAUSTIVE tests for UserOverrideUtil:
 *   - isOverrideApplicable (global vs policy-scoped vs no-context)
 *   - splitEventByOverride (via applyOverridesToEvents)
 *   - applyOverridesToEvents (ordering, precedence, id reassignment, meta)
 *
 * UserOverrideUtil is pure timestamp math (no timezone conversion happens inside
 * it), so the resolved segments are invariant to the process TZ. Date
 * comparisons are done at SECOND precision (OneUptimeDate.isAfter/isBefore/
 * isOnOrAfter/isOnOrBefore all truncate to whole seconds), which every boundary
 * test below pins down explicitly.
 *
 * These lock in the CORRECT (already-fixed) behavior:
 *   - non-transitive overrides (a substituted segment is frozen via meta),
 *   - consistent second-precision boundary handling (no inverted/zero-length
 *     segments from sub-second offsets),
 *   - policy-scoped overrides win over globals for the same user/window,
 *   - policy-scoped overrides never leak into a different policy.
 */
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import UserOverrideUtil, {
  UserOverrideRecord,
  OverrideEventMeta,
  OVERRIDE_META_KEY,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

/*
 * All events/overrides live on a single arbitrary calendar day. Because the
 * util only compares raw timestamps, the choice of day/zone is irrelevant.
 */
function at(
  hours: number,
  minutes: number = 0,
  seconds: number = 0,
  ms: number = 0,
): Date {
  return new Date(2026, 0, 1, hours, minutes, seconds, ms);
}

let nextId: number = 1;
function event(
  title: string,
  start: Date,
  end: Date,
  extra?: Partial<CalendarEvent>,
): CalendarEvent {
  return {
    id: nextId++,
    title: title,
    allDay: false,
    start: start,
    end: end,
    ...extra,
  };
}

function hourEvent(
  title: string,
  startHour: number,
  endHour: number,
  extra?: Partial<CalendarEvent>,
): CalendarEvent {
  return event(title, at(startHour), at(endHour), extra);
}

function override(data: {
  from: string;
  to: string;
  startsAt: Date;
  endsAt: Date;
  policyId?: string | null | undefined;
}): UserOverrideRecord {
  return {
    overrideUserId: data.from,
    routeAlertsToUserId: data.to,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    onCallDutyPolicyId: data.policyId,
  };
}

function hourOverride(
  from: string,
  to: string,
  startHour: number,
  endHour: number,
  policyId?: string | null | undefined,
): UserOverrideRecord {
  return override({
    from: from,
    to: to,
    startsAt: at(startHour),
    endsAt: at(endHour),
    policyId: policyId,
  });
}

function resolvedAt(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime()) {
      return e.title;
    }
  }
  return null;
}

interface Seg {
  title: string;
  start: number;
  end: number;
  meta: boolean;
}

function segs(events: Array<CalendarEvent>): Array<Seg> {
  return events.map((e: CalendarEvent) => {
    return {
      title: e.title,
      start: e.start.getTime(),
      end: e.end.getTime(),
      meta: UserOverrideUtil.getOverrideMeta(e) !== null,
    };
  });
}

// Expected segment in whole-hour shorthand.
type ExpectedHourSeg = [
  title: string,
  startHour: number,
  endHour: number,
  meta: boolean,
];

function expectedHourSegs(expected: Array<ExpectedHourSeg>): Array<Seg> {
  return expected.map((e: ExpectedHourSeg) => {
    return {
      title: e[0],
      start: at(e[1]).getTime(),
      end: at(e[2]).getTime(),
      meta: e[3],
    };
  });
}

/*
 * ---------------------------------------------------------------------------
 * isOverrideApplicable
 * ---------------------------------------------------------------------------
 */

describe("isOverrideApplicable: global vs policy-scoped vs no-context", () => {
  const window: { startsAt: Date; endsAt: Date } = {
    startsAt: at(9),
    endsAt: at(11),
  };

  test("global override (policyId null) applies regardless of context", () => {
    const ov: UserOverrideRecord = override({
      from: "A",
      to: "B",
      ...window,
      policyId: null,
    });
    expect(UserOverrideUtil.isOverrideApplicable(ov, "policy-1")).toBe(true);
    expect(UserOverrideUtil.isOverrideApplicable(ov, undefined)).toBe(true);
    expect(UserOverrideUtil.isOverrideApplicable(ov, null)).toBe(true);
    expect(UserOverrideUtil.isOverrideApplicable(ov, "")).toBe(true);
  });

  test("global override (policyId undefined / omitted) applies regardless of context", () => {
    const ov: UserOverrideRecord = {
      overrideUserId: "A",
      routeAlertsToUserId: "B",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      // onCallDutyPolicyId omitted entirely -> undefined -> global
    };
    expect(UserOverrideUtil.isOverrideApplicable(ov, "policy-1")).toBe(true);
    expect(UserOverrideUtil.isOverrideApplicable(ov, undefined)).toBe(true);
  });

  test("policy-scoped override applies ONLY to the matching policy", () => {
    const ov: UserOverrideRecord = override({
      from: "A",
      to: "B",
      ...window,
      policyId: "policy-1",
    });
    expect(UserOverrideUtil.isOverrideApplicable(ov, "policy-1")).toBe(true);
    expect(UserOverrideUtil.isOverrideApplicable(ov, "policy-2")).toBe(false);
  });

  test("policy-scoped override does NOT apply when caller has no policy context", () => {
    const ov: UserOverrideRecord = override({
      from: "A",
      to: "B",
      ...window,
      policyId: "policy-1",
    });
    expect(UserOverrideUtil.isOverrideApplicable(ov, undefined)).toBe(false);
    expect(UserOverrideUtil.isOverrideApplicable(ov, null)).toBe(false);
    expect(UserOverrideUtil.isOverrideApplicable(ov, "")).toBe(false);
  });

  test("empty-string policyId on the override is treated as global (falsy)", () => {
    /*
     * NOTE: current behavior - an empty-string onCallDutyPolicyId is falsy and
     * therefore treated as a global override.
     */
    const ov: UserOverrideRecord = override({
      from: "A",
      to: "B",
      ...window,
      policyId: "",
    });
    expect(UserOverrideUtil.isOverrideApplicable(ov, undefined)).toBe(true);
    expect(UserOverrideUtil.isOverrideApplicable(ov, "policy-1")).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Positional matrix: one global override A->B against event A[8,14]
 * ---------------------------------------------------------------------------
 */

describe("splitEventByOverride positional matrix (event A[8,14], override A->B)", () => {
  interface PosCase {
    name: string;
    startHour: number;
    endHour: number;
    expected: Array<ExpectedHourSeg>;
  }

  const cases: Array<PosCase> = [
    {
      name: "fully before the event -> untouched",
      startHour: 4,
      endHour: 6,
      expected: [["A", 8, 14, false]],
    },
    {
      name: "endsAt exactly abuts event.start (second-precision) -> untouched",
      startHour: 6,
      endHour: 8,
      expected: [["A", 8, 14, false]],
    },
    {
      name: "overlaps the left edge -> B[8,10] | A[10,14]",
      startHour: 6,
      endHour: 10,
      expected: [
        ["B", 8, 10, true],
        ["A", 10, 14, false],
      ],
    },
    {
      name: "starts at event.start, ends inside -> B[8,10] | A[10,14]",
      startHour: 8,
      endHour: 10,
      expected: [
        ["B", 8, 10, true],
        ["A", 10, 14, false],
      ],
    },
    {
      name: "strictly inside -> A[8,10] | B[10,12] | A[12,14]",
      startHour: 10,
      endHour: 12,
      expected: [
        ["A", 8, 10, false],
        ["B", 10, 12, true],
        ["A", 12, 14, false],
      ],
    },
    {
      name: "starts inside, ends at event.end -> A[8,10] | B[10,14]",
      startHour: 10,
      endHour: 14,
      expected: [
        ["A", 8, 10, false],
        ["B", 10, 14, true],
      ],
    },
    {
      name: "overlaps the right edge -> A[8,10] | B[10,14]",
      startHour: 10,
      endHour: 16,
      expected: [
        ["A", 8, 10, false],
        ["B", 10, 14, true],
      ],
    },
    {
      name: "exactly equals the event window -> B[8,14]",
      startHour: 8,
      endHour: 14,
      expected: [["B", 8, 14, true]],
    },
    {
      name: "fully covers the event (clamped to event window) -> B[8,14]",
      startHour: 6,
      endHour: 16,
      expected: [["B", 8, 14, true]],
    },
    {
      name: "startsAt exactly abuts event.end (second-precision) -> untouched",
      startHour: 14,
      endHour: 16,
      expected: [["A", 8, 14, false]],
    },
    {
      name: "fully after the event -> untouched",
      startHour: 16,
      endHour: 18,
      expected: [["A", 8, 14, false]],
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const base: CalendarEvent = hourEvent("A", 8, 14);
      const result: Array<CalendarEvent> =
        UserOverrideUtil.applyOverridesToEvents({
          events: [base],
          overrides: [hourOverride("A", "B", c.startHour, c.endHour)],
        });
      expect(segs(result)).toEqual(expectedHourSegs(c.expected));
      // ids are always reassigned to a 1..n sequence when overrides are applied.
      expect(
        result.map((e: CalendarEvent) => {
          return e.id;
        }),
      ).toEqual(
        result.map((_: CalendarEvent, i: number) => {
          return i + 1;
        }),
      );
      // no segment ever has a non-positive duration.
      for (const e of result) {
        expect(e.end.getTime()).toBeGreaterThan(e.start.getTime());
      }
    });
  }
});

/*
 * ---------------------------------------------------------------------------
 * Second-precision boundary behavior (sub-second offsets)
 * ---------------------------------------------------------------------------
 */

describe("second-precision boundaries (event A 10:00:00.000 - 12:00:00.000)", () => {
  function baseEvent(): CalendarEvent {
    return event("A", at(10, 0, 0, 0), at(12, 0, 0, 0));
  }

  test("override starting exactly at event end (same ms) -> no substitution", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [baseEvent()],
        overrides: [
          override({
            from: "A",
            to: "B",
            startsAt: at(12, 0, 0, 0),
            endsAt: at(13),
          }),
        ],
      });
    expect(segs(result)).toEqual([
      {
        title: "A",
        start: at(10).getTime(),
        end: at(12).getTime(),
        meta: false,
      },
    ]);
  });

  test("override starting mid-second after event end -> still no substitution", () => {
    // 12:00:00.900 truncates to 12:00:00 == event.end second -> isOnOrAfter true.
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [baseEvent()],
        overrides: [
          override({
            from: "A",
            to: "B",
            startsAt: at(12, 0, 0, 900),
            endsAt: at(13),
          }),
        ],
      });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("A");
  });

  test("override ending exactly at event start -> no substitution", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [baseEvent()],
        overrides: [
          override({
            from: "A",
            to: "B",
            startsAt: at(8),
            endsAt: at(10, 0, 0, 0),
          }),
        ],
      });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("A");
  });

  test("override ending mid-second after event start -> still no substitution", () => {
    // 10:00:00.900 truncates to 10:00:00 == event.start second -> isOnOrBefore true.
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [baseEvent()],
        overrides: [
          override({
            from: "A",
            to: "B",
            startsAt: at(8),
            endsAt: at(10, 0, 0, 900),
          }),
        ],
      });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("A");
  });

  test("override ending one full second after event start -> 1s substitution", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [baseEvent()],
        overrides: [
          override({
            from: "A",
            to: "B",
            startsAt: at(8),
            endsAt: at(10, 0, 1, 0),
          }),
        ],
      });
    expect(segs(result)).toEqual([
      {
        title: "B",
        start: at(10).getTime(),
        end: at(10, 0, 1).getTime(),
        meta: true,
      },
      {
        title: "A",
        start: at(10, 0, 1).getTime(),
        end: at(12).getTime(),
        meta: false,
      },
    ]);
  });

  test("override starting one full second before event end -> trailing 1s substitution", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [baseEvent()],
        overrides: [
          override({
            from: "A",
            to: "B",
            startsAt: at(11, 59, 59, 0),
            endsAt: at(13),
          }),
        ],
      });
    expect(segs(result)).toEqual([
      {
        title: "A",
        start: at(10).getTime(),
        end: at(11, 59, 59).getTime(),
        meta: false,
      },
      {
        title: "B",
        start: at(11, 59, 59).getTime(),
        end: at(12).getTime(),
        meta: true,
      },
    ]);
  });

  test("no result segment ever has negative or zero duration across sub-second offsets", () => {
    const offsets: Array<number> = [0, 1, 100, 499, 500, 501, 900, 999];
    for (const startMs of offsets) {
      for (const endMs of offsets) {
        const result: Array<CalendarEvent> =
          UserOverrideUtil.applyOverridesToEvents({
            events: [baseEvent()],
            overrides: [
              override({
                from: "A",
                to: "B",
                startsAt: at(10, 30, 0, startMs),
                endsAt: at(11, 30, 0, endMs),
              }),
            ],
          });
        for (const e of result) {
          expect(e.end.getTime()).toBeGreaterThan(e.start.getTime());
        }
      }
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * Override meta payload
 * ---------------------------------------------------------------------------
 */

describe("override meta payload", () => {
  test("meta carries the UNCLAMPED override window, segment carries the CLAMPED window", () => {
    const base: CalendarEvent = hourEvent("A", 10, 12);
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        // override window [8,16] fully covers event [10,12].
        overrides: [hourOverride("A", "B", 8, 16)],
      });
    expect(result).toHaveLength(1);
    const seg: CalendarEvent = result[0]!;
    expect(seg.title).toBe("B");
    // segment clamped to the event window.
    expect(seg.start.getTime()).toBe(at(10).getTime());
    expect(seg.end.getTime()).toBe(at(12).getTime());

    const meta: OverrideEventMeta | null =
      UserOverrideUtil.getOverrideMeta(seg);
    expect(meta).not.toBeNull();
    expect(meta!.isOverride).toBe(true);
    expect(meta!.originalUserId).toBe("A");
    expect(meta!.overrideUserId).toBe("B");
    // meta timestamps are the ORIGINAL override window (not clamped).
    expect(meta!.overrideStartsAt.getTime()).toBe(at(8).getTime());
    expect(meta!.overrideEndsAt.getTime()).toBe(at(16).getTime());
  });

  test("non-substituted (pass-through) segments carry NO meta", () => {
    const base: CalendarEvent = hourEvent("A", 8, 14);
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [hourOverride("A", "B", 10, 12)],
      });
    const before: CalendarEvent = result.find((e: CalendarEvent) => {
      return e.start.getTime() === at(8).getTime();
    })!;
    const after: CalendarEvent = result.find((e: CalendarEvent) => {
      return e.start.getTime() === at(12).getTime();
    })!;
    expect(UserOverrideUtil.getOverrideMeta(before)).toBeNull();
    expect(UserOverrideUtil.getOverrideMeta(after)).toBeNull();
    expect(
      (before as unknown as Record<string, unknown>)[OVERRIDE_META_KEY],
    ).toBeUndefined();
  });

  test("getOverrideMeta returns null for malformed / partial meta", () => {
    const noMeta: CalendarEvent = hourEvent("A", 8, 14);
    expect(UserOverrideUtil.getOverrideMeta(noMeta)).toBeNull();

    const falseMeta: CalendarEvent = {
      ...hourEvent("A", 8, 14),
      [OVERRIDE_META_KEY]: { isOverride: false } as unknown as never,
    };
    expect(UserOverrideUtil.getOverrideMeta(falseMeta)).toBeNull();

    const primitiveMeta: CalendarEvent = {
      ...hourEvent("A", 8, 14),
      [OVERRIDE_META_KEY]: "nope" as unknown as never,
    };
    expect(UserOverrideUtil.getOverrideMeta(primitiveMeta)).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * One override spanning multiple events
 * ---------------------------------------------------------------------------
 */

describe("one override spanning multiple events for the same user", () => {
  test("override [9,15] over A[8,10], A[11,13], A[14,16]", () => {
    const e1: CalendarEvent = hourEvent("A", 8, 10);
    const e2: CalendarEvent = hourEvent("A", 11, 13);
    const e3: CalendarEvent = hourEvent("A", 14, 16);
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [e1, e2, e3],
        overrides: [hourOverride("A", "B", 9, 15)],
      });
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["A", 8, 9, false],
        ["B", 9, 10, true],
        ["B", 11, 13, true],
        ["B", 14, 15, true],
        ["A", 15, 16, false],
      ]),
    );
    // spot-check resolution, including the gaps between events.
    expect(resolvedAt(result, at(8, 30))).toBe("A");
    expect(resolvedAt(result, at(9, 30))).toBe("B");
    expect(resolvedAt(result, at(10, 30))).toBeNull(); // gap between e1 and e2
    expect(resolvedAt(result, at(12))).toBe("B");
    expect(resolvedAt(result, at(13, 30))).toBeNull(); // gap between e2 and e3
    expect(resolvedAt(result, at(14, 30))).toBe("B");
    expect(resolvedAt(result, at(15, 30))).toBe("A");
    // ids reassigned to a contiguous 1..5 sequence, chronological order preserved.
    expect(
      result.map((e: CalendarEvent) => {
        return e.id;
      }),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  test("override only touches events whose title matches the overridden user", () => {
    const eA: CalendarEvent = hourEvent("A", 8, 12);
    const eB: CalendarEvent = hourEvent("B", 12, 16);
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [eA, eB],
        overrides: [hourOverride("A", "X", 6, 20)], // spans both, but only A matches
      });
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["X", 8, 12, true],
        ["B", 12, 16, false],
      ]),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Multiple overrides on different users
 * ---------------------------------------------------------------------------
 */

describe("multiple overrides on different users", () => {
  test("three independent overrides on three users each apply", () => {
    const eA: CalendarEvent = hourEvent("A", 8, 12);
    const eB: CalendarEvent = hourEvent("B", 12, 16);
    const eC: CalendarEvent = hourEvent("C", 16, 20);
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [eA, eB, eC],
        overrides: [
          hourOverride("A", "X", 9, 11),
          hourOverride("B", "Y", 13, 15),
          hourOverride("C", "Z", 17, 19),
        ],
      });
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["A", 8, 9, false],
        ["X", 9, 11, true],
        ["A", 11, 12, false],
        ["B", 12, 13, false],
        ["Y", 13, 15, true],
        ["B", 15, 16, false],
        ["C", 16, 17, false],
        ["Z", 17, 19, true],
        ["C", 19, 20, false],
      ]),
    );
  });

  test("result is independent of the input order of overrides on different users", () => {
    const build: (
      overrides: Array<UserOverrideRecord>,
    ) => Array<CalendarEvent> = (overrides: Array<UserOverrideRecord>) => {
      return UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 12), hourEvent("B", 12, 16)],
        overrides: overrides,
      });
    };
    const ovA: UserOverrideRecord = hourOverride("A", "X", 9, 11);
    const ovB: UserOverrideRecord = hourOverride("B", "Y", 13, 15);
    expect(segs(build([ovA, ovB]))).toEqual(segs(build([ovB, ovA])));
  });
});

/*
 * ---------------------------------------------------------------------------
 * Chained overrides (non-transitive) and swaps
 * ---------------------------------------------------------------------------
 */

describe("chained / swapped overrides are non-transitive", () => {
  const chainForward: Array<UserOverrideRecord> = [
    hourOverride("A", "B", 9, 13),
    hourOverride("B", "C", 10, 12),
  ];

  test("A->B then B->C stays B (no double substitution) and is order independent", () => {
    const forward: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: chainForward,
      });
    const reverse: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [chainForward[1]!, chainForward[0]!],
      });
    const expected: Array<Seg> = expectedHourSegs([
      ["A", 8, 9, false],
      ["B", 9, 13, true],
      ["A", 13, 14, false],
    ]);
    expect(segs(forward)).toEqual(expected);
    expect(segs(reverse)).toEqual(expected);
    expect(resolvedAt(forward, at(11))).toBe("B");
    expect(resolvedAt(reverse, at(11))).toBe("B");
  });

  test("swap A->B and B->A: the freshly substituted B segment is frozen (stays B)", () => {
    const overrides: Array<UserOverrideRecord> = [
      hourOverride("A", "B", 9, 13),
      hourOverride("B", "A", 9, 13),
    ];
    const forward: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: overrides,
      });
    const reverse: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [overrides[1]!, overrides[0]!],
      });
    const expected: Array<Seg> = expectedHourSegs([
      ["A", 8, 9, false],
      ["B", 9, 13, true],
      ["A", 13, 14, false],
    ]);
    expect(segs(forward)).toEqual(expected);
    expect(segs(reverse)).toEqual(expected);
  });

  test("a separate original B event IS still overridden by B->A (only the substituted B is frozen)", () => {
    /*
     * event A[8,14] plus a genuinely-original B[14,20]. A->B on [9,13] creates a
     * frozen B segment; B->A on [15,19] must still act on the ORIGINAL B event.
     */
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14), hourEvent("B", 14, 20)],
        overrides: [
          hourOverride("A", "B", 9, 13),
          hourOverride("B", "A", 15, 19),
        ],
      });
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["A", 8, 9, false],
        ["B", 9, 13, true], // substituted -> frozen, NOT re-routed to A
        ["A", 13, 14, false],
        ["B", 14, 15, false],
        ["A", 15, 19, true], // original B re-routed to A
        ["B", 19, 20, false],
      ]),
    );
  });

  test("three-link chain A->B, B->C, C->D never cascades past the first hop", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 18)],
        overrides: [
          hourOverride("A", "B", 9, 17),
          hourOverride("B", "C", 10, 16),
          hourOverride("C", "D", 11, 15),
        ],
      });
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["A", 8, 9, false],
        ["B", 9, 17, true],
        ["A", 17, 18, false],
      ]),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Self override A->A
 * ---------------------------------------------------------------------------
 */

describe("self override A->A", () => {
  test("A->A splits the window but keeps the title A and tags the middle with meta", () => {
    /*
     * NOTE: current behavior - a self-override still produces a distinct
     * meta-tagged middle segment even though the resolved user is unchanged.
     */
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [hourOverride("A", "A", 10, 12)],
      });
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["A", 8, 10, false],
        ["A", 10, 12, true],
        ["A", 12, 14, false],
      ]),
    );
    // resolved user is A across the entire window.
    expect(resolvedAt(result, at(9))).toBe("A");
    expect(resolvedAt(result, at(11))).toBe("A");
    expect(resolvedAt(result, at(13))).toBe("A");
    const mid: OverrideEventMeta | null = UserOverrideUtil.getOverrideMeta(
      result[1]!,
    );
    expect(mid).not.toBeNull();
    expect(mid!.originalUserId).toBe("A");
    expect(mid!.overrideUserId).toBe("A");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Global vs policy-scoped precedence
 * ---------------------------------------------------------------------------
 */

describe("global vs policy-scoped precedence", () => {
  test("policy-scoped wins over global for the same user/window (input order: global first)", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [
          hourOverride("A", "B", 9, 13, null), // global
          hourOverride("A", "C", 9, 13, "policy-1"), // policy-scoped
        ],
        currentOnCallDutyPolicyId: "policy-1",
      });
    expect(resolvedAt(result, at(11))).toBe("C");
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["A", 8, 9, false],
        ["C", 9, 13, true],
        ["A", 13, 14, false],
      ]),
    );
  });

  test("policy-scoped wins over global regardless of input order (input order: policy first)", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [
          hourOverride("A", "C", 9, 13, "policy-1"), // policy-scoped
          hourOverride("A", "B", 9, 13, null), // global
        ],
        currentOnCallDutyPolicyId: "policy-1",
      });
    expect(resolvedAt(result, at(11))).toBe("C");
  });

  test("wider global fills the window around the narrower policy-scoped substitution", () => {
    /*
     * policy A->C on [10,12] wins in that window; global A->B on [8,14] fills
     * the leading and trailing A segments the policy override left behind.
     */
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [
          hourOverride("A", "B", 8, 14, null), // global (wide)
          hourOverride("A", "C", 10, 12, "policy-1"), // policy (narrow)
        ],
        currentOnCallDutyPolicyId: "policy-1",
      });
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["B", 8, 10, true],
        ["C", 10, 12, true],
        ["B", 12, 14, true],
      ]),
    );
    expect(resolvedAt(result, at(9))).toBe("B");
    expect(resolvedAt(result, at(11))).toBe("C");
    expect(resolvedAt(result, at(13))).toBe("B");
  });

  test("two policy-scoped overrides for the SAME policy on different users both apply", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 12), hourEvent("B", 12, 16)],
        overrides: [
          hourOverride("A", "X", 9, 11, "policy-1"),
          hourOverride("B", "Y", 13, 15, "policy-1"),
        ],
        currentOnCallDutyPolicyId: "policy-1",
      });
    expect(resolvedAt(result, at(10))).toBe("X");
    expect(resolvedAt(result, at(14))).toBe("Y");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Policy scoping: filtering by context
 * ---------------------------------------------------------------------------
 */

describe("policy scoping filters overrides by caller context", () => {
  test("policy-scoped override must NOT apply to a different policy", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [hourOverride("A", "B", 9, 13, "policy-1")],
        currentOnCallDutyPolicyId: "policy-2",
      });
    // Not applicable -> events returned unchanged.
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("A");
    expect(resolvedAt(result, at(11))).toBe("A");
  });

  test("with no policy context, only global overrides apply", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [
          hourOverride("A", "P", 9, 11, "policy-1"), // policy-scoped -> filtered out
          hourOverride("A", "G", 12, 13, null), // global -> applies
        ],
        // currentOnCallDutyPolicyId omitted (no context)
      });
    expect(resolvedAt(result, at(10))).toBe("A"); // policy-scoped dropped
    expect(resolvedAt(result, at(12, 30))).toBe("G"); // global applied
    expect(segs(result)).toEqual(
      expectedHourSegs([
        ["A", 8, 12, false],
        ["G", 12, 13, true],
        ["A", 13, 14, false],
      ]),
    );
  });

  test("matching policy context: both the matching policy override and the global apply", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 12), hourEvent("B", 12, 16)],
        overrides: [
          hourOverride("A", "P", 9, 11, "policy-1"), // applies to A
          hourOverride("B", "G", 13, 15, null), // global, applies to B
          hourOverride("A", "Z", 9, 11, "policy-9"), // wrong policy -> dropped
        ],
        currentOnCallDutyPolicyId: "policy-1",
      });
    expect(resolvedAt(result, at(10))).toBe("P");
    expect(resolvedAt(result, at(14))).toBe("G");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Event id reassignment & uniqueness
 * ---------------------------------------------------------------------------
 */

describe("event id reassignment and uniqueness", () => {
  test("ids are reassigned to a unique contiguous 1..n sequence after a split", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [
          { ...hourEvent("A", 8, 14), id: 99 },
          { ...hourEvent("B", 14, 20), id: 42 },
        ],
        overrides: [hourOverride("A", "X", 10, 12)],
      });
    const ids: Array<number> = result.map((e: CalendarEvent) => {
      return e.id;
    });
    expect(ids).toEqual([1, 2, 3, 4]); // A|X|A + B
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("ids are reassigned even when an applicable override matches no event", () => {
    /*
     * Override targets user Z who is not on the roster. applicable is non-empty
     * so the id reassignment path still runs.
     */
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [
          { ...hourEvent("A", 8, 14), id: 77 },
          { ...hourEvent("B", 14, 20), id: 88 },
        ],
        overrides: [hourOverride("Z", "Q", 10, 12)],
      });
    expect(
      result.map((e: CalendarEvent) => {
        return e.id;
      }),
    ).toEqual([1, 2]);
    expect(
      result.map((e: CalendarEvent) => {
        return e.title;
      }),
    ).toEqual(["A", "B"]);
  });

  test("no applicable overrides: the original array (and original ids) is returned unchanged", () => {
    const events: Array<CalendarEvent> = [
      { ...hourEvent("A", 8, 14), id: 77 },
      { ...hourEvent("B", 14, 20), id: 88 },
    ];
    const emptyResult: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: events,
        overrides: [],
      });
    expect(emptyResult).toBe(events); // same reference, untouched
    expect(
      emptyResult.map((e: CalendarEvent) => {
        return e.id;
      }),
    ).toEqual([77, 88]);

    // All overrides filtered out by policy scoping -> also unchanged.
    const filteredResult: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: events,
        overrides: [hourOverride("A", "B", 10, 12, "other-policy")],
        currentOnCallDutyPolicyId: "policy-1",
      });
    expect(filteredResult).toBe(events);
    expect(
      filteredResult.map((e: CalendarEvent) => {
        return e.id;
      }),
    ).toEqual([77, 88]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Structural invariants
 * ---------------------------------------------------------------------------
 */

describe("structural invariants", () => {
  test("non-title/boundary properties are preserved onto the produced segments", () => {
    const base: CalendarEvent = hourEvent("A", 8, 14, {
      color: "#123456",
      textColor: "#ffffff",
      desc: "primary shift",
      allDay: false,
    });
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [base],
        overrides: [hourOverride("A", "B", 10, 12)],
      });
    for (const e of result) {
      expect(e.color).toBe("#123456");
      expect(e.textColor).toBe("#ffffff");
      expect(e.desc).toBe("primary shift");
      expect(e.allDay).toBe(false);
    }
  });

  test("the input events and their objects are not mutated", () => {
    const base: CalendarEvent = hourEvent("A", 8, 14);
    const snapshotTitle: string = base.title;
    const snapshotStart: number = base.start.getTime();
    const snapshotEnd: number = base.end.getTime();
    const snapshotId: number = base.id;
    const events: Array<CalendarEvent> = [base];

    UserOverrideUtil.applyOverridesToEvents({
      events: events,
      overrides: [hourOverride("A", "B", 10, 12)],
    });

    expect(events).toHaveLength(1);
    expect(base.title).toBe(snapshotTitle);
    expect(base.start.getTime()).toBe(snapshotStart);
    expect(base.end.getTime()).toBe(snapshotEnd);
    expect(base.id).toBe(snapshotId);
    expect(
      (base as unknown as Record<string, unknown>)[OVERRIDE_META_KEY],
    ).toBeUndefined();
  });

  test("empty events with applicable overrides returns an empty array", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [],
        overrides: [hourOverride("A", "B", 10, 12)],
      });
    expect(result).toEqual([]);
  });

  test("produced segments within a single event are contiguous and non-overlapping", () => {
    const result: Array<CalendarEvent> =
      UserOverrideUtil.applyOverridesToEvents({
        events: [hourEvent("A", 8, 14)],
        overrides: [hourOverride("A", "B", 10, 12)],
      });
    for (let i: number = 1; i < result.length; i++) {
      // each segment starts exactly where the previous ended.
      expect(result[i]!.start.getTime()).toBe(result[i - 1]!.end.getTime());
    }
    // union of segments covers the whole original window.
    expect(result[0]!.start.getTime()).toBe(at(8).getTime());
    expect(result[result.length - 1]!.end.getTime()).toBe(at(14).getTime());
  });
});
