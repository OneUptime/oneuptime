import {
  SECURITY_CASE_AI_ACTION_AREAS,
  SECURITY_CASE_AI_ACTION_KINDS,
  SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR,
  SECURITY_CASE_AI_ALWAYS_ASKS,
  SECURITY_CASE_AI_AREAS,
  SECURITY_CASE_AI_CONTAINMENT_AREAS,
  SECURITY_CASE_AI_DEFAULT_MODES,
  SECURITY_CASE_AI_MODES,
  SECURITY_CASE_AI_MODE_COLUMNS,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiArea,
  SecurityCaseAiDecision,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiEdgeClearance,
  SecurityCaseAiLimits,
  SecurityCaseAiMode,
  decideSecurityCaseAiAction,
  getEdgeOnItsOwnClearance,
  getSecurityCaseAiClosingVerdict,
  isDismissingVerdict,
  isSecurityCaseAiBreakerTripped,
  readSecurityCaseAiLimits,
  readSecurityCaseAiMode,
  readSecurityCaseAiOnItsOwnStamps,
} from "../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ONEUPTIME AI MAY DO ON A CASE (#10352), as the project sets it: each
 * kind of action Off, Ask or On its own, and what the responder makes of
 * that for every action it takes. A doubt falls toward a person: a mode it
 * cannot read is Off, and Edge set to On its own asks until a Security
 * Admin confirmed it.
 */

const CONFIRMED: SecurityCaseAiLimits["stamps"] = {
  [SecurityCaseAiArea.Edge]: {
    byUserId: "11111111-1111-4111-8111-111111111111",
    at: "2026-11-20T10:00:00.000Z",
  },
};

function limitsWith(
  mode: SecurityCaseAiMode,
  stamps: SecurityCaseAiLimits["stamps"] = CONFIRMED,
): SecurityCaseAiLimits {
  const modes: Record<SecurityCaseAiArea, SecurityCaseAiMode> = {} as Record<
    SecurityCaseAiArea,
    SecurityCaseAiMode
  >;

  for (const area of SECURITY_CASE_AI_AREAS) {
    modes[area] = mode;
  }

  return { isOn: true, modes, stamps };
}

describe("every kind of action, under every setting", () => {
  const settled: Array<SecurityCaseAiActionKind> =
    SECURITY_CASE_AI_ACTION_KINDS.filter(
      (kind: SecurityCaseAiActionKind): boolean => {
        return SECURITY_CASE_AI_ACTION_AREAS[kind] !== null;
      },
    );

  test.each(settled)(
    "%s: Off leaves it to a person",
    (kind: SecurityCaseAiActionKind) => {
      expect(
        decideSecurityCaseAiAction({
          kind,
          limits: limitsWith(SecurityCaseAiMode.Off),
        }),
      ).toEqual({
        decision: SecurityCaseAiDecisionKind.Leave,
        reason: SecurityCaseAiActionReason.SettingOff,
        mode: SecurityCaseAiMode.Off,
      });
    },
  );

  test.each(settled)(
    "%s: Ask asks a person first",
    (kind: SecurityCaseAiActionKind) => {
      expect(
        decideSecurityCaseAiAction({
          kind,
          limits: limitsWith(SecurityCaseAiMode.Ask),
        }),
      ).toEqual({
        decision: SecurityCaseAiDecisionKind.Ask,
        reason: SecurityCaseAiActionReason.SettingAsks,
        mode: SecurityCaseAiMode.Ask,
      });
    },
  );

  test.each(settled)(
    "%s: On its own does it, but for what always asks",
    (kind: SecurityCaseAiActionKind) => {
      const decision: SecurityCaseAiDecision = decideSecurityCaseAiAction({
        kind,
        limits: limitsWith(SecurityCaseAiMode.OnItsOwn),
      });

      expect(decision).toEqual(
        SECURITY_CASE_AI_ALWAYS_ASKS.includes(kind)
          ? {
              decision: SecurityCaseAiDecisionKind.Ask,
              reason: SecurityCaseAiActionReason.AlwaysAsks,
              mode: SecurityCaseAiMode.OnItsOwn,
            }
          : {
              decision: SecurityCaseAiDecisionKind.Do,
              reason: SecurityCaseAiActionReason.OnItsOwn,
              mode: SecurityCaseAiMode.OnItsOwn,
            },
      );
    },
  );

  test("a step no setting covers is a person's, whatever the settings say", () => {
    for (const kind of [
      SecurityCaseAiActionKind.StepForPeople,
      SecurityCaseAiActionKind.HandToPeople,
    ]) {
      for (const mode of SECURITY_CASE_AI_MODES) {
        expect(
          decideSecurityCaseAiAction({ kind, limits: limitsWith(mode) }),
        ).toEqual({
          decision: SecurityCaseAiDecisionKind.Leave,
          reason: SecurityCaseAiActionReason.NoWayToDoIt,
          mode: null,
        });
      }
    }
  });

  test("declaring an incident and offering a rule exception always ask", () => {
    expect([...SECURITY_CASE_AI_ALWAYS_ASKS].sort()).toEqual(
      [
        SecurityCaseAiActionKind.DeclareIncident,
        SecurityCaseAiActionKind.OfferRuleException,
      ].sort(),
    );
  });

  test("each kind is set under the row people read it under", () => {
    expect(SECURITY_CASE_AI_ACTION_AREAS).toEqual({
      TakeCase: SecurityCaseAiArea.Case,
      SetPriority: SecurityCaseAiArea.Case,
      MarkStepDone: SecurityCaseAiArea.Case,
      MarkContained: SecurityCaseAiArea.Case,
      DeclareIncident: SecurityCaseAiArea.Case,
      BlockAddress: SecurityCaseAiArea.Edge,
      ContainAccount: SecurityCaseAiArea.Accounts,
      ContainHost: SecurityCaseAiArea.Hosts,
      RequestCodeFix: SecurityCaseAiArea.Code,
      CloseCase: SecurityCaseAiArea.Close,
      LiftBlock: SecurityCaseAiArea.Close,
      OfferRuleException: SecurityCaseAiArea.Close,
      StepForPeople: null,
      HandToPeople: null,
    });
  });
});

describe("Edge's On its own waits for a Security Admin, or the Scanners policy's trial", () => {
  test("not confirmed: it asks, and says why", () => {
    expect(
      decideSecurityCaseAiAction({
        kind: SecurityCaseAiActionKind.BlockAddress,
        limits: limitsWith(SecurityCaseAiMode.OnItsOwn, {}),
      }),
    ).toEqual({
      decision: SecurityCaseAiDecisionKind.Ask,
      reason: SecurityCaseAiActionReason.EdgeNotCleared,
      mode: SecurityCaseAiMode.OnItsOwn,
    });
  });

  test("a Security Admin confirmed it: it blocks on its own", () => {
    expect(
      decideSecurityCaseAiAction({
        kind: SecurityCaseAiActionKind.BlockAddress,
        limits: limitsWith(SecurityCaseAiMode.OnItsOwn),
      }).decision,
    ).toBe(SecurityCaseAiDecisionKind.Do);
    expect(getEdgeOnItsOwnClearance({ stamps: CONFIRMED })).toBe(
      SecurityCaseAiEdgeClearance.ConfirmedBySecurityAdmin,
    );
  });

  test("the Scanners policy finished its trial: that clears it too", () => {
    expect(
      decideSecurityCaseAiAction({
        kind: SecurityCaseAiActionKind.BlockAddress,
        limits: limitsWith(SecurityCaseAiMode.OnItsOwn, {}),
        hasScannersPolicyFinishedTrial: true,
      }).decision,
    ).toBe(SecurityCaseAiDecisionKind.Do);
    expect(
      getEdgeOnItsOwnClearance({
        stamps: {},
        hasScannersPolicyFinishedTrial: true,
      }),
    ).toBe(SecurityCaseAiEdgeClearance.ScannersPolicyTrial);
    expect(getEdgeOnItsOwnClearance({ stamps: {} })).toBe(
      SecurityCaseAiEdgeClearance.NotCleared,
    );
  });

  test("the other containment kinds need no more than their setting", () => {
    for (const kind of [
      SecurityCaseAiActionKind.ContainAccount,
      SecurityCaseAiActionKind.ContainHost,
    ]) {
      expect(
        decideSecurityCaseAiAction({
          kind,
          limits: limitsWith(SecurityCaseAiMode.OnItsOwn, {}),
        }).decision,
      ).toBe(SecurityCaseAiDecisionKind.Do);
    }
  });
});

describe("reading the project's settings", () => {
  test("a mode it cannot read is Off: a doubt falls toward a person", () => {
    expect(readSecurityCaseAiMode("OnItsOwn")).toBe(
      SecurityCaseAiMode.OnItsOwn,
    );
    expect(readSecurityCaseAiMode("Ask")).toBe(SecurityCaseAiMode.Ask);

    for (const value of [undefined, null, "", "on its own", 1, {}]) {
      expect(readSecurityCaseAiMode(value)).toBe(SecurityCaseAiMode.Off);
    }
  });

  test("the switch is on only when it is true", () => {
    expect(readSecurityCaseAiLimits(null).isOn).toBe(false);
    expect(
      readSecurityCaseAiLimits({ enableAutomaticSecurityCaseResponse: true })
        .isOn,
    ).toBe(true);
    expect(
      readSecurityCaseAiLimits({ enableAutomaticSecurityCaseResponse: false })
        .isOn,
    ).toBe(false);
  });

  test("each row from its own column", () => {
    const limits: SecurityCaseAiLimits = readSecurityCaseAiLimits({
      enableAutomaticSecurityCaseResponse: true,
      securityCaseAiCaseMode: "OnItsOwn",
      securityCaseAiEdgeMode: "Ask",
      securityCaseAiAccountsMode: "Off",
      securityCaseAiHostsMode: "Ask",
      securityCaseAiCodeMode: "OnItsOwn",
      securityCaseAiCloseMode: "Ask",
    });

    expect(limits.modes).toEqual({
      Case: SecurityCaseAiMode.OnItsOwn,
      Edge: SecurityCaseAiMode.Ask,
      Accounts: SecurityCaseAiMode.Off,
      Hosts: SecurityCaseAiMode.Ask,
      Code: SecurityCaseAiMode.OnItsOwn,
      Close: SecurityCaseAiMode.Ask,
    });
    expect(Object.keys(SECURITY_CASE_AI_MODE_COLUMNS).sort()).toEqual(
      [...SECURITY_CASE_AI_AREAS].sort(),
    );
  });

  test("a stamp is kept only when it says when; anything else in the column is dropped", () => {
    expect(
      readSecurityCaseAiOnItsOwnStamps({
        Edge: { byUserId: "u1", at: "2026-11-20T10:00:00.000Z" },
        Accounts: { at: "not a date" },
        Hosts: "yes",
        Unknown: { at: "2026-11-20T10:00:00.000Z" },
      }),
    ).toEqual({
      Edge: { byUserId: "u1", at: "2026-11-20T10:00:00.000Z" },
    });
    expect(readSecurityCaseAiOnItsOwnStamps(null)).toEqual({});
    expect(readSecurityCaseAiOnItsOwnStamps([])).toEqual({});
  });

  test("new projects start as the issue recommends: the case and the code on their own, the rest asked", () => {
    expect(SECURITY_CASE_AI_DEFAULT_MODES).toEqual({
      Case: SecurityCaseAiMode.OnItsOwn,
      Edge: SecurityCaseAiMode.Ask,
      Accounts: SecurityCaseAiMode.Ask,
      Hosts: SecurityCaseAiMode.Ask,
      Code: SecurityCaseAiMode.OnItsOwn,
      Close: SecurityCaseAiMode.Ask,
    });
    expect([...SECURITY_CASE_AI_CONTAINMENT_AREAS]).toEqual([
      SecurityCaseAiArea.Edge,
      SecurityCaseAiArea.Accounts,
      SecurityCaseAiArea.Hosts,
    ]);
  });
});

describe("closing, and the hourly limit", () => {
  test("a case closes with the verdict its read suggests; Inconclusive is a person's", () => {
    expect(
      getSecurityCaseAiClosingVerdict(SecurityCaseAiVerdict.LikelyMalicious),
    ).toBe(SecurityCaseVerdict.TruePositive);
    expect(
      getSecurityCaseAiClosingVerdict(SecurityCaseAiVerdict.LikelyBenign),
    ).toBe(SecurityCaseVerdict.BenignPositive);
    expect(
      getSecurityCaseAiClosingVerdict(
        SecurityCaseAiVerdict.LikelyFalsePositive,
      ),
    ).toBe(SecurityCaseVerdict.FalsePositive);
    expect(
      getSecurityCaseAiClosingVerdict(SecurityCaseAiVerdict.Inconclusive),
    ).toBeNull();
    expect(getSecurityCaseAiClosingVerdict(null)).toBeNull();
  });

  test("only a false positive or a benign case lifts its blocks and offers an exception", () => {
    expect(isDismissingVerdict(SecurityCaseVerdict.FalsePositive)).toBe(true);
    expect(isDismissingVerdict(SecurityCaseVerdict.BenignPositive)).toBe(true);
    expect(isDismissingVerdict(SecurityCaseVerdict.TruePositive)).toBe(false);
    expect(isDismissingVerdict(null)).toBe(false);
  });

  test("the breaker trips at the hour's limit, not before", () => {
    expect(SECURITY_CASE_AI_ACTIONS_ON_ITS_OWN_PER_HOUR).toBe(10);
    expect(isSecurityCaseAiBreakerTripped(9)).toBe(false);
    expect(isSecurityCaseAiBreakerTripped(10)).toBe(true);
    expect(isSecurityCaseAiBreakerTripped(11)).toBe(true);
  });
});
