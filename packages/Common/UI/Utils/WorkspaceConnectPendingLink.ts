import { DashboardRoute } from "../../ServiceRoute";
import Route from "../../Types/API/Route";
import ConnectCallbackUtil, {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
  CONNECT_REQUEST_QUERY_PARAM,
} from "../../Types/Workspace/ConnectCallback";
import UniversalCookies from "universal-cookie";

/*
 * Carries a Connect link from Slack or Microsoft Teams across a sign-in.
 *
 * Somebody who pressed a button in Slack or Microsoft Teams before their own
 * account was connected gets a Connect button there. It opens their own
 * settings page for that workspace in the dashboard,
 * /dashboard/<project>/user-settings/slack-integration?connect=<token>, and
 * the page connects their account at once. If they are not signed in to
 * OneUptime in that browser, the dashboard sends them to the sign-in page
 * first - and every way of signing in (password, two-factor, passkey, SSO
 * through an identity provider and back) ends on the dashboard's home page,
 * not where they came from. The link would be lost, and with it the press
 * they were finishing.
 *
 * So the link waits in a cookie, the way an MCP authorization does
 * (McpOAuthPendingAuthorization, which explains why a cookie, and why one
 * scoped to the dashboard's path survives being sent to sign in). The
 * dashboard writes it before it finds out whether there is a session, and,
 * once its project list has loaded for a signed-in user, reads it back and
 * opens the page (Dashboard Utils/WorkspaceConnectResume).
 *
 * The Connect Slack account link in a Slack channel's note - the people
 * OneUptime could not add to it - waits the same way: the Slack page with
 * `?connectAccount=true`, which connects the account of whoever opens it.
 *
 * WHAT IS IN IT
 *
 * The page's path and its token (or the note's flag), each checked for its
 * shape, and nothing else. It is not a credential: the token only names a
 * press on the server, and connecting still takes the person's own session
 * and their own sign-in to Slack or Microsoft. It lasts as long as the press
 * does (thirty minutes), and it is used once: reading it removes it.
 */

const COOKIE_NAME: string = "oneuptime-workspace-connect-pending";

// Sent only with requests for the dashboard, which is where it is read.
const COOKIE_PATH: string = DashboardRoute.toString();

// As long as the press behind the token lasts (WorkspaceConnectRequest).
const MAX_AGE_IN_SECONDS: number = 30 * 60;

/*
 * The settings pages a Connect link opens: a project's Slack or Microsoft
 * Teams page under the person's own settings.
 */
const CONNECT_PAGE_PATH_PATTERN: RegExp =
  /^\/dashboard\/[0-9a-fA-F-]{36}\/user-settings\/(?:slack|microsoft-teams)-integration\/?$/;

// The page a note's Connect Slack account link opens: Slack only.
const CONNECT_ACCOUNT_PAGE_PATH_PATTERN: RegExp =
  /^\/dashboard\/[0-9a-fA-F-]{36}\/user-settings\/slack-integration\/?$/;

export default class WorkspaceConnectPendingLink {
  /*
   * The page `pathname` and `search` describe, as a route, when it is a
   * Connect link: one of the settings pages above, with a token shaped like
   * one - or the Slack page with a note's `?connectAccount=true`. Null for
   * any other page.
   */
  public static getConnectRoute(data: {
    pathname: string;
    search: string;
  }): Route | null {
    if (!CONNECT_PAGE_PATH_PATTERN.test(data.pathname)) {
      return null;
    }

    let params: URLSearchParams | null = null;

    try {
      params = new URLSearchParams(data.search);
    } catch {
      params = null;
    }

    if (!params) {
      return null;
    }

    const token: string | null = ConnectCallbackUtil.readConnectRequestToken(
      params.get(CONNECT_REQUEST_QUERY_PARAM),
    );

    if (token) {
      return new Route(
        `${data.pathname}?${CONNECT_REQUEST_QUERY_PARAM}=${token}`,
      );
    }

    if (
      CONNECT_ACCOUNT_PAGE_PATH_PATTERN.test(data.pathname) &&
      ConnectCallbackUtil.readConnectAccount(
        params.get(CONNECT_ACCOUNT_QUERY_PARAM),
      )
    ) {
      return new Route(
        `${data.pathname}?${CONNECT_ACCOUNT_QUERY_PARAM}=${CONNECT_ACCOUNT_QUERY_VALUE}`,
      );
    }

    return null;
  }

  /*
   * Remembers the page the browser is on when it is a Connect link, for
   * after a sign-in. True when it was remembered.
   */
  public static rememberCurrentPage(): boolean {
    const route: Route | null = WorkspaceConnectPendingLink.getConnectRoute({
      pathname: window.location.pathname,
      search: window.location.search,
    });

    if (!route) {
      return false;
    }

    new UniversalCookies().set(COOKIE_NAME, route.toString(), {
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
   * The remembered Connect link, or null. Reading it forgets it: a link is
   * picked up once. What is in the cookie is checked again for its shape
   * before it goes anywhere near a navigation.
   */
  public static consumeRoute(): Route | null {
    const cookies: UniversalCookies = new UniversalCookies();

    // doNotParse: a route is never JSON.
    const value: unknown = cookies.get(COOKIE_NAME, { doNotParse: true });

    if (value === undefined || value === null || value === "") {
      return null;
    }

    WorkspaceConnectPendingLink.clear();

    if (typeof value !== "string") {
      return null;
    }

    const queryStart: number = value.indexOf("?");

    if (queryStart === -1) {
      return null;
    }

    return WorkspaceConnectPendingLink.getConnectRoute({
      pathname: value.substring(0, queryStart),
      search: value.substring(queryStart),
    });
  }
}
