import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_MAINTENANCE_DURATION_IN_MINUTES,
  MaintenanceWindow,
  getDefaultMaintenanceEnd,
  getDefaultMaintenanceWindow,
  getMaintenanceEndAfterStartMoved,
  getNextFullHour,
  isMaintenanceWindowInOrder,
  toMaintenanceDate,
} from "../../../Types/ScheduledMaintenance/MaintenanceWindow";

/*
 * A new scheduled maintenance event starts at the next full hour of the
 * reader's clock and lasts an hour; moving its start moves its end with it;
 * and it has to end after it starts. Every instant here is a fixed ISO
 * string and every zone an explicit IANA name, so the results do not depend
 * on the zone the test process runs in.
 */

function at(iso: string): Date {
  return new Date(iso);
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

describe("the next full hour", () => {
  test("is the start of the next hour on the reader's clock", () => {
    expect(iso(getNextFullHour(at("2026-10-03T09:20:00.000Z"), "UTC"))).toBe(
      "2026-10-03T10:00:00.000Z",
    );
  });

  test("is an hour away when it is exactly on the hour", () => {
    expect(iso(getNextFullHour(at("2026-10-03T10:00:00.000Z"), "UTC"))).toBe(
      "2026-10-03T11:00:00.000Z",
    );
  });

  test("is the next one a millisecond before the hour", () => {
    expect(iso(getNextFullHour(at("2026-10-03T10:59:59.999Z"), "UTC"))).toBe(
      "2026-10-03T11:00:00.000Z",
    );
  });

  test("rolls over midnight, and the end of a month and a year", () => {
    expect(iso(getNextFullHour(at("2026-12-31T23:30:00.000Z"), "UTC"))).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  test("is a full hour where the reader is, not in UTC: India is UTC+5:30", () => {
    // 10:20 in Kolkata. Its next full hour, 11:00 there, is 05:30 UTC.
    expect(
      iso(getNextFullHour(at("2026-10-03T04:50:00.000Z"), "Asia/Kolkata")),
    ).toBe("2026-10-03T05:30:00.000Z");
  });

  test("works with a quarter-hour offset: Nepal is UTC+5:45", () => {
    // 10:05 in Kathmandu; 11:00 there is 05:15 UTC.
    expect(
      iso(getNextFullHour(at("2026-10-03T04:20:00.000Z"), "Asia/Kathmandu")),
    ).toBe("2026-10-03T05:15:00.000Z");
  });

  test("works west of UTC with a half-hour offset: Newfoundland", () => {
    // 2026-10-03 is daylight time there (UTC-2:30): 06:50 UTC is 04:20.
    expect(
      iso(getNextFullHour(at("2026-10-03T06:50:00.000Z"), "America/St_Johns")),
    ).toBe("2026-10-03T07:30:00.000Z");
  });

  test("skips the hour a spring-forward removes", () => {
    // New York, 2026-03-08: 01:30 EST, and 02:00 does not exist; 03:00 EDT does.
    expect(
      iso(getNextFullHour(at("2026-03-08T06:30:00.000Z"), "America/New_York")),
    ).toBe("2026-03-08T07:00:00.000Z");
  });

  test("lands on the repeated hour a fall-back adds", () => {
    // New York, 2026-11-01: 01:30 EDT; the next full hour is 01:00 EST.
    expect(
      iso(getNextFullHour(at("2026-11-01T05:30:00.000Z"), "America/New_York")),
    ).toBe("2026-11-01T06:00:00.000Z");
  });

  test("is always in the future and never more than an hour away", () => {
    const zones: Array<string> = [
      "UTC",
      "Europe/Berlin",
      "Asia/Kolkata",
      "Asia/Kathmandu",
      "America/St_Johns",
      "Australia/Adelaide",
      "Pacific/Chatham",
    ];

    for (const zone of zones) {
      for (let minute: number = 0; minute < 24 * 60; minute += 7) {
        const now: Date = new Date(
          at("2026-10-03T00:00:00.000Z").getTime() + minute * 60 * 1000 + 123,
        );
        const next: Date = getNextFullHour(now, zone);
        const gap: number = next.getTime() - now.getTime();

        expect(`${zone} ${now.toISOString()}: ${gap > 0}`).toBe(
          `${zone} ${now.toISOString()}: true`,
        );
        expect(gap).toBeLessThanOrEqual(60 * 60 * 1000);
        expect(next.getUTCSeconds()).toBe(0);
        expect(next.getUTCMilliseconds()).toBe(0);
      }
    }
  });
});

describe("a new event's window", () => {
  test("lasts an hour", () => {
    expect(DEFAULT_MAINTENANCE_DURATION_IN_MINUTES).toBe(60);
    expect(iso(getDefaultMaintenanceEnd(at("2026-10-03T10:00:00.000Z")))).toBe(
      "2026-10-03T11:00:00.000Z",
    );
  });

  test("starts at the next full hour and ends an hour later", () => {
    const window: MaintenanceWindow = getDefaultMaintenanceWindow({
      now: at("2026-10-03T09:20:00.000Z"),
      timezone: "UTC",
    });

    expect(iso(window.startsAt)).toBe("2026-10-03T10:00:00.000Z");
    expect(iso(window.endsAt)).toBe("2026-10-03T11:00:00.000Z");
    expect(isMaintenanceWindowInOrder(window)).toBe(true);
  });

  test("is worked out in the reader's zone", () => {
    const window: MaintenanceWindow = getDefaultMaintenanceWindow({
      now: at("2026-10-03T04:50:00.000Z"),
      timezone: "Asia/Kolkata",
    });

    expect(iso(window.startsAt)).toBe("2026-10-03T05:30:00.000Z");
    expect(iso(window.endsAt)).toBe("2026-10-03T06:30:00.000Z");
  });
});

describe("reading a form's date", () => {
  test("takes a Date, the ISO string the date input writes, and a serialized date", () => {
    expect(iso(toMaintenanceDate(at("2026-10-03T10:00:00.000Z")))).toBe(
      "2026-10-03T10:00:00.000Z",
    );
    expect(iso(toMaintenanceDate("2026-10-03T10:00:00.000Z"))).toBe(
      "2026-10-03T10:00:00.000Z",
    );
    expect(
      iso(
        toMaintenanceDate({
          _type: "DateTime",
          value: "2026-10-03T10:00:00.000Z",
        }),
      ),
    ).toBe("2026-10-03T10:00:00.000Z");
  });

  test("reads anything that is not a real instant as nothing", () => {
    for (const value of [
      undefined,
      null,
      "",
      "not a date",
      42,
      true,
      new Date(Number.NaN),
      {},
    ]) {
      expect(toMaintenanceDate(value)).toBe(null);
    }
  });
});

describe("moving the start", () => {
  test("moves the end with it, keeping the window's length", () => {
    expect(
      iso(
        getMaintenanceEndAfterStartMoved({
          previousStartsAt: "2026-10-03T10:00:00.000Z",
          previousEndsAt: "2026-10-03T11:00:00.000Z",
          nextStartsAt: "2026-10-04T10:00:00.000Z",
        }),
      ),
    ).toBe("2026-10-04T11:00:00.000Z");
  });

  test("keeps a window the user lengthened", () => {
    expect(
      iso(
        getMaintenanceEndAfterStartMoved({
          previousStartsAt: "2026-10-03T10:00:00.000Z",
          previousEndsAt: "2026-10-03T13:30:00.000Z",
          nextStartsAt: "2026-10-03T22:00:00.000Z",
        }),
      ),
    ).toBe("2026-10-04T01:30:00.000Z");
  });

  test("moves it back too, when the start moves earlier", () => {
    expect(
      iso(
        getMaintenanceEndAfterStartMoved({
          previousStartsAt: at("2026-10-03T10:00:00.000Z"),
          previousEndsAt: at("2026-10-03T12:00:00.000Z"),
          nextStartsAt: "2026-10-03T08:15:00.000Z",
        }),
      ),
    ).toBe("2026-10-03T10:15:00.000Z");
  });

  test("leaves the end alone when the start did not move", () => {
    expect(
      getMaintenanceEndAfterStartMoved({
        previousStartsAt: "2026-10-03T10:00:00.000Z",
        previousEndsAt: "2026-10-03T11:00:00.000Z",
        nextStartsAt: at("2026-10-03T10:00:00.000Z"),
      }),
    ).toBe(null);
  });

  /*
   * A cleared date input writes "" (the browser hands back a value only once
   * the date is whole), and a form that never had a time holds nothing.
   */
  test("leaves the end alone while any of the times is missing or not a date", () => {
    const window: Record<string, unknown> = {
      previousStartsAt: "2026-10-03T10:00:00.000Z",
      previousEndsAt: "2026-10-03T11:00:00.000Z",
      nextStartsAt: "2026-10-04T10:00:00.000Z",
    };

    for (const key of Object.keys(window)) {
      for (const missing of [undefined, null, "", "not a date"]) {
        const data: Record<string, unknown> = { ...window, [key]: missing };

        expect(
          getMaintenanceEndAfterStartMoved(
            data as {
              previousStartsAt: unknown;
              previousEndsAt: unknown;
              nextStartsAt: unknown;
            },
          ),
        ).toBe(null);
      }
    }
  });

  test("leaves a window that was out of order for the form to call out", () => {
    for (const previousEndsAt of [
      "2026-10-03T10:00:00.000Z",
      "2026-10-03T09:00:00.000Z",
    ]) {
      expect(
        getMaintenanceEndAfterStartMoved({
          previousStartsAt: "2026-10-03T10:00:00.000Z",
          previousEndsAt: previousEndsAt,
          nextStartsAt: "2026-10-04T10:00:00.000Z",
        }),
      ).toBe(null);
    }
  });
});

describe("a window in order", () => {
  test("ends after it starts", () => {
    expect(
      isMaintenanceWindowInOrder({
        startsAt: "2026-10-03T10:00:00.000Z",
        endsAt: "2026-10-03T10:00:01.000Z",
      }),
    ).toBe(true);
  });

  test("is not one that ends when it starts, or before", () => {
    expect(
      isMaintenanceWindowInOrder({
        startsAt: "2026-10-03T10:00:00.000Z",
        endsAt: "2026-10-03T10:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      isMaintenanceWindowInOrder({
        startsAt: at("2026-10-03T10:00:00.000Z"),
        endsAt: "2026-10-03T09:00:00.000Z",
      }),
    ).toBe(false);
  });

  test("is not this check's business while a time is missing", () => {
    expect(
      isMaintenanceWindowInOrder({
        startsAt: "",
        endsAt: "2026-10-03T09:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      isMaintenanceWindowInOrder({
        startsAt: "2026-10-03T10:00:00.000Z",
        endsAt: undefined,
      }),
    ).toBe(true);
  });
});
