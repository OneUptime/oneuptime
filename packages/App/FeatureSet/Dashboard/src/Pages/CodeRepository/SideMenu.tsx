import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const CodeRepositorySideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Code Repositories",
      items: [
        {
          link: {
            title: "All Repositories",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.CODE_REPOSITORY] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default CodeRepositorySideMenu;
