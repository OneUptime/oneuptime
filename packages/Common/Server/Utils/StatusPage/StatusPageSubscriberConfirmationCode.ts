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
 * Codes minted before this were six digits; the route takes them as they
 * are, so a link already sent still confirms.
 */
export default class StatusPageSubscriberConfirmationCode {
  public static readonly LENGTH: number = 32;

  public static generate(): string {
    return crypto
      .randomBytes(StatusPageSubscriberConfirmationCode.LENGTH / 2)
      .toString("hex");
  }
}
