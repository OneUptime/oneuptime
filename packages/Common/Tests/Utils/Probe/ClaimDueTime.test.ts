import { describe, expect, test } from "@jest/globals";
import {
  ClaimDue,
  ClaimDueState,
  readClaimDue,
  readDueTime,
} from "../../../Utils/Probe/ClaimDueTime";

/*
 * What a probe claim's due time promises (OneUptime issue #8042): a time to
 * show only when nothing stops the claim handing the row out. A row nothing
 * may take is set aside a quarter of an hour at a time
 * (Server/Utils/Probe/ClaimSetAside), so its due time is always a few
 * minutes away and never comes.
 */

const NOW: Date = new Date("2026-11-15T12:00:00.000Z");
const OVERDUE_AFTER_IN_MS: number = 15 * 60 * 1000;

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

function read(dueAt: unknown, stop: string | null = null): ClaimDue<string> {
  return readClaimDue<string>({
    stop: stop,
    dueAt: dueAt,
    now: NOW,
    overdueAfterInMs: OVERDUE_AFTER_IN_MS,
  });
}

describe("readDueTime: a due time as a row holds it", () => {
  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a string that is no date", "not a date"],
    ["an invalid Date", new Date("nope")],
  ])("%s is no due time", (_name: string, value: unknown) => {
    expect(readDueTime(value)).toBeNull();
  });

  test("a Date is itself", () => {
    const date: Date = minutesFromNow(5);

    expect(readDueTime(date)).toBe(date);
  });

  test("the string JSON brought is read as its instant", () => {
    expect(readDueTime("2026-11-15T12:05:00.000Z")?.getTime()).toBe(
      minutesFromNow(5).getTime(),
    );
  });

  test("a number of milliseconds is read as its instant", () => {
    expect(readDueTime(minutesFromNow(5).getTime())?.getTime()).toBe(
      minutesFromNow(5).getTime(),
    );
  });
});

describe("readClaimDue: the four answers", () => {
  test("due later, with nothing stopping it: Scheduled, at that time", () => {
    expect(read(minutesFromNow(17))).toEqual({
      state: ClaimDueState.Scheduled,
      dueAt: minutesFromNow(17),
      stop: null,
    });
  });

  test("a millisecond away is still later", () => {
    expect(read(new Date(NOW.getTime() + 1)).state).toBe(
      ClaimDueState.Scheduled,
    );
  });

  test("never given a time (never run): due now, with no time to show", () => {
    for (const dueAt of [null, undefined]) {
      expect(read(dueAt)).toEqual({
        state: ClaimDueState.DueNow,
        dueAt: null,
        stop: null,
      });
    }
  });

  test("due this instant: due now", () => {
    expect(read(NOW)).toEqual({
      state: ClaimDueState.DueNow,
      dueAt: NOW,
      stop: null,
    });
  });

  test("due a little while ago, inside the grace: due now", () => {
    expect(read(minutesFromNow(-5)).state).toBe(ClaimDueState.DueNow);
  });

  test("right at the grace: still due now", () => {
    expect(read(minutesFromNow(-15)).state).toBe(ClaimDueState.DueNow);
  });

  test("past the grace: overdue, since when it was due", () => {
    expect(read(minutesFromNow(-15.01))).toEqual({
      state: ClaimDueState.Overdue,
      dueAt: minutesFromNow(-15.01),
      stop: null,
    });
    expect(read(minutesFromNow(-24 * 60)).state).toBe(ClaimDueState.Overdue);
  });

  test.each([
    ["due later, as a set-aside makes it", minutesFromNow(17)],
    ["due now", NOW],
    ["overdue", minutesFromNow(-600)],
    ["never given a time", null],
  ])(
    "with something stopping it, %s is Stopped: no time at all",
    (_name: string, dueAt: Date | null) => {
      expect(read(dueAt, "Archived")).toEqual({
        state: ClaimDueState.Stopped,
        dueAt: null,
        stop: "Archived",
      });
    },
  );

  test("a stop that is undefined stops nothing", () => {
    expect(
      readClaimDue<string>({
        stop: undefined,
        dueAt: minutesFromNow(3),
        now: NOW,
        overdueAfterInMs: OVERDUE_AFTER_IN_MS,
      }).state,
    ).toBe(ClaimDueState.Scheduled);
  });

  test("a stop that is a falsy value of its own still stops it", () => {
    expect(
      readClaimDue<number>({
        stop: 0,
        dueAt: minutesFromNow(3),
        now: NOW,
        overdueAfterInMs: OVERDUE_AFTER_IN_MS,
      }),
    ).toEqual({ state: ClaimDueState.Stopped, dueAt: null, stop: 0 });
  });

  test("a due time JSON brought is read as a Date", () => {
    const due: ClaimDue<string> = read("2026-11-15T12:30:00.000Z");

    expect(due.state).toBe(ClaimDueState.Scheduled);
    expect(due.dueAt).toBeInstanceOf(Date);
    expect(due.dueAt?.getTime()).toBe(minutesFromNow(30).getTime());
  });

  test("a due time that is no date is treated as none: due now", () => {
    expect(read("garbage")).toEqual({
      state: ClaimDueState.DueNow,
      dueAt: null,
      stop: null,
    });
  });

  test("the grace is the caller's", () => {
    expect(
      readClaimDue<string>({
        stop: null,
        dueAt: minutesFromNow(-30),
        now: NOW,
        overdueAfterInMs: 60 * 60 * 1000,
      }).state,
    ).toBe(ClaimDueState.DueNow);
  });
});
