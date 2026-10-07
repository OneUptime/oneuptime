/*
 * Whether one of a project's prepaid balances - its balance for SMS, calls,
 * WhatsApp and Telegram (NotificationService), or its AI credits
 * (AIBillingService) - can refill itself when it runs low: what Auto
 * Recharge would do now.
 *
 * AIService.getAiBalanceBlocker asks it, so the AI readiness checks (the
 * cluster and resource AI pages, the investigation gate) say exactly what a
 * billed AI call will do; and the page that holds each balance shows when
 * Auto Recharge's last charge failed (GET /notification/auto-recharge-state
 * and GET /ai/auto-recharge-state), so nobody has to wait for the email.
 *
 * Kept in a module of its own, free of server code, so the dashboard and a
 * test that mocks the billing services still have it.
 */
enum AutoRechargeState {
  /*
   * Auto Recharge is off, or has no amount or threshold to recharge by: a
   * balance that runs out stays out until someone adds to it.
   */
  Off = "Off",
  /*
   * Auto Recharge is on and set up: when the balance falls below its
   * threshold, the next message or billed AI call recharges it first.
   */
  Ready = "Ready",
  /*
   * Auto Recharge is on, but its last charge did not go through, and it is
   * not tried again until AUTO_RECHARGE_RETRY_AFTER_IN_SECONDS (an hour)
   * have passed - or someone recharges by hand, or saves Auto Recharge
   * again.
   */
  Failed = "Failed",
}

export default AutoRechargeState;
