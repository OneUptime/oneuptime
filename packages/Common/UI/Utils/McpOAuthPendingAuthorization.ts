import { AccountsRoute, DashboardRoute } from "../../ServiceRoute";
import Route from "../../Types/API/Route";
import {
  MCP_OAUTH_TICKET_MAX_LENGTH,
  MCP_OAUTH_TICKET_PATTERN,
} from "../../Types/Mcp/McpOAuthTicket";
import UniversalCookies from "universal-cookie";

/*
 * Carries an MCP authorization request across a sign-in.
 *
 * Someone connecting an MCP client is sent to the consent screen
 * (/accounts/mcp-authorize) with a signed description of the request in the
 * URL. If they are not signed in, the screen has to send them to the sign-in
 * page - and every way of signing in (password, two-factor, passkey, SSO
 * through an identity provider and back) ends on the dashboard, not where the
 * person came from: there is no return address in that flow, and several of
 * its hops leave this site entirely.
 *
 * So the request waits in a cookie. The consent screen writes it before it
 * finds out whether there is a session; the dashboard, once it has loaded for
 * a signed-in user, looks for it and sends the browser back to the consent
 * screen. One hook, and it covers every sign-in method there is or will be.
 *
 * WHY A COOKIE, AND WHY THIS ONE SURVIVES
 *
 * Being sent to the sign-in page wipes nearly everything a page can leave
 * behind, twice over:
 *
 *   - in the browser, UserUtil.logout clears local storage, session storage
 *     and every cookie named in the CookieName enum - which is why this name
 *     is NOT in it;
 *   - on the server, the failed session refresh and the logout call that
 *     precede the redirect each clear EVERY cookie the request carried
 *     (CookieUtil.removeAllCookies), whatever it is called.
 *
 * The second one is why the cookie is scoped to the dashboard's path. A cookie
 * is only sent with requests under its path, so one for /dashboard never
 * reaches the identity endpoints and cannot be cleared by them; and the
 * dashboard - the only reader - is exactly where it is visible. A page may
 * set (and remove) a cookie for a path it is not on, so the consent screen
 * can still write it.
 *
 * WHAT IS IN IT
 *
 * The ticket and nothing else. It is not a credential: it only says what a
 * client asked for, it is signed so it cannot be altered, and approving it
 * still takes the person's own session. It is short-lived to match the ticket
 * (ten minutes), and it is used once - reading it removes it.
 */

const COOKIE_NAME: string = "oneuptime-mcp-oauth-pending-request";

// Sent only with requests for the dashboard, which is where it is read.
const COOKIE_PATH: string = DashboardRoute.toString();

// The ticket's own lifetime (McpOAuthConfig.AUTHORIZATION_REQUEST_TTL_SECONDS).
const MAX_AGE_IN_SECONDS: number = 10 * 60;

export const MCP_AUTHORIZE_ROUTE: string = `${AccountsRoute.toString()}/mcp-authorize`;

export default class McpOAuthPendingAuthorization {
  /*
   * Shaped like a ticket, and no longer than the server ever issues one (the
   * limit is shared with it - see McpOAuthTicket). Whether it is GENUINE only
   * the server can say; this keeps anything else out of a URL or a cookie.
   */
  public static isTicket(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.length <= MCP_OAUTH_TICKET_MAX_LENGTH &&
      MCP_OAUTH_TICKET_PATTERN.test(value)
    );
  }

  /*
   * Remember a request across a sign-in. False when it cannot be - not a
   * ticket, or too large for a cookie.
   */
  public static remember(ticket: unknown): boolean {
    if (!McpOAuthPendingAuthorization.isTicket(ticket)) {
      return false;
    }

    new UniversalCookies().set(COOKIE_NAME, ticket, {
      path: COOKIE_PATH,
      maxAge: MAX_AGE_IN_SECONDS,
      sameSite: "lax",
      secure: window.location.protocol === "https:",
    });

    return true;
  }

  public static clear(): void {
    new UniversalCookies().remove(COOKIE_NAME, { path: COOKIE_PATH });
  }

  /*
   * The consent screen route for the remembered request, or null. Reading it
   * forgets it: a request is resumed once. Whatever is in the cookie is
   * checked to be shaped like a ticket before it goes anywhere near a URL.
   *
   * Only a page under the dashboard's path can see the cookie, so this
   * answers null anywhere else.
   */
  public static consumeRoute(): Route | null {
    const cookies: UniversalCookies = new UniversalCookies();

    /*
     * doNotParse: a ticket is never JSON, and the library would otherwise try
     * to parse anything that looks like it.
     */
    const ticket: unknown = cookies.get(COOKIE_NAME, { doNotParse: true });

    if (ticket === undefined || ticket === null || ticket === "") {
      return null;
    }

    McpOAuthPendingAuthorization.clear();

    if (!McpOAuthPendingAuthorization.isTicket(ticket)) {
      return null;
    }

    return McpOAuthPendingAuthorization.getConsentRoute(ticket);
  }

  public static getConsentRoute(ticket: string): Route {
    return new Route(`${MCP_AUTHORIZE_ROUTE}?request=${ticket}`);
  }
}
