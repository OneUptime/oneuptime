import DatabaseConfig from "../../DatabaseConfig";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import { AppApiRoute } from "../../../ServiceRoute";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import {
  CUSTOM_CHANNEL_ACTIONS,
  CustomChannelAction,
  CustomChannelActionLinks,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import JSONWebToken from "../JsonWebToken";

/*
 * THE PROOF A CUSTOM CHANNEL'S SERVICE SHOWS TO ACT ON A PAGE.
 *
 * A page sent on a custom channel carries links its service POSTs to when the
 * person presses Acknowledge, Escalate or Resolve in the company's own app
 * (CustomChannelAction). The service holds no OneUptime API key and needs
 * none: each link carries this token, signed with TokenSigningKey
 * (JSONWebToken), naming the one notification (UserOnCallLogTimeline) it is
 * for. CustomNotificationChannelAPI acts on that notification alone, as the
 * person it paged, and only while the token is valid.
 *
 * A token of its own purpose, not the on-call page link token
 * (OnCallPageLinkToken) the other channels' links carry: those links can
 * acknowledge and escalate, and these can resolve as well. A text message
 * forwarded somewhere must not become a way to resolve an incident, so a
 * page link's token is refused here, and this token is refused there.
 *
 * It lasts a week, as a page link does: longer than any page goes on, and
 * short enough that an old request kept somewhere is no standing permission.
 */

export const CUSTOM_CHANNEL_ACTION_TOKEN_PURPOSE: string =
  "custom-channel-action";

// The query parameter the token rides in, on every action link.
export const CUSTOM_CHANNEL_ACTION_TOKEN_PARAM: string = "token";

export const CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS: number =
  7 * 24 * 60 * 60;

// No token OneUptime signs is anywhere near this long.
const MAX_TOKEN_LENGTH: number = 2048;

export default class CustomChannelActionToken {
  // The token for the action links of one notification.
  public static sign(data: { userOnCallLogTimelineId: ObjectID }): string {
    return JSONWebToken.signJsonPayload(
      {
        purpose: CUSTOM_CHANNEL_ACTION_TOKEN_PURPOSE,
        notification: data.userOnCallLogTimelineId.toString(),
      },
      CUSTOM_CHANNEL_ACTION_TOKEN_EXPIRES_IN_SECONDS,
    );
  }

  /*
   * Whether `token` is one OneUptime signed for the action links of this
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
      payload["purpose"] === CUSTOM_CHANNEL_ACTION_TOKEN_PURPOSE &&
      typeof payload["notification"] === "string" &&
      payload["notification"].toLowerCase() ===
        data.userOnCallLogTimelineId.toString().toLowerCase()
    );
  }

  /*
   * The links of one notification, one per action:
   * <api>/custom-notification-channel/page/<notification id>/<action>?token=...
   * One token serves all three: it names the notification, not the action.
   */
  public static async getActionLinks(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<CustomChannelActionLinks> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    const token: string = this.sign({
      userOnCallLogTimelineId: userOnCallLogTimelineId,
    });

    const links: Partial<CustomChannelActionLinks> = {};

    for (const action of CUSTOM_CHANNEL_ACTIONS) {
      links[action] = new URL(
        httpProtocol,
        host,
        new Route(AppApiRoute.toString())
          .addRoute(new CustomNotificationChannel().crudApiPath!)
          .addRoute(
            `/page/${userOnCallLogTimelineId.toString()}/${action as CustomChannelAction}`,
          ),
      )
        .addQueryParam(CUSTOM_CHANNEL_ACTION_TOKEN_PARAM, token)
        .toString();
    }

    return links as CustomChannelActionLinks;
  }
}
