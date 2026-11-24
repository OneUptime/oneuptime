import DashboardService from "Common/Server/Services/DashboardService";
import {
  PUBLIC_DASHBOARD_ACCESS_SELECT,
  PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE,
  PublicDashboardAccess,
  PublicDashboardAccessResult,
} from "Common/Server/Utils/Dashboard/PublicDashboardAccess";
import { ExpressRequest } from "Common/Server/Utils/Express";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import { DASHBOARD_SIGN_IN_NOT_ASKED_MESSAGE } from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE DASHBOARD A SIGN-IN IS FOR (#10250), as its public link answers this
 * visitor - the same decision every public dashboard route makes
 * (DashboardService.decidePublicAccess), before any private user is looked
 * at or made:
 *
 *   - a dashboard the link answers nobody for - one shared only with its
 *     project, an archived one, one of a blocked project, one that does not
 *     exist - reads as not found;
 *   - a visitor its IP allowlist refuses gets the allowlist's refusal;
 *   - a dashboard that does not ask its visitors to sign in signs nobody in.
 *
 * The password routes (API/DashboardPrivateUserAuthentication) and both
 * single sign-on routes (API/DashboardSSO, API/DashboardOIDC) ask it, so a
 * dashboard switched back to Anyone with the link, or to Only people in
 * this project, makes no private user and no session.
 */
export default class DashboardSignIn {
  // A value that is no id is no dashboard.
  public static readDashboardId(value: unknown): ObjectID {
    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new NotFoundException(PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE);
    }

    return new ObjectID(value);
  }

  public static async getDashboardForSignIn(data: {
    req: ExpressRequest;
    dashboardId: ObjectID;
  }): Promise<Dashboard> {
    const dashboard: Dashboard | null = await DashboardService.findOneById({
      id: data.dashboardId,
      select: {
        ...PUBLIC_DASHBOARD_ACCESS_SELECT,
        name: true,
        pageTitle: true,
      },
      props: {
        isRoot: true,
      },
    });

    const access: PublicDashboardAccessResult =
      await DashboardService.decidePublicAccess({
        dashboard,
        dashboardId: data.dashboardId,
        req: data.req,
      });

    if (!dashboard || access.access === PublicDashboardAccess.NotFound) {
      throw new NotFoundException(PUBLIC_DASHBOARD_NOT_FOUND_MESSAGE);
    }

    if (access.access === PublicDashboardAccess.Forbidden) {
      throw access.error;
    }

    if (!access.isSignInRequired) {
      throw new BadDataException(DASHBOARD_SIGN_IN_NOT_ASKED_MESSAGE);
    }

    return dashboard;
  }

  // The name a visitor knows the dashboard by, in its emails.
  public static getDashboardName(dashboard: Dashboard): string {
    return dashboard.pageTitle || dashboard.name || "Dashboard";
  }
}
