import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Basic",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Info,
        },
        {
          link: {
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Team,
        },
      ],
    },
    {
      title: "More",
      items: [
        {
          link: {
            title: "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_MONITORS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.AltGlobe,
        },
        {
          link: {
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.ExclaimationCircle,
        },
      ],
    },
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Delete Group",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Trash,
          className: "danger-on-hover",
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
