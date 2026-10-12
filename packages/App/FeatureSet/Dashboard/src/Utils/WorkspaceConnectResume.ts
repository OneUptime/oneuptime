import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import WorkspaceConnectPendingLink from "Common/UI/Utils/WorkspaceConnectPendingLink";

/*
 * Picks a Connect link from Slack or Microsoft Teams back up after a sign-in.
 *
 * The Connect button OneUptime answers an unconnected press with opens the
 * person's own Slack or Microsoft Teams settings page in the dashboard, with
 * a token for the press. Somebody not signed in to OneUptime in that browser
 * is sent to the sign-in page by the dashboard's first request, and every
 * kind of sign-in ends on the dashboard's home page - so the link is
 * remembered before that first request goes out, and once the project list
 * has loaded (which proves there is a session) the browser is sent back to
 * it (Common/UI/Utils/WorkspaceConnectPendingLink).
 */

// Remembers the page when it is a Connect link; called before the first request.
export const rememberWorkspaceConnectLink: () => void = (): void => {
  WorkspaceConnectPendingLink.rememberCurrentPage();
};

/*
 * Sends the browser back to a remembered Connect link. Returns true when it
 * is being sent away, so the caller can stop instead of rendering a page
 * nobody will see. A link to the page the browser is on already - somebody
 * signed in all along - is forgotten, and the page goes on.
 */
export const resumeWorkspaceConnect: () => boolean = (): boolean => {
  // Reading the link forgets it: it is picked up once.
  const route: Route | null = WorkspaceConnectPendingLink.consumeRoute();

  if (!route) {
    return false;
  }

  const routePath: string = route.toString().split("?")[0] || "";

  if (routePath === window.location.pathname) {
    return false;
  }

  Navigation.navigate(route, { forceNavigate: true });

  return true;
};
