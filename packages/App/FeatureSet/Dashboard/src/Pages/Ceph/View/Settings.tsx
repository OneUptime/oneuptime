import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
import ResourceDetailsCard from "../../../Components/TelemetryResource/ResourceDetailsCard";
import TelemetryResourceRetentionSettings from "../../../Components/TelemetryResource/TelemetryResourceRetentionSettings";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const CephClusterSettings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <ResourceDetailsCard<CephCluster>
        modelType={CephCluster}
        modelId={modelId}
        id="ceph-cluster-details"
        title="Ceph Cluster Details"
        description="How this resource is named, described and labelled everywhere it appears."
        nameField={{
          title: "Name",
          description:
            "Must match the ceph.cluster.name the Ceph Agent reports (its CEPH_CLUSTER_NAME). Telemetry is matched to this cluster by it: rename it on the agent too, or the agent's next report creates a new cluster.",
          placeholder: "production-ceph-cluster",
        }}
        descriptionField={{
          placeholder: "Production Ceph cluster running in US East",
        }}
        detailFields={[
          {
            field: {
              fsid: true,
            },
            title: "Cluster fsid",
            fieldType: FieldType.Text,
          },
        ]}
      />
      <TelemetryResourceRetentionSettings<CephCluster>
        modelType={CephCluster}
        modelId={modelId}
        resourceName="Ceph cluster"
        modelDetailIdPrefix="model-detail-ceph-cluster"
      />
      <ArchiveResourceCard<CephCluster>
        modelType={CephCluster}
        modelId={modelId}
        singularName="cluster"
        listRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CEPH_CLUSTERS] as Route,
        )}
      />
    </Fragment>
  );
};

export default CephClusterSettings;
