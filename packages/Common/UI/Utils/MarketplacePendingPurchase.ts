import { DashboardRoute } from "../../ServiceRoute";
import Route from "../../Types/API/Route";
import {
  MARKETPLACE_PURCHASE_PAGE_ROUTE,
  MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME,
  MARKETPLACE_PURCHASE_TTL_IN_HOURS,
} from "../../Types/Marketplace/MarketplacePurchase";
import UniversalCookies from "universal-cookie";

/*
 * Brings a marketplace buyer back to the purchase page after they sign in.
 *
 * A buyer arriving from AWS, Microsoft or Google Cloud Marketplace who is not
 * signed in is sent to the sign-in page by the purchase page's first request,
 * and every way of signing in ends on the dashboard. So the purchase waits in
 * a marker cookie scoped to /dashboard - set by the server when the buyer
 * arrives, and again by the purchase page before its first request - and the
 * dashboard, once it has loaded for a signed-in user, sends the browser back
 * to the purchase page (see McpOAuthPendingAuthorization for why a /dashboard
 * cookie survives a sign-in when nothing else does).
 *
 * The marker is not a secret: it only says "a purchase is waiting here". The
 * purchase itself is named by a separate HttpOnly cookie no script can read,
 * which only the marketplace API receives.
 */

const COOKIE_PATH: string = DashboardRoute.toString();
const MARKER_VALUE: string = "1";

export default class MarketplacePendingPurchase {
  public static remember(): void {
    new UniversalCookies().set(
      MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME,
      MARKER_VALUE,
      {
        path: COOKIE_PATH,
        maxAge: MARKETPLACE_PURCHASE_TTL_IN_HOURS * 60 * 60,
        sameSite: "lax",
        secure: window.location.protocol === "https:",
      },
    );
  }

  public static clear(): void {
    new UniversalCookies().remove(MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME, {
      path: COOKIE_PATH,
    });
  }

  /*
   * The purchase page, when a purchase is waiting in this browser; null
   * otherwise. Reading the marker forgets it: the page sets it again before
   * a request that could send the browser to sign in once more.
   *
   * Only a page under the dashboard's path can see the marker, so this
   * answers null anywhere else.
   */
  public static consumeRoute(): Route | null {
    const cookies: UniversalCookies = new UniversalCookies();
    const marker: unknown = cookies.get(
      MARKETPLACE_PURCHASE_PENDING_COOKIE_NAME,
      { doNotParse: true },
    );

    if (marker === undefined || marker === null || marker === "") {
      return null;
    }

    MarketplacePendingPurchase.clear();

    if (marker !== MARKER_VALUE) {
      return null;
    }

    return new Route(MARKETPLACE_PURCHASE_PAGE_ROUTE);
  }
}
