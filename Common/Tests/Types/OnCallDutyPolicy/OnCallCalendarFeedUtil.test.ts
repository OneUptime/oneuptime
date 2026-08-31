import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import ICalendar, {
  ICalendarDocument,
  ICalendarEvent,
} from "../../../Types/Calendar/ICalendar";
import EventInterval from "../../../Types/Events/EventInterval";
import Timezone from "../../../Types/Timezone";
import {
  MAX_EVENTS,
  MAX_GAP_EVENTS,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import { MaterializedShift } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedUtil, {
  CoverageEnvelopeResult,
  CoverageGapEventsResult,
  FeedRenderResult,
  OnCallCalendarFeedKind,
  WindowShrinkResult,
} from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import ShiftSeamUtil, {
  TimeSegment,
} from "../../../Types/OnCallDutyPolicy/ShiftSeamUtil";
import UserOverrideUtil from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import {
  DASHBOARD_URL,
  DEFAULT_LAST_MODIFIED,
  DEFAULT_POLICY,
  at,
  blockProperty,
  businessHoursRestriction,
  dailyRestriction,
  eventBlocks,
  hhmm,
  logicalLines,
  materialize,
  noRestriction,
  physicalLines,
  properties,
  property,
  rotation,
  shift,
  tzInstant,
  user,
} from "./CalendarFeedTestFixtures";

const CRLF: string = "\r\n";
const UTC: string = "UTC";

const Kind: typeof OnCallCalendarFeedKind = OnCallCalendarFeedKind;

function personalContext(viewerTimezone?: string | undefined): {
  kind: OnCallCalendarFeedKind;
  dashboardUrl: string;
  viewerTimezone?: string | undefined;
} {
  return {
    kind: Kind.Personal,
    dashboardUrl: DASHBOARD_URL,
    ...(viewerTimezone !== undefined ? { viewerTimezone } : {}),
  };
}

function renderPersonal(
  shifts: Array<MaterializedShift>,
  viewerTimezone?: string | undefined,
): string {
  return OnCallCalendarFeedUtil.render({
    ...personalContext(viewerTimezone),
    shifts,
  }).body;
}

function renderSchedule(
  shifts: Array<MaterializedShift>,
  name: string,
): string {
  return OnCallCalendarFeedUtil.render({
    kind: Kind.Schedule,
    dashboardUrl: DASHBOARD_URL,
    shifts,
    scheduleName: name,
  }).body;
}

function epoch(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

// LayerUtil -> overrides -> feed grouping -> seams -> MaterializedShift[].
function materializeLayers(
  layers: Array<LayerProps>,
  windowStart: Date,
  windowEnd: Date,
  overrides?: Array<{
    overrideUserId: string;
    routeAlertsToUserId: string;
    startsAt: Date;
    endsAt: Date;
  }>,
  extra?: Partial<MaterializedShift> | undefined,
): Array<MaterializedShift> {
  let events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
    layers,
    calendarStartDate: windowStart,
    calendarEndDate: windowEnd,
  });

  if (overrides && overrides.length > 0) {
    events = UserOverrideUtil.applyOverridesToEvents({ events, overrides });
  }

  const shifts: Array<OnCallShift> = ScheduleShiftUtil.groupEventsIntoShifts(
    events,
    { groupKey: ScheduleShiftUtil.groupKeyByUserOverrideAndLayer },
  );

  return materialize(ShiftSeamUtil.normalizeSeams(shifts), extra);
}

describe("OnCallCalendarFeedUtil: byte-exact personal feed", () => {
  const stockholmShift: MaterializedShift = shift({
    start: tzInstant("2026-09-01 09:00", "Europe/Stockholm"),
    end: tzInstant("2026-09-01 17:00", "Europe/Stockholm"),
  });

  test("logical lines of a one-shift personal feed match exactly", () => {
    const body: string = renderPersonal([stockholmShift], "America/New_York");
    const uid: string = `oncall-sched-1-${epoch(stockholmShift.start)}@oneuptime`;

    const expected: Array<string> = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//OneUptime//On-Call Calendar Feed//EN",
      "CALSCALE:GREGORIAN",
      "NAME:OneUptime On-Call",
      "X-WR-CALNAME:OneUptime On-Call",
      "X-WR-CALDESC:Your on-call shifts from OneUptime. Calendar apps refresh subscribed feeds on their own schedule (Google Calendar every 12-24 h\\, Outlook on the web about every 3 h\\, Apple Calendar per its fetch setting)\\, so recent changes can lag.",
      "X-WR-TIMEZONE:America/New_York",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
      "LAST-MODIFIED:20260801T100000Z",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      "DTSTAMP:20260801T100000Z",
      "LAST-MODIFIED:20260801T100000Z",
      "SEQUENCE:3",
      "DTSTART:20260901T070000Z",
      "DTEND:20260901T150000Z",
      "SUMMARY:On-call · Payments · Payments Policy",
      "DESCRIPTION:Who: Alice Andersson\\nSchedule: Payments (Europe/Stockholm)\\nShift: Sep 01 2026\\, 09:00 CEST → Sep 01 2026\\, 17:00 CEST (Europe/Stockholm — schedule zone)\\nShift in UTC: Sep 01 2026\\, 07:00 UTC → Sep 01 2026\\, 15:00 UTC\\nShift in America/New_York (your zone): Sep 01 2026\\, 03:00 EDT → Sep 01 2026\\, 11:00 EDT\\nPages you via: Payments Policy › Primary (step 1)\\nNeed cover? https://oneuptime.example.com/dashboard/proj-1/on-call-duty/user-overrides\\nChanges appear after your calendar app next refreshes (Google Calendar: up to 24 h).",
      "URL:https://oneuptime.example.com/dashboard/proj-1/on-call-duty/schedules/sched-1",
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "CATEGORIES:On-Call",
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    expect(logicalLines(body)).toEqual(expected);
    expect(ICalendar.unfold(body)).toBe(expected.join(CRLF) + CRLF);
  });

  test("the physical body is CRLF-terminated and folded at 75 octets", () => {
    const body: string = renderPersonal([stockholmShift], "America/New_York");

    expect(body.endsWith(CRLF)).toBe(true);
    for (const line of physicalLines(body)) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    // The DESCRIPTION is long enough that folding actually happened.
    expect(physicalLines(body).length).toBeGreaterThan(
      logicalLines(body).length,
    );
  });

  test("rendering the same input twice is byte-identical", () => {
    expect(renderPersonal([stockholmShift], "America/New_York")).toBe(
      renderPersonal([stockholmShift], "America/New_York"),
    );
  });
});

describe("OnCallCalendarFeedUtil: UID identity", () => {
  const start: Date = at("2026-09-01T07:00:00Z");
  const end: Date = at("2026-09-01T15:00:00Z");

  test("UID depends only on schedule and normalised start", () => {
    const a: MaterializedShift = shift({ start, end });
    const b: MaterializedShift = shift({
      start,
      end: at("2026-09-01T20:00:00Z"),
      userId: "user-b",
      userName: "Bob",
      shiftConfigVersion: 9,
      lastModifiedAt: at("2026-08-20T00:00:00Z"),
    });

    expect(OnCallCalendarFeedUtil.getShiftUid(a)).toBe(
      `oncall-sched-1-${epoch(start)}@oneuptime`,
    );
    expect(OnCallCalendarFeedUtil.getShiftUid(b)).toBe(
      OnCallCalendarFeedUtil.getShiftUid(a),
    );
    expect(
      OnCallCalendarFeedUtil.getShiftUid(
        shift({ start, end, scheduleId: "other" }),
      ),
    ).not.toBe(OnCallCalendarFeedUtil.getShiftUid(a));
  });

  test("UID is stable across window shifts (different feed windows, notes and calendar kinds)", () => {
    const one: MaterializedShift = shift({ start, end });

    const personal: string = renderPersonal([one]);
    const withNotes: string = OnCallCalendarFeedUtil.render({
      ...personalContext(),
      shifts: [one],
      notes: ["window shrunk"],
    }).body;
    const scheduleFeed: string = renderSchedule([one], "Payments");
    const projectFeed: string = OnCallCalendarFeedUtil.render({
      kind: Kind.Project,
      dashboardUrl: DASHBOARD_URL,
      shifts: [one],
      projectName: "Acme",
    }).body;

    const expectedUid: string = `oncall-sched-1-${epoch(start)}@oneuptime`;
    for (const body of [personal, withNotes, scheduleFeed, projectFeed]) {
      expect(properties(body, "UID")).toEqual([expectedUid]);
    }
  });

  test("an override swap keeps the same UID but changes SUMMARY", () => {
    const original: MaterializedShift = shift({ start, end });
    const swapped: MaterializedShift = shift({
      start,
      end,
      userId: "user-b",
      userName: "Bob Berg",
      override: {
        originalUserId: "user-a",
        originalUserName: "Alice Andersson",
        overrideStartsAt: at("2026-09-01T00:00:00Z"),
        overrideEndsAt: at("2026-09-02T00:00:00Z"),
      },
    });

    const before: Array<Array<string>> = eventBlocks(
      renderPersonal([original]),
    );
    const after: Array<Array<string>> = eventBlocks(renderPersonal([swapped]));

    expect(blockProperty(after[0]!, "UID")).toBe(
      blockProperty(before[0]!, "UID"),
    );
    expect(blockProperty(before[0]!, "SUMMARY")).toBe(
      "On-call · Payments · Payments Policy",
    );
    expect(blockProperty(after[0]!, "SUMMARY")).toBe(
      "On-call · Payments · Payments Policy (covering for Alice Andersson)",
    );
    expect(blockProperty(after[0]!, "DESCRIPTION")).toContain(
      "Who: Bob Berg\\, covering for Alice Andersson",
    );
    expect(blockProperty(after[0]!, "DESCRIPTION")).toContain(
      "Override: Alice Andersson → Bob Berg from Sep 01 2026\\, 02:00 CEST to Sep 02 2026\\, 02:00 CEST (global override)",
    );
  });

  test("an override split yields three UIDs whose DTEND/DTSTART touch", () => {
    const windowStart: Date = at("2026-03-02T00:00:00Z");
    const windowEnd: Date = at("2026-03-03T00:00:00Z");

    const shifts: Array<MaterializedShift> = materializeLayers(
      [
        {
          users: [user("user-a")],
          startDateTimeOfLayer: windowStart,
          restrictionTimes: dailyRestriction("09:00", "17:00", UTC),
          handOffTime: at("2026-03-02T09:00:00Z"),
          rotation: rotation(EventInterval.Week, 1),
          timezone: UTC,
        },
      ],
      windowStart,
      windowEnd,
      [
        {
          overrideUserId: "user-a",
          routeAlertsToUserId: "user-b",
          startsAt: at("2026-03-02T12:00:00Z"),
          endsAt: at("2026-03-02T13:00:00Z"),
        },
      ],
      { scheduleTimezone: UTC },
    );

    expect(
      shifts.map((entry: MaterializedShift) => {
        return entry.userId;
      }),
    ).toEqual(["user-a", "user-b", "user-a"]);

    const blocks: Array<Array<string>> = eventBlocks(
      renderSchedule(shifts, "Payments"),
    );
    expect(blocks).toHaveLength(3);

    const uids: Array<string> = blocks.map((block: Array<string>) => {
      return blockProperty(block, "UID")!;
    });
    expect(new Set(uids).size).toBe(3);

    expect(blockProperty(blocks[0]!, "DTSTART")).toBe("20260302T090000Z");
    expect(blockProperty(blocks[0]!, "DTEND")).toBe("20260302T120000Z");
    expect(blockProperty(blocks[1]!, "DTSTART")).toBe("20260302T120000Z");
    expect(blockProperty(blocks[1]!, "DTEND")).toBe("20260302T130000Z");
    expect(blockProperty(blocks[2]!, "DTSTART")).toBe("20260302T130000Z");
    expect(blockProperty(blocks[2]!, "DTEND")).toBe("20260302T170000Z");

    expect(blockProperty(blocks[1]!, "SUMMARY")).toBe(
      "Name of user-b · On-call · Payments (covering for Name of user-a)",
    );
  });

  test("gap UIDs live in their own namespace", () => {
    expect(OnCallCalendarFeedUtil.getGapUid("sched-1", start)).toBe(
      `oncall-gap-sched-1-${epoch(start)}@oneuptime`,
    );
  });
});

describe("OnCallCalendarFeedUtil: SEQUENCE, DTSTAMP and forbidden properties", () => {
  const one: MaterializedShift = shift({
    start: at("2026-09-01T07:00:00Z"),
    end: at("2026-09-01T15:00:00Z"),
    shiftConfigVersion: 7,
    lastModifiedAt: at("2026-08-15T12:34:56Z"),
  });

  test("SEQUENCE is the shiftConfigVersion and DTSTAMP/LAST-MODIFIED the input's lastModifiedAt", () => {
    const block: Array<string> = eventBlocks(renderPersonal([one]))[0]!;

    expect(blockProperty(block, "SEQUENCE")).toBe("7");
    expect(blockProperty(block, "DTSTAMP")).toBe("20260815T123456Z");
    expect(blockProperty(block, "LAST-MODIFIED")).toBe("20260815T123456Z");
  });

  test("a negative or fractional version never produces an invalid SEQUENCE", () => {
    const negative: MaterializedShift = { ...one, shiftConfigVersion: -3 };
    const fractional: MaterializedShift = { ...one, shiftConfigVersion: 2.9 };

    expect(
      blockProperty(eventBlocks(renderPersonal([negative]))[0]!, "SEQUENCE"),
    ).toBe("0");
    expect(
      blockProperty(eventBlocks(renderPersonal([fractional]))[0]!, "SEQUENCE"),
    ).toBe("2");
  });

  test("the calendar LAST-MODIFIED is the latest shift modification", () => {
    const older: MaterializedShift = shift({
      start: at("2026-09-02T07:00:00Z"),
      end: at("2026-09-02T15:00:00Z"),
      lastModifiedAt: at("2026-07-01T00:00:00Z"),
    });

    const result: FeedRenderResult = OnCallCalendarFeedUtil.render({
      ...personalContext(),
      shifts: [older, one],
    });

    expect(property(result.body, "LAST-MODIFIED")).toBe("20260815T123456Z");
    expect(result.lastModifiedAt!.toISOString()).toBe(
      "2026-08-15T12:34:56.000Z",
    );
    expect(result.eventCount).toBe(2);
  });

  test("neither feed kind emits METHOD, CLASS, VALARM, RRULE or VTIMEZONE", () => {
    for (const body of [
      renderPersonal([one]),
      renderSchedule([one], "Payments"),
    ]) {
      for (const forbidden of [
        "METHOD",
        "CLASS",
        "VALARM",
        "RRULE",
        "VTIMEZONE",
        "TZID",
      ]) {
        expect(body).not.toContain(`${forbidden}:`);
        expect(body).not.toContain(`BEGIN:${forbidden}`);
      }
      expect(body).toContain("TRANSP:TRANSPARENT");
      expect(body).toContain("STATUS:CONFIRMED");
      expect(body).toContain("CATEGORIES:On-Call");
    }
  });

  test("every DTSTART/DTEND is an absolute UTC instant", () => {
    const body: string = renderPersonal([one]);
    for (const value of [
      ...properties(body, "DTSTART"),
      ...properties(body, "DTEND"),
    ]) {
      expect(value).toMatch(/^\d{8}T\d{6}Z$/);
    }
  });
});

describe("OnCallCalendarFeedUtil: calendar names and descriptions", () => {
  test("personal feed without and with a schedule filter", () => {
    expect(
      OnCallCalendarFeedUtil.buildCalendarName({ kind: Kind.Personal }),
    ).toEqual({ name: "OneUptime On-Call", displayName: "OneUptime On-Call" });

    expect(
      OnCallCalendarFeedUtil.buildCalendarName({
        kind: Kind.Personal,
        filterScheduleName: "Payments",
      }),
    ).toEqual({
      name: "OneUptime On-Call · Payments",
      displayName: "OneUptime On-Call · Payments",
    });

    const body: string = OnCallCalendarFeedUtil.render({
      ...personalContext(),
      shifts: [],
      filterScheduleName: "Payments",
    }).body;
    expect(property(body, "X-WR-CALNAME")).toBe("OneUptime On-Call · Payments");
    expect(property(body, "X-WR-CALDESC")).toContain(
      "Your on-call shifts on Payments from OneUptime.",
    );
  });

  test("schedule feed truncates X-WR-CALNAME to 28 characters but keeps NAME in full", () => {
    const longName: string = "Platform Infrastructure Primary Rotation EMEA";
    expect(Array.from(longName).length).toBeGreaterThan(28);

    const names: { name: string; displayName: string } =
      OnCallCalendarFeedUtil.buildCalendarName({
        kind: Kind.Schedule,
        scheduleName: longName,
      });

    expect(names.name).toBe(longName);
    expect(Array.from(names.displayName).length).toBeLessThanOrEqual(28);
    expect(names.displayName.endsWith("…")).toBe(true);
    expect(names.displayName).toBe("Platform Infrastructure Pri…");

    const body: string = renderSchedule([], longName);
    expect(property(body, "NAME")).toBe(longName);
    expect(property(body, "X-WR-CALNAME")).toBe("Platform Infrastructure Pri…");
    expect(property(body, "X-WR-CALDESC")).toContain(
      `Everyone's on-call shifts on ${longName} from OneUptime.`,
    );
  });

  test("a short schedule name is not truncated", () => {
    const names: { name: string; displayName: string } =
      OnCallCalendarFeedUtil.buildCalendarName({
        kind: Kind.Schedule,
        scheduleName: "Payments",
      });
    expect(names).toEqual({ name: "Payments", displayName: "Payments" });
  });

  test("project feed", () => {
    const body: string = OnCallCalendarFeedUtil.render({
      kind: Kind.Project,
      dashboardUrl: DASHBOARD_URL,
      shifts: [],
      projectName: "Acme Corp",
    }).body;

    expect(property(body, "X-WR-CALNAME")).toBe(
      "OneUptime On-Call · Acme Corp",
    );
    expect(property(body, "X-WR-CALDESC")).toContain(
      "Everyone's on-call shifts across Acme Corp from OneUptime.",
    );
  });

  test("notes are appended to X-WR-CALDESC and REFRESH hints are always present", () => {
    const body: string = OnCallCalendarFeedUtil.render({
      ...personalContext(),
      shifts: [],
      notes: [" Shortened to 30 days. ", "", "Only 100 gaps shown."],
    }).body;

    expect(property(body, "X-WR-CALDESC")).toBe(
      `Your on-call shifts from OneUptime. ${ICalendar.escapeText(
        OnCallCalendarFeedUtil.REFRESH_CAVEAT,
      )} Shortened to 30 days. Only 100 gaps shown.`,
    );
    expect(property(body, "REFRESH-INTERVAL")).toBe("PT1H");
    expect(property(body, "X-PUBLISHED-TTL")).toBe("PT1H");
  });

  test("X-WR-TIMEZONE uses the calendar timezone, then the viewer's, then UTC; invalid zones fall back", () => {
    expect(
      property(
        OnCallCalendarFeedUtil.render({
          ...personalContext("Europe/Stockholm"),
          shifts: [],
        }).body,
        "X-WR-TIMEZONE",
      ),
    ).toBe("Europe/Stockholm");

    expect(
      property(
        OnCallCalendarFeedUtil.render({
          ...personalContext("Europe/Stockholm"),
          calendarTimezone: "Asia/Kolkata",
          shifts: [],
        }).body,
        "X-WR-TIMEZONE",
      ),
    ).toBe("Asia/Kolkata");

    expect(
      property(
        OnCallCalendarFeedUtil.render({ ...personalContext(), shifts: [] })
          .body,
        "X-WR-TIMEZONE",
      ),
    ).toBe("UTC");

    expect(
      property(
        OnCallCalendarFeedUtil.render({
          ...personalContext("Mars/Olympus_Mons"),
          shifts: [],
        }).body,
        "X-WR-TIMEZONE",
      ),
    ).toBe("UTC");
  });

  test("renderEmpty produces a header-only calendar that explains itself", () => {
    const body: string = OnCallCalendarFeedUtil.renderEmpty({
      kind: Kind.Personal,
      reason: "This feed is disabled.",
    });

    expect(body).not.toContain("BEGIN:VEVENT");
    expect(property(body, "X-WR-CALNAME")).toBe("OneUptime On-Call");
    expect(property(body, "X-WR-CALDESC")).toContain("This feed is disabled.");
    expect(body).not.toContain("LAST-MODIFIED");
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("OnCallCalendarFeedUtil: SUMMARY and DESCRIPTION rules", () => {
  const start: Date = at("2026-09-01T07:00:00Z");
  const end: Date = at("2026-09-01T15:00:00Z");

  test("personal SUMMARY adds the policy only when exactly one distinct policy is attached", () => {
    const one: MaterializedShift = shift({ start, end });
    const sameTwice: MaterializedShift = shift({
      start,
      end,
      policies: [
        { ...DEFAULT_POLICY },
        {
          ...DEFAULT_POLICY,
          ruleId: "rule-2",
          ruleName: "Backup",
          ruleOrder: 2,
        },
      ],
    });
    const two: MaterializedShift = shift({
      start,
      end,
      policies: [
        { ...DEFAULT_POLICY },
        {
          policyId: "pol-2",
          policyName: "Billing Policy",
          ruleId: "rule-9",
          ruleName: "Primary",
          ruleOrder: 1,
        },
      ],
    });
    const none: MaterializedShift = shift({ start, end, policies: [] });

    expect(OnCallCalendarFeedUtil.buildSummary(one, Kind.Personal)).toBe(
      "On-call · Payments · Payments Policy",
    );
    expect(OnCallCalendarFeedUtil.buildSummary(sameTwice, Kind.Personal)).toBe(
      "On-call · Payments · Payments Policy",
    );
    expect(OnCallCalendarFeedUtil.buildSummary(two, Kind.Personal)).toBe(
      "On-call · Payments",
    );
    expect(OnCallCalendarFeedUtil.buildSummary(none, Kind.Personal)).toBe(
      "On-call · Payments",
    );
  });

  test("schedule and project SUMMARY lead with the user's name and never add the single policy", () => {
    const one: MaterializedShift = shift({ start, end });

    expect(OnCallCalendarFeedUtil.buildSummary(one, Kind.Schedule)).toBe(
      "Alice Andersson · On-call · Payments",
    );
    expect(OnCallCalendarFeedUtil.buildSummary(one, Kind.Project)).toBe(
      "Alice Andersson · On-call · Payments",
    );
  });

  test("the schedule feed never shows an email address; the personal feed may", () => {
    const emailUser: MaterializedShift = shift({
      start,
      end,
      userId: "user-e",
      userName: "eve@example.com",
      override: {
        originalUserId: "user-f",
        originalUserName: "frank@example.com",
        overrideStartsAt: start,
        overrideEndsAt: end,
      },
    });

    const scheduleBody: string = renderSchedule([emailUser], "Payments");
    expect(scheduleBody).not.toContain("eve@example.com");
    expect(scheduleBody).not.toContain("frank@example.com");
    expect(blockProperty(eventBlocks(scheduleBody)[0]!, "SUMMARY")).toBe(
      "Unnamed user · On-call · Payments (covering for Unnamed user)",
    );

    const personalBody: string = renderPersonal([emailUser]);
    expect(blockProperty(eventBlocks(personalBody)[0]!, "SUMMARY")).toBe(
      "On-call · Payments · Payments Policy (covering for frank@example.com)",
    );
    expect(
      blockProperty(eventBlocks(personalBody)[0]!, "DESCRIPTION"),
    ).toContain("Who: eve@example.com\\, covering for frank@example.com");
  });

  test("getDisplayName handles blanks, whitespace and emails per feed kind", () => {
    expect(OnCallCalendarFeedUtil.getDisplayName("", Kind.Personal)).toBe(
      "Unnamed user",
    );
    expect(OnCallCalendarFeedUtil.getDisplayName("   ", Kind.Schedule)).toBe(
      "Unnamed user",
    );
    expect(OnCallCalendarFeedUtil.getDisplayName(undefined, Kind.Project)).toBe(
      "Unnamed user",
    );
    expect(
      OnCallCalendarFeedUtil.getDisplayName("  Ada  ", Kind.Schedule),
    ).toBe("Ada");
    expect(OnCallCalendarFeedUtil.getDisplayName("a@b.io", Kind.Schedule)).toBe(
      "Unnamed user",
    );
    expect(OnCallCalendarFeedUtil.getDisplayName("a@b.io", Kind.Project)).toBe(
      "Unnamed user",
    );
    expect(OnCallCalendarFeedUtil.getDisplayName("a@b.io", Kind.Personal)).toBe(
      "a@b.io",
    );
  });

  test("DESCRIPTION lists every policy rule sorted, or says the schedule pages nobody", () => {
    const multi: MaterializedShift = shift({
      start,
      end,
      policies: [
        {
          policyId: "pol-2",
          policyName: "Billing Policy",
          ruleId: "r-b2",
          ruleName: "Backup",
          ruleOrder: 2,
        },
        { ...DEFAULT_POLICY },
        {
          policyId: "pol-2",
          policyName: "Billing Policy",
          ruleId: "r-b1",
          ruleName: "Primary",
          ruleOrder: 1,
        },
      ],
    });

    const description: string = OnCallCalendarFeedUtil.buildDescription(
      multi,
      personalContext(),
    );
    expect(description).toContain(
      "Pages you via: Billing Policy › Primary (step 1); Billing Policy › Backup (step 2); Payments Policy › Primary (step 1)",
    );

    const scheduleDescription: string = OnCallCalendarFeedUtil.buildDescription(
      multi,
      {
        kind: Kind.Schedule,
        dashboardUrl: DASHBOARD_URL,
      },
    );
    expect(scheduleDescription).toContain(
      "Pages via: Billing Policy › Primary (step 1)",
    );

    const orphan: MaterializedShift = shift({ start, end, policies: [] });
    expect(
      OnCallCalendarFeedUtil.buildDescription(orphan, personalContext()),
    ).toContain(OnCallCalendarFeedUtil.NO_POLICY_LINE);
  });

  test("Layer line appears only when the shift carries a layer name", () => {
    const withLayer: MaterializedShift = shift({
      start,
      end,
      layerId: "layer-1",
      layerName: "Weekday primary",
    });
    const withoutLayer: MaterializedShift = shift({ start, end });

    expect(
      OnCallCalendarFeedUtil.buildDescription(withLayer, personalContext()),
    ).toContain("\nLayer: Weekday primary\n");
    expect(
      OnCallCalendarFeedUtil.buildDescription(withoutLayer, personalContext()),
    ).not.toContain("Layer:");
  });

  test("the past-shift line and Time Log link appear only for past shifts", () => {
    const past: MaterializedShift = shift({ start, end, isPast: true });
    const future: MaterializedShift = shift({ start, end, isPast: false });

    const pastDescription: string = OnCallCalendarFeedUtil.buildDescription(
      past,
      personalContext(),
    );
    expect(pastDescription).toContain(OnCallCalendarFeedUtil.PAST_SHIFT_LINE);
    expect(pastDescription).toContain(
      "https://oneuptime.example.com/dashboard/proj-1/on-call-duty/user-time-logs",
    );

    expect(
      OnCallCalendarFeedUtil.buildDescription(future, personalContext()),
    ).not.toContain("Past shifts");
  });

  test("a policy-scoped override names its policy; an unknown policy id degrades gracefully", () => {
    const scoped: MaterializedShift = shift({
      start,
      end,
      userId: "user-b",
      userName: "Bob",
      override: {
        originalUserId: "user-a",
        originalUserName: "Alice",
        overrideStartsAt: start,
        overrideEndsAt: end,
        onCallDutyPolicyId: "pol-1",
      },
    });

    expect(
      OnCallCalendarFeedUtil.buildDescription(scoped, personalContext()),
    ).toContain("(scoped to Payments Policy)");

    const unknown: MaterializedShift = {
      ...scoped,
      override: { ...scoped.override!, onCallDutyPolicyId: "pol-missing" },
    };
    expect(
      OnCallCalendarFeedUtil.buildDescription(unknown, personalContext()),
    ).toContain("(scoped to an escalation policy)");
  });

  test("URL points at the schedule page and a trailing slash on the dashboard URL is tolerated", () => {
    const one: MaterializedShift = shift({ start, end });
    const event: ICalendarEvent = OnCallCalendarFeedUtil.shiftToEvent(one, {
      kind: Kind.Personal,
      dashboardUrl: `${DASHBOARD_URL}/`,
    });

    expect(event.url).toBe(
      "https://oneuptime.example.com/dashboard/proj-1/on-call-duty/schedules/sched-1",
    );
    expect(event.description).toContain(
      "Need cover? https://oneuptime.example.com/dashboard/proj-1/on-call-duty/user-overrides",
    );
  });

  test("the viewer zone line is skipped when it equals the schedule zone or UTC", () => {
    const stockholm: MaterializedShift = shift({ start, end });

    const sameZone: string = OnCallCalendarFeedUtil.buildDescription(
      stockholm,
      personalContext("Europe/Stockholm"),
    );
    expect(sameZone).not.toContain("(your zone)");
    expect(sameZone).toContain("Shift in UTC:");

    const utcViewer: string = OnCallCalendarFeedUtil.buildDescription(
      stockholm,
      personalContext("UTC"),
    );
    // The viewer's zone IS UTC, so the one UTC line is labelled as theirs.
    expect(utcViewer).toContain("Shift in UTC (your zone):");
    expect(utcViewer.match(/Shift in /g)).toHaveLength(1);

    const utcSchedule: MaterializedShift = shift({
      start,
      end,
      scheduleTimezone: "UTC",
    });
    const utcScheduleDescription: string =
      OnCallCalendarFeedUtil.buildDescription(
        utcSchedule,
        personalContext("America/New_York"),
      );
    expect(utcScheduleDescription).toContain("(UTC — schedule zone)");
    expect(utcScheduleDescription).not.toContain("Shift in UTC:");
    expect(utcScheduleDescription).toContain(
      "Shift in America/New_York (your zone):",
    );
  });
});

describe("OnCallCalendarFeedUtil: legacy schedules without a timezone", () => {
  test("render in UTC with the explanatory note", () => {
    const legacy: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      scheduleTimezone: undefined,
    });

    expect(OnCallCalendarFeedUtil.getScheduleZone(legacy)).toBe(Timezone.UTC);

    const description: string = OnCallCalendarFeedUtil.buildDescription(
      legacy,
      personalContext("America/New_York"),
    );

    expect(description).toContain(
      `Schedule: Payments (${OnCallCalendarFeedUtil.LEGACY_TIMEZONE_NOTE})`,
    );
    expect(description).toContain(
      `Shift: Sep 01 2026, 07:00 UTC → Sep 01 2026, 15:00 UTC (UTC — ${OnCallCalendarFeedUtil.LEGACY_TIMEZONE_NOTE})`,
    );
    expect(description).toContain(
      "Shift in America/New_York (your zone): Sep 01 2026, 03:00 EDT → Sep 01 2026, 11:00 EDT",
    );
  });

  test("an unrecognised schedule timezone is treated the same way", () => {
    const bogus: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      scheduleTimezone: "Not/AZone",
    });

    expect(OnCallCalendarFeedUtil.getScheduleZone(bogus)).toBe("UTC");
    expect(
      OnCallCalendarFeedUtil.buildDescription(bogus, personalContext()),
    ).toContain(OnCallCalendarFeedUtil.LEGACY_TIMEZONE_NOTE);
  });
});

describe("OnCallCalendarFeedUtil: DST", () => {
  interface DstCase {
    zone: string;
    day: string;
    abbreviation: string;
    utcStart: string;
  }

  const cases: Array<DstCase> = [
    // America/New_York springs forward 2026-03-08 02:00 -> 09:00 is EDT (UTC-4).
    {
      zone: "America/New_York",
      day: "2026-03-08",
      abbreviation: "EDT",
      utcStart: "20260308T130000Z",
    },
    // Day before: still EST (UTC-5).
    {
      zone: "America/New_York",
      day: "2026-03-07",
      abbreviation: "EST",
      utcStart: "20260307T140000Z",
    },
    // Falls back 2026-11-01 02:00 -> 09:00 is EST again.
    {
      zone: "America/New_York",
      day: "2026-11-01",
      abbreviation: "EST",
      utcStart: "20261101T140000Z",
    },
    {
      zone: "America/New_York",
      day: "2026-10-31",
      abbreviation: "EDT",
      utcStart: "20261031T130000Z",
    },
    // Europe/Stockholm springs forward 2026-03-29 02:00 -> 09:00 is CEST (UTC+2).
    {
      zone: "Europe/Stockholm",
      day: "2026-03-29",
      abbreviation: "CEST",
      utcStart: "20260329T070000Z",
    },
    {
      zone: "Europe/Stockholm",
      day: "2026-03-28",
      abbreviation: "CET",
      utcStart: "20260328T080000Z",
    },
    // Falls back 2026-10-25 03:00 -> 09:00 is CET (UTC+1).
    {
      zone: "Europe/Stockholm",
      day: "2026-10-25",
      abbreviation: "CET",
      utcStart: "20261025T080000Z",
    },
    {
      zone: "Europe/Stockholm",
      day: "2026-10-24",
      abbreviation: "CEST",
      utcStart: "20261024T070000Z",
    },
  ];

  test.each(cases)(
    "a 09:00-17:00 shift on $day in $zone renders the right UTC instant and wall clock",
    (dstCase: DstCase) => {
      const oneShift: MaterializedShift = shift({
        start: tzInstant(`${dstCase.day} 09:00`, dstCase.zone),
        end: tzInstant(`${dstCase.day} 17:00`, dstCase.zone),
        scheduleTimezone: dstCase.zone,
      });

      const block: Array<string> = eventBlocks(renderPersonal([oneShift]))[0]!;

      expect(blockProperty(block, "DTSTART")).toBe(dstCase.utcStart);
      expect(hhmm(oneShift.start, dstCase.zone)).toBe("09:00");
      expect(hhmm(oneShift.end, dstCase.zone)).toBe("17:00");

      const description: string = blockProperty(block, "DESCRIPTION")!;
      const [month, dayOfMonth]: Array<string> = [
        [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ][Number(dstCase.day.slice(5, 7)) - 1]!,
        dstCase.day.slice(8, 10),
      ];
      expect(description).toContain(
        `Shift: ${month} ${dayOfMonth} 2026\\, 09:00 ${dstCase.abbreviation} → ${month} ${dayOfMonth} 2026\\, 17:00 ${dstCase.abbreviation} (${dstCase.zone} — schedule zone)`,
      );
    },
  );

  test("a shift straddling the New York spring-forward gap is 23 hours long and still renders both walls", () => {
    const zone: string = "America/New_York";
    const oneShift: MaterializedShift = shift({
      start: tzInstant("2026-03-07 09:00", zone),
      end: tzInstant("2026-03-08 09:00", zone),
      scheduleTimezone: zone,
    });

    expect((oneShift.end.getTime() - oneShift.start.getTime()) / 3600000).toBe(
      23,
    );

    const block: Array<string> = eventBlocks(renderPersonal([oneShift]))[0]!;
    expect(blockProperty(block, "DTSTART")).toBe("20260307T140000Z");
    expect(blockProperty(block, "DTEND")).toBe("20260308T130000Z");
    expect(blockProperty(block, "DESCRIPTION")).toContain(
      "Shift: Mar 07 2026\\, 09:00 EST → Mar 08 2026\\, 09:00 EDT (America/New_York — schedule zone)",
    );
  });

  test("engine-derived Stockholm office hours across the March change keep 09:00-17:00 walls and UTC DTSTARTs move", () => {
    const zone: string = "Europe/Stockholm";
    const windowStart: Date = tzInstant("2026-03-27 00:00", zone); // Friday
    const windowEnd: Date = tzInstant("2026-04-01 00:00", zone);

    const shifts: Array<MaterializedShift> = materializeLayers(
      [
        {
          users: [user("user-a")],
          startDateTimeOfLayer: windowStart,
          restrictionTimes: businessHoursRestriction(zone),
          handOffTime: tzInstant("2026-03-27 09:00", zone),
          rotation: rotation(EventInterval.Week, 1),
          timezone: zone,
        },
      ],
      windowStart,
      windowEnd,
      undefined,
      { scheduleTimezone: zone },
    );

    // Fri 27, Mon 30, Tue 31.
    expect(shifts).toHaveLength(3);
    for (const entry of shifts) {
      expect(hhmm(entry.start, zone)).toBe("09:00");
      expect(hhmm(entry.end, zone)).toBe("17:00");
    }

    const blocks: Array<Array<string>> = eventBlocks(renderPersonal(shifts));
    expect(blockProperty(blocks[0]!, "DTSTART")).toBe("20260327T080000Z"); // CET
    expect(blockProperty(blocks[1]!, "DTSTART")).toBe("20260330T070000Z"); // CEST
    expect(blockProperty(blocks[2]!, "DTSTART")).toBe("20260331T070000Z");
  });
});

describe("OnCallCalendarFeedUtil: policy variants", () => {
  const start: Date = at("2026-09-01T07:00:00Z");
  const end: Date = at("2026-09-01T15:00:00Z");

  const global: MaterializedShift = shift({ start, end });

  const variant: MaterializedShift = shift({
    start,
    end,
    userId: "user-b",
    userName: "Bob Berg",
    policyVariantOf: {
      policyId: "pol-1",
      policyName: "Payments Policy",
      globalUserId: "user-a",
    },
    override: {
      originalUserId: "user-a",
      originalUserName: "Alice Andersson",
      overrideStartsAt: at("2026-09-01T00:00:00Z"),
      overrideEndsAt: at("2026-09-02T00:00:00Z"),
      onCallDutyPolicyId: "pol-1",
    },
  });

  test("a variant gets a policy-suffixed UID and its own SUMMARY", () => {
    expect(OnCallCalendarFeedUtil.getShiftUid(variant)).toBe(
      `oncall-sched-1-${epoch(start)}-pol-1@oneuptime`,
    );
    expect(OnCallCalendarFeedUtil.buildSummary(variant, Kind.Personal)).toBe(
      "On-call · Payments · Payments Policy (covering for Alice Andersson)",
    );
    expect(OnCallCalendarFeedUtil.buildSummary(variant, Kind.Schedule)).toBe(
      "Bob Berg · On-call · Payments · Payments Policy (covering for Alice Andersson)",
    );
  });

  test("the variant explains itself and the global event carries the mirror line", () => {
    const blocks: Array<Array<string>> = eventBlocks(
      renderSchedule([variant, global], "Payments"),
    );

    expect(blocks).toHaveLength(2);
    const globalBlock: Array<string> = blocks.find((block: Array<string>) => {
      return !blockProperty(block, "UID")!.includes("-pol-1@");
    })!;
    const variantBlock: Array<string> = blocks.find((block: Array<string>) => {
      return blockProperty(block, "UID")!.includes("-pol-1@");
    })!;

    expect(blockProperty(variantBlock, "DESCRIPTION")).toContain(
      "For Payments Policy\\, Bob Berg is paged instead of Alice Andersson because of a policy-specific override.",
    );
    expect(blockProperty(globalBlock, "DESCRIPTION")).toContain(
      "For Payments Policy\\, Bob Berg is paged instead from Sep 01 2026\\, 09:00 CEST to Sep 01 2026\\, 17:00 CEST.",
    );
  });

  test("the personal feed phrases the variant for the subscriber", () => {
    const description: string = OnCallCalendarFeedUtil.buildDescription(
      variant,
      personalContext(),
    );
    expect(description).toContain(
      "For Payments Policy you are paged instead of Alice Andersson because of a policy-specific override.",
    );
  });

  test("mirror lines only come from variants that overlap the same schedule and user", () => {
    const unrelated: MaterializedShift = {
      ...variant,
      scheduleId: "sched-2",
      shiftKey: "sched-2:x",
    };
    const nonOverlapping: MaterializedShift = {
      ...variant,
      start: at("2026-09-01T15:00:00Z"),
      end: at("2026-09-01T18:00:00Z"),
    };
    const otherGlobalUser: MaterializedShift = {
      ...variant,
      policyVariantOf: {
        ...variant.policyVariantOf!,
        globalUserId: "someone-else",
      },
    };

    const description: string = OnCallCalendarFeedUtil.buildDescription(
      global,
      { kind: Kind.Schedule, dashboardUrl: DASHBOARD_URL },
      [global, unrelated, nonOverlapping, otherGlobalUser],
    );

    expect(description).not.toContain("is paged instead from");
  });
});

describe("OnCallCalendarFeedUtil: window filtering and MAX_EVENTS shrink", () => {
  const feedStart: Date = at("2026-09-01T00:00:00Z");
  const feedEnd: Date = at("2026-09-11T00:00:00Z");

  // Two 4-hour shifts per day for ten days = 20 shifts.
  function twentyShifts(): Array<MaterializedShift> {
    const shifts: Array<MaterializedShift> = [];
    for (let day: number = 0; day < 10; day++) {
      for (const hour of [8, 16]) {
        const start: Date = new Date(
          feedStart.getTime() + day * 86400000 + hour * 3600000,
        );
        shifts.push(
          shift({
            start,
            end: new Date(start.getTime() + 4 * 3600000),
            scheduleTimezone: UTC,
          }),
        );
      }
    }
    return shifts;
  }

  test("filterShiftsToWindow keeps overlapping shifts unclipped", () => {
    const straddlesStart: MaterializedShift = shift({
      start: at("2026-08-31T20:00:00Z"),
      end: at("2026-09-01T04:00:00Z"),
    });
    const before: MaterializedShift = shift({
      start: at("2026-08-30T00:00:00Z"),
      end: at("2026-08-31T00:00:00Z"),
    });
    const touchesEnd: MaterializedShift = shift({
      start: at("2026-09-10T20:00:00Z"),
      end: at("2026-09-11T04:00:00Z"),
    });
    const startsAtEnd: MaterializedShift = shift({
      start: at("2026-09-11T00:00:00Z"),
      end: at("2026-09-11T08:00:00Z"),
    });
    const endsAtStart: MaterializedShift = shift({
      start: at("2026-08-31T16:00:00Z"),
      end: at("2026-09-01T00:00:00Z"),
    });

    const kept: Array<MaterializedShift> =
      OnCallCalendarFeedUtil.filterShiftsToWindow(
        [startsAtEnd, touchesEnd, before, straddlesStart, endsAtStart],
        feedStart,
        feedEnd,
      );

    expect(kept).toEqual([straddlesStart, touchesEnd]);
    expect(kept[0]!.start.toISOString()).toBe("2026-08-31T20:00:00.000Z");
  });

  test("a feed under the cap is untouched", () => {
    const result: WindowShrinkResult = OnCallCalendarFeedUtil.shrinkWindowToFit(
      {
        shifts: twentyShifts(),
        feedStart,
        feedEnd,
        maxEvents: 20,
      },
    );

    expect(result.truncated).toBe(false);
    expect(result.shifts).toHaveLength(20);
    expect(result.feedEnd.getTime()).toBe(feedEnd.getTime());
    expect(result.daysDropped).toBe(0);
  });

  test("shrinks whole UTC days off the end until the feed fits", () => {
    const result: WindowShrinkResult = OnCallCalendarFeedUtil.shrinkWindowToFit(
      {
        shifts: twentyShifts(),
        feedStart,
        feedEnd,
        maxEvents: 7,
      },
    );

    // 7 events would end mid-day-4; cut at the start of day 4 => 3 days, 6 events.
    expect(result.truncated).toBe(true);
    expect(result.feedEnd.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(result.shifts).toHaveLength(6);
    expect(result.daysDropped).toBe(7);
    expect(
      result.shifts.every((entry: MaterializedShift) => {
        return entry.start.getTime() < result.feedEnd.getTime();
      }),
    ).toBe(true);
  });

  test("falls back to a hard cut when even the first day exceeds the cap", () => {
    const sameDay: Array<MaterializedShift> = [];
    for (let i: number = 0; i < 10; i++) {
      const start: Date = new Date(feedStart.getTime() + i * 3600000);
      sameDay.push(shift({ start, end: new Date(start.getTime() + 1800000) }));
    }

    const result: WindowShrinkResult = OnCallCalendarFeedUtil.shrinkWindowToFit(
      {
        shifts: sameDay,
        feedStart,
        feedEnd,
        maxEvents: 4,
      },
    );

    expect(result.truncated).toBe(true);
    expect(result.shifts).toHaveLength(4);
    expect(result.feedEnd.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(result.daysDropped).toBe(10);
  });

  test("defaults to MAX_EVENTS", () => {
    const result: WindowShrinkResult = OnCallCalendarFeedUtil.shrinkWindowToFit(
      {
        shifts: twentyShifts(),
        feedStart,
        feedEnd,
      },
    );
    expect(result.truncated).toBe(false);
    expect(MAX_EVENTS).toBeGreaterThan(20);
  });

  test("a rendered feed sorts shifts and gap events together by start then UID", () => {
    const later: MaterializedShift = shift({
      start: at("2026-09-02T07:00:00Z"),
      end: at("2026-09-02T15:00:00Z"),
    });
    const earlier: MaterializedShift = shift({
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
    });
    const gap: ICalendarEvent = OnCallCalendarFeedUtil.gapToEvent(
      { start: at("2026-09-01T15:00:00Z"), end: at("2026-09-02T07:00:00Z") },
      {
        scheduleId: "sched-1",
        scheduleName: "Payments",
        projectId: "proj-1",
        lastModifiedAt: DEFAULT_LAST_MODIFIED,
        shiftConfigVersion: 3,
        dashboardUrl: DASHBOARD_URL,
      },
    );

    const document: ICalendarDocument = OnCallCalendarFeedUtil.buildDocument({
      kind: Kind.Schedule,
      dashboardUrl: DASHBOARD_URL,
      shifts: [later, earlier],
      scheduleName: "Payments",
      gapEvents: [gap],
    });

    expect(
      document.events.map((event: ICalendarEvent) => {
        return event.start.toISOString();
      }),
    ).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-01T15:00:00.000Z",
      "2026-09-02T07:00:00.000Z",
    ]);
    expect(document.events[1]!.summary).toBe("No coverage · Payments");
  });
});

describe("OnCallCalendarFeedUtil: coverage envelope and gap events", () => {
  const feedStart: Date = at("2026-01-05T00:00:00Z"); // Monday
  const feedEnd: Date = at("2026-01-19T00:00:00Z"); // two weeks

  const gapInput: {
    scheduleId: string;
    scheduleName: string;
    projectId: string;
    lastModifiedAt: Date;
    shiftConfigVersion: number;
    dashboardUrl: string;
  } = {
    scheduleId: "sched-1",
    scheduleName: "Payments",
    projectId: "proj-1",
    lastModifiedAt: DEFAULT_LAST_MODIFIED,
    shiftConfigVersion: 3,
    dashboardUrl: DASHBOARD_URL,
  };

  function businessHoursLayer(users: Array<string>): LayerProps {
    return {
      users: users.map(user),
      startDateTimeOfLayer: feedStart,
      restrictionTimes: businessHoursRestriction(UTC),
      handOffTime: at("2026-01-05T09:00:00Z"),
      rotation: rotation(EventInterval.Week, 1),
      timezone: UTC,
    };
  }

  function alwaysOnLayer(users: Array<string>, startsAt: Date): LayerProps {
    return {
      users: users.map(user),
      startDateTimeOfLayer: startsAt,
      restrictionTimes: noRestriction(),
      handOffTime: at("2026-01-05T09:00:00Z"),
      rotation: rotation(EventInterval.Week, 1),
      timezone: UTC,
    };
  }

  test("the envelope of a business-hours layer is its Mon-Fri 09:00-17:00 windows", () => {
    const envelope: CoverageEnvelopeResult =
      OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: [businessHoursLayer(["a"])],
        windowStart: feedStart,
        windowEnd: feedEnd,
      });

    expect(envelope.truncated).toBe(false);
    expect(envelope.segments).toHaveLength(10);
    for (const segment of envelope.segments) {
      expect(hhmm(segment.start, UTC)).toBe("09:00");
      expect(hhmm(segment.end, UTC)).toBe("17:00");
    }
  });

  test("the envelope of an unrestricted layer is the whole window, even when the layer starts later or has nobody", () => {
    const envelope: CoverageEnvelopeResult =
      OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: [alwaysOnLayer([], at("2026-01-08T00:00:00Z"))],
        windowStart: feedStart,
        windowEnd: feedEnd,
      });

    expect(envelope.segments).toHaveLength(1);
    expect(envelope.segments[0]!.start.getTime()).toBe(feedStart.getTime());
    expect(envelope.segments[0]!.end.getTime()).toBe(feedEnd.getTime());
  });

  test("layers are unioned into one envelope", () => {
    const envelope: CoverageEnvelopeResult =
      OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: [businessHoursLayer(["a"]), alwaysOnLayer(["b"], feedStart)],
        windowStart: feedStart,
        windowEnd: feedEnd,
      });

    expect(envelope.segments).toHaveLength(1);
  });

  test("a business-hours schedule emits ZERO gap events for its off-hours", () => {
    const shifts: Array<MaterializedShift> = materializeLayers(
      [businessHoursLayer(["a", "b"])],
      feedStart,
      feedEnd,
      undefined,
      { scheduleTimezone: UTC },
    );
    expect(shifts).toHaveLength(10);

    const envelope: CoverageEnvelopeResult =
      OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: [businessHoursLayer(["a", "b"])],
        windowStart: feedStart,
        windowEnd: feedEnd,
      });

    const gaps: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts,
        feedStart,
        feedEnd,
        envelope: envelope.segments,
        minimumGapSeconds: 60 * 60,
      });

    expect(gaps.events).toEqual([]);
    expect(gaps.gaps).toEqual([]);
    expect(gaps.truncated).toBe(false);
  });

  test("a 24x7 schedule whose layer starts in the future emits exactly one gap event", () => {
    const startsAt: Date = at("2026-01-08T00:00:00Z");

    const shifts: Array<MaterializedShift> = materializeLayers(
      [alwaysOnLayer(["a", "b"], startsAt)],
      feedStart,
      feedEnd,
      undefined,
      { scheduleTimezone: UTC },
    );
    expect(shifts[0]!.start.getTime()).toBe(startsAt.getTime());

    const envelope: CoverageEnvelopeResult =
      OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: [alwaysOnLayer(["a", "b"], startsAt)],
        windowStart: feedStart,
        windowEnd: feedEnd,
      });

    const gaps: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts,
        feedStart,
        feedEnd,
        envelope: envelope.segments,
        minimumGapSeconds: 60 * 60,
      });

    expect(gaps.events).toHaveLength(1);
    expect(gaps.gaps[0]!.start.getTime()).toBe(feedStart.getTime());
    expect(gaps.gaps[0]!.end.getTime()).toBe(startsAt.getTime());

    const event: ICalendarEvent = gaps.events[0]!;
    expect(event.uid).toBe(`oncall-gap-sched-1-${epoch(feedStart)}@oneuptime`);
    expect(event.summary).toBe("No coverage · Payments");
    expect(event.sequence).toBe(3);
    expect(event.dtStamp.getTime()).toBe(DEFAULT_LAST_MODIFIED.getTime());
    expect(event.description).toContain(
      "Fix the rotation: https://oneuptime.example.com/dashboard/proj-1/on-call-duty/schedules/sched-1",
    );
    expect(event.categories).toEqual(["On-Call"]);
  });

  test("a single shift in a 24x7 window emits TWO gap events: before it and after it", () => {
    const envelope: Array<TimeSegment> = [{ start: feedStart, end: feedEnd }];
    const shiftStart: Date = at("2026-01-08T09:00:00Z");
    const shiftEnd: Date = at("2026-01-09T09:00:00Z");

    const gaps: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts: [{ start: shiftStart, end: shiftEnd }],
        feedStart,
        feedEnd,
        envelope,
        minimumGapSeconds: 60 * 60,
      });

    expect(
      gaps.gaps.map((gap: TimeSegment) => {
        return `${gap.start.toISOString()}/${gap.end.toISOString()}`;
      }),
    ).toEqual([
      "2026-01-05T00:00:00.000Z/2026-01-08T09:00:00.000Z",
      "2026-01-09T09:00:00.000Z/2026-01-19T00:00:00.000Z",
    ]);
    expect(gaps.events).toHaveLength(2);
    expect(gaps.events[0]!.uid).toBe(
      `oncall-gap-sched-1-${epoch(feedStart)}@oneuptime`,
    );
    expect(gaps.events[1]!.uid).toBe(
      `oncall-gap-sched-1-${epoch(shiftEnd)}@oneuptime`,
    );
    expect(gaps.events[1]!.start.getTime()).toBe(shiftEnd.getTime());
    expect(gaps.events[1]!.end.getTime()).toBe(feedEnd.getTime());
    expect(gaps.truncated).toBe(false);
  });

  test("a rotation that stops mid-window reports its tail only where a layer intended coverage", () => {
    // Business hours Mon-Fri 09:00-17:00 for two weeks; the rotation ends Wed 14 Jan 17:00.
    const envelope: CoverageEnvelopeResult =
      OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: [businessHoursLayer(["a"])],
        windowStart: feedStart,
        windowEnd: feedEnd,
      });

    const gaps: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts: [{ start: feedStart, end: at("2026-01-14T17:00:00Z") }],
        feedStart,
        feedEnd,
        envelope: envelope.segments,
        minimumGapSeconds: 60 * 60,
      });

    // Thu 15 and Fri 16 are uncovered business days; the weekend is off-hours, not a gap.
    expect(
      gaps.gaps.map((gap: TimeSegment) => {
        return `${gap.start.toISOString()}/${gap.end.toISOString()}`;
      }),
    ).toEqual([
      "2026-01-15T09:00:00.000Z/2026-01-15T17:00:00.000Z",
      "2026-01-16T09:00:00.000Z/2026-01-16T17:00:00.000Z",
    ]);
    expect(gaps.events).toHaveLength(2);
  });

  test("a trailing hole no longer than the engine's seam tolerance is not a gap", () => {
    const envelope: Array<TimeSegment> = [{ start: feedStart, end: feedEnd }];

    const withinTolerance: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts: [
          { start: feedStart, end: new Date(feedEnd.getTime() - 5 * 1000) },
        ],
        feedStart,
        feedEnd,
        envelope,
      });
    expect(withinTolerance.gaps).toEqual([]);

    const beyondTolerance: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts: [
          { start: feedStart, end: new Date(feedEnd.getTime() - 6 * 1000) },
        ],
        feedStart,
        feedEnd,
        envelope,
      });
    expect(beyondTolerance.gaps).toHaveLength(1);
    expect(beyondTolerance.gaps[0]!.end.getTime()).toBe(feedEnd.getTime());

    // ...and minimumGapSeconds still filters it like any other hole.
    const filtered: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts: [
          { start: feedStart, end: new Date(feedEnd.getTime() - 6 * 1000) },
        ],
        feedStart,
        feedEnd,
        envelope,
        minimumGapSeconds: 60,
      });
    expect(filtered.gaps).toEqual([]);
  });

  test("a business-hours layer with nobody assigned emits one gap per intended window", () => {
    const envelope: CoverageEnvelopeResult =
      OnCallCalendarFeedUtil.computeCoverageEnvelope({
        layers: [businessHoursLayer([])],
        windowStart: feedStart,
        windowEnd: feedEnd,
      });

    const gaps: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts: [],
        feedStart,
        feedEnd,
        envelope: envelope.segments,
      });

    expect(gaps.events).toHaveLength(10);
    for (const gap of gaps.gaps) {
      expect(hhmm(gap.start, UTC)).toBe("09:00");
      expect(hhmm(gap.end, UTC)).toBe("17:00");
    }
    // Oldest first.
    expect(gaps.gaps[0]!.start.getTime()).toBe(
      at("2026-01-05T09:00:00Z").getTime(),
    );
  });

  test("a hole inside the envelope is clipped to it and honours minimumGapSeconds", () => {
    const envelope: Array<TimeSegment> = [
      { start: at("2026-01-06T09:00:00Z"), end: at("2026-01-06T17:00:00Z") },
      { start: at("2026-01-07T09:00:00Z"), end: at("2026-01-07T17:00:00Z") },
    ];

    // Covered until Tue 12:00, then nothing until Wed 16:30 -> Tue 12-17 and Wed 09-16:30.
    const shifts: Array<TimeSegment> = [
      { start: at("2026-01-05T00:00:00Z"), end: at("2026-01-06T12:00:00Z") },
      { start: at("2026-01-07T16:30:00Z"), end: at("2026-01-19T00:00:00Z") },
    ];

    const all: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts,
        feedStart,
        feedEnd,
        envelope,
      });
    expect(
      all.gaps.map((gap: TimeSegment) => {
        return `${gap.start.toISOString()}/${gap.end.toISOString()}`;
      }),
    ).toEqual([
      "2026-01-06T12:00:00.000Z/2026-01-06T17:00:00.000Z",
      "2026-01-07T09:00:00.000Z/2026-01-07T16:30:00.000Z",
    ]);

    const sixHours: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts,
        feedStart,
        feedEnd,
        envelope,
        minimumGapSeconds: 6 * 3600,
      });
    expect(sixHours.gaps).toHaveLength(1);
    expect(sixHours.gaps[0]!.start.toISOString()).toBe(
      "2026-01-07T09:00:00.000Z",
    );
  });

  test("adjacent gap pieces merge and the result is capped oldest-first with a truncated flag", () => {
    const envelope: Array<TimeSegment> = [{ start: feedStart, end: feedEnd }];

    // Nobody on call except one hour a day at 12:00.
    const shifts: Array<TimeSegment> = [];
    for (let day: number = 0; day < 14; day++) {
      const start: Date = new Date(
        feedStart.getTime() + day * 86400000 + 12 * 3600000,
      );
      shifts.push({ start, end: new Date(start.getTime() + 3600000) });
    }

    const capped: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts,
        feedStart,
        feedEnd,
        envelope,
        maxGapEvents: 3,
      });

    expect(capped.truncated).toBe(true);
    expect(capped.events).toHaveLength(3);
    expect(capped.gaps[0]!.start.getTime()).toBe(feedStart.getTime());
    expect(capped.gaps[1]!.start.toISOString()).toBe(
      "2026-01-05T13:00:00.000Z",
    );
    expect(capped.gaps[2]!.start.toISOString()).toBe(
      "2026-01-06T13:00:00.000Z",
    );

    const uncapped: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts,
        feedStart,
        feedEnd,
        envelope,
      });
    // Leading gap + 13 between-day gaps + the trailing gap after the last hour.
    expect(uncapped.gaps).toHaveLength(15);
    expect(uncapped.gaps[14]!.start.toISOString()).toBe(
      "2026-01-18T13:00:00.000Z",
    );
    expect(uncapped.gaps[14]!.end.getTime()).toBe(feedEnd.getTime());
    expect(uncapped.truncated).toBe(false);
    expect(MAX_GAP_EVENTS).toBeGreaterThan(15);
  });

  test("an envelope segment outside the window contributes nothing", () => {
    const gaps: CoverageGapEventsResult =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        ...gapInput,
        shifts: [],
        feedStart,
        feedEnd,
        envelope: [
          {
            start: at("2025-12-01T00:00:00Z"),
            end: at("2025-12-02T00:00:00Z"),
          },
          {
            start: at("2026-01-06T00:00:00Z"),
            end: at("2026-01-06T06:00:00Z"),
          },
        ],
      });

    expect(gaps.gaps).toHaveLength(1);
    expect(gaps.gaps[0]!.start.toISOString()).toBe("2026-01-06T00:00:00.000Z");
  });

  test("mergeSegments drops empty segments, merges overlaps and touching-within-tolerance, and sorts", () => {
    const merged: Array<TimeSegment> = OnCallCalendarFeedUtil.mergeSegments(
      [
        { start: at("2026-01-06T10:00:00Z"), end: at("2026-01-06T12:00:00Z") },
        { start: at("2026-01-06T09:00:00Z"), end: at("2026-01-06T09:00:00Z") },
        { start: at("2026-01-06T12:00:01Z"), end: at("2026-01-06T13:00:00Z") },
        { start: at("2026-01-06T08:00:00Z"), end: at("2026-01-06T11:00:00Z") },
        { start: at("2026-01-06T15:00:00Z"), end: at("2026-01-06T16:00:00Z") },
      ],
      1000,
    );

    expect(
      merged.map((segment: TimeSegment) => {
        return `${segment.start.toISOString()}/${segment.end.toISOString()}`;
      }),
    ).toEqual([
      "2026-01-06T08:00:00.000Z/2026-01-06T13:00:00.000Z",
      "2026-01-06T15:00:00.000Z/2026-01-06T16:00:00.000Z",
    ]);
  });
});
