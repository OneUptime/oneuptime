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

const InventoryItemSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const sections: SideMenuSectionProps[] = [
    {
      title: "Item",
      items: [
        {
          link: {
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Info,
        },
        {
          link: {
            title: "Connections",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_RELATIONSHIPS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.FlowDiagram,
        },
        {
          link: {
            title: "Custom Fields",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_CUSTOM_FIELDS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.TableCells,
        },
      ],
    },
    {
      title: "Telemetry",
      items: [
        {
          link: {
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Logs,
        },
        {
          link: {
            title: "Traces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_TRACES] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Workflow,
        },
        {
          link: {
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Graph,
        },
        {
          link: {
            title: "Performance Profiles",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_PROFILES] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Fire,
        },
        {
          link: {
            title: "Exceptions",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_EXCEPTIONS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Error,
        },
      ],
    },
    /*
     * These pages read through the item's typed row rather than through any
     * relation of its own — see LinkedResource. The section is shown for every
     * item, including the ones that can never have their own: hiding it would
     * leave a user wondering where incidents went, whereas the page itself can
     * say which resource to look at instead.
     */
    {
      title: "Operations",
      items: [
        {
          link: {
            title: "Incidents",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_INCIDENTS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Alert,
        },
        {
          link: {
            title: "Alerts",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_ALERTS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.ExclaimationCircle,
        },
        {
          link: {
            title: "Scheduled Maintenance",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_SCHEDULED_MAINTENANCE] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Clock,
        },
        {
          link: {
            title: "Audit Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_AUDIT_LOGS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.List,
        },
      ],
    },
    {
      title: "Advanced",
      items: [
        {
          link: {
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Settings,
        },
        {
          link: {
            title: "Delete Item",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.INVENTORY_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          },
          icon: IconProp.Trash,
        },
      ],
    },
  ];

  return <SideMenu sections={sections} />;
};

export default InventoryItemSideMenu;
