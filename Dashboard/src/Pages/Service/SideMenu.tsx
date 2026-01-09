import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const ServiceSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Services",
      items: [
        {
          link: {
            title: "All Services",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICES] as Route,
            ),
          },
          icon: IconProp.List,
        },
        {
          link: {
            title: "Dependency Graph",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.SERVICE_DEPENDENCY_GRAPH] as Route,
            ),
          },
          icon: IconProp.Workflow,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default ServiceSideMenu;
