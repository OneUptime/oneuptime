import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";
import { CUSTOM_CHANNELS_SETTINGS_PAGE_PATH } from "./CustomChannelsPaths";
import CustomChannelsSideMenuItem from "./CustomChannelsSideMenuItem";

type CustomChannelsPluginKeys =
  | "SettingsPages"
  | "SettingsNotificationSideMenuItems";

/*
 * Custom notification channels (EnterpriseFeature.CustomNotificationChannels):
 * Settings > Notifications > Custom Channels, where the server's admin adds
 * the ways to reach people through their own service.
 */
const CustomChannelsPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  CustomChannelsPluginKeys
> = {
  SettingsPages: [
    {
      path: CUSTOM_CHANNELS_SETTINGS_PAGE_PATH,
      component: lazy(() => {
        return import("./CustomChannelsSettingsPage");
      }),
    },
  ],
  SettingsNotificationSideMenuItems: CustomChannelsSideMenuItem,
};

export default CustomChannelsPlugins;
