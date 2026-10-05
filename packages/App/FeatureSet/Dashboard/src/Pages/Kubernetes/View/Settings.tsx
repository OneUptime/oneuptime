import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const KubernetesClusterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<KubernetesCluster>
        modelType={KubernetesCluster}
        modelId={modelId}
        id="kubernetes-cluster-details"
        title="Cluster Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Display Name",
          description:
            "Shown everywhere this resource appears. Telemetry is not matched by the display name, so renaming is safe.",
          placeholder: "Production US East",
        }}
        descriptionField={{
          placeholder: "Production cluster running in US East",
        }}
        identityFields={[
          {
            column: "clusterIdentifier",
            title: "Cluster Name (clusterName)",
            description:
              "Telemetry is matched by this cluster name: the clusterName the kubernetes-agent Helm chart was installed with. Change it only when the chart's clusterName changes: telemetry that still reports the old name creates a new cluster.",
            placeholder: "production-us-east-1",
          },
        ]}
      />
      <TelemetryResourceRetentionSettings<KubernetesCluster>
        modelType={KubernetesCluster}
        modelId={modelId}
        resourceName="Kubernetes cluster"
        modelDetailIdPrefix="model-detail-kubernetes-cluster"
      />
      <ArchiveResourceCard<KubernetesCluster>
        modelType={KubernetesCluster}
        modelId={modelId}
        singularName="cluster"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default KubernetesClusterSettings;
