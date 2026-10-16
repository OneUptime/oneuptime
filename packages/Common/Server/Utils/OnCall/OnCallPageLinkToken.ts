import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import JSONWebToken from "../JsonWebToken";

/*
 * THE PROOF A LINK IN A PERSON'S OWN PAGE CARRIES.
 *
 * The messages a page sends - an email, a text, a Slack or Microsoft Teams
 * message, a call - each name the one notification they are
 * (UserOnCallLogTimeline), and their links open a page about it. Passing a
 * page on changes who else gets paged, and stops the person's own
 * notifications, so a link that does it must be one OneUptime sent that
 * person: knowing a notification's id is not enough (people who may read an
 * on-call policy can read the ids of its notifications). So those links
 * carry this token - signed with TokenSigningKey (JSONWebToken), naming the
 * notification and what it is for - and the pages check it against the
 * notification in their path. A token for another notification, a token for
 * something else (a sign-in, a call's own token), an edited one or an
 * expired one is refused.
 *
 * It lasts a week: longer than any page goes on, and short enough that an
 * old message forwarded somewhere is no standing permission.
 */

export const ON_CALL_PAGE_LINK_TOKEN_PURPOSE: string = "on-call-page";

// The query parameter the token rides in, on every page link.
export const ON_CALL_PAGE_LINK_TOKEN_PARAM: string = "pageToken";

export const ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS: number =
  7 * 24 * 60 * 60;

// No token OneUptime signs is anywhere near this long.
const MAX_TOKEN_LENGTH: number = 2048;

export default class OnCallPageLinkToken {
  // The token for links in the messages of one notification.
  public static sign(data: { userOnCallLogTimelineId: ObjectID }): string {
    return JSONWebToken.signJsonPayload(
      {
        purpose: ON_CALL_PAGE_LINK_TOKEN_PURPOSE,
        notification: data.userOnCallLogTimelineId.toString(),
      },
      ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS,
    );
  }

  /*
   * Whether `token` is one OneUptime signed for the links of this
   * notification, and has not expired. Never throws.
   */
  public static isValid(data: {
    token: unknown;
    userOnCallLogTimelineId: ObjectID;
  }): boolean {
    if (
      typeof data.token !== "string" ||
      !data.token ||
      data.token.length > MAX_TOKEN_LENGTH
    ) {
      return false;
    }

    let payload: JSONObject;

    try {
      payload = JSONWebToken.decodeJsonPayload(data.token);
    } catch {
      return false;
    }

    return (
      payload["purpose"] === ON_CALL_PAGE_LINK_TOKEN_PURPOSE &&
      typeof payload["notification"] === "string" &&
      payload["notification"].toLowerCase() ===
        data.userOnCallLogTimelineId.toString().toLowerCase()
    );
  }
}
