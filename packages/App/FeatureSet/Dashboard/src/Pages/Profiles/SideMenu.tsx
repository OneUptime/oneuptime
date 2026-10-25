import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
  // A finding's own page keeps Insights marked: the finding is one of them.
  const insightViewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROFILES_AI_INSIGHT_VIEW] as Route,
  );

  const sections: SideMenuSectionProps[] = [
    {
      title: "Profiler",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES] as Route,
            ),
          },
          icon: IconProp.Bolt,
        },
        {
          link: {
            title: "All profiles",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES_INSIGHTS] as Route,
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
    /*
     * Everything OneUptime AI does with slow code, in one place: what
     * OneUptime found (Insights), what OneUptime AI did with it (Logs) and
     * how it is set up (Settings, with the AI rules under More settings) -
     * the AI section every product's menu has (Common/Types/AI/TelemetryAi).
     * Folded to its title until opened (SideMenuSectionState.ts), and open
     * by itself on its pages.
     */
    {
      title: "AI",
      items: [
        {
          link: {
            title: "Insights",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES_AI_INSIGHTS] as Route,
            ),
          },
          activeRoute: Navigation.isOnThisPage(insightViewRoute)
            ? insightViewRoute
            : undefined,
          icon: IconProp.LightBulb,
        },
        {
          link: {
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES_AI_LOGS] as Route,
            ),
          },
          icon: IconProp.QueueList,
        },
        {
          link: {
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES_AI_SETTINGS] as Route,
            ),
          },
          icon: IconProp.Settings,
        },
      ],
    },
    {
      title: "Help",
      items: [
        {
          link: {
            title: "Setup guide",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROFILES_DOCUMENTATION] as Route,
            ),
          },
          icon: IconProp.Book,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
