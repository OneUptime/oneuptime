import DatabaseConfig from "../../DatabaseConfig";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import { AppApiRoute } from "../../../ServiceRoute";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_PARAM,
} from "./OnCallPageLinkToken";

/*
 * THE LINKS IN A PERSON'S OWN PAGE.
 *
 * Every message a page sends - email, text, WhatsApp, Telegram, Slack,
 * Microsoft Teams, Mattermost, a push, a call - is one notification
 * (UserOnCallLogTimeline), and its links open pages about it
 * (UserOnCallLogTimelineAPI):
 *
 *   acknowledge-page   what the page is about, with Acknowledge - and
 *                      "Can't take it? Escalate" beside it;
 *   pass-on-page       what escalating it would do, and the button that
 *                      does it;
 *   call/gather-input  where a call's key press goes.
 *
 * Opening a link changes nothing: each page asks, and only its button - a
 * form, which mail scanners and link previews do not send - acknowledges
 * (acknowledge) or escalates (pass-on). The links a message carries hold
 * the page's token (OnCallPageLinkToken), the proof that the person pressing
 * is the one the page was sent to, and the button sends it on. A call's
 * <Gather> action holds none (CallService leaves it out): the call's own
 * token (OnCallKeypadToken) and Twilio's signature stand for it there.
 */
export default class OnCallPageLinks {
  // <api>/user-notification-log-timeline/<what>/<notification id>
  private static async getUrl(data: {
    path: string;
    userOnCallLogTimelineId: ObjectID;
  }): Promise<URL> {
    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return new URL(
      httpProtocol,
      host,
      new Route(AppApiRoute.toString())
        .addRoute(new UserOnCallLogTimeline().crudApiPath!)
        .addRoute(`/${data.path}/${data.userOnCallLogTimelineId.toString()}`),
    );
  }

  private static withToken(url: URL, userOnCallLogTimelineId: ObjectID): URL {
    return url.addQueryParam(
      ON_CALL_PAGE_LINK_TOKEN_PARAM,
      OnCallPageLinkToken.sign({
        userOnCallLogTimelineId: userOnCallLogTimelineId,
      }),
    );
  }

  /*
   * The page a message's Acknowledge link opens, with the token: its
   * Acknowledge and "Can't take it? Escalate" send it on. Every message
   * leads here: an email and a push to this address, a text, a WhatsApp,
   * Telegram or chat message through a short link to it
   * (ShortLinkService).
   */
  public static async getAcknowledgePageUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
    return this.withToken(
      await this.getUrl({
        path: "acknowledge-page",
        userOnCallLogTimelineId: userOnCallLogTimelineId,
      }),
      userOnCallLogTimelineId,
    );
  }

  // The page a message's Escalate link opens (its address keeps pass-on).
  public static async getPassOnPageUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
    return this.withToken(
      await this.getUrl({
        path: "pass-on-page",
        userOnCallLogTimelineId: userOnCallLogTimelineId,
      }),
      userOnCallLogTimelineId,
    );
  }

  /*
   * Where the pass-on page's button sends its form. The token goes in the
   * form, not in this address.
   */
  public static async getPassOnUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
    return await this.getUrl({
      path: "pass-on",
      userOnCallLogTimelineId: userOnCallLogTimelineId,
    });
  }

  /*
   * Where the Acknowledge button sends its form, the token in the form, not
   * in this address. Opened rather than sent - an acknowledge page drawn
   * before this release linked its button here - it shows the acknowledge
   * page, and acknowledges nothing.
   */
  public static async getAcknowledgeUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
    return await this.getUrl({
      path: "acknowledge",
      userOnCallLogTimelineId: userOnCallLogTimelineId,
    });
  }

  /*
   * Where a call sends the key the person pressed, as a call request hands
   * it to the Notification service. CallService builds the call's <Gather>
   * action from it: without the page's link token, which escalates the page
   * from a browser too - the action lands in Twilio's request logs and in
   * the call's TwiML in the Twilio console - and with the call's own token,
   * which names this notification (OnCallKeypadToken).
   *
   * The page's link token stays in this address for one release, between
   * the worker and the Notification service only: while an upgrade rolls
   * out, a Notification service of the release before places this
   * release's calls as they come, and its keypad route takes the second key
   * - this release's takes any key - of such a call only with the page's
   * token in its action (OnCallKeypadToken's earlier form).
   */
  public static async getCallResponseUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
    return this.withToken(
      await this.getUrl({
        path: "call/gather-input",
        userOnCallLogTimelineId: userOnCallLogTimelineId,
      }),
      userOnCallLogTimelineId,
    );
  }
}
