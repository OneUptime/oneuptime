import StatusPageSubscriberUnsubscribe from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import crypto from "crypto";

/*
 * The secret half of a status page subscriber's unsubscribe link
 * (StatusPageSubscriber.unsubscribeToken; the link itself is built by
 * Common/Types/StatusPage/StatusPageSubscriberUnsubscribe).
 *
 * Server-only on purpose, like VerificationCode: a token is minted from
 * Node's CSPRNG and nothing here falls back to Math.random. If the platform
 * cannot produce secure randomness, generation throws and the subscriber is
 * not created, rather than being given a guessable link.
 *
 * It is not the six-digit subscriptionConfirmationToken. That one only has to
 * survive the few minutes until an address confirms, and a million guesses
 * cover it; this one stays valid for as long as the subscription does.
 */

/*
 * What a presented token is compared against when there is nothing real to
 * compare it with - no subscriber, no stored token, or a malformed value - so
 * that a refusal costs the same full-length comparison as a wrong token.
 */
const COMPARISON_PLACEHOLDER: string = "0".repeat(
  StatusPageSubscriberUnsubscribe.TOKEN_LENGTH,
);

export default class StatusPageSubscriberUnsubscribeToken {
  // 32 random bytes as 64 lowercase hex characters, the pattern of PasswordHash.generateSalt.
  public static generate(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /*
   * Whether the token from a link is the subscription's token.
   *
   * Constant time: `===` stops at the first differing character, which would
   * tell someone guessing how much of a guess was right. Both sides are
   * well-formed 64-character strings by the time they reach timingSafeEqual
   * (which throws on a length mismatch); anything else is swapped for a
   * placeholder of the same length first and the answer is false regardless,
   * so a missing subscriber, a missing stored token and a wrong token all
   * take the same path.
   */
  public static matches(data: {
    stored: string | null | undefined;
    presented: string | null | undefined;
  }): boolean {
    const presented: string =
      typeof data.presented === "string" ? data.presented.toLowerCase() : "";

    const storedIsUsable: boolean =
      StatusPageSubscriberUnsubscribe.isWellFormedToken(data.stored);
    const presentedIsUsable: boolean =
      StatusPageSubscriberUnsubscribe.isWellFormedToken(presented);

    const isEqual: boolean = crypto.timingSafeEqual(
      Buffer.from(
        storedIsUsable ? (data.stored as string) : COMPARISON_PLACEHOLDER,
        "utf8",
      ),
      Buffer.from(
        presentedIsUsable ? presented : COMPARISON_PLACEHOLDER,
        "utf8",
      ),
    );

    return storedIsUsable && presentedIsUsable && isEqual;
  }
}
