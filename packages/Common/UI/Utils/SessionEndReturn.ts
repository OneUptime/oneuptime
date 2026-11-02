import { DashboardRoute } from "../../ServiceRoute";
import Route from "../../Types/API/Route";
import {
  SESSION_ENDED_QUERY_PARAM,
  SessionEndReason,
} from "../../Types/UserSession/SessionLength";
import UniversalCookies from "universal-cookie";

/*
 * BACK TO THE PAGE A PERSON WAS ON, ONCE THEIR SESSION ENDED AND THEY SIGNED
 * IN AGAIN.
 *
 * A session ends while its person is on a page: it reached the length the
 * server allows, or the idle timeout (Common/Types/UserSession/
 * SessionLength.ts), or it was signed out somewhere else. The Dashboard and
 * the Admin Dashboard then send the browser to the sign-in page (Utils/API/
 * API.ts) - which says why, when the server said why (getSignInRoute) - and
 * every way of signing in ends on the Dashboard's home page, not where the
 * person was. So the page they were on waits in a cookie, as an MCP
 * authorization does (McpOAuthPendingAuthorization explains why a cookie,
 * and why one scoped to the Dashboard's path survives being sent to sign
 * in), and the Dashboard, once its project list has loaded for a signed-in
 * person, opens it again (Dashboard Utils/SessionEndResume).
 *
 * WHAT IS IN IT
 *
 * The page's address on this server - a Dashboard or Admin Dashboard path,
 * with its query and fragment, checked for its shape and nothing else - and
 * who was signed in, so a different person signing in on the same browser
 * starts on their own home page instead of someone else's. It is not a
 * credential: opening the page still takes the person's own session and
 * permissions. It lasts a day (MAX_AGE_IN_SECONDS), and it is used once:
 * reading it removes it. Signing out on purpose (the user menu's Log out)
 * leaves nothing behind - only a session that ended does.
 */

export const SESSION_END_RETURN_COOKIE_NAME: string =
  "oneuptime-page-after-sign-in";

// Sent only with requests for the dashboard, which is where it is read.
const COOKIE_PATH: string = DashboardRoute.toString();

// A day: long enough for someone signed out overnight, short enough to never surprise.
export const MAX_AGE_IN_SECONDS: number = 24 * 60 * 60;

// The longest address kept; a longer one is not remembered.
export const MAX_PAGE_LENGTH: number = 2000;

// The pages a person can be brought back to: the Dashboard's and the Admin Dashboard's.
const RETURNABLE_PAGE_PATTERN: RegExp = /^\/(?:dashboard|admin)(?:[/?#]|$)/;

// What the cookie holds.
interface RememberedPage {
  userId: string;
  page: string;
}

export default class SessionEndReturn {
  /*
   * Whether `page` is one to bring someone back to: an address on this
   * server under /dashboard or /admin, of a sane length, that a Route takes
   * (so it can never be anything a navigation would not treat as a path).
   */
  public static isReturnablePage(page: unknown): page is string {
    if (
      typeof page !== "string" ||
      page.length === 0 ||
      page.length > MAX_PAGE_LENGTH ||
      page.startsWith("//") ||
      page.includes("\\") ||
      !RETURNABLE_PAGE_PATTERN.test(page)
    ) {
      return false;
    }

    try {
      new Route(page);
    } catch {
      return false;
    }

    return true;
  }

  /*
   * Remembers the page the browser is on for after the next sign-in, for
   * the person `userId` names. False when it is not a page to return to,
   * or there is no person.
   */
  public static rememberCurrentPage(
    userId: string | null | undefined,
  ): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    const page: string = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    return SessionEndReturn.remember({ userId, page });
  }

  public static remember(data: {
    userId: string | null | undefined;
    page: string;
  }): boolean {
    const userId: string = (data.userId || "").toString().trim().toLowerCase();

    if (!userId || !SessionEndReturn.isReturnablePage(data.page)) {
      return false;
    }

    const remembered: RememberedPage = { userId: userId, page: data.page };

    try {
      new UniversalCookies().set(
        SESSION_END_RETURN_COOKIE_NAME,
        JSON.stringify(remembered),
        {
          path: COOKIE_PATH,
          maxAge: MAX_AGE_IN_SECONDS,
          sameSite: "lax",
          secure: window.location.protocol === "https:",
        },
      );
    } catch {
      return false;
    }

    return true;
  }

  public static clear(): void {
    new UniversalCookies().remove(SESSION_END_RETURN_COOKIE_NAME, {
      path: COOKIE_PATH,
    });
  }

  /*
   * The page to bring `userId` back to, or null: nothing remembered, a
   * page remembered for someone else, or one that is not a page to return
   * to. Reading it forgets it. Only a page under the Dashboard's path can
   * see the cookie, so this answers null anywhere else.
   */
  public static consumeRoute(userId: string | null | undefined): Route | null {
    const cookies: UniversalCookies = new UniversalCookies();

    // doNotParse: the value is read as JSON here, and checked as it is read.
    const value: unknown = cookies.get(SESSION_END_RETURN_COOKIE_NAME, {
      doNotParse: true,
    });

    if (value === undefined || value === null || value === "") {
      return null;
    }

    SessionEndReturn.clear();

    if (typeof value !== "string") {
      return null;
    }

    let remembered: unknown = null;

    try {
      remembered = JSON.parse(value);
    } catch {
      return null;
    }

    if (!remembered || typeof remembered !== "object") {
      return null;
    }

    const rememberedUserId: unknown = (remembered as Record<string, unknown>)[
      "userId"
    ];
    const page: unknown = (remembered as Record<string, unknown>)["page"];
    const signedInUserId: string = (userId || "")
      .toString()
      .trim()
      .toLowerCase();

    if (
      typeof rememberedUserId !== "string" ||
      !signedInUserId ||
      rememberedUserId !== signedInUserId ||
      !SessionEndReturn.isReturnablePage(page)
    ) {
      return null;
    }

    return new Route(page);
  }

  /*
   * The sign-in page to send someone whose session ended to: the
   * Dashboard's own (`loginRoute`), saying why when the server said why.
   */
  public static getSignInRoute(
    loginRoute: Route,
    reason: SessionEndReason | null,
  ): Route {
    if (!reason) {
      return loginRoute;
    }

    return new Route(loginRoute.toString()).addQueryParams({
      [SESSION_ENDED_QUERY_PARAM]: reason,
    });
  }
}
