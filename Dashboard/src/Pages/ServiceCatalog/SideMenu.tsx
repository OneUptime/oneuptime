import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const ServiceCatalogSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Service Catalog",
      items: [
        {
          link: {
            title: "All Services",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Dependency Graph",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_CATALOG_DEPENDENCY_GRAPH] as Route,
            ),
          },
          icon: IconProp.Workflow,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default ServiceCatalogSideMenu;
