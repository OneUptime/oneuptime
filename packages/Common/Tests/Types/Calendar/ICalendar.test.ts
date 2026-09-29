import ICalendar, {
  ICALENDAR_LINE_BREAK,
  ICALENDAR_MAX_LINE_OCTETS,
  ICalendarCalendar,
  ICalendarDocument,
  ICalendarEvent,
  ICalendarEventStatus,
  ICalendarTransparency,
} from "../../../Types/Calendar/ICalendar";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";

const at: (iso: string) => Date = (iso: string): Date => {
  return OneUptimeDate.fromString(iso);
};

const CRLF: string = "\r\n";

function physicalLines(body: string): Array<string> {
  const lines: Array<string> = body.split(CRLF);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function octets(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// A lone surrogate means a UTF-16 pair (= one 4-octet UTF-8 char) was split.
const LONE_SURROGATE: RegExp =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function baseCalendar(): ICalendarCalendar {
  return {
    productId: "-//Test//Feed//EN",
    name: "Team",
    description: "Desc",
    timezone: "UTC",
    refreshInterval: "PT1H",
    lastModified: at("2026-08-01T10:00:00Z"),
  };
}

function baseEvent(): ICalendarEvent {
  return {
    uid: "u1@test",
    dtStamp: at("2026-08-01T10:00:00Z"),
    lastModified: at("2026-08-01T10:00:00Z"),
    sequence: 2,
    start: at("2026-09-01T07:00:00Z"),
    end: at("2026-09-01T15:00:00Z"),
    summary: "On-call · Team",
    description: "Line 1\nLine 2; a, b",
    url: "https://x.test/a",
    status: ICalendarEventStatus.Confirmed,
    transparency: ICalendarTransparency.Transparent,
    categories: ["On-Call"],
  };
}

describe("ICalendar.serialize", () => {
  test("byte-exact snapshot of a small calendar", () => {
    const body: string = ICalendar.serialize({
      calendar: baseCalendar(),
      events: [baseEvent()],
    });

    const expected: string =
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Test//Feed//EN",
        "CALSCALE:GREGORIAN",
        "NAME:Team",
        "X-WR-CALNAME:Team",
        "X-WR-CALDESC:Desc",
        "X-WR-TIMEZONE:UTC",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        "LAST-MODIFIED:20260801T100000Z",
        "BEGIN:VEVENT",
        "UID:u1@test",
        "DTSTAMP:20260801T100000Z",
        "LAST-MODIFIED:20260801T100000Z",
        "SEQUENCE:2",
        "DTSTART:20260901T070000Z",
        "DTEND:20260901T150000Z",
        "SUMMARY:On-call · Team",
        "DESCRIPTION:Line 1\\nLine 2\\; a\\, b",
        "URL:https://x.test/a",
        "STATUS:CONFIRMED",
        "TRANSP:TRANSPARENT",
        "CATEGORIES:On-Call",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join(CRLF) + CRLF;

    expect(body).toBe(expected);
  });

  test("every line break is CRLF and the body ends with one", () => {
    const body: string = ICalendar.serialize({
      calendar: baseCalendar(),
      events: [baseEvent()],
    });

    expect(body.endsWith(CRLF)).toBe(true);
    expect(body.replace(/\r\n/g, "")).not.toContain("\n");
    expect(body.replace(/\r\n/g, "")).not.toContain("\r");
    expect(ICALENDAR_LINE_BREAK).toBe(CRLF);
  });

  test("serializing the same document twice gives identical bytes, whatever the key order", () => {
    const first: string = ICalendar.serialize({
      calendar: baseCalendar(),
      events: [baseEvent()],
    });

    const shuffledEvent: ICalendarEvent = {
      categories: ["On-Call"],
      transparency: ICalendarTransparency.Transparent,
      status: ICalendarEventStatus.Confirmed,
      url: "https://x.test/a",
      description: "Line 1\nLine 2; a, b",
      summary: "On-call · Team",
      end: at("2026-09-01T15:00:00Z"),
      start: at("2026-09-01T07:00:00Z"),
      sequence: 2,
      lastModified: at("2026-08-01T10:00:00Z"),
      dtStamp: at("2026-08-01T10:00:00Z"),
      uid: "u1@test",
    };

    const second: string = ICalendar.serialize({
      calendar: baseCalendar(),
      events: [shuffledEvent],
    });

    expect(second).toBe(first);
  });

  test("never emits METHOD, CLASS, VALARM, RRULE, VTIMEZONE, ORGANIZER or ATTENDEE", () => {
    const body: string = ICalendar.serialize({
      calendar: baseCalendar(),
      events: [baseEvent(), { ...baseEvent(), uid: "u2@test" }],
    });

    for (const forbidden of [
      "METHOD",
      "CLASS",
      "VALARM",
      "RRULE",
      "VTIMEZONE",
      "ORGANIZER",
      "ATTENDEE",
      "TZID",
    ]) {
      expect(body).not.toMatch(new RegExp(`^${forbidden}[:;]`, "m"));
      expect(body).not.toContain(`BEGIN:${forbidden}`);
    }
  });

  test("an empty calendar is just the header", () => {
    const body: string = ICalendar.serialize({
      calendar: baseCalendar(),
      events: [],
    });

    expect(body).not.toContain("BEGIN:VEVENT");
    expect(physicalLines(body)[0]).toBe("BEGIN:VCALENDAR");
    expect(physicalLines(body)[physicalLines(body).length - 1]).toBe(
      "END:VCALENDAR",
    );
  });

  test("optional header properties are omitted when absent or empty; X-WR-CALNAME defaults to NAME", () => {
    const body: string = ICalendar.serialize({
      calendar: {
        productId: "-//Test//Feed//EN",
        name: "Only Name",
        description: "",
      },
      events: [],
    });

    expect(body).toContain("NAME:Only Name\r\n");
    expect(body).toContain("X-WR-CALNAME:Only Name\r\n");
    expect(body).not.toContain("X-WR-CALDESC");
    expect(body).not.toContain("X-WR-TIMEZONE");
    expect(body).not.toContain("REFRESH-INTERVAL");
    expect(body).not.toContain("X-PUBLISHED-TTL");
    expect(body).not.toContain("LAST-MODIFIED");
  });

  test("displayName overrides X-WR-CALNAME while NAME keeps the full name", () => {
    const body: string = ICalendar.serialize({
      calendar: {
        productId: "-//Test//Feed//EN",
        name: "A very long schedule name indeed",
        displayName: "A very long schedule…",
      },
      events: [],
    });

    expect(body).toContain("NAME:A very long schedule name indeed\r\n");
    expect(body).toContain("X-WR-CALNAME:A very long schedule…\r\n");
  });

  test("optional event properties are omitted when absent", () => {
    const lines: Array<string> = ICalendar.serializeEvent({
      uid: "bare@test",
      dtStamp: at("2026-08-01T10:00:00Z"),
      start: at("2026-09-01T07:00:00Z"),
      end: at("2026-09-01T15:00:00Z"),
      summary: "Bare",
    });

    expect(lines).toEqual([
      "BEGIN:VEVENT",
      "UID:bare@test",
      "DTSTAMP:20260801T100000Z",
      "DTSTART:20260901T070000Z",
      "DTEND:20260901T150000Z",
      "SUMMARY:Bare",
      "END:VEVENT",
    ]);
  });

  test("REFRESH-INTERVAL and X-PUBLISHED-TTL carry the same normalised duration", () => {
    const body: string = ICalendar.serialize({
      calendar: { ...baseCalendar(), refreshInterval: " pt15m " },
      events: [],
    });

    expect(body).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M\r\n");
    expect(body).toContain("X-PUBLISHED-TTL:PT15M\r\n");
  });

  test("an invalid refresh interval throws", () => {
    for (const bad of ["1h", "P", "PT", "PT1X", ""]) {
      expect(() => {
        return ICalendar.serialize({
          calendar: { ...baseCalendar(), refreshInterval: bad },
          events: [],
        });
      }).toThrow(BadDataException);
    }
  });

  test("an empty UID, an inverted event or a bad SEQUENCE throws", () => {
    expect(() => {
      return ICalendar.serializeEvent({ ...baseEvent(), uid: "  " });
    }).toThrow(BadDataException);

    expect(() => {
      return ICalendar.serializeEvent({
        ...baseEvent(),
        end: at("2026-09-01T07:00:00Z"),
      });
    }).toThrow(BadDataException);

    expect(() => {
      return ICalendar.serializeEvent({ ...baseEvent(), sequence: -1 });
    }).toThrow(BadDataException);

    expect(() => {
      return ICalendar.serializeEvent({ ...baseEvent(), sequence: 1.5 });
    }).toThrow(BadDataException);
  });

  test("CATEGORIES escapes each entry and joins with commas; URL is not TEXT-escaped", () => {
    const lines: Array<string> = ICalendar.serializeEvent({
      ...baseEvent(),
      categories: ["On-Call", "a,b", "c;d"],
      url: "https://x.test/a?b=1,2;3\nrest",
    });

    expect(lines).toContain("CATEGORIES:On-Call,a\\,b,c\\;d");
    expect(lines).toContain("URL:https://x.test/a?b=1,2;3rest");
  });
});

describe("ICalendar.escapeText", () => {
  test("escapes backslash, semicolon, comma and newline in that order of precedence", () => {
    expect(ICalendar.escapeText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  test("drops carriage returns and other control characters but keeps tabs", () => {
    expect(ICalendar.escapeText("x\r\nyz\tw")).toBe("x\\nyz\tw");
  });

  test("leaves multi-byte characters untouched", () => {
    expect(ICalendar.escapeText("Ærø · 東京 · 😀")).toBe("Ærø · 東京 · 😀");
  });

  test("escaping is idempotent on already-plain text and round-trips through a client-style unescape", () => {
    const original: string = "Who: A\nSchedule: B (C); D, E\\F";
    const escaped: string = ICalendar.escapeText(original);

    const unescaped: string = escaped.replace(
      /\\([\\;,nN])/g,
      (_match: string, char: string): string => {
        return char === "n" || char === "N" ? "\n" : char;
      },
    );

    expect(unescaped).toBe(original);
  });
});

describe("ICalendar.formatUtcDateTime", () => {
  test("formats as YYYYMMDDTHHMMSSZ in UTC, ignoring milliseconds", () => {
    expect(ICalendar.formatUtcDateTime(at("2026-03-08T06:30:05.999Z"))).toBe(
      "20260308T063005Z",
    );
    expect(ICalendar.formatUtcDateTime(at("2026-12-31T23:59:59Z"))).toBe(
      "20261231T235959Z",
    );
    expect(ICalendar.formatUtcDateTime(at("2026-01-01T00:00:00Z"))).toBe(
      "20260101T000000Z",
    );
  });

  test("zero-pads every component", () => {
    expect(ICalendar.formatUtcDateTime(at("2026-02-03T04:05:06Z"))).toBe(
      "20260203T040506Z",
    );
  });

  test("throws on an invalid date", () => {
    expect(() => {
      return ICalendar.formatUtcDateTime(new Date("not a date"));
    }).toThrow(BadDataException);
  });
});

describe("ICalendar.foldLine", () => {
  test("a line of at most 75 octets is returned unchanged", () => {
    const line: string = `SUMMARY:${"a".repeat(67)}`;
    expect(octets(line)).toBe(75);
    expect(ICalendar.foldLine(line)).toBe(line);
  });

  test("a long ASCII line folds into 75-octet pieces with a leading space and unfolds losslessly", () => {
    const line: string = `DESCRIPTION:${"a".repeat(300)}`;
    const folded: string = ICalendar.foldLine(line);
    const pieces: Array<string> = folded.split(CRLF);

    expect(pieces.length).toBeGreaterThan(1);
    expect(octets(pieces[0]!)).toBe(75);

    for (let i: number = 1; i < pieces.length; i++) {
      expect(pieces[i]!.startsWith(" ")).toBe(true);
      expect(octets(pieces[i]!)).toBeLessThanOrEqual(75);
    }

    // Every continuation but the last is packed to the limit.
    for (let i: number = 1; i < pieces.length - 1; i++) {
      expect(octets(pieces[i]!)).toBe(75);
    }

    expect(ICalendar.unfold(folded)).toBe(line);
  });

  test("never splits a 2-octet character", () => {
    // "SUMMARY:" is 8 octets; 33 x "é" (66) fits, the 34th would make 76.
    const line: string = `SUMMARY:${"é".repeat(120)}`;
    const folded: string = ICalendar.foldLine(line);
    const pieces: Array<string> = folded.split(CRLF);

    expect(pieces[0]).toBe(`SUMMARY:${"é".repeat(33)}`);
    expect(octets(pieces[0]!)).toBe(74);

    for (const piece of pieces) {
      expect(octets(piece)).toBeLessThanOrEqual(ICALENDAR_MAX_LINE_OCTETS);
      expect(piece).not.toMatch(LONE_SURROGATE);
      expect(Buffer.from(piece, "utf8").toString("utf8")).toBe(piece);
    }

    expect(ICalendar.unfold(folded)).toBe(line);
  });

  test("never splits a 3-octet or 4-octet character", () => {
    for (const char of ["東", "😀"]) {
      const line: string = `X:${char.repeat(90)}`;
      const folded: string = ICalendar.foldLine(line);

      for (const piece of folded.split(CRLF)) {
        expect(octets(piece)).toBeLessThanOrEqual(ICALENDAR_MAX_LINE_OCTETS);
        expect(piece).not.toMatch(LONE_SURROGATE);
        expect(Buffer.from(piece, "utf8").toString("utf8")).toBe(piece);
      }

      expect(ICalendar.unfold(folded)).toBe(line);
    }
  });

  test("a mixed-width line packs each physical line as full as the boundary allows", () => {
    const line: string = `DESCRIPTION:${"ab😀é東".repeat(40)}`;
    const folded: string = ICalendar.foldLine(line);
    const pieces: Array<string> = folded.split(CRLF);

    expect(pieces.length).toBeGreaterThan(2);

    for (let i: number = 0; i < pieces.length; i++) {
      const piece: string = pieces[i]!;
      expect(octets(piece)).toBeLessThanOrEqual(75);
      // Every piece but the last is packed to within one character of the limit.
      if (i < pieces.length - 1) {
        expect(octets(piece)).toBeGreaterThan(70);
      }
      expect(piece).not.toMatch(LONE_SURROGATE);
      if (i > 0) {
        expect(piece.startsWith(" ")).toBe(true);
      }
    }

    expect(ICalendar.unfold(folded)).toBe(line);
  });

  test("a serialized document has no physical line over 75 octets and unfolds to the logical lines", () => {
    const document: ICalendarDocument = {
      calendar: {
        ...baseCalendar(),
        description: "Ærø ".repeat(60),
      },
      events: [
        {
          ...baseEvent(),
          summary: "😀".repeat(50),
          description: "東京".repeat(100),
        },
      ],
    };

    const body: string = ICalendar.serialize(document);

    for (const line of physicalLines(body)) {
      expect(octets(line)).toBeLessThanOrEqual(ICALENDAR_MAX_LINE_OCTETS);
      expect(line).not.toMatch(LONE_SURROGATE);
    }

    const unfolded: string = ICalendar.unfold(body);
    expect(unfolded).toContain(`SUMMARY:${"😀".repeat(50)}\r\n`);
    expect(unfolded).toContain(`DESCRIPTION:${"東京".repeat(100)}\r\n`);
  });
});

describe("ICalendar.getUtf8OctetLength", () => {
  test("counts 1/2/3/4 octet characters", () => {
    expect(ICalendar.getUtf8OctetLength("abc")).toBe(3);
    expect(ICalendar.getUtf8OctetLength("é")).toBe(2);
    expect(ICalendar.getUtf8OctetLength("東")).toBe(3);
    expect(ICalendar.getUtf8OctetLength("😀")).toBe(4);
    expect(ICalendar.getUtf8OctetLength("aé東😀")).toBe(
      Buffer.byteLength("aé東😀", "utf8"),
    );
  });
});

describe("ICalendar.contentLine / textLine", () => {
  test("upper-cases the name and parameter names", () => {
    expect(ICalendar.contentLine("x-thing", "v", { value: "duration" })).toBe(
      "X-THING;VALUE=duration:v",
    );
  });

  test("quotes parameter values containing reserved characters and strips double quotes", () => {
    expect(ICalendar.contentLine("P", "v", { cn: 'Doe, "John"' })).toBe(
      'P;CN="Doe, John":v',
    );
    expect(ICalendar.contentLine("P", "v", { cn: "a:b" })).toBe('P;CN="a:b":v');
  });

  test("strips line breaks from any value", () => {
    expect(ICalendar.contentLine("URL", "https://x\r\n.test")).toBe(
      "URL:https://x.test",
    );
  });

  test("textLine escapes the value", () => {
    expect(ICalendar.textLine("SUMMARY", "a, b; c")).toBe(
      "SUMMARY:a\\, b\\; c",
    );
  });
});
