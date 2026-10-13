import { ViewsPath } from "./Config";
import { GoogleTagManagerEnabled } from "Common/Server/EnvironmentConfig";
import { ExpressResponse } from "Common/Server/Utils/Express";

export default class NotFoundUtil {
  public static renderNotFound(res: ExpressResponse): void {
    res.status(404);
    res.render(`${ViewsPath}/not-found.ejs`, {
      footerCards: false,
      support: false,
      cta: false,
      blackLogo: false,
      requestDemoCta: false,
      /*
       * The same Google tag as every other page, behind the same consent
       * rule. Without it a broken link was invisible in Google Analytics;
       * with it, every visit to one is a page view titled "Page not found",
       * at the URL that was asked for.
       */
      enableGoogleTagManager: GoogleTagManagerEnabled,
    });
  }
}
