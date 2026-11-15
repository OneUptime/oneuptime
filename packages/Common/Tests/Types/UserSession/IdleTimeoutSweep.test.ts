import {
  ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
  getIdleTimeoutSweepCutoff,
  IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES,
  MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  readReportsActivityWhileInUse,
  REPORTS_ACTIVITY_WHILE_IN_USE_FIELD,
  SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES,
} from "../../../Types/UserSession/SessionLength";
import { EVERY_FIVE_MINUTE } from "../../../Utils/CronTime";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN THE SWEEP MAY RECORD AN IDLE TIMEOUT (issue #8188).
 *
 * A browser that never came back had its idle timeout recorded only 30
 * days later, as "Not used for 30 days". The five-minute sweep now ends a
 * session past its idle timeout once no browser can still be using it: its
 * browser renews within ACTIVITY_REPORTED_WITHIN_IN_MINUTES of its person's
 * activity while they use OneUptime, and has been heard of by nobody for
 * the idle timeout and IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES since its last
 * activity. These are the rule's boundaries, and the promise it keeps:
 * nobody still working is signed out by it.
 */

const MINUTE: number = 60 * 1000;
const NOW: Date = new Date("2026-11-15T12:00:00.000Z");

// Whether the sweep at `now` ends a session last active at `lastActiveAt`, as its SQL and its write ask.
const isEndedBySweep: (data: {
  lastActiveAt: Date;
  idleTimeoutInMinutes: number;
  now: Date;
}) => boolean = (data: {
  lastActiveAt: Date;
  idleTimeoutInMinutes: number;
  now: Date;
}): boolean => {
  return (
    data.lastActiveAt.getTime() <=
    getIdleTimeoutSweepCutoff({
      idleTimeoutInMinutes: data.idleTimeoutInMinutes,
      now: data.now,
    }).getTime()
  );
};

describe("the cutoff", () => {
  test("is the idle timeout and the margin before now", () => {
    expect(
      getIdleTimeoutSweepCutoff({ idleTimeoutInMinutes: 30, now: NOW }),
    ).toEqual(new Date(NOW.getTime() - (30 + 30) * MINUTE));
    expect(
      getIdleTimeoutSweepCutoff({ idleTimeoutInMinutes: 8 * 60, now: NOW }),
    ).toEqual(new Date(NOW.getTime() - (8 * 60 + 30) * MINUTE));
  });

  test("just before the idle timeout, at it, and within the margin after it: the session is kept", () => {
    for (const minutesAgo of [29, 30, 31, 45, 59]) {
      expect({
        minutesAgo,
        isEnded: isEndedBySweep({
          lastActiveAt: new Date(NOW.getTime() - minutesAgo * MINUTE),
          idleTimeoutInMinutes: 30,
          now: NOW,
        }),
      }).toEqual({ minutesAgo, isEnded: false });
    }

    // A millisecond short of the cutoff.
    expect(
      isEndedBySweep({
        lastActiveAt: new Date(NOW.getTime() - 60 * MINUTE + 1),
        idleTimeoutInMinutes: 30,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("at the cutoff and after it: the session is ended", () => {
    for (const minutesAgo of [60, 61, 120, 24 * 60]) {
      expect({
        minutesAgo,
        isEnded: isEndedBySweep({
          lastActiveAt: new Date(NOW.getTime() - minutesAgo * MINUTE),
          idleTimeoutInMinutes: 30,
          now: NOW,
        }),
      }).toEqual({ minutesAgo, isEnded: true });
    }
  });
});

describe("the promise the margin keeps", () => {
  /*
   * Someone still within their idle timeout - last active less than it ago
   * - has been heard of at most ACTIVITY_REPORTED_WITHIN_IN_MINUTES before
   * their last activity (Common/UI/Utils/UserActivity). Whatever the idle
   * timeout a master admin picks, the sweep never ends their session.
   */
  test("nobody within their idle timeout is signed out by the sweep, however late their last report", () => {
    const idleTimeouts: Array<number> = [
      MIN_SESSION_IDLE_TIMEOUT_IN_MINUTES,
      ...SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES,
    ];

    for (const idleTimeoutInMinutes of idleTimeouts) {
      // Last active just inside the idle timeout, and heard of as late as the browser may be.
      for (const activeMinutesAgo of [0, 1, idleTimeoutInMinutes - 0.01]) {
        for (const reportLagMinutes of [
          0,
          ACTIVITY_REPORTED_WITHIN_IN_MINUTES / 2,
          ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
        ]) {
          const heardOfAt: Date = new Date(
            NOW.getTime() - (activeMinutesAgo + reportLagMinutes) * MINUTE,
          );

          expect({
            idleTimeoutInMinutes,
            activeMinutesAgo,
            reportLagMinutes,
            isEnded: isEndedBySweep({
              lastActiveAt: heardOfAt,
              idleTimeoutInMinutes,
              now: NOW,
            }),
          }).toEqual({
            idleTimeoutInMinutes,
            activeMinutesAgo,
            reportLagMinutes,
            isEnded: false,
          });
        }
      }
    }
  });

  test("the margin outlasts the browser's interval six times over, for renewals that fail and clocks a little apart", () => {
    expect(ACTIVITY_REPORTED_WITHIN_IN_MINUTES).toBe(5);
    expect(IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES).toBe(
      6 * ACTIVITY_REPORTED_WITHIN_IN_MINUTES,
    );
  });

  test("a browser closed for good is recorded within the margin and one sweep of its timeout, not 30 days later", () => {
    expect(EVERY_FIVE_MINUTE).toBe("*/5 * * * *");

    const lastActiveAt: Date = new Date("2026-11-15T09:07:00.000Z");
    const ranOutAt: Date = new Date(lastActiveAt.getTime() + 30 * MINUTE);

    // The first sweep, every five minutes on the clock, that ends it.
    let sweepAt: Date = new Date("2026-11-15T09:00:00.000Z");

    while (
      !isEndedBySweep({
        lastActiveAt,
        idleTimeoutInMinutes: 30,
        now: sweepAt,
      })
    ) {
      sweepAt = new Date(sweepAt.getTime() + 5 * MINUTE);
    }

    const lateByMinutes: number =
      (sweepAt.getTime() - ranOutAt.getTime()) / MINUTE;

    expect(lateByMinutes).toBeGreaterThanOrEqual(
      IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES,
    );
    expect(lateByMinutes).toBeLessThan(
      IDLE_TIMEOUT_SWEEP_MARGIN_IN_MINUTES + 5,
    );
  });
});

describe("what a renewal says of renewing while in use", () => {
  test("is kept under its own name", () => {
    expect(REPORTS_ACTIVITY_WHILE_IN_USE_FIELD).toBe(
      "reportsActivityWhileInUse",
    );
  });

  test("only true says so", () => {
    expect(readReportsActivityWhileInUse(true)).toBe(true);

    for (const value of [false, "true", 1, 0, null, undefined, {}, [], "yes"]) {
      expect({ value, says: readReportsActivityWhileInUse(value) }).toEqual({
        value,
        says: false,
      });
    }
  });
});
