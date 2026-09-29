/*
 * Entity type an auto-remediation rule listens for. Unlike runbook rules,
 * auto-remediation deliberately excludes scheduled maintenance — planned
 * events are not something to remediate.
 */
enum AutoRemediationTriggerEntity {
  Incident = "Incident",
  Alert = "Alert",
}

export default AutoRemediationTriggerEntity;
