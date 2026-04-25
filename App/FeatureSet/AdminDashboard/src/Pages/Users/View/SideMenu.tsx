import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface SideMenuProps {
  modelId: ObjectID;
}

const SideMenuComponent: FunctionComponent<SideMenuProps> = (
  props: SideMenuProps,
): ReactElement => {
  const { t } = useTranslation();
  return (
    <SideMenu>
      <SideMenuSection title={t("sideMenu.basic")}>
        <SideMenuItem
          link={{
            title: t("sideMenu.overview"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_VIEW] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: t("sideMenu.settings"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_SETTINGS] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      <SideMenuSection title={t("sideMenu.advanced")}>
        <SideMenuItem
          link={{
            title: t("sideMenu.delete"),
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_DELETE] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Trash}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default SideMenuComponent;
