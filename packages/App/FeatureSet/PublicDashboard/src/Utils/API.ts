import PublicDashboardUtil from "./PublicDashboard";
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

    if (PublicDashboardUtil.requiresMasterPassword()) {
      return new Route(`${basePath}/master-password`);
    }

    return new Route(`${basePath}/`);
  }

  public static override logoutUser(): void {
    PublicDashboardUtil.setMasterPasswordValidated(false);
  }

  /*
   * A public dashboard has no session to refresh: its only credential is the
   * master-password cookie, and a 401 means "enter it again". Inheriting the
   * dashboard refresh sent a viewer's 401 to /identity/refresh-token; for a
   * viewer with no dashboard session that refresh fails, and a failed refresh
   * answers by clearing every cookie on the host - the master-password cookie
   * included.
   */
  protected static override getRefreshSessionUrl(): URL | null {
    return null;
  }

  public static override getForbiddenRoute(): Route {
    return new Route(
      PublicDashboardUtil.isPreviewPage()
        ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString()}/forbidden`
        : "/forbidden",
    );
  }
}
