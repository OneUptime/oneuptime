import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ArchiveResourceCard from "../../../Components/TelemetryResource/ArchiveResourceCard";
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
      <CardModelDetail<KubernetesCluster>
        name="Cluster Settings"
        cardProps={{
          title: "Cluster Settings",
          description: "Manage settings for this Kubernetes cluster.",
        }}
        isEditable={true}
        editButtonText="Edit Settings"
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            description: "Friendly name for this Kubernetes cluster.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "production-us-east",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            description: "Friendly description for this Kubernetes cluster.",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Production cluster running in US East region on EKS",
          },
        ]}
        modelDetailProps={{
          modelType: KubernetesCluster,
          id: "kubernetes-cluster-settings",
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
                clusterIdentifier: true,
              },
              title: "Cluster Identifier",
              fieldType: FieldType.Text,
            },
          ],
        }}
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
