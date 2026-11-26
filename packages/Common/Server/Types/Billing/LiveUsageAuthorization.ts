/*
 * The token PayAsYouGoBillingService.authorizeUsageNow mints. It has a file of
 * its own so that the billing provider's contract (BillingProvider) can name
 * it without reading the service: BillingProvider says why that matters.
 * PayAsYouGoBillingService still exports it.
 */
declare const liveUsageAuthorizationBrand: unique symbol;

/**
 * Proof that a project's payment setup was read live a moment ago. Only
 * PayAsYouGoBillingService.authorizeUsageNow mints one: the brand is not
 * exported and has no runtime value, so any other way of making one is a
 * visible cast. It is honoured only for the project it names, and only inside
 * the service's LIVE_AUTHORIZATION_REUSE_WINDOW_IN_MS.
 */
export interface LiveUsageAuthorization {
  readonly projectId: string;
  readonly decidedAt: number;
  readonly [liveUsageAuthorizationBrand]: true;
}
