enum SubscriptionStatus {
  Incomplete = "incomplete",
  IncompleteExpired = "incomplete_expired",
  Trialing = "trialing",
  Active = "active",
  PastDue = "past_due",
  Canceled = "canceled",
  Unpaid = "unpaid",
  Expired = "expired",
  Paused = "paused",
}

export class SubscriptionStatusUtil {
  /*
   * THE definition of an "active" subscription status, and the only one.
   *
   * Everything that decides whether a project is still served - the monitor
   * and network-device claim queries (raw SQL), ProjectService's
   * getActiveProjectStatusQuery (probe fetches, heartbeat / online sweeps,
   * server-monitor ingest, SLO evaluation, KEDA queue sizing), and
   * isSubscriptionActive below - derives its list from here. Those used to
   * be separate hand-written copies, and they drifted: the TypeScript check
   * counted past_due as active while every query that picks monitors to run
   * only accepted active / trialing. A customer whose card failed ONE autopay
   * attempt (or whose India e-mandate debit was merely still processing when
   * Stripe flipped the invoice past_due) kept seeing a working dashboard and
   * a "will become inactive soon" banner while their monitoring had already
   * silently stopped.
   *
   * past_due is active on purpose: Stripe keeps retrying the invoice while a
   * subscription is past_due, and the subscription only becomes unpaid or
   * canceled once those retries are exhausted. Monitoring stops at THAT
   * point, not on the first failed attempt.
   *
   * A missing status (NULL in the database) is also active - that is a
   * project with no subscription at all (self-hosted, or billing disabled) -
   * but it is not a status, so it is not in this list; callers that build
   * queries add the NULL case themselves.
   *
   * A fresh array is returned on every call so no caller can mutate the
   * definition for everyone else.
   */
  public static getActiveSubscriptionStatuses(): Array<SubscriptionStatus> {
    return [
      SubscriptionStatus.Active,
      SubscriptionStatus.Trialing,
      SubscriptionStatus.PastDue,
    ];
  }

  public static isSubscriptionActive(
    status?: SubscriptionStatus | undefined,
  ): boolean {
    if (!status) {
      return true;
    }

    return SubscriptionStatusUtil.getActiveSubscriptionStatuses().includes(
      status,
    );
  }

  public static isSubscriptionInactive(
    status?: SubscriptionStatus | undefined,
  ): boolean {
    return !SubscriptionStatusUtil.isSubscriptionActive(status);
  }

  public static isSubscriptionOverdue(
    status?: SubscriptionStatus | undefined,
  ): boolean {
    if (!status) {
      return false;
    }

    return status === SubscriptionStatus.PastDue;
  }

  // is subscription canclled.
  public static isSubscriptionCancelled(
    status?: SubscriptionStatus | undefined,
  ): boolean {
    if (!status) {
      return false;
    }

    return (
      status === SubscriptionStatus.Canceled ||
      status === SubscriptionStatus.Unpaid ||
      status === SubscriptionStatus.Expired ||
      status === SubscriptionStatus.IncompleteExpired
    );
  }
}

export default SubscriptionStatus;
