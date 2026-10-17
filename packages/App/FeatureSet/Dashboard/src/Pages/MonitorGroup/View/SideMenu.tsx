import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu, {
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import { addDeveloperSideMenuSection } from "../../../Components/DeveloperDocs/DeveloperDocsMenuSection";
import { DeveloperDocsScope } from "../../../Components/DeveloperDocs/DeveloperDocsPages";

export interface ComponentProps {
  modelId: ObjectID;
}

const DashboardSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Laid out like a monitor's own menu: what the group is (its Overview and
   * the monitors in it) first, then its Activity, then Advanced, folded,
   * with its Owners. The monitors in a group are what a group is, and they
   * used to sit under "More", below Owners.
   */
  const sections: SideMenuSectionProps[] = [
    {
      title: "Overview",
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
            title: "Monitors",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_MONITORS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.AltGlobe,
        },
      ],
    },
    {
      title: "Activity",
      items: [
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
            title: "Owners",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_OWNERS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Team,
        },
        {
          link: {
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_GROUP_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.List,
        },
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

  addDeveloperSideMenuSection(sections, {
    modelType: MonitorGroup,
    scope: DeveloperDocsScope.View,
    modelId: props.modelId,
  });

  return <SideMenu sections={sections} />;
};

export default DashboardSideMenu;
