import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const LogsSettingsSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Log Settings",
      items: [
        {
          link: {
            title: "Pipelines",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_SETTINGS_PIPELINES] as Route,
            ),
          },
          icon: IconProp.Logs,
        },
        {
          link: {
            title: "Drop Filters",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_SETTINGS_DROP_FILTERS] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
        {
          link: {
            title: "Scrub Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_SETTINGS_SCRUB_RULES] as Route,
            ),
          },
          icon: IconProp.ShieldCheck,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default LogsSettingsSideMenu;
