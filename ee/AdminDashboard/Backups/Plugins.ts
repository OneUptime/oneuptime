import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";
import { BACKUPS_SETTINGS_PAGE_PATH } from "./BackupsPaths";
import BackupsSideMenuItem from "./BackupsSideMenuItem";

/*
 * Backups of the instance: Settings > Backups, where master admins set
 * where PostgreSQL and ClickHouse are backed up, how often and for how
 * long, follow each backup, and restore one (ee/Server/Backup does the
 * work).
 *
 * The page is lazy, so its code downloads only when it is opened. Merged
 * with the other Enterprise settings pages in ../EnterpriseSettings.
 */
type BackupsPluginKeys = "SettingsPages" | "SettingsSideMenuItems";

const BackupsPlugins: Pick<AdminDashboardEnterprisePlugins, BackupsPluginKeys> =
  {
    SettingsPages: [
      {
        path: BACKUPS_SETTINGS_PAGE_PATH,
        component: lazy(() => {
          return import("./BackupsSettingsPage");
        }),
      },
    ],
    SettingsSideMenuItems: BackupsSideMenuItem,
  };

export default BackupsPlugins;
