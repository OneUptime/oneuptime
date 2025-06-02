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
  public static isSubscriptionActive(
    status?: SubscriptionStatus | undefined,
  ): boolean {
    if (!status) {
      return true;
    }

    return (
      status === SubscriptionStatus.Active ||
      status === SubscriptionStatus.Trialing ||
      status === SubscriptionStatus.PastDue
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
