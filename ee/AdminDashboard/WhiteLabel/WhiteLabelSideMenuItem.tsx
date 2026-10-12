import { getEnterpriseSettingsPageRoute } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import React, { FunctionComponent, ReactElement } from "react";
import {
  isWhiteLabelAvailable,
  WHITE_LABEL_SETTINGS_PAGE_PATH,
} from "./WhiteLabelSettingsAPI";

/*
 * Settings > White Label in the Admin Dashboard's side menu - only while the
 * license allows white-labelling. Otherwise nothing at all is drawn: no
 * entry, no disabled entry, no hint (the maintainer: "If a license is not
 * allowed to be white-labelled, please don't even show that option").
 */
const WhiteLabelSideMenuItem: FunctionComponent = (): ReactElement => {
  if (!isWhiteLabelAvailable()) {
    return <></>;
  }

  return (
    <SideMenuItem
      link={{
        title: "White Label",
        to: getEnterpriseSettingsPageRoute(WHITE_LABEL_SETTINGS_PAGE_PATH),
      }}
      icon={IconProp.Swatch}
    />
  );
};

export default WhiteLabelSideMenuItem;
