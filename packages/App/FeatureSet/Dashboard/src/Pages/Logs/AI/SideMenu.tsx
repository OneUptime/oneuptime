import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Everything OneUptime AI does with the project's logs, in one place: what
 * OneUptime found - error logs, missing logging, noisy logs - (Insights),
 * what OneUptime AI did with it (Activity) and how it is set up (Settings,
 * with the AI rules under More settings): the AI section every telemetry
 * product has (Common/Types/AI/TelemetryAi), reached from the AI tab of
 * Logs' tabs. Its record of what OneUptime AI did is "Activity" here, not
 * "Logs" as in the other products: inside Logs, a page called Logs would
 * read as log lines.
 */
const LogsAISideMenu: FunctionComponent = (): ReactElement => {
  // A finding's own page keeps Insights marked: the finding is one of them.
  const insightViewRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.LOGS_AI_INSIGHT_VIEW] as Route,
  );

  const sections: SideMenuSectionProps[] = [
    {
      title: "AI",
      items: [
        {
          link: {
            title: "Insights",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_AI_INSIGHTS] as Route,
            ),
          },
          activeRoute: Navigation.isOnThisPage(insightViewRoute)
            ? insightViewRoute
            : undefined,
          icon: IconProp.LightBulb,
        },
        {
          link: {
            title: "Activity",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_AI_ACTIVITY] as Route,
            ),
          },
          icon: IconProp.QueueList,
        },
        {
          link: {
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.LOGS_AI_SETTINGS] as Route,
            ),
          },
          icon: IconProp.Settings,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default LogsAISideMenu;
