import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";
import { WHITE_LABEL_SETTINGS_PAGE_PATH } from "./WhiteLabelSettingsAPI";
import WhiteLabelSideMenuItem from "./WhiteLabelSideMenuItem";

/*
 * White-labelling: Settings > White Label, where the master admins of an
 * installation whose license allows it set the product's name, logos and
 * browser tab icon (ee/Server/WhiteLabel).
 *
 * Both pieces draw nothing while the license does not allow it: the side
 * menu entry is not there, and the page at /admin/settings/white-label is as
 * empty as a path that does not exist. The page is lazy, so its code
 * downloads only when it is opened.
 */
type WhiteLabelPluginKeys = "SettingsPages" | "SettingsSideMenuItems";

const WhiteLabelPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  WhiteLabelPluginKeys
> = {
  SettingsPages: [
    {
      path: WHITE_LABEL_SETTINGS_PAGE_PATH,
      component: lazy(() => {
        return import("./WhiteLabelSettingsPage");
      }),
    },
  ],
  SettingsSideMenuItems: WhiteLabelSideMenuItem,
};

export default WhiteLabelPlugins;
