import { AccountsRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  REAUTHENTICATE_QUERY_PARAM,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS,
  SignInAgainRefusal,
  judgeSignInAgain,
} from "Common/Types/Accounts/Reauthentication";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SessionSignInAgain } from "Common/Types/UserSession/SessionSignIn";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import TokenSigningKey from "Common/Server/Utils/TokenSigningKey";
import crypto from "crypto";

/*
 * SIGN IN AGAIN, THE SIGN-IN ROUTES' HALF (#10217,
 * Common/Types/Accounts/Reauthentication).
 *
 * An account with neither a password nor a passkey confirms it's its
 * owner's by signing in again. Its identity provider usually remembers its
 * own session, and signs a browser that still has one straight back in,
 * asking nothing - which proves only that the provider's session is alive.
 * So Sign In Again (the prompt, Common/UI/Components/Reauthentication) opens
 * the session's own sign-in with REAUTHENTICATE_QUERY_PARAM, and:
 *
 *   - its start asks the provider to authenticate the person again - SAML's
 *     ForceAuthn, OpenID Connect's prompt=login and max_age=0 (prompt=login
 *     alone to Microsoft Entra ID, #10529) - and keeps
 *     when it sent them there, where only this server can have written it:
 *     signed into the AuthnRequest's ID, which the response names as its
 *     InResponseTo, or in the sign-in's own signed state cookie;
 *   - its end reads when the provider says it authenticated the person - the
 *     signed assertion's AuthnInstant, the verified ID token's auth_time -
 *     and keeps the outcome with the new session (judge): a confirmation
 *     from then, for the window, when that is at or after the moment they
 *     were sent, give or take SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS; else why
 *     not. OneUptime checks the time itself and never trusts that the
 *     provider honoured the request: some ignore it.
 *
 * The person is signed in either way: the provider vouched for them. Only
 * the confirmation is refused, and the prompt says why, and what their
 * administrator can change.
 */

// What a SAML AuthnRequest ID made for Sign In Again looks like.
const SAML_REQUEST_ID_PREFIX: string = "ONEUPTIME_SIGN_IN_AGAIN_";
const SAML_REQUEST_ID: RegExp =
  /^ONEUPTIME_SIGN_IN_AGAIN_([0-9a-z]{1,12})_([0-9a-f]{16})_([0-9a-f]{32})$/;

// Signed under a key of this purpose alone (TokenSigningKey.deriveKey).
const SAML_REQUEST_ID_KEY_LABEL: string = "saml-sign-in-again-request";

const WINDOW_IN_MS: number = REAUTHENTICATION_WINDOW_IN_MINUTES * 60 * 1000;
const SKEW_IN_MS: number = SIGN_IN_AGAIN_CLOCK_SKEW_IN_SECONDS * 1000;

/*
 * The field of an OpenID Connect sign-in's state cookie (and Google's and
 * Microsoft's) that keeps when Sign In Again sent the person to the
 * provider, in milliseconds since the epoch.
 */
export const SIGN_IN_AGAIN_STATE_FIELD: string = "signInAgainRequestedAt";

export default class SignInAgain {
  // Whether this sign-in's start was opened by Sign In Again.
  public static isRequested(req: ExpressRequest): boolean {
    return req.query[REAUTHENTICATE_QUERY_PARAM] === "true";
  }

  /*
   * The ID of a SAML AuthnRequest that Sign In Again sends to the provider
   * `providerId` names: when it was sent, a nonce and a signature over both
   * and the provider, in the characters an xs:ID takes. The response that
   * answers it names it as its InResponseTo (SAML 2.0 Profiles 4.1.4.2), in
   * the signed assertion - so it comes back as this server signed it, for
   * this provider, with no state kept anywhere.
   */
  public static createSamlRequestId(data: {
    providerId: ObjectID;
    requestedAt: Date;
  }): string {
    const sentAt: string = data.requestedAt.getTime().toString(36);
    const nonce: string = crypto.randomBytes(8).toString("hex");

    return `${SAML_REQUEST_ID_PREFIX}${sentAt}_${nonce}_${SignInAgain.signSamlRequestId(
      {
        providerId: data.providerId,
        sentAt: sentAt,
        nonce: nonce,
      },
    )}`;
  }

  /*
   * When Sign In Again sent the person to the provider, read from the
   * InResponseTo of a response through `providerId`; null for one it did not
   * send - another request, an IdP-initiated sign-in, another provider's,
   * one whose signature is wrong - and for one sent longer ago than the
   * window, or ahead of now.
   */
  public static readSamlRequestId(data: {
    inResponseTo: string | null;
    providerId: ObjectID;
    now: Date;
  }): Date | null {
    const match: RegExpExecArray | null = data.inResponseTo
      ? SAML_REQUEST_ID.exec(data.inResponseTo)
      : null;

    if (!match) {
      return null;
    }

    const sentAt: string = match[1]!;
    const nonce: string = match[2]!;
    const signature: Buffer = Buffer.from(match[3]!, "hex");
    const expected: Buffer = Buffer.from(
      SignInAgain.signSamlRequestId({
        providerId: data.providerId,
        sentAt: sentAt,
        nonce: nonce,
      }),
      "hex",
    );

    if (
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(signature, expected)
    ) {
      return null;
    }

    return SignInAgain.toRequestedAt(parseInt(sentAt, 36), data.now);
  }

  /*
   * When Sign In Again sent the person to the provider, as a sign-in's
   * signed state cookie kept it (SIGN_IN_AGAIN_STATE_FIELD); null for a
   * sign-in Sign In Again did not start, and for one sent longer ago than
   * the window, or ahead of now.
   */
  public static readStateRequestedAt(
    stored: JSONObject,
    now: Date,
  ): Date | null {
    const value: unknown = stored[SIGN_IN_AGAIN_STATE_FIELD];

    return typeof value === "number"
      ? SignInAgain.toRequestedAt(value, now)
      : null;
  }

  /*
   * When an ID token says its person authenticated (OpenID Connect Core 2:
   * auth_time, in seconds since the epoch), or null when it does not say.
   */
  public static readAuthTime(
    claims: JSONObject | null | undefined,
  ): Date | null {
    const value: unknown = claims?.["auth_time"];

    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return new Date(value * 1000);
  }

  /*
   * What to keep with the new session: undefined for a sign-in Sign In Again
   * did not start (it confirms nothing, and says nothing), else the outcome
   * of the provider's time against the moment the person was sent
   * (judgeSignInAgain).
   */
  public static judge(data: {
    requestedAt: Date | null;
    authenticatedAt: Date | null;
    now: Date;
  }): SessionSignInAgain | undefined {
    if (!data.requestedAt) {
      return undefined;
    }

    return judgeSignInAgain({
      requestedAt: data.requestedAt,
      authenticatedAt: data.authenticatedAt,
      now: data.now,
    });
  }

  /*
   * A Sign In Again whose provider is gone - turned off or deleted since the
   * session signed in through it - goes to the sign-in page, where the
   * person chooses another way, never to an error page with no way on: Sign
   * In Again has already signed them out.
   */
  public static async sendToSignInPage(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return Response.redirect(
      req,
      res,
      new URL(
        httpProtocol,
        host,
        new Route(AccountsRoute.toString()).addRoute("/login"),
      ),
    );
  }

  /*
   * Says, for whoever runs the server, that a Sign In Again through a
   * provider confirmed nothing, and why: what an administrator testing a
   * provider looks for. Names the provider by its id, never the person.
   */
  public static logOutcome(data: {
    outcome: SessionSignInAgain | undefined;
    providerKind: string;
    providerId: ObjectID | string;
  }): void {
    if (!data.outcome || !("refusal" in data.outcome)) {
      return;
    }

    logger.warn(
      `A Sign In Again through ${data.providerKind} ${data.providerId.toString()} did not confirm it was its person: ${
        data.outcome.refusal === SignInAgainRefusal.ReusedSession
          ? "the identity provider signed them in with a session it already had (it did not honor ForceAuthn, or prompt=login)"
          : "the identity provider did not say when they signed in (no AuthnInstant, or no auth_time claim)"
      }.`,
    );
  }

  private static toRequestedAt(milliseconds: number, now: Date): Date | null {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      return null;
    }

    const age: number = now.getTime() - milliseconds;

    if (age > WINDOW_IN_MS || age < -SKEW_IN_MS) {
      return null;
    }

    return new Date(milliseconds);
  }

  private static signSamlRequestId(data: {
    providerId: ObjectID;
    sentAt: string;
    nonce: string;
  }): string {
    return crypto
      .createHmac(
        "sha256",
        TokenSigningKey.deriveKey(SAML_REQUEST_ID_KEY_LABEL),
      )
      .update(
        `${data.providerId.toString().toLowerCase()}|${data.sentAt}|${data.nonce}`,
      )
      .digest("hex")
      .slice(0, 32);
  }
}
