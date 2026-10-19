import SubscriptionConfirmationLink from "../../../Types/StatusPage/SubscriptionConfirmationLink";
import crypto from "crypto";

/*
 * The code in the link that asks a new subscriber to confirm:
 * {statusPageUrl}/confirm-subscription/{id}?verification-token={code}, sent
 * to an email subscriber and to a visitor who signs up by text.
 *
 * Opening the link is the whole of what proves the address's own inbox, or
 * the number's own phone, asked for the subscription: the subscriber id is
 * no secret. So the code is one nobody can guess - 16 random bytes, as 32
 * lowercase hex characters - rather than a short number, which only a count
 * of wrong tries would keep. Nobody types it: it only ever travels inside
 * the link, so it need not be short.
 *
 * A link works for a day (VALID_FOR_HOURS) after it is sent - when its
 * subscription was created, the one time a link is sent for it - as a link
 * to verify an account's email address or to reset a password does
 * (Types/StatusPage/SubscriptionConfirmationLink, which the dashboard reads
 * too). While it works, it holds its contact on its status page: signing
 * the contact up there again sends nothing new. Once it has run out, the
 * subscription confirms nothing more, and the contact's next sign-up
 * replaces it with a new one and a new link (StatusPageSubscriberService).
 *
 * Codes minted before codes were 32 characters are six digits. The route
 * still takes one inside its day, as it takes any code, but only until a
 * wrong code is tried for its subscription: then it is given up
 * (StatusPageSubscriberService.confirmSubscription), so a short code is
 * never there to be guessed at.
 */

// A code minted now: 32 lowercase hex characters.
const CURRENT_CODE: RegExp = /^[0-9a-f]{32}$/;

export default class StatusPageSubscriberConfirmationCode {
  public static readonly LENGTH: number = 32;

  // How long a link to confirm a subscription works once it is sent.
  public static readonly VALID_FOR_HOURS: number =
    SubscriptionConfirmationLink.VALID_FOR_HOURS;

  public static readonly VALID_FOR_MS: number =
    SubscriptionConfirmationLink.VALID_FOR_MS;

  public static generate(): string {
    return crypto
      .randomBytes(StatusPageSubscriberConfirmationCode.LENGTH / 2)
      .toString("hex");
  }

  /*
   * Whether a stored code is one minted now (generate), rather than a short
   * one from before.
   */
  public static isCurrent(code: unknown): boolean {
    return typeof code === "string" && CURRENT_CODE.test(code);
  }

  /*
   * Whether the code from a link is the subscription's code: exactly, and
   * compared in constant time, so a refusal says nothing about how much of a
   * guess was right. A subscription with no code is confirmed by nothing.
   */
  public static matches(data: {
    stored: unknown;
    presented: unknown;
  }): boolean {
    const stored: string = typeof data.stored === "string" ? data.stored : "";
    const presented: string =
      typeof data.presented === "string" ? data.presented : "";

    const storedBytes: Buffer = Buffer.from(stored, "utf8");
    const presentedBytes: Buffer = Buffer.from(presented, "utf8");

    let isEqual: boolean = false;

    // timingSafeEqual takes two of one length; a length is no secret.
    if (storedBytes.length === presentedBytes.length) {
      isEqual = crypto.timingSafeEqual(storedBytes, presentedBytes);
    } else {
      // The same comparison a code of the right length costs.
      crypto.timingSafeEqual(storedBytes, storedBytes);
    }

    return stored.length > 0 && presented.length > 0 && isEqual;
  }

  // When the link of a subscription created at `createdAt` stops working.
  public static getExpiresAt(createdAt: Date): Date {
    return SubscriptionConfirmationLink.getExpiresAt(createdAt);
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
    return SubscriptionConfirmationLink.hasExpired(createdAt, now);
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
    return SubscriptionConfirmationLink.getSecondsLeft(createdAt, now);
  }
}
