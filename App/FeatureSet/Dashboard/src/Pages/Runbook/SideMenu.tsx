import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { ReactElement } from "react";

const RunbookSideMenu: () => ReactElement = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Runbooks",
      items: [
        {
          link: {
            title: "Runbooks",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS] as Route,
            ),
          },
          icon: IconProp.BookOpen,
        },
        {
          link: {
            title: "Executions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_EXECUTIONS] as Route,
            ),
          },
          icon: IconProp.Play,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default RunbookSideMenu;
