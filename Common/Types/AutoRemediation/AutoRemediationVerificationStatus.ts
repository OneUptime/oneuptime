/*
 * Outcome verification for an executed remediation. A remediation is not
 * done when the runbook exits — it is done when the subject's monitors are
 * back to an operational state (or the incident/alert was resolved) within
 * the verification window.
 *
 * Pending:  the runbook was started; the verifier is watching for recovery.
 * Verified: the subject recovered (or was resolved) within the window.
 * Failed:   the runbook failed, did not finish in time, or the service did
 *           not recover within the window — escalation continues as normal.
 * Skipped:  nothing to verify against (e.g. a manual incident with no
 *           monitors).
 */
enum AutoRemediationVerificationStatus {
  Pending = "Pending",
  Verified = "Verified",
  Failed = "Failed",
  Skipped = "Skipped",
}

export default AutoRemediationVerificationStatus;
