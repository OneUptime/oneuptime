/*
 * How a matched auto-remediation rule acts.
 *
 * Suggest: propose the runbook on the incident/alert and wait for a human
 * to approve with one click. This is the default and the only mode allowed
 * when the rule lets AI pick the runbook.
 *
 * FullAuto: start the runbook immediately with no human in the loop. Only
 * available for deterministic rules (explicitly attached runbooks) and
 * subject to the per-rule hourly circuit breaker.
 */
enum AutoRemediationExecutionMode {
  Suggest = "Suggest",
  FullAuto = "FullAuto",
}

export default AutoRemediationExecutionMode;
