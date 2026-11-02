import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import SessionEndReturn from "Common/UI/Utils/SessionEndReturn";
import UserUtil from "Common/UI/Utils/User";

/*
 * Brings a person back to the page they were on when their session ended,
 * once they have signed in again.
 *
 * The Dashboard and the Admin Dashboard remember that page when a session
 * ends under them - its length or idle timeout reached, or signed out
 * somewhere else - and send the browser to sign in (Common/UI/Utils/
 * SessionEndReturn explains how it waits, and for whom). Every kind of
 * sign-in ends on the Dashboard, so the Dashboard reads it back once its
 * project list has loaded, which proves there is a session, and opens it:
 * a Dashboard page, or an Admin Dashboard page (which, as ever, opens only
 * for a master admin).
 *
 * Read first, before the other pages a sign-in can lead back to (an MCP
 * authorization, a marketplace purchase, a Connect link from Slack or
 * Microsoft Teams), and opened only when none of those takes the browser
 * elsewhere: reading it forgets it either way, so it never comes back on a
 * later visit.
 */

// The remembered page for the person signed in now, forgotten as it is read.
export const takePageAfterSessionEnd: () => Route | null = (): Route | null => {
  return SessionEndReturn.consumeRoute(UserUtil.getUserId().toString());
};

/*
 * Opens a remembered page. Returns true when the browser is being sent
 * away, so the caller can stop instead of rendering a page nobody will
 * see. The page the browser is on already is not opened again.
 */
export const resumePageAfterSessionEnd: (route: Route | null) => boolean = (
  route: Route | null,
): boolean => {
  if (!route) {
    return false;
  }

  const routeValue: string = route.toString();
  const currentPage: string = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (routeValue === currentPage) {
    return false;
  }

  /*
   * A full document navigation, not a router one: an Admin Dashboard page
   * belongs to another bundle, and a Dashboard page then starts as it does
   * when its address is opened.
   */
  Navigation.navigate(route, { forceNavigate: true });

  return true;
};
