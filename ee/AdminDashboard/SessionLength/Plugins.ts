import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";
import { SESSION_LENGTH_SETTINGS_PAGE_PATH } from "./SessionLengthPaths";
import SessionLengthSideMenuItem from "./SessionLengthSideMenuItem";

/*
 * How long a sign-in lasts, for the whole instance: Settings > Session
 * Length, where master admins choose when people are signed out - after a
 * session length, after a while without use, and for SSO sign-ins on their
 * own (ee/Server/SessionLength holds every sign-in to it).
 *
 * The page is lazy, so its code downloads only when it is opened. Merged
 * with the other Enterprise settings pages in ../EnterpriseSettings.
 */
type SessionLengthPluginKeys = "SettingsPages" | "SettingsSideMenuItems";

const SessionLengthPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  SessionLengthPluginKeys
> = {
  SettingsPages: [
    {
      path: SESSION_LENGTH_SETTINGS_PAGE_PATH,
      component: lazy(() => {
        return import("./SessionLengthSettingsPage");
      }),
    },
  ],
  SettingsSideMenuItems: SessionLengthSideMenuItem,
};

export default SessionLengthPlugins;
