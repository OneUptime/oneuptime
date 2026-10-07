/*
 * Whether a project's AI credits can refill themselves when they run out:
 * what AIService.getAiBalanceBlocker asks, so the AI readiness checks (the
 * cluster and resource AI pages, the investigation gate) say exactly what a
 * billed AI call will do (AIBillingService.getAutoRechargeState).
 *
 * Kept in a module of its own, free of server code, so a test that mocks
 * AIBillingService still has it.
 */
enum AiAutoRechargeState {
  /*
   * Auto Recharge is off, or has no amount or threshold to recharge by: a
   * balance that is used up stays used up until someone adds credits.
   */
  Off = "Off",
  /*
   * Auto Recharge is on and set up: when the credits are used up, the next
   * billed AI call recharges them first, and then runs.
   */
  Ready = "Ready",
  /*
   * Auto Recharge is on, but its last charge did not go through, and it is
   * not tried again until AI_AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS have
   * passed - or someone recharges by hand, or saves Auto Recharge again.
   */
  Failed = "Failed",
}

export default AiAutoRechargeState;
