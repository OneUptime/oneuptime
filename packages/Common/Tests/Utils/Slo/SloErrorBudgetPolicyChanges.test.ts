import SloErrorBudgetPolicyChange from "../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import {
  SloDeploymentGateTransition,
  getSloErrorBudgetPolicyChanges,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import { describe, expect, test } from "@jest/globals";

/*
 * What one evaluation changed in an SLO's error budget policy, as the
 * Slack, Microsoft Teams and Mattermost rules for SLOs match it: the tier
 * change - entered, recovered, left - then how the deploy gate moved, or
 * nothing at all when neither did.
 */

describe("getSloErrorBudgetPolicyChanges", () => {
  test("entering a tier, from none or a less severe one, is an escalation", () => {
    expect(
      getSloErrorBudgetPolicyChanges({
        isTierChange: true,
        isInTier: true,
        isEscalation: true,
        deploymentGateTransition: null,
      }),
    ).toEqual([SloErrorBudgetPolicyChange.EnteredMoreSevereTier]);
  });

  test("moving to a less severe tier is a recovery", () => {
    expect(
      getSloErrorBudgetPolicyChanges({
        isTierChange: true,
        isInTier: true,
        isEscalation: false,
        deploymentGateTransition: null,
      }),
    ).toEqual([SloErrorBudgetPolicyChange.RecoveredToLessSevereTier]);
  });

  test("ending in no tier is leaving every tier, whatever escalation says", () => {
    for (const isEscalation of [true, false]) {
      expect(
        getSloErrorBudgetPolicyChanges({
          isTierChange: true,
          isInTier: false,
          isEscalation: isEscalation,
          deploymentGateTransition: null,
        }),
      ).toEqual([SloErrorBudgetPolicyChange.LeftEveryTier]);
    }
  });

  test("a tier change that froze deployments is both, the tier change first", () => {
    expect(
      getSloErrorBudgetPolicyChanges({
        isTierChange: true,
        isInTier: true,
        isEscalation: true,
        deploymentGateTransition: SloDeploymentGateTransition.Frozen,
      }),
    ).toEqual([
      SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
      SloErrorBudgetPolicyChange.DeploymentsFrozen,
    ]);
  });

  test("a recovery, or leaving every tier, that allowed deployments again is both", () => {
    expect(
      getSloErrorBudgetPolicyChanges({
        isTierChange: true,
        isInTier: true,
        isEscalation: false,
        deploymentGateTransition: SloDeploymentGateTransition.Allowed,
      }),
    ).toEqual([
      SloErrorBudgetPolicyChange.RecoveredToLessSevereTier,
      SloErrorBudgetPolicyChange.DeploymentsAllowed,
    ]);
    expect(
      getSloErrorBudgetPolicyChanges({
        isTierChange: true,
        isInTier: false,
        isEscalation: false,
        deploymentGateTransition: SloDeploymentGateTransition.Allowed,
      }),
    ).toEqual([
      SloErrorBudgetPolicyChange.LeftEveryTier,
      SloErrorBudgetPolicyChange.DeploymentsAllowed,
    ]);
  });

  test("Freeze Deployments switched on or off for the tier the SLO is in: the gate alone", () => {
    expect(
      getSloErrorBudgetPolicyChanges({
        isTierChange: false,
        isInTier: true,
        isEscalation: false,
        deploymentGateTransition: SloDeploymentGateTransition.Frozen,
      }),
    ).toEqual([SloErrorBudgetPolicyChange.DeploymentsFrozen]);
    expect(
      getSloErrorBudgetPolicyChanges({
        isTierChange: false,
        isInTier: true,
        isEscalation: false,
        deploymentGateTransition: SloDeploymentGateTransition.Allowed,
      }),
    ).toEqual([SloErrorBudgetPolicyChange.DeploymentsAllowed]);
  });

  test("nothing moved - the tier held under the hysteresis, or was only renamed - is no change", () => {
    for (const isInTier of [true, false]) {
      for (const isEscalation of [true, false]) {
        expect(
          getSloErrorBudgetPolicyChanges({
            isTierChange: false,
            isInTier: isInTier,
            isEscalation: isEscalation,
            deploymentGateTransition: null,
          }),
        ).toEqual([]);
      }
    }
  });

  test("never says a change twice, nor both directions of the gate", () => {
    const transitions: Array<SloDeploymentGateTransition | null> = [
      null,
      SloDeploymentGateTransition.Frozen,
      SloDeploymentGateTransition.Allowed,
    ];

    for (const isTierChange of [true, false]) {
      for (const isInTier of [true, false]) {
        for (const isEscalation of [true, false]) {
          for (const transition of transitions) {
            const changes: Array<SloErrorBudgetPolicyChange> =
              getSloErrorBudgetPolicyChanges({
                isTierChange,
                isInTier,
                isEscalation,
                deploymentGateTransition: transition,
              });

            expect(new Set(changes).size).toBe(changes.length);
            expect(changes.length).toBeLessThanOrEqual(2);
            expect(
              changes.includes(SloErrorBudgetPolicyChange.DeploymentsFrozen) &&
                changes.includes(SloErrorBudgetPolicyChange.DeploymentsAllowed),
            ).toBe(false);
          }
        }
      }
    }
  });
});
