import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../Types/Date";
import { MaterializedShift } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import ScheduleTimelineUtil, {
  SCHEDULE_TIMELINE_ROUTE,
  ScheduleTimelineResponse,
  ScheduleTimelineShiftJson,
  TIMELINE_DEFAULT_SPAN_DAYS,
  TIMELINE_MAX_FUTURE_DAYS,
  TIMELINE_MAX_PAST_DAYS,
  TIMELINE_MAX_SCHEDULES,
  TIMELINE_MAX_SPAN_DAYS,
  TimelineWindow,
} from "../../../Types/OnCallDutyPolicy/ScheduleTimeline";
import { at, shift } from "./CalendarFeedTestFixtures";

/*
 * The schedule timeline's wire contract: how a requested window is validated
 * and clamped, how it is widened for the shared schedule cache, how a
 * materialized shift is projected onto the timeline, and how the dashboard
 * parses whatever the server sends back.
 */

const NOW: Date = at("2026-09-17T12:00:00.000Z");

function daysFrom(date: Date, days: number): Date {
  return OneUptimeDate.addRemoveDays(date, days);
}

describe("constants", () => {
  test("the route and the limits are pinned", () => {
    expect(SCHEDULE_TIMELINE_ROUTE).toBe("/on-call-schedule-timeline");
    expect(TIMELINE_MAX_PAST_DAYS).toBe(180);
    expect(TIMELINE_MAX_FUTURE_DAYS).toBe(365);
    expect(TIMELINE_MAX_SPAN_DAYS).toBe(45);
    expect(TIMELINE_DEFAULT_SPAN_DAYS).toBe(7);
    expect(TIMELINE_MAX_SCHEDULES).toBe(250);
  });

  test("a month view in any zone fits inside the span cap", () => {
    // 31 days plus up to a day of zone offset at each end.
    expect(TIMELINE_MAX_SPAN_DAYS).toBeGreaterThanOrEqual(33);
  });
});

describe("getAddressableRange", () => {
  test("is [now - 180 d, now + 365 d]", () => {
    const range: TimelineWindow = ScheduleTimelineUtil.getAddressableRange(NOW);

    expect(range.from.toISOString()).toBe(
      daysFrom(NOW, -TIMELINE_MAX_PAST_DAYS).toISOString(),
    );
    expect(range.to.toISOString()).toBe(
      daysFrom(NOW, TIMELINE_MAX_FUTURE_DAYS).toISOString(),
    );
  });
});

describe("clampWindow", () => {
  test("a normal week passes through untouched", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-21T00:00:00.000Z",
      now: NOW,
    });

    expect(window.from.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  test("surrounding whitespace is tolerated", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "  2026-09-14T00:00:00.000Z ",
      to: " 2026-09-21T00:00:00.000Z",
      now: NOW,
    });

    expect(window.from.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  test("`to` defaults to from + 7 days", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "2026-09-14T00:00:00.000Z",
      to: undefined,
      now: NOW,
    });

    expect(window.to.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  test("an empty `to` also defaults", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "2026-09-14T00:00:00.000Z",
      to: "",
      now: NOW,
    });

    expect(window.to.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  test("`from` is required", () => {
    expect(() => {
      ScheduleTimelineUtil.clampWindow({
        from: undefined,
        to: undefined,
        now: NOW,
      });
    }).toThrow(BadDataException);

    expect(() => {
      ScheduleTimelineUtil.clampWindow({ from: null, to: undefined, now: NOW });
    }).toThrow("from is required.");
  });

  test.each([["yesterday"], ["2026-13-45"], ["   "], [42], [{}]])(
    "a garbage `from` (%p) is a 400",
    (from: unknown) => {
      expect(() => {
        ScheduleTimelineUtil.clampWindow({ from, to: undefined, now: NOW });
      }).toThrow(BadDataException);
    },
  );

  test("a garbage `to` is a 400", () => {
    expect(() => {
      ScheduleTimelineUtil.clampWindow({
        from: "2026-09-14T00:00:00.000Z",
        to: "next tuesday",
        now: NOW,
      });
    }).toThrow("to must be an ISO 8601 date.");
  });

  test("`to` at or before `from` is a 400", () => {
    expect(() => {
      ScheduleTimelineUtil.clampWindow({
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-14T00:00:00.000Z",
        now: NOW,
      });
    }).toThrow("to must be after from.");

    expect(() => {
      ScheduleTimelineUtil.clampWindow({
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-01T00:00:00.000Z",
        now: NOW,
      });
    }).toThrow(BadDataException);
  });

  test("a span wider than 45 days is pulled in, not refused", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "2026-09-01T00:00:00.000Z",
      to: "2027-03-01T00:00:00.000Z",
      now: NOW,
    });

    expect(window.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(window.to.toISOString()).toBe(
      daysFrom(at("2026-09-01T00:00:00.000Z"), 45).toISOString(),
    );
  });

  test("a month-long window is kept whole", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "2026-10-01T04:00:00.000Z",
      to: "2026-11-01T04:00:00.000Z",
      now: NOW,
    });

    expect(window.to.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  test("a `from` before the look-back limit is moved up to it", () => {
    const earliest: Date = daysFrom(NOW, -TIMELINE_MAX_PAST_DAYS);
    const from: Date = daysFrom(earliest, -3);
    const to: Date = daysFrom(earliest, 4);

    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: from.toISOString(),
      to: to.toISOString(),
      now: NOW,
    });

    expect(window.from.toISOString()).toBe(earliest.toISOString());
    expect(window.to.toISOString()).toBe(to.toISOString());
  });

  test("a `to` after the look-ahead limit is moved back to it", () => {
    const latest: Date = daysFrom(NOW, TIMELINE_MAX_FUTURE_DAYS);
    const from: Date = daysFrom(latest, -2);

    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: from.toISOString(),
      to: daysFrom(latest, 5).toISOString(),
      now: NOW,
    });

    expect(window.from.toISOString()).toBe(from.toISOString());
    expect(window.to.toISOString()).toBe(latest.toISOString());
  });

  test("a window wholly in the distant past collapses onto the first addressable day", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "2020-01-01T00:00:00.000Z",
      to: "2020-01-08T00:00:00.000Z",
      now: NOW,
    });

    const earliest: Date = daysFrom(NOW, -TIMELINE_MAX_PAST_DAYS);

    expect(window.from.toISOString()).toBe(earliest.toISOString());
    expect(window.to.toISOString()).toBe(daysFrom(earliest, 1).toISOString());
  });

  test("a window wholly in the far future collapses onto the last addressable day", () => {
    const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
      from: "2031-01-01T00:00:00.000Z",
      to: "2031-01-08T00:00:00.000Z",
      now: NOW,
    });

    const latest: Date = daysFrom(NOW, TIMELINE_MAX_FUTURE_DAYS);

    expect(window.to.toISOString()).toBe(latest.toISOString());
    expect(window.from.toISOString()).toBe(daysFrom(latest, -1).toISOString());
  });

  test("the clamped window is never empty or inverted", () => {
    const candidates: Array<[string, string]> = [
      ["1999-01-01T00:00:00.000Z", "1999-01-02T00:00:00.000Z"],
      ["2040-01-01T00:00:00.000Z", "2040-02-01T00:00:00.000Z"],
      ["2026-09-17T11:59:00.000Z", "2026-09-17T12:01:00.000Z"],
      ["2026-03-21T00:00:00.000Z", "2026-03-22T00:00:00.000Z"],
    ];

    for (const [from, to] of candidates) {
      const window: TimelineWindow = ScheduleTimelineUtil.clampWindow({
        from,
        to,
        now: NOW,
      });

      expect(window.to.getTime()).toBeGreaterThan(window.from.getTime());
      expect(window.to.getTime() - window.from.getTime()).toBeLessThanOrEqual(
        TIMELINE_MAX_SPAN_DAYS * 24 * 60 * 60 * 1000,
      );
    }
  });
});

describe("getCacheWindow", () => {
  test("widens to whole UTC days", () => {
    const cache: { windowStart: Date; windowEnd: Date } =
      ScheduleTimelineUtil.getCacheWindow({
        from: at("2026-09-14T04:00:00.000Z"),
        to: at("2026-09-21T04:00:00.000Z"),
      });

    expect(cache.windowStart.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(cache.windowEnd.toISOString()).toBe("2026-09-22T00:00:00.000Z");
  });

  test("an end already on a UTC midnight is not pushed a day further", () => {
    const cache: { windowStart: Date; windowEnd: Date } =
      ScheduleTimelineUtil.getCacheWindow({
        from: at("2026-09-14T00:00:00.000Z"),
        to: at("2026-09-21T00:00:00.000Z"),
      });

    expect(cache.windowStart.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(cache.windowEnd.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  test("a zone east of UTC starts the cache window on the previous UTC day", () => {
    // Monday 00:00 in Tokyo is Sunday 15:00 UTC.
    const cache: { windowStart: Date; windowEnd: Date } =
      ScheduleTimelineUtil.getCacheWindow({
        from: at("2026-09-13T15:00:00.000Z"),
        to: at("2026-09-20T15:00:00.000Z"),
      });

    expect(cache.windowStart.toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(cache.windowEnd.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  test("two different zones' views of the same days share cache windows", () => {
    const london: { windowStart: Date; windowEnd: Date } =
      ScheduleTimelineUtil.getCacheWindow({
        from: at("2026-09-13T23:00:00.000Z"),
        to: at("2026-09-20T23:00:00.000Z"),
      });

    const paris: { windowStart: Date; windowEnd: Date } =
      ScheduleTimelineUtil.getCacheWindow({
        from: at("2026-09-13T22:00:00.000Z"),
        to: at("2026-09-20T22:00:00.000Z"),
      });

    expect(london.windowStart.toISOString()).toBe(
      paris.windowStart.toISOString(),
    );
    expect(london.windowEnd.toISOString()).toBe(paris.windowEnd.toISOString());
  });
});

describe("toTimelineShift", () => {
  const window: TimelineWindow = {
    from: at("2026-09-14T00:00:00.000Z"),
    to: at("2026-09-21T00:00:00.000Z"),
  };

  test("projects the fields the timeline draws", () => {
    const source: MaterializedShift = shift({
      start: at("2026-09-15T09:00:00.000Z"),
      end: at("2026-09-16T09:00:00.000Z"),
      userId: "user-a",
      userName: "Alice Andersson",
      layerId: "layer-1",
      layerName: "Primary",
    });

    const projected: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(source, window);

    expect(projected).toEqual({
      shiftKey: source.shiftKey,
      userId: "user-a",
      userName: "Alice Andersson",
      start: "2026-09-15T09:00:00.000Z",
      end: "2026-09-16T09:00:00.000Z",
      layerId: "layer-1",
      layerName: "Primary",
      override: null,
    });
  });

  test("absent layer facts become null, not undefined", () => {
    const projected: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(
        shift({
          start: at("2026-09-15T09:00:00.000Z"),
          end: at("2026-09-16T09:00:00.000Z"),
        }),
        window,
      );

    expect(projected?.layerId).toBeNull();
    expect(projected?.layerName).toBeNull();
  });

  test("override provenance is carried, with a global override's policy as null", () => {
    const projected: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(
        shift({
          start: at("2026-09-15T12:00:00.000Z"),
          end: at("2026-09-15T18:00:00.000Z"),
          userId: "user-b",
          userName: "Bob Berg",
          override: {
            originalUserId: "user-a",
            originalUserName: "Alice Andersson",
            overrideStartsAt: at("2026-09-15T10:00:00.000Z"),
            overrideEndsAt: at("2026-09-15T18:00:00.000Z"),
          },
        }),
        window,
      );

    expect(projected?.override).toEqual({
      originalUserId: "user-a",
      originalUserName: "Alice Andersson",
      overrideStartsAt: "2026-09-15T10:00:00.000Z",
      overrideEndsAt: "2026-09-15T18:00:00.000Z",
      onCallDutyPolicyId: null,
    });
  });

  test("a policy-scoped override keeps its policy id", () => {
    const projected: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(
        shift({
          start: at("2026-09-15T12:00:00.000Z"),
          end: at("2026-09-15T18:00:00.000Z"),
          override: {
            originalUserId: "user-a",
            originalUserName: "Alice Andersson",
            overrideStartsAt: at("2026-09-15T12:00:00.000Z"),
            overrideEndsAt: at("2026-09-15T18:00:00.000Z"),
            onCallDutyPolicyId: "pol-9",
          },
        }),
        window,
      );

    expect(projected?.override?.onCallDutyPolicyId).toBe("pol-9");
  });

  test("policy-variant shifts are dropped (one person per row)", () => {
    const projected: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(
        shift({
          start: at("2026-09-15T12:00:00.000Z"),
          end: at("2026-09-15T18:00:00.000Z"),
          policyVariantOf: {
            policyId: "pol-2",
            policyName: "Secondary",
            globalUserId: "user-a",
          },
        }),
        window,
      );

    expect(projected).toBeNull();
  });

  test("shifts outside the window are dropped; the edges are exclusive", () => {
    const endsAtFrom: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(
        shift({
          start: at("2026-09-13T09:00:00.000Z"),
          end: at("2026-09-14T00:00:00.000Z"),
        }),
        window,
      );

    const startsAtTo: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(
        shift({
          start: at("2026-09-21T00:00:00.000Z"),
          end: at("2026-09-22T00:00:00.000Z"),
        }),
        window,
      );

    expect(endsAtFrom).toBeNull();
    expect(startsAtTo).toBeNull();
  });

  test("a shift straddling an edge is kept whole (the page clips it)", () => {
    const projected: ScheduleTimelineShiftJson | null =
      ScheduleTimelineUtil.toTimelineShift(
        shift({
          start: at("2026-09-10T09:00:00.000Z"),
          end: at("2026-09-17T09:00:00.000Z"),
        }),
        window,
      );

    expect(projected?.start).toBe("2026-09-10T09:00:00.000Z");
    expect(projected?.end).toBe("2026-09-17T09:00:00.000Z");
  });
});

describe("parseResponse", () => {
  const validShift: Record<string, unknown> = {
    shiftKey: "s1:1",
    userId: "user-a",
    userName: "Alice",
    start: "2026-09-15T09:00:00.000Z",
    end: "2026-09-16T09:00:00.000Z",
    layerId: null,
    layerName: null,
    override: null,
  };

  test("anything that is not an object is an error", () => {
    for (const value of [null, undefined, "x", 3, []]) {
      expect(() => {
        ScheduleTimelineUtil.parseResponse(value);
      }).toThrow("Invalid schedule timeline response.");
    }
  });

  test("an empty object parses to an empty timeline", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {},
    );

    expect(parsed).toEqual({
      from: "",
      to: "",
      generatedAt: "",
      truncated: false,
      totalScheduleCount: 0,
      schedulesTruncated: false,
      schedules: [],
      teams: [],
    });
  });

  test("a well-formed response round-trips", () => {
    const body: ScheduleTimelineResponse = {
      from: "2026-09-14T00:00:00.000Z",
      to: "2026-09-21T00:00:00.000Z",
      generatedAt: "2026-09-17T12:00:00.000Z",
      truncated: true,
      totalScheduleCount: 300,
      schedulesTruncated: true,
      schedules: [
        {
          scheduleId: "sched-1",
          scheduleName: "Payments",
          scheduleTimezone: "Europe/Stockholm",
          ownerTeamIds: ["team-1"],
          isCurrentUserOnRoster: true,
          truncated: false,
          shifts: [
            {
              shiftKey: "k1",
              userId: "user-b",
              userName: "Bob",
              start: "2026-09-15T12:00:00.000Z",
              end: "2026-09-15T18:00:00.000Z",
              layerId: "layer-1",
              layerName: "Primary",
              override: {
                originalUserId: "user-a",
                originalUserName: "Alice",
                overrideStartsAt: "2026-09-15T12:00:00.000Z",
                overrideEndsAt: "2026-09-15T18:00:00.000Z",
                onCallDutyPolicyId: null,
              },
            },
          ],
        },
      ],
      teams: [{ teamId: "team-1", teamName: "SRE", isCurrentUserMember: true }],
    };

    expect(
      ScheduleTimelineUtil.parseResponse(JSON.parse(JSON.stringify(body))),
    ).toEqual(body);
  });

  test("schedules without an id are skipped, names default", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        schedules: [
          { scheduleName: "No id" },
          "not an object",
          { scheduleId: "sched-2" },
        ],
      },
    );

    expect(parsed.schedules).toHaveLength(1);
    expect(parsed.schedules[0]).toEqual({
      scheduleId: "sched-2",
      scheduleName: "Unnamed schedule",
      scheduleTimezone: null,
      ownerTeamIds: [],
      isCurrentUserOnRoster: false,
      truncated: false,
      shifts: [],
    });
  });

  test("malformed shifts are skipped, never thrown on", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        schedules: [
          {
            scheduleId: "sched-1",
            shifts: [
              validShift,
              { ...validShift, userId: undefined },
              { ...validShift, start: "not a date" },
              { ...validShift, end: undefined },
              // Empty and inverted intervals cannot be drawn.
              { ...validShift, end: validShift["start"] },
              {
                ...validShift,
                start: "2026-09-16T09:00:00.000Z",
                end: "2026-09-15T09:00:00.000Z",
              },
              null,
              42,
            ],
          },
        ],
      },
    );

    expect(parsed.schedules[0]?.shifts).toHaveLength(1);
    expect(parsed.schedules[0]?.shifts[0]?.userId).toBe("user-a");
  });

  test("shifts are sorted by start", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        schedules: [
          {
            scheduleId: "sched-1",
            shifts: [
              {
                ...validShift,
                shiftKey: "late",
                start: "2026-09-18T09:00:00.000Z",
                end: "2026-09-19T09:00:00.000Z",
              },
              { ...validShift, shiftKey: "early" },
            ],
          },
        ],
      },
    );

    expect(
      parsed.schedules[0]?.shifts.map((item: ScheduleTimelineShiftJson) => {
        return item.shiftKey;
      }),
    ).toEqual(["early", "late"]);
  });

  test("missing shift names and keys get safe fallbacks", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        schedules: [
          {
            scheduleId: "sched-1",
            shifts: [
              {
                userId: "user-a",
                start: "2026-09-15T09:00:00.000Z",
                end: "2026-09-16T09:00:00.000Z",
              },
            ],
          },
        ],
      },
    );

    const parsedShift: ScheduleTimelineShiftJson | undefined =
      parsed.schedules[0]?.shifts[0];

    expect(parsedShift?.userName).toBe("Unknown user");
    expect(parsedShift?.shiftKey).toBe("user-a:2026-09-15T09:00:00.000Z");
    expect(parsedShift?.layerId).toBeNull();
    expect(parsedShift?.override).toBeNull();
  });

  test("an override without the original user is dropped; partial ones are repaired", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        schedules: [
          {
            scheduleId: "sched-1",
            shifts: [
              { ...validShift, shiftKey: "a", override: { foo: "bar" } },
              {
                ...validShift,
                shiftKey: "b",
                start: "2026-09-17T09:00:00.000Z",
                end: "2026-09-18T09:00:00.000Z",
                override: { originalUserId: "user-z" },
              },
            ],
          },
        ],
      },
    );

    const shifts: Array<ScheduleTimelineShiftJson> =
      parsed.schedules[0]?.shifts || [];

    expect(shifts[0]?.override).toBeNull();
    expect(shifts[1]?.override).toEqual({
      originalUserId: "user-z",
      originalUserName: "Unknown user",
      overrideStartsAt: "2026-09-17T09:00:00.000Z",
      overrideEndsAt: "2026-09-18T09:00:00.000Z",
      onCallDutyPolicyId: null,
    });
  });

  test("owner team ids that are not strings are dropped", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        schedules: [
          { scheduleId: "sched-1", ownerTeamIds: ["team-1", 7, null, ""] },
        ],
      },
    );

    expect(parsed.schedules[0]?.ownerTeamIds).toEqual(["team-1"]);
  });

  test("teams without an id are skipped and names default", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        teams: [
          { teamName: "Ghost" },
          { teamId: "team-1" },
          { teamId: "team-2", teamName: "SRE", isCurrentUserMember: "yes" },
        ],
      },
    );

    expect(parsed.teams).toEqual([
      {
        teamId: "team-1",
        teamName: "Unnamed team",
        isCurrentUserMember: false,
      },
      { teamId: "team-2", teamName: "SRE", isCurrentUserMember: false },
    ]);
  });

  test("totalScheduleCount falls back to the number of schedules", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        totalScheduleCount: "many",
        schedules: [{ scheduleId: "a" }, { scheduleId: "b" }],
      },
    );

    expect(parsed.totalScheduleCount).toBe(2);
  });

  test("only a literal true counts as true", () => {
    const parsed: ScheduleTimelineResponse = ScheduleTimelineUtil.parseResponse(
      {
        truncated: "true",
        schedulesTruncated: 1,
        schedules: [{ scheduleId: "a", isCurrentUserOnRoster: "true" }],
      },
    );

    expect(parsed.truncated).toBe(false);
    expect(parsed.schedulesTruncated).toBe(false);
    expect(parsed.schedules[0]?.isCurrentUserOnRoster).toBe(false);
  });
});
