/*
 * The kind of signal an AI rule (AutoRemediationRule) decides about. Unlike
 * runbook rules, AI rules deliberately exclude scheduled maintenance —
 * planned events are not something to remediate.
 *
 * Incidents and alerts are investigated and fixed as they happen
 * (Types/AI/AiRule). The telemetry products have AI rules of their own,
 * stored in the same table: what OneUptime AI does with the problems
 * OneUptime finds in their data - slow code in a service's profiles, first
 * (Types/AI/TelemetryAi). These strings are stored and sent by the API and
 * Terraform, so they are a wire contract: never rename them.
 */
enum AutoRemediationTriggerEntity {
  Incident = "Incident",
  Alert = "Alert",
  /*
   * Slow code OneUptime found in a service's profiles (Profiles → AI): the
   * rule says which services' slow code OneUptime AI looks into, and
   * whether it opens a pull request that makes it faster.
   */
  Profile = "Profile",
  /*
   * The slow and failing operations OneUptime found in a service's traces,
   * and the ones whose traces cannot say why (Traces → AI): the rule says
   * which services' problems OneUptime AI looks into, and whether it opens
   * a pull request that fixes the code or adds the tracing it lacks.
   */
  Trace = "Trace",
  /*
   * The new and rising exceptions OneUptime found in a service, and the
   * services whose exceptions carry no stack trace (Exceptions → AI): the
   * rule says which services' exceptions OneUptime AI looks into, and
   * whether it opens a pull request that fixes the code, improves how the
   * code handles an expected error, or makes it record stack traces.
   */
  Exception = "Exception",
  /*
   * The problems OneUptime found in a service's metrics, and the metrics a
   * busy service does not send at all (Metrics → AI): the rule says which
   * services' problems OneUptime AI looks into, and whether it opens a
   * pull request that improves the metrics or adds the missing ones.
   */
  Metric = "Metric",
}

export default AutoRemediationTriggerEntity;

// The signals OneUptime AI investigates and fixes as they happen.
export type IncidentOrAlertTriggerEntity =
  | AutoRemediationTriggerEntity.Incident
  | AutoRemediationTriggerEntity.Alert;

export const INCIDENT_AND_ALERT_TRIGGER_ENTITIES: ReadonlyArray<IncidentOrAlertTriggerEntity> =
  [AutoRemediationTriggerEntity.Incident, AutoRemediationTriggerEntity.Alert];

export function isIncidentOrAlertTriggerEntity(
  value: unknown,
): value is IncidentOrAlertTriggerEntity {
  return (
    value === AutoRemediationTriggerEntity.Incident ||
    value === AutoRemediationTriggerEntity.Alert
  );
}
