import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { ReactElement } from "react";
import { useTranslation } from "react-i18next";

const MoreSideMenu: () => JSX.Element = (): ReactElement => {
  const { t } = useTranslation();
  return (
    <SideMenu>
      <SideMenuSection title={t("sideMenu.moreCommunication")}>
        <SideMenuItem
          link={{
            title: t("sideMenu.moreSendEmail"),
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
