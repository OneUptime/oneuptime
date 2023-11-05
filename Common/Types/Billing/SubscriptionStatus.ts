enum SubscriptionStatus {
    Incomplete = 'incomplete',
    IncompleteExpired = 'incomplete_expired',
    Trialing = 'trialing',
    Active = 'active',
    PastDue = 'past_due',
    Canceled = 'canceled',
    Unpaid = 'unpaid',
}

export class SubscriptionStatusUtil {
    public static isSubscriptionActive(
        status?: SubscriptionStatus | undefined
    ): boolean {
        if (!status) {
            return true;
        }

        return (
            status === SubscriptionStatus.Active ||
            status === SubscriptionStatus.Trialing
        );
    }

    public static isSubscriptionInactive(
        status?: SubscriptionStatus | undefined
    ): boolean {
        return !SubscriptionStatusUtil.isSubscriptionActive(status);
    }
}

export default SubscriptionStatus;
