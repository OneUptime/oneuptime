import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { PUBLIC_DASHBOARD_URL } from "Common/UI/Config";

/*
 * A dashboard's public link: the address its public viewer answers on for
 * any dashboard, custom domain or not. Shown, with a copy button, under the
 * public choice on the dashboard's Sharing page.
 *
 * Apart from DashboardSharingCopy because it reads the browser's config,
 * which App/Tests (no browser) cannot load.
 */
export const getPublicDashboardUrl: (dashboardId: ObjectID | string) => URL = (
  dashboardId: ObjectID | string,
): URL => {
  return URL.fromString(
    `${PUBLIC_DASHBOARD_URL.toString()}/${dashboardId.toString()}`,
  );
};

export default getPublicDashboardUrl;
