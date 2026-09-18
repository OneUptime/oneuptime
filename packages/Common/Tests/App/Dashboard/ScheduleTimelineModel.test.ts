import { describe, expect, test } from "@jest/globals";
import { ScheduleTimelineResponse } from "../../../Types/OnCallDutyPolicy/ScheduleTimeline";
import { TimeInterval } from "../../../Types/OnCallDutyPolicy/ScheduleTimelineLayout";
import { getColorForUserId } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUserColors";
import TimelineModel, {
  ALL_SCHEDULES_GROUP_KEY,
  ALL_TEAMS,
  AttentionFilter,
  DEFAULT_FILTERS,
  MY_TEAMS,
  NO_TEAM_GROUP_KEY,
  TimelineData,
  TimelineFilters,
  TimelineGroup,
  TimelinePerson,
  TimelineSchedule,
  TimelineShift,
  TimelineTeam,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineModel";

/*
 * The schedule timeline's view model: which rows the page shows, in which
 * groups, with which people and counts. Each rule is pinned on hand-built
 * schedules so a change to one cannot hide behind the rendering.
 */

const WINDOW: TimeInterval = {
  start: new Date("2026-09-14T00:00:00.000Z"),
  end: new Date("2026-09-21T00:00:00.000Z"),
};

const NOW: Date = new Date("2026-09-17T12:00:00.000Z");

function shift(
  userId: string,
  userName: string,
  start: string,
  end: string,
  extra?: Partial<TimelineShift>,
): TimelineShift {
  return {
    key: `${userId}:${start}`,
    userId,
    userName,
    start: new Date(start),
    end: new Date(end),
    layerName: null,
    override: null,
    ...(extra || {}),
  };
}

function schedule(
  id: string,
  name: string,
  extra?: Partial<TimelineSchedule>,
): TimelineSchedule {
  return {
    id,
    name,
    timezone: null,
    ownerTeamIds: [],
    isCurrentUserOnRoster: false,
    truncated: false,
    shifts: [],
    ...(extra || {}),
  };
}

const TEAMS: Array<TimelineTeam> = [
  { id: "t-sre", name: "SRE", isCurrentUserMember: true },
  { id: "t-pay", name: "Payments", isCurrentUserMember: false },
  { id: "t-db", name: "Databases", isCurrentUserMember: false },
];

// Covered all week by Alice.
const PAYMENTS: TimelineSchedule = schedule("s-pay", "Payments primary", {
  ownerTeamIds: ["t-pay"],
  shifts: [
    shift(
      "u-alice",
      "Alice Andersson",
      "2026-09-10T09:00:00Z",
      "2026-09-24T09:00:00Z",
    ),
  ],
});

// Nobody from Wednesday 00:00 to Friday 00:00 (so uncovered at NOW).
const SRE: TimelineSchedule = schedule("s-sre", "SRE primary", {
  ownerTeamIds: ["t-sre", "t-pay"],
  isCurrentUserOnRoster: true,
  shifts: [
    shift("u-bob", "Bob Berg", "2026-09-14T00:00:00Z", "2026-09-16T00:00:00Z"),
    shift(
      "u-carol",
      "Carol Chen",
      "2026-09-18T00:00:00Z",
      "2026-09-21T00:00:00Z",
    ),
  ],
});

// Nobody at all, no owner.
const LEGACY: TimelineSchedule = schedule("s-legacy", "Legacy pager");

const ALL: Array<TimelineSchedule> = [PAYMENTS, SRE, LEGACY];

function filter(
  filters: Partial<TimelineFilters>,
  options?: { window?: TimeInterval | null; now?: Date },
): Array<string> {
  return TimelineModel.filterSchedules({
    schedules: ALL,
    teams: TEAMS,
    filters: { ...DEFAULT_FILTERS, ...filters },
    now: options?.now || NOW,
    window: options && "window" in options ? options.window! : WINDOW,
  }).map((item: TimelineSchedule) => {
    return item.id;
  });
}

describe("fromResponse", () => {
  const response: ScheduleTimelineResponse = {
    from: "2026-09-14T00:00:00.000Z",
    to: "2026-09-21T00:00:00.000Z",
    generatedAt: "2026-09-17T12:00:00.000Z",
    truncated: true,
    totalScheduleCount: 9,
    schedulesTruncated: true,
    schedules: [
      {
        scheduleId: "s-1",
        scheduleName: "One",
        scheduleTimezone: "Asia/Tokyo",
        ownerTeamIds: ["t-1"],
        isCurrentUserOnRoster: true,
        truncated: false,
        shifts: [
          {
            shiftKey: "k1",
            userId: "u-1",
            userName: "Uno",
            start: "2026-09-15T00:00:00.000Z",
            end: "2026-09-16T00:00:00.000Z",
            layerId: "l-1",
            layerName: "Layer",
            override: {
              originalUserId: "u-2",
              originalUserName: "Dos",
              overrideStartsAt: "2026-09-14T00:00:00.000Z",
              overrideEndsAt: "2026-09-17T00:00:00.000Z",
              onCallDutyPolicyId: "p-1",
            },
          },
        ],
      },
    ],
    teams: [{ teamId: "t-1", teamName: "Team", isCurrentUserMember: true }],
  };

  test("turns strings into Dates and keeps every fact", () => {
    const data: TimelineData = TimelineModel.fromResponse(response);

    expect(data.truncated).toBe(true);
    expect(data.totalScheduleCount).toBe(9);
    expect(data.schedulesTruncated).toBe(true);
    expect(data.servedWindow?.start.toISOString()).toBe(
      "2026-09-14T00:00:00.000Z",
    );
    expect(data.teams).toEqual([
      { id: "t-1", name: "Team", isCurrentUserMember: true },
    ]);

    const parsed: TimelineSchedule | undefined = data.schedules[0];

    expect(parsed).toMatchObject({
      id: "s-1",
      name: "One",
      timezone: "Asia/Tokyo",
      ownerTeamIds: ["t-1"],
      isCurrentUserOnRoster: true,
    });
    expect(parsed?.shifts[0]?.start).toBeInstanceOf(Date);
    expect(parsed?.shifts[0]?.layerName).toBe("Layer");
    expect(parsed?.shifts[0]?.override).toEqual({
      originalUserId: "u-2",
      originalUserName: "Dos",
      start: new Date("2026-09-14T00:00:00.000Z"),
      end: new Date("2026-09-17T00:00:00.000Z"),
      isPolicyScoped: true,
    });
  });

  test("a global override is not policy-scoped", () => {
    const data: TimelineData = TimelineModel.fromResponse({
      ...response,
      schedules: [
        {
          ...response.schedules[0]!,
          shifts: [
            {
              ...response.schedules[0]!.shifts[0]!,
              override: {
                ...response.schedules[0]!.shifts[0]!.override!,
                onCallDutyPolicyId: null,
              },
            },
          ],
        },
      ],
    });

    expect(data.schedules[0]?.shifts[0]?.override?.isPolicyScoped).toBe(false);
  });

  test("an unusable served window is null", () => {
    expect(
      TimelineModel.fromResponse({ ...response, from: "", to: "" })
        .servedWindow,
    ).toBeNull();
    expect(
      TimelineModel.fromResponse({
        ...response,
        from: response.to,
        to: response.from,
      }).servedWindow,
    ).toBeNull();
  });
});

describe("getComputedWindow", () => {
  test("is the overlap of the visible range and the served window", () => {
    const computed: TimeInterval | null = TimelineModel.getComputedWindow(
      WINDOW,
      {
        start: new Date("2026-09-16T00:00:00.000Z"),
        end: new Date("2026-10-01T00:00:00.000Z"),
      },
    );

    expect(computed?.start.toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(computed?.end.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  test("is null with nothing served or no overlap", () => {
    expect(TimelineModel.getComputedWindow(WINDOW, null)).toBeNull();
    expect(
      TimelineModel.getComputedWindow(WINDOW, {
        start: new Date("2026-10-01T00:00:00.000Z"),
        end: new Date("2026-10-08T00:00:00.000Z"),
      }),
    ).toBeNull();
  });
});

describe("getGaps / getOnCallNow", () => {
  test("gaps are the uncovered parts of the computed window", () => {
    const gaps: Array<TimeInterval> = TimelineModel.getGaps(SRE, WINDOW);

    expect(
      gaps.map((gap: TimeInterval) => {
        return [gap.start.toISOString(), gap.end.toISOString()];
      }),
    ).toEqual([["2026-09-16T00:00:00.000Z", "2026-09-18T00:00:00.000Z"]]);
  });

  test("a schedule with no shifts is one gap; no window, no gaps", () => {
    expect(TimelineModel.getGaps(LEGACY, WINDOW)).toHaveLength(1);
    expect(TimelineModel.getGaps(LEGACY, null)).toEqual([]);
  });

  test("on call now", () => {
    expect(TimelineModel.getOnCallNow(PAYMENTS, NOW)?.userName).toBe(
      "Alice Andersson",
    );
    expect(TimelineModel.getOnCallNow(SRE, NOW)).toBeNull();
  });
});

describe("filterSchedules", () => {
  test("the defaults show everything, in order", () => {
    expect(filter({})).toEqual(["s-pay", "s-sre", "s-legacy"]);
  });

  test("search matches schedule names, case-insensitively", () => {
    expect(filter({ search: "PAYMENTS PRI" })).toEqual(["s-pay"]);
    expect(filter({ search: "  legacy  " })).toEqual(["s-legacy"]);
  });

  test("search matches owner team names", () => {
    // SRE primary is owned by SRE; Payments primary only by Payments.
    expect(filter({ search: "sre" })).toEqual(["s-sre"]);
    // Both are owned by Payments.
    expect(filter({ search: "payments" })).toEqual(["s-pay", "s-sre"]);
  });

  test("search matches the people on call", () => {
    expect(filter({ search: "carol" })).toEqual(["s-sre"]);
    expect(filter({ search: "andersson" })).toEqual(["s-pay"]);
    expect(filter({ search: "nobody by this name" })).toEqual([]);
  });

  test("a specific team", () => {
    expect(filter({ team: "t-sre" })).toEqual(["s-sre"]);
    expect(filter({ team: "t-pay" })).toEqual(["s-pay", "s-sre"]);
    expect(filter({ team: "t-db" })).toEqual([]);
  });

  test("my teams", () => {
    expect(filter({ team: MY_TEAMS })).toEqual(["s-sre"]);
  });

  test("all teams includes schedules with no owner", () => {
    expect(filter({ team: ALL_TEAMS })).toContain("s-legacy");
  });

  test("only schedules I'm on", () => {
    expect(filter({ onlyMine: true })).toEqual(["s-sre"]);
  });

  test("uncovered now", () => {
    expect(filter({ attention: AttentionFilter.UncoveredNow })).toEqual([
      "s-sre",
      "s-legacy",
    ]);
  });

  test("uncovered now cannot be judged when now is not in view", () => {
    expect(
      filter(
        { attention: AttentionFilter.UncoveredNow },
        { now: new Date("2026-10-01T00:00:00.000Z") },
      ),
    ).toEqual([]);

    expect(
      filter({ attention: AttentionFilter.UncoveredNow }, { window: null }),
    ).toEqual([]);
  });

  test("with gaps", () => {
    expect(filter({ attention: AttentionFilter.HasGaps })).toEqual([
      "s-sre",
      "s-legacy",
    ]);
  });

  test("filters combine", () => {
    expect(
      filter({ team: "t-pay", attention: AttentionFilter.HasGaps }),
    ).toEqual(["s-sre"]);
    expect(filter({ onlyMine: true, search: "alice" })).toEqual([]);
  });
});

describe("groupSchedules", () => {
  test("by team: teams by name, a shared schedule in each, unowned last", () => {
    const groups: Array<TimelineGroup> = TimelineModel.groupSchedules({
      schedules: ALL,
      teams: TEAMS,
      groupByTeam: true,
    });

    expect(
      groups.map((group: TimelineGroup) => {
        return [
          group.key,
          group.title,
          group.isCurrentUserMember,
          group.schedules.map((item: TimelineSchedule) => {
            return item.id;
          }),
        ];
      }),
    ).toEqual([
      ["t-pay", "Payments", false, ["s-pay", "s-sre"]],
      ["t-sre", "SRE", true, ["s-sre"]],
      [NO_TEAM_GROUP_KEY, "No owner team", false, ["s-legacy"]],
    ]);
  });

  test("teams without visible schedules get no group", () => {
    const groups: Array<TimelineGroup> = TimelineModel.groupSchedules({
      schedules: ALL,
      teams: TEAMS,
      groupByTeam: true,
    });

    expect(
      groups.some((group: TimelineGroup) => {
        return group.teamId === "t-db";
      }),
    ).toBe(false);
  });

  test("a schedule owned only by an unknown team counts as unowned", () => {
    const groups: Array<TimelineGroup> = TimelineModel.groupSchedules({
      schedules: [schedule("s-x", "X", { ownerTeamIds: ["t-deleted"] })],
      teams: TEAMS,
      groupByTeam: true,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(NO_TEAM_GROUP_KEY);
  });

  test("a specific team filter shows only that team's group", () => {
    const groups: Array<TimelineGroup> = TimelineModel.groupSchedules({
      schedules: [SRE],
      teams: TEAMS,
      groupByTeam: true,
      teamFilter: "t-sre",
    });

    expect(
      groups.map((group: TimelineGroup) => {
        return group.key;
      }),
    ).toEqual(["t-sre"]);
  });

  test("the My teams filter shows only the caller's teams' groups", () => {
    const groups: Array<TimelineGroup> = TimelineModel.groupSchedules({
      schedules: [SRE],
      teams: TEAMS,
      groupByTeam: true,
      teamFilter: MY_TEAMS,
    });

    expect(
      groups.map((group: TimelineGroup) => {
        return group.key;
      }),
    ).toEqual(["t-sre"]);
  });

  test("All teams groups under every owner", () => {
    const groups: Array<TimelineGroup> = TimelineModel.groupSchedules({
      schedules: [SRE],
      teams: TEAMS,
      groupByTeam: true,
      teamFilter: ALL_TEAMS,
    });

    expect(
      groups.map((group: TimelineGroup) => {
        return group.key;
      }),
    ).toEqual(["t-pay", "t-sre"]);
  });

  test("ungrouped: one untitled group in input order", () => {
    const groups: Array<TimelineGroup> = TimelineModel.groupSchedules({
      schedules: ALL,
      teams: TEAMS,
      groupByTeam: false,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(ALL_SCHEDULES_GROUP_KEY);
    expect(groups[0]?.title).toBeNull();
    expect(
      groups[0]?.schedules.map((item: TimelineSchedule) => {
        return item.id;
      }),
    ).toEqual(["s-pay", "s-sre", "s-legacy"]);
  });

  test("no schedules, no groups", () => {
    expect(
      TimelineModel.groupSchedules({
        schedules: [],
        teams: TEAMS,
        groupByTeam: true,
      }),
    ).toEqual([]);
  });
});

describe("collectPeople", () => {
  test("load within the window, heaviest first, with colours", () => {
    const people: Array<TimelinePerson> = TimelineModel.collectPeople({
      schedules: ALL,
      window: WINDOW,
      now: NOW,
    });

    expect(
      people.map((person: TimelinePerson) => {
        return [
          person.userName,
          person.onCallMilliseconds / 3600000,
          person.scheduleCount,
          person.isOnCallNow,
        ];
      }),
    ).toEqual([
      // Alice: clipped to the 7-day window.
      ["Alice Andersson", 168, 1, true],
      ["Carol Chen", 72, 1, false],
      ["Bob Berg", 48, 1, false],
    ]);

    expect(people[0]?.color).toBe(getColorForUserId("u-alice"));
  });

  test("one person on two schedules is counted once, with both loads", () => {
    const people: Array<TimelinePerson> = TimelineModel.collectPeople({
      schedules: [
        schedule("a", "A", {
          shifts: [
            shift("u-1", "Uno", "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z"),
          ],
        }),
        schedule("b", "B", {
          shifts: [
            shift("u-1", "Uno", "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z"),
          ],
        }),
      ],
      window: WINDOW,
      now: NOW,
    });

    expect(people).toHaveLength(1);
    expect(people[0]?.scheduleCount).toBe(2);
    expect(people[0]?.onCallMilliseconds).toBe(48 * 3600000);
  });

  test("ties are broken by name", () => {
    const people: Array<TimelinePerson> = TimelineModel.collectPeople({
      schedules: [
        schedule("a", "A", {
          shifts: [
            shift("u-z", "Zed", "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z"),
            shift("u-a", "Abe", "2026-09-15T00:00:00Z", "2026-09-16T00:00:00Z"),
          ],
        }),
      ],
      window: WINDOW,
      now: NOW,
    });

    expect(
      people.map((person: TimelinePerson) => {
        return person.userName;
      }),
    ).toEqual(["Abe", "Zed"]);
  });

  test("shifts outside the window are ignored; no window, nobody", () => {
    expect(
      TimelineModel.collectPeople({
        schedules: [
          schedule("a", "A", {
            shifts: [
              shift(
                "u-1",
                "Uno",
                "2026-09-01T00:00:00Z",
                "2026-09-02T00:00:00Z",
              ),
            ],
          }),
        ],
        window: WINDOW,
        now: NOW,
      }),
    ).toEqual([]);

    expect(
      TimelineModel.collectPeople({ schedules: ALL, window: null, now: NOW }),
    ).toEqual([]);
  });
});

describe("summarize", () => {
  test("counts with now in view", () => {
    expect(
      TimelineModel.summarize({ schedules: ALL, window: WINDOW, now: NOW }),
    ).toEqual({ total: 3, coveredNow: 1, uncoveredNow: 2, withGaps: 2 });
  });

  test("with now out of view, the 'now' counts are unknown (null), not zero", () => {
    expect(
      TimelineModel.summarize({
        schedules: ALL,
        window: WINDOW,
        now: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toEqual({ total: 3, coveredNow: null, uncoveredNow: null, withGaps: 2 });
  });

  test("nothing computed yet", () => {
    expect(
      TimelineModel.summarize({ schedules: ALL, window: null, now: NOW }),
    ).toEqual({ total: 3, coveredNow: null, uncoveredNow: null, withGaps: 0 });
  });
});

describe("countPeople / hasOverrides", () => {
  test("distinct people in the window", () => {
    expect(TimelineModel.countPeople(SRE, WINDOW)).toBe(2);
    expect(TimelineModel.countPeople(LEGACY, WINDOW)).toBe(0);
    expect(TimelineModel.countPeople(SRE, null)).toBe(0);
  });

  test("overrides only count inside the window", () => {
    const withOverride: TimelineSchedule = schedule("o", "O", {
      shifts: [
        shift("u-1", "Uno", "2026-09-15T00:00:00Z", "2026-09-16T00:00:00Z", {
          override: {
            originalUserId: "u-2",
            originalUserName: "Dos",
            start: new Date("2026-09-15T00:00:00Z"),
            end: new Date("2026-09-16T00:00:00Z"),
            isPolicyScoped: false,
          },
        }),
      ],
    });

    expect(TimelineModel.hasOverrides(withOverride, WINDOW)).toBe(true);
    expect(TimelineModel.hasOverrides(SRE, WINDOW)).toBe(false);
    expect(
      TimelineModel.hasOverrides(withOverride, {
        start: new Date("2026-10-01T00:00:00Z"),
        end: new Date("2026-10-08T00:00:00Z"),
      }),
    ).toBe(false);
    expect(TimelineModel.hasOverrides(withOverride, null)).toBe(false);
  });
});
