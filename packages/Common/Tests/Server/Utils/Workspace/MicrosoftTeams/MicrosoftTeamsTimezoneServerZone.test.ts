/** @timezone Asia/Tokyo */

import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsTimezone, {
  MicrosoftTeamsUserTimezone,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsTimezone";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";

/*
 * Issue #4111, the maintenance half, on a server that does not run in UTC.
 *
 * The "create maintenance" form in Microsoft Teams submits Input.Date and
 * Input.Time as a bare "2026-10-01" and "14:00". The old handler read them
 * with OneUptimeDate.fromString(`${startDate}T${startTime}`), which reads a
 * date and time without a zone on the SERVER's clock: in the UTC containers
 * 14:00 typed in New York became 10:00 in New York, and on a self-hosted
 * server set to Tokyo it would have become 01:00. The instant depended on
 * where the server ran.
 *
 * MicrosoftTeamsTimezone reads them on a user's clock instead: in the zone
 * the form named, else in the submitter's own zone or at their UTC offset,
 * else in UTC. The docblock runs this file in Asia/Tokyo (UTC+09:00 all
 * year). The first test checks that it really does; the rest expect exactly
 * the instants and texts that MicrosoftTeamsTimezone.test.ts expects with the
 * process in UTC, and that the server's offset never passes for the user's
 * (which would also make a submit look offset-only, see isUtcOffsetOnly).
 */

const NEW_YORK: MicrosoftTeamsUserTimezone = {
  timezone: "America/New_York",
  label: "America/New_York",
};
const KOLKATA: MicrosoftTeamsUserTimezone = {
  timezone: "Asia/Kolkata",
  label: "Asia/Kolkata",
};
const TOKYO: MicrosoftTeamsUserTimezone = {
  timezone: "Asia/Tokyo",
  label: "Asia/Tokyo",
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
const UTC_BY_OFFSET: MicrosoftTeamsUserTimezone = {
  utcOffsetInMinutes: 0,
  label: "UTC",
};
// Neither a zone name nor an offset: what toDate and format fall back on.
const LABEL_ONLY: MicrosoftTeamsUserTimezone = { label: "UTC" };

function clientInfo(timezone: JSONValue): JSONObject {
  return {
    type: "clientInfo",
    locale: "en-US",
    country: "US",
    platform: "Web",
    timezone: timezone,
  };
}

function webClientActivity(parts: JSONObject): JSONObject {
  return {
    type: "message",
    id: "1727712345678",
    channelId: "msteams",
    conversation: { id: "a:1pQ3dFxkGqKZ8Yv0cWm7bT2nR5sL9hJ4uE6oA" },
    ...parts,
  };
}

interface TypedDateTime {
  date: string;
  time: string;
  timezone: MicrosoftTeamsUserTimezone;
}

// "2026-10-01 14:00 America/New_York", to name an entry in a failure.
function describeTyped(entry: TypedDateTime): string {
  return `${entry.date} ${entry.time} ${entry.timezone.label}`;
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

describe("this process runs in Asia/Tokyo", () => {
  test("a date and time without a zone are read on Tokyo's clock here, as the old handler read the form", () => {
    expect(new Date(2026, 9, 1, 14, 0).toISOString()).toBe(
      "2026-10-01T05:00:00.000Z",
    );
    // Tokyo keeps UTC+09:00 all year.
    expect(new Date(2027, 0, 15, 14, 0).toISOString()).toBe(
      "2027-01-15T05:00:00.000Z",
    );

    const oldRead: Date = OneUptimeDate.fromString("2026-10-01T14:00");

    expect(oldRead.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    // 14:00 typed in New York would have been scheduled for 01:00 there.
    expect(MicrosoftTeamsTimezone.format(oldRead, NEW_YORK)).toBe(
      "Oct 1, 2026, 01:00 (America/New_York)",
    );
  });
});

describe("MicrosoftTeamsTimezone.toDate with the server in Asia/Tokyo", () => {
  test("reads each date and time at the instant it reads them at with the server in UTC", () => {
    const typed: Array<TypedDateTime & { instant: string }> = [
      // EDT, then EST.
      {
        date: "2026-10-01",
        time: "14:00",
        timezone: NEW_YORK,
        instant: "2026-10-01T18:00:00.000Z",
      },
      {
        date: "2027-01-15",
        time: "14:00",
        timezone: NEW_YORK,
        instant: "2027-01-15T19:00:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00",
        timezone: KOLKATA,
        instant: "2026-10-01T08:30:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "02:00",
        timezone: KOLKATA,
        instant: "2026-09-30T20:30:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00",
        timezone: TOKYO,
        instant: "2026-10-01T05:00:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00",
        timezone: UTC,
        instant: "2026-10-01T14:00:00.000Z",
      },
      // On Tokyo's clock 00:30 would still be September 30 in UTC.
      {
        date: "2026-10-01",
        time: "00:30",
        timezone: UTC,
        instant: "2026-10-01T00:30:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00",
        timezone: UTC_BY_OFFSET,
        instant: "2026-10-01T14:00:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00",
        timezone: UTC_PLUS_05_30,
        instant: "2026-10-01T08:30:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00",
        timezone: UTC_MINUS_07_00,
        instant: "2026-10-01T21:00:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "20:00",
        timezone: UTC_MINUS_07_00,
        instant: "2026-10-02T03:00:00.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00:30",
        timezone: NEW_YORK,
        instant: "2026-10-01T18:00:30.000Z",
      },
      {
        date: "2026-10-01",
        time: "14:00:30",
        timezone: UTC_PLUS_05_30,
        instant: "2026-10-01T08:30:30.000Z",
      },
      {
        date: "2028-02-29",
        time: "14:00",
        timezone: NEW_YORK,
        instant: "2028-02-29T19:00:00.000Z",
      },
      // New York's spring-forward gap: 02:30 does not exist and reads as 03:30 EDT.
      {
        date: "2026-03-08",
        time: "02:30",
        timezone: NEW_YORK,
        instant: "2026-03-08T07:30:00.000Z",
      },
      {
        date: "2026-03-08",
        time: "03:00",
        timezone: NEW_YORK,
        instant: "2026-03-08T07:00:00.000Z",
      },
      // New York's fall-back overlap: 01:30 happens twice and reads as the first, EDT.
      {
        date: "2026-11-01",
        time: "01:30",
        timezone: NEW_YORK,
        instant: "2026-11-01T05:30:00.000Z",
      },
      {
        date: "2026-11-01",
        time: "02:00",
        timezone: NEW_YORK,
        instant: "2026-11-01T07:00:00.000Z",
      },
    ];

    // Compared as one list, so a failure names every date and time that moved.
    expect(
      typed.map((entry: TypedDateTime & { instant: string }) => {
        return {
          typed: describeTyped(entry),
          instant: toIso(entry.date, entry.time, entry.timezone),
        };
      }),
    ).toEqual(
      typed.map((entry: TypedDateTime & { instant: string }) => {
        return { typed: describeTyped(entry), instant: entry.instant };
      }),
    );
  });

  test("a zone with neither a name nor an offset is read as UTC, not on the server's clock", () => {
    expect(toIso("2026-10-01", "14:00", LABEL_ONLY)).toBe(
      "2026-10-01T14:00:00.000Z",
    );
    expect(toIso("2026-10-01", "00:30", LABEL_ONLY)).toBe(
      "2026-10-01T00:30:00.000Z",
    );
  });

  test("is still null for what is not a real date and time", () => {
    for (const [date, time] of [
      ["2026-02-30", "14:00"],
      ["2026-13-01", "14:00"],
      ["2026-10-01T14:00", "14:00"],
      ["2026-10-01", "25:00"],
      ["2026-10-01", "2 PM"],
      ["2026-10-01", "14:00+09:00"],
      ["", ""],
    ] as Array<[string, string]>) {
      for (const timezone of [NEW_YORK, UTC_PLUS_05_30, UTC, LABEL_ONLY]) {
        expect(toIso(date, time, timezone)).toBeNull();
      }
    }
  });
});

describe("MicrosoftTeamsTimezone.resolve with the server in Asia/Tokyo", () => {
  test("an activity that names no zone and carries no offset is UTC, not the server's zone", () => {
    expect(MicrosoftTeamsTimezone.resolve({ activity: {} })).toEqual(UTC);
    expect(
      MicrosoftTeamsTimezone.resolve({ activity: webClientActivity({}) }),
    ).toEqual(UTC);
  });

  test("the Date botbuilder makes of localTimestamp is not read as the server's offset", () => {
    const localTimestamp: Date = new Date("2026-10-01T05:00:00.000Z");

    // On this server the Date reads as UTC+09:00, and that is not the user's.
    expect(localTimestamp.getTimezoneOffset()).toBe(-540);

    const activity: JSONObject = webClientActivity({
      localTimestamp: localTimestamp,
    });

    expect(
      MicrosoftTeamsTimezone.getUtcOffsetFromActivity(activity),
    ).toBeUndefined();
    expect(MicrosoftTeamsTimezone.resolve({ activity: activity })).toEqual(UTC);
  });

  test("a local timestamp without an offset is not read as the server's offset", () => {
    for (const timestamp of [
      "2026-10-01T14:00:00",
      "2026-10-01T14:00:00.000",
    ]) {
      const activity: JSONObject = webClientActivity({
        rawLocalTimestamp: timestamp,
        localTimestamp: timestamp,
      });

      expect(
        MicrosoftTeamsTimezone.getUtcOffsetFromActivity(activity),
      ).toBeUndefined();
      expect(MicrosoftTeamsTimezone.resolve({ activity: activity })).toEqual(
        UTC,
      );
    }
  });

  test("takes the offset the activity's own timestamp carries", () => {
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
      }),
    ).toEqual({ utcOffsetInMinutes: -240, label: "UTC-04:00" });
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          localTimestamp: "2026-10-01T14:00:00.000+05:30",
        }),
      }),
    ).toEqual(UTC_PLUS_05_30);
    expect(
      MicrosoftTeamsTimezone.resolve({
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000Z",
        }),
      }),
    ).toEqual(UTC_BY_OFFSET);
  });

  test("keeps its order: the card's zone, localTimezone, clientInfo, rawLocalTimestamp, localTimestamp, UTC", () => {
    // No offset here is the server's +09:00, so the server's cannot pass for one.
    const everySource: JSONObject = webClientActivity({
      localTimezone: "America/New_York",
      entities: [clientInfo("Europe/Berlin")],
      rawLocalTimestamp: "2026-10-01T19:45:00.000+05:45",
      localTimestamp: "2026-10-01T07:00:00.000-07:00",
    });

    function without(...fields: Array<string>): JSONObject {
      const activity: JSONObject = { ...everySource };

      for (const field of fields) {
        delete activity[field];
      }

      return activity;
    }

    expect(
      [
        { activity: everySource, timezoneFromCard: "Asia/Kolkata" },
        { activity: everySource },
        { activity: without("localTimezone") },
        { activity: without("localTimezone", "entities") },
        { activity: without("localTimezone", "entities", "rawLocalTimestamp") },
        {
          activity: without(
            "localTimezone",
            "entities",
            "rawLocalTimestamp",
            "localTimestamp",
          ),
        },
        // Names it does not know are skipped, wherever they are.
        { activity: everySource, timezoneFromCard: "Tokyo Standard Time" },
        {
          activity: {
            ...everySource,
            localTimezone: "Tokyo Standard Time",
            entities: [clientInfo("")],
          },
          timezoneFromCard: 42,
        },
      ].map((submit: { activity: JSONObject; timezoneFromCard?: unknown }) => {
        return MicrosoftTeamsTimezone.resolve(submit);
      }),
    ).toEqual([
      KOLKATA,
      NEW_YORK,
      { timezone: "Europe/Berlin", label: "Europe/Berlin" },
      { utcOffsetInMinutes: 345, label: "UTC+05:45" },
      UTC_MINUS_07_00,
      UTC,
      NEW_YORK,
      { utcOffsetInMinutes: 345, label: "UTC+05:45" },
    ]);
  });

  test("a submit is offset-only when its own timestamp carries the offset, never because of the server's", () => {
    const submits: Array<{ activity: JSONObject; isUtcOffsetOnly: boolean }> = [
      // Nothing to go on: UTC, a zone, not Tokyo's +09:00.
      { activity: webClientActivity({}), isUtcOffsetOnly: false },
      {
        activity: webClientActivity({
          localTimestamp: new Date("2026-10-01T05:00:00.000Z"),
        }),
        isUtcOffsetOnly: false,
      },
      {
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00",
          localTimestamp: "2026-10-01T14:00:00.000",
        }),
        isUtcOffsetOnly: false,
      },
      {
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000-04:00",
        }),
        isUtcOffsetOnly: true,
      },
      {
        activity: webClientActivity({
          localTimestamp: "2026-10-01T14:00:00.000+05:30",
        }),
        isUtcOffsetOnly: true,
      },
      {
        activity: webClientActivity({
          rawLocalTimestamp: "2026-10-01T14:00:00.000Z",
        }),
        isUtcOffsetOnly: true,
      },
    ];

    expect(
      submits.map((submit: { activity: JSONObject }) => {
        return MicrosoftTeamsTimezone.isUtcOffsetOnly(
          MicrosoftTeamsTimezone.resolve({ activity: submit.activity }),
        );
      }),
    ).toEqual(
      submits.map((submit: { isUtcOffsetOnly: boolean }) => {
        return submit.isUtcOffsetOnly;
      }),
    );
  });
});

describe("MicrosoftTeamsTimezone.format with the server in Asia/Tokyo", () => {
  test("shows the time on the user's clock, not on the server's", () => {
    // Tokyo's clock says Oct 2, 03:00.
    expect(format("2026-10-01T18:00:00.000Z", NEW_YORK)).toBe(
      "Oct 1, 2026, 14:00 (America/New_York)",
    );
    // Tokyo's clock says Oct 1, 11:00.
    expect(format("2026-10-01T02:00:00.000Z", NEW_YORK)).toBe(
      "Sep 30, 2026, 22:00 (America/New_York)",
    );
    expect(format("2027-01-15T19:00:00.000Z", NEW_YORK)).toBe(
      "Jan 15, 2027, 14:00 (America/New_York)",
    );
    expect(format("2026-10-01T08:30:00.000Z", KOLKATA)).toBe(
      "Oct 1, 2026, 14:00 (Asia/Kolkata)",
    );
    expect(format("2026-10-01T05:00:00.000Z", TOKYO)).toBe(
      "Oct 1, 2026, 14:00 (Asia/Tokyo)",
    );
  });

  test("shows UTC as UTC, and an offset at that offset, whatever the server's zone", () => {
    // Tokyo's clock says 23:00 for each of the first three.
    expect(format("2026-10-01T14:00:00.000Z", UTC)).toBe(
      "Oct 1, 2026, 14:00 (UTC)",
    );
    expect(format("2026-10-01T14:00:00.000Z", UTC_BY_OFFSET)).toBe(
      "Oct 1, 2026, 14:00 (UTC)",
    );
    expect(format("2026-10-01T14:00:00.000Z", LABEL_ONLY)).toBe(
      "Oct 1, 2026, 14:00 (UTC)",
    );
    expect(format("2026-10-01T08:30:00.000Z", UTC_PLUS_05_30)).toBe(
      "Oct 1, 2026, 14:00 (UTC+05:30)",
    );
    expect(format("2026-10-01T21:00:00.000Z", UTC_MINUS_07_00)).toBe(
      "Oct 1, 2026, 14:00 (UTC-07:00)",
    );
    expect(format("2026-12-31T20:00:00.000Z", UTC_PLUS_05_30)).toBe(
      "Jan 1, 2027, 01:30 (UTC+05:30)",
    );
    // Tokyo's clock says Oct 1, 12:00; the user's is still on Sep 30.
    expect(format("2026-10-01T03:00:00.000Z", UTC_MINUS_07_00)).toBe(
      "Sep 30, 2026, 20:00 (UTC-07:00)",
    );
  });

  test("echoes the time a spring-forward gap moved it to", () => {
    expect(format(toIso("2026-03-08", "02:30", NEW_YORK) || "", NEW_YORK)).toBe(
      "Mar 8, 2026, 03:30 (America/New_York)",
    );
  });
});

describe("a maintenance submit with the server in Asia/Tokyo", () => {
  test("resolve, toDate and format give back what the user typed, at the instant they give it with the server in UTC", () => {
    // MicrosoftTeamsTimezone.test.ts expects this same table.
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
