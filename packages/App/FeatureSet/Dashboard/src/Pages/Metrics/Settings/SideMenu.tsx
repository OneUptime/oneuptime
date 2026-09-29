import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

const MetricsSettingsSideMenu: FunctionComponent = (): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Metric Settings",
      items: [
        {
          link: {
            title: "Pipeline Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.METRICS_SETTINGS_PIPELINE_RULES] as Route,
            ),
          },
          icon: IconProp.Filter,
        },
        {
          link: {
            title: "Recording Rules",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.METRICS_SETTINGS_RECORDING_RULES] as Route,
            ),
          },
          icon: IconProp.Calculator,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default MetricsSettingsSideMenu;
