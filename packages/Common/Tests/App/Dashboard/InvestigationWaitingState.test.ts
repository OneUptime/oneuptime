import { describe, expect, test } from "@jest/globals";
import {
  INVESTIGATE_NOW,
  INVESTIGATE_NOW_FAILED,
  INVESTIGATION_WAITING_COPY,
  INVESTIGATION_WAITING_STATUS,
  WaitingInvestigationState,
  formatWaitUntil,
  parseWaitingInvestigation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationWaitingState";
import OneUptimeDate from "../../../Types/Date";

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

describe("formatWaitUntil", () => {
  test("today: the time alone, as the reader's clock reads it", () => {
    const now: Date = new Date();
    const later: Date = new Date(now.getTime() + 10 * 60 * 1000);

    // Unless the ten minutes cross midnight in the reader's time zone.
    if (
      OneUptimeDate.getDateAsLocalDayMonthString(later) ===
      OneUptimeDate.getDateAsLocalDayMonthString(now)
    ) {
      expect(formatWaitUntil(later, now)).toBe(
        OneUptimeDate.getLocalTimeString(later, {
          use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
        }),
      );
    }
  });

  test("another day: the day with the time", () => {
    const now: Date = new Date("2026-10-20T12:00:00.000Z");
    const tomorrow: Date = new Date("2026-10-21T11:00:00.000Z");
    const text: string = formatWaitUntil(tomorrow, now);

    expect(text).toBe(
      `${OneUptimeDate.getDateAsLocalDayMonthString(tomorrow)}, ${OneUptimeDate.getLocalTimeString(
        tomorrow,
        { use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat() },
      )}`,
    );
  });

  test("the same date a year apart is not today", () => {
    const now: Date = new Date("2026-10-20T12:00:00.000Z");
    const yearLater: Date = new Date("2027-10-20T12:05:00.000Z");

    expect(formatWaitUntil(yearLater, now)).toContain(
      OneUptimeDate.getDateAsLocalDayMonthString(yearLater),
    );
  });
});

describe("the card's words", () => {
  test("an incident's", () => {
    expect(INVESTIGATION_WAITING_COPY.incident).toEqual({
      title:
        "OneUptime AI investigates at {{time}} if this incident is still open",
      description: {
        one: "An investigation rule makes OneUptime AI wait {{count}} minute, so incidents resolved by then are not investigated.",
        other:
          "An investigation rule makes OneUptime AI wait {{count}} minutes, so incidents resolved by then are not investigated.",
      },
      whoCanStart:
        "Someone who can edit this incident can start the investigation now.",
    });
  });

  test("an alert's", () => {
    expect(INVESTIGATION_WAITING_COPY.alert.title).toBe(
      "OneUptime AI investigates at {{time}} if this alert is still open",
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
