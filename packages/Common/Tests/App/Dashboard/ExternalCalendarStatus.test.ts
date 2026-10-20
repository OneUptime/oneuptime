import { describe, expect, test } from "@jest/globals";
import {
  EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT,
  EXTERNAL_CALENDAR_READ_ERROR_TEXT,
  EXTERNAL_CALENDAR_REFRESH_INTERVAL_LABELS,
  ExternalCalendarHealth,
  getExternalCalendarHealth,
  getExternalCalendarKeptSummary,
  getRefreshIntervalOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ExternalCalendarStatus";
import ScheduledMaintenanceExternalCalendar from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import { Gray500, Green, Red, Yellow } from "../../../Types/BrandColors";
import {
  EXTERNAL_CALENDAR_MAX_EVENTS,
  EXTERNAL_CALENDAR_READ_ERRORS,
  EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES,
  ExternalCalendarLinkProblem,
  ExternalCalendarReadError,
} from "../../../Types/ScheduledMaintenance/ExternalCalendar";

/*
 * A calendar from outside the project as Calendar Settings shows it
 * (ExternalCalendarStatus): off, waiting for its first read, working, or
 * not working and why - a sentence that says what to do for each of the ten
 * reasons a read fails - what its last read kept, and the words for the
 * refresh choices and for a refused link.
 */

function calendar(
  overrides: Partial<ScheduledMaintenanceExternalCalendar> = {},
): ScheduledMaintenanceExternalCalendar {
  const model: ScheduledMaintenanceExternalCalendar =
    new ScheduledMaintenanceExternalCalendar();
  model.isEnabled = true;
  Object.assign(model, overrides);
  return model;
}

describe("how a calendar is doing", () => {
  test("a calendar never read yet is waiting for its first read", () => {
    const health: ExternalCalendarHealth =
      getExternalCalendarHealth(calendar());

    expect(health.key).toBe("waiting");
    expect(health.label).toBe("Waiting for the first read");
    expect(health.color).toBe(Yellow);
  });

  test("a calendar whose last read worked is working", () => {
    const health: ExternalCalendarHealth = getExternalCalendarHealth(
      calendar({ lastReadAt: new Date("2026-10-15T10:00:00.000Z") }),
    );

    expect(health.key).toBe("working");
    expect(health.label).toBe("Working");
    expect(health.color).toBe(Green);
  });

  test("a calendar whose last read failed is not working, with the reason, even if an older read worked", () => {
    const health: ExternalCalendarHealth = getExternalCalendarHealth(
      calendar({
        lastReadAt: new Date("2026-10-14T10:00:00.000Z"),
        lastReadError: ExternalCalendarReadError.ServerError,
        lastReadHttpStatus: 502,
      }),
    );

    expect(health.key).toBe("failing");
    expect(health.label).toBe("Not working");
    expect(health.color).toBe(Red);
    expect(health.tooltip).toBe(
      EXTERNAL_CALENDAR_READ_ERROR_TEXT[ExternalCalendarReadError.ServerError],
    );
    expect(health.tooltipValues).toEqual({ status: "502" });
  });

  test("a calendar turned off is off, whatever its reads did", () => {
    const health: ExternalCalendarHealth = getExternalCalendarHealth(
      calendar({
        isEnabled: false,
        lastReadError: ExternalCalendarReadError.Timeout,
      }),
    );

    expect(health.key).toBe("off");
    expect(health.label).toBe("Off");
    expect(health.color).toBe(Gray500);
  });

  test("a stored reason the Dashboard does not know reads as no reason", () => {
    expect(
      getExternalCalendarHealth(calendar({ lastReadError: "SomethingNew" }))
        .key,
    ).toBe("waiting");
  });

  test("every reason a read fails has a sentence, and only ServerError names a status", () => {
    for (const error of EXTERNAL_CALENDAR_READ_ERRORS) {
      const text: string = EXTERNAL_CALENDAR_READ_ERROR_TEXT[error];

      expect({ error, ends: text.endsWith(".") }).toEqual({
        error,
        ends: true,
      });
      expect({ error, status: text.includes("{{status}}") }).toEqual({
        error,
        status: error === ExternalCalendarReadError.ServerError,
      });
      // The link can be a secret: no sentence says what it was.
      expect(text).not.toContain("{{link}}");
    }
  });

  test("the size the TooLarge sentence names is the limit", () => {
    expect(
      EXTERNAL_CALENDAR_READ_ERROR_TEXT[ExternalCalendarReadError.TooLarge],
    ).toContain("5 MB");
  });
});

describe("what the last read kept", () => {
  test("nothing before the first read", () => {
    expect(getExternalCalendarKeptSummary(calendar())).toBeNull();
  });

  test("how many events, and whether the calendar holds more than are kept", () => {
    expect(
      getExternalCalendarKeptSummary(
        calendar({
          lastReadAt: new Date("2026-10-15T10:00:00.000Z"),
          eventCount: 24,
        }),
      ),
    ).toEqual({
      count: 24,
      hasMore: false,
      limit: EXTERNAL_CALENDAR_MAX_EVENTS,
    });

    expect(
      getExternalCalendarKeptSummary(
        calendar({
          lastReadAt: new Date("2026-10-15T10:00:00.000Z"),
          eventCount: 2000,
          hasMoreEvents: true,
        }),
      ),
    ).toEqual({ count: 2000, hasMore: true, limit: 2000 });
  });
});

describe("the words", () => {
  test("every refresh choice has its words, in the order offered", () => {
    expect(
      getRefreshIntervalOptions().map(
        (option: { label: string; value: number }) => {
          return option.value;
        },
      ),
    ).toEqual([...EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES]);

    for (const minutes of EXTERNAL_CALENDAR_REFRESH_INTERVALS_IN_MINUTES) {
      expect(EXTERNAL_CALENDAR_REFRESH_INTERVAL_LABELS[minutes]).toBeTruthy();
    }
  });

  test("every refused link has a sentence of its own", () => {
    const sentences: Array<string> = Object.values(
      ExternalCalendarLinkProblem,
    ).map((problem: ExternalCalendarLinkProblem) => {
      return EXTERNAL_CALENDAR_LINK_PROBLEM_TEXT[problem];
    });

    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of sentences) {
      expect(sentence).toMatch(/\.$/);
    }
  });
});
