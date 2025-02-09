import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface SideMenuProps {
  modelId: ObjectID;
}

const SideMenuComponent: FunctionComponent<SideMenuProps> = (
  props: SideMenuProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.USER_VIEW] as Route,
              {
                modelId: props.modelId,
              },
            ),
          }}
          icon={IconProp.Info}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete",
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
