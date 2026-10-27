import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import React, { FunctionComponent, ReactElement } from "react";
import {
  CUSTOM_CHANNELS_SETTINGS_PAGE_PATH,
  CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE,
} from "./CustomChannelsPaths";

// Settings > Custom Channels in the Settings side menu.
const CustomChannelsSideMenuItem: FunctionComponent = (): ReactElement => {
  return (
    <SideMenuItem
      link={{
        title: CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE,
        to: getEnterpriseSettingsPageRoute(CUSTOM_CHANNELS_SETTINGS_PAGE_PATH),
      }}
      icon={IconProp.Webhook}
    />
  );
};

export default CustomChannelsSideMenuItem;
