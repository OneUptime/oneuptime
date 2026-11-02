import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Everything OneUptime AI does with the project's metrics, in one place:
 * what OneUptime found - high-cardinality metrics, histograms whose buckets
 * do not fit, missing metrics - (Insights), what OneUptime AI did with it
 * (Logs) and how it is set up (Settings, with the AI rules under More
 * settings): the AI section every telemetry product has
 * (Common/Types/AI/TelemetryAi), reached from the AI tab of Metrics' tabs.
 */
const MetricsAISideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "AI",
      items: [
        {
          link: {
            title: "Insights",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.METRICS_AI_INSIGHTS] as Route,
            ),
          },
          icon: IconProp.LightBulb,
        },
        {
          link: {
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.METRICS_AI_LOGS] as Route,
            ),
          },
          icon: IconProp.QueueList,
        },
        {
          link: {
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.METRICS_AI_SETTINGS] as Route,
            ),
          },
          icon: IconProp.Settings,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default MetricsAISideMenu;
