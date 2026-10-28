import {
  MAX_SECURITY_CASE_TARGET_IN_MINUTES,
  SECURITY_CASE_TARGETS,
  SECURITY_CASE_TARGET_AT_RISK_FRACTION,
  SecurityCasePriorityTargets,
  SecurityCaseTarget,
  SecurityCaseTargetAlert,
  SecurityCaseTargetAlertKind,
  SecurityCaseTargetMoments,
  SecurityCaseTargetReading,
  SecurityCaseTargetState,
  SecurityCaseTargetWrite,
  describeTargetDuration,
  getAlertStamps,
  getAtRiskAt,
  getContainTargetAfterReopen,
  getDueTimeAfterPriorityChange,
  getDueTimesAfterPriorityChange,
  getDueTimesForNewCase,
  getNextDueAt,
  getNextPendingTarget,
  getNextTargetCheckAt,
  getTargetAlertsDue,
  getTargetBookkeeping,
  getTargetMetAt,
  getTargetMinutes,
  getTargetVerb,
  hasTargets,
  isPendingTarget,
  readSecurityCaseTarget,
  readSecurityCaseTargets,
  readTargetMinutes,
} from "../../../Utils/SecurityCase/SecurityCaseTargets";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A security case's response targets, as one rule: how its due times are set
 * as it opens and moved as its priority changes or it is reopened, when it is
 * at risk and when it has missed a target, what the every-minute check is to
 * say about it, and when it must look next. Every caller - the case's
 * service, the check, the case's pages and lists - reads these.
 */

const MINUTE: number = 60 * 1000;
const OPENED: Date = new Date("2026-10-14T12:00:00.000Z");

function at(minutes: number): Date {
  return new Date(OPENED.getTime() + minutes * MINUTE);
}

// A new project's Critical: acknowledge in 15 minutes, contain in 4 hours.
const CRITICAL: SecurityCasePriorityTargets = {
  acknowledgeWithinInMinutes: 15,
  containWithinInMinutes: 240,
};
const HIGH: SecurityCasePriorityTargets = {
  acknowledgeWithinInMinutes: 60,
  containWithinInMinutes: 1440,
};
const LOW: SecurityCasePriorityTargets = {
  acknowledgeWithinInMinutes: 1440,
  containWithinInMinutes: 10080,
};
const NONE: SecurityCasePriorityTargets = {
  acknowledgeWithinInMinutes: null,
  containWithinInMinutes: null,
};

describe("a target as a priority holds it", () => {
  test.each([
    [15, 15],
    [1, 1],
    ["240", 240],
    [MAX_SECURITY_CASE_TARGET_IN_MINUTES, MAX_SECURITY_CASE_TARGET_IN_MINUTES],
  ])("%p reads as %p minutes", (value: unknown, minutes: number) => {
    expect(readTargetMinutes(value)).toBe(minutes);
  });

  test.each([
    [0],
    [-5],
    [1.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [MAX_SECURITY_CASE_TARGET_IN_MINUTES + 1],
    [""],
    ["  "],
    ["fifteen"],
    [null],
    [undefined],
    [true],
    [{}],
  ])("%p is no target", (value: unknown) => {
    expect(readTargetMinutes(value)).toBeNull();
  });

  test("a year is the longest target", () => {
    expect(MAX_SECURITY_CASE_TARGET_IN_MINUTES).toBe(525600);
  });

  test("each target reads its own column", () => {
    expect(getTargetMinutes(CRITICAL, SecurityCaseTarget.Acknowledge)).toBe(15);
    expect(getTargetMinutes(CRITICAL, SecurityCaseTarget.Contain)).toBe(240);
    expect(getTargetMinutes(NONE, SecurityCaseTarget.Acknowledge)).toBeNull();
    expect(getTargetMinutes(null, SecurityCaseTarget.Contain)).toBeNull();
    expect(getTargetMinutes(undefined, SecurityCaseTarget.Contain)).toBeNull();
  });

  test("a priority has targets when it has either", () => {
    expect(hasTargets(CRITICAL)).toBe(true);
    expect(hasTargets({ acknowledgeWithinInMinutes: 30 })).toBe(true);
    expect(hasTargets({ containWithinInMinutes: 30 })).toBe(true);
    expect(hasTargets(NONE)).toBe(false);
    expect(hasTargets({ acknowledgeWithinInMinutes: 0 })).toBe(false);
    expect(hasTargets(null)).toBe(false);
  });

  test("acknowledge comes before contain", () => {
    expect(SECURITY_CASE_TARGETS).toEqual([
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTarget.Contain,
    ]);
  });

  test("the last fifth of a target is at risk", () => {
    expect(SECURITY_CASE_TARGET_AT_RISK_FRACTION).toBe(0.2);
  });
});

describe("when a target is met", () => {
  test("acknowledge, when the case is acknowledged", () => {
    expect(
      getTargetMetAt({ acknowledgedAt: at(5) }, SecurityCaseTarget.Acknowledge),
    ).toEqual(at(5));
    expect(
      getTargetMetAt({ closedAt: at(5) }, SecurityCaseTarget.Acknowledge),
    ).toBeNull();
  });

  test("contain, when the case is contained", () => {
    expect(
      getTargetMetAt({ containedAt: at(30) }, SecurityCaseTarget.Contain),
    ).toEqual(at(30));
  });

  test("contain, when the case is closed without being contained", () => {
    expect(
      getTargetMetAt({ closedAt: at(45) }, SecurityCaseTarget.Contain),
    ).toEqual(at(45));
  });

  test("contain, at the first of the two", () => {
    expect(
      getTargetMetAt(
        { containedAt: at(30), closedAt: at(90) },
        SecurityCaseTarget.Contain,
      ),
    ).toEqual(at(30));
    expect(
      getTargetMetAt(
        { containedAt: at(90), closedAt: at(30) },
        SecurityCaseTarget.Contain,
      ),
    ).toEqual(at(30));
  });

  test("a date read from JSON counts as a date", () => {
    expect(
      getTargetMetAt(
        {
          acknowledgedAt: at(5).toISOString() as unknown as Date,
        },
        SecurityCaseTarget.Acknowledge,
      ),
    ).toEqual(at(5));
  });
});

describe("when a target is at risk", () => {
  test("in the last fifth of the priority's target", () => {
    // Three minutes of a 15-minute target.
    expect(getAtRiskAt({ dueAt: at(15), targetInMinutes: 15 })).toEqual(at(12));
    // 48 minutes of a 4-hour one.
    expect(getAtRiskAt({ dueAt: at(240), targetInMinutes: 240 })).toEqual(
      at(192),
    );
  });

  test("never before the case opened", () => {
    expect(
      getAtRiskAt({ dueAt: at(1), targetInMinutes: 60, openedAt: OPENED }),
    ).toEqual(OPENED);
  });

  test("not without a due time or a target", () => {
    expect(getAtRiskAt({ dueAt: null, targetInMinutes: 15 })).toBeNull();
    expect(getAtRiskAt({ dueAt: at(15), targetInMinutes: null })).toBeNull();
  });
});

describe("where a case stands against a target", () => {
  const due: SecurityCaseTargetMoments = {
    createdAt: OPENED,
    acknowledgeDueAt: at(15),
    containDueAt: at(240),
  };

  function read(
    securityCase: SecurityCaseTargetMoments,
    target: SecurityCaseTarget,
    minutes: number,
    priority: SecurityCasePriorityTargets = CRITICAL,
  ): SecurityCaseTargetReading {
    return readSecurityCaseTarget({
      securityCase,
      target,
      priority,
      now: at(minutes),
    });
  }

  test("no due time is no target", () => {
    const reading: SecurityCaseTargetReading = read(
      { createdAt: OPENED },
      SecurityCaseTarget.Acknowledge,
      5,
    );

    expect(reading.state).toBe(SecurityCaseTargetState.None);
    expect(reading.dueAt).toBeNull();
    expect(reading.minutes).toBeNull();
    expect(isPendingTarget(reading)).toBe(false);
  });

  test("a target met as the case opened is no target either", () => {
    expect(
      read(
        { createdAt: OPENED, acknowledgedAt: OPENED },
        SecurityCaseTarget.Acknowledge,
        5,
      ).state,
    ).toBe(SecurityCaseTargetState.None);
  });

  test("on track, with the minutes left", () => {
    const reading: SecurityCaseTargetReading = read(
      due,
      SecurityCaseTarget.Acknowledge,
      5,
    );

    expect(reading.state).toBe(SecurityCaseTargetState.OnTrack);
    expect(reading.minutes).toBe(10);
    expect(reading.dueAt).toEqual(at(15));
    expect(reading.atRiskAt).toEqual(at(12));
    expect(reading.targetInMinutes).toBe(15);
    expect(isPendingTarget(reading)).toBe(true);
  });

  test("at risk from the start of the last fifth", () => {
    expect(read(due, SecurityCaseTarget.Acknowledge, 11.99).state).toBe(
      SecurityCaseTargetState.OnTrack,
    );

    const reading: SecurityCaseTargetReading = read(
      due,
      SecurityCaseTarget.Acknowledge,
      12,
    );

    expect(reading.state).toBe(SecurityCaseTargetState.AtRisk);
    expect(reading.minutes).toBe(3);
    expect(isPendingTarget(reading)).toBe(true);
  });

  test("missed from its due time, with the minutes past it", () => {
    expect(read(due, SecurityCaseTarget.Acknowledge, 15).state).toBe(
      SecurityCaseTargetState.Missed,
    );

    const reading: SecurityCaseTargetReading = read(
      due,
      SecurityCaseTarget.Acknowledge,
      20,
    );

    expect(reading.state).toBe(SecurityCaseTargetState.Missed);
    expect(reading.minutes).toBe(5);
    expect(isPendingTarget(reading)).toBe(true);
  });

  test("missed once OneUptime recorded it so, whatever the clock says", () => {
    expect(
      read(
        { ...due, acknowledgeMissedAt: at(15) },
        SecurityCaseTarget.Acknowledge,
        14,
      ).state,
    ).toBe(SecurityCaseTargetState.Missed);
  });

  test("met by its due time, with the minutes to spare", () => {
    const reading: SecurityCaseTargetReading = read(
      { ...due, acknowledgedAt: at(8) },
      SecurityCaseTarget.Acknowledge,
      60,
    );

    expect(reading.state).toBe(SecurityCaseTargetState.Met);
    expect(reading.metAt).toEqual(at(8));
    expect(reading.minutes).toBe(7);
    expect(isPendingTarget(reading)).toBe(false);
  });

  test("met right at its due time is met", () => {
    expect(
      read(
        { ...due, acknowledgedAt: at(15) },
        SecurityCaseTarget.Acknowledge,
        60,
      ).state,
    ).toBe(SecurityCaseTargetState.Met);
  });

  test("met late, with the minutes it was late by", () => {
    const reading: SecurityCaseTargetReading = read(
      { ...due, acknowledgedAt: at(20), acknowledgeMissedAt: at(15) },
      SecurityCaseTarget.Acknowledge,
      60,
    );

    expect(reading.state).toBe(SecurityCaseTargetState.MetLate);
    expect(reading.minutes).toBe(5);
    expect(isPendingTarget(reading)).toBe(false);
  });

  test("contain is met by closing the case", () => {
    expect(
      read(
        { ...due, acknowledgedAt: at(3), closedAt: at(30) },
        SecurityCaseTarget.Contain,
        600,
      ).state,
    ).toBe(SecurityCaseTargetState.Met);
  });

  test("a priority without a target now keeps the due time, with no at-risk window", () => {
    const reading: SecurityCaseTargetReading = read(
      due,
      SecurityCaseTarget.Acknowledge,
      14,
      NONE,
    );

    expect(reading.state).toBe(SecurityCaseTargetState.OnTrack);
    expect(reading.atRiskAt).toBeNull();
    expect(reading.targetInMinutes).toBeNull();
  });

  test("both targets, acknowledge first", () => {
    const readings: Array<SecurityCaseTargetReading> = readSecurityCaseTargets({
      securityCase: due,
      priority: CRITICAL,
      now: at(13),
    });

    expect(
      readings.map((reading: SecurityCaseTargetReading) => {
        return [reading.target, reading.state];
      }),
    ).toEqual([
      [SecurityCaseTarget.Acknowledge, SecurityCaseTargetState.AtRisk],
      [SecurityCaseTarget.Contain, SecurityCaseTargetState.OnTrack],
    ]);
  });
});

describe("the target a case is working against now", () => {
  function next(
    securityCase: SecurityCaseTargetMoments,
    minutes: number,
  ): SecurityCaseTargetReading | null {
    return getNextPendingTarget(
      readSecurityCaseTargets({
        securityCase,
        priority: CRITICAL,
        now: at(minutes),
      }),
    );
  }

  test("is the one due first", () => {
    expect(
      next(
        { createdAt: OPENED, acknowledgeDueAt: at(15), containDueAt: at(240) },
        5,
      )?.target,
    ).toBe(SecurityCaseTarget.Acknowledge);
  });

  test("is contain, once the case is acknowledged", () => {
    expect(
      next(
        {
          createdAt: OPENED,
          acknowledgedAt: at(3),
          acknowledgeDueAt: at(15),
          containDueAt: at(240),
        },
        5,
      )?.target,
    ).toBe(SecurityCaseTarget.Contain);
  });

  test("is a missed one before any other", () => {
    const reading: SecurityCaseTargetReading | null = next(
      { createdAt: OPENED, acknowledgeDueAt: at(15), containDueAt: at(240) },
      30,
    );

    expect(reading?.target).toBe(SecurityCaseTarget.Acknowledge);
    expect(reading?.state).toBe(SecurityCaseTargetState.Missed);
  });

  test("is the contain target when it is due before the acknowledge one", () => {
    expect(
      next(
        { createdAt: OPENED, acknowledgeDueAt: at(60), containDueAt: at(30) },
        5,
      )?.target,
    ).toBe(SecurityCaseTarget.Contain);
  });

  test("is nothing when every target is met", () => {
    expect(
      next(
        {
          createdAt: OPENED,
          acknowledgedAt: at(3),
          closedAt: at(30),
          acknowledgeDueAt: at(15),
          containDueAt: at(240),
        },
        60,
      ),
    ).toBeNull();
  });

  test("is nothing without targets", () => {
    expect(next({ createdAt: OPENED }, 60)).toBeNull();
  });
});

describe("the due times of a new case", () => {
  test("are its priority's targets from when it opens", () => {
    expect(
      getDueTimesForNewCase({ openedAt: OPENED, priority: CRITICAL }),
    ).toEqual({ acknowledgeDueAt: at(15), containDueAt: at(240) });
  });

  test("leave out a target the priority does not have", () => {
    expect(
      getDueTimesForNewCase({
        openedAt: OPENED,
        priority: { acknowledgeWithinInMinutes: 30 },
      }),
    ).toEqual({ acknowledgeDueAt: at(30), containDueAt: null });
    expect(getDueTimesForNewCase({ openedAt: OPENED, priority: NONE })).toEqual(
      { acknowledgeDueAt: null, containDueAt: null },
    );
    expect(getDueTimesForNewCase({ openedAt: OPENED, priority: null })).toEqual(
      { acknowledgeDueAt: null, containDueAt: null },
    );
  });

  test("leave out a target the case meets as it opens", () => {
    // Opened assigned to somebody: acknowledged already.
    expect(
      getDueTimesForNewCase({
        openedAt: OPENED,
        priority: CRITICAL,
        acknowledgedAt: OPENED,
      }),
    ).toEqual({ acknowledgeDueAt: null, containDueAt: at(240) });

    // Opened straight into a contained status.
    expect(
      getDueTimesForNewCase({
        openedAt: OPENED,
        priority: CRITICAL,
        acknowledgedAt: OPENED,
        containedAt: OPENED,
      }),
    ).toEqual({ acknowledgeDueAt: null, containDueAt: null });

    // Opened closed.
    expect(
      getDueTimesForNewCase({
        openedAt: OPENED,
        priority: CRITICAL,
        acknowledgedAt: OPENED,
        closedAt: OPENED,
      }),
    ).toEqual({ acknowledgeDueAt: null, containDueAt: null });
  });
});

describe("a due time after the priority changes", () => {
  const base: {
    isSettled: boolean;
    openedAt: Date;
    now: Date;
  } = {
    isSettled: false,
    openedAt: OPENED,
    now: at(30),
  };

  test("stays as it is once met or missed", () => {
    for (const isRising of [true, false]) {
      expect(
        getDueTimeAfterPriorityChange({
          ...base,
          isSettled: true,
          dueAt: at(15),
          isRising,
          newTargetInMinutes: 5,
        }),
      ).toBeUndefined();
    }
  });

  test("is set from the change when there was none", () => {
    for (const isRising of [true, false]) {
      expect(
        getDueTimeAfterPriorityChange({
          ...base,
          dueAt: null,
          isRising,
          newTargetInMinutes: 60,
        }),
      ).toEqual(at(90));
    }
  });

  test("stays without one when the new priority has none either", () => {
    expect(
      getDueTimeAfterPriorityChange({
        ...base,
        dueAt: null,
        isRising: true,
        newTargetInMinutes: null,
      }),
    ).toBeUndefined();
  });

  test("rising to a priority without a target, stays as it was", () => {
    expect(
      getDueTimeAfterPriorityChange({
        ...base,
        dueAt: at(1440),
        isRising: true,
        newTargetInMinutes: null,
      }),
    ).toBeUndefined();
  });

  test("falling to a priority without a target, is taken away", () => {
    expect(
      getDueTimeAfterPriorityChange({
        ...base,
        dueAt: at(15),
        isRising: false,
        newTargetInMinutes: null,
      }),
    ).toBeNull();
  });

  test("rising, comes closer: the new target from the rise", () => {
    // A Low case, 30 minutes in, rises to Critical: 15 minutes from now.
    expect(
      getDueTimeAfterPriorityChange({
        ...base,
        dueAt: at(1440),
        isRising: true,
        newTargetInMinutes: 15,
      }),
    ).toEqual(at(45));
  });

  test("rising, is never later than it was", () => {
    // A Medium case due at 60, rising at 50 to a 30-minute target, stays at 60.
    expect(
      getDueTimeAfterPriorityChange({
        ...base,
        now: at(50),
        dueAt: at(60),
        isRising: true,
        newTargetInMinutes: 30,
      }),
    ).toBeUndefined();
  });

  test("falling, moves out: the new target from when the case opened", () => {
    // A Critical case falls to Low five minutes in: a day from the opening.
    expect(
      getDueTimeAfterPriorityChange({
        ...base,
        now: at(5),
        dueAt: at(15),
        isRising: false,
        newTargetInMinutes: 1440,
      }),
    ).toEqual(at(1440));
  });

  test("falling, is never sooner than it was", () => {
    // Raised to Critical late in its day as Low, then set back to High.
    expect(
      getDueTimeAfterPriorityChange({
        ...base,
        now: at(1400),
        dueAt: at(1415),
        isRising: false,
        newTargetInMinutes: 60,
      }),
    ).toBeUndefined();
  });
});

describe("both due times after the priority changes", () => {
  test("move together, and a moved one has not been warned about yet", () => {
    const write: SecurityCaseTargetWrite = getDueTimesAfterPriorityChange({
      securityCase: {
        createdAt: OPENED,
        acknowledgeDueAt: at(1440),
        containDueAt: at(10080),
        acknowledgeWarnedAt: at(1300),
      },
      newPriority: CRITICAL,
      isRising: true,
      now: at(30),
    });

    expect(write).toEqual({
      acknowledgeDueAt: at(45),
      acknowledgeWarnedAt: null,
      containDueAt: at(270),
      containWarnedAt: null,
    });
  });

  test("a fall moves both out, to the new priority's targets from the opening", () => {
    // A Critical case set back to High five minutes in.
    const write: SecurityCaseTargetWrite = getDueTimesAfterPriorityChange({
      securityCase: {
        createdAt: OPENED,
        acknowledgeDueAt: at(15),
        containDueAt: at(240),
      },
      newPriority: HIGH,
      isRising: false,
      now: at(5),
    });

    expect(write).toEqual({
      acknowledgeDueAt: at(60),
      acknowledgeWarnedAt: null,
      containDueAt: at(1440),
      containWarnedAt: null,
    });
  });

  test("leave a met target as it is", () => {
    expect(
      getDueTimesAfterPriorityChange({
        securityCase: {
          createdAt: OPENED,
          acknowledgedAt: at(10),
          acknowledgeDueAt: at(1440),
          containDueAt: at(10080),
        },
        newPriority: CRITICAL,
        isRising: true,
        now: at(30),
      }),
    ).toEqual({ containDueAt: at(270), containWarnedAt: null });
  });

  test("leave a missed target as it is", () => {
    expect(
      getDueTimesAfterPriorityChange({
        securityCase: {
          createdAt: OPENED,
          acknowledgeDueAt: at(15),
          acknowledgeMissedAt: at(15),
          containDueAt: at(240),
        },
        newPriority: LOW,
        isRising: false,
        now: at(30),
      }),
    ).toEqual({ containDueAt: at(10080), containWarnedAt: null });
  });

  test("leave a closed case as it is", () => {
    expect(
      getDueTimesAfterPriorityChange({
        securityCase: {
          createdAt: OPENED,
          acknowledgedAt: at(5),
          closedAt: at(20),
          acknowledgeDueAt: at(15),
          containDueAt: at(240),
        },
        newPriority: LOW,
        isRising: false,
        now: at(30),
      }),
    ).toEqual({});
  });

  test("write nothing when nothing moves", () => {
    expect(
      getDueTimesAfterPriorityChange({
        securityCase: {
          createdAt: OPENED,
          acknowledgeDueAt: at(15),
          containDueAt: at(240),
        },
        newPriority: CRITICAL,
        isRising: true,
        now: at(5),
      }),
    ).toEqual({});
  });
});

describe("a reopened case's contain target", () => {
  test("starts again from the reopening, with nothing said about it", () => {
    expect(
      getContainTargetAfterReopen({ priority: CRITICAL, now: at(600) }),
    ).toEqual({
      containDueAt: at(840),
      containWarnedAt: null,
      containMissedAt: null,
    });
  });

  test("has no due time at a priority without one", () => {
    expect(
      getContainTargetAfterReopen({ priority: NONE, now: at(600) }),
    ).toEqual({
      containDueAt: null,
      containWarnedAt: null,
      containMissedAt: null,
    });
  });
});

describe("the next due time, for the lists' sort", () => {
  test("is the earliest of the targets not met", () => {
    expect(
      getNextDueAt({ acknowledgeDueAt: at(15), containDueAt: at(240) }),
    ).toEqual(at(15));
    expect(
      getNextDueAt({
        acknowledgedAt: at(5),
        acknowledgeDueAt: at(15),
        containDueAt: at(240),
      }),
    ).toEqual(at(240));
  });

  test("counts a missed target, which is the most overdue", () => {
    expect(
      getNextDueAt({
        acknowledgeDueAt: at(15),
        acknowledgeMissedAt: at(15),
        containDueAt: at(240),
      }),
    ).toEqual(at(15));
  });

  test("is nothing once every target is met", () => {
    expect(
      getNextDueAt({
        acknowledgedAt: at(5),
        closedAt: at(30),
        acknowledgeDueAt: at(15),
        containDueAt: at(240),
      }),
    ).toBeNull();
    expect(getNextDueAt({})).toBeNull();
  });
});

describe("when the every-minute check looks next", () => {
  test("at the first at-risk moment, before anyone was warned", () => {
    expect(
      getNextTargetCheckAt({
        securityCase: {
          createdAt: OPENED,
          acknowledgeDueAt: at(15),
          containDueAt: at(240),
        },
        priority: CRITICAL,
      }),
    ).toEqual(at(12));
  });

  test("at the due time, once warned", () => {
    expect(
      getNextTargetCheckAt({
        securityCase: {
          createdAt: OPENED,
          acknowledgeDueAt: at(15),
          acknowledgeWarnedAt: at(12),
          containDueAt: at(240),
        },
        priority: CRITICAL,
      }),
    ).toEqual(at(15));
  });

  test("at the next target's moment, once one is missed", () => {
    expect(
      getNextTargetCheckAt({
        securityCase: {
          createdAt: OPENED,
          acknowledgeDueAt: at(15),
          acknowledgeWarnedAt: at(12),
          acknowledgeMissedAt: at(15),
          containDueAt: at(240),
        },
        priority: CRITICAL,
      }),
    ).toEqual(at(192));
  });

  test("at the due time when the priority has no target to warn by", () => {
    expect(
      getNextTargetCheckAt({
        securityCase: { createdAt: OPENED, acknowledgeDueAt: at(15) },
        priority: NONE,
      }),
    ).toEqual(at(15));
  });

  test("never, when nothing is left to say", () => {
    expect(
      getNextTargetCheckAt({
        securityCase: {
          createdAt: OPENED,
          acknowledgedAt: at(5),
          closedAt: at(30),
          acknowledgeDueAt: at(15),
          containDueAt: at(240),
        },
        priority: CRITICAL,
      }),
    ).toBeNull();
    expect(
      getNextTargetCheckAt({
        securityCase: {
          createdAt: OPENED,
          acknowledgeDueAt: at(15),
          acknowledgeMissedAt: at(15),
          containDueAt: at(240),
          containMissedAt: at(240),
        },
        priority: CRITICAL,
      }),
    ).toBeNull();
  });

  test("together with the next due time", () => {
    expect(
      getTargetBookkeeping({
        securityCase: {
          createdAt: OPENED,
          acknowledgeDueAt: at(15),
          containDueAt: at(240),
        },
        priority: CRITICAL,
      }),
    ).toEqual({ nextDueAt: at(15), nextTargetCheckAt: at(12) });
  });
});

describe("what the every-minute check says", () => {
  const open: SecurityCaseTargetMoments = {
    createdAt: OPENED,
    acknowledgeDueAt: at(15),
    containDueAt: at(240),
  };

  function alertsAt(
    securityCase: SecurityCaseTargetMoments,
    minutes: number,
  ): Array<[SecurityCaseTarget, SecurityCaseTargetAlertKind]> {
    return getTargetAlertsDue({
      securityCase,
      priority: CRITICAL,
      now: at(minutes),
    }).map(
      (
        alert: SecurityCaseTargetAlert,
      ): [SecurityCaseTarget, SecurityCaseTargetAlertKind] => {
        return [alert.target, alert.kind];
      },
    );
  }

  test("nothing while a case is on track", () => {
    expect(alertsAt(open, 5)).toEqual([]);
  });

  test("at risk, in the last fifth", () => {
    expect(alertsAt(open, 12)).toEqual([
      [SecurityCaseTarget.Acknowledge, SecurityCaseTargetAlertKind.AtRisk],
    ]);
  });

  test("at risk only once", () => {
    expect(alertsAt({ ...open, acknowledgeWarnedAt: at(12) }, 13)).toEqual([]);
  });

  test("missed, at the due time", () => {
    expect(alertsAt({ ...open, acknowledgeWarnedAt: at(12) }, 15)).toEqual([
      [SecurityCaseTarget.Acknowledge, SecurityCaseTargetAlertKind.Missed],
    ]);
  });

  test("missed only once", () => {
    expect(
      alertsAt(
        { ...open, acknowledgeWarnedAt: at(12), acknowledgeMissedAt: at(15) },
        20,
      ),
    ).toEqual([]);
  });

  test("missed without a warning that would come too late", () => {
    // The check was down from 10 to 16 minutes: only the miss is said.
    expect(alertsAt(open, 16)).toEqual([
      [SecurityCaseTarget.Acknowledge, SecurityCaseTargetAlertKind.Missed],
    ]);
  });

  test("both targets at once, when both are due", () => {
    expect(alertsAt(open, 300)).toEqual([
      [SecurityCaseTarget.Acknowledge, SecurityCaseTargetAlertKind.Missed],
      [SecurityCaseTarget.Contain, SecurityCaseTargetAlertKind.Missed],
    ]);
  });

  test("nothing about a target met", () => {
    expect(alertsAt({ ...open, acknowledgedAt: at(5) }, 20)).toEqual([]);
    expect(
      alertsAt({ ...open, acknowledgedAt: at(5), closedAt: at(10) }, 600),
    ).toEqual([]);
  });

  test("the alert carries the due time and the target", () => {
    expect(
      getTargetAlertsDue({
        securityCase: open,
        priority: CRITICAL,
        now: at(13),
      }),
    ).toEqual([
      {
        target: SecurityCaseTarget.Acknowledge,
        kind: SecurityCaseTargetAlertKind.AtRisk,
        dueAt: at(15),
        targetInMinutes: 15,
      },
    ]);
  });

  test("its stamps record each alert in its own column", () => {
    expect(
      getAlertStamps(
        [
          {
            target: SecurityCaseTarget.Acknowledge,
            kind: SecurityCaseTargetAlertKind.Missed,
            dueAt: at(15),
            targetInMinutes: 15,
          },
          {
            target: SecurityCaseTarget.Contain,
            kind: SecurityCaseTargetAlertKind.AtRisk,
            dueAt: at(240),
            targetInMinutes: 240,
          },
        ],
        at(200),
      ),
    ).toEqual({ acknowledgeMissedAt: at(200), containWarnedAt: at(200) });
  });
});

describe("a case checked every minute, from opening to its last due time", () => {
  /*
   * The check as the worker runs it: every minute, what is due is said and
   * stamped, and the next look is read from what the case now holds. Each
   * target is warned about once, then missed once, and the check never
   * sleeps past a moment it had to say something at.
   */
  function runChecks(
    securityCase: SecurityCaseTargetMoments,
    priority: SecurityCasePriorityTargets,
    untilMinute: number,
  ): Array<[number, SecurityCaseTarget, SecurityCaseTargetAlertKind]> {
    const said: Array<
      [number, SecurityCaseTarget, SecurityCaseTargetAlertKind]
    > = [];
    let held: SecurityCaseTargetMoments = { ...securityCase };

    for (let minute: number = 0; minute <= untilMinute; minute++) {
      const now: Date = at(minute);
      const checkAt: Date | null = getNextTargetCheckAt({
        securityCase: held,
        priority,
      });

      if (!checkAt || checkAt.getTime() > now.getTime()) {
        // Nothing may be due before the check said it would look.
        expect(
          getTargetAlertsDue({ securityCase: held, priority, now }),
        ).toEqual([]);
        continue;
      }

      const alerts: Array<SecurityCaseTargetAlert> = getTargetAlertsDue({
        securityCase: held,
        priority,
        now,
      });

      for (const alert of alerts) {
        said.push([minute, alert.target, alert.kind]);
      }

      held = { ...held, ...getAlertStamps(alerts, now) };
    }

    return said;
  }

  test("a Critical case nobody touches is warned about and missed, target by target", () => {
    expect(
      runChecks(
        { createdAt: OPENED, acknowledgeDueAt: at(15), containDueAt: at(240) },
        CRITICAL,
        300,
      ),
    ).toEqual([
      [12, SecurityCaseTarget.Acknowledge, SecurityCaseTargetAlertKind.AtRisk],
      [15, SecurityCaseTarget.Acknowledge, SecurityCaseTargetAlertKind.Missed],
      [192, SecurityCaseTarget.Contain, SecurityCaseTargetAlertKind.AtRisk],
      [240, SecurityCaseTarget.Contain, SecurityCaseTargetAlertKind.Missed],
    ]);
  });

  test("property: every target is said at most once of each kind, and never after it is met", () => {
    const random: SeededRandom = seededRandom(5250);

    for (let round: number = 0; round < 120; round++) {
      const acknowledge: number = 1 + random(120);
      const contain: number = acknowledge + random(240);
      const priority: SecurityCasePriorityTargets = {
        acknowledgeWithinInMinutes: acknowledge,
        containWithinInMinutes: contain,
      };
      const acknowledgedAt: Date | null =
        random() < 0.5 ? at(random(acknowledge * 2)) : null;
      const closedAt: Date | null =
        random() < 0.3 ? at(random(contain * 2)) : null;
      const securityCase: SecurityCaseTargetMoments = {
        createdAt: OPENED,
        acknowledgeDueAt: at(acknowledge),
        containDueAt: at(contain),
        acknowledgedAt,
        closedAt,
      };

      const said: Array<
        [number, SecurityCaseTarget, SecurityCaseTargetAlertKind]
      > = runChecks(securityCase, priority, contain + 10);

      for (const target of SECURITY_CASE_TARGETS) {
        for (const kind of [
          SecurityCaseTargetAlertKind.AtRisk,
          SecurityCaseTargetAlertKind.Missed,
        ]) {
          expect(
            said.filter(
              (
                entry: [
                  number,
                  SecurityCaseTarget,
                  SecurityCaseTargetAlertKind,
                ],
              ): boolean => {
                return entry[1] === target && entry[2] === kind;
              },
            ).length,
          ).toBeLessThanOrEqual(1);
        }

        const metAt: Date | null = getTargetMetAt(securityCase, target);

        if (metAt) {
          for (const entry of said) {
            if (entry[1] === target) {
              expect(at(entry[0]).getTime()).toBeLessThan(metAt.getTime());
            }
          }
        }
      }
    }
  });

  test("property: a rise never leaves more time, and a fall never less", () => {
    const random: SeededRandom = seededRandom(5237);

    for (let round: number = 0; round < 500; round++) {
      const dueAt: Date = at(1 + random(10000));
      const now: Date = at(random(dueAt.getTime() > 0 ? 9000 : 1));
      const newTarget: number = 1 + random(20000);

      const risen: Date | null | undefined = getDueTimeAfterPriorityChange({
        dueAt,
        isSettled: false,
        isRising: true,
        newTargetInMinutes: newTarget,
        openedAt: OPENED,
        now,
      });
      const fallen: Date | null | undefined = getDueTimeAfterPriorityChange({
        dueAt,
        isSettled: false,
        isRising: false,
        newTargetInMinutes: newTarget,
        openedAt: OPENED,
        now,
      });

      expect((risen || dueAt).getTime()).toBeLessThanOrEqual(dueAt.getTime());
      expect((fallen || dueAt).getTime()).toBeGreaterThanOrEqual(
        dueAt.getTime(),
      );
    }
  });
});

describe("words", () => {
  test.each([
    [1, "1 minute"],
    [15, "15 minutes"],
    [59, "59 minutes"],
    [60, "1 hour"],
    [90, "1 hour 30 minutes"],
    [240, "4 hours"],
    [1440, "1 day"],
    [1500, "1 day 1 hour"],
    [4320, "3 days"],
    [10080, "7 days"],
    [0, "0 minutes"],
    [14.6, "15 minutes"],
  ])("%p minutes reads as %p", (minutes: number, words: string) => {
    expect(describeTargetDuration(minutes)).toBe(words);
  });

  test("each target's verb", () => {
    expect(getTargetVerb(SecurityCaseTarget.Acknowledge)).toBe("acknowledge");
    expect(getTargetVerb(SecurityCaseTarget.Contain)).toBe("contain");
  });
});
