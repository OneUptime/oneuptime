import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  modelId: ObjectID;
}

const ProxmoxClusterSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_DOCUMENTATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Resources">
        <SideMenuItem
          link={{
            title: "Nodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ServerStack}
        />
        <SideMenuItem
          link={{
            title: "Guests",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_GUESTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
        />
        <SideMenuItem
          link={{
            title: "Storage",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_STORAGE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Database}
        />
      </SideMenuSection>

      <SideMenuSection title="Observability">
        <SideMenuItem
          link={{
            title: "Metrics",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_METRICS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ChartBar}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_LOGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Terminal}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Cluster",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_DELETE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Trash}
          className="danger-on-hover"
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default ProxmoxClusterSideMenu;
