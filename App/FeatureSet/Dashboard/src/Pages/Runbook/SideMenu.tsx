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
    {
      title: "Settings",
      defaultCollapsed: true,
      items: [
        {
          link: {
            title: "Agents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_AGENTS] as Route,
            ),
          },
          icon: IconProp.Terminal,
        },
        {
          link: {
            title: "Secrets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SECRETS] as Route,
            ),
          },
          icon: IconProp.Lock,
        },
        {
          link: {
            title: "Owner Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SETTINGS_OWNER_RULES] as Route,
            ),
          },
          icon: IconProp.User,
        },
        {
          link: {
            title: "Label Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_SETTINGS_LABEL_RULES] as Route,
            ),
          },
          icon: IconProp.Tag,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default RunbookSideMenu;
