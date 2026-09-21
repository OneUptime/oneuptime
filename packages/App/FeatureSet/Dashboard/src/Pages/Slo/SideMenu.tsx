import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

const SloSideMenu: FunctionComponent = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Service Level Objectives">
        <SideMenuItem
          link={{
            title: "SLOs",
            to: RouteUtil.populateRouteParams(RouteMap[PageMap.SLOS] as Route),
          }}
          icon={IconProp.Gauge}
        />
        {/*
         * Archived SLOs are filtered out of the list above, so without this
         * entry the only way back to one would be its URL.
         */}
        <SideMenuItem
          link={{
            title: "Archived",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_ARCHIVED] as Route,
            ),
          }}
          icon={IconProp.Archive}
        />
      </SideMenuSection>

      <SideMenuSection title="Settings">
        <SideMenuItem
          link={{
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_SETTINGS_OWNER_RULES] as Route,
            ),
          }}
          icon={IconProp.User}
        />
        <SideMenuItem
          link={{
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SLOS_SETTINGS_LABEL_RULES] as Route,
            ),
          }}
          icon={IconProp.Tag}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default SloSideMenu;
