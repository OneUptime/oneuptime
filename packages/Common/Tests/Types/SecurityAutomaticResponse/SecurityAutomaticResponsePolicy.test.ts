import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SECURITY_AUTOMATIC_RESPONSE_READY_KINDS,
  SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES,
  SECURITY_AUTOMATIC_RESPONSE_TRIAL_DAYS,
  SECURITY_AUTOMATIC_RESPONSE_TRIAL_IN_MS,
  SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_DAYS,
  SecurityAutomaticResponseMatch,
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyDefinition,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
  doesSecurityAutomaticResponseMatchNameAnything,
  getReadySecurityAutomaticResponsePolicy,
  getSecurityAutomaticResponseTrialDaysLeft,
  getSecurityAutomaticResponseTrialState,
  hasSecurityAutomaticResponseTrialFinished,
  isReadySecurityAutomaticResponsePolicyKind,
  isSecurityAutomaticResponseDuration,
  readMitreTechniqueId,
  readSecurityAutomaticResponseMatch,
  readSecurityAutomaticResponsePolicyDefinition,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { describe, expect, test } from "@jest/globals";

/*
 * Automatic response policies (#10350): the three ready policies, what a
 * project's own may match, the guardrails' numbers, and the trial run's
 * week - started, still running, finished, skipped or stopped - which
 * OneUptime AI working a case (#10352) reads too.
 */

const NOW: Date = new Date("2026-11-22T10:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_IN_MS);
}

describe("the ready policies", () => {
  test("three ship, in the order the page lists them", () => {
    expect(SECURITY_AUTOMATIC_RESPONSE_READY_KINDS).toEqual([
      SecurityAutomaticResponsePolicyKind.Scanners,
      SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
    ]);
    expect(
      SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES.map(
        (policy: SecurityAutomaticResponsePolicyDefinition) => {
          return policy.kind;
        },
      ),
    ).toEqual(SECURITY_AUTOMATIC_RESPONSE_READY_KINDS);
  });

  test("Scanners challenges for 1 hour, web scanning and exploit attempts, only while every request was turned away", () => {
    const scanners: SecurityAutomaticResponsePolicyDefinition =
      getReadySecurityAutomaticResponsePolicy(
        SecurityAutomaticResponsePolicyKind.Scanners,
      )!;

    expect(scanners.name).toBe("Scanners");
    expect(scanners.blockAction).toBe(SecurityBlockAction.Challenge);
    expect(scanners.duration).toBe(SecurityBlockDuration.OneHour);
    expect(scanners.match).toEqual({
      mitreTechniques: ["T1595", "T1190"],
      detectionRuleIds: [],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: true,
    });
  });

  test("Password Guessing blocks for 1 hour, brute force and password spraying", () => {
    const guessing: SecurityAutomaticResponsePolicyDefinition =
      getReadySecurityAutomaticResponsePolicy(
        SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      )!;

    expect(guessing.name).toBe("Password Guessing");
    expect(guessing.blockAction).toBe(SecurityBlockAction.Block);
    expect(guessing.duration).toBe(SecurityBlockDuration.OneHour);
    expect(guessing.match.mitreTechniques).toEqual(["T1110"]);
    expect(guessing.match.requiresEveryRequestTurnedAway).toBe(false);
  });

  test("Known-Bad Addresses blocks for 24 hours, any detection about an address threat intel lists", () => {
    const knownBad: SecurityAutomaticResponsePolicyDefinition =
      getReadySecurityAutomaticResponsePolicy(
        SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
      )!;

    expect(knownBad.name).toBe("Known-Bad Addresses");
    expect(knownBad.blockAction).toBe(SecurityBlockAction.Block);
    expect(knownBad.duration).toBe(SecurityBlockDuration.OneDay);
    expect(knownBad.match).toEqual({
      mitreTechniques: [],
      detectionRuleIds: [],
      requiresThreatIntel: true,
      requiresEveryRequestTurnedAway: false,
    });
  });

  test("a project's own is no ready policy", () => {
    expect(
      getReadySecurityAutomaticResponsePolicy(
        SecurityAutomaticResponsePolicyKind.Custom,
      ),
    ).toBeUndefined();
    expect(
      isReadySecurityAutomaticResponsePolicyKind(
        SecurityAutomaticResponsePolicyKind.Custom,
      ),
    ).toBe(false);
    expect(
      isReadySecurityAutomaticResponsePolicyKind(
        SecurityAutomaticResponsePolicyKind.Scanners,
      ),
    ).toBe(true);
  });
});

describe("the guardrails' numbers", () => {
  test("a week of trial run, 50 blocks an hour, and a month of signed-in users", () => {
    expect(SECURITY_AUTOMATIC_RESPONSE_TRIAL_DAYS).toBe(7);
    expect(SECURITY_AUTOMATIC_RESPONSE_TRIAL_IN_MS).toBe(7 * DAY_IN_MS);
    expect(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR).toBe(50);
    expect(SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_DAYS).toBe(30);
  });

  test("a policy's first block lasts 1 hour, 24 hours or 7 days: never 30 days or until lifted", () => {
    expect(
      isSecurityAutomaticResponseDuration(SecurityBlockDuration.OneHour),
    ).toBe(true);
    expect(
      isSecurityAutomaticResponseDuration(SecurityBlockDuration.OneDay),
    ).toBe(true);
    expect(
      isSecurityAutomaticResponseDuration(SecurityBlockDuration.SevenDays),
    ).toBe(true);
    expect(
      isSecurityAutomaticResponseDuration(SecurityBlockDuration.ThirtyDays),
    ).toBe(false);
    expect(
      isSecurityAutomaticResponseDuration(SecurityBlockDuration.UntilLifted),
    ).toBe(false);
    expect(isSecurityAutomaticResponseDuration("forever")).toBe(false);
  });
});

describe("what a project's own policy matches", () => {
  test("techniques are kept in capitals, sub-techniques too, and anything else is dropped", () => {
    expect(readMitreTechniqueId("t1110")).toBe("T1110");
    expect(readMitreTechniqueId(" T1110.003 ")).toBe("T1110.003");
    expect(readMitreTechniqueId("TA0006")).toBeNull();
    expect(readMitreTechniqueId("T11")).toBeNull();
    expect(readMitreTechniqueId(1110)).toBeNull();

    expect(
      readSecurityAutomaticResponseMatch({
        mitreTechniques: ["t1595", "nonsense", "T1595", 4],
        detectionRuleIds: [" a ", "a", "", 7],
        requiresThreatIntel: "yes",
        requiresEveryRequestTurnedAway: true,
      }),
    ).toEqual({
      mitreTechniques: ["T1595"],
      detectionRuleIds: ["a"],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: true,
    });
  });

  test("what cannot be read matches nothing more", () => {
    const blank: SecurityAutomaticResponseMatch =
      readSecurityAutomaticResponseMatch(null);

    expect(blank).toEqual({
      mitreTechniques: [],
      detectionRuleIds: [],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: false,
    });
    expect(readSecurityAutomaticResponseMatch("text")).toEqual(blank);
    expect(readSecurityAutomaticResponseMatch([1, 2])).toEqual(blank);
  });

  test("a policy must match on a technique, a rule or threat intel", () => {
    expect(
      doesSecurityAutomaticResponseMatchNameAnything(
        readSecurityAutomaticResponseMatch({}),
      ),
    ).toBe(false);
    expect(
      doesSecurityAutomaticResponseMatchNameAnything(
        readSecurityAutomaticResponseMatch({
          requiresEveryRequestTurnedAway: true,
        }),
      ),
    ).toBe(false);
    expect(
      doesSecurityAutomaticResponseMatchNameAnything(
        readSecurityAutomaticResponseMatch({ mitreTechniques: ["T1046"] }),
      ),
    ).toBe(true);
    expect(
      doesSecurityAutomaticResponseMatchNameAnything(
        readSecurityAutomaticResponseMatch({ detectionRuleIds: ["rule"] }),
      ),
    ).toBe(true);
    expect(
      doesSecurityAutomaticResponseMatchNameAnything(
        readSecurityAutomaticResponseMatch({ requiresThreatIntel: true }),
      ),
    ).toBe(true);
  });

  test("a ready policy runs as this file says, whatever its row holds", () => {
    expect(
      readSecurityAutomaticResponsePolicyDefinition({
        kind: SecurityAutomaticResponsePolicyKind.Scanners,
        name: "Renamed",
        blockAction: SecurityBlockAction.Block,
        duration: SecurityBlockDuration.SevenDays,
        matchConditions: { mitreTechniques: ["T1046"] },
      }),
    ).toEqual(
      getReadySecurityAutomaticResponsePolicy(
        SecurityAutomaticResponsePolicyKind.Scanners,
      ),
    );
  });

  test("a project's own runs as its row says, with the blank policy's where it cannot be read", () => {
    expect(
      readSecurityAutomaticResponsePolicyDefinition({
        kind: SecurityAutomaticResponsePolicyKind.Custom,
        name: " Port scans ",
        blockAction: SecurityBlockAction.Challenge,
        duration: SecurityBlockDuration.OneDay,
        matchConditions: { mitreTechniques: ["T1046"] },
      }),
    ).toEqual({
      kind: SecurityAutomaticResponsePolicyKind.Custom,
      name: "Port scans",
      description: "",
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.OneDay,
      match: {
        mitreTechniques: ["T1046"],
        detectionRuleIds: [],
        requiresThreatIntel: false,
        requiresEveryRequestTurnedAway: false,
      },
    });

    const unreadable: SecurityAutomaticResponsePolicyDefinition =
      readSecurityAutomaticResponsePolicyDefinition({
        kind: "Something else",
        blockAction: "Burn",
        duration: SecurityBlockDuration.UntilLifted,
      });

    expect(unreadable.blockAction).toBe(SecurityBlockAction.Block);
    expect(unreadable.duration).toBe(SecurityBlockDuration.OneHour);
  });
});

describe("the trial run", () => {
  test("never started: off, with no trial behind it", () => {
    const policy: { mode: SecurityAutomaticResponseMode } = {
      mode: SecurityAutomaticResponseMode.Off,
    };

    expect(getSecurityAutomaticResponseTrialState(policy, NOW)).toBe(
      SecurityAutomaticResponseTrialState.NotStarted,
    );
    expect(hasSecurityAutomaticResponseTrialFinished(policy, NOW)).toBe(false);
  });

  test("running until its week is up, with the days left", () => {
    const policy: {
      mode: SecurityAutomaticResponseMode;
      trialStartedAt: Date;
      trialEndsAt: Date;
    } = {
      mode: SecurityAutomaticResponseMode.TrialRun,
      trialStartedAt: daysFromNow(-2),
      trialEndsAt: daysFromNow(5),
    };

    expect(getSecurityAutomaticResponseTrialState(policy, NOW)).toBe(
      SecurityAutomaticResponseTrialState.Running,
    );
    expect(hasSecurityAutomaticResponseTrialFinished(policy, NOW)).toBe(false);
    expect(getSecurityAutomaticResponseTrialDaysLeft(policy, NOW)).toBe(5);
    expect(
      getSecurityAutomaticResponseTrialDaysLeft(
        { trialEndsAt: new Date(NOW.getTime() + 60 * 1000) },
        NOW,
      ),
    ).toBe(1);
  });

  test("finished once its week is up, even before anyone turns it on", () => {
    const policy: {
      mode: SecurityAutomaticResponseMode;
      trialStartedAt: Date;
      trialEndsAt: Date;
    } = {
      mode: SecurityAutomaticResponseMode.TrialRun,
      trialStartedAt: daysFromNow(-7),
      trialEndsAt: NOW,
    };

    expect(hasSecurityAutomaticResponseTrialFinished(policy, NOW)).toBe(true);
    expect(getSecurityAutomaticResponseTrialState(policy, NOW)).toBe(
      SecurityAutomaticResponseTrialState.Finished,
    );
    expect(getSecurityAutomaticResponseTrialDaysLeft(policy, NOW)).toBe(0);
  });

  test("finished stays finished once it is turned on, or off, after its week", () => {
    for (const mode of [
      SecurityAutomaticResponseMode.On,
      SecurityAutomaticResponseMode.Off,
    ]) {
      const policy: {
        mode: SecurityAutomaticResponseMode;
        trialEndsAt: Date;
        trialFinishedAt: Date;
      } = {
        mode,
        trialEndsAt: daysFromNow(-3),
        trialFinishedAt: daysFromNow(-3),
      };

      expect(hasSecurityAutomaticResponseTrialFinished(policy, NOW)).toBe(true);
      expect(getSecurityAutomaticResponseTrialState(policy, NOW)).toBe(
        SecurityAutomaticResponseTrialState.Finished,
      );
    }
  });

  test("skipped: on before its week was up, which never finished a trial", () => {
    const policy: {
      mode: SecurityAutomaticResponseMode;
      trialStartedAt: Date;
      trialEndsAt: Date;
      trialSkippedAt: Date;
    } = {
      mode: SecurityAutomaticResponseMode.On,
      trialStartedAt: daysFromNow(-2),
      trialEndsAt: daysFromNow(5),
      trialSkippedAt: daysFromNow(-1),
    };

    expect(hasSecurityAutomaticResponseTrialFinished(policy, NOW)).toBe(false);
    expect(getSecurityAutomaticResponseTrialState(policy, NOW)).toBe(
      SecurityAutomaticResponseTrialState.Skipped,
    );
    expect(
      getSecurityAutomaticResponseTrialState(
        { mode: SecurityAutomaticResponseMode.On },
        NOW,
      ),
    ).toBe(SecurityAutomaticResponseTrialState.Skipped);
  });

  test("stopped: turned off part way through its week, which never finished a trial", () => {
    const policy: {
      mode: SecurityAutomaticResponseMode;
      trialStartedAt: Date;
      trialEndsAt: Date;
    } = {
      mode: SecurityAutomaticResponseMode.Off,
      trialStartedAt: daysFromNow(-2),
      trialEndsAt: daysFromNow(5),
    };

    expect(hasSecurityAutomaticResponseTrialFinished(policy, NOW)).toBe(false);
    expect(getSecurityAutomaticResponseTrialState(policy, NOW)).toBe(
      SecurityAutomaticResponseTrialState.Stopped,
    );
  });

  test("a week ended in the past on a policy now off was never finished unless it was written down", () => {
    expect(
      hasSecurityAutomaticResponseTrialFinished(
        {
          mode: SecurityAutomaticResponseMode.Off,
          trialEndsAt: daysFromNow(-1),
        },
        NOW,
      ),
    ).toBe(false);
  });

  test("dates written as text are read, and broken ones ignored", () => {
    expect(
      hasSecurityAutomaticResponseTrialFinished(
        {
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialEndsAt: daysFromNow(-1).toISOString(),
        },
        NOW,
      ),
    ).toBe(true);
    expect(
      hasSecurityAutomaticResponseTrialFinished(
        {
          mode: SecurityAutomaticResponseMode.TrialRun,
          trialEndsAt: "not a date",
        },
        NOW,
      ),
    ).toBe(false);
  });
});
