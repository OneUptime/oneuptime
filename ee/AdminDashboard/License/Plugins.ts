import LicenseDetails from "./LicenseDetails";
import LicenseSideMenuItem from "./LicenseSideMenuItem";
import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { LICENSE_SETTINGS_PAGE_PATH } from "Common/UI/Components/EditionLabel/LicenseSettingsPage";
import { lazy } from "react";

/*
 * The license of a self-hosted Enterprise installation.
 *
 * Settings > License is where master admins add, refresh and replace it. Its
 * page is lazy, so its code downloads only when it is opened, and is merged
 * with the other Enterprise settings pages in ../EnterpriseSettings.
 *
 * The edition dialog - the pill in the Admin Dashboard's header - only shows
 * the license: the core Header hands LicenseDetails (./LicenseDetails.tsx) to
 * EditionLabel, which adds the seat usage and the instances to the read-only
 * status. Not lazy, unlike the page: the dialog has no Suspense around it.
 */
type LicensePluginKeys =
  | "LicenseDetails"
  | "SettingsPages"
  | "SettingsSideMenuItems";

const LicensePlugins: Pick<AdminDashboardEnterprisePlugins, LicensePluginKeys> =
  {
    LicenseDetails: LicenseDetails,
    SettingsPages: [
      {
        path: LICENSE_SETTINGS_PAGE_PATH,
        component: lazy(() => {
          return import("./LicenseSettingsPage");
        }),
      },
    ],
    SettingsSideMenuItems: LicenseSideMenuItem,
  };

export default LicensePlugins;
