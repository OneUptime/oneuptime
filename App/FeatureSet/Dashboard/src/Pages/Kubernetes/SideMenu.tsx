import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const KubernetesSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Kubernetes",
      items: [
        {
          link: {
            title: "All Clusters",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTERS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default KubernetesSideMenu;
