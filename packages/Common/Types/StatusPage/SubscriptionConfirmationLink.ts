/*
 * HOW LONG A LINK TO CONFIRM A STATUS PAGE SUBSCRIPTION WORKS: A DAY.
 *
 * A visitor who signs up on a status page by email or by text - and an email
 * address the team asks to confirm first - is sent a link that confirms the
 * subscription ({statusPageUrl}/confirm-subscription/{id}?verification-token=
 * {code}). It is sent once, as the subscription is created, so its day
 * starts when the subscription was created (Created At), as a link to
 * verify an account's email address or to reset a password lasts a day.
 *
 * While it works, it holds its contact on its status page: signing the
 * contact up there again sends nothing new. Once it has run out it confirms
 * nothing, the subscription stays unconfirmed, and the contact's next
 * sign-up - or the team adding it - replaces it with a new one and a new
 * link (StatusPageSubscriberService). The subscriber lists show it as Link
 * Expired.
 *
 * Plain rules on a time, with no secrets: read by the server and by the
 * dashboard alike. The code the link carries is minted and compared by
 * Server/Utils/StatusPage/StatusPageSubscriberConfirmationCode.
 */
export default class SubscriptionConfirmationLink {
  // How long a link works once it is sent.
  public static readonly VALID_FOR_HOURS: number = 24;

  public static readonly VALID_FOR_MS: number =
    SubscriptionConfirmationLink.VALID_FOR_HOURS * 60 * 60 * 1000;

  // When the link of a subscription created at `createdAt` stops working.
  public static getExpiresAt(createdAt: Date): Date {
    return new Date(
      createdAt.getTime() + SubscriptionConfirmationLink.VALID_FOR_MS,
    );
  }

  /*
   * Whether the link of a subscription created at `createdAt` has stopped
   * working at `now` (the app's clock, Date.now). A subscription whose age
   * cannot be told is past it: its link is never taken on trust.
   */
  public static hasExpired(
    createdAt: Date | string | null | undefined,
    now: number = Date.now(),
  ): boolean {
    const created: number =
      SubscriptionConfirmationLink.getCreatedAtTime(createdAt);

    if (!Number.isFinite(created)) {
      return true;
    }

    return now >= created + SubscriptionConfirmationLink.VALID_FOR_MS;
  }

  /*
   * How many seconds are left until the link of a subscription created at
   * `createdAt` stops working at `now`: at least one while it works, none
   * once it has stopped.
   */
  public static getSecondsLeft(
    createdAt: Date | string | null | undefined,
    now: number = Date.now(),
  ): number {
    if (SubscriptionConfirmationLink.hasExpired(createdAt, now)) {
      return 0;
    }

    const created: number =
      SubscriptionConfirmationLink.getCreatedAtTime(createdAt);

    return Math.max(
      1,
      Math.ceil(
        (created + SubscriptionConfirmationLink.VALID_FOR_MS - now) / 1000,
      ),
    );
  }

  // The time a subscription was created at, as a number; NaN when it cannot be told.
  private static getCreatedAtTime(
    createdAt: Date | string | null | undefined,
  ): number {
    if (createdAt instanceof Date) {
      return createdAt.getTime();
    }

    if (typeof createdAt === "string") {
      return new Date(createdAt).getTime();
    }

    return NaN;
  }
}
