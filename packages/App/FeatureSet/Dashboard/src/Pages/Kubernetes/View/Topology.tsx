import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadKubernetesTopology } from "../../../Components/ResourceTopology/Loaders/KubernetesTopologyLoader";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A Kubernetes cluster's Topology: its namespaces, workloads, pods, nodes
 * and volumes as one map — grouped by workload, or by the node each pod
 * runs on — coloured by how each is doing, with the open incidents and
 * alerts on the part they are about.
 */
const KubernetesClusterTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadKubernetesTopology(modelId);
      }}
      description="How this cluster's namespaces, workloads, pods, nodes and volumes fit together, and which of them need attention."
      searchPlaceholder="Find a namespace, workload, pod or node…"
      emptyDescription="The map appears once the Kubernetes agent sends this cluster's inventory. Its Overview says how to install the agent."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default KubernetesClusterTopology;
