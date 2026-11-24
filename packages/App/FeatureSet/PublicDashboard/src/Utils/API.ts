import PublicDashboardUtil, {
  PUBLIC_DASHBOARD_SIGN_IN_PATH,
} from "./PublicDashboard";
import PublicDashboardSignIn from "./SignIn";
import { DashboardPrivateUserApiRoutes } from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import Headers from "Common/Types/API/Headers";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import BaseAPI from "Common/UI/Utils/API/API";

export default class API extends BaseAPI {
  public static override getDefaultHeaders(): Headers {
    const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();

    if (!dashboardId) {
      return {};
    }

    return {
      "dashboard-id": dashboardId.toString(),
      tenantid: "",
    };
  }

  public static override getLoginRoute(): Route {
    const basePath: string = PublicDashboardUtil.isPreviewPage()
      ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString()}`
      : "";

    // A dashboard that asks its visitors to sign in (#10250).
    if (PublicDashboardUtil.requiresSignIn()) {
      return new Route(`${basePath}${PUBLIC_DASHBOARD_SIGN_IN_PATH}`);
    }

    if (PublicDashboardUtil.requiresMasterPassword()) {
      return new Route(`${basePath}/master-password`);
    }

    return new Route(`${basePath}/`);
  }

  /*
   * No OneUptime session to end: the master password is asked again. A
   * dashboard's private user's session the server already ended when its
   * renewal was refused, and cleared its cookies with it.
   */
  public static override logoutUser(): Promise<void> {
    PublicDashboardUtil.setMasterPasswordValidated(false);
    return Promise.resolve();
  }

  /*
   * A public dashboard has no OneUptime session to refresh: a 401 on a
   * dashboard behind its password means "enter it again". Inheriting the
   * dashboard refresh sent a viewer's 401 to /identity/refresh-token; for a
   * viewer with no dashboard session that refresh fails, and a failed refresh
   * answers by clearing every cookie on the host - the master-password cookie
   * included.
   *
   * A dashboard that asks its visitors to sign in (#10250) has a session of
   * its own, though: one of its private users', renewed on the dashboard's
   * own sign-in route, on the host the page is served from - never the
   * Dashboard's.
   */
  protected static override getRefreshSessionUrl(): URL | null {
    const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();

    if (!dashboardId || !PublicDashboardUtil.requiresSignIn()) {
      return null;
    }

    return PublicDashboardSignIn.getRouteUrl(
      DashboardPrivateUserApiRoutes.refreshToken,
      dashboardId,
    );
  }

  /*
   * What the dashboard's renewal answers: who is signed in, beside the
   * cookies it sets (DashboardPrivateUserAuthentication's refresh-token).
   */
  protected static override isSessionRenewalAnswer(data: unknown): boolean {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return false;
    }

    const email: unknown = (data as Record<string, unknown>)["email"];

    return typeof email === "string" && email.trim().length > 0;
  }

  // One session per dashboard, never the Dashboard's: renewals lock apart.
  protected static override getSessionName(): string {
    return `public-dashboard-private-user-${
      PublicDashboardUtil.getDashboardId()?.toString() || "none"
    }`;
  }

  public static override getForbiddenRoute(): Route {
    return new Route(
      PublicDashboardUtil.isPreviewPage()
        ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString()}/forbidden`
        : "/forbidden",
    );
  }
}
