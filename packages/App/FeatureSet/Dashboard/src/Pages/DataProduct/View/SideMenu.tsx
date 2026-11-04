import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

/*
 * One data product's pages: whether it is fresh, its settings, its
 * Developer pages and, last, deleting it.
 */
const DataProductViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const routeOf: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: props.modelId,
    });
  };

  return (
    <SideMenu>
      <SideMenuSection title="Data Product">
        <SideMenuItem
          link={{
            title: "Overview",
            to: routeOf(PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Settings",
            to: routeOf(PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_SETTINGS),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>

      {getDeveloperSideMenuSection({
        modelType: DataProduct,
        scope: DeveloperDocsScope.View,
        modelId: props.modelId,
      })}

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Delete Data Product",
            to: routeOf(PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW_DELETE),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default DataProductViewSideMenu;
