/** @timezone UTC */

import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsTimezone, {
  MicrosoftTeamsUserTimezone,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsTimezone";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";

/*
 * Issue #4111, the maintenance half. The "create maintenance" form in
 * Microsoft Teams submits Input.Date and Input.Time as a bare "2026-10-01"
 * and "14:00", with no zone. The old handler read them in the server's zone
 * (UTC in the containers), so 14:00 typed in New York became 10:00 in New
 * York. MicrosoftTeamsTimezone works out the zone the times were typed in,
 * reads the date and time in it, and names it back to the user.
 *
 * That zone is the one the form named, which the card carries in its submit
 * data: the form tells whoever fills it in which zone its times are in, and
 * in a channel that person may be somewhere else than the one who asked for
 * it. A form that named no zone is read in the submitting activity's
 * localTimezone, then its clientInfo entity's zone, then at the UTC offset of
 * its local timestamp, then in UTC. An offset is only today's, so when that
 * is all there is (isUtcOffsetOnly) the confirmation warns that a daylight
 * saving change could move the times.
 *
 * The docblock runs this file in UTC, the zone the containers run in.
 * MicrosoftTeamsTimezoneServerZone.test.ts runs the same arithmetic with the
 * server in Asia/Tokyo and expects the same instants.
 */

const NEW_YORK: MicrosoftTeamsUserTimezone = {
  timezone: "America/New_York",
  label: "America/New_York",
};
const KOLKATA: MicrosoftTeamsUserTimezone = {
  timezone: "Asia/Kolkata",
  label: "Asia/Kolkata",
};
const UTC_PLUS_05_30: MicrosoftTeamsUserTimezone = {
  utcOffsetInMinutes: 330,
  label: "UTC+05:30",
};
const UTC_MINUS_07_00: MicrosoftTeamsUserTimezone = {
  utcOffsetInMinutes: -420,
  label: "UTC-07:00",
};
// Spelled out, not MicrosoftTeamsTimezone.UTC: no expectation leans on the constant.
const UTC: MicrosoftTeamsUserTimezone = { timezone: "UTC", label: "UTC" };

// Values Teams, a client or a stale card could put where a zone name goes.
const NOT_A_KNOWN_ZONE: Array<JSONValue> = [
  "Eastern Standard Time",
  "India Standard Time",
  "Mars/Olympus_Mons",
  "",
  "   ",
  42,
  true,
  null,
  { timezone: "America/New_York" },
  ["America/New_York"],
];

function clientInfo(timezone: JSONValue): JSONObject {
  return {
    type: "clientInfo",
    locale: "en-US",
    country: "US",
    platform: "Web",
    timezone: timezone,
  };
}

/*
 * A message activity as botbuilder hands it to the bot: it has turned
 * localTimestamp into a Date and kept the string as rawLocalTimestamp.
 */
function webClientActivity(parts: JSONObject): JSONObject {
  return {
    type: "message",
    id: "1727712345678",
    channelId: "msteams",
    conversation: { id: "a:1pQ3dFxkGqKZ8Yv0cWm7bT2nR5sL9hJ4uE6oA" },
    ...parts,
  };
}

function toIso(
  date: string,
  time: string,
  timezone: MicrosoftTeamsUserTimezone,
): string | null {
  const instant: Date | null = MicrosoftTeamsTimezone.toDate({
    date: date,
    time: time,
    timezone: timezone,
  });

  return instant ? instant.toISOString() : null;
}

function format(iso: string, timezone: MicrosoftTeamsUserTimezone): string {
  return MicrosoftTeamsTimezone.format(new Date(iso), timezone);
}

describe("MicrosoftTeamsTimezone.getKnownTimezone", () => {
  test("returns an IANA zone name moment-timezone knows", () => {
    for (const name of [
      "America/New_York",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "Pacific/Chatham",
      "Europe/London",
      "UTC",
    ]) {
      expect(MicrosoftTeamsTimezone.getKnownTimezone(name)).toBe(name);
    }
  });

  test("trims the name", () => {
    expect(
      MicrosoftTeamsTimezone.getKnownTimezone("  America/New_York\t"),
    ).toBe("America/New_York");
  });

  test("ignores Windows zone names, unknown names, blanks and anything that is not a string", () => {
    for (const value of NOT_A_KNOWN_ZONE) {
      expect(MicrosoftTeamsTimezone.getKnownTimezone(value)).toBeUndefined();
    }

    expect(MicrosoftTeamsTimezone.getKnownTimezone(undefined)).toBeUndefined();
    expect(MicrosoftTeamsTimezone.getKnownTimezone(new Date())).toBeUndefined();
  });
});

describe("MicrosoftTeamsTimezone.getTimezoneFromActivity", () => {
  test("reads the activity's localTimezone first", () => {
    expect(
      MicrosoftTeamsTimezone.getTimezoneFromActivity(
        webClientActivity({
          localTimezone: "America/New_York",
          entities: [clientInfo("Europe/Berlin")],
        }),
      ),
    ).toBe("America/New_York");
  });

  test("falls back to the clientInfo entity when localTimezone is missing", () => {
    expect(
      MicrosoftTeamsTimezone.getTimezoneFromActivity(
        webClientActivity({
          entities: [
            { type: "mention", text: "<at>OneUptime</at>" },
            clientInfo("Asia/Kolkata"),
          ],
        }),
      ),
    ).toBe("Asia/Kolkata");
  });

  test("falls back to the clientInfo entity when localTimezone is not a zone it knows", () => {
    for (const value of NOT_A_KNOWN_ZONE) {
      expect(
        MicrosoftTeamsTimezone.getTimezoneFromActivity(
          webClientActivity({
            localTimezone: value,
            entities: [clientInfo("Asia/Kolkata")],
          }),
        ),
      ).toBe("Asia/Kolkata");
    }
  });

  test("takes the first clientInfo entity with a usable zone, and only clientInfo entities", () => {
    expect(
      MicrosoftTeamsTimezone.getTimezoneFromActivity(
        webClientActivity({
          entities: [
            null,
            { type: "mention", timezone: "Europe/Paris" },
            clientInfo("Pacific Standard Time"),
            { type: "clientInfo", locale: "en-US" },
            clientInfo("Asia/Tokyo"),
            clientInfo("Europe/Berlin"),
          ],
        }),
      ),
    ).toBe("Asia/Tokyo");
  });

  test("is undefined when the activity names no zone (iOS has been seen to send none)", () => {
    expect(
      MicrosoftTeamsTimezone.getTimezoneFromActivity(webClientActivity({})),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsTimezone.getTimezoneFromActivity(
        webClientActivity({
          localTimezone: "",
          entities: [clientInfo("")],
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("MicrosoftTeamsTimezone.getUtcOffsetFromActivity", () => {
  test("reads the offset of rawLocalTimestamp, the string botbuilder keeps", () => {
    const offsets: Array<{ timestamp: string; minutes: number }> = [
      { timestamp: "2026-10-01T14:00:00.000-04:00", minutes: -240 },
      { timestamp: "2026-10-01T14:00:00.000+05:30", minutes: 330 },
      { timestamp: "2026-10-01T14:00:00.000+05:45", minutes: 345 },
      { timestamp: "2026-10-01T14:00:00.000-03:30", minutes: -210 },
      { timestamp: "2026-10-01T14:00:00.000+14:00", minutes: 840 },
      { timestamp: "2026-10-01T14:00:00.000Z", minutes: 0 },
      // The seven fractional digits the Bot Framework sends.
      { timestamp: "2026-10-01T07:00:00.1015458-07:00", minutes: -420 },
      // The basic form of the offset, without a colon.
      { timestamp: "2026-10-01T14:00:00+0530", minutes: 330 },
      { timestamp: "  2026-10-01T14:00:00-04:00  ", minutes: -240 },
    ];

    for (const offset of offsets) {
      expect(
        MicrosoftTeamsTimezone.getUtcOffsetFromActivity(
          webClientActivity({ rawLocalTimestamp: offset.timestamp }),
        ),
      ).toBe(offset.minutes);
    }
  });

  test("prefers rawLocalTimestamp to a localTimestamp string", () => {
    expect(
      MicrosoftTeamsTimezone.getUtcOffsetFromActivity(
        webClientActivity({
          rawLocalTimestamp: "2026-10-01T23:00:00.000+09:00",
          localTimestamp: "2026-10-01T07:00:00.000-07:00",
        }),
      ),
    ).toBe(540);
  });

  test("reads a localTimestamp string when there is no usable rawLocalTimestamp", () => {
    expect(
      MicrosoftTeamsTimezone.getUtcOffsetFromActivity(
        webClientActivity({
          localTimestamp: "2026-10-01T07:00:00.000-07:00",
        }),
      ),
    ).toBe(-420);

    expect(
      MicrosoftTeamsTimezone.getUtcOffsetFromActivity(
        webClientActivity({
          rawLocalTimestamp: "not a timestamp+05:00",
          localTimestamp: "2026-10-01T07:00:00.000-07:00",
        }),
      ),
    ).toBe(-420);
  });

  test("ignores the Date botbuilder makes of localTimestamp: a Date has no offset", () => {
    expect(
      MicrosoftTeamsTimezone.getUtcOffsetFromActivity(
        webClientActivity({
          localTimestamp: new Date("2026-10-01T18:00:00.000Z"),
        }),
      ),
    ).toBeUndefined();
  });

  test("does not take a timestamp without an offset for UTC, and ignores what does not parse", () => {
    for (const timestamp of [
      "2026-10-01T14:00:00",
      "2026-10-01T14:00:00.000",
      "not a timestamp+05:00",
      "2026-13-01T14:00:00+05:00",
      "",
    ]) {
      expect(
        MicrosoftTeamsTimezone.getUtcOffsetFromActivity(
          webClientActivity({
            rawLocalTimestamp: timestamp,
            localTimestamp: timestamp,
          }),
        ),
      ).toBeUndefined();
    }

    expect(
      MicrosoftTeamsTimezone.getUtcOffsetFromActivity(
        webClientActivity({ rawLocalTimestamp: 1727791200000 }),
      ),
    ).toBeUndefined();
    expect(
      MicrosoftTeamsTimezone.getUtcOffsetFromActivity(webClientActivity({})),
    ).toBeUndefined();
  });
});

describe("MicrosoftTeamsTimezone.resolve", () => {
  /*
   * Every source names a different zone, so each test can tell which one
   * won. The sources are taken away one at a time.
   */
  const EVERY_SOURCE: JSONObject = webClientActivity({
    localTimezone: "America/New_York",
    entities: [clientInfo("Europe/Berlin")],
    rawLocalTimestamp: "2026-10-01T23:00:00.000+09:00",
    localTimestamp: "2026-10-01T07:00:00.000-07:00",
  });

  function without(...fields: Array<string>): JSONObject {
    const activity: JSONObject = { ...EVERY_SOURCE };

    for (const field of fields) {
      delete activity[field];
    }

    return activity;
  }

  test("1. the zone the form named, carried in the card's submit data, comes before everything else", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: EVERY_SOURCE,
        timezoneFromCard: "Asia/Kolkata",
      }),
    ).toEqual({ timezone: "Asia/Kolkata", label: "Asia/Kolkata" });
  });

  test("2. then the activity's localTimezone", () => {
    expect(MicrosoftTeamsTimezone.resolve({ activity: EVERY_SOURCE })).toEqual({
      timezone: "America/New_York",
      label: "America/New_York",
    });
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: EVERY_SOURCE,
        timezoneFromCard: undefined,
      }),
    ).toEqual({ timezone: "America/New_York", label: "America/New_York" });
  });

  test("3. then the activity's clientInfo entity", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: without("localTimezone"),
      }),
    ).toEqual({ timezone: "Europe/Berlin", label: "Europe/Berlin" });
  });

  test("4. then the UTC offset of rawLocalTimestamp", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: without("localTimezone", "entities"),
      }),
    ).toEqual({ utcOffsetInMinutes: 540, label: "UTC+09:00" });
  });

  test("5. then the UTC offset of a localTimestamp string", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: without("localTimezone", "entities", "rawLocalTimestamp"),
      }),
    ).toEqual({ utcOffsetInMinutes: -420, label: "UTC-07:00" });
  });

  test("6. and UTC when nothing names a zone or an offset", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: without(
          "localTimezone",
          "entities",
          "rawLocalTimestamp",
          "localTimestamp",
        ),
      }),
    ).toEqual({ timezone: "UTC", label: "UTC" });

    expect(MicrosoftTeamsTimezone.resolve({ activity: {} })).toEqual(UTC);
  });

  test("a zone name it does not know is skipped wherever it appears", () => {
    for (const value of NOT_A_KNOWN_ZONE) {
      // On the card: the activity's localTimezone decides.
      expect(
        MicrosoftTeamsTimezone.resolve({
          activity: EVERY_SOURCE,
          timezoneFromCard: value,
        }),
      ).toEqual({ timezone: "America/New_York", label: "America/New_York" });

      // As localTimezone too: the clientInfo entity decides.
      expect(
        MicrosoftTeamsTimezone.resolve({
          activity: { ...EVERY_SOURCE, localTimezone: value },
          timezoneFromCard: value,
        }),
      ).toEqual({ timezone: "Europe/Berlin", label: "Europe/Berlin" });

      // In clientInfo as well: the local timestamp's offset decides.
      expect(
        MicrosoftTeamsTimezone.resolve({
          activity: {
            ...EVERY_SOURCE,
            localTimezone: value,
            entities: [clientInfo(value)],
          },
          timezoneFromCard: value,
        }),
      ).toEqual({ utcOffsetInMinutes: 540, label: "UTC+09:00" });
    }
  });

  /*
   * The form tells whoever fills it in that its times are in the zone it
   * names, so that is the zone they typed them in. In a channel the one who
   * submits it need not be the one it was sent for.
   */
  test("the zone the form named beats the submitter's own, wherever Teams says the submitter is", () => {
    // Sent for someone in New York; a colleague in Kolkata submitted it.
    const fromKolkata: Array<JSONObject> = [
      webClientActivity({ localTimezone: "Asia/Kolkata" }),
      webClientActivity({ entities: [clientInfo("Asia/Kolkata")] }),
      webClientActivity({
        rawLocalTimestamp: "2026-10-01T19:30:00.000+05:30",
      }),
      webClientActivity({ localTimestamp: "2026-10-01T19:30:00.000+05:30" }),
      webClientActivity({
        localTimezone: "Asia/Kolkata",
        entities: [clientInfo("Asia/Kolkata")],
        rawLocalTimestamp: "2026-10-01T19:30:00.000+05:30",
      }),
    ];

    for (const activity of fromKolkata) {
      expect(
        MicrosoftTeamsTimezone.resolve({
          activity: activity,
          timezoneFromCard: "America/New_York",
        }),
      ).toEqual({ timezone: "America/New_York", label: "America/New_York" });
    }
  });

  test("the card's zone covers a submit from a client that names no zone (iOS)", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          localTimestamp: new Date("2026-10-01T18:00:00.000Z"),
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
        timezoneFromCard: " America/New_York ",
      }),
    ).toEqual({ timezone: "America/New_York", label: "America/New_York" });
  });

  test("a Date-typed localTimestamp is not an offset: without anything else it is UTC", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          localTimestamp: new Date("2026-10-01T18:00:00.000Z"),
        }),
      }),
    ).toEqual(UTC);
  });

  test("a zero offset is named UTC", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000Z",
        }),
      }),
    ).toEqual({ utcOffsetInMinutes: 0, label: "UTC" });
  });

  test("the offsets it names are the ones toDate and format are given below", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000+05:30",
        }),
      }),
    ).toEqual(UTC_PLUS_05_30);
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000-07:00",
        }),
      }),
    ).toEqual(UTC_MINUS_07_00);
  });
});

/*
 * The maintenance confirmation adds a warning when only an offset is known:
 * the offset is the one the activity's local timestamp has today, so a date
 * past a daylight saving change can be an hour out.
 */
describe("MicrosoftTeamsTimezone.isUtcOffsetOnly", () => {
  test("is true when only a UTC offset is known", () => {
    expect(MicrosoftTeamsTimezone.isUtcOffsetOnly(UTC_PLUS_05_30)).toBe(true);
    expect(MicrosoftTeamsTimezone.isUtcOffsetOnly(UTC_MINUS_07_00)).toBe(true);
    // Still only an offset: London is UTC+00:00 in winter and UTC+01:00 in summer.
    expect(
      MicrosoftTeamsTimezone.isUtcOffsetOnly({
        utcOffsetInMinutes: 0,
        label: "UTC",
      }),
    ).toBe(true);
    // An empty name is no name: toDate reads the offset then.
    expect(
      MicrosoftTeamsTimezone.isUtcOffsetOnly({
        timezone: "",
        utcOffsetInMinutes: 330,
        label: "UTC+05:30",
      }),
    ).toBe(true);
  });

  test("is false when a zone name is known, with or without an offset beside it", () => {
    expect(MicrosoftTeamsTimezone.isUtcOffsetOnly(NEW_YORK)).toBe(false);
    expect(MicrosoftTeamsTimezone.isUtcOffsetOnly(KOLKATA)).toBe(false);
    expect(
      MicrosoftTeamsTimezone.isUtcOffsetOnly({
        timezone: "America/New_York",
        utcOffsetInMinutes: -240,
        label: "America/New_York",
      }),
    ).toBe(false);
    // What resolve falls back on is the UTC zone, which has no daylight saving time.
    expect(MicrosoftTeamsTimezone.isUtcOffsetOnly(UTC)).toBe(false);
    expect(
      MicrosoftTeamsTimezone.isUtcOffsetOnly(MicrosoftTeamsTimezone.UTC),
    ).toBe(false);
  });

  test("is false when neither a zone name nor an offset is known", () => {
    expect(MicrosoftTeamsTimezone.isUtcOffsetOnly({ label: "UTC" })).toBe(
      false,
    );
    expect(
      MicrosoftTeamsTimezone.isUtcOffsetOnly({
        timezone: undefined,
        utcOffsetInMinutes: undefined,
        label: "UTC",
      }),
    ).toBe(false);
  });

  test("is true for what resolve reads from a local timestamp, and only for that", () => {
    const submits: Array<{
      source: string;
      activity: JSONObject;
      timezoneFromCard?: string;
      isUtcOffsetOnly: boolean;
    }> = [
      {
        source: "the zone the form named",
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
        timezoneFromCard: "America/New_York",
        isUtcOffsetOnly: false,
      },
      {
        source: "localTimezone",
        activity: webClientActivity({
          localTimezone: "America/New_York",
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
        isUtcOffsetOnly: false,
      },
      {
        source: "clientInfo",
        activity: webClientActivity({
          entities: [clientInfo("America/New_York")],
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
        isUtcOffsetOnly: false,
      },
      {
        source: "rawLocalTimestamp",
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
        isUtcOffsetOnly: true,
      },
      {
        source: "a localTimestamp string",
        activity: webClientActivity({
          localTimestamp: "2026-10-01T14:00:00.000+05:30",
        }),
        isUtcOffsetOnly: true,
      },
      {
        source: "a zero offset",
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000Z",
        }),
        isUtcOffsetOnly: true,
      },
      {
        source: "nothing: UTC",
        activity: webClientActivity({
          localTimestamp: new Date("2026-10-01T18:00:00.000Z"),
        }),
        isUtcOffsetOnly: false,
      },
    ];

    // Compared as one list, so a failure names every source that changed.
    expect(
      submits.map(
        (submit: {
          source: string;
          activity: JSONObject;
          timezoneFromCard?: string;
        }) => {
          return {
            source: submit.source,
            isUtcOffsetOnly: MicrosoftTeamsTimezone.isUtcOffsetOnly(
              MicrosoftTeamsTimezone.resolve({
                activity: submit.activity,
                timezoneFromCard: submit.timezoneFromCard,
              }),
            ),
          };
        },
      ),
    ).toEqual(
      submits.map((submit: { source: string; isUtcOffsetOnly: boolean }) => {
        return {
          source: submit.source,
          isUtcOffsetOnly: submit.isUtcOffsetOnly,
        };
      }),
    );
  });

  test("why it is worth a warning: an offset read in October is an hour out for a date in New York's winter", () => {
    // A New York user on a client that names no zone, in October (EDT).
    const timezone: MicrosoftTeamsUserTimezone = MicrosoftTeamsTimezone.resolve(
      {
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
      },
    );

    expect(timezone).toEqual({ utcOffsetInMinutes: -240, label: "UTC-04:00" });
    expect(MicrosoftTeamsTimezone.isUtcOffsetOnly(timezone)).toBe(true);

    const startsAt: Date | null = MicrosoftTeamsTimezone.toDate({
      date: "2026-12-24",
      time: "23:15",
      timezone: timezone,
    });

    expect(startsAt?.toISOString()).toBe("2026-12-25T03:15:00.000Z");
    // The confirmation reads back what was typed, at the offset it was read at...
    expect(MicrosoftTeamsTimezone.format(startsAt!, timezone)).toBe(
      "Dec 24, 2026, 23:15 (UTC-04:00)",
    );
    // ...which New York's clocks, on EST by then, show an hour earlier.
    expect(MicrosoftTeamsTimezone.format(startsAt!, NEW_YORK)).toBe(
      "Dec 24, 2026, 22:15 (America/New_York)",
    );
  });
});

describe("MicrosoftTeamsTimezone.formatUtcOffset", () => {
  test("names an offset from UTC in hours and minutes", () => {
    expect(MicrosoftTeamsTimezone.formatUtcOffset(0)).toBe("UTC");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(330)).toBe("UTC+05:30");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(-420)).toBe("UTC-07:00");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(45)).toBe("UTC+00:45");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(-45)).toBe("UTC-00:45");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(-210)).toBe("UTC-03:30");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(345)).toBe("UTC+05:45");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(765)).toBe("UTC+12:45");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(840)).toBe("UTC+14:00");
    expect(MicrosoftTeamsTimezone.formatUtcOffset(-720)).toBe("UTC-12:00");
  });
});

describe("MicrosoftTeamsTimezone.toDate", () => {
  test("reads 14:00 in New York as 18:00 UTC in October (EDT) and 19:00 UTC in January (EST)", () => {
    expect(toIso("2026-10-01", "14:00", NEW_YORK)).toBe(
      "2026-10-01T18:00:00.000Z",
    );
    expect(toIso("2027-01-15", "14:00", NEW_YORK)).toBe(
      "2027-01-15T19:00:00.000Z",
    );
  });

  test("reads the date and time in a zone with a half-hour offset", () => {
    expect(toIso("2026-10-01", "14:00", KOLKATA)).toBe(
      "2026-10-01T08:30:00.000Z",
    );
    // Before 05:30 in Kolkata it is still the day before in UTC.
    expect(toIso("2026-10-01", "02:00", KOLKATA)).toBe(
      "2026-09-30T20:30:00.000Z",
    );
  });

  test("reads the date and time as UTC in UTC", () => {
    expect(toIso("2026-10-01", "14:00", UTC)).toBe("2026-10-01T14:00:00.000Z");
    expect(
      toIso("2026-10-01", "14:00", { utcOffsetInMinutes: 0, label: "UTC" }),
    ).toBe("2026-10-01T14:00:00.000Z");
  });

  test("reads the date and time at a bare UTC offset", () => {
    expect(toIso("2026-10-01", "14:00", UTC_PLUS_05_30)).toBe(
      "2026-10-01T08:30:00.000Z",
    );
    expect(toIso("2026-10-01", "14:00", UTC_MINUS_07_00)).toBe(
      "2026-10-01T21:00:00.000Z",
    );
    // 20:00 at UTC-07:00 is already the next day in UTC.
    expect(toIso("2026-10-01", "20:00", UTC_MINUS_07_00)).toBe(
      "2026-10-02T03:00:00.000Z",
    );
  });

  test("a zone name comes before an offset when both are given", () => {
    expect(
      toIso("2026-10-01", "14:00", {
        timezone: "America/New_York",
        utcOffsetInMinutes: 330,
        label: "America/New_York",
      }),
    ).toBe("2026-10-01T18:00:00.000Z");
  });

  test("accepts seconds (HH:mm:ss)", () => {
    expect(toIso("2026-10-01", "14:00:30", NEW_YORK)).toBe(
      "2026-10-01T18:00:30.000Z",
    );
    expect(toIso("2026-10-01", "14:00:30", UTC_PLUS_05_30)).toBe(
      "2026-10-01T08:30:30.000Z",
    );
    expect(toIso("2026-10-01", "14:00:00", UTC)).toBe(
      "2026-10-01T14:00:00.000Z",
    );
  });

  test("trims the date and the time", () => {
    expect(toIso(" 2026-10-01 ", " 14:00 ", NEW_YORK)).toBe(
      "2026-10-01T18:00:00.000Z",
    );
    expect(toIso(" 2026-10-01 ", " 14:00 ", UTC_PLUS_05_30)).toBe(
      "2026-10-01T08:30:00.000Z",
    );
  });

  test("reads February 29 only in a leap year", () => {
    expect(toIso("2028-02-29", "14:00", NEW_YORK)).toBe(
      "2028-02-29T19:00:00.000Z",
    );
    expect(toIso("2026-02-29", "14:00", NEW_YORK)).toBeNull();
    expect(toIso("2026-02-29", "14:00", UTC_PLUS_05_30)).toBeNull();
  });

  test("is null for a date that is not a real YYYY-MM-DD date", () => {
    for (const date of [
      "2026-13-01",
      "2026-00-10",
      "2026-02-30",
      "2026-04-31",
      "2026-10-1",
      "26-10-01",
      "2026/10/01",
      "10/01/2026",
      "01-10-2026",
      "2026-10-01T14:00",
      "tomorrow",
      "",
    ]) {
      for (const timezone of [NEW_YORK, UTC_PLUS_05_30, UTC]) {
        expect(toIso(date, "14:00", timezone)).toBeNull();
      }
    }
  });

  test("is null for a time that is not a real HH:mm or HH:mm:ss time", () => {
    for (const time of [
      "25:00",
      "14:60",
      "14:00:60",
      "9:00",
      "14:5",
      "14",
      "2 PM",
      "14:00 PM",
      "14h00",
      "14:00Z",
      "14:00+02:00",
      "14:00:00.000",
      "",
    ]) {
      for (const timezone of [NEW_YORK, UTC_PLUS_05_30, UTC]) {
        expect(toIso("2026-10-01", time, timezone)).toBeNull();
      }
    }
  });

  /*
   * New York's clocks jump from 02:00 to 03:00 on March 8, 2026, and fall
   * back from 02:00 to 01:00 on November 1, 2026. A time in the gap does
   * not exist and a time in the overlap exists twice. Both are read the way
   * RFC 5545 reads them: a time in the gap with the offset from before the
   * gap (02:30 becomes 03:30 EDT), a repeated time as its first occurrence
   * (01:30 EDT).
   */
  test("a time skipped by the spring-forward gap is read with the offset from before the gap", () => {
    expect(toIso("2026-03-08", "01:59", NEW_YORK)).toBe(
      "2026-03-08T06:59:00.000Z",
    );
    expect(toIso("2026-03-08", "02:30", NEW_YORK)).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(toIso("2026-03-08", "03:00", NEW_YORK)).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    expect(toIso("2026-03-08", "03:30", NEW_YORK)).toBe(
      "2026-03-08T07:30:00.000Z",
    );
  });

  test("a time repeated by the fall-back overlap is read as its first occurrence", () => {
    expect(toIso("2026-11-01", "00:59", NEW_YORK)).toBe(
      "2026-11-01T04:59:00.000Z",
    );
    expect(toIso("2026-11-01", "01:30", NEW_YORK)).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(toIso("2026-11-01", "02:00", NEW_YORK)).toBe(
      "2026-11-01T07:00:00.000Z",
    );
  });
});

describe("MicrosoftTeamsTimezone.format", () => {
  test("shows the time on the user's clock with the zone's name", () => {
    expect(format("2026-10-01T18:00:00.000Z", NEW_YORK)).toBe(
      "Oct 1, 2026, 14:00 (America/New_York)",
    );
    expect(format("2027-01-15T19:00:00.000Z", NEW_YORK)).toBe(
      "Jan 15, 2027, 14:00 (America/New_York)",
    );
    expect(format("2026-10-01T08:30:00.000Z", KOLKATA)).toBe(
      "Oct 1, 2026, 14:00 (Asia/Kolkata)",
    );
    expect(format("2026-10-01T14:00:00.000Z", UTC)).toBe(
      "Oct 1, 2026, 14:00 (UTC)",
    );
  });

  test("shows the time at a bare offset with the offset's name", () => {
    expect(format("2026-10-01T08:30:00.000Z", UTC_PLUS_05_30)).toBe(
      "Oct 1, 2026, 14:00 (UTC+05:30)",
    );
    expect(format("2026-10-01T21:00:00.000Z", UTC_MINUS_07_00)).toBe(
      "Oct 1, 2026, 14:00 (UTC-07:00)",
    );
    expect(
      format("2026-10-01T14:00:00.000Z", {
        utcOffsetInMinutes: 0,
        label: "UTC",
      }),
    ).toBe("Oct 1, 2026, 14:00 (UTC)");
  });

  test("the day, month and year are the user's, not UTC's", () => {
    expect(format("2026-10-01T02:00:00.000Z", NEW_YORK)).toBe(
      "Sep 30, 2026, 22:00 (America/New_York)",
    );
    expect(format("2026-12-31T20:00:00.000Z", UTC_PLUS_05_30)).toBe(
      "Jan 1, 2027, 01:30 (UTC+05:30)",
    );
    expect(format("2026-10-01T03:00:00.000Z", UTC_MINUS_07_00)).toBe(
      "Sep 30, 2026, 20:00 (UTC-07:00)",
    );
  });

  test("uses a 24-hour clock and leaves the seconds out", () => {
    expect(format("2026-10-01T04:05:00.000Z", NEW_YORK)).toBe(
      "Oct 1, 2026, 00:05 (America/New_York)",
    );
    expect(format("2026-10-01T18:00:30.000Z", NEW_YORK)).toBe(
      "Oct 1, 2026, 14:00 (America/New_York)",
    );
  });

  test("echoes the time a spring-forward gap moved it to, so the user sees what was scheduled", () => {
    const startsAt: Date | null = MicrosoftTeamsTimezone.toDate({
      date: "2026-03-08",
      time: "02:30",
      timezone: NEW_YORK,
    });

    expect(startsAt).not.toBeNull();
    expect(MicrosoftTeamsTimezone.format(startsAt!, NEW_YORK)).toBe(
      "Mar 8, 2026, 03:30 (America/New_York)",
    );
  });

  test("gives back the date and time the user typed, in the zone the submit resolves to", () => {
    // MicrosoftTeamsTimezoneServerZone.test.ts expects this same table.
    const submits: Array<{
      activity: JSONObject;
      timezoneFromCard?: string;
      label: string;
      startsAt: string;
      isUtcOffsetOnly: boolean;
    }> = [
      {
        activity: webClientActivity({ localTimezone: "America/New_York" }),
        label: "America/New_York",
        startsAt: "2026-12-25T04:15:00.000Z",
        isUtcOffsetOnly: false,
      },
      {
        activity: webClientActivity({
          entities: [clientInfo("Australia/Adelaide")],
        }),
        label: "Australia/Adelaide",
        startsAt: "2026-12-24T12:45:00.000Z",
        isUtcOffsetOnly: false,
      },
      {
        // iOS: no zone on the submit, the one the form named.
        activity: webClientActivity({
          localTimestamp: new Date("2026-10-01T18:00:00.000Z"),
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
        timezoneFromCard: "America/New_York",
        label: "America/New_York",
        startsAt: "2026-12-25T04:15:00.000Z",
        isUtcOffsetOnly: false,
      },
      {
        // A channel: the form named New York; a colleague in Kolkata submitted it.
        activity: webClientActivity({
          localTimezone: "Asia/Kolkata",
          entities: [clientInfo("Asia/Kolkata")],
          rawLocalTimestamp: "2026-10-01T19:30:00.000+05:30",
        }),
        timezoneFromCard: "America/New_York",
        label: "America/New_York",
        startsAt: "2026-12-25T04:15:00.000Z",
        isUtcOffsetOnly: false,
      },
      {
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000+05:45",
        }),
        label: "UTC+05:45",
        startsAt: "2026-12-24T17:30:00.000Z",
        isUtcOffsetOnly: true,
      },
      {
        activity: webClientActivity({
          localTimestamp: "2026-10-01T14:00:00.000-03:30",
        }),
        label: "UTC-03:30",
        startsAt: "2026-12-25T02:45:00.000Z",
        isUtcOffsetOnly: true,
      },
      {
        activity: webClientActivity({}),
        label: "UTC",
        startsAt: "2026-12-24T23:15:00.000Z",
        isUtcOffsetOnly: false,
      },
    ];

    for (const submit of submits) {
      const timezone: MicrosoftTeamsUserTimezone =
        MicrosoftTeamsTimezone.resolve({
          activity: submit.activity,
          timezoneFromCard: submit.timezoneFromCard,
        });
      const startsAt: Date | null = MicrosoftTeamsTimezone.toDate({
        date: "2026-12-24",
        time: "23:15",
        timezone: timezone,
      });

      expect(timezone.label).toBe(submit.label);
      expect(startsAt?.toISOString()).toBe(submit.startsAt);
      expect(MicrosoftTeamsTimezone.format(startsAt!, timezone)).toBe(
        `Dec 24, 2026, 23:15 (${submit.label})`,
      );
      expect(MicrosoftTeamsTimezone.isUtcOffsetOnly(timezone)).toBe(
        submit.isUtcOffsetOnly,
      );
    }
  });
});

describe("MicrosoftTeamsTimezone against the read it replaced", () => {
  test("14:00 typed in New York is 14:00 in New York; the old read made it 10:00 on a UTC server", () => {
    /*
     * The old handler: OneUptimeDate.fromString(`${startDate}T${startTime}`),
     * which reads a date and time without a zone on the server's clock.
     */
    const oldRead: Date = OneUptimeDate.fromString("2026-10-01T14:00");

    expect(oldRead.toISOString()).toBe("2026-10-01T14:00:00.000Z");
    expect(MicrosoftTeamsTimezone.format(oldRead, NEW_YORK)).toBe(
      "Oct 1, 2026, 10:00 (America/New_York)",
    );

    const startsAt: Date | null = MicrosoftTeamsTimezone.toDate({
      date: "2026-10-01",
      time: "14:00",
      timezone: MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({ localTimezone: "America/New_York" }),
      }),
    });

    expect(startsAt?.toISOString()).toBe("2026-10-01T18:00:00.000Z");
    expect(MicrosoftTeamsTimezone.format(startsAt!, NEW_YORK)).toBe(
      "Oct 1, 2026, 14:00 (America/New_York)",
    );
  });
});
