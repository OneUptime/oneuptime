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
      </SideMenuSection>
    </SideMenu>
  );
};

export default SloSideMenu;
