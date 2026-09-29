import Headers from "Common/Types/API/Headers";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import APIException from "Common/Types/Exception/ApiException";
import BaseAPI from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * The client the public incident form page talks to the API with, and the
 * only one it uses.
 *
 * The page is open to anybody holding a form's link, with or without a
 * OneUptime account, and it is served from the same host as the dashboard.
 * A visitor who IS signed in therefore carries their dashboard session
 * cookies along, often expired. The dashboard's client (BaseAPI) answers a
 * 401 by refreshing that session and, when the refresh fails, by signing the
 * user out and sending them to /accounts/login; it answers a 403 by sending
 * them to /accounts/forbidden. None of that may happen here. The form routes
 * never read who is asking; a refresh would spend - and could rotate away -
 * the visitor's real session; signing them out would end it; and navigating
 * away would throw away the report they were typing. So:
 *
 *  - no session is ever refreshed (getRefreshSessionUrl is null);
 *  - nobody is ever signed out (logoutUser does nothing);
 *  - no error navigates anywhere: handleError hands every error back to the
 *    page, which says what went wrong next to the form. Should anything in
 *    BaseAPI still ask where to send the visitor, the answer is the page
 *    they are already on;
 *  - tenantid is sent empty, as the public dashboard and status page clients
 *    send it: a form belongs to its own project, and naming one is never the
 *    caller's business.
 */
export default class IncidentFormAPI extends BaseAPI {
  public static override getDefaultHeaders(): Headers {
    return {
      ...super.getDefaultHeaders(),
      tenantid: "",
    };
  }

  public static override handleError(
    error: HTTPErrorResponse | APIException,
  ): HTTPErrorResponse | APIException {
    return error;
  }

  public static override logoutUser(): void {
    // The page has no session of its own, and the visitor's is not its to end.
  }

  protected static override getRefreshSessionUrl(): URL | null {
    return null;
  }

  public static override getLoginRoute(): Route {
    return Navigation.getCurrentRoute();
  }

  public static override getForbiddenRoute(): Route {
    return Navigation.getCurrentRoute();
  }
}
