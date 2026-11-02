import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import React, { FunctionComponent, ReactElement } from "react";
import {
  SESSION_LENGTH_SETTINGS_PAGE_PATH,
  SESSION_LENGTH_SETTINGS_PAGE_TITLE,
} from "./SessionLengthPaths";

/*
 * Settings > Session Length in the Admin Dashboard's side menu, in Basic
 * after License, on every Enterprise installation: the page itself says
 * when the license does not let the lengths be changed, and that what is
 * set still applies and can be removed.
 */
const SessionLengthSideMenuItem: FunctionComponent = (): ReactElement => {
  return (
    <SideMenuItem
      link={{
        title: SESSION_LENGTH_SETTINGS_PAGE_TITLE,
        to: getEnterpriseSettingsPageRoute(SESSION_LENGTH_SETTINGS_PAGE_PATH),
      }}
      icon={IconProp.Clock}
    />
  );
};

export default SessionLengthSideMenuItem;
