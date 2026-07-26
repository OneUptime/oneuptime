import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  canSloFireBurnRateAlerts,
  isBurnRateRuleFiring,
} from "../../../Utils/Slo/SloBurnRateRuleState";

const FIRED_AT: Date = new Date("2026-07-25T10:00:00.000Z");

describe("SloBurnRateRuleState", () => {
  describe("isBurnRateRuleFiring", () => {
    it("is false for a rule that has never fired", () => {
      expect(isBurnRateRuleFiring({})).toBe(false);
      expect(
        isBurnRateRuleFiring({
          lastAlertCreatedAt: null,
          lastAlertResolvedAt: null,
        }),
      ).toBe(false);
    });

    it("is true when a fire has never been resolved", () => {
      expect(isBurnRateRuleFiring({ lastAlertCreatedAt: FIRED_AT })).toBe(true);
    });

    it("is false when the resolve is newer than the fire", () => {
      expect(
        isBurnRateRuleFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: new Date("2026-07-25T10:30:00.000Z"),
        }),
      ).toBe(false);
    });

    it("is true when the rule re-fired after an older resolve", () => {
      expect(
        isBurnRateRuleFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: new Date("2026-07-25T09:00:00.000Z"),
        }),
      ).toBe(true);
    });

    it("treats an equal-timestamp pair as resolved, not firing", () => {
      /*
       * The worker always writes the resolve strictly after the fire, so
       * an equal pair can only be one lifecycle — leaving a red "Firing"
       * pill on a rule with nothing open would be the worse error.
       */
      expect(
        isBurnRateRuleFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: new Date(FIRED_AT.getTime()),
        }),
      ).toBe(false);
    });

    it("is false when only a resolve is recorded", () => {
      // Defensive: a resolve with no fire is not a firing state.
      expect(isBurnRateRuleFiring({ lastAlertResolvedAt: FIRED_AT })).toBe(
        false,
      );
    });
  });

  describe("canSloFireBurnRateAlerts", () => {
    it("is true for a healthy, enabled SLO", () => {
      expect(
        canSloFireBurnRateAlerts({
          isEnabled: true,
          sloStatus: SloStatus.Healthy,
        }),
      ).toBe(true);
    });

    it("is true while the budget is at risk or exhausted — that is when rules fire", () => {
      expect(
        canSloFireBurnRateAlerts({
          isEnabled: true,
          sloStatus: SloStatus.AtRisk,
        }),
      ).toBe(true);
      expect(
        canSloFireBurnRateAlerts({
          isEnabled: true,
          sloStatus: SloStatus.BudgetExhausted,
        }),
      ).toBe(true);
    });

    it("is false for a disabled SLO", () => {
      /*
       * Disabling resolves every open alert without stamping the rule's
       * lastAlertResolvedAt, so the rule columns alone would still read as
       * firing.
       */
      expect(
        canSloFireBurnRateAlerts({
          isEnabled: false,
          sloStatus: SloStatus.AtRisk,
        }),
      ).toBe(false);
    });

    it("is false for the two guard statuses that resolve without stamping", () => {
      expect(
        canSloFireBurnRateAlerts({
          isEnabled: true,
          sloStatus: SloStatus.Misconfigured,
        }),
      ).toBe(false);
      expect(
        canSloFireBurnRateAlerts({
          isEnabled: true,
          sloStatus: SloStatus.Paused,
        }),
      ).toBe(false);
    });

    it("stays optimistic when the fields were not loaded", () => {
      // Never hide a genuinely firing rule because a fetch has not landed.
      expect(canSloFireBurnRateAlerts({})).toBe(true);
    });
  });
});
