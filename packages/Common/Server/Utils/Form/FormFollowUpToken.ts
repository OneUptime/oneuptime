import {
  FORM_FOLLOW_UP_TOKEN_LENGTH,
  isWellFormedFormFollowUpToken,
} from "../../../Types/Form/FormFollowUp";
import crypto from "crypto";

/*
 * The secret half of a follow-up link (FormSubmissionFollower.accessToken;
 * the link itself is built from Common/Types/Form/FormFollowUp).
 *
 * Server-only on purpose, as StatusPageSubscriberUnsubscribeToken is: a
 * token is minted from Node's CSPRNG and nothing here falls back to
 * Math.random. If the platform cannot produce secure randomness, generation
 * throws and nobody is added to follow the request, rather than being
 * given a guessable link.
 */

/*
 * What a presented token is compared against when there is nothing real to
 * compare it with - no person, no stored token, or a malformed value - so
 * that a refusal costs the same full-length comparison as a wrong token.
 */
const COMPARISON_PLACEHOLDER: string = "0".repeat(FORM_FOLLOW_UP_TOKEN_LENGTH);

export default class FormFollowUpToken {
  // 32 random bytes as 64 lowercase hex characters.
  public static generate(): string {
    return crypto.randomBytes(FORM_FOLLOW_UP_TOKEN_LENGTH / 2).toString("hex");
  }

  /*
   * Whether the token from a link is the person's token. Constant time:
   * anything malformed is swapped for a placeholder of the same length
   * first and the answer is false regardless, so a missing person, a
   * missing stored token and a wrong token all take the same path.
   */
  public static matches(data: {
    stored: string | null | undefined;
    presented: string | null | undefined;
  }): boolean {
    const stored: string =
      typeof data.stored === "string" ? data.stored.toLowerCase() : "";
    const presented: string =
      typeof data.presented === "string" ? data.presented.toLowerCase() : "";

    const storedIsUsable: boolean = isWellFormedFormFollowUpToken(stored);
    const presentedIsUsable: boolean = isWellFormedFormFollowUpToken(presented);

    const isEqual: boolean = crypto.timingSafeEqual(
      Buffer.from(storedIsUsable ? stored : COMPARISON_PLACEHOLDER, "utf8"),
      Buffer.from(
        presentedIsUsable ? presented : COMPARISON_PLACEHOLDER,
        "utf8",
      ),
    );

    return storedIsUsable && presentedIsUsable && isEqual;
  }
}
