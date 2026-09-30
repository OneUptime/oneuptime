import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
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
      <CardModelDetail<CephCluster>
        name="Cluster Settings"
        cardProps={{
          title: "Cluster Settings",
          description: "Manage settings for this Ceph cluster.",
        }}
        modelDetailProps={{
          modelType: CephCluster,
          id: "ceph-cluster-settings",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                fsid: true,
              },
              title: "Cluster fsid",
              fieldType: FieldType.Text,
            },
          ],
        }}
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
