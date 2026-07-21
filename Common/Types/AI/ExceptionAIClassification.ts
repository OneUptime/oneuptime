/*
 * AI triage verdict for a telemetry exception group. Decides how the
 * automatic fix lane treats the group:
 *
 * - CodeFault: a defect in the monitored code — the only class the
 *   automatic lane opens fix pull requests for.
 * - UserError: expected consequence of invalid end-user input (bad
 *   parameters, malformed values). The right change, if any, is earlier
 *   validation and clearer error UX — routed to a human, never auto-fixed.
 * - ExpectedDenial: an intentional check doing its job (auth failure,
 *   plan/paywall denial, scanner/fuzzer probe tripping validation).
 *   Never auto-fixed; optionally auto-archived.
 * - Infrastructure: environmental conditions (timeouts, connection
 *   resets, resource exhaustion) where a code "fix" is usually tuning —
 *   routed to a human.
 * - Unknown: triage could not decide — treated conservatively (no
 *   automatic fix).
 */
enum ExceptionAIClassification {
  CodeFault = "code-fault",
  UserError = "user-error",
  ExpectedDenial = "expected-denial",
  Infrastructure = "infrastructure",
  Unknown = "unknown",
}

export default ExceptionAIClassification;
