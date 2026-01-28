import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { ReactElement } from "react";

const DashboardSideMenu: () => JSX.Element = (): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route,
            ),
          }}
          icon={IconProp.Info}
        />

        <SideMenuItem
          link={{
            title: "Profile Picture",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_PROFILE_PICTURE] as Route,
            ),
          }}
          icon={IconProp.Image}
        />
      </SideMenuSection>
      <SideMenuSection title="Security">
        <SideMenuItem
          link={{
            title: "Password Management",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_PROFILE_PASSWORD] as Route,
            ),
          }}
          icon={IconProp.Lock}
        />

        <SideMenuItem
          link={{
            title: "Two Factor Auth",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_TWO_FACTOR_AUTH] as Route,
            ),
          }}
          icon={IconProp.ShieldCheck}
        />
      </SideMenuSection>
      <SideMenuSection title="Danger Zone">
        <SideMenuItem
          link={{
            title: "Delete Account",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_PROFILE_DELETE] as Route,
            ),
          }}
          icon={IconProp.Trash}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DashboardSideMenu;
