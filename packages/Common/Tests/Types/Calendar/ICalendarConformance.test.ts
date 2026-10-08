import ICalendar, {
  ICalendarDocument,
  ICalendarEvent,
  ICalendarEventStatus,
  ICalendarTransparency,
} from "../../../Types/Calendar/ICalendar";
import {
  MaterializedShift,
  MaterializedShiftPolicy,
} from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedUtil, {
  FeedRenderResult,
  OnCallCalendarFeedKind,
} from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import {
  DASHBOARD_URL,
  DEFAULT_POLICY,
  at,
  shift,
  tzInstant,
} from "../OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  ConformanceReport,
  ParsedEvent,
  checkICalendarConformance,
  readCalendarText,
  readEvents,
  unescapeText,
} from "./ICalendarConformance";
import { describe, expect, test } from "@jest/globals";

/*
 * Every on-call calendar feed has to be a calendar that Google Calendar,
 * Outlook and Apple Calendar read without complaint - a subscribed calendar
 * that a client cannot parse shows nothing at all, which is exactly what a
 * customer reported for Google. These tests read the bodies the way a strict
 * client does (ICalendarConformance.ts: CRLF, 75-octet folding, content-line
 * grammar, mandatory properties, value types, TEXT escaping) rather than
 * looking for substrings.
 *
 * First the checker itself is shown to catch each rule being broken, so a
 * green run below means something. Then the serializer is fed hostile text,
 * and then every kind of feed is rendered through the real mapper:
 * personal, schedule and project; overrides, policy variants and coverage
 * gaps; overnight, 24-hour and DST-crossing shifts; and every empty calendar
 * the server serves.
 */

const CRLF: string = "\r\n";

const BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);

function lines(...content: Array<string>): string {
  return content.join(CRLF) + CRLF;
}

function minimalCalendar(...eventLines: Array<string>): string {
  return lines(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Conformance//EN",
    "BEGIN:VEVENT",
    "UID:event-1@test",
    "DTSTAMP:20260801T100000Z",
    "DTSTART:20260901T070000Z",
    "DTEND:20260901T150000Z",
    "SUMMARY:Shift",
    ...eventLines,
    "END:VEVENT",
    "END:VCALENDAR",
  );
}

function problemsOf(
  body: string,
  options?: { allowNoComponents?: boolean },
): Array<string> {
  return checkICalendarConformance(body, options).problems;
}

function expectConforms(
  body: string,
  options?: { allowNoComponents?: boolean },
): void {
  expect(problemsOf(body, options)).toEqual([]);
}

function expectProblem(body: string, fragment: string): void {
  const problems: Array<string> = problemsOf(body);

  expect(
    problems.some((problem: string): boolean => {
      return problem.includes(fragment);
    }),
  ).toBe(true);
}

describe("the RFC 5545 checker itself", () => {
  test("accepts a minimal conforming calendar", () => {
    expectConforms(minimalCalendar());
  });

  test("an empty body is refused", () => {
    expect(problemsOf("")).toEqual(["the body is empty"]);
  });

  test("LF line endings are refused, wherever they are", () => {
    expectProblem(minimalCalendar().replace(/\r\n/g, "\n"), "CRLF");
    expectProblem(
      minimalCalendar().replace("SUMMARY:Shift", "SUMMARY:Shi\nft"),
      "bare CR or LF",
    );
    expectProblem(
      minimalCalendar().replace("SUMMARY:Shift", "SUMMARY:Shi\rft"),
      "bare CR or LF",
    );
  });

  test("a byte-order mark is refused", () => {
    expectProblem(BYTE_ORDER_MARK + minimalCalendar(), "byte-order mark");
  });

  test("a physical line over 75 octets is refused, counted in UTF-8 octets not characters", () => {
    expectProblem(
      minimalCalendar(`DESCRIPTION:${"a".repeat(70)}`),
      "more than 75",
    );

    // 37 characters but 87 octets: the euro sign is three octets in UTF-8.
    expectProblem(
      minimalCalendar(`DESCRIPTION:${"€".repeat(25)}`),
      "more than 75",
    );

    expectConforms(minimalCalendar(`DESCRIPTION:${"a".repeat(63)}`));
  });

  test("a fold that cuts a 4-octet character in two is refused", () => {
    const emoji: string = "\u{1F4C5}";
    const body: string = minimalCalendar(`DESCRIPTION:a${emoji}b`).replace(
      `a${emoji}b`,
      `a${emoji[0]}${CRLF} ${emoji[1]}b`,
    );

    expectProblem(body, "splits a character");
  });

  test("continuation lines are unfolded before the content line is read", () => {
    const body: string = minimalCalendar(`DESCRIPTION:one${CRLF} two`);

    expectConforms(body);
    expect(readEvents(body)[0]?.description).toBe("onetwo");
  });

  test("VERSION and PRODID are required exactly once, VERSION as 2.0", () => {
    expectProblem(minimalCalendar().replace("VERSION:2.0\r\n", ""), "VERSION");
    expectProblem(
      minimalCalendar().replace("VERSION:2.0", "VERSION:1.0"),
      "VERSION",
    );
    expectProblem(
      minimalCalendar().replace("VERSION:2.0", `VERSION:2.0${CRLF}VERSION:2.0`),
      "VERSION",
    );
    expectProblem(
      minimalCalendar().replace("PRODID:-//Test//Conformance//EN\r\n", ""),
      "PRODID",
    );
  });

  test("a VEVENT without UID, DTSTAMP or DTSTART is refused", () => {
    expectProblem(
      minimalCalendar().replace("UID:event-1@test\r\n", ""),
      "0 UID",
    );
    expectProblem(
      minimalCalendar().replace("DTSTAMP:20260801T100000Z\r\n", ""),
      "0 DTSTAMP",
    );
    expectProblem(
      minimalCalendar().replace("DTSTART:20260901T070000Z\r\n", ""),
      "0 DTSTART",
    );
  });

  test("a VEVENT needs DTEND or DURATION, never both", () => {
    expectProblem(
      minimalCalendar().replace("DTEND:20260901T150000Z\r\n", ""),
      "neither DTEND nor DURATION",
    );
    expectProblem(minimalCalendar("DURATION:PT8H"), "both DTEND and DURATION");
    expectConforms(
      minimalCalendar().replace("DTEND:20260901T150000Z", "DURATION:PT8H"),
    );
  });

  test("a repeated UID is refused", () => {
    const body: string = lines(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Conformance//EN",
      "BEGIN:VEVENT",
      "UID:same@test",
      "DTSTAMP:20260801T100000Z",
      "DTSTART:20260901T070000Z",
      "DTEND:20260901T150000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:same@test",
      "DTSTAMP:20260801T100000Z",
      "DTSTART:20260902T070000Z",
      "DTEND:20260902T150000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    );

    expectProblem(body, "UID repeats");
  });

  test("DTEND must come after DTSTART", () => {
    expectProblem(
      minimalCalendar().replace(
        "DTEND:20260901T150000Z",
        "DTEND:20260901T070000Z",
      ),
      "DTEND is not after DTSTART",
    );
  });

  test("a floating time, an unknown TZID and a local DTSTAMP are refused", () => {
    expectProblem(
      minimalCalendar().replace(
        "DTSTART:20260901T070000Z",
        "DTSTART:20260901T070000",
      ),
      "floating time",
    );
    expectProblem(
      minimalCalendar().replace(
        "DTSTART:20260901T070000Z",
        "DTSTART;TZID=Europe/Paris:20260901T070000",
      ),
      "no VTIMEZONE defines",
    );
    expectProblem(
      minimalCalendar().replace(
        "DTSTAMP:20260801T100000Z",
        "DTSTAMP:20260801T100000",
      ),
      "DTSTAMP must be in UTC",
    );
  });

  test("a TZID that a VTIMEZONE defines is accepted", () => {
    const body: string = lines(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Conformance//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Paris",
      "BEGIN:STANDARD",
      "DTSTART:19701025T030000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:tz@test",
      "DTSTAMP:20260801T100000Z",
      "DTSTART;TZID=Europe/Paris:20260901T090000",
      "DTEND;TZID=Europe/Paris:20260901T170000",
      "END:VEVENT",
      "END:VCALENDAR",
    );

    expectConforms(body);
  });

  test("an impossible date is refused", () => {
    expectProblem(
      minimalCalendar().replace(
        "DTSTART:20260901T070000Z",
        "DTSTART:20260231T070000Z",
      ),
      "is not a DATE-TIME",
    );
  });

  test("TEXT escaping: unescaped ; and , are refused, a lone backslash too, CATEGORIES may list with commas", () => {
    expectProblem(
      minimalCalendar().replace("SUMMARY:Shift", "SUMMARY:a, b"),
      'unescaped ","',
    );
    expectProblem(
      minimalCalendar().replace("SUMMARY:Shift", "SUMMARY:a; b"),
      'unescaped ";"',
    );
    expectProblem(
      minimalCalendar().replace("SUMMARY:Shift", "SUMMARY:a\\qb"),
      "escapes nothing",
    );
    expectConforms(
      minimalCalendar().replace(
        "SUMMARY:Shift",
        "SUMMARY:a\\, b\\; c\\\\ d\\n e",
      ),
    );
    expectConforms(minimalCalendar("CATEGORIES:On-Call,Team\\, Payments"));
  });

  test("unbalanced components are refused", () => {
    expectProblem(
      minimalCalendar().replace("END:VEVENT\r\n", ""),
      "closes BEGIN:VEVENT",
    );
    expectProblem(
      minimalCalendar().replace("END:VCALENDAR\r\n", ""),
      "never closed",
    );
  });

  test("REFRESH-INTERVAL must say VALUE=DURATION and hold a duration", () => {
    expectProblem(
      minimalCalendar().replace(
        "VERSION:2.0",
        `VERSION:2.0${CRLF}REFRESH-INTERVAL:PT1H`,
      ),
      "VALUE=DURATION",
    );
    expectProblem(
      minimalCalendar().replace(
        "VERSION:2.0",
        `VERSION:2.0${CRLF}REFRESH-INTERVAL;VALUE=DURATION:hourly`,
      ),
      "is not a duration",
    );
  });

  test("a calendar with no component at all is refused unless the caller accepts an empty feed", () => {
    const empty: string = lines(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Conformance//EN",
      "END:VCALENDAR",
    );

    expectProblem(empty, "no component");
    expectConforms(empty, { allowNoComponents: true });
  });

  test("a URL property must be an absolute http(s) URI", () => {
    expectProblem(
      minimalCalendar("URL:/relative/path"),
      "absolute http(s) URI",
    );
    expectConforms(minimalCalendar("URL:https://example.com/a?b=c"));
  });

  test("an invalid STATUS or TRANSP is refused", () => {
    expectProblem(minimalCalendar("STATUS:DONE"), "STATUS");
    expectProblem(minimalCalendar("TRANSP:SEE-THROUGH"), "TRANSP");
  });

  test("unescapeText reverses ICalendar.escapeText for every escape", () => {
    for (const text of [
      "plain",
      "a, b; c\\d",
      "line 1\nline 2",
      "trailing backslash \\",
      "\\n is not a newline here",
    ]) {
      expect(unescapeText(ICalendar.escapeText(text))).toBe(text);
    }
  });
});

describe("ICalendar.serialize conforms whatever the text holds", () => {
  const hostileTexts: Array<string> = [
    "Comma, semicolon; backslash \\ and a colon: here",
    "Line one\nLine two\r\nLine three\rLine four",
    "Tab\tinside, NUL\u0000 and BEL\u0007 dropped",
    "Emoji 📅🚨👩‍💻 and flags 🇸🇪🇫🇷",
    "日本語のスケジュール・オンコール当番表",
    "Ünïcödé combining é (e + U+0301) and Ω",
    "x".repeat(500),
    `${"é".repeat(37)}${"\u{1F4C5}".repeat(9)}`,
    '"Quoted" <html> & entities &amp; are just text',
  ];

  function hostileEvent(text: string, index: number): ICalendarEvent {
    return {
      uid: `oncall-hostile-${index}@oneuptime`,
      dtStamp: at("2026-08-01T10:00:00Z"),
      lastModified: at("2026-08-01T10:00:00Z"),
      sequence: index,
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      summary: `On-call · ${text}`,
      description: text,
      location: text,
      url: "https://oneuptime.example.com/dashboard/p/on-call-duty/schedules/s?x=1&y=2",
      status: ICalendarEventStatus.Confirmed,
      transparency: ICalendarTransparency.Transparent,
      categories: ["On-Call", text],
    };
  }

  test.each(
    hostileTexts.map((text: string, index: number) => {
      return [index, text];
    }),
  )(
    "hostile text #%s survives a strict read unchanged",
    (index: number, text: string) => {
      const document: ICalendarDocument = {
        calendar: {
          productId: "-//OneUptime//On-Call Calendar Feed//EN",
          name: text,
          description: text,
          timezone: "Europe/Stockholm",
          refreshInterval: "PT1H",
          lastModified: at("2026-08-01T10:00:00Z"),
        },
        events: [hostileEvent(text, index)],
      };

      const body: string = ICalendar.serialize(document);

      expectConforms(body);

      const events: Array<ParsedEvent> = readEvents(body);

      // What a client reads back is the text minus the characters TEXT forbids.
      const expected: string = ICalendar.escapeText(text);

      expect(events).toHaveLength(1);
      expect(events[0]!.description).toBe(unescapeText(expected));
      expect(events[0]!.summary).toBe(
        unescapeText(ICalendar.escapeText(`On-call · ${text}`)),
      );
      expect(readCalendarText(body, "X-WR-CALDESC")).toBe(
        unescapeText(expected),
      );
    },
  );

  test("a thousand events in one calendar all conform and keep their own UIDs", () => {
    const events: Array<ICalendarEvent> = [];

    for (let index: number = 0; index < 1000; index++) {
      events.push({
        ...hostileEvent(hostileTexts[index % hostileTexts.length]!, index),
        uid: `oncall-many-${index}@oneuptime`,
        start: new Date(at("2026-09-01T00:00:00Z").getTime() + index * 3600000),
        end: new Date(at("2026-09-01T01:00:00Z").getTime() + index * 3600000),
      });
    }

    const body: string = ICalendar.serialize({
      calendar: { productId: "-//OneUptime//On-Call Calendar Feed//EN" },
      events,
    });

    expectConforms(body);
    expect(readEvents(body)).toHaveLength(1000);
  });

  test("a calendar with no events keeps VERSION and PRODID and is only short of a component", () => {
    const body: string = ICalendar.serialize({
      calendar: {
        productId: "-//OneUptime//On-Call Calendar Feed//EN",
        name: "Empty",
      },
      events: [],
    });

    expect(problemsOf(body)).toEqual([
      "VCALENDAR: no component at all (RFC 5545 3.6 asks for at least one)",
    ]);
    expectConforms(body, { allowNoComponents: true });
  });
});

describe("every kind of on-call feed conforms", () => {
  const SECOND_POLICY: MaterializedShiftPolicy = {
    policyId: "pol-2",
    policyName: "Billing, Invoices; and \\ Refunds",
    ruleId: "rule-2",
    ruleName: "Backup",
    ruleOrder: 2,
  };

  /*
   * A week of a realistic roster: day and night shifts in Stockholm, a shift
   * that runs past midnight, a 24-hour weekend shift, a partial override, a
   * policy-scoped variant, a legacy schedule with no zone, and names that
   * carry every character TEXT has to escape.
   */
  function roster(): Array<MaterializedShift> {
    return [
      shift({
        start: tzInstant("2026-09-01 09:00", "Europe/Stockholm"),
        end: tzInstant("2026-09-01 17:00", "Europe/Stockholm"),
        layerName: "Day, weekdays; primary",
      }),
      // Overnight: 22:00 to 06:00 the next morning.
      shift({
        start: tzInstant("2026-09-01 22:00", "Europe/Stockholm"),
        end: tzInstant("2026-09-02 06:00", "Europe/Stockholm"),
        userId: "user-b",
        userName: "Björn \\ Öberg, Jr.",
      }),
      // A whole day.
      shift({
        start: tzInstant("2026-09-05 00:00", "Europe/Stockholm"),
        end: tzInstant("2026-09-06 00:00", "Europe/Stockholm"),
        userId: "user-c",
        userName: "Chloé 📟 Martin",
        policies: [{ ...DEFAULT_POLICY }, { ...SECOND_POLICY }],
      }),
      // Covering for somebody, through a global override.
      shift({
        start: tzInstant("2026-09-03 12:00", "Europe/Stockholm"),
        end: tzInstant("2026-09-03 13:00", "Europe/Stockholm"),
        userId: "user-d",
        userName: "Dmitri; Petrov",
        override: {
          originalUserId: "user-a",
          originalUserName: "Alice Andersson",
          overrideStartsAt: tzInstant("2026-09-03 12:00", "Europe/Stockholm"),
          overrideEndsAt: tzInstant("2026-09-03 13:00", "Europe/Stockholm"),
        },
      }),
      // Only one policy pages the substitute.
      shift({
        start: tzInstant("2026-09-04 09:00", "Europe/Stockholm"),
        end: tzInstant("2026-09-04 17:00", "Europe/Stockholm"),
        userId: "user-e",
        userName: "Eve",
        policies: [{ ...DEFAULT_POLICY }, { ...SECOND_POLICY }],
        policyVariantOf: {
          policyId: SECOND_POLICY.policyId,
          policyName: SECOND_POLICY.policyName,
          globalUserId: "user-a",
        },
        override: {
          originalUserId: "user-a",
          originalUserName: "Alice Andersson",
          overrideStartsAt: tzInstant("2026-09-04 09:00", "Europe/Stockholm"),
          overrideEndsAt: tzInstant("2026-09-04 17:00", "Europe/Stockholm"),
          onCallDutyPolicyId: SECOND_POLICY.policyId,
        },
      }),
      shift({
        start: tzInstant("2026-09-04 09:00", "Europe/Stockholm"),
        end: tzInstant("2026-09-04 17:00", "Europe/Stockholm"),
        policies: [{ ...DEFAULT_POLICY }, { ...SECOND_POLICY }],
      }),
      // A legacy schedule with no time zone, in the past.
      shift({
        scheduleId: "sched-legacy",
        scheduleName: 'Legacy, "quoted" schedule',
        scheduleTimezone: undefined,
        start: at("2026-08-30T08:00:00Z"),
        end: at("2026-08-30T20:00:00Z"),
        isPast: true,
      }),
      // A shift across the end of daylight saving time in Stockholm.
      shift({
        start: tzInstant("2026-10-24 20:00", "Europe/Stockholm"),
        end: tzInstant("2026-10-25 08:00", "Europe/Stockholm"),
        userId: "user-f",
        userName: "Fatima Al-Hassan",
      }),
    ];
  }

  test.each([
    OnCallCalendarFeedKind.Personal,
    OnCallCalendarFeedKind.Schedule,
    OnCallCalendarFeedKind.Project,
  ])(
    "a %s feed with overrides, variants, overnight, 24-hour and DST shifts",
    (kind: OnCallCalendarFeedKind) => {
      const shifts: Array<MaterializedShift> = roster();

      const rendered: FeedRenderResult = OnCallCalendarFeedUtil.render({
        kind,
        shifts,
        dashboardUrl: DASHBOARD_URL,
        viewerTimezone: "America/New_York",
        calendarTimezone: "Europe/Stockholm",
        scheduleName: "Payments, EU; primary",
        projectName: "Acme \\ Corp",
        notes: ["A note, with; punctuation \\ and\nnew lines."],
      });

      expectConforms(rendered.body);

      const events: Array<ParsedEvent> = readEvents(rendered.body);

      expect(events).toHaveLength(shifts.length);

      // Every instant is UTC on the wire and lands exactly where the shift is.
      for (const event of events) {
        const source: MaterializedShift | undefined = shifts.find(
          (candidate: MaterializedShift) => {
            return OnCallCalendarFeedUtil.getShiftUid(candidate) === event.uid;
          },
        );

        expect(source).toBeDefined();
        expect(event.start.toISOString()).toBe(source!.start.toISOString());
        expect(event.end.toISOString()).toBe(source!.end.toISOString());
        expect(event.end.getTime()).toBeGreaterThan(event.start.getTime());
      }

      // The overnight shift is one event that crosses midnight, not two.
      const overnight: ParsedEvent | undefined = events.find(
        (event: ParsedEvent) => {
          return event.start.toISOString() === "2026-09-01T20:00:00.000Z";
        },
      );

      expect(overnight?.end.toISOString()).toBe("2026-09-02T04:00:00.000Z");

      // The 24-hour shift is a timed event spanning the whole local day.
      const wholeDay: ParsedEvent | undefined = events.find(
        (event: ParsedEvent) => {
          return event.start.toISOString() === "2026-09-04T22:00:00.000Z";
        },
      );

      expect(
        (wholeDay!.end.getTime() - wholeDay!.start.getTime()) / 3600000,
      ).toBe(24);

      // Across the end of DST the shift is 13 hours long, not 12.
      const dst: ParsedEvent | undefined = events.find((event: ParsedEvent) => {
        return event.start.toISOString() === "2026-10-24T18:00:00.000Z";
      });

      expect((dst!.end.getTime() - dst!.start.getTime()) / 3600000).toBe(13);

      // Names come back exactly as they were, escapes undone.
      expect(
        events.some((event: ParsedEvent) => {
          return event.description.includes("Who: Björn \\ Öberg, Jr.");
        }),
      ).toBe(true);
      expect(
        events.some((event: ParsedEvent) => {
          return event.description.includes(
            "Billing, Invoices; and \\ Refunds",
          );
        }),
      ).toBe(true);
    },
  );

  test("UIDs are stable across refreshes: a later render keeps every shared shift's UID, DTSTAMP and SEQUENCE", () => {
    const shifts: Array<MaterializedShift> = roster();

    const first: Array<ParsedEvent> = readEvents(
      OnCallCalendarFeedUtil.render({
        kind: OnCallCalendarFeedKind.Schedule,
        shifts,
        dashboardUrl: DASHBOARD_URL,
        scheduleName: "Payments",
      }).body,
    );

    // The next day: the first shift has rolled into the past, one shift fell out.
    const later: Array<ParsedEvent> = readEvents(
      OnCallCalendarFeedUtil.render({
        kind: OnCallCalendarFeedKind.Schedule,
        shifts: shifts.slice(1).map((entry: MaterializedShift) => {
          return { ...entry, isPast: true };
        }),
        dashboardUrl: DASHBOARD_URL,
        scheduleName: "Payments",
      }).body,
    );

    for (const event of later) {
      const before: ParsedEvent | undefined = first.find(
        (candidate: ParsedEvent) => {
          return candidate.uid === event.uid;
        },
      );

      expect(before).toBeDefined();
      expect(event.dtStamp.toISOString()).toBe(before!.dtStamp.toISOString());
      expect(event.sequence).toBe(before!.sequence);
      expect(event.start.toISOString()).toBe(before!.start.toISOString());
    }
  });

  test("the same shift has the same UID in the personal, schedule and project feeds", () => {
    const one: MaterializedShift = roster()[0]!;

    const uids: Array<string> = [
      OnCallCalendarFeedKind.Personal,
      OnCallCalendarFeedKind.Schedule,
      OnCallCalendarFeedKind.Project,
    ].map((kind: OnCallCalendarFeedKind): string => {
      return readEvents(
        OnCallCalendarFeedUtil.render({
          kind,
          shifts: [one],
          dashboardUrl: DASHBOARD_URL,
        }).body,
      )[0]!.uid;
    });

    expect(new Set(uids).size).toBe(1);
    expect(uids[0]).toBe(OnCallCalendarFeedUtil.getShiftUid(one));
  });

  test("coverage-gap events conform alongside the shifts and never reuse a shift's UID", () => {
    const shifts: Array<MaterializedShift> = roster().slice(0, 2);

    const gaps: Array<ICalendarEvent> =
      OnCallCalendarFeedUtil.buildCoverageGapEvents({
        scheduleId: "sched-1",
        scheduleName: "Payments, EU; primary",
        projectId: "proj-1",
        shifts,
        feedStart: at("2026-09-01T00:00:00Z"),
        feedEnd: at("2026-09-03T00:00:00Z"),
        envelope: [
          {
            start: at("2026-09-01T00:00:00Z"),
            end: at("2026-09-03T00:00:00Z"),
          },
        ],
        minimumGapSeconds: 60,
        lastModifiedAt: at("2026-08-01T10:00:00Z"),
        shiftConfigVersion: 4,
        dashboardUrl: DASHBOARD_URL,
      }).events;

    expect(gaps.length).toBeGreaterThan(0);

    const body: string = OnCallCalendarFeedUtil.render({
      kind: OnCallCalendarFeedKind.Schedule,
      shifts,
      gapEvents: gaps,
      dashboardUrl: DASHBOARD_URL,
      scheduleName: "Payments",
    }).body;

    expectConforms(body);

    const events: Array<ParsedEvent> = readEvents(body);

    expect(events).toHaveLength(shifts.length + gaps.length);
    expect(
      events.filter((event: ParsedEvent) => {
        return event.summary.startsWith("No coverage · ");
      }),
    ).toHaveLength(gaps.length);
  });

  test.each([
    OnCallCalendarFeedKind.Personal,
    OnCallCalendarFeedKind.Schedule,
    OnCallCalendarFeedKind.Project,
  ])(
    "an empty %s feed conforms, names the calendar and says why it is empty",
    (kind: OnCallCalendarFeedKind) => {
      const reason: string =
        "You are not on any on-call schedule in this project right now; shifts appear here, once added.";

      const body: string = OnCallCalendarFeedUtil.renderEmpty({
        kind,
        reason,
        scheduleName: "Payments, EU",
        projectName: "Acme",
        timezone: "Europe/Stockholm",
      });

      expectConforms(body, { allowNoComponents: true });
      expect(readEvents(body, { allowNoComponents: true })).toEqual([]);
      expect(readCalendarText(body, "X-WR-CALNAME")).toBeTruthy();
      expect(readCalendarText(body, "X-WR-CALDESC")).toContain(reason);
      expect(readCalendarText(body, "X-WR-TIMEZONE")).toBe("Europe/Stockholm");
    },
  );

  test("a feed shortened to the event cap still conforms", () => {
    const shifts: Array<MaterializedShift> = [];

    for (let index: number = 0; index < 300; index++) {
      shifts.push(
        shift({
          start: new Date(
            at("2026-09-01T00:00:00Z").getTime() + index * 7200000,
          ),
          end: new Date(at("2026-09-01T02:00:00Z").getTime() + index * 7200000),
          userId: `user-${index % 7}`,
          userName: `Person ${index % 7}, team; ${index}`,
        }),
      );
    }

    const report: ConformanceReport = checkICalendarConformance(
      OnCallCalendarFeedUtil.render({
        kind: OnCallCalendarFeedKind.Project,
        shifts,
        dashboardUrl: DASHBOARD_URL,
        projectName: "Acme",
        notes: [
          "Shortened to 30 days ahead because the feed would exceed 5000 events.",
        ],
      }).body,
    );

    expect(report.problems).toEqual([]);
  });
});
