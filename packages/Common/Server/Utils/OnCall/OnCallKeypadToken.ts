import { OnCallInputRequest } from "../../../Types/Call/CallRequest";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import JSONWebToken from "../JsonWebToken";
import OnCallPageLinkToken from "./OnCallPageLinkToken";

/*
 * THE TOKEN A KEY PRESSED ON AN ON-CALL CALL CARRIES (#10025).
 *
 * An on-call call asks the person to press 1 to acknowledge, or 2 to
 * escalate, with a <Gather> whose action is
 * /api/user-notification-log-timeline/call/gather-input/<notification id>.
 * Twilio posts the key there, and signs the request with the auth token of
 * the account that placed the call (TwilioWebhookSignature). The action's
 * query carries this token, signed with TokenSigningKey (JSONWebToken) by
 * the call itself (CallService): what each key answers, what it is for, and
 * the one notification the call was placed for. The keypad route takes a
 * key only when Twilio signed the request and this token names the
 * notification in the route's path, so a key press is bound to its own
 * call's page.
 *
 * The action URL lands in Twilio's request logs and in the call's TwiML in
 * the Twilio console, so it carries nothing that works anywhere else: the
 * page's own link token (OnCallPageLinkToken), which a call's action carried
 * until this release, escalated the page from a browser too. This token is
 * refused by every other route, and the page's link token is no call token
 * here.
 *
 * What each key answers stays where a call token always held it, beside
 * the two claims: a keypad route of the release before, still answering
 * while an upgrade rolls out, reads it there.
 *
 * A call placed before this release has the earlier action - the page's
 * link token beside a call token that names no notification - and keeps it
 * until its call token expires, a day after the call was placed. Such a
 * call is taken in its earlier form while its call token lasts: its call
 * token says nothing of what it is for, was signed to last a day at most,
 * and the page's link token in its address names the notification. No call
 * of this release is signed that way, so the earlier form is refused once
 * the last call placed before the upgrade has expired.
 */

export const ON_CALL_KEYPAD_TOKEN_PURPOSE: string = "on-call-keypad";

// The query parameter the token rides in, on the <Gather> action.
export const ON_CALL_KEYPAD_TOKEN_PARAM: string = "token";

// A day: longer than any call goes on.
export const ON_CALL_KEYPAD_TOKEN_EXPIRES_IN_SECONDS: number =
  OneUptimeDate.getDayInSeconds();

// Why a key press is refused, for the server's log: never a token.
export enum OnCallKeypadTokenRefusal {
  // A token of a call placed for another notification.
  OtherNotification = "OtherNotification",
  // Signed by OneUptime, but not for a call's keypad.
  NotAKeypadToken = "NotAKeypadToken",
  /*
   * A call placed before this release, whose address carries no page link
   * token for this notification: nothing binds it to the page.
   */
  EarlierCallWithoutPageToken = "EarlierCallWithoutPageToken",
}

export type OnCallKeypadTokenReading =
  | {
      isAccepted: true;
      // What each key answers, as the call was told.
      answers: OnCallInputRequest;
      // A call placed before this release, taken while its call token lasts.
      isEarlierCall: boolean;
    }
  | {
      isAccepted: false;
      refusal: OnCallKeypadTokenRefusal;
    };

export function getOnCallKeypadTokenRefusalSentence(
  refusal: OnCallKeypadTokenRefusal,
): string {
  switch (refusal) {
    case OnCallKeypadTokenRefusal.OtherNotification:
      return "Its call token was signed for another notification.";
    case OnCallKeypadTokenRefusal.EarlierCallWithoutPageToken:
      return "It is the address of a call placed before this release, and it carries no page link token for this notification.";
    case OnCallKeypadTokenRefusal.NotAKeypadToken:
    default:
      return "Its call token is not one OneUptime signed for a call's keypad.";
  }
}

export default class OnCallKeypadToken {
  /*
   * The token of a call's keypad: what each key answers, what it is for,
   * and the notification the call is placed for.
   */
  public static sign(data: {
    // An id, or its text: the Notification service reads it from JSON.
    userOnCallLogTimelineId: ObjectID | string | undefined;
    answers: OnCallInputRequest;
  }): string {
    const claims: JSONObject = JSONFunctions.serialize(
      data.answers as unknown as JSONObject,
    );

    claims["purpose"] = ON_CALL_KEYPAD_TOKEN_PURPOSE;
    claims["notification"] = data.userOnCallLogTimelineId
      ? data.userOnCallLogTimelineId.toString()
      : "";

    return JSONWebToken.signJsonPayload(
      claims,
      ON_CALL_KEYPAD_TOKEN_EXPIRES_IN_SECONDS,
    );
  }

  /*
   * Whether a key press may be taken for the notification in the route's
   * path, from the claims of its call token - which NotificationMiddleware
   * has verified, and which have not expired - and the page link token the
   * address of a call placed before this release carries. Never throws.
   */
  public static read(data: {
    claims: JSONObject;
    userOnCallLogTimelineId: ObjectID;
    // The page link token in the address, for a call placed before this release.
    pageToken: unknown;
  }): OnCallKeypadTokenReading {
    const claims: JSONObject = data.claims || {};
    const purpose: unknown = claims["purpose"];

    if (!OnCallKeypadToken.isAnswers(claims)) {
      return {
        isAccepted: false,
        refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
      };
    }

    // A call placed before this release: its token says nothing of what it is for.
    if (purpose === undefined || purpose === null) {
      if (!OnCallKeypadToken.livesADayAtMost(claims)) {
        return {
          isAccepted: false,
          refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
        };
      }

      if (
        !OnCallPageLinkToken.isValid({
          token: data.pageToken,
          userOnCallLogTimelineId: data.userOnCallLogTimelineId,
        })
      ) {
        return {
          isAccepted: false,
          refusal: OnCallKeypadTokenRefusal.EarlierCallWithoutPageToken,
        };
      }

      return {
        isAccepted: true,
        answers: claims as unknown as OnCallInputRequest,
        isEarlierCall: true,
      };
    }

    if (purpose !== ON_CALL_KEYPAD_TOKEN_PURPOSE) {
      return {
        isAccepted: false,
        refusal: OnCallKeypadTokenRefusal.NotAKeypadToken,
      };
    }

    const notification: unknown = claims["notification"];

    if (
      typeof notification !== "string" ||
      !notification ||
      notification.toLowerCase() !==
        data.userOnCallLogTimelineId.toString().toLowerCase()
    ) {
      return {
        isAccepted: false,
        refusal: OnCallKeypadTokenRefusal.OtherNotification,
      };
    }

    return {
      isAccepted: true,
      answers: claims as unknown as OnCallInputRequest,
      isEarlierCall: false,
    };
  }

  // What each key answers: at least what any other key does.
  private static isAnswers(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const fallback: unknown = (value as JSONObject)["default"];

    return Boolean(
      fallback &&
        typeof fallback === "object" &&
        typeof (fallback as JSONObject)["sayMessage"] === "string",
    );
  }

  /*
   * Signed to last a day at most, as every call token was: a token of a
   * longer life - one signed for anything else - is no call's.
   */
  private static livesADayAtMost(claims: JSONObject): boolean {
    const issuedAt: unknown = claims["iat"];
    const expiresAt: unknown = claims["exp"];

    return (
      typeof issuedAt === "number" &&
      typeof expiresAt === "number" &&
      Number.isFinite(issuedAt) &&
      Number.isFinite(expiresAt) &&
      expiresAt - issuedAt <= ON_CALL_KEYPAD_TOKEN_EXPIRES_IN_SECONDS
    );
  }
}
