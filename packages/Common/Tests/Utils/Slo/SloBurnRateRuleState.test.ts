import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  canSloFireBurnRateRules,
  isBurnRateRuleAlertFiring,
  isBurnRateRuleFiring,
  isBurnRateRuleIncidentFiring,
  SloBurnRateRuleState,
} from "../../../Utils/Slo/SloBurnRateRuleState";

/** The instant the worker stamped the fire. Every other timestamp is relative to it. */
const FIRED_AT: Date = new Date("2026-07-25T10:00:00.000Z");

/** The resolve that closed the fire above. */
const RESOLVED_AFTER_FIRE: Date = new Date("2026-07-25T10:30:00.000Z");

/** A resolve left over from the PREVIOUS lifecycle, which the fire above re-opened. */
const RESOLVED_BEFORE_FIRE: Date = new Date("2026-07-25T09:00:00.000Z");

describe("SloBurnRateRuleState", () => {
  describe("isBurnRateRuleAlertFiring", () => {
    it("is false for a rule that has never fired", () => {
      expect(isBurnRateRuleAlertFiring({})).toBe(false);
    });

    it("is false for every empty spelling of the alert columns", () => {
      /*
       * A column the worker has never written comes back null, while a column
       * the caller did not select comes back undefined. The table sees both
       * spellings and neither one is a fire.
       */
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: null,
          lastAlertResolvedAt: null,
        }),
      ).toBe(false);
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: undefined,
          lastAlertResolvedAt: undefined,
        }),
      ).toBe(false);
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: null,
          lastAlertResolvedAt: undefined,
        }),
      ).toBe(false);
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: undefined,
          lastAlertResolvedAt: null,
        }),
      ).toBe(false);
    });

    it("is true when a fire has never been resolved", () => {
      /*
       * The open state the "Firing" pill exists to show, in all three spellings
       * of "no resolve yet".
       */
      expect(isBurnRateRuleAlertFiring({ lastAlertCreatedAt: FIRED_AT })).toBe(
        true,
      );
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: null,
        }),
      ).toBe(true);
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: undefined,
        }),
      ).toBe(true);
    });

    it("is true when the rule re-fired after an older resolve", () => {
      /*
       * The columns are overwritten in place rather than appended to, so a
       * stale resolve from the previous lifecycle sits beside the live fire.
       */
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: RESOLVED_BEFORE_FIRE,
        }),
      ).toBe(true);
    });

    it("is false when the resolve is newer than the fire", () => {
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: RESOLVED_AFTER_FIRE,
        }),
      ).toBe(false);
    });

    it("treats an equal-timestamp pair as resolved, not firing", () => {
      /*
       * The worker always writes the resolve strictly after the fire, so an
       * equal pair can only be one lifecycle that opened and closed inside the
       * same millisecond. Leaving a red "Firing" pill on a rule with nothing
       * open would be the worse error, so the tie breaks towards resolved.
       */
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: FIRED_AT,
          lastAlertResolvedAt: new Date(FIRED_AT.getTime()),
        }),
      ).toBe(false);
    });

    it("is false when only a resolve is recorded", () => {
      /*
       * Defensive: a resolve with no fire is not a firing state, however the
       * missing fire is spelled.
       */
      expect(isBurnRateRuleAlertFiring({ lastAlertResolvedAt: FIRED_AT })).toBe(
        false,
      );
      expect(
        isBurnRateRuleAlertFiring({
          lastAlertCreatedAt: null,
          lastAlertResolvedAt: FIRED_AT,
        }),
      ).toBe(false);
    });

    it("ignores the incident columns entirely", () => {
      /*
       * Guards the twin predicates against being wired to each other's
       * columns: an open incident on a rule that never raised an alert must
       * not make the alert side read as firing.
       */
      const incidentOnly: SloBurnRateRuleState = {
        lastIncidentCreatedAt: FIRED_AT,
      };

      expect(isBurnRateRuleAlertFiring(incidentOnly)).toBe(false);
    });
  });

  describe("isBurnRateRuleIncidentFiring", () => {
    it("is false for a rule that has never declared an incident", () => {
      expect(isBurnRateRuleIncidentFiring({})).toBe(false);
    });

    it("is false for every empty spelling of the incident columns", () => {
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: null,
          lastIncidentResolvedAt: null,
        }),
      ).toBe(false);
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: undefined,
          lastIncidentResolvedAt: undefined,
        }),
      ).toBe(false);
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: null,
          lastIncidentResolvedAt: undefined,
        }),
      ).toBe(false);
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: undefined,
          lastIncidentResolvedAt: null,
        }),
      ).toBe(false);
    });

    it("is true when a declared incident has never been resolved", () => {
      expect(
        isBurnRateRuleIncidentFiring({ lastIncidentCreatedAt: FIRED_AT }),
      ).toBe(true);
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: FIRED_AT,
          lastIncidentResolvedAt: null,
        }),
      ).toBe(true);
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: FIRED_AT,
          lastIncidentResolvedAt: undefined,
        }),
      ).toBe(true);
    });

    it("is true when the rule re-declared after an older resolve", () => {
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: FIRED_AT,
          lastIncidentResolvedAt: RESOLVED_BEFORE_FIRE,
        }),
      ).toBe(true);
    });

    it("is false when the resolve is newer than the declaration", () => {
      /*
       * This is also the responder-resolved-by-hand case: the worker stamps
       * the resolve it observed and must not re-declare while the burn goes on.
       */
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: FIRED_AT,
          lastIncidentResolvedAt: RESOLVED_AFTER_FIRE,
        }),
      ).toBe(false);
    });

    it("treats an equal-timestamp pair as resolved, not firing", () => {
      /*
       * Same tie-break as the alert side, and pinned separately because the
       * two predicates are free to drift apart: the worker writes the resolve
       * strictly after the declaration, so an equal pair is one closed
       * lifecycle rather than a live incident.
       */
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: FIRED_AT,
          lastIncidentResolvedAt: new Date(FIRED_AT.getTime()),
        }),
      ).toBe(false);
    });

    it("is false when only a resolve is recorded", () => {
      expect(
        isBurnRateRuleIncidentFiring({ lastIncidentResolvedAt: FIRED_AT }),
      ).toBe(false);
      expect(
        isBurnRateRuleIncidentFiring({
          lastIncidentCreatedAt: null,
          lastIncidentResolvedAt: FIRED_AT,
        }),
      ).toBe(false);
    });

    it("ignores the alert columns entirely", () => {
      /*
       * The realistic bug when writing this twin is copying the alert
       * predicate and forgetting to rename the columns. A rule that is paging
       * on an alert but declared no incident is exactly the row that would
       * then wrongly show an incident as open — and the worker would skip
       * declaring the incident it owes.
       */
      const alertOnly: SloBurnRateRuleState = {
        lastAlertCreatedAt: FIRED_AT,
      };

      expect(isBurnRateRuleIncidentFiring(alertOnly)).toBe(false);
    });
  });

  describe("isBurnRateRuleFiring", () => {
    it("is false when neither output has ever opened", () => {
      expect(isBurnRateRuleFiring({})).toBe(false);

      const neverFired: SloBurnRateRuleState = {
        lastAlertCreatedAt: null,
        lastAlertResolvedAt: null,
        lastIncidentCreatedAt: null,
        lastIncidentResolvedAt: null,
      };

      expect(isBurnRateRuleFiring(neverFired)).toBe(false);
    });

    it("is true when only the alert is open", () => {
      /*
       * An alert-only rule is the model default (shouldCreateIncident false),
       * so this is the common shape of a firing row.
       */
      const alertOnly: SloBurnRateRuleState = {
        lastAlertCreatedAt: FIRED_AT,
      };

      expect(isBurnRateRuleFiring(alertOnly)).toBe(true);
    });

    it("is true when only the incident is open", () => {
      /*
       * An incident-only rule (shouldCreateAlert false) must light the same
       * pill; the reader cares that something is open, not which table it is in.
       */
      const incidentOnly: SloBurnRateRuleState = {
        lastIncidentCreatedAt: FIRED_AT,
      };

      expect(isBurnRateRuleFiring(incidentOnly)).toBe(true);
    });

    it("is true when both outputs are open", () => {
      const both: SloBurnRateRuleState = {
        lastAlertCreatedAt: FIRED_AT,
        lastIncidentCreatedAt: FIRED_AT,
      };

      expect(isBurnRateRuleFiring(both)).toBe(true);
    });

    it("is true when the alert is still open after the incident was resolved", () => {
      /*
       * The two lifecycles close independently — a responder can resolve the
       * incident while the alert keeps paging — so the OR must not be narrowed
       * to an AND.
       */
      const alertOpenIncidentClosed: SloBurnRateRuleState = {
        lastAlertCreatedAt: FIRED_AT,
        lastIncidentCreatedAt: FIRED_AT,
        lastIncidentResolvedAt: RESOLVED_AFTER_FIRE,
      };

      expect(isBurnRateRuleFiring(alertOpenIncidentClosed)).toBe(true);
      expect(isBurnRateRuleAlertFiring(alertOpenIncidentClosed)).toBe(true);
      expect(isBurnRateRuleIncidentFiring(alertOpenIncidentClosed)).toBe(false);
    });

    it("is true when the incident is still open after the alert was resolved", () => {
      const incidentOpenAlertClosed: SloBurnRateRuleState = {
        lastAlertCreatedAt: FIRED_AT,
        lastAlertResolvedAt: RESOLVED_AFTER_FIRE,
        lastIncidentCreatedAt: FIRED_AT,
      };

      expect(isBurnRateRuleFiring(incidentOpenAlertClosed)).toBe(true);
      expect(isBurnRateRuleAlertFiring(incidentOpenAlertClosed)).toBe(false);
      expect(isBurnRateRuleIncidentFiring(incidentOpenAlertClosed)).toBe(true);
    });

    it("is false once both outputs have been resolved", () => {
      const bothClosed: SloBurnRateRuleState = {
        lastAlertCreatedAt: FIRED_AT,
        lastAlertResolvedAt: RESOLVED_AFTER_FIRE,
        lastIncidentCreatedAt: FIRED_AT,
        lastIncidentResolvedAt: RESOLVED_AFTER_FIRE,
      };

      expect(isBurnRateRuleFiring(bothClosed)).toBe(false);
    });

    it("does not let one output's column pair bleed into the other", () => {
      /*
       * The cross-contamination guard. This row has a live alert and a resolve
       * stamped on the incident side that no declaration ever matched — the
       * shape left behind when a rule flips shouldCreateIncident off and the
       * service resolves the orphaned incident. If either predicate read the
       * wrong column, the incident side would report open off the alert's
       * create (or closed off the incident's resolve) and the worker would
       * refuse to declare when the rule is turned back on.
       */
      const alertOpenIncidentNeverDeclared: SloBurnRateRuleState = {
        lastAlertCreatedAt: FIRED_AT,
        lastIncidentResolvedAt: RESOLVED_AFTER_FIRE,
      };

      expect(isBurnRateRuleIncidentFiring(alertOpenIncidentNeverDeclared)).toBe(
        false,
      );
      expect(isBurnRateRuleAlertFiring(alertOpenIncidentNeverDeclared)).toBe(
        true,
      );
      expect(isBurnRateRuleFiring(alertOpenIncidentNeverDeclared)).toBe(true);
    });
  });

  describe("canSloFireBurnRateRules", () => {
    it("is true for a healthy, enabled SLO", () => {
      expect(
        canSloFireBurnRateRules({
          isEnabled: true,
          sloStatus: SloStatus.Healthy,
        }),
      ).toBe(true);
    });

    it("is true while the budget is at risk or exhausted — that is when rules fire", () => {
      expect(
        canSloFireBurnRateRules({
          isEnabled: true,
          sloStatus: SloStatus.AtRisk,
        }),
      ).toBe(true);
      expect(
        canSloFireBurnRateRules({
          isEnabled: true,
          sloStatus: SloStatus.BudgetExhausted,
        }),
      ).toBe(true);
    });

    it("is false for a disabled SLO", () => {
      /*
       * Disabling resolves every open alert and incident without stamping the
       * rule's resolve columns, so the rule columns alone would still read as
       * firing.
       */
      expect(
        canSloFireBurnRateRules({
          isEnabled: false,
          sloStatus: SloStatus.AtRisk,
        }),
      ).toBe(false);
    });

    it("is false for the two guard statuses that resolve without stamping", () => {
      expect(
        canSloFireBurnRateRules({
          isEnabled: true,
          sloStatus: SloStatus.Misconfigured,
        }),
      ).toBe(false);
      expect(
        canSloFireBurnRateRules({
          isEnabled: true,
          sloStatus: SloStatus.Paused,
        }),
      ).toBe(false);
    });

    it("stays optimistic when the fields were not loaded", () => {
      // Never hide a genuinely firing rule because a fetch has not landed.
      expect(canSloFireBurnRateRules({})).toBe(true);
      expect(canSloFireBurnRateRules({ isEnabled: true })).toBe(true);
      expect(canSloFireBurnRateRules({ sloStatus: SloStatus.Healthy })).toBe(
        true,
      );
    });

    it("treats a null isEnabled as unknown rather than disabled", () => {
      /*
       * Only an explicit false suppresses the badge. A null arrives from a
       * column that was selected but never written, and reading it as disabled
       * would silently blank the pill on every such SLO.
       */
      expect(
        canSloFireBurnRateRules({
          isEnabled: null,
          sloStatus: SloStatus.AtRisk,
        }),
      ).toBe(true);
      expect(
        canSloFireBurnRateRules({
          isEnabled: undefined,
          sloStatus: null,
        }),
      ).toBe(true);
    });

    it("suppresses a disabled SLO whatever its last status was", () => {
      /*
       * isEnabled is checked before the status, so a stale Healthy status
       * cannot resurrect the badge on a disabled SLO.
       */
      expect(
        canSloFireBurnRateRules({
          isEnabled: false,
          sloStatus: SloStatus.Healthy,
        }),
      ).toBe(false);
      expect(canSloFireBurnRateRules({ isEnabled: false })).toBe(false);
    });
  });
});
