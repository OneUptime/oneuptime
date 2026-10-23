import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  INVESTIGATE_NOW,
  INVESTIGATE_NOW_FAILED,
  INVESTIGATION_WAITING_CLOCK_TICK_MS,
  INVESTIGATION_WAITING_COPY,
  INVESTIGATION_WAITING_STATUS,
  WaitingInvestigationState,
  formatWaitUntil,
  getInvestigationWaitingTitle,
  getWaitEndKind,
  parseWaitingInvestigation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationWaitingState";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";

/*
 * The AI Investigation card while an investigation rule makes OneUptime AI
 * wait (issue #5074): what it reads of the panel's payload, how it says the
 * time, and its words. React-free, read here without the card.
 */

describe("parseWaitingInvestigation", () => {
  test("reads the time, the wait and whether the reader may start it", () => {
    expect(
      parseWaitingInvestigation({
        waitUntil: "2026-10-20T10:40:00.000Z",
        waitMinutes: 10,
        canStartNow: true,
      }),
    ).toEqual({
      waitUntil: new Date("2026-10-20T10:40:00.000Z"),
      waitMinutes: 10,
      canStartNow: true,
    });
  });

  test("may start it only when the server says so in so many words", () => {
    for (const canStartNow of [false, undefined, "true", 1, null]) {
      expect(
        parseWaitingInvestigation({
          waitUntil: "2026-10-20T10:40:00.000Z",
          waitMinutes: 10,
          canStartNow,
        })?.canStartNow,
      ).toBe(false);
    }
  });

  test("a wait in parts of a minute reads as the whole minutes", () => {
    expect(
      parseWaitingInvestigation({
        waitUntil: "2026-10-20T10:40:00.000Z",
        waitMinutes: 10.7,
      })?.waitMinutes,
    ).toBe(10);
  });

  test.each([
    [undefined],
    [null],
    ["2026-10-20T10:40:00.000Z"],
    [[]],
    [{}],
    [{ waitMinutes: 10 }],
    [{ waitUntil: "not a time", waitMinutes: 10 }],
    [{ waitUntil: 12345, waitMinutes: 10 }],
    [{ waitUntil: "2026-10-20T10:40:00.000Z" }],
    [{ waitUntil: "2026-10-20T10:40:00.000Z", waitMinutes: 0 }],
    [{ waitUntil: "2026-10-20T10:40:00.000Z", waitMinutes: "10" }],
    [{ waitUntil: "2026-10-20T10:40:00.000Z", waitMinutes: Number.NaN }],
  ])(
    "%p - an older API replica, nothing waiting, or a malformed answer - is nothing",
    (value: unknown) => {
      expect(parseWaitingInvestigation(value)).toBeNull();
    },
  );
});

// The time as the reader's clock reads it: "10:42", or "10:42 AM".
function clockTime(date: Date): string {
  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

/*
 * When the wait ends, against the reader's calendar - their own time zone,
 * set here so every case reads the same wherever the suite runs.
 */
describe("getWaitEndKind and formatWaitUntil", () => {
  beforeEach(() => {
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  });

  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  test("today: the time alone", () => {
    // 10:00 and 10:10 in London (BST).
    const now: Date = new Date("2026-10-20T09:00:00.000Z");
    const later: Date = new Date("2026-10-20T09:10:00.000Z");

    expect(getWaitEndKind(later, now)).toBe("today");
    expect(formatWaitUntil(later, now)).toBe(clockTime(later));
  });

  test("past midnight: tomorrow, still the time alone - the heading says tomorrow", () => {
    // 23:50 on the 20th, then 00:05 on the 21st, in London.
    const now: Date = new Date("2026-10-20T22:50:00.000Z");
    const later: Date = new Date("2026-10-20T23:05:00.000Z");

    expect(getWaitEndKind(later, now)).toBe("tomorrow");
    expect(formatWaitUntil(later, now)).toBe(clockTime(later));
  });

  test("a rule's longest wait, a day, ends tomorrow", () => {
    const now: Date = new Date("2026-10-20T12:00:00.000Z");
    const aDayOn: Date = new Date(now.getTime() + 1440 * 60 * 1000);

    expect(getWaitEndKind(aDayOn, now)).toBe("tomorrow");
  });

  test("the reader's own time zone decides the day", () => {
    // 15:00, then 16:30, in London: the same afternoon.
    const now: Date = new Date("2026-10-20T14:00:00.000Z");
    const later: Date = new Date("2026-10-20T15:30:00.000Z");

    expect(getWaitEndKind(later, now)).toBe("today");

    // 23:00, then 00:30, in Tokyo: past midnight there.
    OneUptimeDate.setUserTimezone(Timezone.AsiaTokyo);
    expect(getWaitEndKind(later, now)).toBe("tomorrow");
  });

  test("a calendar day on, also across the night the clocks go back", () => {
    /*
     * London leaves summer time on 25 October 2026: that day is 25 hours
     * long. From 00:30 on the 25th, 23:20 the same evening is still today,
     * and 00:10 on the 26th is tomorrow.
     */
    const now: Date = new Date("2026-10-24T23:30:00.000Z");

    expect(getWaitEndKind(new Date("2026-10-25T23:20:00.000Z"), now)).toBe(
      "today",
    );
    expect(getWaitEndKind(new Date("2026-10-26T00:10:00.000Z"), now)).toBe(
      "tomorrow",
    );
  });

  test("further off than a rule can wait: the day with the time", () => {
    const now: Date = new Date("2026-10-20T12:00:00.000Z");
    const later: Date = new Date("2026-10-23T11:00:00.000Z");

    expect(getWaitEndKind(later, now)).toBe("later");
    expect(formatWaitUntil(later, now)).toBe(
      `${OneUptimeDate.getDateAsLocalDayMonthString(later)}, ${clockTime(later)}`,
    );
  });

  test("the same date a year apart is not today", () => {
    const now: Date = new Date("2026-10-20T12:00:00.000Z");
    const yearLater: Date = new Date("2027-10-20T12:05:00.000Z");

    expect(getWaitEndKind(yearLater, now)).toBe("later");
    expect(formatWaitUntil(yearLater, now)).toContain(
      OneUptimeDate.getDateAsLocalDayMonthString(yearLater),
    );
  });

  test("a time come - at the very moment, or gone by - has ended", () => {
    const now: Date = new Date("2026-10-20T12:00:00.000Z");

    expect(getWaitEndKind(new Date(now.getTime() - 60 * 1000), now)).toBe(
      "ended",
    );
    expect(getWaitEndKind(new Date(now.getTime()), now)).toBe("ended");
    expect(getWaitEndKind(new Date(now.getTime() + 1000), now)).toBe("today");
  });
});

describe("the card's heading", () => {
  beforeEach(() => {
    OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  });

  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  const now: Date = new Date("2026-10-20T12:00:00.000Z");

  test.each([["incident" as const], ["alert" as const]])(
    "a %s's: at a time today",
    (subjectType: "incident" | "alert") => {
      const waitUntil: Date = new Date("2026-10-20T12:08:00.000Z");

      expect(
        getInvestigationWaitingTitle({ subjectType, waitUntil, now }),
      ).toEqual({
        template: INVESTIGATION_WAITING_COPY[subjectType].title,
        time: clockTime(waitUntil),
      });
    },
  );

  test.each([["incident" as const], ["alert" as const]])(
    "a %s's: tomorrow at a time, never at a date",
    (subjectType: "incident" | "alert") => {
      const waitUntil: Date = new Date("2026-10-21T11:00:00.000Z");

      expect(
        getInvestigationWaitingTitle({ subjectType, waitUntil, now }),
      ).toEqual({
        template: INVESTIGATION_WAITING_COPY[subjectType].titleTomorrow,
        time: clockTime(waitUntil),
      });
    },
  );

  test.each([["incident" as const], ["alert" as const]])(
    "a %s's: shortly once the time has come, naming no time gone by",
    (subjectType: "incident" | "alert") => {
      expect(
        getInvestigationWaitingTitle({
          subjectType,
          waitUntil: new Date(now.getTime() - 30 * 1000),
          now,
        }),
      ).toEqual({
        template: INVESTIGATION_WAITING_COPY[subjectType].titleSoon,
        time: "",
      });
    },
  );

  test("further off: at the day and the time", () => {
    const waitUntil: Date = new Date("2026-10-25T09:00:00.000Z");

    expect(
      getInvestigationWaitingTitle({
        subjectType: "incident",
        waitUntil,
        now,
      }),
    ).toEqual({
      template: INVESTIGATION_WAITING_COPY.incident.title,
      time: formatWaitUntil(waitUntil, now),
    });
  });

  test("reads the clock itself when not handed one", () => {
    expect(
      getInvestigationWaitingTitle({
        subjectType: "incident",
        waitUntil: new Date(Date.now() - 1000),
      }).template,
    ).toBe(INVESTIGATION_WAITING_COPY.incident.titleSoon);
  });

  test("the card reads the clock again often enough to turn on time", () => {
    expect(INVESTIGATION_WAITING_CLOCK_TICK_MS).toBeGreaterThan(0);
    expect(INVESTIGATION_WAITING_CLOCK_TICK_MS).toBeLessThanOrEqual(30 * 1000);
  });
});

describe("the card's words", () => {
  test("an incident's", () => {
    expect(INVESTIGATION_WAITING_COPY.incident).toEqual({
      title:
        "OneUptime AI investigates at {{time}} if this incident is still open",
      titleTomorrow:
        "OneUptime AI investigates tomorrow at {{time}} if this incident is still open",
      titleSoon:
        "OneUptime AI investigates shortly if this incident is still open",
      description: {
        one: "An AI rule makes OneUptime AI wait {{count}} minute, so incidents resolved by then are not investigated.",
        other:
          "An AI rule makes OneUptime AI wait {{count}} minutes, so incidents resolved by then are not investigated.",
      },
      whoCanStart:
        "Someone who can edit this incident can start the investigation now.",
    });
  });

  test("an alert's", () => {
    expect(INVESTIGATION_WAITING_COPY.alert.title).toBe(
      "OneUptime AI investigates at {{time}} if this alert is still open",
    );
    expect(INVESTIGATION_WAITING_COPY.alert.titleTomorrow).toBe(
      "OneUptime AI investigates tomorrow at {{time}} if this alert is still open",
    );
    expect(INVESTIGATION_WAITING_COPY.alert.titleSoon).toBe(
      "OneUptime AI investigates shortly if this alert is still open",
    );
    expect(INVESTIGATION_WAITING_COPY.alert.description.other).toContain(
      "so alerts resolved by then are not investigated.",
    );
    expect(INVESTIGATION_WAITING_COPY.alert.whoCanStart).toBe(
      "Someone who can edit this alert can start the investigation now.",
    );
  });

  test("the pill, the button and its failure", () => {
    expect(INVESTIGATION_WAITING_STATUS).toBe("Waiting");
    expect(INVESTIGATE_NOW).toBe("Investigate now");
    expect(INVESTIGATE_NOW_FAILED).toBe(
      "The investigation could not be started.",
    );
  });

  test("a state the card is handed has a time, a wait and an answer", () => {
    const state: WaitingInvestigationState = {
      waitUntil: new Date(),
      waitMinutes: 5,
      canStartNow: false,
    };

    expect(Object.keys(state).sort()).toEqual([
      "canStartNow",
      "waitMinutes",
      "waitUntil",
    ]);
  });
});
