import ObjectID from "../../../../Types/ObjectID";
import AutoRemediationRuleEngineService from "../../../Services/AutoRemediationRuleEngineService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the investigation → remediation hand-off (RCA-first ordering).
 *
 * Auto-remediation used to fire from the incident/alert create hook in
 * PARALLEL with the AI investigation, so the remediation planner usually ran
 * before any root cause analysis existed and could only read the RCA
 * best-effort. Now the create hook DEFERS remediation whenever an
 * investigation was enqueued for the subject, and this module releases the
 * subject to the rule engine only after that investigation SETTLES — so the
 * planner always has the posted RCA (when one was produced) as its input.
 *
 * "Settles" means any terminal outcome, exactly once:
 *   - Completed (analysis posted, or nothing worth posting) — via
 *     InvestigationRequest.onSettled from AIInvestigationEngine;
 *   - Error after retries were exhausted — via the failOrRequeue outcome in
 *     the engine/runners;
 *   - Cancelled (queue TTL expiry) or Stale (heartbeat death, no retries
 *     left) — via AIInvestigationQueue's terminal transitions.
 *
 * Exactly-once is inherited from the run-status CAS transitions: only the
 * actor that WON a terminal transition calls this, the same discipline that
 * keeps postAnalysis from double-posting. A failed investigation still hands
 * off — remediation must degrade to its pre-RCA behavior, never silently
 * disappear because the AI lane broke.
 *
 * When NO investigation is enqueued at creation (opt-out, gates, budget),
 * the create hook applies the rules immediately and this module is never
 * involved — remediation does not depend on the AI lane being enabled.
 */
export default class RemediationHandoff {
  /*
   * Release a settled investigation's subject to the auto-remediation rule
   * engine. Exactly one of incidentId/alertId is expected (an investigation
   * has exactly one subject). Never throws — the hand-off runs after
   * terminal run transitions and inside postAnalysis follow-ups, where a
   * failure must be logged, not propagated.
   */
  @CaptureSpan()
  public static async runForSettledInvestigation(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  }): Promise<void> {
    try {
      if (data.incidentId) {
        logger.debug(
          `AI: investigation settled for incident ${data.incidentId.toString()} — handing off to auto-remediation.`,
        );

        await AutoRemediationRuleEngineService.applyRulesToIncidentById({
          incidentId: data.incidentId,
          projectId: data.projectId,
        });
        return;
      }

      if (data.alertId) {
        logger.debug(
          `AI: investigation settled for alert ${data.alertId.toString()} — handing off to auto-remediation.`,
        );

        await AutoRemediationRuleEngineService.applyRulesToAlertById({
          alertId: data.alertId,
          projectId: data.projectId,
        });
      }
    } catch (error) {
      logger.error(
        `AI: remediation hand-off failed for ${
          data.incidentId
            ? `incident ${data.incidentId.toString()}`
            : `alert ${data.alertId?.toString()}`
        }: ${error}`,
      );
    }
  }
}
