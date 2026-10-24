import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import React, { FunctionComponent, ReactElement } from "react";
import {
  BACKUPS_SETTINGS_PAGE_PATH,
  BACKUPS_SETTINGS_PAGE_TITLE,
} from "./BackupsPaths";

/*
 * Settings > Backups in the Admin Dashboard's side menu, on every
 * Enterprise installation: the page itself says when the license has
 * stopped new backups, and what still works then (restoring and deleting).
 */
const BackupsSideMenuItem: FunctionComponent = (): ReactElement => {
  return (
    <SideMenuItem
      link={{
        title: BACKUPS_SETTINGS_PAGE_TITLE,
        to: getEnterpriseSettingsPageRoute(BACKUPS_SETTINGS_PAGE_PATH),
      }}
      icon={IconProp.Database}
    />
  );
};

export default BackupsSideMenuItem;
