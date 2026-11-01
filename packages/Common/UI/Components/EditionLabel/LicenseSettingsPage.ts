import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { ADMIN_DASHBOARD_URL } from "../../Config";

/*
 * Where a master admin manages the license: Settings > License in the Admin
 * Dashboard. The page is the Enterprise Edition's
 * (ee/AdminDashboard/License); the edition dialog of both dashboards only
 * links to it, and the Dashboard is another app, so it takes a whole URL
 * rather than a route.
 */
export const LICENSE_SETTINGS_PAGE_PATH: string = "license";

export const getLicenseSettingsPageUrl: () => URL = (): URL => {
  return URL.fromURL(ADMIN_DASHBOARD_URL).addRoute(
    new Route(`/settings/${LICENSE_SETTINGS_PAGE_PATH}`),
  );
};
