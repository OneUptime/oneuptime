import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import EventInterval from "../../../Types/Events/EventInterval";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  LEGACY_RESTRICTION_TYPE_KEY,
  RESTRICTION_TYPE_KEY,
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import { hhmm, rotation, tzInstant, user } from "./CalendarFeedTestFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * A LAYER'S RESTRICTION TYPE, UNDER EITHER SPELLING (#11269).
 *
 * The key was spelled restictionType - without the second "r" - and only
 * that spelling was read. A client that sent the natural restrictionType had
 * its write accepted and the layer stored with no type, which the engine
 * read as never on call: nothing paged, and nothing said why. Here:
 *
 *   - reading: either spelling, the one named restrictionType first, and a
 *     restriction that names neither read for the hours it holds;
 *   - what is sent out (toJSON): both, alike, for readers of either;
 *   - what is stored (toDatabaseJSON): restrictionType alone;
 *   - what a write may hold (fromWrittenJSON): every way it could leave a
 *     layer paging nobody without saying so is refused with the key named;
 *   - the engine: the issue's own payload now pages around the clock.
 */

const WARSAW: string = "Europe/Warsaw";

// A moment as the API writes one.
function dateTime(iso: string): JSONObject {
  return { _type: ObjectType.DateTime, value: iso };
}

function restriction(value: JSONObject): JSONObject {
  return { _type: ObjectType.RestrictionTimes, value: value };
}

// The issue's payload: the natural spelling, around the clock.
const ISSUE_PAYLOAD: JSONObject = restriction({
  restrictionType: "None",
  dayRestrictionTimes: null,
  weeklyRestrictionTimes: [],
});

const NIGHTS: JSONObject = {
  startTime: dateTime("2026-01-05T16:00:00.000Z"),
  endTime: dateTime("2026-01-06T06:00:00.000Z"),
};

const MONDAY_OFFICE_HOURS: JSONObject = {
  startDay: "Monday",
  endDay: "Monday",
  startTime: dateTime("2026-01-05T08:00:00.000Z"),
  endTime: dateTime("2026-01-05T16:00:00.000Z"),
};

function valueOf(json: JSONObject): JSONObject {
  return json["value"] as JSONObject;
}

function refusal(write: () => unknown): string {
  try {
    write();
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("The write was not refused.");
}

describe("reading a restriction: either spelling", () => {
  test("REGRESSION #11269: restrictionType, the natural spelling, is read", () => {
    for (const type of [
      RestrictionType.None,
      RestrictionType.Daily,
      RestrictionType.Weekly,
    ]) {
      const read: RestrictionTimes = RestrictionTimes.fromJSON(
        restriction({
          restrictionType: type,
          dayRestrictionTimes: NIGHTS,
          weeklyRestrictionTimes: [MONDAY_OFFICE_HOURS],
        }),
      );

      expect(read.restrictionType).toBe(type);
    }
  });

  test("restictionType, the older spelling, is read as it always was", () => {
    const read: RestrictionTimes = RestrictionTimes.fromJSON(
      restriction({
        restictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
        weeklyRestrictionTimes: [],
      }),
    );

    expect(read.restrictionType).toBe(RestrictionType.Daily);
  });

  test("both: the one under its name wins, as a stored row has no one to ask", () => {
    const read: RestrictionTimes = RestrictionTimes.fromJSON(
      restriction({
        restrictionType: "Weekly",
        restictionType: "None",
        weeklyRestrictionTimes: [MONDAY_OFFICE_HOURS],
      }),
    );

    expect(read.restrictionType).toBe(RestrictionType.Weekly);
  });

  test("an unknown value under the name is passed over for a known one under the older spelling", () => {
    const read: RestrictionTimes = RestrictionTimes.fromJSON(
      restriction({
        restrictionType: "daily",
        restictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
      }),
    );

    expect(read.restrictionType).toBe(RestrictionType.Daily);
  });

  test("the deprecated accessor reads and writes the same type", () => {
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();

    restrictionTimes.restictionType = RestrictionType.Weekly;
    expect(restrictionTimes.restrictionType).toBe(RestrictionType.Weekly);

    restrictionTimes.restrictionType = RestrictionType.Daily;
    expect(restrictionTimes.restictionType).toBe(RestrictionType.Daily);
  });
});

describe("reading a stored restriction that names no type: from the hours it holds", () => {
  test("windows of the week: Weekly", () => {
    expect(
      RestrictionTimes.fromJSON(
        restriction({ weeklyRestrictionTimes: [MONDAY_OFFICE_HOURS] }),
      ).restrictionType,
    ).toBe(RestrictionType.Weekly);
  });

  test("a window of the day open for some time: Daily", () => {
    expect(
      RestrictionTimes.fromJSON(
        restriction({
          restriction_type: "Daily",
          dayRestrictionTimes: NIGHTS,
          weeklyRestrictionTimes: [],
        }),
      ).restrictionType,
    ).toBe(RestrictionType.Daily);
  });

  test("nothing usable: None, on call around the clock, as a layer with no restriction is", () => {
    for (const value of [
      {},
      { dayRestrictionTimes: null, weeklyRestrictionTimes: [] },
      // A time of day alone names no moment.
      {
        dayRestrictionTimes: { startTime: "09:00", endTime: "17:00" },
      },
      // Open for no time.
      {
        dayRestrictionTimes: {
          startTime: dateTime("2026-01-05T09:00:00.000Z"),
          endTime: dateTime("2026-01-07T09:00:00.000Z"),
        },
      },
      { weeklyRestrictionTimes: [{ startDay: "Monday" }] },
      { restrictionType: "Always" },
    ] as Array<JSONObject>) {
      expect(
        RestrictionTimes.fromJSON(restriction(value)).restrictionType,
      ).toBe(RestrictionType.None);
    }
  });

  test("inferRestrictionType says the same, and None for no value at all", () => {
    expect(RestrictionTimes.inferRestrictionType(null)).toBe(
      RestrictionType.None,
    );
    expect(
      RestrictionTimes.inferRestrictionType({ dayRestrictionTimes: NIGHTS }),
    ).toBe(RestrictionType.Daily);
    expect(
      RestrictionTimes.inferRestrictionType({
        dayRestrictionTimes: NIGHTS,
        weeklyRestrictionTimes: [MONDAY_OFFICE_HOURS],
      }),
    ).toBe(RestrictionType.Weekly);
  });

  test("readRestrictionType names a type only when one is there", () => {
    expect(RestrictionTimes.readRestrictionType(undefined)).toBeNull();
    expect(RestrictionTimes.readRestrictionType({})).toBeNull();
    expect(
      RestrictionTimes.readRestrictionType({ restrictionType: "Weekly" }),
    ).toBe(RestrictionType.Weekly);
    expect(
      RestrictionTimes.readRestrictionType({ restictionType: "None" }),
    ).toBe(RestrictionType.None);
    expect(
      RestrictionTimes.readRestrictionType({ restrictionType: 7 }),
    ).toBeNull();
  });
});

describe("what is sent out, and what is stored", () => {
  test("toJSON sends the type under both spellings, alike", () => {
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.addDefaultWeeklyRestriction();

    const value: JSONObject = valueOf(restrictionTimes.toJSON());

    expect(value[RESTRICTION_TYPE_KEY]).toBe(RestrictionType.Weekly);
    expect(value[LEGACY_RESTRICTION_TYPE_KEY]).toBe(RestrictionType.Weekly);
    expect(Object.keys(value).sort()).toEqual(
      [
        "dayRestrictionTimes",
        "restictionType",
        "restrictionType",
        "weeklyRestrictionTimes",
      ].sort(),
    );
  });

  test("toDatabaseJSON stores restrictionType alone", () => {
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.addDefaultDailyRestriction();

    const value: JSONObject = valueOf(restrictionTimes.toDatabaseJSON());

    expect(value[RESTRICTION_TYPE_KEY]).toBe(RestrictionType.Daily);
    expect(LEGACY_RESTRICTION_TYPE_KEY in value).toBe(false);
  });

  test("the database transformer stores the stored form, and reads either", () => {
    const transformer: {
      to: (value: unknown) => unknown;
      from: (value: unknown) => unknown;
    } = RestrictionTimes.getDatabaseTransformer() as unknown as {
      to: (value: unknown) => unknown;
      from: (value: unknown) => unknown;
    };

    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.addDefaultWeeklyRestriction();

    expect(transformer.to(restrictionTimes)).toEqual(
      restrictionTimes.toDatabaseJSON(),
    );

    for (const key of [RESTRICTION_TYPE_KEY, LEGACY_RESTRICTION_TYPE_KEY]) {
      const read: RestrictionTimes = transformer.from(
        restriction({ [key]: "Daily", dayRestrictionTimes: NIGHTS }),
      ) as RestrictionTimes;

      expect(read.restrictionType).toBe(RestrictionType.Daily);
    }
  });

  test("a round trip through what is sent out, or what is stored, keeps the type", () => {
    for (const type of [
      RestrictionType.None,
      RestrictionType.Daily,
      RestrictionType.Weekly,
    ]) {
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.restrictionType = type;

      expect(
        RestrictionTimes.fromJSON(restrictionTimes.toJSON()).restrictionType,
      ).toBe(type);
      expect(
        RestrictionTimes.fromJSON(restrictionTimes.toDatabaseJSON())
          .restrictionType,
      ).toBe(type);
    }
  });
});

describe("what a write may hold (fromWrittenJSON)", () => {
  test("REGRESSION #11269: the issue's payload, with restrictionType, is None", () => {
    const written: RestrictionTimes =
      RestrictionTimes.fromWrittenJSON(ISSUE_PAYLOAD);

    expect(written.restrictionType).toBe(RestrictionType.None);
    expect(valueOf(written.toDatabaseJSON())[RESTRICTION_TYPE_KEY]).toBe(
      RestrictionType.None,
    );
  });

  test("each spelling alone, and both alike, are taken", () => {
    for (const value of [
      { restrictionType: "Daily", dayRestrictionTimes: NIGHTS },
      { restictionType: "Daily", dayRestrictionTimes: NIGHTS },
      {
        restrictionType: "Daily",
        restictionType: "Daily",
        dayRestrictionTimes: NIGHTS,
      },
    ] as Array<JSONObject>) {
      expect(
        RestrictionTimes.fromWrittenJSON(restriction(value)).restrictionType,
      ).toBe(RestrictionType.Daily);
    }
  });

  test("no type: refused, naming the key and the types", () => {
    const message: string = refusal(() => {
      return RestrictionTimes.fromWrittenJSON(
        restriction({ dayRestrictionTimes: NIGHTS }),
      );
    });

    expect(message).toContain(
      "restrictionTimes.value.restrictionType is missing",
    );
    expect(message).toContain(
      "None (on call around the clock), Daily or Weekly",
    );
  });

  test("no type, with the type under another key: that key is named", () => {
    const message: string = refusal(() => {
      return RestrictionTimes.fromWrittenJSON(
        restriction({
          restriction_type: "Daily",
          dayRestrictionTimes: NIGHTS,
        }),
      );
    });

    expect(message).toContain(
      '"restriction_type" is not a key OneUptime reads',
    );
    expect(message).toContain(
      "restrictionType, dayRestrictionTimes and weeklyRestrictionTimes",
    );
  });

  test("a type the engine does not know, under either spelling: refused", () => {
    for (const key of [RESTRICTION_TYPE_KEY, LEGACY_RESTRICTION_TYPE_KEY]) {
      const message: string = refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({ [key]: "daily", dayRestrictionTimes: NIGHTS }),
        );
      });

      expect(message).toContain(
        `restrictionTimes.value.${key} is "daily", which is not a restriction type`,
      );
    }
  });

  test("the two spellings naming different types: refused on a create", () => {
    const message: string = refusal(() => {
      return RestrictionTimes.fromWrittenJSON(
        restriction({
          restrictionType: "Daily",
          restictionType: "None",
          dayRestrictionTimes: NIGHTS,
        }),
      );
    });

    expect(message).toContain(
      'restrictionType is "Daily" and restictionType is "None"',
    );
    expect(message).toContain("Send restrictionType alone");
  });

  test("on an update, the spelling that differs from the type now is the change", () => {
    // A client that read the layer (both "None") and changed restrictionType.
    expect(
      RestrictionTimes.fromWrittenJSON(
        restriction({
          restrictionType: "Daily",
          restictionType: "None",
          dayRestrictionTimes: NIGHTS,
        }),
        { currentType: RestrictionType.None },
      ).restrictionType,
    ).toBe(RestrictionType.Daily);

    // A client written against the older spelling, which changed that one.
    expect(
      RestrictionTimes.fromWrittenJSON(
        restriction({
          restrictionType: "None",
          restictionType: "Daily",
          dayRestrictionTimes: NIGHTS,
        }),
        { currentType: RestrictionType.None },
      ).restrictionType,
    ).toBe(RestrictionType.Daily);

    // Neither is the type now: nobody can say which was meant.
    refusal(() => {
      return RestrictionTimes.fromWrittenJSON(
        restriction({
          restrictionType: "Daily",
          restictionType: "Weekly",
          dayRestrictionTimes: NIGHTS,
          weeklyRestrictionTimes: [MONDAY_OFFICE_HOURS],
        }),
        { currentType: RestrictionType.None },
      );
    });
  });

  test("not a restriction at all: refused with its shape", () => {
    for (const json of [
      null,
      "None",
      [],
      { _type: "Recurring", value: {} },
      { _type: ObjectType.RestrictionTimes },
      { _type: ObjectType.RestrictionTimes, value: "None" },
    ]) {
      const message: string = refusal(() => {
        return RestrictionTimes.fromWrittenJSON(json);
      });

      expect(message).toContain("restrictionTimes");
    }
  });

  test("Daily needs its window, with dates and times", () => {
    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({ restrictionType: "Daily" }),
        );
      }),
    ).toContain(
      "A Daily restriction needs restrictionTimes.value.dayRestrictionTimes",
    );

    // The "09:00" an example in the API reference used to show.
    const message: string = refusal(() => {
      return RestrictionTimes.fromWrittenJSON(
        restriction({
          restrictionType: "Daily",
          dayRestrictionTimes: { startTime: "09:00", endTime: "17:00" },
        }),
      );
    });

    expect(message).toContain(
      'restrictionTimes.value.dayRestrictionTimes.startTime is "09:00", which is not a date and time',
    );
    expect(message).toContain(
      '{"_type": "DateTime", "value": "2026-01-05T09:00:00Z"}',
    );

    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({
            restrictionType: "Daily",
            dayRestrictionTimes: { startTime: NIGHTS["startTime"] },
          }),
        );
      }),
    ).toContain("dayRestrictionTimes.endTime is missing");
  });

  test("Daily: a window open for no time is refused, as before", () => {
    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({
            restrictionType: "Daily",
            dayRestrictionTimes: {
              startTime: dateTime("2026-01-05T09:00:00.000Z"),
              endTime: dateTime("2026-01-05T09:00:00.000Z"),
            },
          }),
        );
      }),
    ).toContain("'From' and 'To' times cannot be the same");
  });

  test("Daily: moments as text alone, or as dates, are taken", () => {
    for (const day of [
      { startTime: "2026-01-05T16:00:00Z", endTime: "2026-01-06T06:00:00Z" },
      {
        startTime: new Date("2026-01-05T16:00:00Z"),
        endTime: new Date("2026-01-06T06:00:00Z"),
      },
    ] as Array<JSONObject>) {
      expect(
        RestrictionTimes.fromWrittenJSON(
          restriction({ restrictionType: "Daily", dayRestrictionTimes: day }),
        ).restrictionType,
      ).toBe(RestrictionType.Daily);
    }
  });

  test("Weekly needs its list of windows, each with dates and times, each open for some time", () => {
    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({ restrictionType: "Weekly" }),
        );
      }),
    ).toContain(
      "A Weekly restriction needs restrictionTimes.value.weeklyRestrictionTimes",
    );

    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({
            restrictionType: "Weekly",
            weeklyRestrictionTimes: ["Monday"],
          }),
        );
      }),
    ).toContain("weeklyRestrictionTimes[0] must be a window");

    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({
            restrictionType: "Weekly",
            weeklyRestrictionTimes: [
              MONDAY_OFFICE_HOURS,
              { ...MONDAY_OFFICE_HOURS, endTime: "17:00" },
            ],
          }),
        );
      }),
    ).toContain(
      'weeklyRestrictionTimes[1].endTime is "17:00", which is not a date and time',
    );

    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(
          restriction({
            restrictionType: "Weekly",
            weeklyRestrictionTimes: [
              {
                ...MONDAY_OFFICE_HOURS,
                endTime: MONDAY_OFFICE_HOURS["startTime"],
              },
            ],
          }),
        );
      }),
    ).toContain("opens and closes at the same moment of the week");
  });

  test("Weekly with no windows restricts nothing, as the dashboard can save it", () => {
    expect(
      RestrictionTimes.fromWrittenJSON(
        restriction({ restrictionType: "Weekly", weeklyRestrictionTimes: [] }),
      ).restrictionType,
    ).toBe(RestrictionType.Weekly);
  });

  test("None reads nothing else: windows left from another type are no matter", () => {
    expect(
      RestrictionTimes.fromWrittenJSON(
        restriction({
          restrictionType: "None",
          dayRestrictionTimes: { startTime: "09:00" },
          weeklyRestrictionTimes: "garbage",
        }),
      ).restrictionType,
    ).toBe(RestrictionType.None);
  });

  test("an instance is checked the same way", () => {
    const daily: RestrictionTimes = new RestrictionTimes();
    daily.addDefaultDailyRestriction();
    expect(RestrictionTimes.fromWrittenJSON(daily)).toBe(daily);

    const typeless: RestrictionTimes = new RestrictionTimes();
    typeless.restrictionType = undefined as unknown as RestrictionType;
    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(typeless);
      }),
    ).toContain("has no restriction type");

    const windowless: RestrictionTimes = new RestrictionTimes();
    windowless.restrictionType = RestrictionType.Daily;
    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(windowless);
      }),
    ).toContain("A Daily restriction needs");
  });

  test("the field's name in a refusal can be another's", () => {
    expect(
      refusal(() => {
        return RestrictionTimes.fromWrittenJSON(restriction({}), {
          fieldName: "workingHours",
        });
      }),
    ).toContain("workingHours.value.restrictionType is missing");
  });
});

describe("REGRESSION #11269: the engine pages a layer written with restrictionType", () => {
  const layerUtil: LayerUtil = new LayerUtil();

  function eventsOf(restrictionTimes: JSONObject): Array<CalendarEvent> {
    return layerUtil.getEvents({
      users: [user("alice"), user("bob")],
      startDateTimeOfLayer: tzInstant("2026-11-23 08:00", WARSAW),
      handOffTime: tzInstant("2026-11-30 08:00", WARSAW),
      rotation: rotation(EventInterval.Week, 1),
      restrictionTimes: RestrictionTimes.fromJSON(restrictionTimes),
      timezone: WARSAW,
      calendarStartDate: tzInstant("2026-11-26 00:00", WARSAW),
      calendarEndDate: tzInstant("2026-11-28 00:00", WARSAW),
    });
  }

  test("the issue's payload is on call around the clock, as an omitted restriction is", () => {
    const events: Array<CalendarEvent> = eventsOf(ISSUE_PAYLOAD);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.title).toBe("alice");
    expect(events[0]!.start.getTime()).toBe(
      tzInstant("2026-11-26 00:00", WARSAW).getTime(),
    );
    expect(events[events.length - 1]!.end.getTime()).toBe(
      tzInstant("2026-11-28 00:00", WARSAW).getTime(),
    );
  });

  test("an overnight window written with restrictionType is on call every night", () => {
    const events: Array<CalendarEvent> = eventsOf(
      restriction({
        restrictionType: "Daily",
        dayRestrictionTimes: {
          startTime: dateTime(
            tzInstant("2026-01-05 17:00", WARSAW).toISOString(),
          ),
          endTime: dateTime(
            tzInstant("2026-01-05 07:00", WARSAW).toISOString(),
          ),
        },
        weeklyRestrictionTimes: [],
      }),
    );

    // Thursday night's two halves, Friday morning's, and Friday night's.
    expect(events.length).toBeGreaterThanOrEqual(3);
    const starts: Array<string> = events.map((event: CalendarEvent): string => {
      return hhmm(event.start, WARSAW);
    });
    expect(starts).toContain("17:00");
    expect(starts).toContain("00:00");
  });
});
