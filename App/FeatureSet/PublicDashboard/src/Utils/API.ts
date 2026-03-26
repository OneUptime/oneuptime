import PublicDashboardUtil from "./PublicDashboard";
import Headers from "Common/Types/API/Headers";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import BaseAPI from "Common/UI/Utils/API/API";

export default class API extends BaseAPI {
  public static override getDefaultHeaders(): Headers {
    const dashboardId: ObjectID | null =
      PublicDashboardUtil.getDashboardId();

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

    if (
      PublicDashboardUtil.requiresMasterPassword() &&
      !PublicDashboardUtil.isMasterPasswordValidated()
    ) {
      return new Route(`${basePath}/master-password`);
    }

    return new Route(`${basePath}/`);
  }

  public static override logoutUser(): void {
    // No-op for public dashboards
  }

  public static override getForbiddenRoute(): Route {
    return new Route(
      PublicDashboardUtil.isPreviewPage()
        ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString()}/forbidden`
        : "/forbidden",
    );
  }
}
