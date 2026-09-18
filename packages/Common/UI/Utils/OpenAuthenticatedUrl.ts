import BaseAPI from "./API/API";

/*
 * Opening an authenticated URL in a new tab, with the session refreshed first.
 *
 * A link to an authenticated API route (an attachment, a pprof export) is a
 * plain navigation. It carries the session cookies but none of the API
 * class's recovery: a request made through BaseAPI that comes back 401
 * refreshes the session and replays itself, while a navigation simply shows
 * the 401. The access cookie expires with the 15-minute access token, so on a
 * page left open that long every such link opened a bare "Authentication
 * required" page although the refresh token was still good. Refreshing before
 * navigating makes the new tab arrive with a live access cookie. It costs
 * nothing extra when another request or another tab has just refreshed:
 * refreshSession() reuses that result.
 */

export type RefreshSessionFunction = () => Promise<boolean>;

/*
 * The part of a click event the link handler reads. React.MouseEvent
 * satisfies it, and so does a DOM MouseEvent, so this module needs neither.
 */
export interface AuthenticatedLinkClickEvent {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

/*
 * The dashboard's session. A client with a session of its own (the status
 * page) passes its API class's refresh instead.
 */
const refreshDashboardSession: RefreshSessionFunction =
  async (): Promise<boolean> => {
    return await BaseAPI.refreshSession();
  };

/*
 * Point a tab this click already opened at the URL, once the session has been
 * refreshed. A refresh that did not work closes the tab instead: a refused one
 * means the session has ended and this page's API client is already taking
 * the user to the login page, and one that got no answer means the server
 * cannot be reached, so the tab would only show an error either way.
 */
async function navigateTabAfterRefresh(
  tab: Window,
  url: string,
  refreshSession: RefreshSessionFunction,
): Promise<void> {
  /*
   * Cut loose from this page, as rel="noopener" would have done. A blank tab
   * opened WITH the "noopener" feature could not be pointed anywhere
   * afterwards, because window.open returns null for it.
   */
  tab.opener = null;

  let refreshed: boolean = false;

  try {
    refreshed = await refreshSession();
  } catch {
    refreshed = false;
  }

  // Closed while the refresh ran: the user changed their mind.
  if (tab.closed) {
    return;
  }

  if (!refreshed) {
    tab.close();
    return;
  }

  tab.location.href = url;
}

export default async function openAuthenticatedUrl(
  url: string,
  refreshSession: RefreshSessionFunction = refreshDashboardSession,
): Promise<void> {
  /*
   * Popup blockers let window.open through only while the click is still
   * being handled; once the handler has awaited something, Safari and Firefox
   * no longer count the new tab as the user's doing and block it. So the tab
   * is opened now, blank, and pointed at the URL once the refresh has settled.
   */
  const newTab: Window | null = window.open("", "_blank");

  if (!newTab) {
    /*
     * Blocked. Ask for the URL itself, still inside the click: without a tab
     * to hold, there is nothing to refresh the session for.
     */
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  await navigateTabAfterRefresh(newTab, url, refreshSession);
}

/*
 * The onClick for an <a href={url} target="_blank"> that points at an
 * authenticated route. The href stays on the element so middle-click, "copy
 * link address" and the context menu keep working exactly as before (those
 * paths get no refresh); a plain click opens the URL in a tab of its own once
 * the session is refreshed.
 */
export function handleAuthenticatedLinkClick(
  event: AuthenticatedLinkClickEvent,
  url: string,
  refreshSession?: RefreshSessionFunction,
): void {
  /*
   * Modified clicks stay the browser's: cmd/ctrl-click opens a background
   * tab, shift-click a new window, alt-click downloads. Turning all of them
   * into a foreground tab would be a surprise.
   */
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  /*
   * Open the tab before deciding to take the click over. Where window.open
   * is refused (a popup-blocking extension, some in-app browsers) the anchor's
   * own navigation may still be allowed, so the click is left to it - no
   * refresh, but a link that opens, as it always did.
   */
  const newTab: Window | null = window.open("", "_blank");

  if (!newTab) {
    return;
  }

  event.preventDefault();

  void navigateTabAfterRefresh(
    newTab,
    url,
    refreshSession || refreshDashboardSession,
  );
}
