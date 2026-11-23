import AIRunStatus from "../../../Types/AI/AIRunStatus";
import {
  AI_HOLD_OUTAGE_RECORD_COUNT,
  AI_HOLD_OUTAGE_WINDOW_IN_MINUTES,
  AI_HOLD_RECURRENCE_WINDOW_IN_HOURS,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { SecurityCaseAiResponseState } from "../../../Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_AI_HOLD_ATTACK_CASE_COUNT,
  SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES,
  SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT,
  SECURITY_CASE_AI_HOLD_MINUTES_MAX,
  SECURITY_CASE_AI_HOLD_MINUTES_MIN,
  SECURITY_CASE_AI_HOLD_OUTCOMES,
  SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES,
  SECURITY_CASE_AI_HOLD_QUIET_SKIPS,
  SECURITY_CASE_AI_HOLD_RECURRENCE_ENTITY_TYPES,
  SECURITY_CASE_AI_HOLD_RECURRENCE_WINDOW_IN_HOURS,
  SECURITY_CASE_AI_HOLD_SKIP_SENTENCES,
  SECURITY_CASE_AI_HOLD_START_GRACE_IN_MINUTES,
  SecurityCaseAiHoldEnd,
  SecurityCaseAiHoldFacts,
  SecurityCaseAiHoldOutcome,
  SecurityCaseAiHoldPageDecision,
  SecurityCaseAiHoldSkip,
  SecurityCaseAiHoldState,
  decideSecurityCaseAiHold,
  decideSecurityCaseAiHoldPage,
  getSecurityCaseAiHoldEnd,
  getSecurityCaseAiHoldMinutes,
  isSecurityCaseAiHoldAlerting,
  isSecurityCaseAiHoldHandedOff,
  isSecurityCaseAiHoldOutcome,
  reviewSecurityCaseAiHold,
} from "../../../Types/SecurityCase/SecurityCaseAiHold";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME AI RESPONDS FIRST TO A SECURITY CASE (#10353): the rules every
 * part reads - which new cases are held, what ends a hold and how, and
 * what a playbook's Page On-Call step does about it.
 */

const NOW: Date = new Date("2026-11-23T03:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

// A Medium scanner case a detection opened, which every rule lets be held.
function facts(
  overrides: Partial<SecurityCaseAiHoldFacts> = {},
): SecurityCaseAiHoldFacts {
  return {
    isOn: true,
    isSetupTest: false,
    isOpenedByDetection: true,
    isBelowThreshold: true,
    isHighestPriority: false,
    otherCasesOpenedRecently: 0,
    cannotWorkCasesBecause: null,
    cannotTriageBecause: null,
    hasSteeringText: false,
    recentlyResolvedEntity: null,
    ...overrides,
  };
}

// A held case OneUptime AI is working, with time left on its hold.
function state(
  overrides: Partial<SecurityCaseAiHoldState> = {},
): SecurityCaseAiHoldState {
  return {
    now: NOW,
    openedAt: minutesAgo(3),
    holdUntil: minutesFromNow(7),
    isStillOn: true,
    isStillBelowThreshold: true,
    stage: SecurityCaseStage.New,
    isContainmentVerified: false,
    aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
    triageStatus: AIRunStatus.Completed,
    triageSettledAt: minutesAgo(2),
    responseState: SecurityCaseAiResponseState.Working,
    isWaitingForApproval: false,
    ...overrides,
  };
}

describe("the hold's outcomes", () => {
  test("are stored strings that never change", () => {
    expect(SECURITY_CASE_AI_HOLD_OUTCOMES).toEqual([
      "Holding",
      "Resolved",
      "NeedsApproval",
      "HandedOff",
      "TimeRanOut",
      "NotStarted",
      "NotMalicious",
      "NotVerified",
      "ActiveAttack",
      "TurnedOff",
      "PageNow",
      "RoseInPriority",
      "TakenByPerson",
    ]);
    expect(isSecurityCaseAiHoldOutcome("Holding")).toBe(true);
    expect(isSecurityCaseAiHoldOutcome("holding")).toBe(false);
    expect(isSecurityCaseAiHoldOutcome(undefined)).toBe(false);
  });

  test("each ends one of three ways: resolved, handed to people, or stopped", () => {
    expect(getSecurityCaseAiHoldEnd(SecurityCaseAiHoldOutcome.Holding)).toBe(
      null,
    );
    expect(getSecurityCaseAiHoldEnd(null)).toBe(null);
    expect(getSecurityCaseAiHoldEnd(SecurityCaseAiHoldOutcome.Resolved)).toBe(
      SecurityCaseAiHoldEnd.Resolved,
    );

    for (const outcome of [
      SecurityCaseAiHoldOutcome.NeedsApproval,
      SecurityCaseAiHoldOutcome.HandedOff,
      SecurityCaseAiHoldOutcome.TimeRanOut,
      SecurityCaseAiHoldOutcome.NotStarted,
      SecurityCaseAiHoldOutcome.NotMalicious,
      SecurityCaseAiHoldOutcome.NotVerified,
      SecurityCaseAiHoldOutcome.ActiveAttack,
      SecurityCaseAiHoldOutcome.TurnedOff,
    ]) {
      expect(getSecurityCaseAiHoldEnd(outcome)).toBe(
        SecurityCaseAiHoldEnd.HandedToPeople,
      );
      expect(isSecurityCaseAiHoldHandedOff(outcome)).toBe(true);
      expect(isSecurityCaseAiHoldAlerting(outcome)).toBe(true);
    }

    for (const outcome of [
      SecurityCaseAiHoldOutcome.PageNow,
      SecurityCaseAiHoldOutcome.RoseInPriority,
      SecurityCaseAiHoldOutcome.TakenByPerson,
    ]) {
      expect(getSecurityCaseAiHoldEnd(outcome)).toBe(
        SecurityCaseAiHoldEnd.Stopped,
      );
      expect(isSecurityCaseAiHoldHandedOff(outcome)).toBe(false);
    }
  });

  test("every end alerts people, but a resolved case and one a person took", () => {
    expect(
      isSecurityCaseAiHoldAlerting(SecurityCaseAiHoldOutcome.Resolved),
    ).toBe(false);
    expect(
      isSecurityCaseAiHoldAlerting(SecurityCaseAiHoldOutcome.TakenByPerson),
    ).toBe(false);
    expect(
      isSecurityCaseAiHoldAlerting(SecurityCaseAiHoldOutcome.Holding),
    ).toBe(false);
    expect(
      isSecurityCaseAiHoldAlerting(SecurityCaseAiHoldOutcome.PageNow),
    ).toBe(true);
    expect(
      isSecurityCaseAiHoldAlerting(SecurityCaseAiHoldOutcome.RoseInPriority),
    ).toBe(true);
  });

  test("every outcome has a sentence for the case's card, and the ones a person ends name them", () => {
    for (const outcome of SECURITY_CASE_AI_HOLD_OUTCOMES) {
      expect(SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES[outcome]).toBeTruthy();
    }

    expect(
      SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES[
        SecurityCaseAiHoldOutcome.PageNow
      ],
    ).toContain("{{name}}");
    expect(
      SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES[
        SecurityCaseAiHoldOutcome.TakenByPerson
      ],
    ).toContain("{{name}}");
    expect(
      SECURITY_CASE_AI_HOLD_OUTCOME_SENTENCES[
        SecurityCaseAiHoldOutcome.Resolved
      ],
    ).toContain("Nobody was alerted");
  });
});

describe("the hold time", () => {
  test("is 10 minutes unless the project picks one", () => {
    expect(SECURITY_CASE_AI_HOLD_MINUTES_DEFAULT).toBe(10);
    expect(getSecurityCaseAiHoldMinutes(null)).toBe(10);
    expect(getSecurityCaseAiHoldMinutes(undefined)).toBe(10);
    expect(getSecurityCaseAiHoldMinutes(Number.NaN)).toBe(10);
  });

  test("is whole minutes from 1 to 30: a value written past them never holds a case longer", () => {
    expect(SECURITY_CASE_AI_HOLD_MINUTES_MIN).toBe(1);
    expect(SECURITY_CASE_AI_HOLD_MINUTES_MAX).toBe(30);
    expect(getSecurityCaseAiHoldMinutes(15)).toBe(15);
    expect(getSecurityCaseAiHoldMinutes(7.6)).toBe(8);
    expect(getSecurityCaseAiHoldMinutes(0)).toBe(1);
    expect(getSecurityCaseAiHoldMinutes(-5)).toBe(1);
    expect(getSecurityCaseAiHoldMinutes(600)).toBe(30);
  });

  test("the attack and recurrence guards are the incident side's own numbers", () => {
    expect(SECURITY_CASE_AI_HOLD_ATTACK_CASE_COUNT).toBe(
      AI_HOLD_OUTAGE_RECORD_COUNT,
    );
    expect(SECURITY_CASE_AI_HOLD_ATTACK_WINDOW_IN_MINUTES).toBe(
      AI_HOLD_OUTAGE_WINDOW_IN_MINUTES,
    );
    expect(SECURITY_CASE_AI_HOLD_RECURRENCE_WINDOW_IN_HOURS).toBe(
      AI_HOLD_RECURRENCE_WINDOW_IN_HOURS,
    );
    expect(SECURITY_CASE_AI_HOLD_RECURRENCE_WINDOW_IN_HOURS).toBe(24);
  });

  test("a recurrence is about an address, a user or a host: what OneUptime AI's fixes act on", () => {
    expect([...SECURITY_CASE_AI_HOLD_RECURRENCE_ENTITY_TYPES].sort()).toEqual(
      [
        SecurityEntityType.Host,
        SecurityEntityType.IpAddress,
        SecurityEntityType.User,
      ].sort(),
    );
  });
});

describe("whether a new case is held", () => {
  test("a Medium case a detection opened, below the priority the project holds, is held", () => {
    expect(decideSecurityCaseAiHold(facts())).toEqual({ canHold: true });
  });

  test("not while the project leaves it off - and nothing is said of it", () => {
    expect(decideSecurityCaseAiHold(facts({ isOn: false }))).toEqual({
      canHold: false,
      skip: SecurityCaseAiHoldSkip.NotOn,
    });
    expect(SECURITY_CASE_AI_HOLD_QUIET_SKIPS).toContain(
      SecurityCaseAiHoldSkip.NotOn,
    );
  });

  test("never the project's highest priority", () => {
    expect(
      decideSecurityCaseAiHold(
        facts({ isHighestPriority: true, isBelowThreshold: true }),
      ),
    ).toEqual({ canHold: false, skip: SecurityCaseAiHoldSkip.HighestPriority });
  });

  test("never a case at or above the priority the project holds below", () => {
    expect(
      decideSecurityCaseAiHold(facts({ isBelowThreshold: false })),
    ).toEqual({
      canHold: false,
      skip: SecurityCaseAiHoldSkip.AtOrAboveThreshold,
    });
    expect(SECURITY_CASE_AI_HOLD_QUIET_SKIPS).toContain(
      SecurityCaseAiHoldSkip.AtOrAboveThreshold,
    );
  });

  test("never while several cases open within minutes - an active attack, which ends every hold", () => {
    expect(
      decideSecurityCaseAiHold(
        facts({
          otherCasesOpenedRecently: SECURITY_CASE_AI_HOLD_ATTACK_CASE_COUNT,
        }),
      ),
    ).toEqual({
      canHold: false,
      skip: SecurityCaseAiHoldSkip.ActiveAttack,
      isActiveAttack: true,
    });

    // One fewer is no attack.
    expect(
      decideSecurityCaseAiHold(
        facts({
          otherCasesOpenedRecently: SECURITY_CASE_AI_HOLD_ATTACK_CASE_COUNT - 1,
        }),
      ),
    ).toEqual({ canHold: true });
  });

  test("never a case whose data holds text written to steer an AI", () => {
    expect(decideSecurityCaseAiHold(facts({ hasSteeringText: true }))).toEqual({
      canHold: false,
      skip: SecurityCaseAiHoldSkip.SteeringText,
    });
  });

  test("never a case about the same address, user or host as one OneUptime AI resolved in the last 24 hours", () => {
    expect(
      decideSecurityCaseAiHold(
        facts({
          recentlyResolvedEntity: {
            type: SecurityEntityType.IpAddress,
            value: "35.205.11.131",
          },
        }),
      ),
    ).toEqual({
      canHold: false,
      skip: SecurityCaseAiHoldSkip.RecentlyResolved,
    });
  });

  test("never one OneUptime AI cannot work, or cannot triage - a hold would only be a later alert", () => {
    expect(
      decideSecurityCaseAiHold(
        facts({ cannotWorkCasesBecause: "AI is turned off for this project." }),
      ),
    ).toEqual({ canHold: false, skip: SecurityCaseAiHoldSkip.CannotWorkCases });
    expect(
      decideSecurityCaseAiHold(
        facts({
          cannotTriageBecause:
            "Triaging new cases automatically is turned off for this project.",
        }),
      ),
    ).toEqual({ canHold: false, skip: SecurityCaseAiHoldSkip.CannotTriage });
  });

  test("never a case a person opened, nor the setup test's", () => {
    expect(
      decideSecurityCaseAiHold(facts({ isOpenedByDetection: false })),
    ).toEqual({
      canHold: false,
      skip: SecurityCaseAiHoldSkip.NotOpenedByDetection,
    });
    expect(decideSecurityCaseAiHold(facts({ isSetupTest: true }))).toEqual({
      canHold: false,
      skip: SecurityCaseAiHoldSkip.SetupTest,
    });
  });

  test("the first reason wins, in the order the rules are told", () => {
    expect(
      decideSecurityCaseAiHold(
        facts({
          isHighestPriority: true,
          otherCasesOpenedRecently: 10,
          hasSteeringText: true,
        }),
      ).skip,
    ).toBe(SecurityCaseAiHoldSkip.HighestPriority);
    expect(
      decideSecurityCaseAiHold(
        facts({ otherCasesOpenedRecently: 10, hasSteeringText: true }),
      ).skip,
    ).toBe(SecurityCaseAiHoldSkip.ActiveAttack);
  });

  test("every reason worth knowing has a sentence for the case's timeline", () => {
    for (const skip of Object.values(SecurityCaseAiHoldSkip)) {
      expect(SECURITY_CASE_AI_HOLD_SKIP_SENTENCES[skip]).toBeTruthy();
    }

    expect(
      SECURITY_CASE_AI_HOLD_SKIP_SENTENCES[
        SecurityCaseAiHoldSkip.RecentlyResolved
      ],
    ).toContain("{{value}}");
    expect(
      SECURITY_CASE_AI_HOLD_SKIP_SENTENCES[
        SecurityCaseAiHoldSkip.CannotWorkCases
      ],
    ).toContain("{{why}}");

    // Said: the ones a person would want to know about.
    for (const skip of [
      SecurityCaseAiHoldSkip.ActiveAttack,
      SecurityCaseAiHoldSkip.CannotWorkCases,
      SecurityCaseAiHoldSkip.CannotTriage,
      SecurityCaseAiHoldSkip.SteeringText,
      SecurityCaseAiHoldSkip.RecentlyResolved,
      SecurityCaseAiHoldSkip.CheckFailed,
    ]) {
      expect(SECURITY_CASE_AI_HOLD_QUIET_SKIPS).not.toContain(skip);
    }
  });
});

describe("what ends a hold", () => {
  test("OneUptime AI still working, with time left: it holds on", () => {
    expect(reviewSecurityCaseAiHold(state())).toEqual({ outcome: null });
  });

  test("Resolved: the case is Contained with every containing step verified", () => {
    expect(
      reviewSecurityCaseAiHold(
        state({
          stage: SecurityCaseStage.Contained,
          isContainmentVerified: true,
        }),
      ),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.Resolved });
  });

  test("Resolved: the case is Closed", () => {
    expect(
      reviewSecurityCaseAiHold(state({ stage: SecurityCaseStage.Closed })),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.Resolved });
  });

  test("Contained, but not every step checked: people decide", () => {
    expect(
      reviewSecurityCaseAiHold(
        state({
          stage: SecurityCaseStage.Contained,
          isContainmentVerified: false,
        }),
      ),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.NotVerified });
  });

  test("resolved wins over the time running out at the same moment", () => {
    expect(
      reviewSecurityCaseAiHold(
        state({
          stage: SecurityCaseStage.Contained,
          isContainmentVerified: true,
          holdUntil: minutesAgo(1),
        }),
      ),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.Resolved });
  });

  test("handed to people: OneUptime AI asked a person to approve a step", () => {
    expect(
      reviewSecurityCaseAiHold(state({ isWaitingForApproval: true })),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.NeedsApproval });
    expect(
      reviewSecurityCaseAiHold(
        state({ responseState: SecurityCaseAiResponseState.WaitingForPeople }),
      ),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.NeedsApproval });
  });

  test("handed to people: OneUptime AI handed the case over (a hand-off rule, cannot tell)", () => {
    expect(
      reviewSecurityCaseAiHold(
        state({ responseState: SecurityCaseAiResponseState.HandedToPeople }),
      ),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.HandedOff });
  });

  test("handed to people: the hold time ran out", () => {
    expect(
      reviewSecurityCaseAiHold(state({ holdUntil: minutesAgo(0) })),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.TimeRanOut });
    expect(
      reviewSecurityCaseAiHold(state({ holdUntil: minutesFromNow(1) })),
    ).toEqual({ outcome: null });
  });

  test("handed to people: the triage read the case as anything but Likely Malicious", () => {
    for (const verdict of [
      SecurityCaseAiVerdict.LikelyBenign,
      SecurityCaseAiVerdict.LikelyFalsePositive,
      SecurityCaseAiVerdict.Inconclusive,
    ]) {
      expect(
        reviewSecurityCaseAiHold(
          state({ aiVerdict: verdict, responseState: null }),
        ),
      ).toEqual({ outcome: SecurityCaseAiHoldOutcome.NotMalicious });
    }
  });

  test("a person who asked OneUptime AI to work a benign case keeps it held while it works", () => {
    expect(
      reviewSecurityCaseAiHold(
        state({
          aiVerdict: SecurityCaseAiVerdict.LikelyBenign,
          responseState: SecurityCaseAiResponseState.Working,
        }),
      ),
    ).toEqual({ outcome: null });
  });

  test("handed to people: the triage did not finish", () => {
    for (const status of [
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ]) {
      expect(
        reviewSecurityCaseAiHold(
          state({
            aiVerdict: null,
            responseState: null,
            triageStatus: status,
          }),
        ),
      ).toEqual({ outcome: SecurityCaseAiHoldOutcome.NotStarted });
    }
  });

  test("no triage is given its grace, then handed to people", () => {
    expect(
      reviewSecurityCaseAiHold(
        state({
          aiVerdict: null,
          responseState: null,
          triageStatus: null,
          triageSettledAt: null,
          openedAt: minutesAgo(
            SECURITY_CASE_AI_HOLD_START_GRACE_IN_MINUTES - 1,
          ),
        }),
      ),
    ).toEqual({ outcome: null });
    expect(
      reviewSecurityCaseAiHold(
        state({
          aiVerdict: null,
          responseState: null,
          triageStatus: null,
          triageSettledAt: null,
          openedAt: minutesAgo(SECURITY_CASE_AI_HOLD_START_GRACE_IN_MINUTES),
        }),
      ),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.NotStarted });
  });

  test("a triage on its way holds on", () => {
    for (const status of [AIRunStatus.Queued, AIRunStatus.Running]) {
      expect(
        reviewSecurityCaseAiHold(
          state({
            aiVerdict: null,
            responseState: null,
            triageStatus: status,
            triageSettledAt: null,
            openedAt: minutesAgo(5),
          }),
        ),
      ).toEqual({ outcome: null });
    }
  });

  test("triaged as Likely Malicious and never taken up: its grace, then people", () => {
    expect(
      reviewSecurityCaseAiHold(
        state({
          responseState: null,
          triageStatus: AIRunStatus.Completed,
          triageSettledAt: minutesAgo(1),
        }),
      ),
    ).toEqual({ outcome: null });
    expect(
      reviewSecurityCaseAiHold(
        state({
          responseState: null,
          triageStatus: AIRunStatus.Completed,
          triageSettledAt: minutesAgo(
            SECURITY_CASE_AI_HOLD_START_GRACE_IN_MINUTES,
          ),
        }),
      ),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.NotStarted });
  });

  test("stopped: the case rose to a priority people are alerted for at once", () => {
    expect(
      reviewSecurityCaseAiHold(state({ isStillBelowThreshold: false })),
    ).toEqual({ outcome: SecurityCaseAiHoldOutcome.RoseInPriority });
  });

  test("handed to people: the setting, working cases or AI was turned off", () => {
    expect(reviewSecurityCaseAiHold(state({ isStillOn: false }))).toEqual({
      outcome: SecurityCaseAiHoldOutcome.TurnedOff,
    });
  });
});

describe("a Page On-Call step and the case's hold", () => {
  const onItsOwn: {
    trigger: string;
    isStartedByPerson: boolean;
    createdAt: Date;
  } = {
    trigger: SecurityPlaybookTrigger.CaseOpened,
    isStartedByPerson: false,
    createdAt: minutesAgo(5),
  };

  test("a case never held pages as the step says", () => {
    expect(
      decideSecurityCaseAiHoldPage({
        outcome: null,
        holdEndedAt: null,
        run: onItsOwn,
      }),
    ).toBe(SecurityCaseAiHoldPageDecision.Page);
  });

  test("a run that started on its own waits while the case is held: Case Opened, Detection Added, Triaged as Likely Malicious", () => {
    for (const trigger of [
      SecurityPlaybookTrigger.CaseOpened,
      SecurityPlaybookTrigger.DetectionAdded,
      SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    ]) {
      expect(
        decideSecurityCaseAiHoldPage({
          outcome: SecurityCaseAiHoldOutcome.Holding,
          holdEndedAt: null,
          run: { ...onItsOwn, trigger },
        }),
      ).toBe(SecurityCaseAiHoldPageDecision.Wait);
    }
  });

  test("a run a person started pages at once: they asked for it", () => {
    expect(
      decideSecurityCaseAiHoldPage({
        outcome: SecurityCaseAiHoldOutcome.Holding,
        holdEndedAt: null,
        run: { ...onItsOwn, isStartedByPerson: true },
      }),
    ).toBe(SecurityCaseAiHoldPageDecision.Page);
    expect(
      decideSecurityCaseAiHoldPage({
        outcome: SecurityCaseAiHoldOutcome.Holding,
        holdEndedAt: null,
        run: { ...onItsOwn, trigger: SecurityPlaybookTrigger.Manual },
      }),
    ).toBe(SecurityCaseAiHoldPageDecision.Page);
  });

  test("once the hold ends, a page that waited goes when people were alerted", () => {
    for (const outcome of [
      SecurityCaseAiHoldOutcome.NeedsApproval,
      SecurityCaseAiHoldOutcome.HandedOff,
      SecurityCaseAiHoldOutcome.TimeRanOut,
      SecurityCaseAiHoldOutcome.PageNow,
      SecurityCaseAiHoldOutcome.RoseInPriority,
      SecurityCaseAiHoldOutcome.ActiveAttack,
    ]) {
      expect(
        decideSecurityCaseAiHoldPage({
          outcome,
          holdEndedAt: minutesAgo(1),
          run: onItsOwn,
        }),
      ).toBe(SecurityCaseAiHoldPageDecision.Page);
    }
  });

  test("and is skipped when the case was resolved with nobody alerted, or a person took it", () => {
    for (const outcome of [
      SecurityCaseAiHoldOutcome.Resolved,
      SecurityCaseAiHoldOutcome.TakenByPerson,
    ]) {
      expect(
        decideSecurityCaseAiHoldPage({
          outcome,
          holdEndedAt: minutesAgo(1),
          run: onItsOwn,
        }),
      ).toBe(SecurityCaseAiHoldPageDecision.Skip);
    }
  });

  test("a run that started after the hold ended pages: the hold is over", () => {
    expect(
      decideSecurityCaseAiHoldPage({
        outcome: SecurityCaseAiHoldOutcome.Resolved,
        holdEndedAt: minutesAgo(10),
        run: {
          ...onItsOwn,
          trigger: SecurityPlaybookTrigger.DetectionAdded,
          createdAt: minutesAgo(2),
        },
      }),
    ).toBe(SecurityCaseAiHoldPageDecision.Page);
  });
});
