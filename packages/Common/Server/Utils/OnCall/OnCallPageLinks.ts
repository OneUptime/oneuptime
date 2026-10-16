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
 * Microsoft Teams, a call - is one notification (UserOnCallLogTimeline), and
 * its links open pages about it (UserOnCallLogTimelineAPI):
 *
 *   acknowledge-page   what the page is about, with Acknowledge - and, for a
 *                      link that carries the page's token, "Can't take it?
 *                      Pass it on" beside it;
 *   pass-on-page       what passing it on would do, and the button that does
 *                      it (a form, so a mail scanner that follows every link
 *                      passes nothing on);
 *   call/gather-input  where a call's key press goes.
 *
 * The links built here carry the page's token (OnCallPageLinkToken), which
 * is what lets them pass the page on. Links sent before there was a token
 * still acknowledge, as they always did.
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
   * The page a message's Acknowledge link opens, with the token: it offers
   * "Can't take it? Pass it on" too.
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

  // The page a message's "Pass it on" link opens.
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

  // The address that acknowledges, as the acknowledge page's button has always been.
  public static async getAcknowledgeUrl(
    userOnCallLogTimelineId: ObjectID,
  ): Promise<URL> {
    return await this.getUrl({
      path: "acknowledge",
      userOnCallLogTimelineId: userOnCallLogTimelineId,
    });
  }

  /*
   * Where a call sends the key the person pressed, with the token: pressing
   * 2 passes the page on only through it.
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
