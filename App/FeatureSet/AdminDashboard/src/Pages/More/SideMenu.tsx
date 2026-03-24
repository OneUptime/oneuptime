import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { ReactElement } from "react";

const MoreSideMenu: () => JSX.Element = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Communication">
        <SideMenuItem
          link={{
            title: "Send Email",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MORE_EMAIL] as Route,
            ),
          }}
          icon={IconProp.Email}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default MoreSideMenu;
