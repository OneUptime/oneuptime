import Route from "Common/Types/API/Route";
import McpOAuthPendingAuthorization from "Common/UI/Utils/McpOAuthPendingAuthorization";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * Picks an MCP authorization back up after a sign-in.
 *
 * Someone connecting an MCP client who was not signed in is sent to the
 * sign-in page by the consent screen, which first leaves the request in a
 * cookie (McpOAuthPendingAuthorization explains why a cookie, and why that
 * one survives). Every kind of sign-in ends on the dashboard, so the dashboard
 * calls this once it knows there is a session, and the browser goes back to
 * the consent screen with the request it came with.
 *
 * Returns true when the browser is being sent away, so the caller can stop
 * what it was doing instead of rendering a dashboard nobody will see.
 */
export const resumePendingMcpAuthorization: () => boolean = (): boolean => {
  // Reading the request forgets it: it is resumed once, never on a later visit.
  const consentRoute: Route | null =
    McpOAuthPendingAuthorization.consumeRoute();

  if (!consentRoute) {
    return false;
  }

  /*
   * A full document navigation, not a router one: the consent screen belongs
   * to the Accounts app, which is a different bundle from this one.
   */
  Navigation.navigate(consentRoute, { forceNavigate: true });

  return true;
};
