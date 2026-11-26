import HelpAndSupportServerSettings from "./HelpAndSupportServerSettings";
import UserMiddleware, {
  RequestSession,
} from "../../Middleware/UserAuthorization";
import { ExpressRequest } from "../Express";
import {
  DocsSiteLinks,
  HelpAndSupportSettings,
  getDefaultHelpAndSupportSettings,
  getDocsSiteLinks,
  hasOwnChatLink,
} from "../../../Types/HelpAndSupport/HelpAndSupport";

/*
 * WHAT THE DOCS SITE AND THE API REFERENCE LINK TO, FOR ONE REQUEST (#10940).
 *
 * The rules are pure (Types/HelpAndSupport: getDocsSiteLinks); this reads
 * what they need: the settings, from the copy every page is served from
 * (HelpAndSupportServerSettings, kept 30 seconds), and - only where the
 * server has a chat link of its own - whether the reader is signed in, as
 * the API reads a session (UserMiddleware.readRequestSession). On OneUptime
 * Cloud, and on every server without a chat link of its own, no session is
 * read at all.
 *
 * The App hands it to the docs and the reference when it starts
 * (DocsSiteLinksStore). Never throws: settings that cannot be read are
 * OneUptime's own (HelpAndSupportServerSettings already says why in the
 * log), and a session that cannot be read is a reader who is not signed in.
 */
export class DocsSiteLinksClass {
  // The settings (tests replace it).
  public async getSettings(): Promise<HelpAndSupportSettings> {
    return await HelpAndSupportServerSettings.getSettings();
  }

  // Whether the request carries a live session of a person (tests replace it).
  public async isSignedIn(req: ExpressRequest): Promise<boolean> {
    try {
      const session: RequestSession =
        await UserMiddleware.readRequestSession(req);

      return session.kind === "user";
    } catch {
      return false;
    }
  }

  public async getLinks(req: ExpressRequest): Promise<DocsSiteLinks> {
    let settings: HelpAndSupportSettings;

    try {
      settings = await this.getSettings();
    } catch {
      settings = getDefaultHelpAndSupportSettings();
    }

    return getDocsSiteLinks(settings, {
      isSignedIn: hasOwnChatLink(settings) ? await this.isSignedIn(req) : false,
    });
  }
}

export default new DocsSiteLinksClass();
