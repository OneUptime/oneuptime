import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";

export interface ResourceCounts {
  namespaces?: number | undefined;
  pods?: number | undefined;
  deployments?: number | undefined;
  statefulSets?: number | undefined;
  daemonSets?: number | undefined;
  jobs?: number | undefined;
  cronJobs?: number | undefined;
  nodes?: number | undefined;
  containers?: number | undefined;
  pvcs?: number | undefined;
  pvs?: number | undefined;
  hpas?: number | undefined;
  vpas?: number | undefined;
}

export interface ComponentProps {
  modelId: ObjectID;
  resourceCounts?: ResourceCounts | undefined;
}

const KubernetesClusterSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const counts: ResourceCounts = props.resourceCounts || {};

  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Documentation",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DOCUMENTATION] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Book}
        />
      </SideMenuSection>

      <SideMenuSection title="Workloads">
        <SideMenuItem
          link={{
            title: "Namespaces",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Folder}
          badge={counts.namespaces}
        />
        <SideMenuItem
          link={{
            title: "Pods",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_PODS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Circle}
          badge={counts.pods}
        />
        <SideMenuItem
          link={{
            title: "Deployments",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Layers}
          badge={counts.deployments}
        />
        <SideMenuItem
          link={{
            title: "StatefulSets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSETS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Database}
          badge={counts.statefulSets}
        />
        <SideMenuItem
          link={{
            title: "DaemonSets",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSETS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
          badge={counts.daemonSets}
        />
        <SideMenuItem
          link={{
            title: "Jobs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_JOBS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Play}
          badge={counts.jobs}
        />
        <SideMenuItem
          link={{
            title: "CronJobs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOBS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Clock}
          badge={counts.cronJobs}
        />
      </SideMenuSection>

      <SideMenuSection title="Infrastructure">
        <SideMenuItem
          link={{
            title: "Nodes",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NODES] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Server}
          badge={counts.nodes}
        />
        <SideMenuItem
          link={{
            title: "Containers",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINERS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Cube}
          badge={counts.containers}
        />
        <SideMenuItem
          link={{
            title: "PVCs",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.KUBERNETES_CLUSTER_VIEW_PVCS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Disc}
          badge={counts.pvcs}
        />
        <SideMenuItem
          link={{
            title: "PVs",
            to: RouteUtil.populateRouteParams(
              RouteMap[
                PageMap.KUBERNETES_CLUSTER_VIEW_PVS
              ] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Disc}
          badge={counts.pvs}
        />
      </SideMenuSection>

      <SideMenuSection title="Scaling">
        <SideMenuItem
          link={{
            title: "HPAs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_HPAS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.ArrowUpDown}
          badge={counts.hpas}
        />
        <SideMenuItem
          link={{
            title: "VPAs",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_VPAS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Scale}
          badge={counts.vpas}
        />
      </SideMenuSection>

      <SideMenuSection title="Observability">
        <SideMenuItem
          link={{
            title: "Events",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Logs}
        />
        <SideMenuItem
          link={{
            title: "Control Plane",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CONTROL_PLANE] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Activity}
        />
        <SideMenuItem
          link={{
            title: "Service Mesh",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_MESH] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Globe}
        />
      </SideMenuSection>

      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_SETTINGS] as Route,
              { modelId: props.modelId },
            ),
          }}
          icon={IconProp.Settings}
        />
        <SideMenuItem
          link={{
            title: "Delete Cluster",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DELETE] as Route,
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

export default KubernetesClusterSideMenu;
