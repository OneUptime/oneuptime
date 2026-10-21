/*
 * How a request to order a certificate ended, when it did not throw.
 *
 * Its own module so that GreenlockUtil, which places every order, and
 * CertificateOrder, which decides whether a first order is needed, can both
 * use it without importing each other.
 */
export enum CertificateOrderOutcome {
  // A certificate was ordered and stored.
  Ordered = "Ordered",
  /*
   * The name already had a certificate. It was recorded as ordered and
   * nothing was ordered.
   */
  AlreadyIssued = "AlreadyIssued",
  /*
   * Nothing was ordered now: another order for the name was running, or the
   * lock that keeps orders apart could not be taken. The sweeps try again.
   */
  NotOrderedNow = "NotOrderedNow",
  /*
   * Nothing was ordered now: this window's orders are used up - the share of
   * the sweep or the click that asked, or the installation's Let's Encrypt
   * allowance (CertificateOrderBudget). The next window has new ones.
   */
  LimitReached = "LimitReached",
}

export default CertificateOrderOutcome;
