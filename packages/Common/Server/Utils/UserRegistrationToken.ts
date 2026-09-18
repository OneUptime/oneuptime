import { AccountsRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";
import EmailVerificationToken from "../../Models/DatabaseModels/EmailVerificationToken";
import DatabaseConfig from "../DatabaseConfig";
import EmailVerificationTokenService from "../Services/EmailVerificationTokenService";
import CaptureSpan from "./Telemetry/CaptureSpan";

/*
 * An invited user exists in the database before they have ever authenticated.
 * TeamMemberService creates the row so the membership has something to point
 * at, and that row carries no password until the person registers.
 *
 * /signup is what hands that unclaimed row over, so the hand-over has to be
 * gated on something only the mailbox owner can hold. Knowing the address is
 * not enough: addresses at a company are guessable by construction, which is
 * exactly how GHSA-qg84-6hrg-mr5g turned a pending invitation into an account
 * takeover -- the guard there was `if (alreadySavedUser.password)`, and an
 * unclaimed row's password is null, which is falsy.
 *
 * This token is that gate. It is minted when the invitation is sent, travels
 * only inside the invitation email, and is spent the first time it is used.
 *
 * It reuses EmailVerificationToken rather than adding a table of its own: the
 * shape is identical (user, email, opaque token, expiry) and the semantics are
 * the same claim -- "the holder of this controls this mailbox". Spending one is
 * therefore also proof of address ownership, which is why the signup path marks
 * the account verified on the way through.
 */

/*
 * Invitations are read when the person gets round to them, not when they are
 * sent, so these live longer than the 24 hours an email-verification link gets.
 * Expiring in a week still bounds how long a leaked invite mail stays useful.
 */
export const REGISTRATION_TOKEN_EXPIRY_IN_DAYS: number = 7;

export default class UserRegistrationToken {
  /*
   * Mint a token for `email` and return it. The caller is responsible for
   * putting it somewhere only the mailbox owner will see -- which in practice
   * means a link in an email addressed to that same mailbox, and nowhere else.
   * It must never be written into an API response.
   */
  @CaptureSpan()
  public static async generateRegistrationToken(data: {
    userId: ObjectID;
    email: Email;
  }): Promise<ObjectID> {
    const token: ObjectID = ObjectID.generate();

    const emailVerificationToken: EmailVerificationToken =
      new EmailVerificationToken();
    emailVerificationToken.userId = data.userId;
    emailVerificationToken.email = data.email;
    emailVerificationToken.token = token;
    emailVerificationToken.expires = OneUptimeDate.getSomeDaysAfter(
      REGISTRATION_TOKEN_EXPIRY_IN_DAYS,
    );

    await EmailVerificationTokenService.create({
      data: emailVerificationToken,
      props: {
        isRoot: true,
      },
    });

    return token;
  }

  /*
   * The /accounts/register link an invited person follows. The email is carried
   * alongside the token only to prefill (and lock) the form field; the token is
   * the part that authorizes anything.
   */
  @CaptureSpan()
  public static async getRegistrationLink(data: {
    email: Email;
    token: ObjectID;
  }): Promise<URL> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return URL.fromString(
      new URL(
        httpProtocol,
        host,
        new Route(AccountsRoute.toString()),
      ).toString(),
    )
      .addRoute("/register")
      .addQueryParam("email", data.email.toString(), true)
      .addQueryParam("token", data.token.toString(), true);
  }

  // Mint a token and build the link that carries it, in one step.
  @CaptureSpan()
  public static async generateRegistrationLink(data: {
    userId: ObjectID;
    email: Email;
  }): Promise<URL> {
    const token: ObjectID = await this.generateRegistrationToken({
      userId: data.userId,
      email: data.email,
    });

    return await this.getRegistrationLink({
      email: data.email,
      token: token,
    });
  }

  /*
   * Spend a token. Returns true only if it exists, was minted for this exact
   * address, has not expired, and had not already been spent.
   *
   * The delete is what makes it single-use, and it is deliberately the last
   * word: `deleteOneBy` reports how many rows it removed, so two requests
   * racing on the same token produce exactly one winner (the loser deletes
   * nothing and gets false back) rather than two callers who both read a live
   * token and both proceed.
   *
   * Every failure returns the same `false`. The caller must not report which
   * check failed -- "expired" and "no such token" would tell someone probing
   * with guessed tokens which of them had ever been real.
   */
  @CaptureSpan()
  public static async consumeRegistrationToken(data: {
    token: ObjectID;
    email: Email;
  }): Promise<boolean> {
    const savedToken: EmailVerificationToken | null =
      await EmailVerificationTokenService.findOneBy({
        query: {
          token: data.token,
        },
        select: {
          _id: true,
          email: true,
          expires: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!savedToken || !savedToken.email || !savedToken.expires) {
      return false;
    }

    /*
     * A token is bound to the address it was mailed to. Without this, a token
     * from any invitation the attacker had legitimately received would claim
     * any other unclaimed account. Email lowercases on construction, so the
     * string comparison is already case-insensitive.
     */
    if (savedToken.email.toString() !== data.email.toString()) {
      return false;
    }

    if (OneUptimeDate.hasExpired(savedToken.expires)) {
      return false;
    }

    const deletedCount: number =
      await EmailVerificationTokenService.deleteOneBy({
        query: {
          _id: savedToken._id!,
        },
        props: {
          isRoot: true,
        },
      });

    return deletedCount === 1;
  }
}
